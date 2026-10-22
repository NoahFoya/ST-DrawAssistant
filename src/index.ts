/**
 * ST-DrawAssistant 插件核心导出与全系统生命周期激活入口。
 *
 * @remarks
 * 插件生命周期与宿主装配体系：
 * 1. 模块导出：聚合导出领域模型定义、网络与日志基础设施、持久化存储中心、服务提供方驱动以及 UI 组件库；
 * 2. 幂等初始化 (initOnce)：
 *    - 宿主探测：非浏览器环境或未探测到 window.SillyTavern 上下文时安全跳过；
 *    - 状态与主题：从宿主初始化配置存储，绑定 CSS 变量与主题服务；
 *    - UI 装配：装配主设置弹窗 (SettingsModal)、常驻悬浮球 (FAB) 与宿主左侧抽屉入口 (DrawerEntry)；
 *    - 事件协同：绑定会话生命周期与宿主消息渲染（MESSAGE_RECEIVED, MESSAGE_SWIPED, CHAT_CHANGED 等）事件；
 * 3. 完整注销 (disposeExtension)：
 *    - 解绑宿主监听器 -> 销毁 UI 组件树 -> 批量回收内存中 Object URL (UrlPool) -> 重置初始化标识。
 */

import { sessionLifecycle } from './pipeline/session-lifecycle';
import { urlPool } from './store/url-pool';
import { settingsStore } from './store/settings-store';
import { themeService } from './ui/theme';
import { SettingsModal } from './ui/modal/settings-modal';
import { registerDefaultViews } from './ui/views/registry';
import { FloatingActionButton, DrawerEntry } from './ui/entry';
import { toastService } from './ui/feedback/toast';
import { messageDecorator } from './ui/floor/message-decorator';
import { lightboxModal, imageInfoModal } from './ui/media';
import { promptPipeline } from './pipeline/prompt-pipeline';
import { generationOrchestrator } from './pipeline/generation-orchestrator';
import { logger } from './util/logger';
import type { ProviderType } from '@types';

export type * from '@types';
export * from './config/constants';
export * from './util';
export * from './store';
export * from './provider';
export * from './pipeline';
export * from './ui';

let isInitialized = false;
let settingsModalInstance: SettingsModal | null = null;
let fabInstance: FloatingActionButton | null = null;
let drawerEntryInstance: DrawerEntry | null = null;
const hostEventCleanups: Array<() => void> = [];

/**
 * 获取当前全局设置弹窗实例
 */
export function getSettingsModal(): SettingsModal | null {
    return settingsModalInstance;
}

/**
 * 获取当前全局悬浮球实例
 */
export function getFloatingActionButton(): FloatingActionButton | null {
    return fabInstance;
}

/**
 * 获取当前宿主抽屉入口实例
 */
export function getDrawerEntry(): DrawerEntry | null {
    return drawerEntryInstance;
}

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

    if (typeof window === 'undefined') {
        return;
    }

    const hostContext = window.SillyTavern?.getContext?.();
    if (!hostContext) {
        logger.info('未检测到 SillyTavern 宿主上下文，跳过生命周期挂载');
        return;
    }

    // 1. 从宿主初始化配置存储
    settingsStore.initializeFromHost();

    // 2. 初始化主题服务与视觉变量
    themeService.bindTarget();
    themeService.applyCurrentTheme();
    themeService.listenSettings();

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

        const extractMessageId = (data: unknown): number => {
            if (typeof data === 'number') return data;
            if (data && typeof data === 'object') {
                const rec = data as Record<string, unknown>;
                if (typeof rec.messageId === 'number') return rec.messageId;
                if (typeof rec.id === 'number') return rec.id;
            }
            return 0;
        };

        const bindHostEvent = (eventType: string, handler: (...args: any[]) => void) => {
            eventSource.on(eventType, handler);
            hostEventCleanups.push(() => {
                if (typeof eventSource.off === 'function') {
                    eventSource.off(eventType, handler);
                } else if ('removeListener' in eventSource && typeof (eventSource as { removeListener?: unknown }).removeListener === 'function') {
                    (eventSource as { removeListener: (t: string, h: (...args: any[]) => void) => void }).removeListener(eventType, handler);
                }
            });
        };

        // 监听新回复接收 (MESSAGE_RECEIVED) - 官方标准业务生命周期钩子，触发自动生图调度
        const msgReceivedEvent = eventTypesMap.MESSAGE_RECEIVED || 'message_received';
        bindHostEvent(msgReceivedEvent, async (data: unknown) => {
            const messageId = extractMessageId(data);
            const settings = settingsStore.getSettings();
            if (!settings.enabled || !settings.autoGenerate) {
                return;
            }

            const currentChat = hostContext.chat;
            if (!Array.isArray(currentChat) || !currentChat[messageId]) {
                return;
            }

            const message = currentChat[messageId];
            if (!message || typeof message.mes !== 'string') {
                return;
            }

            const commands = promptPipeline.extractCommands(message.mes);
            if (commands.length === 0) {
                return;
            }

            const chatId = hostContext.chatId || 'default_chat';
            const swipeId = message.swipe_id ?? 0;
            const drawingsMap = message.extra?.drawings?.[swipeId];

            for (const cmd of commands) {
                // 若该插槽已有图像资产，跳过自动派发
                if (drawingsMap?.[cmd.instructionIndex]?.imageId || drawingsMap?.[cmd.instructionIndex]?.imageUrl) {
                    continue;
                }

                try {
                    await generationOrchestrator.submitTask({
                        rawPrompt: cmd.promptText,
                        providerType: settings.activeProvider as ProviderType,
                        target: {
                            chatId,
                            messageId,
                            swipeId,
                            instructionIndex: cmd.instructionIndex,
                        },
                    });
                } catch (err) {
                    logger.error(`[AutoGenerate] 自动派发生图任务失败 (#${messageId}, 插槽 ${cmd.instructionIndex}):`, err);
                }
            }
        });

        // 监听角色与用户消息原位渲染
        const charRenderedEvent = eventTypesMap.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered';
        bindHostEvent(charRenderedEvent, (messageId: number) => {
            void messageDecorator.decorateMessage(messageId);
        });

        const userRenderedEvent = eventTypesMap.USER_MESSAGE_RENDERED || 'user_message_rendered';
        bindHostEvent(userRenderedEvent, (messageId: number) => {
            void messageDecorator.decorateMessage(messageId);
        });

        // 监听候选分支左右滑动切换 (Swipe)
        const swipeEvent = eventTypesMap.MESSAGE_SWIPED || 'message_swiped';
        bindHostEvent(swipeEvent, (data: unknown) => {
            const messageId = typeof data === 'number'
                ? data
                : (data && typeof data === 'object' && 'messageId' in data && typeof (data as { messageId?: unknown }).messageId === 'number'
                    ? (data as { messageId: number }).messageId
                    : 0);
            const swipeId = data && typeof data === 'object' && 'swipeId' in data && typeof (data as { swipeId?: unknown }).swipeId === 'number'
                ? (data as { swipeId: number }).swipeId
                : undefined;
            void messageDecorator.handleMessageSwiped(messageId, swipeId);
        });

        // 监听消息正文编辑完成 (MESSAGE_UPDATED / MESSAGE_EDITED)
        const msgUpdatedEvent = eventTypesMap.MESSAGE_UPDATED || eventTypesMap.MESSAGE_EDITED || 'message_updated';
        bindHostEvent(msgUpdatedEvent, (data: unknown) => {
            const messageId = extractMessageId(data);
            void messageDecorator.handleMessageEdited(messageId);
        });

        // 监听消息删除 (MESSAGE_DELETED)
        const msgDeletedEvent = eventTypesMap.MESSAGE_DELETED || 'message_deleted';
        bindHostEvent(msgDeletedEvent, (data: unknown) => {
            const messageId = typeof data === 'number'
                ? data
                : (data && typeof data === 'object' && 'messageId' in data && typeof (data as { messageId?: unknown }).messageId === 'number'
                    ? (data as { messageId: number }).messageId
                    : undefined);
            messageDecorator.handleMessageDeleted(messageId);
        });

        // 监听会话变更与初次载入（任务后台静默执行持久化存储，重回会话或重新加载时基于 imageId 找回）
        const chatChangedEvent = eventTypes.CHAT_CHANGED || 'chat_id_changed';
        bindHostEvent(chatChangedEvent, () => {
            messageDecorator.clearCurrentButtons();
            messageDecorator.scheduleScanAllMessages(300);
        });

        const chatLoadedEvent = eventTypes.CHAT_LOADED || 'chatLoaded';
        bindHostEvent(chatLoadedEvent, () => {
            messageDecorator.scheduleScanAllMessages(150);
        });

        const moreLoadedEvent = eventTypes.MORE_MESSAGES_LOADED || 'more_messages_loaded';
        bindHostEvent(moreLoadedEvent, () => {
            void messageDecorator.scanAllMessages();
        });

        // 监听宿主就绪事件，延迟重试挂载抽屉入口
        const appInitEvent = eventTypes.APP_INITIALIZED || 'app_initialized';
        bindHostEvent(appInitEvent, () => {
            drawerEntryInstance?.mount();
        });

        const appReadyEvent = eventTypes.APP_READY || 'app_ready';
        bindHostEvent(appReadyEvent, () => {
            drawerEntryInstance?.mount();
        });
    }

    isInitialized = true;
    logger.info('ST-DrawAssistant 扩展核心生命周期与 UI 系统已就绪');
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
 * 插件全局资源卸载与监听器清理函数。
 *
 * @remarks
 * 解绑全部宿主事件，注销 UI 弹窗与悬浮球，释放 Object URL 内存映射，重置初始化状态。
 */
export function disposeExtension(): void {
    // 1. 解绑宿主全局事件
    for (const cleanup of hostEventCleanups) {
        try {
            cleanup();
        } catch {
            // 忽略清理异常
        }
    }
    hostEventCleanups.length = 0;

    sessionLifecycle.unbindHostEvents();

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
