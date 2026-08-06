/**
 * @module core/character-event-listener
 * @description 宿主事件监听器与新角色卡智能检测提醒器
 */

import { getEventBus } from './context';
import { getEnableSchemes } from '../storage/character-store';
import { logger } from './logger';

/** 跟踪已提示过的角色卡集合，避免重复弹窗打扰 */
const warnedCardNames = new Set<string>();

/**
 * 校验指定角色卡名称是否已被其他方案关联（防冲突提醒）
 */
export function checkCharacterCardConflict(cardName: string, currentSchemeId: string): string | null {
    if (!cardName || !cardName.trim()) return null;
    const norm = cardName.trim().toLowerCase();
    const schemes = getEnableSchemes();

    for (const scheme of schemes) {
        if (scheme.id === currentSchemeId) continue;
        if (!scheme.boundCharacterCards) continue;

        const boundNames = scheme.boundCharacterCards
            .split(/,|\n/)
            .map(c => c.trim().toLowerCase())
            .filter(Boolean);

        if (boundNames.includes(norm)) {
            return scheme.name;
        }
    }
    return null;
}

/**
 * 监听新角色卡切换事件
 */
export function registerCharacterEventListeners(): void {
    try {
        const { eventSource, event_types } = getEventBus();

        const handleChatChanged = () => {
            try {
                const win = window as unknown as { SillyTavern?: { getContext?: () => { name2?: string } } };
                const name2 = win.SillyTavern?.getContext?.()?.name2;
                if (!name2 || warnedCardNames.has(name2)) return;

                const norm = name2.trim().toLowerCase();
                const schemes = getEnableSchemes();
                const hasMatch = schemes.some(s => {
                    if (!s.boundCharacterCards) return false;
                    const cards = s.boundCharacterCards
                        .split(/,|\n/)
                        .map(c => c.trim().toLowerCase())
                        .filter(Boolean);
                    return cards.includes(norm);
                });

                if (!hasMatch) {
                    warnedCardNames.add(name2);
                    logger.info(`[CharacterEventListener] 检测到新角色卡 "${name2}" 未关联启用方案`);
                    const winToastr = window as unknown as { toastr?: { info: (msg: string, title: string) => void } };
                    if (winToastr.toastr && typeof winToastr.toastr.info === 'function') {
                        winToastr.toastr.info(
                            `未发现针对角色卡 [${name2}] 的设定启用方案，可在【角色管理 ➔ 设定启用管理】中关联或新建方案。`,
                            'Starlight DrawAssistant'
                        );
                    }
                }
            } catch (err) {
                logger.warn('[CharacterEventListener] 处理 CHAT_CHANGED 异常:', err);
            }
        };

        eventSource.on(event_types.CHAT_CHANGED || 'chat_changed', handleChatChanged);
        eventSource.on(event_types.CHARACTER_SELECTED || 'character_selected', handleChatChanged);

        logger.info('[CharacterEventListener] 宿主事件监听与智能检测注册就绪');
    } catch (err) {
        logger.warn('[CharacterEventListener] 注册宿主事件监听失败:', err);
    }
}
