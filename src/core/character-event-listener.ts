/**
 * @module core/character-event-listener
 * @description 宿主事件监听器与新角色卡智能检测提醒器
 */

import { getEventBus } from './context';
import { getEnableSchemes } from '../storage/character-store';
import { updateGlobalWorldbookPlaceholders, processWorldInfoLoadedData, resolveActiveEnableScheme, processExtractedCharacterTags } from './character-injection';
import { logger } from './logger';

/** 跟踪已提示过的角色卡集合，避免重复弹窗打扰 */
const warnedCardNames = new Set<string>();

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
        const win = window as unknown as {
            SillyTavern?: {
                getContext?: () => {
                    name2?: string;
                    chatId?: string;
                    chat?: unknown[];
                    characterId?: number;
                };
            };
        };
        const stCtx = win.SillyTavern?.getContext?.();
        if (!stCtx) return false;
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
 * 监听新角色卡切换事件、WORLDINFO_ENTRIES_LOADED 世界书编译事件与全局预发送文本刷新
 */
export function registerCharacterEventListeners(): void {
    try {
        const { eventSource, event_types } = getEventBus();

        const handleChatChanged = () => {
            try {
                // 严密前置校验：若当前在宿主中未选择角色卡或无有效聊天记录，静默清洗并退出
                if (!isContextActive()) {
                    updateGlobalWorldbookPlaceholders();
                    return;
                }

                // 1. 动态刷新全局世界书预发送文本视窗中的 {{角色启用列表}} 与 {{服装启用列表}}
                updateGlobalWorldbookPlaceholders();

                // 2. 检测活动角色卡绑定方案
                const win = window as unknown as { SillyTavern?: { getContext?: () => { name2?: string; chatId?: string } } };
                const stCtx = win.SillyTavern?.getContext?.();
                const name2 = stCtx?.name2;
                const chatId = stCtx?.chatId || '';

                if (!name2 || warnedCardNames.has(name2)) return;

                const scheme = resolveActiveEnableScheme(name2, chatId);

                if (!scheme) {
                    warnedCardNames.add(name2);
                    logger.info(`[CharacterEventListener] 检测到活动角色卡 "${name2}" 未关联任何设定启用方案`);
                    const winToastr = window as unknown as { toastr?: { info: (msg: string, title: string) => void } };
                    if (winToastr.toastr && typeof winToastr.toastr.info === 'function') {
                        winToastr.toastr.info(
                            `未发现角色卡 [${name2}] 的绑定方案。可在【角色管理 ➔ 设定启用管理】中为其指定或新建方案。`,
                            'Starlight DrawAssistant'
                        );
                    }
                }
            } catch (err) {
                logger.warn('[CharacterEventListener] 处理 CHAT_CHANGED 异常:', err);
            }
        };

        const handleMessageSent = (...args: unknown[]) => {
            if (!isContextActive()) return;
            const data = args[0] as { message?: { content?: string } } | undefined;
            updateGlobalWorldbookPlaceholders(data?.message?.content);
        };

        const handleMessageReceived = (...args: unknown[]) => {
            handleChatChanged();
            if (!isContextActive()) return;
            const data = args[0] as { message?: { content?: string } } | undefined;
            const textContent = typeof data?.message?.content === 'string' ? data.message.content : '';
            if (textContent) {
                processExtractedCharacterTags(textContent);
            }
        };

        const handleWorldInfoLoaded = (...args: unknown[]) => {
            if (!isContextActive()) return;
            const data = args[0] as { globalLore?: Array<{ content?: string; _rawContent?: string }> } | undefined;
            processWorldInfoLoadedData(data);
        };

        const evtWorldInfo = event_types.WORLDINFO_ENTRIES_LOADED || 'worldinfo_entries_loaded';

        eventSource.on(event_types.APP_READY || 'app_ready', handleChatChanged);
        eventSource.on(event_types.CHAT_CHANGED || 'chat_changed', handleChatChanged);
        eventSource.on(event_types.CHARACTER_SELECTED || 'character_selected', handleChatChanged);
        eventSource.on(event_types.MESSAGE_SENT || 'message_sent', handleMessageSent);
        eventSource.on(event_types.MESSAGE_RECEIVED || 'message_received', handleMessageReceived);
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered', handleMessageReceived);
        eventSource.on(evtWorldInfo, handleWorldInfoLoaded);

        logger.info(`[CharacterEventListener] 宿主事件监听与 WORLDINFO_ENTRIES_LOADED 世界书编译钩子就绪 (${String(evtWorldInfo)})`);
    } catch (err) {
        logger.warn('[CharacterEventListener] 注册宿主事件监听失败:', err);
    }
}

