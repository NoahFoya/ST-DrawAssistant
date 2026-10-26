/**
 * 消息楼层绘图组件调度器 (MessageDecorator)。
 *
 * 负责解析消息中的绘图指令标签，管理插槽内的动作按钮、骨架屏与图片展示容器：
 * - 解析消息正文中的绘图指令并替换为插槽节点；
 * - 管理插槽内的生图按钮与生成中骨架屏；
 * - 出图就绪后原位展示图片，并支持全屏预览与重绘面板；
 * - 响应宿主消息删除、编辑与分支滑动事件，清理对应实例。
 */

import type { Disposable } from '../types';
import { FloorActionButton } from './floor-action-button';
import { promptPipeline } from '../../pipeline/prompt-pipeline';
import { generationOrchestrator, type SubmitTaskOptions } from '../../pipeline/generation-orchestrator';
import { settingsStore } from '../../store/settings-store';
import { imageStorage } from '../../store/image-storage';
import { urlPool } from '../../store/url-pool';
import { lightboxModal } from '../media/lightbox-modal';
import { imageActionPanel } from '../media/image-action-panel';
import { Toast } from '../feedback/toast';
import { eventBus, type TaskStatusEventData } from '../../util/event-bus';
import { sessionLifecycle } from '../../pipeline/session-lifecycle';
import { logger } from '../../util/logger';
import type { ProviderType, SlotMountTarget } from '@types';

export class MessageDecorator implements Disposable {
    /** 活跃的楼层动作按钮实例映射：Key 为 `${chatId}_${messageId}_${swipeId}_${instructionIndex}` */
    private readonly activeButtons = new Map<string, FloorActionButton>();

    /** 活跃的楼层图片呈现容器实例映射：Key 为 `${chatId}_${messageId}_${swipeId}_${instructionIndex}` */
    private readonly activeImageContainers = new Map<string, HTMLElement>();

    /** 活跃的楼层骨架屏占位元素映射：Key 为 `${chatId}_${messageId}_${swipeId}_${instructionIndex}` */
    private readonly activeSkeletons = new Map<string, HTMLElement>();

    /** 防抖扫描定时器 */
    private scanTimer: ReturnType<typeof setTimeout> | null = null;
    private unbindEventListener: (() => void) | null = null;

    public constructor() {
        this.listenEvents();
    }

    /**
     * 生成插槽唯一标识 Key。
     */
    private buildSlotKey(chatId: string, messageId: number, swipeId: number, instructionIndex: number): string {
        return `${chatId}_${messageId}_${swipeId}_${instructionIndex}`;
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

            // 1. 在消息 DOM 中原位渲染呈现生成的图像（或替换骨架屏）
            await this.renderImageToFloor(
                target.messageId,
                imageId,
                target.instructionIndex,
                undefined,
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
                button.setState('ready');
                this.removeSkeleton(target.messageId, target.instructionIndex, target.chatId, swipeId);
                const container = this.activeImageContainers.get(buttonKey);
                container?.querySelector('.da-floor-image')?.classList.remove('da-floor-image--regenerating');
                Toast.info('生图任务已取消');
            } else if (eventData.status === 'generating') {
                button.setState('generating');
            } else if (eventData.status === 'pending') {
                button.setState('pending');
            }
        });

        this.unbindEventListener = () => {
            unbindImageReady();
            unbindTaskStatus();
        };
    }

    /**
     * 遍历容器内的文本节点，将绘图指令文本原位安全拆分替换为插槽元素。
     *
     * @param container 消息文本宿主 DOM 容器 (.mes_text)
     * @param commands 提取出的绘图指令列表
     * @returns 映射字典：instructionIndex -> HTMLSlotElement
     */
    private replaceCommandsWithSlots(
        container: HTMLElement,
        commands: ReturnType<typeof promptPipeline.extractCommands>
    ): Map<number, HTMLElement> {
        const slotsMap = new Map<number, HTMLElement>();
        if (!container || commands.length === 0) {
            return slotsMap;
        }

        // 先检查是否已有现成插槽
        for (const cmd of commands) {
            const existing = container.querySelector(
                `.da-floor-slot[data-instruction-index="${cmd.instructionIndex}"]`
            ) as HTMLElement | null;
            if (existing) {
                slotsMap.set(cmd.instructionIndex, existing);
            }
        }

        // 若全部插槽已就绪，直接返回
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
                    break;
                }
            }

            if (!targetTextNode || !targetTextNode.parentNode || matchIndex === -1) {
                continue;
            }

            const parentNode = targetTextNode.parentNode;
            const textContent = targetTextNode.nodeValue || '';
            const beforeText = textContent.substring(0, matchIndex);
            const afterText = textContent.substring(matchIndex + cmd.rawMatch.length);

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
     * 扫描并处理指定 ID 的消息楼层：解析生图指令、挂载动作按钮与呈现生成图片。
     *
     * @param messageId 目标消息楼层 ID
     */
    public async decorateMessage(messageId: number): Promise<void> {
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

        // 1. 提取消息正文中的绘图指令标签
        const commands = promptPipeline.extractCommands(message.mes);
        if (commands.length === 0) {
            return;
        }

        // 2. 将正文中的指令文本原位拆分替换为插槽容器
        const slotsMap = this.replaceCommandsWithSlots(targetContainer, commands);

        // 3. 读取当前出图后隐藏按钮配置
        const settings = settingsStore.getSettings();
        const hideButtonOnDone = settings.ui?.floorButton?.hideOnDone ?? false;

        const drawingsMap = message.extra?.drawings?.[swipeId];

        for (const cmd of commands) {
            const slotElement = slotsMap.get(cmd.instructionIndex) || targetContainer;
            const slotKey = this.buildSlotKey(chatId, messageId, swipeId, cmd.instructionIndex);
            const target: SlotMountTarget = {
                chatId,
                messageId,
                swipeId,
                instructionIndex: cmd.instructionIndex,
            };

            const entry = drawingsMap?.[cmd.instructionIndex];
            const activeTask = generationOrchestrator.getActiveTaskByTarget(target);
            const hasSlotEntry = Boolean(entry?.imageId || entry?.imageUrl);

            let hasRenderedImage = false;
            if (hasSlotEntry) {
                // 渲染插槽图片，若图片正在重新生成中则添加相应样式
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
                            await generationOrchestrator.submitTask(submitOptions);
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
     * 在插槽内挂载骨架屏。
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
     * 移除指定插槽的骨架屏。
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
     * @param instructionIndex 指令插槽索引 (默认 0)
     * @param serverImageUrl 可选的服务端静态相对路径
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
                    existingContainer.remove();
                    this.activeImageContainers.delete(containerKey);
                }
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

        // 已有图片容器时直接替换图片地址并恢复样式
        const existingContainer = this.activeImageContainers.get(containerKey);
        const existingImg = existingContainer?.querySelector('.da-floor-image') as HTMLImageElement | null;
        if (existingContainer && existingImg) {
            existingImg.src = displayUrl;
            existingImg.classList.remove('da-floor-image--regenerating');
            logger.info(`已更新楼层 #${messageId} 图像 (插槽: ${instructionIndex})`);
            return;
        }

        const settings = settingsStore.getSettings();
        const displayCfg = settings.ui?.imageDisplay;

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
        imgEl.src = displayUrl;
        imgEl.alt = 'AI 生成图像';
        imgEl.loading = 'lazy';

        const isLightboxEnabled = settings.ui?.lightbox?.enabled ?? true;
        if (isLightboxEnabled) {
            imgEl.style.cursor = 'zoom-in';
            // 点击大图全屏画廊预览
            imgEl.addEventListener('click', (e) => {
                e.stopPropagation();
                lightboxModal.open(displayUrl, { imageId });
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

        const isImageActionPanelEnabled = settings.ui?.imageActionPanel?.enabled ?? true;
        if (isImageActionPanelEnabled) {
            // 桌面端鼠标右键呼出图片操作面板
            imageBox.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                void this.openImageActionPanel(messageId, instructionIndex, imageId, displayUrl);
            });

            // 移动端长按手势呼出图片操作面板 (500ms)
            let touchTimer: ReturnType<typeof setTimeout> | null = null;
            imageBox.addEventListener(
                'touchstart',
                (e) => {
                    if (e.touches.length !== 1) return;
                    touchTimer = setTimeout(() => {
                        touchTimer = null;
                        void this.openImageActionPanel(messageId, instructionIndex, imageId, displayUrl);
                    }, 500);
                },
                { passive: true }
            );

            const cancelTouch = () => {
                if (touchTimer) {
                    clearTimeout(touchTimer);
                    touchTimer = null;
                }
            };

            imageBox.addEventListener('touchend', cancelTouch, { passive: true });
            imageBox.addEventListener('touchcancel', cancelTouch, { passive: true });
            imageBox.addEventListener('touchmove', cancelTouch, { passive: true });
        }

        imageBox.appendChild(imgEl);

        // 3. 构建右上角悬浮操作胶囊
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'da-floor-image__actions';

        // 放大预览按钮 (仅在开启大图预览时挂载)
        if (isLightboxEnabled) {
            const zoomBtn = document.createElement('button');
            zoomBtn.type = 'button';
            zoomBtn.className = 'da-floor-image__action-btn';
            zoomBtn.title = '放大预览';
            zoomBtn.textContent = '🔍';
            zoomBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                lightboxModal.open(displayUrl, { imageId });
            });
            actionsContainer.appendChild(zoomBtn);
        }

        // 图像提示词微调与重绘操作按钮 (仅在开启操作栏时挂载)
        if (isImageActionPanelEnabled) {
            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.className = 'da-floor-image__action-btn';
            actionBtn.title = '图像提示词微调与重绘';
            actionBtn.textContent = '⚙️';
            actionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.openImageActionPanel(messageId, instructionIndex, imageId, displayUrl);
            });
            actionsContainer.appendChild(actionBtn);
        }

        // 保存/下载按钮
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'da-floor-image__action-btn';
        downloadBtn.title = '下载图片';
        downloadBtn.textContent = '💾';
        downloadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const a = document.createElement('a');
                a.href = displayUrl!;
                a.download = `st_draw_${Date.now()}.png`;
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

        // 4. 定位对应的 .da-floor-slot 元素进行原位插入
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

        logger.info(`已成功在楼层 #${messageId} 挂载生成图像 (插槽: ${instructionIndex})`);
    }

    /**
     * 打开楼层图像提示词微调与原位重绘操作面板。
     *
     * @param messageId 宿主消息楼层 ID
     * @param instructionIndex 插槽索引
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
        const swipeId = hostContext?.chat?.[messageId]?.swipe_id ?? 0;

        imageActionPanel.open({
            messageId,
            instructionIndex,
            imageId,
            imageUrl: displayUrl,
            prompt: record?.metadata?.prompt,
            negativePrompt: record?.metadata?.negativePrompt,
            record,
            onRegenerate: async (newPrompt, newNegPrompt) => {
                await this.regenerateSlot(
                    { chatId: currentChatId, messageId, swipeId, instructionIndex },
                    newPrompt,
                    newNegPrompt
                );
            },
        });
    }

    /**
     * 处理宿主候选分支滑动切换 (Swipe)，更新对应分支的指令与图片显示。
     *
     * @param messageId 目标消息楼层 ID
     * @param _swipeId 分支滑动索引
     */
    public async handleMessageSwiped(messageId: number, _swipeId?: number): Promise<void> {
        this.handleMessageDeleted(messageId);
        await this.decorateMessage(messageId);
    }

    /**
     * 处理消息正文重新编辑事件，同步更新提取的生图提示词与按钮。
     *
     * @param messageId 目标消息楼层 ID
     */
    public async handleMessageEdited(messageId: number): Promise<void> {
        this.handleMessageDeleted(messageId);
        await this.decorateMessage(messageId);
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

        const matchPart = `_${messageId}_`;
        for (const [key, btn] of this.activeButtons.entries()) {
            if (key.includes(matchPart)) {
                btn?.dispose?.();
                this.activeButtons.delete(key);
            }
        }

        for (const [key, container] of this.activeImageContainers.entries()) {
            if (key.includes(matchPart)) {
                container?.remove?.();
                this.activeImageContainers.delete(key);
            }
        }

        for (const [key, skeleton] of this.activeSkeletons.entries()) {
            if (key.includes(matchPart)) {
                skeleton?.remove?.();
                this.activeSkeletons.delete(key);
            }
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

        for (const skeleton of this.activeSkeletons.values()) {
            try {
                skeleton.remove();
            } catch {
                // 忽略注销异常
            }
        }
        this.activeSkeletons.clear();
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
     * 即时全量扫描当前会话可见楼层。
     */
    public async scanAllMessages(): Promise<void> {
        if (typeof document === 'undefined') {
            return;
        }

        const messageDoms = document.querySelectorAll('#chat .mes[mesid]');
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
     * 使用指定提示词对楼层中的特定插槽发起重绘请求。
     *
     * @param target 目标插槽坐标
     * @param newPrompt 编辑后的新提示词
     * @param newNegativePrompt 可选的反向提示词
     */
    public async regenerateSlot(
        target: SlotMountTarget,
        newPrompt: string,
        newNegativePrompt?: string
    ): Promise<void> {
        const currentSettings = settingsStore.getSettings();
        const submitOptions: SubmitTaskOptions = {
            rawPrompt: newPrompt,
            providerType: currentSettings.activeProvider as ProviderType,
            target,
            parameters: newNegativePrompt ? { negativePrompt: newNegativePrompt } : undefined,
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
            logger.error(`[MessageDecorator] 重绘任务提交失败: ${errMessage}`);
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
