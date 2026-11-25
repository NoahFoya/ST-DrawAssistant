/**
 * 消息楼层生图组件调度器 (MessageDecorator)。
 *
 * 负责解析消息中的生图指令标签，管理楼层内的动作按钮、骨架屏与图片展示容器：
 * - 解析消息正文中的生图指令并替换为楼层生图容器节点；
 * - 管理楼层内的生图按钮与生成中骨架屏，支持脱离 DOM 后的自动重新挂载；
 * - 监听当前最新 AI 楼层 `.mes_text` 变化，避免外部美化或状态脚本整块覆写导致按钮/自动生图丢失；
 * - 出图就绪后在楼层消息中展示图片，并支持全屏预览与图片编辑面板；
 * - 响应宿主消息删除、编辑与候选分支切换事件（含重 roll 取消旧分支队列）并清理对应实例。
 */

import type { Disposable } from '../types';
import { FloorActionButton } from './floor-action-button';
import { promptPipeline } from '../../pipeline/prompt-pipeline';
import { extractArchivesFromText, type ExtractedArchiveItem } from '../../pipeline/archive-extractor';
import {
    resolveActiveMaterialExtractionConfig,
    splitKeywordTokens,
} from '../../pipeline/material-definitions';
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
import { attachImageDragFile, copyImageBlobToClipboard } from '../../util/browser-io';
import {
    buildFloorSlotKey,
    matchesFloorSlotMessage,
    matchesFloorSlotScope,
    replaceCommandsWithFloorSlots,
    validateCurrentPresetAssets,
} from './floor-helpers';
import type {
    ChatMessage,
    DrawingSlotEntry,
    DrawingTask,
    ProviderType,
    SlotMountTarget,
} from '@types';

interface FloorSlotState {
    target: SlotMountTarget;
    imageId?: string;
    displayUrl: string;
    favorited: boolean;
    syncFavUI: (fav: boolean) => void;
}

interface ObservedLatestFloorState {
    chatId: string;
    messageId: number;
    swipeId: number;
    mesText: HTMLElement;
    expectedNodes: Set<HTMLElement>;
}

interface PendingAutoGenerateTarget {
    chatId: string;
    messageId: number;
    swipeId: number;
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
    private readonly activePreloadCleanups = new Map<string, () => void>();
    private readonly inFlightRenders = new Map<string, Promise<void>>();

    /** 消息级异步装饰计数器：在清理、删除或切换分支时递增，丢弃过期的在途异步结果 */
    private readonly messageGenerations = new Map<number, number>();
    /** 会话级清理计数器，切换会话执行 clearCurrentButtons 时递增 */
    private clearEpoch = 0;
    private isDisposed = false;

    /** 防抖扫描定时器 */
    private scanTimer: ReturnType<typeof setTimeout> | null = null;
    private unbindEventListener: (() => void) | null = null;
    private intersectionObserver: IntersectionObserver | null = null;

    /** 最新 AI 楼层 DOM 自动恢复监听与一次性待自动生图状态 */
    private latestFloorObserver: MutationObserver | null = null;
    private observedLatestFloor: ObservedLatestFloorState | null = null;
    private observerRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly selfMutatingDepths = new Map<number, number>();
    private pendingAutoGenerateTarget: PendingAutoGenerateTarget | null = null;
    private readonly pendingArchiveConfirmations = new Set<number>();

    public constructor() {
        this.bind();
    }

    /**
     * 绑定或恢复内部事件监听（幂等，用于插件重新激活）。
     */
    public bind(): void {
        this.isDisposed = false;
        if (!this.unbindEventListener) {
            this.listenEvents();
        }
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
        return buildFloorSlotKey(chatId, messageId, swipeId, instructionIndex);
    }

    private captureMessageToken(messageId: number): { clearEpoch: number; generation: number } {
        return {
            clearEpoch: this.clearEpoch,
            generation: this.messageGenerations.get(messageId) ?? 0,
        };
    }

    private isMessageTokenValid(
        messageId: number,
        token: { clearEpoch: number; generation: number }
    ): boolean {
        return (
            this.clearEpoch === token.clearEpoch &&
            (this.messageGenerations.get(messageId) ?? 0) === token.generation
        );
    }

    private bumpMessageGeneration(messageId: number): void {
        this.messageGenerations.set(messageId, (this.messageGenerations.get(messageId) ?? 0) + 1);
    }

    /**
     * 清扫指定楼层 DOM 中可能残留的插件容器、按钮、图片与档案徽标节点，
     * 确保状态 Map 未登记或新分支不含指令时也能清理残留节点。
     */
    private purgeMessageFloorDom(messageId: number): void {
        if (typeof document === 'undefined') {
            return;
        }
        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageDom) {
            return;
        }
        this.runWithObserverSuppressed(messageId, () => {
            for (const node of messageDom.querySelectorAll(
                '.da-floor-action-wrapper, .da-floor-image-container, .da-floor-image-skeleton, .da-floor-archive-badges, .da-floor-slot'
            )) {
                node.remove();
            }
        });
    }

    /**
     * 获取指定楼层对应的 `.mes` 外壳及其正文挂载容器（`.mes_text` 或回退 `.mes`）。
     */
    private getMessageTextContainer(
        messageId: number
    ): { messageDom: HTMLElement; mesText: HTMLElement } | null {
        if (typeof document === 'undefined') {
            return null;
        }
        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`) as HTMLElement | null;
        if (!messageDom) {
            return null;
        }
        const mesText = (messageDom.querySelector('.mes_text') || messageDom) as HTMLElement;
        return { messageDom, mesText };
    }

    /**
     * 动态解析指定楼层与指令序号当前在 DOM 中的活跃插槽元素，避免闭包持有被外部重绘替换的过期节点。
     */
    private resolveSlotElement(
        messageId: number,
        instructionIndex: number,
        fallbackContainer?: HTMLElement | null
    ): HTMLElement | null {
        const containerInfo = this.getMessageTextContainer(messageId);
        if (!containerInfo) {
            return typeof document === 'undefined' ? (fallbackContainer ?? null) : null;
        }
        const { messageDom, mesText } = containerInfo;
        const liveSlot = messageDom.querySelector(
            `.da-floor-slot[data-instruction-index="${instructionIndex}"]`
        ) as HTMLElement | null;
        if (liveSlot) {
            return liveSlot;
        }
        if (fallbackContainer && fallbackContainer.isConnected && messageDom.contains(fallbackContainer)) {
            return fallbackContainer;
        }
        return mesText;
    }

    /**
     * 将图片容器、骨架屏或动作按钮挂载至目标容器，并保持展示内容在前、动作按钮在后的 DOM 顺序。
     */
    private mountToSlot(
        mountTarget: HTMLElement,
        element: HTMLElement,
        role: 'visual' | 'button'
    ): void {
        const isStructuredSlot = mountTarget.classList.contains('da-floor-slot');
        if (role === 'visual') {
            if (isStructuredSlot) {
                if (
                    !element.isConnected ||
                    element.parentElement !== mountTarget ||
                    mountTarget.firstElementChild !== element
                ) {
                    mountTarget.insertBefore(element, mountTarget.firstChild);
                }
            } else if (!element.isConnected || element.parentElement !== mountTarget) {
                const firstBtn = mountTarget.querySelector(':scope > .da-floor-action-wrapper');
                if (firstBtn) {
                    mountTarget.insertBefore(element, firstBtn);
                } else {
                    mountTarget.appendChild(element);
                }
            }
            return;
        }

        const hasTrailingVisual = Boolean(
            element.parentElement === mountTarget &&
                element.nextElementSibling &&
                (element.nextElementSibling.classList.contains('da-floor-image-container') ||
                    element.nextElementSibling.classList.contains('da-floor-image-skeleton'))
        );
        if (!element.isConnected || element.parentElement !== mountTarget || hasTrailingVisual) {
            mountTarget.appendChild(element);
        }
    }

    /**
     * 在执行自身楼层 DOM 修改期间暂时屏蔽同楼层的 MutationObserver 回调，防止形成自我触发循环。
     */
    private runWithObserverSuppressed(messageId: number, fn: () => void): void {
        const prev = this.selfMutatingDepths.get(messageId) ?? 0;
        this.selfMutatingDepths.set(messageId, prev + 1);
        try {
            fn();
        } finally {
            const next = (this.selfMutatingDepths.get(messageId) ?? 1) - 1;
            if (next <= 0) {
                this.latestFloorObserver?.takeRecords();
                this.selfMutatingDepths.delete(messageId);
            } else {
                this.selfMutatingDepths.set(messageId, next);
            }
        }
    }

    /**
     * 判断指定楼层是否为当前会话中的最新一条非用户（AI）消息。
     */
    private isLatestAiMessage(
        chat: ReadonlyArray<ChatMessage | undefined> | undefined,
        messageId: number
    ): boolean {
        if (!Array.isArray(chat)) {
            return false;
        }
        for (let i = chat.length - 1; i >= 0; i--) {
            const item = chat[i];
            if (item && !item.is_user && !item.is_system) {
                return i === messageId;
            }
        }
        return false;
    }

    /**
     * 收集指定楼层当前分支已实际挂载在目标 `.mes_text` 中的插件节点集合。
     */
    private collectObservedNodesForMessage(
        mesText: HTMLElement,
        chatId: string,
        messageId: number,
        swipeId: number
    ): Set<HTMLElement> {
        const nodes = new Set<HTMLElement>();
        for (const el of mesText.querySelectorAll('.da-floor-slot, .da-floor-archive-badges')) {
            nodes.add(el as HTMLElement);
        }
        const maps: Array<Map<string, HTMLElement>> = [this.activeImageContainers, this.activeSkeletons];
        for (const [key, btn] of this.activeButtons.entries()) {
            if (matchesFloorSlotScope(key, chatId, messageId, swipeId) && mesText.contains(btn.element)) {
                nodes.add(btn.element);
            }
        }
        for (const map of maps) {
            for (const [key, el] of map.entries()) {
                if (matchesFloorSlotScope(key, chatId, messageId, swipeId) && mesText.contains(el)) {
                    nodes.add(el);
                }
            }
        }
        return nodes;
    }

    /**
     * 若当前正受观察的最新 AI 楼层发生节点增删，同步刷新预期存活节点清单。
     */
    private syncObservedNodesIfTarget(messageId: number): void {
        const observed = this.observedLatestFloor;
        if (!observed || observed.messageId !== messageId) {
            return;
        }
        observed.expectedNodes = this.collectObservedNodesForMessage(
            observed.mesText,
            observed.chatId,
            observed.messageId,
            observed.swipeId
        );
    }

    /**
     * 断开最新 AI 楼层 `.mes_text` DOM 自动恢复监听并取消待执行的恢复定时器。
     */
    private disconnectLatestFloorObserver(): void {
        if (this.observerRecoveryTimer !== null) {
            clearTimeout(this.observerRecoveryTimer);
            this.observerRecoveryTimer = null;
        }
        if (this.latestFloorObserver) {
            this.latestFloorObserver.disconnect();
            this.latestFloorObserver = null;
        }
        this.observedLatestFloor = null;
    }

    /**
     * 将轻量 `MutationObserver` 绑定至当前最新一条 AI 消息的 `.mes_text` 容器，
     * 用于在外部脚本调用 `updateMessageBlock` 覆写 DOM 后自动重新挂载与补发未完成的自动生图。
     */
    private updateLatestFloorObserver(
        chatId: string,
        messageId: number,
        swipeId: number,
        mesText: HTMLElement,
        shouldWatch: boolean
    ): void {
        if (!shouldWatch || typeof MutationObserver === 'undefined') {
            if (this.observedLatestFloor?.messageId === messageId) {
                this.disconnectLatestFloorObserver();
            }
            return;
        }

        const expectedNodes = this.collectObservedNodesForMessage(mesText, chatId, messageId, swipeId);
        if (expectedNodes.size === 0) {
            if (this.observedLatestFloor?.messageId === messageId) {
                this.disconnectLatestFloorObserver();
            }
            return;
        }

        if (
            this.latestFloorObserver &&
            this.observedLatestFloor &&
            this.observedLatestFloor.mesText === mesText
        ) {
            this.observedLatestFloor.chatId = chatId;
            this.observedLatestFloor.messageId = messageId;
            this.observedLatestFloor.swipeId = swipeId;
            this.observedLatestFloor.expectedNodes = expectedNodes;
            return;
        }

        this.disconnectLatestFloorObserver();
        const observedState: ObservedLatestFloorState = {
            chatId,
            messageId,
            swipeId,
            mesText,
            expectedNodes,
        };
        this.observedLatestFloor = observedState;

        this.latestFloorObserver = new MutationObserver(() => {
            if (
                this.isDisposed ||
                !settingsStore.getSettings().enabled ||
                this.observedLatestFloor !== observedState ||
                (this.selfMutatingDepths.get(observedState.messageId) ?? 0) > 0
            ) {
                return;
            }

            const hostContext = window.SillyTavern?.getContext?.();
            if (!hostContext || hostContext.chatId !== observedState.chatId) {
                return;
            }
            const msg = hostContext.chat?.[observedState.messageId];
            if (!msg || msg.is_user || (msg.swipe_id ?? 0) !== observedState.swipeId) {
                return;
            }

            const liveMessageDom = document.querySelector(`#chat .mes[mesid="${observedState.messageId}"]`);
            const liveMesText = liveMessageDom?.querySelector('.mes_text') as HTMLElement | null;
            const hasMesTextReplaced =
                !observedState.mesText.isConnected ||
                (liveMesText !== null && liveMesText !== observedState.mesText);
            let hasDetachedPluginNode = hasMesTextReplaced;
            if (!hasDetachedPluginNode) {
                for (const node of observedState.expectedNodes) {
                    if (!node.isConnected || !observedState.mesText.contains(node)) {
                        hasDetachedPluginNode = true;
                        break;
                    }
                }
            }
            if (!hasDetachedPluginNode) {
                return;
            }

            const hasCommands =
                typeof msg.mes === 'string' && promptPipeline.extractCommands(msg.mes).length > 0;
            const extractionCfg = resolveActiveMaterialExtractionConfig(settingsStore.getSettings());
            const hasArchives =
                typeof msg.mes === 'string' &&
                extractionCfg?.enabled !== false &&
                extractArchivesFromText(msg.mes, extractionCfg).length > 0;
            if (!hasCommands && !hasArchives) {
                return;
            }

            this.scheduleObserverRecovery(observedState);
        });

        this.latestFloorObserver.observe(mesText, { childList: true, subtree: true });
    }

    /**
     * 调度最新 AI 楼层 DOM 自动恢复：重新装饰并补挂脱离节点，若有未消费的自动生图意图则补发触发。
     */
    private scheduleObserverRecovery(observed: ObservedLatestFloorState): void {
        if (this.observerRecoveryTimer !== null) {
            clearTimeout(this.observerRecoveryTimer);
        }
        this.observerRecoveryTimer = setTimeout(() => {
            this.observerRecoveryTimer = null;
            void this.performObserverRecovery(observed);
        }, 0);
    }

    private async performObserverRecovery(observed: ObservedLatestFloorState): Promise<void> {
        if (this.isDisposed || !settingsStore.getSettings().enabled) {
            return;
        }
        if (this.observedLatestFloor !== observed) {
            return;
        }

        const inFlight = this.inFlightDecorations.get(observed.messageId);
        if (inFlight) {
            await inFlight.catch(() => undefined);
            if (this.isDisposed || this.observedLatestFloor !== observed) {
                return;
            }
        }

        const beforeCtx = window.SillyTavern?.getContext?.();
        const beforeMsg = beforeCtx?.chat?.[observed.messageId];
        if (
            !beforeCtx ||
            beforeCtx.chatId !== observed.chatId ||
            !beforeMsg ||
            (beforeMsg.swipe_id ?? 0) !== observed.swipeId ||
            !this.isLatestAiMessage(beforeCtx.chat, observed.messageId)
        ) {
            return;
        }

        await this.decorateMessage(observed.messageId);

        const afterCtx = window.SillyTavern?.getContext?.();
        const afterMsg = afterCtx?.chat?.[observed.messageId];
        if (
            this.isDisposed ||
            !afterCtx ||
            afterCtx.chatId !== observed.chatId ||
            afterMsg !== beforeMsg ||
            (afterMsg.swipe_id ?? 0) !== observed.swipeId
        ) {
            return;
        }

        const settings = settingsStore.getSettings();
        if (
            settings.enabled &&
            settings.autoGenerate &&
            !this.pendingArchiveConfirmations.has(observed.messageId) &&
            this.matchesPendingAutoGenerate(observed.chatId, observed.messageId, observed.swipeId)
        ) {
            this.triggerReadyButtons(observed.messageId);
        }
    }

    /**
     * 记录指定楼层与分支的一次性待自动生图意图（当外部脚本抢先清空 DOM 导致首轮触发落空时，
     * 供自动恢复后补触发一次，并在成功点击或切走/取消时清除）。
     */
    public markPendingAutoGenerate(chatId: string, messageId: number, swipeId: number): void {
        this.pendingAutoGenerateTarget = { chatId, messageId, swipeId };
    }

    /**
     * 清除指定楼层（或全部）待自动生图标记。
     */
    public clearPendingAutoGenerate(messageId?: number): void {
        if (messageId === undefined || this.pendingAutoGenerateTarget?.messageId === messageId) {
            this.pendingAutoGenerateTarget = null;
        }
    }

    private matchesPendingAutoGenerate(chatId: string, messageId: number, swipeId: number): boolean {
        return Boolean(
            this.pendingAutoGenerateTarget &&
                this.pendingAutoGenerateTarget.chatId === chatId &&
                this.pendingAutoGenerateTarget.messageId === messageId &&
                this.pendingAutoGenerateTarget.swipeId === swipeId
        );
    }

    /**
     * 监听生图就绪通知与任务状态变更事件，自动刷新并挂载对应楼层的生成图片或骨架占位。
     */
    private listenEvents(): void {
        const unbindImageReady = eventBus.on('image:ready', async ({ imageId, target }) => {
            const hostContext = window.SillyTavern?.getContext?.();
            const currentChatId = hostContext?.chatId;

            // 跨会话安全防护：若未处于目标会话（含返回欢迎页 currentChatId 为空）则跳过当前视图 DOM 渲染
            if (!currentChatId || currentChatId !== target.chatId) {
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
            if (!currentChatId || currentChatId !== target.chatId) {
                return;
            }

            const swipeId = target.swipeId ?? 0;
            const buttonKey = this.buildSlotKey(target.chatId, target.messageId, swipeId, target.instructionIndex);
            const button = this.activeButtons.get(buttonKey);
            if (!button) {
                return;
            }

            if (eventData.status === 'failed') {
                button.element.style.display = '';
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
                if (!hasImage) {
                    button.element.style.display = '';
                }
                button.setState(hasImage ? 'done' : 'ready');
                this.removeSkeleton(target.messageId, target.instructionIndex, target.chatId, swipeId);
                container?.querySelector('.da-floor-image')?.classList.remove('da-floor-image--regenerating');
                if (!eventData.silentToast) {
                    Toast.info('生图任务已取消');
                }
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

        let lastHideOnDone = settingsStore.getSettings().ui?.floorButton?.hideOnDone ?? false;
        const unbindSettingsUpdated = eventBus.on('settings:updated', () => {
            const settings = settingsStore.getSettings();
            if (!settings.enabled) {
                this.disconnectLatestFloorObserver();
                this.clearPendingAutoGenerate();
                return;
            }
            if (!settings.autoGenerate) {
                this.clearPendingAutoGenerate();
            }
            const displayCfg = settings.ui?.imageDisplay;
            for (const container of this.activeImageContainers.values()) {
                this.applyDisplaySettingsToContainer(container, displayCfg);
            }

            const hideButtonOnDone = settings.ui?.floorButton?.hideOnDone ?? false;
            for (const [slotKey, button] of this.activeButtons.entries()) {
                const slotState = this.activeSlotStates.get(slotKey);
                if (!slotState || !this.activeImageContainers.has(slotKey)) {
                    continue;
                }
                const activeTask = generationOrchestrator.getActiveTaskByTarget(slotState.target);
                if (!activeTask && button.getState?.() !== 'error') {
                    button.element.style.display = hideButtonOnDone ? 'none' : '';
                }
            }

            if (lastHideOnDone && !hideButtonOnDone) {
                this.scheduleScanAllMessages(50);
            }
            lastHideOnDone = hideButtonOnDone;
        });

        this.unbindEventListener = () => {
            unbindImageReady();
            unbindTaskStatus();
            unbindFavChanged();
            unbindImageDeleted();
            unbindSettingsUpdated();
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
        return replaceCommandsWithFloorSlots(container, commands);
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

        const extractionCfg = resolveActiveMaterialExtractionConfig(settings);
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
                        (arch.kind === 'character' ? '<character>' : '<outfit>');
                    const eTag =
                        (arch.kind === 'character' ? extractionCfg?.charEndTag : extractionCfg?.outfitEndTag) ||
                        (arch.kind === 'character' ? '</character>' : '</outfit>');

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

            for (const arch of archives) {
                const firstAlias = splitKeywordTokens(arch.aliases)[0] || '';
                const labelSuffix =
                    firstAlias && firstAlias.toLowerCase() !== arch.name.toLowerCase()
                        ? ` (${firstAlias})`
                        : '';
                const badge = document.createElement('button');
                badge.type = 'button';
                badge.className = 'da-btn da-btn--secondary da-btn--sm da-floor-archive-badge';
                badge.textContent =
                    arch.kind === 'character'
                        ? `角色档案: ${arch.name}${labelSuffix}`
                        : `服装档案: ${arch.name}${labelSuffix}`;
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

        const extractionCfg = resolveActiveMaterialExtractionConfig(settings);
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
            .map((a) => `${a.kind}:${a.name}:${a.parts.appearance || a.parts.style || ''}`)
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
            this.pendingArchiveConfirmations.add(messageId);

            let finishedCalled = false;
            const finishOnce = () => {
                if (finishedCalled) return;
                finishedCalled = true;
                this.pendingArchiveConfirmations.delete(messageId);
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

        let decorationPromise!: Promise<void>;
        decorationPromise = (async () => {
            try {
                await this.performDecorateMessage(messageId);
            } finally {
                // 仅当表内仍是当前 Promise 实例时才删除，避免旧任务覆盖误删被清理后重启的新任务
                if (this.inFlightDecorations.get(messageId) === decorationPromise) {
                    this.inFlightDecorations.delete(messageId);
                }
            }
        })();

        this.inFlightDecorations.set(messageId, decorationPromise);
        return decorationPromise;
    }

    /**
     * 查找或补偿挂载当前生图指令对应的楼层容器节点。
     */
    private ensureCommandSlotElement(
        messageId: number,
        targetContainer: HTMLElement,
        slotsMap: Map<number, HTMLElement>,
        instructionIndex: number,
        shouldAppendFallback: boolean
    ): HTMLElement {
        const directSlot = slotsMap.get(instructionIndex);
        if (directSlot) {
            return directSlot;
        }

        let resolved!: HTMLElement;
        // 结构补偿挂载：若 Markdown 语法导致指令未能成功替换，按已有图片或活跃任务记录在末尾追加容器
        this.runWithObserverSuppressed(messageId, () => {
            const existing = targetContainer.querySelector(
                `.da-floor-slot[data-instruction-index="${instructionIndex}"]`
            ) as HTMLElement | null;
            if (existing) {
                resolved = existing;
            } else if (shouldAppendFallback) {
                const appended = document.createElement('div');
                appended.className = 'da-floor-slot da-floor-slot--appended';
                appended.setAttribute('data-instruction-index', String(instructionIndex));
                targetContainer.appendChild(appended);
                resolved = appended;
            } else {
                resolved = targetContainer;
            }
            slotsMap.set(instructionIndex, resolved);
        });
        return resolved;
    }

    /**
     * 渲染已持久化楼层图片，并在等待 IndexedDB 读取期间若正文容器被外部覆写时刷新容器定位与重绘高亮态。
     */
    private async reconcileSlotAfterImageRender(options: {
        messageId: number;
        chatId: string;
        swipeId: number;
        token: { clearEpoch: number; generation: number };
        cmd: ReturnType<typeof promptPipeline.extractCommands>[number];
        slotElement: HTMLElement;
        slotKey: string;
        entry: DrawingSlotEntry;
        activeTask: DrawingTask | undefined;
    }): Promise<{ slotElement: HTMLElement; hasRenderedImage: boolean } | null> {
        const { messageId, chatId, swipeId, token, cmd, slotKey, entry, activeTask } = options;
        let slotElement = options.slotElement;

        await this.renderImageToFloor(
            messageId,
            entry.imageId,
            cmd.instructionIndex,
            entry.imageUrl,
            chatId,
            swipeId
        );
        if (!this.isMessageTokenValid(messageId, token)) {
            return null;
        }

        const liveInfo = this.getMessageTextContainer(messageId);
        if (!liveInfo) {
            return null;
        }

        const liveTextContainer = liveInfo.mesText;
        if (!slotElement.isConnected || !liveTextContainer.contains(slotElement)) {
            this.runWithObserverSuppressed(messageId, () => {
                const refreshedSlots = this.replaceCommandsWithSlots(liveTextContainer, [cmd]);
                slotElement =
                    refreshedSlots.get(cmd.instructionIndex) ??
                    this.resolveSlotElement(messageId, cmd.instructionIndex, liveTextContainer) ??
                    liveTextContainer;
                const existingImgContainer = this.activeImageContainers.get(slotKey);
                if (existingImgContainer) {
                    this.mountToSlot(slotElement, existingImgContainer, 'visual');
                }
            });
        }

        const hasRenderedImage = this.activeImageContainers.has(slotKey);
        if (hasRenderedImage && activeTask) {
            slotElement.querySelector('.da-floor-image')?.classList.add('da-floor-image--regenerating');
        }

        return { slotElement, hasRenderedImage };
    }

    /**
     * 为指定生图指令容器创建（或复用）交互动作按钮、挂入当前容器并同步状态。
     */
    private mountActionButtonForSlot(options: {
        chatId: string;
        messageId: number;
        swipeId: number;
        target: SlotMountTarget;
        cmd: ReturnType<typeof promptPipeline.extractCommands>[number];
        slotKey: string;
        slotElement: HTMLElement;
        hasRenderedImage: boolean;
        activeTask: DrawingTask | undefined;
        hideButtonOnDone: boolean;
    }): void {
        const {
            chatId,
            messageId,
            swipeId,
            target,
            cmd,
            slotKey,
            slotElement,
            hasRenderedImage,
            activeTask,
            hideButtonOnDone,
        } = options;

        this.runWithObserverSuppressed(messageId, () => {
            if (hasRenderedImage && hideButtonOnDone && !activeTask) {
                const existingBtn = this.activeButtons.get(slotKey);
                if (existingBtn) {
                    existingBtn.dispose();
                    this.activeButtons.delete(slotKey);
                }
                return;
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
                                message: `当前生图参数预设引用的部分模型未在服务端检测到：\n- ${check.missing.join('\n- ')}\n\n是否仍继续尝试生图？`,
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

                        const liveSlot = this.resolveSlotElement(messageId, cmd.instructionIndex);
                        const imgEl = liveSlot?.querySelector('.da-floor-image') ?? null;
                        if (imgEl) {
                            imgEl.classList.add('da-floor-image--regenerating');
                        } else {
                            this.renderSkeletonToFloor(messageId, cmd.instructionIndex, chatId, swipeId);
                        }

                        try {
                            const taskId = await generationOrchestrator.submitTask(submitOptions);
                            const submittedTask = taskId ? generationOrchestrator.getTask(taskId) : undefined;
                            if (submittedTask?.status === 'generating' && button?.getState() === 'pending') {
                                button.setState('generating');
                            }
                            return taskId;
                        } catch (err: unknown) {
                            const errMessage = err instanceof Error ? err.message : String(err);
                            logger.error(`[MessageDecorator] 任务提交失败: ${errMessage}`);
                            this.removeSkeleton(messageId, cmd.instructionIndex, chatId, swipeId);
                            const currentSlot = this.resolveSlotElement(messageId, cmd.instructionIndex);
                            currentSlot?.querySelector('.da-floor-image')?.classList.remove('da-floor-image--regenerating');
                            Toast.error(errMessage);
                            throw err;
                        }
                    },
                    onCancel: () => {
                        const task = generationOrchestrator.getActiveTaskByTarget(target);
                        if (task) {
                            generationOrchestrator.cancelTask(task.taskId, '用户主动取消');
                        }
                        const liveSlot = this.resolveSlotElement(messageId, cmd.instructionIndex);
                        liveSlot?.querySelector('.da-floor-image')?.classList.remove('da-floor-image--regenerating');
                        this.removeSkeleton(messageId, cmd.instructionIndex, chatId, swipeId);
                    },
                });

                this.activeButtons.set(slotKey, button);
            }

            // 若缓存按钮已脱离当前插槽（如 .mes_text 被外部脚本重置），重新挂回新容器
            this.mountToSlot(slotElement, button.element, 'button');

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
        });
    }

    /**
     * 执行指定楼层的实际装饰解析与 DOM 挂载逻辑。
     *
     * @param messageId 目标消息楼层 ID
     */
    private async performDecorateMessage(messageId: number): Promise<void> {
        if (this.isDisposed || typeof document === 'undefined' || !settingsStore.getSettings().enabled) {
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

        const containerInfo = this.getMessageTextContainer(messageId);
        if (!containerInfo) {
            return;
        }

        const targetContainer = containerInfo.mesText;
        const chatId = hostContext.chatId || 'default_chat';
        const swipeId = message.swipe_id ?? 0;
        const token = this.captureMessageToken(messageId);
        const isLatestAi = this.isLatestAiMessage(hostContext.chat, messageId);

        let archives: ExtractedArchiveItem[] = [];
        let commands: ReturnType<typeof promptPipeline.extractCommands> = [];
        let slotsMap = new Map<number, HTMLElement>();

        this.runWithObserverSuppressed(messageId, () => {
            // 1. 检测并处理楼层中的角色与服装档案块（折叠胶囊）
            archives = this.decorateArchiveBlocks(targetContainer, message.mes);

            // 2. 提取消息正文中的生图指令标签
            commands = promptPipeline.extractCommands(message.mes);
            if (commands.length === 0) {
                for (const slot of targetContainer.querySelectorAll(
                    '.da-floor-action-wrapper, .da-floor-image-container, .da-floor-image-skeleton, .da-floor-slot'
                )) {
                    slot.remove();
                }
                return;
            }

            // 3. 将正文中的指令文本拆分替换为楼层生图容器
            slotsMap = this.replaceCommandsWithSlots(targetContainer, commands);
        });

        if (commands.length === 0) {
            if (this.matchesPendingAutoGenerate(chatId, messageId, swipeId)) {
                this.clearPendingAutoGenerate(messageId);
            }
            this.updateLatestFloorObserver(
                chatId,
                messageId,
                swipeId,
                targetContainer,
                isLatestAi && archives.length > 0
            );
            return;
        }

        // 4. 遍历指令挂载楼层容器与动作按钮
        const settings = settingsStore.getSettings();
        const hideButtonOnDone = settings.ui?.floorButton?.hideOnDone ?? false;
        let hasReadySlot = false;

        for (const cmd of commands) {
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

            let slotElement = this.ensureCommandSlotElement(
                messageId,
                targetContainer,
                slotsMap,
                cmd.instructionIndex,
                hasSlotEntry || Boolean(activeTask)
            );

            let hasRenderedImage = false;
            if (hasSlotEntry) {
                const reconciled = await this.reconcileSlotAfterImageRender({
                    messageId,
                    chatId,
                    swipeId,
                    token,
                    cmd,
                    slotElement,
                    slotKey,
                    entry: entry!,
                    activeTask,
                });
                if (!reconciled) {
                    return;
                }
                slotElement = reconciled.slotElement;
                hasRenderedImage = reconciled.hasRenderedImage;
            } else if (activeTask) {
                this.renderSkeletonToFloor(messageId, cmd.instructionIndex, chatId, swipeId);
            }

            if (!hasRenderedImage && !activeTask) {
                hasReadySlot = true;
            }

            this.mountActionButtonForSlot({
                chatId,
                messageId,
                swipeId,
                target,
                cmd,
                slotKey,
                slotElement,
                hasRenderedImage,
                activeTask,
                hideButtonOnDone,
            });
        }

        if (!hasReadySlot && this.matchesPendingAutoGenerate(chatId, messageId, swipeId)) {
            this.clearPendingAutoGenerate(messageId);
        }

        const finalMesText = this.getMessageTextContainer(messageId)?.mesText ?? targetContainer;
        this.updateLatestFloorObserver(chatId, messageId, swipeId, finalMesText, isLatestAi);
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
        if (buttons.length > 0) {
            this.clearPendingAutoGenerate(messageId);
        }
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

        const existingContainer = this.activeImageContainers.get(containerKey);
        if (existingContainer && existingContainer.isConnected && slotElement.contains(existingContainer)) {
            return;
        }

        const existingSkeleton = this.activeSkeletons.get(containerKey);
        if (existingSkeleton) {
            if (!existingSkeleton.isConnected || !slotElement.contains(existingSkeleton)) {
                this.runWithObserverSuppressed(messageId, () => {
                    this.mountToSlot(slotElement, existingSkeleton, 'visual');
                    this.syncObservedNodesIfTarget(messageId);
                });
            }
            return;
        }

        const skeleton = document.createElement('div');
        skeleton.className = 'da-floor-image-skeleton';
        skeleton.setAttribute('data-slot-skeleton', containerKey);

        const iconSpan = document.createElement('span');
        iconSpan.textContent = '正在生成图像...';
        skeleton.appendChild(iconSpan);

        this.runWithObserverSuppressed(messageId, () => {
            this.mountToSlot(slotElement, skeleton, 'visual');
            this.activeSkeletons.set(containerKey, skeleton);
            this.syncObservedNodesIfTarget(messageId);
        });
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
            this.runWithObserverSuppressed(messageId, () => {
                skeleton.remove();
                this.activeSkeletons.delete(containerKey);
                this.syncObservedNodesIfTarget(messageId);
            });
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
        const token = this.captureMessageToken(messageId);

        const prevRender = this.inFlightRenders.get(containerKey) ?? Promise.resolve();
        const renderPromise = prevRender
            .catch(() => undefined)
            .then(() =>
                this.performRenderImageToFloor(
                    messageId,
                    imageId,
                    instructionIndex,
                    serverImageUrl,
                    effectiveChatId,
                    effectiveSwipeId,
                    containerKey,
                    token
                )
            );
        this.inFlightRenders.set(containerKey, renderPromise);
        try {
            await renderPromise;
        } finally {
            if (this.inFlightRenders.get(containerKey) === renderPromise) {
                this.inFlightRenders.delete(containerKey);
            }
        }
    }

    private async performRenderImageToFloor(
        messageId: number,
        imageId: string | undefined,
        instructionIndex: number,
        serverImageUrl: string | undefined,
        effectiveChatId: string,
        effectiveSwipeId: number,
        containerKey: string,
        token: { clearEpoch: number; generation: number }
    ): Promise<void> {
        const isStillActiveTarget = (): boolean => {
            if (!this.isMessageTokenValid(messageId, token)) {
                return false;
            }
            const latestCtx = window.SillyTavern?.getContext?.();
            if (latestCtx?.chatId && latestCtx.chatId !== effectiveChatId) {
                return false;
            }
            const latestMsg = latestCtx?.chat?.[messageId];
            if (latestMsg && (latestMsg.swipe_id ?? 0) !== effectiveSwipeId) {
                return false;
            }
            return true;
        };

        if (!isStillActiveTarget()) {
            return;
        }

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
                if (!isStillActiveTarget()) {
                    return;
                }
                if (blob && blob.size > 0) {
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
                this.runWithObserverSuppressed(messageId, () => {
                    const existingContainer = this.activeImageContainers.get(containerKey);
                    if (existingContainer) {
                        this.activePreloadCleanups.get(containerKey)?.();
                        this.activePreloadCleanups.delete(containerKey);
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
                    this.syncObservedNodesIfTarget(messageId);
                });
            }
            return;
        }

        // 图像已就绪，移除骨架屏
        this.removeSkeleton(messageId, instructionIndex, effectiveChatId, effectiveSwipeId);

        const settings = settingsStore.getSettings();
        const displayCfg = settings.ui?.imageDisplay;
        const initialRecord = imageId ? await imageStorage.getImageRecord(imageId) : undefined;
        if (!isStillActiveTarget()) {
            return;
        }
        const initialFavorited = Boolean(initialRecord?.favorited);

        // 异常回退辅助函数：若服务端静态路径或失效 Blob URL 加载异常，尝试从本地 IndexedDB 重建有效 URL
        const bindImageFallback = (img: HTMLImageElement) => {
            const targetEpoch = this.clearEpoch;
            img.onerror = async () => {
                if (this.isDisposed || this.clearEpoch !== targetEpoch || !img.isConnected) {
                    return;
                }
                if (imageId && !img.dataset.fallbackApplied) {
                    img.dataset.fallbackApplied = 'true';
                    let localUrl = urlPool.getUrl(imageId);
                    if (!localUrl || img.src === localUrl) {
                        const blob = await imageStorage.getImageBlob(imageId);
                        if (this.isDisposed || this.clearEpoch !== targetEpoch || !img.isConnected) {
                            return;
                        }
                        if (blob && blob.size > 0) {
                            localUrl = urlPool.createUrl(imageId, blob);
                        } else {
                            localUrl = undefined;
                        }
                    }
                    if (localUrl && img.src !== localUrl) {
                        logger.info(`图像展示异常，已从本地数据库重建展示地址 [${imageId}]`);
                        img.src = localUrl;
                        const state = this.activeSlotStates.get(containerKey);
                        if (state) {
                            state.displayUrl = localUrl;
                        }
                    }
                }
            };
        };

        // 已有图片容器时确认其仍挂载于最新插槽中，再预载图片地址、平滑替换并同步容器状态
        const existingContainer = this.activeImageContainers.get(containerKey);
        const existingImg = existingContainer?.querySelector('.da-floor-image') as HTMLImageElement | null;
        if (existingContainer && existingImg) {
            this.runWithObserverSuppressed(messageId, () => {
                const mountTarget =
                    this.resolveSlotElement(messageId, instructionIndex, textContainer) ?? textContainer;
                this.mountToSlot(mountTarget, existingContainer, 'visual');
                const existingButton = this.activeButtons.get(containerKey);
                if (existingButton && existingButton.element.style.display !== 'none') {
                    this.mountToSlot(mountTarget, existingButton.element, 'button');
                }
                this.syncObservedNodesIfTarget(messageId);
            });

            delete existingImg.dataset.fallbackApplied;
            bindImageFallback(existingImg);

            // 清理当前楼层容器上一次挂起的未决预载器（保留既有手势交互清理器）
            this.activePreloadCleanups.get(containerKey)?.();

            // 后台静默预载，待图像完成加载后再切换 src 并移除遮罩，避免切换图像时闪烁
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
                this.activePreloadCleanups.delete(containerKey);
                if (
                    this.activeImageContainers.get(containerKey) !== existingContainer ||
                    !isStillActiveTarget()
                ) {
                    return;
                }
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

            if (!applied) {
                this.activePreloadCleanups.set(containerKey, () => {
                    cleanupPreloader();
                    applied = true;
                });
            }

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

        // 1. 构建外层容器并应用显示样式
        const imageContainer = document.createElement('div');
        imageContainer.className = 'da-floor-image-container';

        // 2. 构建图片包装盒与图片节点
        const imageBox = document.createElement('div');
        imageBox.className = 'da-floor-image-box';

        const imgEl = document.createElement('img');
        imgEl.className = 'da-floor-image';
        bindImageFallback(imgEl);
        imgEl.src = displayUrl;
        imgEl.alt = 'AI 生成图像';
        imgEl.loading = 'lazy';

        const resolveSlotBlob = async (): Promise<Blob | null> => {
            if (slotState.imageId) {
                const stored = await imageStorage.getImageBlob(slotState.imageId);
                if (stored && stored.size > 0) return stored;
            }
            if (slotState.displayUrl) {
                const res = await fetch(slotState.displayUrl);
                if (res.ok) return await res.blob();
            }
            return null;
        };
        const dragFileBase = `st_draw_${slotState.imageId ? slotState.imageId.slice(0, 8) : messageId}`;
        const detachDrag = attachImageDragFile(imgEl, resolveSlotBlob, dragFileBase);

        let justLongPressed = false;

        if (isLightboxEnabled) {
            imgEl.classList.add('da-floor-image--zoomable');
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

            // 移动端长按手势呼出图片操作面板 (500ms，带手势防误触与松手后误触发点击防护)
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

            this.activeSlotCleanups.set(containerKey, () => {
                detachDrag();
                cancelAllGestures();
            });
        } else {
            this.activeSlotCleanups.set(containerKey, detachDrag);
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
                onPreview: (url) => {
                    lightboxModal.open(url, {
                        imageId: slotState.imageId,
                        favorited: slotState.favorited,
                        onFavoriteChange: (newFav) => {
                            slotState.favorited = newFav;
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
        actionsContainer.appendChild(infoBtn);

        // 3.3 复制图片按钮
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'da-floor-image__action-btn';
        copyBtn.title = '复制图片';
        copyBtn.innerHTML = renderIcon('copy', 14);
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const blob = await resolveSlotBlob();
            if (!blob) {
                Toast.error('获取图片数据失败');
                return;
            }
            const ok = await copyImageBlobToClipboard(blob);
            if (ok) {
                Toast.success('已复制图片到剪贴板');
            } else {
                Toast.error('当前浏览器不支持复制图片，请使用右键或下载');
            }
        });
        actionsContainer.appendChild(copyBtn);

        // 3.4 下载图片按钮 (下箭头)
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

        const collapseToggleBtn = document.createElement('button');
        collapseToggleBtn.type = 'button';
        collapseToggleBtn.className = 'da-floor-image-collapse-toggle';
        collapseToggleBtn.setAttribute('aria-expanded', 'false');
        collapseToggleBtn.innerHTML = `<span class="da-floor-image-collapse-toggle__arrow">${renderIcon('chevronRight', 13)}</span><span class="da-floor-image-collapse-toggle__icon">${renderIcon('image', 13)}</span><span class="da-floor-image-collapse-toggle__label">展开生成图片</span>`;
        collapseToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const expanded = imageContainer.classList.toggle('is-expanded');
            collapseToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            const labelEl = collapseToggleBtn.querySelector('.da-floor-image-collapse-toggle__label');
            if (labelEl) {
                labelEl.textContent = expanded ? '收起生成图片' : '展开生成图片';
            }
        });

        imageContainer.appendChild(collapseToggleBtn);
        imageContainer.appendChild(imageBox);
        this.applyDisplaySettingsToContainer(imageContainer, displayCfg);

        // 4. 定位对应的 .da-floor-slot 元素插入图片展示容器
        this.runWithObserverSuppressed(messageId, () => {
            const mountTarget =
                this.resolveSlotElement(messageId, instructionIndex, textContainer) ?? textContainer;
            this.mountToSlot(mountTarget, imageContainer, 'visual');
            this.activeImageContainers.set(containerKey, imageContainer);
            const existingButton = this.activeButtons.get(containerKey);
            if (existingButton && existingButton.element.style.display !== 'none') {
                this.mountToSlot(mountTarget, existingButton.element, 'button');
            }
            this.syncObservedNodesIfTarget(messageId);
        });

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

        // 优先读取图像记录中的未合并原始提示词；本地记录不存在时从当前楼层指令提取
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
            prompt: record?.metadata?.rawPrompt || rawPrompt || '',
            negativePrompt: record?.metadata?.rawNegativePrompt ?? '',
            record,
            onRegenerate: async (newPrompt, newNegPrompt) => {
                return await this.regenerateSlot(
                    { chatId: currentChatId, messageId, swipeId, instructionIndex },
                    newPrompt,
                    newNegPrompt
                );
            },
            onInpaint: async (inpaintData) => {
                return await this.regenerateSlot(
                    { chatId: currentChatId, messageId, swipeId, instructionIndex },
                    inpaintData.prompt,
                    inpaintData.negativePrompt,
                    {
                        mode: 'inpaint',
                        sourceImage: inpaintData.initImage,
                        maskImage: inpaintData.maskImage,
                        ...(inpaintData.width && inpaintData.height
                            ? { width: inpaintData.width, height: inpaintData.height }
                            : {}),
                        denoiseStrength: inpaintData.denoiseStrength,
                        maskBlur: inpaintData.maskBlur,
                        parentImageId: imageId,
                    }
                );
            },
        });
    }

    /**
     * 判断当前触发的候选分支滑动是否为右滑重 roll 生成的全新分支 (Overswipe)。
     */
    private isOverswipeTarget(message: ChatMessage | undefined, targetSwipeId: number): boolean {
        if (!message) {
            return false;
        }
        if (Array.isArray(message.swipes) && targetSwipeId >= message.swipes.length) {
            return true;
        }
        if (Array.isArray(message.swipe_info) && !message.swipe_info[targetSwipeId]) {
            return true;
        }
        return false;
    }

    /**
     * 处理宿主候选分支滑动切换 (Swipe)，同步分支图片数据、按需取消旧分支队列并更新对应分支显示。
     *
     * @param messageId 目标消息楼层 ID
     * @param swipeId 分支滑动索引
     * @param options 可选行为控制（如分支删除后的视图刷新跳过重 roll 取消）
     */
    public async handleMessageSwiped(
        messageId: number,
        swipeId?: number,
        options?: { skipSwipeCancel?: boolean }
    ): Promise<void> {
        this.clearPendingAutoGenerate(messageId);

        const hostContext = window.SillyTavern?.getContext?.();
        const message = hostContext?.chat?.[messageId];
        const targetSwipeId = swipeId ?? message?.swipe_id ?? 0;

        if (
            !options?.skipSwipeCancel &&
            (settingsStore.getSettings().cancelOnSwipe ?? true) &&
            this.isOverswipeTarget(message, targetSwipeId)
        ) {
            const chatId = hostContext?.chatId || 'default_chat';
            const cancelledCount = generationOrchestrator.cancelOtherSwipeTasks(
                chatId,
                messageId,
                targetSwipeId,
                '重 roll 生成新分支，已自动取消旧分支任务',
                { silentToast: true }
            );
            if (cancelledCount > 0) {
                Toast.info(`已取消上一分支的 ${cancelledCount} 个未完成生图任务`);
            }
        }

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
            const existingDrawings = sessionLifecycle.getSwipeDrawings(messageId, swipeId) || {};
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

        // 1. 递增消息装饰计数器并清除在途 Promise 记录，防止切换分支前的异步任务回写 DOM
        this.bumpMessageGeneration(messageId);
        this.inFlightDecorations.delete(messageId);
        this.clearPendingAutoGenerate(messageId);
        this.pendingArchiveConfirmations.delete(messageId);
        if (this.observedLatestFloor?.messageId === messageId) {
            this.disconnectLatestFloorObserver();
        }

        for (const [key, btn] of this.activeButtons.entries()) {
            if (matchesFloorSlotMessage(key, messageId)) {
                btn.dispose();
                this.activeButtons.delete(key);
            }
        }

        for (const [key, container] of this.activeImageContainers.entries()) {
            if (matchesFloorSlotMessage(key, messageId)) {
                this.activePreloadCleanups.get(key)?.();
                this.activePreloadCleanups.delete(key);
                this.activeSlotCleanups.get(key)?.();
                this.activeSlotCleanups.delete(key);
                container.remove();
                this.activeImageContainers.delete(key);
                this.activeSlotStates.delete(key);
            }
        }

        for (const [key, skeleton] of this.activeSkeletons.entries()) {
            if (matchesFloorSlotMessage(key, messageId)) {
                skeleton.remove();
                this.activeSkeletons.delete(key);
            }
        }

        // 2. 清扫 DOM 中未登记或切到空白分支后遗留的按钮/容器/档案徽标
        this.purgeMessageFloorDom(messageId);
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

            const targetMessageId = slotState.target?.messageId;
            const executeCleanup = () => {
                this.activePreloadCleanups.get(key)?.();
                this.activePreloadCleanups.delete(key);
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
                if (typeof targetMessageId === 'number') {
                    this.syncObservedNodesIfTarget(targetMessageId);
                }
            };
            if (typeof targetMessageId === 'number') {
                this.runWithObserverSuppressed(targetMessageId, executeCleanup);
            } else {
                executeCleanup();
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
        this.clearEpoch += 1;
        this.disconnectLatestFloorObserver();
        this.clearPendingAutoGenerate();
        this.pendingArchiveConfirmations.clear();
        this.selfMutatingDepths.clear();
        this.messageGenerations.clear();
        this.inFlightDecorations.clear();
        this.inFlightRenders.clear();
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }

        for (const cleanup of this.activePreloadCleanups.values()) {
            try {
                cleanup();
            } catch {
                // 忽略注销异常
            }
        }
        this.activePreloadCleanups.clear();

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

        if (typeof document !== 'undefined') {
            for (const node of document.querySelectorAll(
                '#chat .da-floor-action-wrapper, #chat .da-floor-image-container, #chat .da-floor-image-skeleton, #chat .da-floor-archive-badges, #chat .da-floor-slot'
            )) {
                node.remove();
            }
        }
    }

    /**
     * 将图片显示配置同步应用至已渲染的楼层容器 DOM。
     */
    private applyDisplaySettingsToContainer(
        imageContainer: HTMLElement,
        displayCfg: ReturnType<typeof settingsStore.getSettings>['ui']['imageDisplay']
    ): void {
        imageContainer.classList.remove(
            'da-floor-image-container--center',
            'da-floor-image-container--left',
            'da-floor-image-container--right'
        );
        if (displayCfg?.align === 'center') {
            imageContainer.classList.add('da-floor-image-container--center');
        } else if (displayCfg?.align === 'flex-start') {
            imageContainer.classList.add('da-floor-image-container--left');
        } else if (displayCfg?.align === 'flex-end') {
            imageContainer.classList.add('da-floor-image-container--right');
        }

        const displayMode = displayCfg?.displayMode || 'normal';
        const isCollapseMode = displayMode === 'collapse';
        imageContainer.classList.toggle('da-floor-image-container--collapse', isCollapseMode);
        const toggleBtn = imageContainer.querySelector(
            '.da-floor-image-collapse-toggle'
        ) as HTMLButtonElement | null;
        if (!isCollapseMode) {
            imageContainer.classList.remove('is-expanded');
            if (toggleBtn) {
                toggleBtn.setAttribute('aria-expanded', 'false');
                const labelEl = toggleBtn.querySelector('.da-floor-image-collapse-toggle__label');
                if (labelEl) {
                    labelEl.textContent = '展开生成图片';
                }
            }
        }

        const imageBox = imageContainer.querySelector('.da-floor-image-box') as HTMLElement | null;
        if (imageBox) {
            imageBox.style.borderRadius = displayCfg?.rounded === false ? '0px' : '';
        }

        const imgEl = imageContainer.querySelector('.da-floor-image') as HTMLImageElement | null;
        if (imgEl) {
            imgEl.style.maxHeight = displayCfg?.maxHeight ? `${displayCfg.maxHeight}px` : '';
            imgEl.style.maxWidth = displayCfg?.maxWidthPct ? `${displayCfg.maxWidthPct}%` : '';
            imgEl.style.objectFit = displayCfg?.objectFit || '';
            imgEl.classList.toggle('da-floor-image--blurred', displayMode === 'blur');
        }
    }

    /**
     * 延迟调度扫描所有可见消息楼层（防抖等待宿主 DOM 渲染完成）。
     *
     * @param delayMs 防抖等待毫秒数，默认 200ms
     */
    public scheduleScanAllMessages(delayMs = 200): void {
        if (this.isDisposed) {
            return;
        }
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
        if (typeof document === 'undefined' || !settingsStore.getSettings().enabled) {
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
    ): Promise<boolean> {
        const currentSettings = settingsStore.getSettings();
        const check = validateCurrentPresetAssets(currentSettings.activeProvider as ProviderType);
        if (!check.valid) {
            const confirmed = await ConfirmDialog.confirm({
                title: '模型缺失确认',
                message: `当前生图参数预设引用的部分模型未在服务端检测到：\n- ${check.missing.join('\n- ')}\n\n是否仍继续尝试生图？`,
                confirmText: '继续生图',
                cancelText: '取消',
            });
            if (!confirmed) {
                return false;
            }
        }

        const {
            sourceImage: rawSourceImage,
            maskImage: rawMaskImage,
            ...restExtraParams
        } = extraParams || {};
        const mergedParams: Record<string, unknown> = {
            ...restExtraParams,
        };
        if (newNegativePrompt) {
            mergedParams.negativePrompt = newNegativePrompt;
        }

        const submitOptions: SubmitTaskOptions = {
            rawPrompt: newPrompt,
            sourceImage: rawSourceImage as Blob | string | undefined,
            maskImage: rawMaskImage as Blob | string | undefined,
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
            return true;
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
        this.isDisposed = true;
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
