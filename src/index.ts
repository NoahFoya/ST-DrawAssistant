/**
 * ST-DrawAssistant 插件入口与生命周期管理 (Milestone 2: Host & Floor MVP)。
 *
 * @remarks
 * 负责检测 SillyTavern 宿主环境并挂载全局生命周期事件监听器、悬浮操作球与楼层装配调度器。
 */

import { sessionLifecycle } from './pipeline/session-lifecycle';
import { urlPool } from './store/url-pool';
import { settingsStore } from './store/settings-store';
import { themeService } from './ui/theme';
import { FloatingActionButton, DrawerEntry } from './ui/entry';
import { toastService } from './ui/feedback/toast';
import { messageDecorator } from './ui/floor/message-decorator';
import { promptPipeline } from './pipeline/prompt-pipeline';
import { generationOrchestrator } from './pipeline/generation-orchestrator';
import { logger } from './util/logger';

export type * from '@types';
export * from './config/constants';
export * from './util';
export * from './store';
export * from './provider';
export * from './pipeline';

let isInitialized = false;
let fabInstance: FloatingActionButton | null = null;
let drawerEntryInstance: DrawerEntry | null = null;
const hostEventCleanups: Array<() => void> = [];

export function getFloatingActionButton(): FloatingActionButton | null {
    return fabInstance;
}

export function getDrawerEntry(): DrawerEntry | null {
    return drawerEntryInstance;
}

export async function initOnce(): Promise<void> {
    if (isInitialized) return;
    if (typeof window === 'undefined') return;

    const hostContext = window.SillyTavern?.getContext?.();
    if (!hostContext) {
        logger.info('未检测到 SillyTavern 宿主上下文，跳过生命周期挂载');
        return;
    }

    // 1. 初始化配置与主题
    settingsStore.initializeFromHost();
    themeService.bindTarget();
    themeService.applyCurrentTheme();
    themeService.listenSettings();

    // 2. 挂载悬浮球与抽屉入口
    fabInstance = new FloatingActionButton();
    if (document.body) {
        document.body.appendChild(fabInstance.element);
    }
    drawerEntryInstance = new DrawerEntry();
    drawerEntryInstance.mount();

    // 3. 绑定会话生命周期
    sessionLifecycle.bindHostEvents();

    // 4. 绑定宿主消息全生命周期事件
    const eventSource = hostContext.eventSource;
    const eventTypes = (hostContext.eventTypes || {}) as Record<string, string | undefined>;

    if (eventSource) {
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

        // 监听新回复接收 (MESSAGE_RECEIVED) - 自动生图调度
        const msgReceivedEvent = eventTypes.MESSAGE_RECEIVED || 'message_received';
        bindHostEvent(msgReceivedEvent, async (data: unknown) => {
            const messageId = extractMessageId(data);
            const settings = settingsStore.getSettings();
            if (!settings.enabled || !settings.autoGenerate) return;

            const currentChat = hostContext.chat;
            if (!Array.isArray(currentChat) || !currentChat[messageId]) return;

            const message = currentChat[messageId];
            if (!message || typeof message.mes !== 'string') return;

            const commands = promptPipeline.extractCommands(message.mes);
            if (commands.length === 0) return;

            const chatId = hostContext.chatId || 'default_chat';
            const swipeId = message.swipe_id ?? 0;
            const drawingsMap = message.extra?.drawings?.[swipeId];

            for (const cmd of commands) {
                if (drawingsMap?.[cmd.instructionIndex]?.imageId || drawingsMap?.[cmd.instructionIndex]?.imageUrl) {
                    continue;
                }
                try {
                    await generationOrchestrator.submitTask({
                        rawPrompt: cmd.promptText,
                        target: { chatId, messageId, swipeId, instructionIndex: cmd.instructionIndex },
                        providerType: settings.activeProvider,
                    });
                } catch (err) {
                    logger.error(`[ST-DrawAssistant] 自动生图触发失败:`, err);
                }
            }
        });

        // 监听消息滑动、编辑与删除事件
        bindHostEvent(eventTypes.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered', () => {
            messageDecorator.scheduleScanAllMessages(100);
        });
        bindHostEvent(eventTypes.USER_MESSAGE_RENDERED || 'user_message_rendered', () => {
            messageDecorator.scheduleScanAllMessages(100);
        });
        bindHostEvent(eventTypes.MESSAGE_SWIPED || 'message_swiped', (data: unknown) => {
            const msgId = extractMessageId(data);
            const swipeId = data && typeof data === 'object' && 'swipeId' in data && typeof (data as { swipeId: unknown }).swipeId === 'number'
                ? (data as { swipeId: number }).swipeId : undefined;
            messageDecorator.handleMessageSwiped(msgId, swipeId);
        });
        bindHostEvent(eventTypes.MESSAGE_UPDATED || eventTypes.MESSAGE_EDITED || 'message_updated', (data: unknown) => {
            const msgId = extractMessageId(data);
            messageDecorator.handleMessageEdited(msgId);
        });
        bindHostEvent(eventTypes.MESSAGE_DELETED || 'message_deleted', (data: unknown) => {
            const msgId = typeof data === 'number' ? data : (data && typeof data === 'object' && 'messageId' in data && typeof (data as { messageId: unknown }).messageId === 'number' ? (data as { messageId: number }).messageId : undefined);
            messageDecorator.handleMessageDeleted(msgId);
        });
        bindHostEvent(eventTypes.CHAT_CHANGED || 'chat_id_changed', () => {
            messageDecorator.clearCurrentButtons();
            messageDecorator.scheduleScanAllMessages(300);
        });
        bindHostEvent(eventTypes.CHAT_LOADED || 'chatLoaded', () => {
            messageDecorator.scheduleScanAllMessages(150);
        });
        bindHostEvent(eventTypes.MORE_MESSAGES_LOADED || 'more_messages_loaded', () => {
            messageDecorator.scanAllMessages();
        });
        bindHostEvent(eventTypes.APP_INITIALIZED || 'app_initialized', () => {
            drawerEntryInstance?.mount();
        });
        bindHostEvent(eventTypes.APP_READY || 'app_ready', () => {
            drawerEntryInstance?.mount();
        });
    }

    isInitialized = true;
    logger.info('ST-DrawAssistant 楼层生图核心与悬浮入口已就绪');
}

export async function onActivate(): Promise<void> {
    await initOnce();
}

export function disposeExtension(): void {
    for (const cleanup of hostEventCleanups) {
        try { cleanup(); } catch {}
    }
    hostEventCleanups.length = 0;
    sessionLifecycle.unbindHostEvents();

    if (drawerEntryInstance) {
        drawerEntryInstance.dispose();
        drawerEntryInstance = null;
    }
    if (fabInstance) {
        fabInstance.dispose();
        fabInstance = null;
    }
    messageDecorator.dispose();
    toastService.dispose();
    themeService.dispose();
    urlPool.revokeAll();

    isInitialized = false;
    logger.info('ST-DrawAssistant 扩展已安全卸载');
}

if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
    void initOnce();
}
