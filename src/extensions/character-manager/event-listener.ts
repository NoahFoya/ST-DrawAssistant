/**
 * @module extensions/character-manager/event-listener
 * @description 宿主事件监听器与新角色卡智能检测提醒器
 */

import { getContext, getEventBus } from '../../core/context';
import { getEnableSchemes } from './storage';
import { updateGlobalWorldbookPlaceholders, processWorldInfoLoadedData, resolveActiveEnableScheme, processExtractedCharacterTags } from './injection';
import { logger } from '../../core/logger';
import { showToastInfo } from '../../utils/toast';

import type { IDisposable } from '../../core/disposable';

/** 跟踪已提示过的角色卡集合，避免重复弹窗打扰 */
const warnedCardNames = new Set<string>();

/**
 * 重置已开警示提示的角色卡缓存
 */
export function resetWarnedCards(): void {
    warnedCardNames.clear();
}

/**
 * 校验指定角色卡名称/chatId 是否已被其他方案关联（防冲突提醒）
 */
export function checkCharacterCardConflict(lineEntry: string, currentSchemeId: string): string | null {
    if (!lineEntry || !lineEntry.trim()) return null;

    const normEntry = lineEntry.trim().toLowerCase();
    const rawCardName = normEntry.includes('|') ? normEntry.split('|')[0].trim() : normEntry;
    const schemes = getEnableSchemes();

    for (const scheme of schemes) {
        if (scheme.id === currentSchemeId) continue;
        if (!scheme.boundCharacterCards) continue;

        const boundLines = scheme.boundCharacterCards
            .split('\n')
            .map(l => l.trim().toLowerCase())
            .filter(Boolean);

        for (const boundLine of boundLines) {
            const cardNameInBound = boundLine.includes('|') ? boundLine.split('|')[0].trim() : boundLine;
            if (cardNameInBound === rawCardName) {
                return scheme.name;
            }
        }
    }
    return null;
}

/**
 * 校验当前 SillyTavern 宿主上下文是否处于选定角色卡与有效聊天对话状态
 */
export function isContextActive(): boolean {
    try {
        const stCtx = getContext();
        if (typeof stCtx.characterId === 'undefined' || stCtx.characterId < 0) return false;
        if (!stCtx.name2 || !stCtx.name2.trim()) return false;
        if (!stCtx.chatId || !stCtx.chatId.trim()) return false;
        if (!Array.isArray(stCtx.chat) || stCtx.chat.length === 0) return false;
        return true;
    } catch {
        return false;
    }
}

/**
 * 兼容提取酒馆事件负载中的消息正文 (支持 number id, { message }, { id }, 或最新 chat 记录)
 */
export function extractTextFromEventPayload(arg: unknown): string {
    try {
        const stChat = getContext().chat;

        // 1. 若参数直接为消息索引数字/数字字符串 (如 MESSAGE_RECEIVED / MESSAGE_EDITED 传的 id)
        if (typeof arg === 'number' || (typeof arg === 'string' && /^\d+$/.test(arg))) {
            const idx = Number(arg);
            if (stChat && stChat[idx]) {
                return stChat[idx].mes || stChat[idx].content || '';
            }
        }

        // 2. 若参数为对象结构 { message: { content/mes } } 或 { id/messageId }
        if (arg && typeof arg === 'object') {
            const obj = arg as {
                message?: { content?: string; mes?: string };
                id?: number;
                messageId?: number;
                content?: string;
                mes?: string;
            };

            if (obj.message) {
                return obj.message.mes || obj.message.content || '';
            }
            if (typeof obj.mes === 'string') return obj.mes;
            if (typeof obj.content === 'string') return obj.content;

            const targetIdx = typeof obj.id === 'number' ? obj.id : obj.messageId;
            if (typeof targetIdx === 'number' && stChat && stChat[targetIdx]) {
                return stChat[targetIdx].mes || stChat[targetIdx].content || '';
            }
        }

        // 3. 兜底策略：读取当前聊天最后一条消息
        if (stChat && stChat.length > 0) {
            const lastMsg = stChat[stChat.length - 1];
            return lastMsg.mes || lastMsg.content || '';
        }
    } catch (err) {
        logger.warn('[CharacterEventListener] 提取事件 payload 消息文本失败:', err);
    }
    return '';
}

/**
 * 监听新角色卡切换事件、WORLDINFO_ENTRIES_LOADED 世界书编译事件与全局预发送文本刷新
 */
export function registerCharacterEventListeners(): IDisposable {
    try {
        const { eventSource, event_types } = getEventBus();

        const handleChatChanged = () => {
            try {
                // 1. 动态刷新全局世界书预发送文本视窗中的 {{角色启用列表}} 与 {{服装启用列表}}
                updateGlobalWorldbookPlaceholders();

                // 2. 前置校验：若当前无有效选定角色卡或聊天记录，静默退出
                let stCtx;
                try {
                    stCtx = getContext();
                } catch {
                    return;
                }
                const name2 = stCtx.name2;
                const chatId = stCtx.chatId || '';

                if (!name2 || !name2.trim()) return;
                if (!chatId || !chatId.trim()) return;
                if (!Array.isArray(stCtx.chat) || stCtx.chat.length === 0) return;
                if (typeof stCtx.characterId === 'undefined' || stCtx.characterId < 0) return;

                if (warnedCardNames.has(name2)) return;

                // 3. 检测活动角色卡绑定方案
                const scheme = resolveActiveEnableScheme(name2, chatId);

                if (!scheme) {
                    warnedCardNames.add(name2);
                    logger.info(`[CharacterEventListener] 检测到活动角色卡 "${name2}" 未关联任何设定启用方案`);
                    showToastInfo(`未发现角色卡 [${name2}] 的绑定方案。可在【角色管理 ➔ 设定启用管理】中为其指定或新建方案。`);
                }
            } catch (err) {
                logger.warn('[CharacterEventListener] 处理 CHAT_CHANGED 异常:', err);
            }
        };

        const handleMessageSent = (...args: unknown[]) => {
            if (!isContextActive()) return;
            const textContent = extractTextFromEventPayload(args[0]);
            updateGlobalWorldbookPlaceholders(textContent);
        };

        const handleMessageReceived = (...args: unknown[]) => {
            handleChatChanged();
            if (!isContextActive()) return;
            const textContent = extractTextFromEventPayload(args[0]);
            if (textContent) {
                processExtractedCharacterTags(textContent);
            }
        };

        const handleWorldInfoLoaded = (...args: unknown[]) => {
            if (!isContextActive()) return;
            const data = args[0] as { globalLore?: Array<{ content?: string; _rawContent?: string }> } | undefined;
            processWorldInfoLoadedData(data);
        };

        const evtAppReady = event_types.APP_READY || 'app_ready';
        const evtChatChanged = event_types.CHAT_CHANGED || 'chat_changed';
        const evtCharSelected = event_types.CHARACTER_SELECTED || 'character_selected';
        const evtMsgSent = event_types.MESSAGE_SENT || 'message_sent';
        const evtMsgReceived = event_types.MESSAGE_RECEIVED || 'message_received';
        const evtCharMsgRendered = event_types.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered';
        const evtMsgEdited = event_types.MESSAGE_EDITED || 'message_edited';
        const evtMsgUpdated = event_types.MESSAGE_UPDATED || 'message_updated';
        const evtWorldInfo = event_types.WORLDINFO_ENTRIES_LOADED || 'worldinfo_entries_loaded';

        eventSource.on(evtAppReady, handleChatChanged);
        eventSource.on(evtChatChanged, handleChatChanged);
        eventSource.on(evtCharSelected, handleChatChanged);
        eventSource.on(evtMsgSent, handleMessageSent);
        eventSource.on(evtMsgReceived, handleMessageReceived);
        eventSource.on(evtCharMsgRendered, handleMessageReceived);
        eventSource.on(evtMsgEdited, handleMessageReceived);
        eventSource.on(evtMsgUpdated, handleMessageReceived);
        eventSource.on(evtWorldInfo, handleWorldInfoLoaded);

        logger.info(`[CharacterEventListener] 宿主事件监听 (含编辑/回复/WORLDINFO_ENTRIES_LOADED) 注册就绪`);

        return {
            dispose: () => {
                try {
                    eventSource.off(evtAppReady, handleChatChanged);
                    eventSource.off(evtChatChanged, handleChatChanged);
                    eventSource.off(evtCharSelected, handleChatChanged);
                    eventSource.off(evtMsgSent, handleMessageSent);
                    eventSource.off(evtMsgReceived, handleMessageReceived);
                    eventSource.off(evtCharMsgRendered, handleMessageReceived);
                    eventSource.off(evtMsgEdited, handleMessageReceived);
                    eventSource.off(evtMsgUpdated, handleMessageReceived);
                    eventSource.off(evtWorldInfo, handleWorldInfoLoaded);
                } catch {
                    // 忽略事件解绑错误
                }
            }
        };
    } catch (err) {
        logger.warn('[CharacterEventListener] 注册宿主事件监听失败:', err);
        return { dispose: () => {} };
    }
}

