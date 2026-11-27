/**
 * SillyTavern 宿主上下文访问适配器 (`host-context.ts`)。
 *
 * @remarks
 * 作为插件内访问 `window.SillyTavern` 的唯一适配入口，
 * 屏蔽不同版本或外部运行环境差异，同时向 `@util/http-client` 注册宿主环境提供方。
 */

import type { ChatMessage, SillyTavernContext } from '@types';
import { logger } from '../util/logger';
import { registerHostEnvironmentProvider } from '../util/http-client';

/** 获取 SillyTavern 当前宿主上下文对象；非宿主环境返回 `undefined` */
export function getHostContext(): SillyTavernContext | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    try {
        return window.SillyTavern?.getContext?.();
    } catch (err) {
        logger.warn('[HostContext] 获取 SillyTavern 上下文异常:', err);
        return undefined;
    }
}

/** 当前是否处于可用 SillyTavern 宿主上下文中 */
export function isHostContextAvailable(): boolean {
    return Boolean(getHostContext());
}

/** 获取 SillyTavern 宿主请求的 CSRF 与认证请求头 */
export function getHostRequestHeaders(): Record<string, string> {
    const ctx = getHostContext();
    if (typeof ctx?.getRequestHeaders !== 'function') {
        return {};
    }
    try {
        return ctx.getRequestHeaders() ?? {};
    } catch (err) {
        logger.warn('[HostContext] 获取宿主请求头异常:', err);
        return {};
    }
}

/** 获取当前活动会话标识 */
export function getHostActiveChatId(): string | undefined {
    const ctx = getHostContext();
    if (typeof ctx?.getCurrentChatId === 'function') {
        return ctx.getCurrentChatId() ?? ctx.chatId;
    }
    return ctx?.chatId;
}

/** 获取当前会话消息数组 */
export function getHostChatMessages(): ChatMessage[] {
    const chat = getHostContext()?.chat;
    return Array.isArray(chat) ? chat : [];
}

/** 按消息下标获取宿主聊天消息对象 */
export function getHostChatMessage(messageId: number): ChatMessage | undefined {
    const chat = getHostContext()?.chat;
    if (!Array.isArray(chat) || messageId < 0 || messageId >= chat.length) {
        return undefined;
    }
    return chat[messageId];
}

/** 获取宿主已加载角色卡列表的精简标识选项 */
export function getHostCharacterCards(): Array<{ id: string; name: string }> {
    const chars = getHostContext()?.characters;
    if (!Array.isArray(chars)) {
        return [];
    }
    return chars.map((c, i) => {
        const item = c as { avatar?: string; name?: string };
        return {
            id: item.avatar || item.name || `char_${i}`,
            name: item.name || item.avatar || `角色卡 #${i + 1}`,
        };
    });
}

// 注册至底层 http-client 端口，避免 util 层反向依赖 host 层
registerHostEnvironmentProvider({
    hasHostContext: isHostContextAvailable,
    getRequestHeaders: getHostRequestHeaders,
});
