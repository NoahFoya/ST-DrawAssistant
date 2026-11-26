/**
 * ST-DrawAssistant 插件入口与生命周期装配。
 *
 * @remarks
 * 保持入口层薄职责：检测宿主可用性、初始化配置与服务、挂载 UI 外壳，
 * 并将宿主事件绑定与时序协调委托给 {@link HostEventBridge} 与 {@link floorCoordinator}。
 */

import { HostEventBridge, isHostContextAvailable } from './host';
import { AssetSyncCoordinator } from './pipeline/asset-sync-coordinator';
import { floorCoordinator } from './pipeline/floor-coordinator';
import { generationOrchestrator } from './pipeline/generation-orchestrator';
import { hostRegexService } from './pipeline/host-regex-service';
import { lexiconIndexService } from './pipeline/lexicon-index-service';
import { promptInjector } from './pipeline/prompt-injector';
import { sessionLifecycle } from './pipeline/session-lifecycle';
import { settingsStore } from './store/settings-store';
import { urlPool } from './store/url-pool';
import { DrawerEntry, FloatingActionButton } from './ui/entry';
import { Toast, toastService, tooltipService } from './ui/feedback';
import { messageDecorator } from './ui/floor/message-decorator';
import { overlayStack } from './ui/framework/overlay-stack';
import { viewportService } from './ui/layout';
import { imageInfoModal, lightboxModal } from './ui/media';
import { SettingsModal } from './ui/modal/settings-modal';
import { themeService } from './ui/theme';
import { registerDefaultViews } from './ui/views/registry';
import { MESSAGE_SCAN_DEBOUNCE_DELAY_MS } from './config/constants';
import { eventBus } from './util/event-bus';
import { logger } from './util/logger';

export type * from '@types';
export * from './config/constants';
export * from './domain';
export * from './util';
export {
    getHostContext,
    isHostContextAvailable,
    getHostActiveChatId,
    getHostChatMessages,
    getHostChatMessage,
    HostEventBridge,
    parseHostIndex,
    extractHostMessageId,
    discoverHostExtensionTargets,
    postHostExtensionVersion,
    postHostExtensionUpdate,
    extractHostApiError,
    DEFAULT_HOST_EXTENSION_TARGETS,
    type HostExtensionTarget,
    type HostExtensionVersionResponse,
    type HostExtensionUpdateResponse,
    type HostEventCallbacks,
} from './host';
export * from './store';
export * from './provider';
export * from './pipeline';
export * from './ui';

let isInitialized = false;
let initPromise: Promise<void> | null = null;
let lifecycleAbortController: AbortController | null = null;
let settingsModalInstance: SettingsModal | null = null;
let fabInstance: FloatingActionButton | null = null;
let drawerEntryInstance: DrawerEntry | null = null;
let unbindSettingsSync: (() => void) | null = null;
const hostEventBridge = new HostEventBridge();

async function scheduleStableAutoGenerate(params: {
    messageId: number;
    initialChatId: string | undefined;
    initialMessageObj: unknown;
    initialSwipeId: number;
    expectedLifecycleGen: number;
    expectedGenEpoch: number;
}): Promise<void> {
    if (!floorCoordinator.isAutoGenContextValid(params)) {
        messageDecorator.clearPendingAutoGenerate(params.messageId);
        return;
    }

    const controller = new AbortController();
    const untrack = floorCoordinator.trackAutoGenWaitController(controller);
    try {
        const stable = await messageDecorator.waitForFloorDomStable(params.messageId, {
            quietMs: 300,
            maxWaitMs: 3000,
            signal: controller.signal,
            isAborted: () =>
                controller.signal.aborted || !floorCoordinator.isAutoGenContextValid(params),
            isHostGenerating: () => floorCoordinator.isHostGenerating(),
            waitForGenerationEnd: () => floorCoordinator.waitForGenerationEnd(controller.signal),
        });

        if (!stable || controller.signal.aborted || !floorCoordinator.isAutoGenContextValid(params)) {
            messageDecorator.clearPendingAutoGenerate(params.messageId);
            return;
        }

        const messageDom = document.querySelector(`#chat .mes[mesid="${params.messageId}"]`);
        if (messageDom && messageDom.querySelectorAll('.da-floor-action-btn').length === 0) {
            await messageDecorator.decorateMessage(params.messageId);
            if (controller.signal.aborted || !floorCoordinator.isAutoGenContextValid(params)) {
                messageDecorator.clearPendingAutoGenerate(params.messageId);
                return;
            }
        }

        void promptInjector.scheduleSyncToHost();
        messageDecorator.triggerReadyButtons(params.messageId);
    } finally {
        untrack();
    }
}

async function handleCharacterMessageRendered(
    messageId: number,
    type: unknown,
    expectedLifecycleGen: number
): Promise<void> {
    const initialSnapshot = floorCoordinator.getMessageSnapshot(messageId);
    const initialChatId = initialSnapshot?.hostContext.chatId;
    const initialMessageObj = initialSnapshot?.message;
    const initialSwipeId = initialSnapshot?.swipeId ?? 0;

    // 延后一个事件循环，待宿主与同步后处理脚本完成 DOM 重建后再执行楼层装饰
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const settledSnapshot = floorCoordinator.getMessageSnapshot(messageId);
    if (
        floorCoordinator.getLifecycleGeneration() !== expectedLifecycleGen ||
        settledSnapshot?.hostContext.chatId !== initialChatId ||
        settledSnapshot?.message !== initialMessageObj ||
        (settledSnapshot?.swipeId ?? 0) !== initialSwipeId
    ) {
        return;
    }

    const effectiveChatId = initialChatId || 'default_chat';
    const canAutoGenerate = floorCoordinator.consumeAutoGenTicket({
        chatId: effectiveChatId,
        messageId,
        swipeId: initialSwipeId,
        type,
        messageObj: initialMessageObj,
    });
    if (canAutoGenerate) {
        messageDecorator.markPendingAutoGenerate(effectiveChatId, messageId, initialSwipeId);
    } else {
        messageDecorator.clearPendingAutoGenerate(messageId);
    }

    await messageDecorator.decorateMessage(messageId);

    const afterDecorateSnapshot = floorCoordinator.getMessageSnapshot(messageId);
    if (
        floorCoordinator.getLifecycleGeneration() !== expectedLifecycleGen ||
        afterDecorateSnapshot?.hostContext.chatId !== initialChatId ||
        afterDecorateSnapshot?.message !== initialMessageObj ||
        (afterDecorateSnapshot?.swipeId ?? 0) !== initialSwipeId
    ) {
        messageDecorator.clearPendingAutoGenerate(messageId);
        return;
    }

    void promptInjector.scheduleSyncToHost();

    const expectedGenEpoch = floorCoordinator.getGenerationEpoch();
    let modalOpened = false;
    if (type !== 'first_message') {
        modalOpened = messageDecorator.inspectAndShowArchiveModal(messageId, {
            onFinished: () => {
                if (canAutoGenerate) {
                    void scheduleStableAutoGenerate({
                        messageId,
                        initialChatId,
                        initialMessageObj,
                        initialSwipeId,
                        expectedLifecycleGen,
                        expectedGenEpoch,
                    });
                } else {
                    messageDecorator.clearPendingAutoGenerate(messageId);
                }
            },
        });
    }

    const latestSettings = settingsStore.getSettings();
    if (!modalOpened && canAutoGenerate && latestSettings.enabled && latestSettings.autoGenerate) {
        await scheduleStableAutoGenerate({
            messageId,
            initialChatId,
            initialMessageObj,
            initialSwipeId,
            expectedLifecycleGen,
            expectedGenEpoch,
        });
    } else if (!modalOpened) {
        messageDecorator.clearPendingAutoGenerate(messageId);
    }
}

/**
 * 插件单例初始化函数（幂等保护）。
 */
export async function initOnce(): Promise<void> {
    if (isInitialized) {
        return;
    }
    if (initPromise) {
        return initPromise;
    }
    if (typeof window === 'undefined' || !isHostContextAvailable()) {
        if (typeof window !== 'undefined') {
            logger.info('未检测到 SillyTavern 宿主上下文，跳过生命周期挂载');
        }
        return;
    }

    floorCoordinator.resetLifecycle();
    const expectedLifecycleGen = floorCoordinator.getLifecycleGeneration();
    lifecycleAbortController?.abort();
    lifecycleAbortController = new AbortController();
    const currentSignal = lifecycleAbortController.signal;

    initPromise = (async () => {
        try {
            // 1. 从宿主异步初始化配置存储（首次启用时载入静态预设文件）
            try {
                await settingsStore.initializeFromHost();
            } catch (err) {
                logger.error('ST-DrawAssistant 预设初始化失败，已中止挂载:', err);
                Toast.error('默认预设初始化失败，请检查静态预设资源后重试');
                return;
            }

            if (floorCoordinator.getLifecycleGeneration() !== expectedLifecycleGen) {
                return;
            }

            // 2. 恢复核心运行服务并初始化 UI 基础设施
            generationOrchestrator.restore();
            lexiconIndexService.bind();
            messageDecorator.bind();

            viewportService.mount();
            themeService.bindTarget();
            themeService.applyCurrentTheme();
            themeService.listenSettings();
            tooltipService.mount();
            toastService.bindEventBus();

            // 3. 挂载主设置弹窗、悬浮球与扩展抽屉入口
            settingsModalInstance = new SettingsModal();
            registerDefaultViews(settingsModalInstance);
            fabInstance = new FloatingActionButton({
                onClick: () => {
                    settingsModalInstance?.open();
                },
            });
            document.body?.appendChild(fabInstance.element);

            drawerEntryInstance = new DrawerEntry({
                onOpenSettings: () => {
                    settingsModalInstance?.open();
                },
            });
            drawerEntryInstance.mount();

            // 4. 绑定会话与宿主事件桥
            sessionLifecycle.bindHostEvents();
            hostEventBridge.bind({
                onMessageReceived: ({ messageId, type }) => {
                    floorCoordinator.issueAutoGenTicket(messageId, type);
                },
                onGenerationStarted: () => {
                    floorCoordinator.onHostGenerationStarted();
                    promptInjector.syncToHost();
                },
                onGenerationEnded: () => {
                    floorCoordinator.onHostGenerationEnded();
                },
                onGenerationStopped: () => {
                    floorCoordinator.onHostGenerationStopped();
                },
                onBeforeCombinedPrompts: () => {
                    promptInjector.syncToHost();
                },
                onCharacterMessageRendered: ({ messageId, type }) =>
                    handleCharacterMessageRendered(messageId, type, expectedLifecycleGen),
                onUserMessageRendered: ({ messageId }) => {
                    void messageDecorator.decorateMessage(messageId);
                    void promptInjector.scheduleSyncToHost();
                },
                onMessageSent: () => {
                    void promptInjector.scheduleSyncToHost();
                },
                onMessageSwiped: ({ messageId, swipeId }) => {
                    floorCoordinator.clearAutoGenTicket();
                    floorCoordinator.abortActiveAutoGenWaits();
                    void messageDecorator.handleMessageSwiped(messageId, swipeId);
                    void promptInjector.scheduleSyncToHost();
                },
                onMessageSwipeDeleted: ({ messageId, swipeId, newSwipeId }) => {
                    floorCoordinator.handleSwipeDeleted(messageId, swipeId);
                    void messageDecorator.handleMessageSwiped(messageId, newSwipeId, {
                        skipSwipeCancel: true,
                        preserveFloorSlots: true,
                    });
                    void promptInjector.scheduleSyncToHost();
                },
                onMessageEdited: ({ messageId }) => {
                    if (!settingsStore.getSettings().enabled) {
                        return;
                    }
                    void messageDecorator.handleMessageEdited(messageId);
                    void promptInjector.scheduleSyncToHost();
                },
                onMessageDeleted: ({ deletedIndex, remainingCount }) => {
                    floorCoordinator.clearAutoGenTicket();
                    floorCoordinator.abortActiveAutoGenWaits();
                    floorCoordinator.reconcileDeletedMessages({ deletedIndex, remainingCount });
                    void messageDecorator.resyncAfterMessageDeleted();
                    void promptInjector.scheduleSyncToHost();
                },
                onChatChanged: () => {
                    floorCoordinator.clearAutoGenTicket();
                    floorCoordinator.abortActiveAutoGenWaits();
                    messageDecorator.clearCurrentButtons({ preserveFloorSlots: true });
                    messageDecorator.scheduleScanAllMessages(MESSAGE_SCAN_DEBOUNCE_DELAY_MS);
                    void promptInjector.scheduleSyncToHost();
                },
                onChatLoaded: () => {
                    floorCoordinator.clearAutoGenTicket();
                    messageDecorator.scheduleScanAllMessages(MESSAGE_SCAN_DEBOUNCE_DELAY_MS);
                    void promptInjector.scheduleSyncToHost();
                },
                onMoreMessagesLoaded: () => {
                    void messageDecorator.scanAllMessages();
                },
                onAppReady: () => {
                    drawerEntryInstance?.mount();
                    messageDecorator.scheduleScanAllMessages(MESSAGE_SCAN_DEBOUNCE_DELAY_MS);
                },
            });

            // 5. 监听设置更新与总开关切换
            let lastPluginEnabled = settingsStore.getSettings().enabled;
            unbindSettingsSync = eventBus.on('settings:updated', () => {
                const updatedSettings = settingsStore.getSettings();
                const nowEnabled = updatedSettings.enabled;
                if (!nowEnabled || !updatedSettings.autoGenerate) {
                    floorCoordinator.clearAutoGenTicket();
                    floorCoordinator.abortActiveAutoGenWaits();
                }
                if (nowEnabled !== lastPluginEnabled) {
                    lastPluginEnabled = nowEnabled;
                    if (nowEnabled) {
                        messageDecorator.scheduleScanAllMessages(50);
                    } else {
                        hostEventBridge.clearPendingEditFallbackTimers();
                        messageDecorator.clearCurrentButtons({ preserveFloorSlots: true });
                    }
                }
                hostRegexService.syncToHost({ reloadChatOnDisplayChange: true });
                void promptInjector.scheduleSyncToHost();
            });

            // 6. 首屏初始化同步与后台资产预同步
            hostRegexService.syncToHost();
            messageDecorator.scheduleScanAllMessages(MESSAGE_SCAN_DEBOUNCE_DELAY_MS);
            void promptInjector.scheduleSyncToHost();

            const activeProvider = settingsStore.get('activeProvider') || 'comfyui';
            void AssetSyncCoordinator.syncProviderAssets(activeProvider, {
                isManual: false,
                silentIfNoChange: true,
                signal: currentSignal,
            }).catch(() => undefined);

            isInitialized = true;
            logger.info('ST-DrawAssistant 扩展核心生命周期与 UI 系统已就绪');
        } finally {
            initPromise = null;
        }
    })();

    return initPromise;
}

/** SillyTavern 扩展清单激活钩子 */
export async function onActivate(): Promise<void> {
    await initOnce();
}

/** SillyTavern 扩展清单停用钩子 */
export async function onDisable(): Promise<void> {
    disposeExtension();
}

/** 插件全局资源卸载与监听器清理函数 */
export function disposeExtension(): void {
    floorCoordinator.resetLifecycle();
    lifecycleAbortController?.abort();
    lifecycleAbortController = null;
    initPromise = null;

    promptInjector.clearAllFromHost();
    hostEventBridge.dispose();
    if (unbindSettingsSync) {
        unbindSettingsSync();
        unbindSettingsSync = null;
    }

    sessionLifecycle.unbindHostEvents();
    lexiconIndexService.dispose();
    generationOrchestrator.dispose();

    drawerEntryInstance?.dispose();
    drawerEntryInstance = null;

    fabInstance?.dispose();
    fabInstance = null;

    settingsModalInstance?.dispose();
    settingsModalInstance = null;

    messageDecorator.dispose();
    lightboxModal.dispose();
    imageInfoModal.dispose();
    overlayStack.disposeAll();
    tooltipService.dispose();
    viewportService.dispose();
    toastService.dispose();
    themeService.dispose();

    urlPool.revokeAll();
    isInitialized = false;
    logger.info('ST-DrawAssistant 扩展已安全卸载');
}

if (typeof window !== 'undefined' && isHostContextAvailable()) {
    void initOnce();
}
