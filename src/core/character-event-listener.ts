/**
 * @module core/character-event-listener
 * @description 宿主事件监听器与新角色卡智能检测提醒器
 */

import { getEventBus } from './context';
import { getEnableSchemes } from '../storage/character-store';
import { updateGlobalWorldbookPlaceholders } from './character-injection';
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
 * 监听新角色卡切换事件与全局世界书预发送文本刷新
 */
export function registerCharacterEventListeners(): void {
    try {
        const { eventSource, event_types } = getEventBus();

        const handleChatChanged = () => {
            try {
                // 1. 动态刷新全局世界书预发送文本视窗中的 {{角色启用列表}} 与 {{服装启用列表}}
                updateGlobalWorldbookPlaceholders();

                // 2. 检测活动角色卡绑定方案
                const win = window as unknown as { SillyTavern?: { getContext?: () => { name2?: string; chatId?: string } } };
                const stCtx = win.SillyTavern?.getContext?.();
                const name2 = stCtx?.name2;
                const chatId = stCtx?.chatId || '';

                if (!name2 || warnedCardNames.has(name2)) return;

                const normCard = name2.trim().toLowerCase();
                const normChat = chatId.trim();
                const schemes = getEnableSchemes();

                const hasMatch = schemes.some(s => {
                    if (!s.boundCharacterCards) return false;
                    const lines = s.boundCharacterCards
                        .split('\n')
                        .map(l => l.trim())
                        .filter(Boolean);

                    for (const line of lines) {
                        if (line.includes('|')) {
                            const [c, cid] = line.split('|').map(p => p.trim());
                            if (c.toLowerCase() === normCard && cid === normChat) return true;
                        } else if (line.toLowerCase() === normCard) {
                            return true;
                        }
                    }
                    return false;
                });

                if (!hasMatch) {
                    warnedCardNames.add(name2);
                    logger.info(`[CharacterEventListener] 检测到新角色卡 "${name2}" 未关联任何设定启用方案`);
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
            const data = args[0] as { message?: { content?: string } } | undefined;
            updateGlobalWorldbookPlaceholders(data?.message?.content);
        };

        eventSource.on(event_types.APP_READY || 'app_ready', handleChatChanged);
        eventSource.on(event_types.CHAT_CHANGED || 'chat_changed', handleChatChanged);
        eventSource.on(event_types.CHARACTER_SELECTED || 'character_selected', handleChatChanged);
        eventSource.on(event_types.MESSAGE_SENT || 'message_sent', handleMessageSent);
        eventSource.on(event_types.MESSAGE_RECEIVED || 'message_received', handleChatChanged);

        logger.info('[CharacterEventListener] 宿主事件监听与全局世界书预发送文本刷新就绪');
    } catch (err) {
        logger.warn('[CharacterEventListener] 注册宿主事件监听失败:', err);
    }
}

