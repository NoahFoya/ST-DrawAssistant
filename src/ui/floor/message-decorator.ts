/**
 * 消息楼层生图组件调度器 (MessageDecorator)。
 *
 * 负责解析消息中的生图指令标签，管理楼层内的动作按钮、骨架屏与图片展示容器：
 * - 解析消息正文中的生图指令并替换为楼层生图容器节点；
 * - 管理楼层内的生图按钮与生成中骨架屏；
 * - 出图就绪后在楼层消息中展示图片，并支持全屏预览与图片编辑面板；
 * - 响应宿主消息删除、编辑与分支滑动事件，清理对应实例。
 */

import type { Disposable } from '../types';
import { FloorActionButton } from './floor-action-button';
import { promptPipeline } from '../../pipeline/prompt-pipeline';
import { extractArchivesFromText, type ExtractedArchiveItem } from '../../pipeline/archive-extractor';
import { openArchiveConfirmModal } from '../modal/archive-confirm-modal';
import { generationOrchestrator, type SubmitTaskOptions } from '../../pipeline/generation-orchestrator';
import { settingsStore } from '../../store/settings-store';
import { imageStorage } from '../../store/image-storage';
import { urlPool } from '../../store/url-pool';
import { lightboxModal } from '../media/lightbox-modal';
import { imageInfoModal } from '../media/image-info-modal';
import { imageActionPanel } from '../media/image-action-panel';
import { renderIcon } from '../components/icons';
import { Toast } from '../feedback/toast';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { eventBus, type TaskStatusEventData } from '../../util/event-bus';
import { sessionLifecycle } from '../../pipeline/session-lifecycle';
import { logger } from '../../util/logger';
import { validatePresetAssets } from '../../util/asset-matcher';
import type {
    DrawingPresetData,
    PromptPresetData,
    ProviderStoredConfig,
    ProviderType,
    SlotMountTarget,
} from '@types';

/**
 * 校验当前激活预设中的资产（主模型、VAE、CLIP、LoRA）是否存在于资产缓存中。
 *
 * @param providerType 生图后端服务提供方标识
 * @returns 校验结果：valid 为是否齐备，missing 记录缺失的模型文件名列表
 */
function validateCurrentPresetAssets(providerType: ProviderType): { valid: boolean; missing: string[] } {
    const pCfg = settingsStore.getProviderConfig<ProviderStoredConfig>(providerType);
    const activeDrawingId = pCfg?.activeDrawingPresetId;
    const cache = pCfg?.assetCache;

    if (!activeDrawingId) {
        return { valid: true, missing: [] };
    }

    const dp = settingsStore.getPreset<DrawingPresetData>('drawing', activeDrawingId, providerType);
    const promptPresetId = dp?.data?.promptPresetId;
    const pp = promptPresetId
        ? settingsStore.getPreset<PromptPresetData>('prompts', promptPresetId, providerType)
        : undefined;

    return validatePresetAssets({
        drawingPreset: dp?.data,
        promptPreset: pp?.data,
        assetCache: cache,
        providerType,
    });
}

interface FloorSlotState {
    target: SlotMountTarget;
    imageId?: string;
    displayUrl: string;
    favorited: boolean;
    syncFavUI: (fav: boolean) => void;
}

export class MessageDecorator implements Disposable {
    /** 活跃的楼层动作按钮实例映射：Key 为 `${chatId}:${messageId}:${swipeId}:${instructionIndex}` */
    private readonly activeButtons = new Map<string, FloorActionButton>();

    /** 活跃的楼层图片呈现容器实例映射：Key 为 `${chatId}:${messageId}:${swipeId}:${instructionIndex}` */
    private readonly activeImageContainers = new Map<string, HTMLElement>();

    /** 活跃的楼层图像容器状态映射：用于重新生成或更新图片时同步最新 imageId 与 URL，避免闭包状态陈旧 */
    private readonly activeSlotStates = new Map<string, FloorSlotState>();

    /** 活跃的楼层骨架屏占位元素映射：Key 为 `${chatId}:${messageId}:${swipeId}:${instructionIndex}` */
    private readonly activeSkeletons = new Map<string, HTMLElement>();

    /** 已自动弹出过档案确认框的楼层签名集合，防止同一楼层重复自动弹窗 */
    private readonly promptedArchiveKeys = new Set<string>();

    /** 在途异步楼层装饰任务映射，防止同一楼层高频事件与视口扫描并发重入 */
    private readonly inFlightDecorations = new Map<number, Promise<void>>();

    /** 活跃楼层容器的临时生命周期清理回调（预载器与移动端手势定时器等） */
    private readonly activeSlotCleanups = new Map<string, () => void>();

    /** 防抖扫描定时器 */
    private scanTimer: ReturnType<typeof setTimeout> | null = null;
    private unbindEventListener: (() => void) | null = null;
    private intersectionObserver: IntersectionObserver | null = null;

    public constructor() {
        this.listenEvents();
    }

    /**
     * 生成楼层容器唯一标识 Key（采用冒号安全分隔，避免会话 ID 或分支索引碰撞）。
     *
     * @param chatId 会话唯一标识符
     * @param messageId 消息楼层索引编号
     * @param swipeId 会话分支滑动序号
     * @param instructionIndex 单消息内指令序号
     * @returns 楼层容器全局复合唯一键
     */
    private buildSlotKey(chatId: string, messageId: number, swipeId: number, instructionIndex: number): string {
        return `${chatId}:${messageId}:${swipeId}:${instructionIndex}`;
    }

    /**
     * 监听生图就绪通知与任务状态变更事件，自动刷新并挂载对应楼层的生成图片或骨架占位。
     */
    private listenEvents(): void {
        const unbindImageReady = eventBus.on('image:ready', async ({ imageId, target }) => {
            const hostContext = window.SillyTavern?.getContext?.();
            const currentChatId = hostContext?.chatId;

            // 跨会话安全防护：若当前活跃会话与任务所属会话不一致，跳过当前视图 DOM 渲染
            if (currentChatId && currentChatId !== target.chatId) {
                return;
            }

            const swipeId = target.swipeId ?? 0;
            const currentSwipeId = hostContext?.chat?.[target.messageId]?.swipe_id ?? 0;
            if (hostContext?.chat?.[target.messageId] && swipeId !== currentSwipeId) {
                return;
            }

            // 1. 在消息 DOM 容器中渲染呈现生成的图像（或替换骨架屏）
            const slotEntry = sessionLifecycle.getSlotEntry({
                ...target,
                swipeId,
            });
            await this.renderImageToFloor(
                target.messageId,
                imageId,
                target.instructionIndex,
                slotEntry?.imageUrl,
                target.chatId,
                swipeId
            );

            // 2. 协调按钮状态：任务完成，更新对应按钮状态为 done（或按 hideButtonOnDone 隐藏）
            const buttonKey = this.buildSlotKey(target.chatId, target.messageId, swipeId, target.instructionIndex);
            const button = this.activeButtons.get(buttonKey);
            if (button) {
                const settings = settingsStore.getSettings();
                const hideButtonOnDone = settings.ui?.floorButton?.hideOnDone ?? false;
                if (hideButtonOnDone) {
                    button.element.style.display = 'none';
                }
                button.setState('done');
            }
        });

        const unbindTaskStatus = eventBus.on('task:status', (eventData: TaskStatusEventData) => {
            if (!eventData.task) {
                return;
            }
            const target = eventData.task.target;
            const hostContext = window.SillyTavern?.getContext?.();
            const currentChatId = hostContext?.chatId;
            if (currentChatId && currentChatId !== target.chatId) {
                return;
            }

            const swipeId = target.swipeId ?? 0;
            const buttonKey = this.buildSlotKey(target.chatId, target.messageId, swipeId, target.instructionIndex);
            const button = this.activeButtons.get(buttonKey);
            if (!button) {
                return;
            }

            if (eventData.status === 'failed') {
                button.setState('error', '生成失败，点击重试');
                this.removeSkeleton(target.messageId, target.instructionIndex, target.chatId, swipeId);
                const container = this.activeImageContainers.get(buttonKey);
                container?.querySelector('.da-floor-image')?.classList.remove('da-floor-image--regenerating');
                if (eventData.task.error) {
                    Toast.error(`生图任务失败: ${eventData.task.error}`);
                }
            } else if (eventData.status === 'cancelled') {
                const container = this.activeImageContainers.get(buttonKey);
                const hasImage = Boolean(container?.querySelector('.da-floor-image'));
                button.setState(hasImage ? 'done' : 'ready');
                this.removeSkeleton(target.messageId, target.instructionIndex, target.chatId, swipeId);
                container?.querySelector('.da-floor-image')?.classList.remove('da-floor-image--regenerating');
                Toast.info('生图任务已取消');
            } else if (eventData.status === 'generating') {
                button.setState('generating');
            } else if (eventData.status === 'pending') {
                button.setState('pending');
            }
        });

        const unbindFavChanged = eventBus.on('image:favorite-changed', ({ imageId, favorited }) => {
            for (const slotState of this.activeSlotStates.values()) {
                if (slotState.imageId === imageId) {
                    slotState.favorited = favorited;
                    slotState.syncFavUI(favorited);
                }
            }
        });

        const unbindImageDeleted = eventBus.on('image:deleted', ({ imageId }) => {
            this.handleImageDeleted(imageId);
        });

        this.unbindEventListener = () => {
            unbindImageReady();
            unbindTaskStatus();
            unbindFavChanged();
            unbindImageDeleted();
        };
    }

    /**
     * 遍历容器内的文本节点，将生图指令文本拆分并安全替换为楼层容器元素。
     *
     * @param container 消息文本宿主 DOM 容器 (.mes_text)
     * @param commands 提取出的生图指令列表
     * @returns 映射字典：instructionIndex -> HTMLElement
     */
    private replaceCommandsWithSlots(
        container: HTMLElement,
        commands: ReturnType<typeof promptPipeline.extractCommands>
    ): Map<number, HTMLElement> {
        const slotsMap = new Map<number, HTMLElement>();
        if (!container || commands.length === 0) {
            return slotsMap;
        }

        // 先检查是否已有现成容器
        for (const cmd of commands) {
            const existing = container.querySelector(
                `.da-floor-slot[data-instruction-index="${cmd.instructionIndex}"]`
            ) as HTMLElement | null;
            if (existing) {
                slotsMap.set(cmd.instructionIndex, existing);
            }
        }

        // 若全部容器已就绪，直接返回
        if (slotsMap.size === commands.length) {
            return slotsMap;
        }

        for (const cmd of commands) {
            if (slotsMap.has(cmd.instructionIndex)) {
                continue;
            }

            // 每次动态重新遍历纯文本节点，避免多指令切分导致脱落节点的 DOMException
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
            let targetTextNode: Text | null = null;
            let matchIndex = -1;
            let matchLength = cmd.rawMatch.length;

            while (true) {
                const node = walker.nextNode() as Text | null;
                if (!node) {
                    break;
                }
                const content = node.nodeValue || '';
                const idx = content.indexOf(cmd.rawMatch);
                if (idx !== -1) {
                    targetTextNode = node;
                    matchIndex = idx;
                    matchLength = cmd.rawMatch.length;
                    break;
                }
            }

            // 若完整 rawMatch 遇到换行或空格在 Markdown 渲染中被规范化，尝试宽松空白比对
            if (!targetTextNode) {
                const normalizedRaw = cmd.rawMatch.replace(/\s+/g, ' ').trim();
                const looseWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
                while (true) {
                    const node = looseWalker.nextNode() as Text | null;
                    if (!node) break;
                    const content = node.nodeValue || '';
                    const normalizedContent = content.replace(/\s+/g, ' ');
                    const idx = normalizedContent.indexOf(normalizedRaw);
                    if (idx !== -1) {
                        targetTextNode = node;
                        matchIndex = idx;
                        matchLength = Math.min(cmd.rawMatch.length, content.length - idx);
                        break;
                    }
                }
            }

            if (!targetTextNode || !targetTextNode.parentNode || matchIndex === -1) {
                continue;
            }

            const parentNode = targetTextNode.parentNode;
            const textContent = targetTextNode.nodeValue || '';
            const beforeText = textContent.substring(0, matchIndex);
            const afterText = textContent.substring(matchIndex + matchLength);

            const slotElement = document.createElement('div');
            slotElement.className = 'da-floor-slot';
            slotElement.setAttribute('data-instruction-index', String(cmd.instructionIndex));

            const fragment = document.createDocumentFragment();
            if (beforeText) {
                fragment.appendChild(document.createTextNode(beforeText));
            }
            fragment.appendChild(slotElement);
            if (afterText) {
                fragment.appendChild(document.createTextNode(afterText));
            }

            parentNode.replaceChild(fragment, targetTextNode);
            slotsMap.set(cmd.instructionIndex, slotElement);
        }

        return slotsMap;
    }

    /**
     * 处理消息中的角色与服装档案块：折叠原文并展示为轻量胶囊徽标。
     *
     * @param container 消息文本宿主 DOM 容器 (.mes_text)
     * @param rawMes 消息原文
     * @returns 提取到的档案条目列表
     */
    private decorateArchiveBlocks(
        container: HTMLElement,
        rawMes: string
    ): ExtractedArchiveItem[] {
        const settings = settingsStore.getSettings();
        if (!settings.enabled) {
            return [];
        }

        const extractionCfg = settings.materialConfig?.extraction;
        if (
            extractionCfg?.enabled === false ||
            (!extractionCfg?.autoDetect && !extractionCfg?.collapseInFloor)
        ) {
            return [];
        }
        const archives = extractArchivesFromText(rawMes, extractionCfg);

        // 清理旧的胶囊容器
        const oldBadgeBar = container.querySelector('.da-floor-archive-badges');
        if (oldBadgeBar) {
            oldBadgeBar.remove();
        }

        if (archives.length === 0) {
            return [];
        }

        const shouldCollapse = extractionCfg?.collapseInFloor !== false;
        if (shouldCollapse) {
            // 1. 移除消息正文中的档案块文本（支持单文本节点以及被换行或段落分隔的多节点内容）
            for (const arch of archives) {
                let replacedInSingleNode = false;
                const singleWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
                while (true) {
                    const node = singleWalker.nextNode() as Text | null;
                    if (!node) break;
                    const val = node.nodeValue || '';
                    if (val.includes(arch.rawBlock)) {
                        node.nodeValue = val.replace(arch.rawBlock, '').trim();
                        replacedInSingleNode = true;
                        break;
                    }
                }

                if (!replacedInSingleNode) {
                    const sTag =
                        (arch.kind === 'character' ? extractionCfg?.charStartTag : extractionCfg?.outfitStartTag) ||
                        (arch.kind === 'character' ? '<角色>' : '<服装>');
                    const eTag =
                        (arch.kind === 'character' ? extractionCfg?.charEndTag : extractionCfg?.outfitEndTag) ||
                        (arch.kind === 'character' ? '</角色>' : '</服装>');

                    const allTextNodes: Text[] = [];
                    const multiWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
                    while (true) {
                        const node = multiWalker.nextNode() as Text | null;
                        if (!node) break;
                        allTextNodes.push(node);
                    }

                    let startNodeIdx = -1;
                    let endNodeIdx = -1;
                    for (let i = 0; i < allTextNodes.length; i++) {
                        if (startNodeIdx === -1 && allTextNodes[i].nodeValue?.includes(sTag)) {
                            startNodeIdx = i;
                        }
                        if (startNodeIdx !== -1 && allTextNodes[i].nodeValue?.includes(eTag)) {
                            endNodeIdx = i;
                            break;
                        }
                    }

                    if (startNodeIdx !== -1 && endNodeIdx !== -1) {
                        const startNode = allTextNodes[startNodeIdx];
                        const endNode = allTextNodes[endNodeIdx];

                        if (startNodeIdx === endNodeIdx) {
                            const val = startNode.nodeValue || '';
                            const sPos = val.indexOf(sTag);
                            const ePos = val.indexOf(eTag, sPos);
                            if (sPos !== -1 && ePos !== -1) {
                                startNode.nodeValue = val.slice(0, sPos) + val.slice(ePos + eTag.length);
                            }
                        } else {
                            const startVal = startNode.nodeValue || '';
                            const sPos = startVal.indexOf(sTag);
                            if (sPos !== -1) {
                                startNode.nodeValue = startVal.slice(0, sPos);
                            }

                            for (let i = startNodeIdx + 1; i < endNodeIdx; i++) {
                                allTextNodes[i].nodeValue = '';
                            }

                            const endVal = endNode.nodeValue || '';
                            const ePos = endVal.indexOf(eTag);
                            if (ePos !== -1) {
                                endNode.nodeValue = endVal.slice(ePos + eTag.length);
                            }
                        }
                    }
                }
            }

            // 2. 挂载轻量可点击胶囊徽标栏
            const badgeBar = document.createElement('div');
            badgeBar.className = 'da-floor-archive-badges';
            badgeBar.style.display = 'flex';
            badgeBar.style.flexWrap = 'wrap';
            badgeBar.style.gap = '6px';
            badgeBar.style.marginTop = '8px';

            for (const arch of archives) {
                const firstAlias = arch.aliases.split('|')[0]?.trim() || '';
                const labelSuffix =
                    firstAlias && firstAlias.toLowerCase() !== arch.name.toLowerCase()
                        ? ` (${firstAlias})`
                        : '';
                const badge = document.createElement('button');
                badge.type = 'button';
                badge.className = 'da-btn da-btn--secondary da-btn--sm da-floor-archive-badge';
                badge.textContent =
                    arch.kind === 'character'
                        ? `👤 角色档案: ${arch.name}${labelSuffix}`
                        : `👗 服装档案: ${arch.name}${labelSuffix}`;
                badge.title = '点击查看或导入该楼层提取的角色/服装档案';
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openArchiveConfirmModal({ items: archives });
                });
                badgeBar.appendChild(badge);
            }

            container.appendChild(badgeBar);
        }

        return archives;
    }

    /**
     * 检测指定楼层是否包含角色或服装档案，并在满足自动检测条件时弹出即时确认面板。
     *
     * @remarks
     * 宿主时序技术约束：
     * 1. 仅对非用户回复且非开场白的普通 AI 回复触发；
     * 2. 利用 `chatId_messageId_swipeId_archives` 联合签名进行已弹窗去重，防止消息重绘或滚动时重复弹出确认框；
     * 3. 采用即时弹出设计，不设后台堆积队列，避免多轮对话产生确认堆栈。
     *
     * @param messageId 目标消息楼层 ID
     * @param options 可选确认/关闭回调
     * @returns 是否唤出了档案确认弹窗
     */
    public inspectAndShowArchiveModal(
        messageId: number,
        options?: { onFinished?: () => void }
    ): boolean {
        const hostContext = window.SillyTavern?.getContext?.();
        if (!hostContext || !Array.isArray(hostContext.chat)) {
            return false;
        }
        const message = hostContext.chat[messageId];
        if (!message || message.is_user || typeof message.mes !== 'string') {
            return false;
        }
        const settings = settingsStore.getSettings();
        if (!settings.enabled) {
            return false;
        }

        const extractionCfg = settings.materialConfig?.extraction;
        if (extractionCfg?.enabled === false || extractionCfg?.autoDetect === false) {
            return false;
        }
        const archives = extractArchivesFromText(message.mes, extractionCfg);
        if (archives.length === 0) {
            return false;
        }
        const chatId = hostContext.chatId || 'default_chat';
        const swipeId = message.swipe_id ?? 0;
        const sig = `${chatId}_${messageId}_${swipeId}_${archives
            .map((a) => `${a.kind}:${a.name}:${a.baseTrait}`)
            .join('|')}`;
        if (!this.promptedArchiveKeys.has(sig)) {
            // 控制集合容量上限，防止跨会话无限增长
            if (this.promptedArchiveKeys.size >= 200) {
                const first = this.promptedArchiveKeys.values().next().value;
                if (first) {
                    this.promptedArchiveKeys.delete(first);
                }
            }
            this.promptedArchiveKeys.add(sig);

            let finishedCalled = false;
            const finishOnce = () => {
                if (finishedCalled) return;
                finishedCalled = true;
                options?.onFinished?.();
            };

            const sampleNames = archives
                .slice(0, 3)
                .map((a) => a.name)
                .join('、');
            const suffix = archives.length > 3 ? ` 等共 ${archives.length} 条` : '';

            // 两阶段确认：先简要询问是否更新导入，确认后再打开完整差异对比面板
            void ConfirmDialog.confirm({
                title: '检测到素材档案',
                message: `当前消息中检测到 ${sampleNames}${suffix}，是否导入或更新至素材库？`,
                confirmText: '检视并导入',
                cancelText: '忽略',
            }).then((confirmed) => {
                if (confirmed) {
                    openArchiveConfirmModal({
                        items: archives,
                        onConfirmed: finishOnce,
                        onClose: finishOnce,
                    });
                } else {
                    finishOnce();
                }
            });
            return true;
        }
        return false;
    }

    /**
     * 扫描并处理指定 ID 的消息楼层：解析角色/服装档案、解析生图指令、挂载动作按钮与呈现生成图片。
     *
     * @param messageId 目标消息楼层 ID
     */
    public decorateMessage(messageId: number): Promise<void> {
        const inFlight = this.inFlightDecorations.get(messageId);
        if (inFlight) {
            return inFlight;
        }

        const decorationPromise = (async () => {
            try {
                await this.performDecorateMessage(messageId);
            } finally {
                this.inFlightDecorations.delete(messageId);
            }
        })();

        this.inFlightDecorations.set(messageId, decorationPromise);
        return decorationPromise;
    }

    /**
     * 执行指定楼层的实际装饰解析与 DOM 挂载逻辑。
     *
     * @param messageId 目标消息楼层 ID
     */
    private async performDecorateMessage(messageId: number): Promise<void> {
        if (typeof document === 'undefined') {
            return;
        }

        const hostContext = window.SillyTavern?.getContext?.();
        if (!hostContext || !Array.isArray(hostContext.chat)) {
            return;
        }

        const message = hostContext.chat[messageId];
        if (!message || typeof message.mes !== 'string') {
            return;
        }

        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageDom) {
            return;
        }

        const targetContainer = (messageDom.querySelector('.mes_text') || messageDom) as HTMLElement;
        const chatId = hostContext.chatId || 'default_chat';
        const swipeId = message.swipe_id ?? 0;

        // 1. 检测并处理楼层中的角色与服装档案块（折叠胶囊）
        this.decorateArchiveBlocks(targetContainer, message.mes);

        // 2. 提取消息正文中的生图指令标签
        const commands = promptPipeline.extractCommands(message.mes);
        if (commands.length === 0) {
            return;
        }

        // 3. 将正文中的指令文本拆分替换为楼层生图容器
        const slotsMap = this.replaceCommandsWithSlots(targetContainer, commands);

        // 4. 遍历指令挂载楼层容器与动作按钮
        const settings = settingsStore.getSettings();
        const hideButtonOnDone = settings.ui?.floorButton?.hideOnDone ?? false;

        for (const cmd of commands) {
            let slotElement = slotsMap.get(cmd.instructionIndex);
            const slotKey = this.buildSlotKey(chatId, messageId, swipeId, cmd.instructionIndex);
            const target: SlotMountTarget = {
                chatId,
                messageId,
                swipeId,
                instructionIndex: cmd.instructionIndex,
            };

            const entry = sessionLifecycle.getSlotEntry(target);
            const activeTask = generationOrchestrator.getActiveTaskByTarget(target);
            const hasSlotEntry = Boolean(entry?.imageId || entry?.imageUrl);

            // 结构补偿挂载：若 Markdown 语法导致指令未能成功替换，按已有图片记录在末尾追加容器
            if (!slotElement) {
                const existing = targetContainer.querySelector(
                    `.da-floor-slot[data-instruction-index="${cmd.instructionIndex}"]`
                ) as HTMLElement | null;
                if (existing) {
                    slotElement = existing;
                } else if (hasSlotEntry || activeTask) {
                    slotElement = document.createElement('div');
                    slotElement.className = 'da-floor-slot da-floor-slot--appended';
                    slotElement.setAttribute('data-instruction-index', String(cmd.instructionIndex));
                    targetContainer.appendChild(slotElement);
                } else {
                    slotElement = targetContainer;
                }
                slotsMap.set(cmd.instructionIndex, slotElement);
            }

            let hasRenderedImage = false;
            if (hasSlotEntry) {
                // 渲染楼层图片，若图片正在重新生成中则添加相应样式
                await this.renderImageToFloor(messageId, entry!.imageId, cmd.instructionIndex, entry!.imageUrl, chatId, swipeId);
                hasRenderedImage = this.activeImageContainers.has(slotKey);
                if (hasRenderedImage && activeTask) {
                    const imgEl = slotElement.querySelector('.da-floor-image');
                    imgEl?.classList.add('da-floor-image--regenerating');
                }
            } else if (activeTask) {
                this.renderSkeletonToFloor(messageId, cmd.instructionIndex, chatId, swipeId);
            }

            // 若配置了出图后隐藏按钮，且当前已渲染图片且无活跃任务，则隐藏按钮
            if (hasRenderedImage && hideButtonOnDone && !activeTask) {
                const existingBtn = this.activeButtons.get(slotKey);
                if (existingBtn) {
                    existingBtn.dispose();
                    this.activeButtons.delete(slotKey);
                }
                continue;
            }

            let button = this.activeButtons.get(slotKey);
            if (!button) {
                button = new FloorActionButton({
                    chatId,
                    messageId,
                    instructionIndex: cmd.instructionIndex,
                    onTrigger: async () => {
                        const currentSettings = settingsStore.getSettings();
                        const check = validateCurrentPresetAssets(currentSettings.activeProvider as ProviderType);
                        if (!check.valid) {
                            const confirmed = await ConfirmDialog.confirm({
                                title: '模型缺失确认',
                                message: `当前生图预设引用的部分模型未在服务端检测到：\n- ${check.missing.join('\n- ')}\n\n是否仍继续尝试生图？`,
                                confirmText: '继续生图',
                                cancelText: '取消',
                            });
                            if (!confirmed) {
                                return false;
                            }
                        }

                        const submitOptions: SubmitTaskOptions = {
                            rawPrompt: cmd.promptText,
                            providerType: currentSettings.activeProvider as ProviderType,
                            target,
                        };

                        const imgEl = slotElement.querySelector('.da-floor-image');
                        if (imgEl) {
                            imgEl.classList.add('da-floor-image--regenerating');
                        } else {
                            this.renderSkeletonToFloor(messageId, cmd.instructionIndex, chatId, swipeId);
                        }

                        try {
                            return await generationOrchestrator.submitTask(submitOptions);
                        } catch (err: unknown) {
                            const errMessage = err instanceof Error ? err.message : String(err);
                            logger.error(`[MessageDecorator] 任务提交失败: ${errMessage}`);
                            this.removeSkeleton(messageId, cmd.instructionIndex, chatId, swipeId);
                            imgEl?.classList.remove('da-floor-image--regenerating');
                            Toast.error(errMessage);
                            throw err;
                        }
                    },
                    onCancel: () => {
                        const task = generationOrchestrator.getActiveTaskByTarget(target);
                        if (task) {
                            generationOrchestrator.cancelTask(task.taskId, '用户主动取消');
                        }
                        const imgEl = slotElement.querySelector('.da-floor-image');
                        imgEl?.classList.remove('da-floor-image--regenerating');
                        this.removeSkeleton(messageId, cmd.instructionIndex, chatId, swipeId);
                    },
                });

                this.activeButtons.set(slotKey, button);
                slotElement.appendChild(button.element);
            }

            // 同步按钮状态：生成中、已完成或就绪
            if (activeTask) {
                button.element.style.display = '';
                button.setState(activeTask.status === 'pending' ? 'pending' : 'generating');
            } else if (hasRenderedImage) {
                button.element.style.display = hideButtonOnDone ? 'none' : '';
                button.setState('done');
            } else {
                button.element.style.display = '';
                button.setState('ready');
            }
        }
    }

    /**
     * 触发指定楼层中所有就绪状态生图按钮的原生点击事件。
     *
     * @remarks
     * 用于在 AI 回复完成且开启自动生图时，模拟原生点击唤起生图流程，
     * 确保自动生图与手动点击完全复用 FloorActionButton.onTrigger 调度逻辑，保持楼层容器与生图任务严格映射。
     *
     * @param messageId 目标消息楼层 ID
     */
    public triggerReadyButtons(messageId: number): void {
        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageDom) {
            return;
        }

        const buttons = messageDom.querySelectorAll<HTMLButtonElement>('.da-floor-action-btn');
        for (const btn of buttons) {
            const state = btn.getAttribute('data-state');
            if (state === 'ready') {
                btn.click();
            }
        }
    }

    /**
     * 在楼层容器内挂载骨架屏。
     */
    public renderSkeletonToFloor(
        messageId: number,
        instructionIndex = 0,
        chatId?: string,
        swipeId?: number
    ): void {
        if (typeof document === 'undefined') {
            return;
        }

        const hostContext = window.SillyTavern?.getContext?.();
        const effectiveChatId = chatId || hostContext?.chatId || 'default_chat';
        const effectiveSwipeId = swipeId ?? (hostContext?.chat?.[messageId]?.swipe_id ?? 0);
        const containerKey = this.buildSlotKey(effectiveChatId, messageId, effectiveSwipeId, instructionIndex);

        if (this.activeSkeletons.has(containerKey) || this.activeImageContainers.has(containerKey)) {
            return;
        }

        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageDom) {
            return;
        }

        const slotElement = messageDom.querySelector(
            `.da-floor-slot[data-instruction-index="${instructionIndex}"]`
        ) as HTMLElement | null;
        if (!slotElement) {
            return;
        }

        const skeleton = document.createElement('div');
        skeleton.className = 'da-floor-image-skeleton';
        skeleton.setAttribute('data-slot-skeleton', containerKey);

        const iconSpan = document.createElement('span');
        iconSpan.textContent = '🎨 正在生成图像...';
        skeleton.appendChild(iconSpan);

        slotElement.insertBefore(skeleton, slotElement.firstChild);
        this.activeSkeletons.set(containerKey, skeleton);
    }

    /**
     * 移除指定楼层容器的骨架屏。
     */
    public removeSkeleton(
        messageId: number,
        instructionIndex = 0,
        chatId?: string,
        swipeId?: number
    ): void {
        const hostContext = window.SillyTavern?.getContext?.();
        const effectiveChatId = chatId || hostContext?.chatId || 'default_chat';
        const effectiveSwipeId = swipeId ?? (hostContext?.chat?.[messageId]?.swipe_id ?? 0);
        const containerKey = this.buildSlotKey(effectiveChatId, messageId, effectiveSwipeId, instructionIndex);

        const skeleton = this.activeSkeletons.get(containerKey);
        if (skeleton) {
            skeleton.remove();
            this.activeSkeletons.delete(containerKey);
        }
    }

    /**
     * 在消息楼层中挂载图像展示容器。
     *
     * @param messageId 目标消息楼层 ID
     * @param imageId 图像唯一标识符
     * @param instructionIndex 指令序号 (默认 0)
     * @param serverImageUrl 可选的服务端静态相对路径
     * @param chatId 可选的目标会话 ID（未传时回退至当前激活会话）
     * @param swipeId 可选的滑动分支 ID（未传时回退至当前激活分支）
     */
    public async renderImageToFloor(
        messageId: number,
        imageId?: string,
        instructionIndex = 0,
        serverImageUrl?: string,
        chatId?: string,
        swipeId?: number
    ): Promise<void> {
        if (typeof document === 'undefined') {
            return;
        }

        const hostContext = window.SillyTavern?.getContext?.();
        const effectiveChatId = chatId || hostContext?.chatId || 'default_chat';
        const effectiveSwipeId = swipeId ?? (hostContext?.chat?.[messageId]?.swipe_id ?? 0);
        const containerKey = this.buildSlotKey(effectiveChatId, messageId, effectiveSwipeId, instructionIndex);

        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageDom) {
            return;
        }

        const textContainer = (messageDom.querySelector('.mes_text') || messageDom) as HTMLElement;

        // 解析可用图像展示地址
        let displayUrl = serverImageUrl;
        if (!displayUrl && imageId) {
            displayUrl = urlPool.getUrl(imageId);
            if (!displayUrl) {
                const blob = await imageStorage.getImageBlob(imageId);
                if (blob) {
                    displayUrl = urlPool.createUrl(imageId, blob);
                }
            }
        }

        if (!displayUrl) {
            const target: SlotMountTarget = {
                chatId: effectiveChatId,
                messageId,
                swipeId: effectiveSwipeId,
                instructionIndex,
            };
            const activeTask = generationOrchestrator.getActiveTaskByTarget(target);
            if (activeTask) {
                this.renderSkeletonToFloor(messageId, instructionIndex, effectiveChatId, effectiveSwipeId);
            } else {
                // 无图且无活跃任务：清除骨架屏与旧图片容器，重置按钮为就绪状态
                this.removeSkeleton(messageId, instructionIndex, effectiveChatId, effectiveSwipeId);
                const existingContainer = this.activeImageContainers.get(containerKey);
                if (existingContainer) {
                    this.activeSlotCleanups.get(containerKey)?.();
                    this.activeSlotCleanups.delete(containerKey);
                    existingContainer.remove();
                    this.activeImageContainers.delete(containerKey);
                }
                this.activeSlotStates.delete(containerKey);
                const slotElement = messageDom.querySelector(
                    `.da-floor-slot[data-instruction-index="${instructionIndex}"]`
                );
                slotElement?.querySelector('.da-floor-image-container')?.remove();
                slotElement?.querySelector('.da-floor-image-skeleton')?.remove();

                const button = this.activeButtons.get(containerKey);
                if (button) {
                    button.element.style.display = '';
                    button.setState('ready');
                }
            }
            return;
        }

        // 图像已就绪，移除骨架屏
        this.removeSkeleton(messageId, instructionIndex, effectiveChatId, effectiveSwipeId);

        const settings = settingsStore.getSettings();
        const displayCfg = settings.ui?.imageDisplay;
        const initialRecord = imageId ? await imageStorage.getImageRecord(imageId) : undefined;
        const initialFavorited = Boolean(initialRecord?.favorited);

        // 静态文件加载异常回退辅助函数：若服务端静态路径失效或返回 404，回退至本地 IndexedDB 缓存
        const bindImageFallback = (img: HTMLImageElement) => {
            img.onerror = async () => {
                if (imageId && !img.dataset.fallbackApplied) {
                    img.dataset.fallbackApplied = 'true';
                    let localUrl = urlPool.getUrl(imageId);
                    if (!localUrl) {
                        const blob = await imageStorage.getImageBlob(imageId);
                        if (blob) {
                            localUrl = urlPool.createUrl(imageId, blob);
                        }
                    }
                    if (localUrl && img.src !== localUrl) {
                        logger.info(`服务端静态图像加载异常，已回退至本地数据库缓存 [${imageId}]`);
                        img.src = localUrl;
                        const state = this.activeSlotStates.get(containerKey);
                        if (state) {
                            state.displayUrl = localUrl;
                        }
                    }
                }
            };
        };

        // 已有图片容器时预载图片地址、平滑替换并同步容器状态
        const existingContainer = this.activeImageContainers.get(containerKey);
        const existingImg = existingContainer?.querySelector('.da-floor-image') as HTMLImageElement | null;
        if (existingContainer && existingImg) {
            delete existingImg.dataset.fallbackApplied;
            bindImageFallback(existingImg);

            // 清理当前楼层容器上一次挂起的未决清理器（如上一轮重绘预载器）
            this.activeSlotCleanups.get(containerKey)?.();

            // 后台静默预载，待图像完成加载后再切换 src 并移除遮罩，避免白屏闪烁
            const preloader = new Image();
            let applied = false;
            let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
            const cleanupPreloader = () => {
                if (fallbackTimer !== null) {
                    clearTimeout(fallbackTimer);
                    fallbackTimer = null;
                }
                preloader.onload = null;
                preloader.onerror = null;
            };

            const applySwap = () => {
                if (applied) return;
                applied = true;
                cleanupPreloader();
                existingImg.src = displayUrl;
                existingImg.classList.remove('da-floor-image--regenerating');
            };

            preloader.onload = applySwap;
            preloader.onerror = applySwap;
            if (typeof preloader.decode === 'function') {
                preloader.decode().then(applySwap).catch(applySwap);
            }
            preloader.src = displayUrl;
            if (preloader.complete) {
                applySwap();
            } else {
                // 超时容错上限 (8000ms)：若异常网络导致未能在合理时间内触发完成或报错，避免永久停留在重绘遮罩状态
                fallbackTimer = setTimeout(applySwap, 8000);
            }

            this.activeSlotCleanups.set(containerKey, () => {
                cleanupPreloader();
                applied = true;
            });

            const existingState = this.activeSlotStates.get(containerKey);
            if (existingState) {
                existingState.target = {
                    chatId: effectiveChatId,
                    messageId,
                    swipeId: effectiveSwipeId,
                    instructionIndex,
                };
                existingState.imageId = imageId;
                existingState.displayUrl = displayUrl;
                existingState.syncFavUI(initialFavorited);
            }
            if (settings.saveToServer && !serverImageUrl && imageId) {
                const currentContext = window.SillyTavern?.getContext?.();
                void sessionLifecycle.ensureSlotServerImage({
                    chatId: currentContext?.chatId || 'default_chat',
                    messageId,
                    swipeId: currentContext?.chat?.[messageId]?.swipe_id ?? 0,
                    instructionIndex,
                });
            }
            logger.info(`已更新楼层 #${messageId} 图像 (序号: ${instructionIndex})`);
            return;
        }

        const isLightboxEnabled = settings.ui?.lightbox?.enabled ?? true;
        const isImageActionPanelEnabled = settings.ui?.imageActionPanel?.enabled ?? true;

        const favBtn = document.createElement('button');
        const slotState: FloorSlotState = {
            target: {
                chatId: effectiveChatId,
                messageId,
                swipeId: effectiveSwipeId,
                instructionIndex,
            },
            imageId,
            displayUrl,
            favorited: initialFavorited,
            syncFavUI: (fav: boolean) => {
                slotState.favorited = fav;
                favBtn.classList.toggle('is-active', fav);
                favBtn.title = fav ? '取消收藏' : '收藏图片';
                favBtn.innerHTML = renderIcon(fav ? 'starFilled' : 'star', 14);
            },
        };
        this.activeSlotStates.set(containerKey, slotState);

        // 1. 构建外层容器
        const imageContainer = document.createElement('div');
        imageContainer.className = 'da-floor-image-container';
        if (displayCfg?.align === 'center') {
            imageContainer.classList.add('da-floor-image-container--center');
        } else if (displayCfg?.align === 'flex-start') {
            imageContainer.classList.add('da-floor-image-container--left');
        } else if (displayCfg?.align === 'flex-end') {
            imageContainer.classList.add('da-floor-image-container--right');
        }

        // 2. 构建图片包装盒与图片节点
        const imageBox = document.createElement('div');
        imageBox.className = 'da-floor-image-box';
        if (displayCfg?.rounded === false) {
            imageBox.style.borderRadius = '0px';
        }

        const imgEl = document.createElement('img');
        imgEl.className = 'da-floor-image';
        bindImageFallback(imgEl);
        imgEl.src = displayUrl;
        imgEl.alt = 'AI 生成图像';
        imgEl.loading = 'lazy';

        let justLongPressed = false;

        if (isLightboxEnabled) {
            imgEl.style.cursor = 'zoom-in';
            imgEl.title = '点击查看大图';
            // 左键/单触点击图片放大全屏预览
            imgEl.addEventListener('click', (e) => {
                if (justLongPressed) {
                    justLongPressed = false;
                    e.stopPropagation();
                    e.preventDefault();
                    return;
                }
                e.stopPropagation();
                lightboxModal.open(slotState.displayUrl, {
                    imageId: slotState.imageId,
                    favorited: slotState.favorited,
                    onFavoriteChange: (newFav) => {
                        slotState.syncFavUI(newFav);
                    },
                    onEdit: isImageActionPanelEnabled
                        ? () => {
                              void this.openImageActionPanel(
                                  messageId,
                                  instructionIndex,
                                  slotState.imageId,
                                  slotState.displayUrl
                              );
                          }
                        : undefined,
                });
            });
        }

        if (displayCfg?.maxHeight) {
            imgEl.style.maxHeight = `${displayCfg.maxHeight}px`;
        }
        if (displayCfg?.maxWidthPct) {
            imgEl.style.maxWidth = `${displayCfg.maxWidthPct}%`;
        }
        if (displayCfg?.objectFit) {
            imgEl.style.objectFit = displayCfg.objectFit;
        }

        // 防窥模糊处理
        if (displayCfg?.autoBlur) {
            imgEl.style.filter = 'blur(16px)';
            imgEl.style.transition = 'filter 0.3s ease';
            imageBox.addEventListener('mouseenter', () => {
                imgEl.style.filter = 'none';
            });
            imageBox.addEventListener('mouseleave', () => {
                imgEl.style.filter = 'blur(16px)';
            });
        }

        if (isImageActionPanelEnabled) {
            // 桌面端鼠标右键呼出图片操作面板
            imageBox.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                void this.openImageActionPanel(
                    messageId,
                    instructionIndex,
                    slotState.imageId,
                    slotState.displayUrl
                );
            });

            // 移动端长按手势呼出图片操作面板 (500ms，带手势防误触与点击穿透防护)
            let touchTimer: ReturnType<typeof setTimeout> | null = null;
            let clickSuppressionTimer: ReturnType<typeof setTimeout> | null = null;
            let touchStartX = 0;
            let touchStartY = 0;

            const cancelTouch = () => {
                if (touchTimer) {
                    clearTimeout(touchTimer);
                    touchTimer = null;
                }
            };

            const cancelAllGestures = () => {
                cancelTouch();
                if (clickSuppressionTimer) {
                    clearTimeout(clickSuppressionTimer);
                    clickSuppressionTimer = null;
                }
                justLongPressed = false;
            };

            imageBox.addEventListener(
                'touchstart',
                (e) => {
                    if (e.touches.length !== 1) return;
                    justLongPressed = false;
                    const touch = e.touches[0];
                    touchStartX = touch.clientX;
                    touchStartY = touch.clientY;

                    touchTimer = setTimeout(() => {
                        touchTimer = null;
                        justLongPressed = true;
                        void this.openImageActionPanel(
                            messageId,
                            instructionIndex,
                            slotState.imageId,
                            slotState.displayUrl
                        );
                    }, 500);
                },
                { passive: true }
            );

            imageBox.addEventListener(
                'touchmove',
                (e) => {
                    if (!touchTimer) return;
                    const touch = e.touches[0];
                    if (touch) {
                        const dx = Math.abs(touch.clientX - touchStartX);
                        const dy = Math.abs(touch.clientY - touchStartY);
                        // 允许手指 10px 范围内的微颤，超出 10px 视为用户滚动页面并取消长按
                        if (dx > 10 || dy > 10) {
                            cancelTouch();
                        }
                    }
                },
                { passive: true }
            );

            imageBox.addEventListener('touchend', () => {
                cancelTouch();
                if (justLongPressed) {
                    // 延迟重置长按状态，确保吸收紧随其后的移动端合成 click 事件
                    if (clickSuppressionTimer) clearTimeout(clickSuppressionTimer);
                    clickSuppressionTimer = setTimeout(() => {
                        justLongPressed = false;
                        clickSuppressionTimer = null;
                    }, 300);
                }
            });

            imageBox.addEventListener('touchcancel', cancelTouch, { passive: true });

            this.activeSlotCleanups.set(containerKey, cancelAllGestures);
        }

        imageBox.appendChild(imgEl);

        // 3. 构建右上角统一悬浮操作胶囊（收藏、元信息、下载图片）
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'da-floor-image__actions';

        // 3.1 收藏按钮
        favBtn.type = 'button';
        favBtn.className = 'da-floor-image__action-btn';
        slotState.syncFavUI(initialFavorited);
        favBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (slotState.imageId) {
                const nextFav = await imageStorage.toggleFavorite(slotState.imageId);
                slotState.syncFavUI(nextFav);
                Toast.info(nextFav ? '已加入收藏' : '已取消收藏');
            }
        });
        actionsContainer.appendChild(favBtn);

        // 3.2 元信息按钮 (!)
        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'da-floor-image__action-btn';
        infoBtn.title = '查看生成元信息';
        infoBtn.innerHTML = renderIcon('info', 14);
        infoBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentRecord = slotState.imageId
                ? await imageStorage.getImageRecord(slotState.imageId)
                : undefined;
            imageInfoModal.open({
                record: currentRecord,
                metadata: currentRecord?.metadata,
                imageUrl: slotState.displayUrl,
                onEdit: isImageActionPanelEnabled
                    ? () => {
                          void this.openImageActionPanel(
                              messageId,
                              instructionIndex,
                              slotState.imageId,
                              slotState.displayUrl
                          );
                      }
                    : undefined,
            });
        });
        actionsContainer.appendChild(infoBtn);

        // 3.3 下载图片按钮 (下箭头)
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'da-floor-image__action-btn';
        downloadBtn.title = '下载图片';
        downloadBtn.innerHTML = renderIcon('download', 14);
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                const a = document.createElement('a');
                a.href = slotState.displayUrl;
                const safePrefix = slotState.imageId ? slotState.imageId.slice(0, 8) : Date.now();
                a.download = `st_draw_${safePrefix}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            } catch (err) {
                logger.error('下载图片异常:', err);
            }
        });
        actionsContainer.appendChild(downloadBtn);

        imageBox.appendChild(actionsContainer);
        imageContainer.appendChild(imageBox);

        // 4. 定位对应的 .da-floor-slot 元素插入图片展示容器
        const slotElement = messageDom.querySelector(
            `.da-floor-slot[data-instruction-index="${instructionIndex}"]`
        ) as HTMLElement | null;

        if (slotElement) {
            slotElement.insertBefore(imageContainer, slotElement.firstChild);
        } else {
            textContainer.appendChild(imageContainer);
        }

        this.activeImageContainers.set(containerKey, imageContainer);

        // 5. 若配置开启了 saveToServer 且尚未转存，触发静默后台服务端转存
        if (settings.saveToServer && !serverImageUrl && imageId) {
            const currentContext = window.SillyTavern?.getContext?.();
            void sessionLifecycle.ensureSlotServerImage({
                chatId: currentContext?.chatId || 'default_chat',
                messageId,
                swipeId: currentContext?.chat?.[messageId]?.swipe_id ?? 0,
                instructionIndex,
            });
        }

        logger.info(`已成功在楼层 #${messageId} 挂载生成图像 (序号: ${instructionIndex})`);
    }

    /**
     * 打开楼层图像编辑与操作面板。
     *
     * @param messageId 宿主消息楼层 ID
     * @param instructionIndex 指令序号
     * @param imageId 可选图像全局唯一标识
     * @param displayUrl 可选图像展示地址
     */
    public async openImageActionPanel(
        messageId: number,
        instructionIndex: number,
        imageId?: string,
        displayUrl?: string
    ): Promise<void> {
        const record = imageId ? await imageStorage.getImageRecord(imageId) : undefined;
        const hostContext = window.SillyTavern?.getContext?.();
        const currentChatId = hostContext?.chatId || 'default_chat';
        const targetMessage = hostContext?.chat?.[messageId];
        const swipeId = targetMessage?.swipe_id ?? 0;

        // 优先提取原始指令提示词，避免二次载入已包含预设前后缀与 LoRA 的最终生成词
        let rawPrompt = '';
        if (targetMessage && typeof targetMessage.mes === 'string') {
            const commands = promptPipeline.extractCommands(targetMessage.mes);
            const matched = commands.find((c) => c.instructionIndex === instructionIndex);
            if (matched) {
                rawPrompt = matched.promptText;
            }
        }

        imageActionPanel.open({
            messageId,
            instructionIndex,
            imageId,
            imageUrl: displayUrl,
            prompt: rawPrompt || record?.metadata?.prompt || '',
            negativePrompt: record?.metadata?.negativePrompt || '',
            record,
            onRegenerate: async (newPrompt, newNegPrompt) => {
                await this.regenerateSlot(
                    { chatId: currentChatId, messageId, swipeId, instructionIndex },
                    newPrompt,
                    newNegPrompt
                );
            },
            onInpaint: async (inpaintData) => {
                await this.regenerateSlot(
                    { chatId: currentChatId, messageId, swipeId, instructionIndex },
                    inpaintData.prompt,
                    inpaintData.negativePrompt,
                    {
                        mode: 'inpaint',
                        sourceImage: inpaintData.initImage,
                        maskImage: inpaintData.maskImage,
                        denoiseStrength: inpaintData.denoiseStrength,
                        maskBlur: inpaintData.maskBlur,
                        parentImageId: imageId,
                    }
                );
            },
        });
    }

    /**
     * 处理宿主候选分支滑动切换 (Swipe)，对齐分支图片数据并更新对应分支的指令与图片显示。
     *
     * @param messageId 目标消息楼层 ID
     * @param _swipeId 分支滑动索引
     */
    public async handleMessageSwiped(messageId: number, _swipeId?: number): Promise<void> {
        sessionLifecycle.syncSwipeState(messageId);
        this.handleMessageDeleted(messageId);
        await this.decorateMessage(messageId);
    }

    /**
     * 处理消息正文重新编辑事件，同步更新提取的生图提示词与按钮。
     *
     * @remarks
     * 区分指令结构变化：
     * - 若正文中指令数量发生变动（增删指令，导致后续序号前移或结构重排），视为新消息结构，
     *   取消进行中任务并清空当前分支已持久化的图片记录，各位置重置为全新就绪态；
     * - 若指令数量保持一致（仅修改正文或指令内部提示词文本），视为同一消息结构，
     *   原样保留已生成的图片与完成状态，点击重新生成时直接复用新提示词。
     *
     * @param messageId 目标消息楼层 ID
     */
    public async handleMessageEdited(messageId: number): Promise<void> {
        const hostContext = window.SillyTavern?.getContext?.();
        const message = hostContext?.chat?.[messageId];
        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        const oldSlotCount = messageDom ? messageDom.querySelectorAll('.da-floor-slot').length : 0;

        if (message && typeof message.mes === 'string') {
            const newCommands = promptPipeline.extractCommands(message.mes);
            const swipeId = message.swipe_id ?? 0;
            const existingDrawings =
                (Array.isArray(message.swipe_info) && message.swipe_info[swipeId]?.extra?.drawings) ||
                message.extra?.drawings ||
                {};
            const existingCount = Object.keys(existingDrawings).length;

            const isStructureChanged =
                (oldSlotCount > 0 && oldSlotCount !== newCommands.length) ||
                (existingCount > 0 && existingCount !== newCommands.length);

            if (isStructureChanged) {
                const chatId = hostContext?.chatId || 'default_chat';
                generationOrchestrator.cancelTasksBySwipe(chatId, messageId, swipeId);
                sessionLifecycle.clearMessageSlotDrawings(messageId);
            }
        }

        this.handleMessageDeleted(messageId);
        await this.decorateMessage(messageId);
        this.inspectAndShowArchiveModal(messageId);
    }

    /**
     * 响应宿主 MESSAGE_DELETED 事件：
     * 由于宿主删除消息后会通过 updateViewMessageIds() 直接在已有 DOM 节点上更新后续 .mes 的 mesid 属性而不重绘 DOM，
     * 需清空旧索引绑定的按钮与图像容器，并按最新 mesid 重新挂载所有可见楼层。
     */
    public async resyncAfterMessageDeleted(): Promise<void> {
        this.clearCurrentButtons();
        await this.scanAllMessages();
    }

    /**
     * 处理消息删除事件，释放该楼层所有绑定的按钮与图片容器实例。
     *
     * @param messageId 被删除的消息楼层 ID，未指定则清理全部
     */
    public handleMessageDeleted(messageId?: number): void {
        if (typeof messageId !== 'number') {
            this.clearCurrentButtons();
            return;
        }

        this.inFlightDecorations.delete(messageId);

        const isTargetSlot = (key: string): boolean => {
            const parts = key.split(':');
            return parts.length === 4 && Number(parts[1]) === messageId;
        };

        for (const [key, btn] of this.activeButtons.entries()) {
            if (isTargetSlot(key)) {
                btn.dispose();
                this.activeButtons.delete(key);
            }
        }

        for (const [key, container] of this.activeImageContainers.entries()) {
            if (isTargetSlot(key)) {
                this.activeSlotCleanups.get(key)?.();
                this.activeSlotCleanups.delete(key);
                container.remove();
                this.activeImageContainers.delete(key);
                this.activeSlotStates.delete(key);
            }
        }

        for (const [key, skeleton] of this.activeSkeletons.entries()) {
            if (isTargetSlot(key)) {
                skeleton.remove();
                this.activeSkeletons.delete(key);
            }
        }
    }

    /**
     * 响应图片记录删除事件，清理受影响楼层的图片呈现并将按钮重置为就绪状态。
     * 若对应楼层图片在酒馆服务端存有备份地址，则平滑回退至服务端地址展示。
     * @param imageId 被删除的图像全局唯一标识符
     */
    public handleImageDeleted(imageId: string): void {
        const affectedEntries: Array<[string, FloorSlotState]> = [];
        for (const [key, slotState] of this.activeSlotStates.entries()) {
            if (slotState.imageId === imageId) {
                affectedEntries.push([key, slotState]);
            }
        }

        for (const [key, slotState] of affectedEntries) {
            const slotEntry = slotState.target
                ? sessionLifecycle.getSlotEntry(slotState.target)
                : undefined;
            const serverImageUrl = slotEntry?.imageUrl;

            if (serverImageUrl) {
                slotState.displayUrl = serverImageUrl;
                const container = this.activeImageContainers.get(key);
                const imgEl = container?.querySelector('.da-floor-image') as HTMLImageElement | null;
                if (imgEl && imgEl.src !== serverImageUrl) {
                    imgEl.src = serverImageUrl;
                }
                logger.info(`本地图库图像已删除，楼层图片已平滑切换至服务端备份: ${key} [${imageId}]`);
                continue;
            }

            this.activeSlotCleanups.get(key)?.();
            this.activeSlotCleanups.delete(key);
            this.activeSlotStates.delete(key);
            const container = this.activeImageContainers.get(key);
            if (container) {
                container.remove();
                this.activeImageContainers.delete(key);
            }

            const button = this.activeButtons.get(key);
            if (button) {
                button.element.style.display = '';
                button.setState('ready');
            }
            logger.info(`已同步重置被删除图像对应楼层图片容器: ${key} [${imageId}]`);
        }
    }

    /**
     * 获取当前活跃的动作按钮数量（用于状态监控与测试）。
     */
    public getActiveButtonCount(): number {
        return this.activeButtons.size;
    }

    /**
     * 获取当前活跃的图片容器数量（用于状态监控与测试）。
     */
    public getActiveContainerCount(): number {
        return this.activeImageContainers.size;
    }

    /**
     * 获取当前活跃的骨架屏数量（用于状态监控与测试）。
     */
    public getActiveSkeletonCount(): number {
        return this.activeSkeletons.size;
    }

    /**
     * 清理当前会话全部活跃的楼层按钮、展示容器与骨架占位。
     */
    public clearCurrentButtons(): void {
        this.inFlightDecorations.clear();
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }

        for (const cleanup of this.activeSlotCleanups.values()) {
            try {
                cleanup();
            } catch {
                // 忽略注销异常
            }
        }
        this.activeSlotCleanups.clear();

        for (const btn of this.activeButtons.values()) {
            try {
                btn.dispose();
            } catch {
                // 忽略注销异常
            }
        }
        this.activeButtons.clear();

        for (const container of this.activeImageContainers.values()) {
            try {
                container.remove();
            } catch {
                // 忽略注销异常
            }
        }
        this.activeImageContainers.clear();
        this.activeSlotStates.clear();

        for (const skeleton of this.activeSkeletons.values()) {
            try {
                skeleton.remove();
            } catch {
                // 忽略注销异常
            }
        }
        this.activeSkeletons.clear();
        this.promptedArchiveKeys.clear();
    }

    /**
     * 延迟调度扫描所有可见消息楼层（防抖等待宿主 DOM 渲染完成）。
     *
     * @param delayMs 防抖等待毫秒数，默认 200ms
     */
    public scheduleScanAllMessages(delayMs = 200): void {
        if (this.scanTimer !== null) {
            clearTimeout(this.scanTimer);
            this.scanTimer = null;
        }

        this.scanTimer = setTimeout(() => {
            this.scanTimer = null;
            void this.scanAllMessages();
        }, delayMs);
    }

    /**
     * 即时扫描当前会话可见楼层。
     * 若环境支持 IntersectionObserver，仅对进入视口附近区域的楼层动态挂载按钮与图片容器；
     * 否则执行同步扫描。
     */
    public async scanAllMessages(): Promise<void> {
        if (typeof document === 'undefined') {
            return;
        }

        const messageDoms = document.querySelectorAll('#chat .mes[mesid]');
        if (messageDoms.length === 0) {
            return;
        }

        if (typeof IntersectionObserver !== 'undefined') {
            if (this.intersectionObserver) {
                this.intersectionObserver.disconnect();
            }
            this.intersectionObserver = new IntersectionObserver(
                (entries) => {
                    for (const entry of entries) {
                        if (entry.isIntersecting) {
                            const target = entry.target as HTMLElement;
                            this.intersectionObserver?.unobserve(target);
                            const mesIdAttr = target.getAttribute('mesid');
                            if (mesIdAttr !== null) {
                                const messageId = parseInt(mesIdAttr, 10);
                                if (!Number.isNaN(messageId)) {
                                    void this.decorateMessage(messageId);
                                }
                            }
                        }
                    }
                },
                {
                    root: null,
                    rootMargin: '200px 0px',
                }
            );

            for (let i = 0; i < messageDoms.length; i++) {
                this.intersectionObserver.observe(messageDoms[i]);
            }
            return;
        }

        for (let i = 0; i < messageDoms.length; i++) {
            const mesIdAttr = messageDoms[i].getAttribute('mesid');
            if (mesIdAttr !== null) {
                const messageId = parseInt(mesIdAttr, 10);
                if (!Number.isNaN(messageId)) {
                    await this.decorateMessage(messageId);
                }
            }
        }
    }

    /**
     * 使用指定提示词对楼层中的特定位置发起重新生成请求。
     *
     * @param target 目标挂载位置坐标
     * @param newPrompt 编辑后的新提示词
     * @param newNegativePrompt 可选的负向提示词
     * @param extraParams 单次任务附加参数（如重新生成覆盖参数）
     */
    public async regenerateSlot(
        target: SlotMountTarget,
        newPrompt: string,
        newNegativePrompt?: string,
        extraParams?: Record<string, unknown>
    ): Promise<void> {
        const currentSettings = settingsStore.getSettings();
        const check = validateCurrentPresetAssets(currentSettings.activeProvider as ProviderType);
        if (!check.valid) {
            const confirmed = await ConfirmDialog.confirm({
                title: '模型缺失确认',
                message: `当前生图预设引用的部分模型未在服务端检测到：\n- ${check.missing.join('\n- ')}\n\n是否仍继续尝试生图？`,
                confirmText: '继续生图',
                cancelText: '取消',
            });
            if (!confirmed) {
                return;
            }
        }

        const mergedParams: Record<string, unknown> = {
            ...(extraParams || {}),
        };
        if (newNegativePrompt) {
            mergedParams.negativePrompt = newNegativePrompt;
        }

        const submitOptions: SubmitTaskOptions = {
            rawPrompt: newPrompt,
            providerType: currentSettings.activeProvider as ProviderType,
            target,
            parameters: Object.keys(mergedParams).length > 0 ? mergedParams : undefined,
        };

        const swipeId = target.swipeId ?? 0;
        const containerKey = this.buildSlotKey(target.chatId, target.messageId, swipeId, target.instructionIndex);
        const container = this.activeImageContainers.get(containerKey);
        const imgEl = container?.querySelector('.da-floor-image');
        if (imgEl) {
            imgEl.classList.add('da-floor-image--regenerating');
        } else {
            this.renderSkeletonToFloor(target.messageId, target.instructionIndex, target.chatId, swipeId);
        }

        try {
            await generationOrchestrator.submitTask(submitOptions);
        } catch (err: unknown) {
            const errMessage = err instanceof Error ? err.message : String(err);
            logger.error(`[MessageDecorator] 重新生成任务提交失败: ${errMessage}`);
            this.removeSkeleton(target.messageId, target.instructionIndex, target.chatId, swipeId);
            imgEl?.classList.remove('da-floor-image--regenerating');
            Toast.error(errMessage);
            throw err;
        }
    }

    /**
     * 释放所有已挂载的楼层组件与事件监听。
     */
    public dispose(): void {
        if (this.scanTimer !== null) {
            clearTimeout(this.scanTimer);
            this.scanTimer = null;
        }
        if (this.unbindEventListener) {
            this.unbindEventListener();
            this.unbindEventListener = null;
        }
        this.clearCurrentButtons();
        imageActionPanel.dispose();
    }
}

/** 全局楼层消息装饰器单例 */
export const messageDecorator = new MessageDecorator();
