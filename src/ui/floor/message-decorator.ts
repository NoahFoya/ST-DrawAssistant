/**
 * 消息楼层生图组件 UI 门面协调器 (MessageDecorator)。
 *
 * @remarks
 * 执行两阶段幂等渲染：
 * - 阶段 A：委托 `floorCoordinator` 读取宿主上下文、提取指令与档案并计算目标/任务计划；
 * - 阶段 B：通过 `floor-dom-locator`、`archive-capsule-renderer` 与 `slot-renderer` 幂等修补 DOM，
 *   并在异步读图期间若正文容器被外部脚本重绘时完成重绑定（含多指令前序插槽补挂）。
 */

import type { Disposable } from '../types';
import {
    buildFloorSlotKey,
    floorCoordinator,
    type ExtractedFloorCommand,
} from '../../pipeline/floor-coordinator';
import { promptPipeline } from '../../pipeline/prompt-pipeline';
import { sessionLifecycle } from '../../pipeline/session-lifecycle';
import { settingsStore } from '../../store/settings-store';
import { eventBus, type TaskStatusEventData } from '../../util/event-bus';
import { logger } from '../../util/logger';
import { imageActionPanel } from '../media/image-action-panel';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { Toast } from '../feedback/toast';
import { openArchiveConfirmModal } from '../modal/archive-confirm-modal';
import { renderArchiveCapsules } from './archive-capsule-renderer';
import {
    ensureCommandSlotElement,
    FloorObserverController,
    getMessageTextContainer,
    lockPreviouslyDecoratedSlots,
    mountToSlot,
    purgeMessageFloorDom,
    type ObservedLatestFloorState,
} from './floor-dom-locator';
import { replaceCommandsWithFloorSlots } from './floor-helpers';
import { applyDisplaySettingsToContainer, FloorSlotRenderer } from './slot-renderer';
import type { DrawingSlotEntry, DrawingTask, ProviderType, SlotMountTarget } from '@types';

export class MessageDecorator implements Disposable {
    private readonly observerController = new FloorObserverController();
    private readonly slotRenderer: FloorSlotRenderer;
    private readonly promptedArchiveKeys = new Set<string>();
    private readonly pendingArchiveConfirmations = new Set<number>();
    private readonly inFlightDecorations = new Map<number, Promise<void>>();
    private readonly messageGenerations = new Map<number, number>();

    private clearEpoch = 0;
    private isDisposed = false;
    private scanTimer: ReturnType<typeof setTimeout> | null = null;
    private unbindEventListener: (() => void) | null = null;
    private intersectionObserver: IntersectionObserver | null = null;

    public constructor() {
        this.slotRenderer = new FloorSlotRenderer({
            getClearEpoch: () => this.clearEpoch,
            isDisposed: () => this.isDisposed,
            captureMessageToken: (messageId) => this.captureMessageToken(messageId),
            isMessageTokenValid: (messageId, token) => this.isMessageTokenValid(messageId, token),
            runSuppressed: (messageId, fn) => this.observerController.runSuppressed(messageId, fn),
            syncObservedNodesIfTarget: (messageId) => this.syncObservedNodesIfTarget(messageId),
            openImageActionPanel: (messageId, instructionIndex, imageId, displayUrl) =>
                this.openImageActionPanel(messageId, instructionIndex, imageId, displayUrl),
        });
        this.bind();
    }

    /** 绑定或恢复内部事件监听（幂等，用于插件重新激活） */
    public bind(): void {
        this.isDisposed = false;
        if (!this.unbindEventListener) {
            this.listenEvents();
        }
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

    private syncObservedNodesIfTarget(messageId: number): void {
        this.observerController.syncExpectedNodesIfTarget(messageId, () =>
            this.slotRenderer.getElementGroups()
        );
    }

    private updateLatestFloorObserver(
        chatId: string,
        messageId: number,
        swipeId: number,
        mesText: HTMLElement,
        shouldWatch: boolean
    ): void {
        this.observerController.updateLatestFloorObserver({
            chatId,
            messageId,
            swipeId,
            mesText,
            shouldWatch,
            getElementGroups: () => this.slotRenderer.getElementGroups(),
            onCheckNeedsRecovery: (observed) => this.needsObserverRecovery(observed),
            onRecover: (observed) => this.performObserverRecovery(observed),
        });
    }

    private needsObserverRecovery(observedState: ObservedLatestFloorState): boolean {
        if (this.isDisposed || !settingsStore.getSettings().enabled) {
            return false;
        }
        const check = floorCoordinator.isObservedLatestFloorStillValid(
            observedState.chatId,
            observedState.messageId,
            observedState.swipeId,
            false
        );
        if (!check.valid || !check.rawMes) {
            return false;
        }
        const liveInfo = getMessageTextContainer(observedState.messageId);
        const liveMesText = liveInfo?.mesText ?? null;
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
            return false;
        }
        return floorCoordinator.hasDecoratableContent(check.rawMes);
    }

    private async performObserverRecovery(observed: ObservedLatestFloorState): Promise<void> {
        if (this.isDisposed || !settingsStore.getSettings().enabled) {
            return;
        }
        if (this.observerController.getObservedFloor() !== observed) {
            return;
        }

        const inFlight = this.inFlightDecorations.get(observed.messageId);
        if (inFlight) {
            await inFlight.catch(() => undefined);
            if (this.isDisposed || this.observerController.getObservedFloor() !== observed) {
                return;
            }
        }

        const beforeCheck = floorCoordinator.isObservedLatestFloorStillValid(
            observed.chatId,
            observed.messageId,
            observed.swipeId,
            true
        );
        if (!beforeCheck.valid) {
            return;
        }

        await this.decorateMessage(observed.messageId);

        const afterCheck = floorCoordinator.isObservedLatestFloorStillValid(
            observed.chatId,
            observed.messageId,
            observed.swipeId,
            true
        );
        if (this.isDisposed || !afterCheck.valid) {
            return;
        }

        const settings = settingsStore.getSettings();
        if (
            settings.enabled &&
            settings.autoGenerate &&
            !this.pendingArchiveConfirmations.has(observed.messageId) &&
            !this.observerController.stabilityWaitMessages.has(observed.messageId) &&
            floorCoordinator.matchesPendingAutoGenerate(
                observed.chatId,
                observed.messageId,
                observed.swipeId
            )
        ) {
            this.triggerReadyButtons(observed.messageId);
        }
    }

    /** 等待目标 AI 楼层完成宿主生成并达到正文 DOM 稳定状态 */
    public waitForFloorDomStable(
        messageId: number,
        options?: {
            quietMs?: number;
            maxWaitMs?: number;
            signal?: AbortSignal;
            isAborted?: () => boolean;
            isHostGenerating?: () => boolean;
            waitForGenerationEnd?: () => Promise<void>;
        }
    ): Promise<boolean> {
        return this.observerController.waitForFloorDomStable(messageId, {
            ...options,
            isDisposed: this.isDisposed,
        });
    }

    /** 记录指定楼层与分支的一次性待自动生图意图 */
    public markPendingAutoGenerate(chatId: string, messageId: number, swipeId: number): void {
        floorCoordinator.markPendingAutoGenerate(chatId, messageId, swipeId);
    }

    /** 清除指定楼层（或全部）待自动生图标记 */
    public clearPendingAutoGenerate(messageId?: number): void {
        floorCoordinator.clearPendingAutoGenerate(messageId);
    }

    private listenEvents(): void {
        const unbindImageReady = eventBus.on('image:ready', async ({ imageId, target }) => {
            if (!floorCoordinator.isTargetActiveInHost(target)) {
                return;
            }
            const swipeId = target.swipeId ?? 0;
            const slotEntry = sessionLifecycle.getSlotEntry({ ...target, swipeId });
            await this.renderImageToFloor(
                target.messageId,
                imageId,
                target.instructionIndex,
                slotEntry?.imageUrl,
                target.chatId,
                swipeId
            );

            const buttonKey = buildFloorSlotKey(
                target.chatId,
                target.messageId,
                swipeId,
                target.instructionIndex
            );
            const button = this.slotRenderer.activeButtons.get(buttonKey);
            if (button) {
                const hideButtonOnDone = settingsStore.getSettings().ui?.floorButton?.hideOnDone ?? false;
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
            if (!floorCoordinator.isTargetActiveInHost(target)) {
                return;
            }

            const swipeId = target.swipeId ?? 0;
            const buttonKey = buildFloorSlotKey(
                target.chatId,
                target.messageId,
                swipeId,
                target.instructionIndex
            );
            const button = this.slotRenderer.activeButtons.get(buttonKey);
            if (!button) {
                return;
            }

            if (eventData.status === 'failed') {
                button.element.style.display = '';
                button.setState('error', '生成失败，点击重试');
                this.removeSkeleton(target.messageId, target.instructionIndex, target.chatId, swipeId);
                const container = this.slotRenderer.activeImageContainers.get(buttonKey);
                container
                    ?.querySelector('.da-floor-image')
                    ?.classList.remove('da-floor-image--regenerating');
                if (eventData.task.error) {
                    Toast.error('生图任务失败，请点击重试或在「日志与统计」查看详情');
                }
            } else if (eventData.status === 'cancelled') {
                const container = this.slotRenderer.activeImageContainers.get(buttonKey);
                const hasImage = Boolean(container?.querySelector('.da-floor-image'));
                if (!hasImage) {
                    button.element.style.display = '';
                }
                button.setState(hasImage ? 'done' : 'ready');
                this.removeSkeleton(target.messageId, target.instructionIndex, target.chatId, swipeId);
                container
                    ?.querySelector('.da-floor-image')
                    ?.classList.remove('da-floor-image--regenerating');
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
            for (const slotState of this.slotRenderer.activeSlotStates.values()) {
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
                this.observerController.disconnect();
                floorCoordinator.clearPendingAutoGenerate();
                return;
            }
            if (!settings.autoGenerate) {
                floorCoordinator.clearPendingAutoGenerate();
            }
            const displayCfg = settings.ui?.imageDisplay;
            for (const container of this.slotRenderer.activeImageContainers.values()) {
                applyDisplaySettingsToContainer(container, displayCfg);
            }

            const hideButtonOnDone = settings.ui?.floorButton?.hideOnDone ?? false;
            for (const [slotKey, button] of this.slotRenderer.activeButtons.entries()) {
                const slotState = this.slotRenderer.activeSlotStates.get(slotKey);
                if (!slotState || !this.slotRenderer.activeImageContainers.has(slotKey)) {
                    continue;
                }
                const activeTask = floorCoordinator.planMessageDecoration(slotState.target.messageId)?.slotPlans
                    .find((p) => p.slotKey === slotKey)?.activeTask;
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

    /** 检测指定楼层是否包含角色或服装档案，并在满足自动检测条件时弹出即时确认面板 */
    public inspectAndShowArchiveModal(
        messageId: number,
        options?: { onFinished?: () => void }
    ): boolean {
        const pending = floorCoordinator.resolvePendingArchivesForModal(messageId);
        if (!pending) {
            return false;
        }
        const { signature, archives } = pending;
        if (!this.promptedArchiveKeys.has(signature)) {
            if (this.promptedArchiveKeys.size >= 200) {
                const first = this.promptedArchiveKeys.values().next().value;
                if (first) {
                    this.promptedArchiveKeys.delete(first);
                }
            }
            this.promptedArchiveKeys.add(signature);
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

    /** 扫描并处理指定 ID 的消息楼层（单飞合并重入） */
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
                if (this.inFlightDecorations.get(messageId) === decorationPromise) {
                    this.inFlightDecorations.delete(messageId);
                }
            }
        })();

        this.inFlightDecorations.set(messageId, decorationPromise);
        return decorationPromise;
    }

    /** 阶段 B：渲染已持久化楼层图片，并在等待读图期间被外部脚本覆写时回挂整层已渲染插槽 */
    private async reconcileSlotAfterImageRender(options: {
        messageId: number;
        chatId: string;
        swipeId: number;
        token: { clearEpoch: number; generation: number };
        cmd: ExtractedFloorCommand;
        slotElement: HTMLElement;
        slotKey: string;
        entry: DrawingSlotEntry;
        activeTask: DrawingTask | undefined;
    }): Promise<{
        slotElement: HTMLElement;
        hasRenderedImage: boolean;
        liveTextContainer: HTMLElement;
        refreshedSlots?: Map<number, HTMLElement>;
    } | null> {
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

        const liveInfo = getMessageTextContainer(messageId);
        if (!liveInfo) {
            return null;
        }

        const liveTextContainer = liveInfo.mesText;
        let refreshedSlots: Map<number, HTMLElement> | undefined;
        if (!slotElement.isConnected || !liveTextContainer.contains(slotElement)) {
            const liveMes = floorCoordinator.getMessageSnapshot(messageId)?.message.mes;
            const extracted = typeof liveMes === 'string' ? promptPipeline.extractCommands(liveMes) : [];
            const commandsForReplace = extracted.length > 0 ? extracted : [cmd];
            let replacedSlots!: Map<number, HTMLElement>;
            const suppress = (fn: () => void) => this.observerController.runSuppressed(messageId, fn);
            suppress(() => {
                replacedSlots = replaceCommandsWithFloorSlots(liveTextContainer, commandsForReplace);
            });
            slotElement = ensureCommandSlotElement(
                liveTextContainer,
                replacedSlots,
                cmd.instructionIndex,
                suppress
            );
            refreshedSlots = replacedSlots;
            suppress(() => {
                const existingImgContainer = this.slotRenderer.activeImageContainers.get(slotKey);
                if (existingImgContainer) {
                    mountToSlot(slotElement, existingImgContainer, 'visual');
                }

                // 若同一楼层包含多条指令，正文被外部脚本重建时一并回挂其余指令插槽的图片、骨架屏与按钮
                const hideButtonOnDone =
                    settingsStore.getSettings().ui?.floorButton?.hideOnDone ?? false;
                const latestPlans = floorCoordinator.planMessageDecoration(messageId)?.slotPlans ?? [];
                const activeTaskByIdx = new Map(
                    latestPlans.map((p) => [p.instructionIndex, p.activeTask])
                );
                for (const [otherIndex, otherSlotEl] of replacedSlots.entries()) {
                    if (otherIndex === cmd.instructionIndex) {
                        continue;
                    }
                    const otherSlotKey = buildFloorSlotKey(chatId, messageId, swipeId, otherIndex);
                    const otherTask = activeTaskByIdx.get(otherIndex);
                    const otherImgContainer =
                        this.slotRenderer.activeImageContainers.get(otherSlotKey);
                    if (otherImgContainer) {
                        mountToSlot(otherSlotEl, otherImgContainer, 'visual');
                        if (otherTask) {
                            otherImgContainer
                                .querySelector('.da-floor-image')
                                ?.classList.add('da-floor-image--regenerating');
                        }
                    } else {
                        const otherSkeleton = this.slotRenderer.activeSkeletons.get(otherSlotKey);
                        if (otherSkeleton) {
                            mountToSlot(otherSlotEl, otherSkeleton, 'visual');
                        }
                    }

                    const otherButton = this.slotRenderer.activeButtons.get(otherSlotKey);
                    if (otherButton) {
                        const shouldHide = Boolean(
                            otherImgContainer && hideButtonOnDone && !otherTask
                        );
                        otherButton.element.style.display = shouldHide ? 'none' : '';
                        mountToSlot(otherSlotEl, otherButton.element, 'button');
                    }
                }
            });
        }

        const hasRenderedImage = this.slotRenderer.activeImageContainers.has(slotKey);
        if (hasRenderedImage && activeTask) {
            slotElement
                .querySelector('.da-floor-image')
                ?.classList.add('da-floor-image--regenerating');
        }

        return { slotElement, hasRenderedImage, liveTextContainer, refreshedSlots };
    }

    private async performDecorateMessage(messageId: number): Promise<void> {
        if (this.isDisposed || typeof document === 'undefined') {
            return;
        }
        const plan = floorCoordinator.planMessageDecoration(messageId);
        if (!plan) {
            return;
        }
        const containerInfo = getMessageTextContainer(messageId);
        if (!containerInfo) {
            return;
        }

        const targetContainer = containerInfo.mesText;
        const token = this.captureMessageToken(messageId);
        let slotsMap = new Map<number, HTMLElement>();

        const suppress = (fn: () => void) => this.observerController.runSuppressed(messageId, fn);
        suppress(() => {
            renderArchiveCapsules({
                container: targetContainer,
                archives: plan.archives,
                extractionCfg: plan.extractionCfg,
                onBadgeClick: (items) => {
                    openArchiveConfirmModal({ items });
                },
            });

            if (plan.commands.length === 0) {
                for (const slot of targetContainer.querySelectorAll(
                    '.da-floor-action-wrapper, .da-floor-image-container, .da-floor-image-skeleton, .da-floor-slot'
                )) {
                    slot.remove();
                }
                return;
            }

            slotsMap = replaceCommandsWithFloorSlots(targetContainer, plan.commands);
        });

        if (plan.commands.length === 0) {
            if (floorCoordinator.matchesPendingAutoGenerate(plan.chatId, messageId, plan.swipeId)) {
                floorCoordinator.clearPendingAutoGenerate(messageId);
            }
            this.updateLatestFloorObserver(
                plan.chatId,
                messageId,
                plan.swipeId,
                targetContainer,
                plan.isLatestAi && plan.archives.length > 0
            );
            return;
        }

        let hasReadySlot = false;
        let liveTargetContainer = targetContainer;
        for (const slotPlan of plan.slotPlans) {
            const { cmd, target, slotKey, slotEntry, activeTask } = slotPlan;
            const hasSlotEntry = Boolean(slotEntry?.imageId || slotEntry?.imageUrl);

            let slotElement = ensureCommandSlotElement(
                liveTargetContainer,
                slotsMap,
                cmd.instructionIndex,
                suppress
            );

            let hasRenderedImage = false;
            if (hasSlotEntry) {
                const reconciled = await this.reconcileSlotAfterImageRender({
                    messageId,
                    chatId: plan.chatId,
                    swipeId: plan.swipeId,
                    token,
                    cmd,
                    slotElement,
                    slotKey,
                    entry: slotEntry!,
                    activeTask,
                });
                if (!reconciled) {
                    return;
                }
                slotElement = reconciled.slotElement;
                hasRenderedImage = reconciled.hasRenderedImage;
                liveTargetContainer = reconciled.liveTextContainer;
                if (reconciled.refreshedSlots) {
                    slotsMap = reconciled.refreshedSlots;
                }
            } else if (activeTask) {
                this.renderSkeletonToFloor(
                    messageId,
                    cmd.instructionIndex,
                    plan.chatId,
                    plan.swipeId
                );
            }

            if (!hasRenderedImage && !activeTask) {
                hasReadySlot = true;
            }

            this.slotRenderer.mountActionButtonForSlot({
                chatId: plan.chatId,
                messageId,
                swipeId: plan.swipeId,
                target,
                cmd,
                slotKey,
                slotElement,
                hasRenderedImage,
                activeTask,
                hideButtonOnDone: plan.hideButtonOnDone,
            });
        }

        if (
            !hasReadySlot &&
            floorCoordinator.matchesPendingAutoGenerate(plan.chatId, messageId, plan.swipeId)
        ) {
            floorCoordinator.clearPendingAutoGenerate(messageId);
        }

        const finalMesText = getMessageTextContainer(messageId)?.mesText ?? targetContainer;
        this.updateLatestFloorObserver(
            plan.chatId,
            messageId,
            plan.swipeId,
            finalMesText,
            plan.isLatestAi
        );
    }

    /** 触发指定楼层中所有就绪状态生图按钮的原生点击事件 */
    public triggerReadyButtons(messageId: number): void {
        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageDom) {
            return;
        }

        const buttons = messageDom.querySelectorAll<HTMLButtonElement>('.da-floor-action-btn');
        if (buttons.length > 0) {
            floorCoordinator.clearPendingAutoGenerate(messageId);
        }
        for (const btn of buttons) {
            if (btn.getAttribute('data-state') === 'ready') {
                btn.click();
            }
        }
    }

    public renderSkeletonToFloor(
        messageId: number,
        instructionIndex = 0,
        chatId?: string,
        swipeId?: number
    ): void {
        this.slotRenderer.renderSkeleton(messageId, instructionIndex, chatId, swipeId);
    }

    public removeSkeleton(
        messageId: number,
        instructionIndex = 0,
        chatId?: string,
        swipeId?: number
    ): void {
        this.slotRenderer.removeSkeleton(messageId, instructionIndex, chatId, swipeId);
    }

    public renderImageToFloor(
        messageId: number,
        imageId?: string,
        instructionIndex = 0,
        serverImageUrl?: string,
        chatId?: string,
        swipeId?: number
    ): Promise<void> {
        return this.slotRenderer.renderImage(
            messageId,
            imageId,
            instructionIndex,
            serverImageUrl,
            chatId,
            swipeId
        );
    }

    /** 打开楼层图像编辑与操作面板 */
    public async openImageActionPanel(
        messageId: number,
        instructionIndex: number,
        imageId?: string,
        displayUrl?: string
    ): Promise<void> {
        const { imageStorage } = await import('../../store/image-storage');
        const record = imageId ? await imageStorage.getImageRecord(imageId) : undefined;
        const coords = floorCoordinator.resolveSlotCoordinates(messageId);
        const rawPrompt = floorCoordinator.extractSlotRawPrompt(messageId, instructionIndex);

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
                    {
                        chatId: coords.chatId,
                        messageId,
                        swipeId: coords.swipeId,
                        instructionIndex,
                    },
                    newPrompt,
                    newNegPrompt
                );
            },
            onInpaint: async (inpaintData) => {
                return await this.regenerateSlot(
                    {
                        chatId: coords.chatId,
                        messageId,
                        swipeId: coords.swipeId,
                        instructionIndex,
                    },
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

    /** 处理宿主候选分支滑动切换 */
    public async handleMessageSwiped(
        messageId: number,
        swipeId?: number,
        options?: { skipSwipeCancel?: boolean; preserveFloorSlots?: boolean }
    ): Promise<void> {
        const { cancelledCount } = floorCoordinator.processSwipeChange(
            messageId,
            swipeId,
            options
        );
        if (cancelledCount > 0) {
            Toast.info(`已取消上一分支的 ${cancelledCount} 个未完成生图任务`);
        }

        this.handleMessageDeleted(
            messageId,
            options?.preserveFloorSlots ? { preserveFloorSlots: true } : undefined
        );
        await this.decorateMessage(messageId);
    }

    /** 处理消息正文重新编辑事件 */
    public async handleMessageEdited(messageId: number): Promise<void> {
        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        const oldSlotCount = messageDom ? messageDom.querySelectorAll('.da-floor-slot').length : 0;
        const { isStructureChanged } = floorCoordinator.evaluateAndHandleMessageEdit(
            messageId,
            oldSlotCount
        );

        this.handleMessageDeleted(
            messageId,
            isStructureChanged ? undefined : { preserveFloorSlots: true }
        );
        await this.decorateMessage(messageId);
        this.inspectAndShowArchiveModal(messageId);
    }

    /** 宿主删除消息后释放并同步其余幸存楼层 DOM */
    public async resyncAfterMessageDeleted(): Promise<void> {
        const { previouslyDecoratedEls, unlockHeights } = lockPreviouslyDecoratedSlots();

        try {
            this.clearCurrentButtons({ preserveFloorSlots: true });
            const syncEpoch = this.clearEpoch;
            await this.scanAllMessages();

            if (
                this.isDisposed ||
                this.clearEpoch !== syncEpoch ||
                typeof document === 'undefined' ||
                !settingsStore.getSettings().enabled
            ) {
                return;
            }

            const resyncTasks: Promise<void>[] = [];
            for (const mesEl of previouslyDecoratedEls) {
                if (!mesEl.isConnected) {
                    continue;
                }
                this.intersectionObserver?.unobserve(mesEl);
                const mesIdAttr = mesEl.getAttribute('mesid');
                if (mesIdAttr !== null) {
                    const messageId = parseInt(mesIdAttr, 10);
                    if (!Number.isNaN(messageId)) {
                        resyncTasks.push(
                            this.decorateMessage(messageId).catch(() => {
                                // 单个楼层重同步失败不阻断其余楼层恢复
                            })
                        );
                    }
                }
            }
            await Promise.all(resyncTasks);
        } finally {
            unlockHeights();
        }
    }

    /** 清理指定楼层或全部楼层的所有已挂载按钮与容器实例 */
    public handleMessageDeleted(
        messageId?: number,
        options?: { preserveFloorSlots?: boolean }
    ): void {
        if (typeof messageId !== 'number') {
            this.clearCurrentButtons(options);
            return;
        }

        this.bumpMessageGeneration(messageId);
        this.inFlightDecorations.delete(messageId);
        floorCoordinator.clearPendingAutoGenerate(messageId);
        this.pendingArchiveConfirmations.delete(messageId);
        if (this.observerController.getObservedFloor()?.messageId === messageId) {
            this.observerController.disconnect();
        }

        this.slotRenderer.purgeMessageSlots(messageId);
        purgeMessageFloorDom(
            messageId,
            (fn) => this.observerController.runSuppressed(messageId, fn),
            options
        );
    }

    public handleImageDeleted(imageId: string): void {
        this.slotRenderer.handleImageDeleted(imageId);
    }

    public getActiveButtonCount(): number {
        return this.slotRenderer.activeButtons.size;
    }

    public getActiveContainerCount(): number {
        return this.slotRenderer.activeImageContainers.size;
    }

    public getActiveSkeletonCount(): number {
        return this.slotRenderer.activeSkeletons.size;
    }

    public clearCurrentButtons(options?: { preserveFloorSlots?: boolean }): void {
        this.clearEpoch += 1;
        this.observerController.clearAllState();
        floorCoordinator.clearPendingAutoGenerate();
        this.pendingArchiveConfirmations.clear();
        this.messageGenerations.clear();
        this.inFlightDecorations.clear();
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }

        this.slotRenderer.clearAll(options);
        this.promptedArchiveKeys.clear();
    }

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
                { root: null, rootMargin: '200px 0px' }
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

    /** 使用指定提示词对楼层中的特定位置发起重新生成请求 */
    public async regenerateSlot(
        target: SlotMountTarget,
        newPrompt: string,
        newNegativePrompt?: string,
        extraParams?: Record<string, unknown>
    ): Promise<boolean> {
        const currentSettings = settingsStore.getSettings();
        const check = floorCoordinator.validateCurrentPresetAssets(
            currentSettings.activeProvider as ProviderType
        );
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

        const swipeId = target.swipeId ?? 0;
        const containerKey = buildFloorSlotKey(
            target.chatId,
            target.messageId,
            swipeId,
            target.instructionIndex
        );
        const container = this.slotRenderer.activeImageContainers.get(containerKey);
        const imgEl = container?.querySelector('.da-floor-image');
        if (imgEl) {
            imgEl.classList.add('da-floor-image--regenerating');
        } else {
            this.renderSkeletonToFloor(
                target.messageId,
                target.instructionIndex,
                target.chatId,
                swipeId
            );
        }

        try {
            await floorCoordinator.submitSlotTask({
                target,
                rawPrompt: newPrompt,
                negativePrompt: newNegativePrompt,
                extraParams,
            });
            return true;
        } catch (err: unknown) {
            const errMessage = err instanceof Error ? err.message : String(err);
            logger.error(`[MessageDecorator] 重新生成任务提交失败: ${errMessage}`);
            this.removeSkeleton(target.messageId, target.instructionIndex, target.chatId, swipeId);
            imgEl?.classList.remove('da-floor-image--regenerating');
            Toast.error('重新生成任务提交失败，请前往「日志与统计」查看详情');
            throw err;
        }
    }

    /** 释放所有已挂载的楼层组件与事件监听 */
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
