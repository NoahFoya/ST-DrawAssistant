/**
 * ST-DrawAssistant 插件入口与生命周期管理。
 *
 * @remarks
 * 插件生命周期与宿主事件绑定：
 * 1. 模块导出：导出类型定义、存储中心、服务提供方、任务调度及 UI 组件；
 * 2. 初始化 (initOnce)：
 *    - 宿主环境检查：检测 window.SillyTavern 上下文；
 *    - 配置与主题：初始化配置存储并应用主题；
 *    - UI 挂载：初始化主设置弹窗 (SettingsModal)、悬浮球 (FAB) 与抽屉入口；
 *    - 事件绑定：监听宿主消息接收、滑动、编辑、删除与会话切换事件；
 * 3. 注销 (disposeExtension)：
 *    - 解绑宿主监听器、销毁 UI 组件、释放临时 Object URL 并重置状态。
 */

import { sessionLifecycle } from './pipeline/session-lifecycle';
import { urlPool } from './store/url-pool';
import { settingsStore } from './store/settings-store';
import { themeService } from './ui/theme';
import { SettingsModal } from './ui/modal/settings-modal';
import { registerDefaultViews } from './ui/views/registry';
import { FloatingActionButton, DrawerEntry } from './ui/entry';
import { toastService, Toast, tooltipService } from './ui/feedback';
import { messageDecorator } from './ui/floor/message-decorator';
import { lightboxModal, imageInfoModal } from './ui/media';
import { overlayStack } from './ui/framework/overlay-stack';
import { viewportService } from './ui/layout';
import { generationOrchestrator } from './pipeline/generation-orchestrator';
import { lexiconIndexService } from './pipeline/lexicon-index-service';
import { promptInjector } from './pipeline/prompt-injector';
import { AssetSyncCoordinator } from './pipeline/asset-sync-coordinator';
import { eventBus } from './util/event-bus';
import { logger } from './util/logger';
import { MESSAGE_SCAN_DEBOUNCE_DELAY_MS } from './config/constants';

export type * from '@types';
export * from './config/constants';
export * from './util';
export * from './store';
export * from './provider';
export * from './pipeline';
export * from './ui';

let isInitialized = false;
let initPromise: Promise<void> | null = null;
let lifecycleGeneration = 0;
let settingsModalInstance: SettingsModal | null = null;
let fabInstance: FloatingActionButton | null = null;
let drawerEntryInstance: DrawerEntry | null = null;
const hostEventCleanups: Array<() => void> = [];

/**
 * 插件单例初始化函数。
 *
 * @remarks
 * 负责检测 SillyTavern 宿主环境并挂载全局生命周期事件监听器、UI 设计系统与悬浮操作球。
 * 具备幂等性保护，重复调用直接安全返回。
 */
export async function initOnce(): Promise<void> {
    if (isInitialized) {
        return;
    }

    if (initPromise) {
        return initPromise;
    }

    if (typeof window === 'undefined') {
        return;
    }

    const hostContext = window.SillyTavern?.getContext?.();
    if (!hostContext) {
        logger.info('未检测到 SillyTavern 宿主上下文，跳过生命周期挂载');
        return;
    }

    const currentGen = ++lifecycleGeneration;

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

            // 若在异步载入期间插件已被停用卸载，终止后续 UI 与事件挂载
            if (currentGen !== lifecycleGeneration) {
                return;
            }

            // 恢复全局服务实例监听与调度状态（兼容停用后重新激活）
            generationOrchestrator.restore();
            lexiconIndexService.bind();
            messageDecorator.bind();

            // 2. 初始化视口同步、主题服务与全局浮动提示气泡服务
            viewportService.mount();
            themeService.bindTarget();
            themeService.applyCurrentTheme();
            themeService.listenSettings();
            tooltipService.mount();

            // 3. 实例化主设置弹窗、装配默认视图与常驻悬浮球
            settingsModalInstance = new SettingsModal();
            registerDefaultViews(settingsModalInstance);
            fabInstance = new FloatingActionButton({
                onClick: () => {
                    settingsModalInstance?.open();
                },
            });
            if (document.body) {
                document.body.appendChild(fabInstance.element);
            }

            // 4. 实例化并挂载 SillyTavern 宿主抽屉入口
            drawerEntryInstance = new DrawerEntry({
                onOpenSettings: () => {
                    settingsModalInstance?.open();
                },
            });
            drawerEntryInstance.mount();

            // 5. 绑定宿主会话生命周期监听器
            sessionLifecycle.bindHostEvents();

            // 6. 绑定宿主消息渲染与全生命周期事件
            const eventSource = hostContext.eventSource;
            const eventTypes = hostContext.eventTypes || {};

            if (eventSource) {
                const eventTypesMap = eventTypes as Record<string, string | undefined>;

                const parseHostIndex = (val: unknown): number | undefined => {
                    if (typeof val === 'number') {
                        return Number.isInteger(val) && val >= 0 ? val : undefined;
                    }
                    if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
                        return Number(val.trim());
                    }
                    return undefined;
                };

                const extractMessageId = (data: unknown): number | undefined => {
                    const direct = parseHostIndex(data);
                    if (direct !== undefined) return direct;
                    if (data && typeof data === 'object') {
                        const rec = data as Record<string, unknown>;
                        return parseHostIndex(rec.messageId) ?? parseHostIndex(rec.id);
                    }
                    return undefined;
                };

                const bindHostEvent = (eventType: string, handler: (...args: unknown[]) => void) => {
                    eventSource.on(eventType, handler);
                    hostEventCleanups.push(() => {
                        const source = eventSource as {
                            off?: (t: string, h: (...args: unknown[]) => void) => void;
                            removeListener?: (t: string, h: (...args: unknown[]) => void) => void;
                        };
                        if (typeof source.off === 'function') {
                            source.off(eventType, handler);
                        } else if (typeof source.removeListener === 'function') {
                            source.removeListener(eventType, handler);
                        }
                    });
                };

                // 监听角色消息渲染完成 (CHARACTER_MESSAGE_RENDERED) - 此时楼层 DOM 已挂载就绪，统一执行楼层生图按钮装配、素材提取检测与自动生图调度
                const charRenderedEvent =
                    eventTypesMap.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered';
                bindHostEvent(charRenderedEvent, async (data: unknown, type?: unknown) => {
                    const messageId = extractMessageId(data);
                    if (messageId === undefined) {
                        return;
                    }
                    await messageDecorator.decorateMessage(messageId);
                    void promptInjector.scheduleSyncToHost();

                    // 默认忽略角色开场白 ('first_message') 的自动生图，仅装配楼层生图按钮而不自动触发生成
                    const settings = settingsStore.getSettings();
                    const canAutoGenerate = Boolean(
                        settings.enabled && settings.autoGenerate && type !== 'first_message'
                    );

                    let modalOpened = false;
                    const initialChatId = hostContext.chatId;
                    const initialMessageObj = hostContext.chat?.[messageId];
                    if (type !== 'first_message') {
                        modalOpened = messageDecorator.inspectAndShowArchiveModal(messageId, {
                            onFinished: () => {
                                const latestCtx = window.SillyTavern?.getContext?.();
                                if (
                                    canAutoGenerate &&
                                    latestCtx?.chatId === initialChatId &&
                                    latestCtx?.chat?.[messageId] === initialMessageObj
                                ) {
                                    void promptInjector.scheduleSyncToHost();
                                    messageDecorator.triggerReadyButtons(messageId);
                                }
                            },
                        });
                    }

                    // 若未弹出新档案确认窗且允许自动生图，直接触发当前楼层所有就绪按钮
                    if (!modalOpened && canAutoGenerate) {
                        messageDecorator.triggerReadyButtons(messageId);
                    }
                });

                // 监听用户消息并处理消息内生图指令
                const userRenderedEvent =
                    eventTypesMap.USER_MESSAGE_RENDERED || 'user_message_rendered';
                bindHostEvent(userRenderedEvent, (data: unknown) => {
                    const messageId = extractMessageId(data);
                    if (messageId === undefined) {
                        return;
                    }
                    void messageDecorator.decorateMessage(messageId);
                    void promptInjector.scheduleSyncToHost();
                });

                // 监听用户发送消息后立即同步提示词注入（确保当轮 AI 生成前拿到最新关键词激活状态）
                const msgSentEvent = eventTypesMap.MESSAGE_SENT || 'message_sent';
                bindHostEvent(msgSentEvent, () => {
                    void promptInjector.scheduleSyncToHost();
                });

                // 监听宿主生成启动与提示词组合前事件，在提示词装配前同步写入最新注入内容
                const genStartedEvent =
                    eventTypesMap.GENERATION_STARTED || 'generation_started';
                bindHostEvent(genStartedEvent, () => {
                    promptInjector.syncToHost();
                });

                const beforeCombinedEvent =
                    eventTypesMap.GENERATE_BEFORE_COMBINED_PROMPTS ||
                    'generate_before_combined_prompts';
                bindHostEvent(beforeCombinedEvent, () => {
                    promptInjector.syncToHost();
                });

                // 监听候选分支左右滑动切换 (MESSAGE_SWIPED)
                const swipeEvent = eventTypesMap.MESSAGE_SWIPED || 'message_swiped';
                bindHostEvent(swipeEvent, (data: unknown) => {
                    const messageId = extractMessageId(data);
                    if (messageId === undefined) {
                        return;
                    }
                    const swipeId =
                        data && typeof data === 'object' && 'swipeId' in data
                            ? parseHostIndex((data as { swipeId?: unknown }).swipeId)
                            : undefined;
                    void messageDecorator.handleMessageSwiped(messageId, swipeId);
                    void promptInjector.scheduleSyncToHost();
                });

                // 监听候选分支被删除 (MESSAGE_SWIPE_DELETED)
                const swipeDeletedEvent =
                    eventTypesMap.MESSAGE_SWIPE_DELETED || 'message_swipe_deleted';
                bindHostEvent(swipeDeletedEvent, (data: unknown) => {
                    if (data && typeof data === 'object') {
                        const payload = data as {
                            messageId?: unknown;
                            swipeId?: unknown;
                            newSwipeId?: unknown;
                        };
                        const messageId = extractMessageId(payload);
                        if (messageId === undefined) {
                            return;
                        }
                        const deletedSwipeId = parseHostIndex(payload.swipeId);
                        const newSwipeId = parseHostIndex(payload.newSwipeId);
                        const chatId = hostContext.chatId || 'default_chat';
                        if (deletedSwipeId !== undefined) {
                            generationOrchestrator.cancelTasksBySwipe(
                                chatId,
                                messageId,
                                deletedSwipeId
                            );
                        }
                        void messageDecorator.handleMessageSwiped(messageId, newSwipeId);
                        void promptInjector.scheduleSyncToHost();
                    }
                });

                // 监听消息正文编辑完成 (MESSAGE_UPDATED / MESSAGE_EDITED 去重同时绑定，防止短路漏绑)
                const msgEditEvents = new Set<string>([
                    eventTypesMap.MESSAGE_UPDATED || 'message_updated',
                    eventTypesMap.MESSAGE_EDITED || 'message_edited',
                ]);
                for (const evtName of msgEditEvents) {
                    bindHostEvent(evtName, (data: unknown) => {
                        const messageId = extractMessageId(data);
                        if (messageId === undefined) {
                            return;
                        }
                        void messageDecorator.handleMessageEdited(messageId);
                        void promptInjector.scheduleSyncToHost();
                    });
                }

                // 监听消息删除 (MESSAGE_DELETED) - 宿主传递删除后消息总数 (newChatLength)，并在 DOM 中同步更新 mesid
                const msgDeletedEvent = eventTypesMap.MESSAGE_DELETED || 'message_deleted';
                bindHostEvent(msgDeletedEvent, (data: unknown) => {
                    const chatId = hostContext.chatId || 'default_chat';
                    if (typeof data === 'number') {
                        generationOrchestrator.cancelTasksOutOfRange(chatId, data);
                    }
                    void messageDecorator.resyncAfterMessageDeleted();
                    void promptInjector.scheduleSyncToHost();
                });

                // 监听会话变更与初次载入
                const chatChangedEvent = eventTypes.CHAT_CHANGED || 'chat_id_changed';
                bindHostEvent(chatChangedEvent, () => {
                    messageDecorator.clearCurrentButtons();
                    messageDecorator.scheduleScanAllMessages(MESSAGE_SCAN_DEBOUNCE_DELAY_MS);
                    void promptInjector.scheduleSyncToHost();
                });

                const chatLoadedEvent = eventTypes.CHAT_LOADED || 'chatLoaded';
                bindHostEvent(chatLoadedEvent, () => {
                    messageDecorator.scheduleScanAllMessages(MESSAGE_SCAN_DEBOUNCE_DELAY_MS);
                    void promptInjector.scheduleSyncToHost();
                });

                const moreLoadedEvent = eventTypes.MORE_MESSAGES_LOADED || 'more_messages_loaded';
                bindHostEvent(moreLoadedEvent, () => {
                    void messageDecorator.scanAllMessages();
                });

                // 监听宿主就绪事件，延迟重试挂载抽屉入口并触发全量楼层扫描
                for (const readyEvt of [
                    eventTypes.APP_INITIALIZED || 'app_initialized',
                    eventTypes.APP_READY || 'app_ready',
                ]) {
                    bindHostEvent(readyEvt, () => {
                        drawerEntryInstance?.mount();
                        messageDecorator.scheduleScanAllMessages(MESSAGE_SCAN_DEBOUNCE_DELAY_MS);
                    });
                }
            }

            // 监听设置变更：同步四通道提示词注入，并在总开关切换时及时挂载/清理楼层装饰
            let lastPluginEnabled = settingsStore.getSettings().enabled;
            const unbindSettingsSync = eventBus.on('settings:updated', () => {
                const nowEnabled = settingsStore.getSettings().enabled;
                if (nowEnabled !== lastPluginEnabled) {
                    lastPluginEnabled = nowEnabled;
                    if (nowEnabled) {
                        messageDecorator.scheduleScanAllMessages(50);
                    } else {
                        messageDecorator.clearCurrentButtons();
                    }
                }
                void promptInjector.scheduleSyncToHost();
            });
            hostEventCleanups.push(unbindSettingsSync);

            // 启动时序补偿：宿主会话载入与插件脚本激活为异步并发，初始化就绪后主动触发初次全量扫描与提示词注入，保证首屏同步
            messageDecorator.scheduleScanAllMessages(MESSAGE_SCAN_DEBOUNCE_DELAY_MS);
            void promptInjector.scheduleSyncToHost();

            // 7. 启动时在后台同步当前激活服务的资产并检查预设有效性
            const activeProvider = settingsStore.get('activeProvider') || 'comfyui';
            void AssetSyncCoordinator.syncProviderAssets(activeProvider, {
                isManual: false,
                silentIfNoChange: true,
            });

            isInitialized = true;
            logger.info('ST-DrawAssistant 扩展核心生命周期与 UI 系统已就绪');
        } finally {
            initPromise = null;
        }
    })();

    return initPromise;
}

/**
 * SillyTavern 扩展清单规范激活钩子。
 *
 * @remarks
 * 由 manifest.json 中的 hooks.activate 配置项指定调用。
 */
export async function onActivate(): Promise<void> {
    await initOnce();
}

/**
 * SillyTavern 扩展清单规范停用钩子。
 *
 * @remarks
 * 由 manifest.json 中的 hooks.disable 配置项指定调用。
 */
export async function onDisable(): Promise<void> {
    disposeExtension();
}

/**
 * 插件全局资源卸载与监听器清理函数。
 *
 * @remarks
 * 解绑全部宿主事件，注销 UI 弹窗与悬浮球，释放 Object URL 内存映射，重置初始化状态。
 */
export function disposeExtension(): void {
    lifecycleGeneration++;
    initPromise = null;

    // 1. 解绑宿主全局事件并清理已注入的扩展提示词分桶
    promptInjector.clearAllFromHost();
    for (const cleanup of hostEventCleanups) {
        try {
            cleanup();
        } catch {
            // 忽略清理异常
        }
    }
    hostEventCleanups.length = 0;

    sessionLifecycle.unbindHostEvents();
    lexiconIndexService.dispose();
    generationOrchestrator.dispose();

    // 2. 销毁 UI 组件
    if (drawerEntryInstance) {
        drawerEntryInstance.dispose();
        drawerEntryInstance = null;
    }

    if (fabInstance) {
        fabInstance.dispose();
        fabInstance = null;
    }

    if (settingsModalInstance) {
        settingsModalInstance.dispose();
        settingsModalInstance = null;
    }

    messageDecorator.dispose();
    lightboxModal.dispose();
    imageInfoModal.dispose();
    overlayStack.clear();
    tooltipService.dispose();
    viewportService.dispose();
    toastService.dispose();
    themeService.dispose();

    // 3. 释放 Object URL 内存映射
    urlPool.revokeAll();

    isInitialized = false;
    logger.info('ST-DrawAssistant 扩展已安全卸载');
}

// 浏览器环境下自动检测并尝试自激活
if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
    void initOnce();
}
