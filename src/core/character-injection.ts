/**
 * @module core/character-injection
 * @description 角色与服装提示词注入引擎
 *
 * 职责：
 * - 动态解析活动的设定启用方案 (EnableSchemeProfile)，匹配多行 角色卡名称|chatId
 * - 根据规则 (ALL / match) 过滤仅为 enabled: true 的角色与服装实体
 * - 展开角色专属服装列表 {outfits}
 * - 容错匹配与替换占位符 ({{角色启用列表}}, {{服装启用列表}} 等别名)
 * - 空变量行与多余空行二次正则清洗
 */

import {
    getCharacterProfiles,
    getOutfitProfiles,
    getEnableSchemes,
    getInjectionTemplates
} from '../storage/character-store';
import type {
    CharacterProfile,
    OutfitProfile,
    EnableSchemeProfile,
    InjectionTemplateScheme
} from '../types/character';
import { getContext } from './context';
import { logger } from './logger';

/**
 * 根据当前角色卡名称与 chatId 获取活动的设定启用方案 (匹配第一个符合条件的方案，无匹配或未选中角色卡时返回 null)
 */
export function resolveActiveEnableScheme(characterCardName?: string, chatId?: string): EnableSchemeProfile | null {
    const schemes = getEnableSchemes();
    if (schemes.length === 0) {
        return null;
    }

    let targetCard = characterCardName;
    let targetChatId = chatId;

    if (!targetCard) {
        try {
            const ctx = getContext();
            const win = window as unknown as { SillyTavern?: { getContext?: () => { name2?: string; chatId?: string; characterId?: number } } };
            const stCtx = win.SillyTavern?.getContext?.();
            const charId = stCtx?.characterId ?? (ctx as unknown as { characterId?: number })?.characterId;

            // 未选择任何角色卡（characterId 未定义或无效）时直接返回 null
            if (typeof charId === 'undefined' || charId < 0) {
                return null;
            }

            targetCard = stCtx?.name2 || (ctx as unknown as { name2?: string })?.name2 || '';
            targetChatId = targetChatId || stCtx?.chatId || (ctx as unknown as { chatId?: string })?.chatId || '';
        } catch {
            return null;
        }
    }

    if (!targetCard || !targetCard.trim()) {
        return null;
    }

    const normTargetCard = targetCard.trim().toLowerCase();
    const normTargetChatId = (targetChatId || '').trim();

    const matched = schemes.find(s => {
        if (!s.boundCharacterCards) return false;
        const lines = s.boundCharacterCards
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean);

        for (const line of lines) {
            if (line.includes('|')) {
                const [card, cid] = line.split('|').map(p => p.trim());
                if (card.toLowerCase() === normTargetCard && cid === normTargetChatId) {
                    return true;
                }
            } else if (line.toLowerCase() === normTargetCard) {
                return true;
            }
        }
        return false;
    });

    return matched || null;
}

/**
 * 筛选符合规则且启用的角色实体 (仅当 rule.enabled === true 时为启用)
 */
export function filterEnabledCharacters(
    scheme: EnableSchemeProfile | null,
    textContent: string
): CharacterProfile[] {
    if (!scheme) return [];
    const allChars = getCharacterProfiles();
    const rules = scheme.characterRules || {};
    const normText = (textContent || '').toLowerCase();

    return allChars.filter(char => {
        const config = rules[char.id];
        // 默认新建方案时所有卡全禁用，仅存储了 enabled: true 的为启用
        if (!config || config.enabled !== true) return false;

        const rule = config.rule || 'ALL';
        if (rule === 'ALL') return true;

        // match 规则：检索姓名或以 "|" 分隔的别名
        if (char.nameCN) {
            const aliasesCN = char.nameCN.split('|').map(a => a.trim().toLowerCase()).filter(Boolean);
            if (aliasesCN.some(alias => normText.includes(alias))) return true;
        }
        if (char.nameEN) {
            const aliasesEN = char.nameEN.split('|').map(a => a.trim().toLowerCase()).filter(Boolean);
            if (aliasesEN.some(alias => normText.includes(alias))) return true;
        }

        return false;
    });
}

/**
 * 筛选符合规则且启用的通用服装实体 (仅当 rule.enabled === true 时为启用)
 */
export function filterEnabledOutfits(
    scheme: EnableSchemeProfile | null,
    textContent: string
): OutfitProfile[] {
    if (!scheme) return [];
    const allOutfits = getOutfitProfiles();
    const rules = scheme.outfitRules || {};
    const normText = (textContent || '').toLowerCase();

    return allOutfits.filter(outfit => {
        const config = rules[outfit.id];
        if (!config || config.enabled !== true) return false;

        const rule = config.rule || 'match';
        if (rule === 'ALL') return true;

        // match 规则：检索服装中文名或英文名
        if (outfit.nameCN) {
            const aliasesCN = outfit.nameCN.split('|').map(a => a.trim().toLowerCase()).filter(Boolean);
            if (aliasesCN.some(alias => normText.includes(alias))) return true;
        }
        if (outfit.nameEN) {
            const aliasesEN = outfit.nameEN.split('|').map(a => a.trim().toLowerCase()).filter(Boolean);
            if (aliasesEN.some(alias => normText.includes(alias))) return true;
        }

        return false;
    });
}

/**
 * 展开角色专属服装列表 {outfits}
 */
export function resolveInnerOutfits(
    char: CharacterProfile,
    tplScheme: InjectionTemplateScheme
): string {
    const activeOutfits = char.outfitList || [];
    const innerTpl = tplScheme.innerOutfitTemplate || '';

    const allOutfits = getOutfitProfiles();
    const renderedList = activeOutfits.map(outfitName => {
        const outfit = allOutfits.find(o => 
            (o.nameCN && o.nameCN.toLowerCase() === outfitName.toLowerCase()) ||
            (o.nameEN && o.nameEN.toLowerCase() === outfitName.toLowerCase())
        );
        if (!outfit) return '';

        return innerTpl
            .replace(/{nameCN}/g, outfit.nameCN || '')
            .replace(/{nameEN}/g, outfit.nameEN || '')
            .replace(/{upperBody}/g, outfit.upperBody || '')
            .replace(/{upperBodyBack}/g, outfit.upperBodyBack || '')
            .replace(/{fullBody}/g, outfit.fullBody || '')
            .replace(/{lowerBody}/g, outfit.fullBody || '')
            .replace(/{fullBodyBack}/g, outfit.fullBodyBack || '')
            .replace(/{lowerBodyBack}/g, outfit.fullBodyBack || '');
    });

    return renderedList.map(t => cleanRenderedText(t)).filter(Boolean).join('\n');
}

/**
 * 清洗模板渲染后的多余空行与全空占位符行
 */
export function cleanRenderedText(text: string): string {
    if (!text) return '';
    const lines = text.split('\n');
    const cleaned = lines.filter(line => {
        if (/{[a-zA-Z0-9_]+}/.test(line)) return false;
        return line.trim() !== '';
    });
    return cleaned.join('\n');
}

/**
 * 渲染角色与服装的结构化注入文本
 */
export function renderCharacterAndOutfitInjection(textContent: string): {
    characterListText: string;
    outfitListText: string;
} {
    const scheme = resolveActiveEnableScheme();
    if (!scheme) {
        return { characterListText: '', outfitListText: '' };
    }

    const tplScheme = getInjectionTemplates()[0];
    if (!tplScheme) {
        return { characterListText: '', outfitListText: '' };
    }

    const activeChars = filterEnabledCharacters(scheme, textContent);
    const activeOutfits = filterEnabledOutfits(scheme, textContent);

    // 1. 渲染角色启用列表
    const charRenderedList: string[] = [];
    const charTpl = tplScheme.characterListTemplate || '';

    activeChars.forEach(char => {
        const innerOutfitsText = resolveInnerOutfits(char, tplScheme);
        const itemText = charTpl
            .replace(/{nameCN}/g, char.nameCN || '')
            .replace(/{nameEN}/g, char.nameEN || '')
            .replace(/{traits}/g, char.characterTraits || '')
            .replace(/{facial}/g, char.facialFeatures || '')
            .replace(/{facialBack}/g, char.facialFeaturesBack || '')
            .replace(/{upperSFW}/g, char.upperBodySFW || '')
            .replace(/{upperSFWBack}/g, char.upperBodySFWBack || '')
            .replace(/{lowerSFW}/g, char.fullBodySFW || '')
            .replace(/{lowerSFWBack}/g, char.fullBodySFWBack || '')
            .replace(/{upperNSFW}/g, char.upperBodyNSFW || '')
            .replace(/{upperNSFWBack}/g, char.upperBodyNSFWBack || '')
            .replace(/{lowerNSFW}/g, char.fullBodyNSFW || '')
            .replace(/{lowerNSFWBack}/g, char.fullBodyNSFWBack || '')
            .replace(/{negative}/g, char.negativePrompt || '')
            .replace(/{outfits}/g, innerOutfitsText);

        charRenderedList.push(cleanRenderedText(itemText));
    });

    // 2. 渲染服装启用列表
    const outfitRenderedList: string[] = [];
    const outfitTpl = tplScheme.enableOutfitListTemplate || '';

    activeOutfits.forEach(outfit => {
        const itemText = outfitTpl
            .replace(/{nameCN}/g, outfit.nameCN || '')
            .replace(/{nameEN}/g, outfit.nameEN || '')
            .replace(/{upperBody}/g, outfit.upperBody || '')
            .replace(/{upperBodyBack}/g, outfit.upperBodyBack || '')
            .replace(/{fullBody}/g, outfit.fullBody || '')
            .replace(/{lowerBody}/g, outfit.fullBody || '')
            .replace(/{fullBodyBack}/g, outfit.fullBodyBack || '')
            .replace(/{lowerBodyBack}/g, outfit.fullBodyBack || '');

        outfitRenderedList.push(cleanRenderedText(itemText));
    });

    const characterListText = charRenderedList.filter(Boolean).join('\n\n');
    const outfitListText = outfitRenderedList.filter(Boolean).join('\n\n');

    logger.debug('[CharacterInjection] 动态解析结果:', {
        scheme: scheme ? scheme.name : '无绑定方案',
        matchedChars: activeChars.map(c => c.nameCN),
        matchedOutfits: activeOutfits.map(o => o.nameCN)
    });

    return { characterListText, outfitListText };
}

/**
 * 在 Prompt / 文本中容错替换角色与服装占位符
 */
export function injectCharacterPlaceholders(promptText: string, textContent?: string): string {
    if (!promptText) return '';

    const matchText = textContent || promptText;
    const { characterListText, outfitListText } = renderCharacterAndOutfitInjection(matchText);

    let result = promptText;

    const charRegex = /{{(角色启用列表|角色列表|通用角色启用列表)}}/gi;
    result = result.replace(charRegex, characterListText);

    const outfitRegex = /{{(服装启用列表|服装列表|通用服装启用列表)}}/gi;
    result = result.replace(outfitRegex, outfitListText);

    return result;
}

/**
 * 动态刷新全局世界书 (window.world_info) 中的 {{角色启用列表}} 与 {{服装启用列表}} 占位符
 * 使酒馆原生的 Prompt 预发送视窗 (Inspect Prompt / 提示词预览) 能够直接展示解包渲染后的最新 Tag 实体
 */
export function updateGlobalWorldbookPlaceholders(textContent?: string): void {
    try {
        const win = window as unknown as {
            world_info?: { entries?: Record<string, { content?: string; _rawContent?: string }> };
            world_info_data?: { entries?: Record<string, { content?: string; _rawContent?: string }> };
        };
        const wiEntries = win.world_info?.entries || win.world_info_data?.entries;
        if (!wiEntries) return;

        const { characterListText, outfitListText } = renderCharacterAndOutfitInjection(textContent || '');

        const charRegex = /{{(角色启用列表|角色列表|通用角色启用列表)}}/gi;
        const outfitRegex = /{{(服装启用列表|服装列表|通用服装启用列表)}}/gi;

        Object.values(wiEntries).forEach(entry => {
            if (!entry) return;
            if (typeof entry._rawContent === 'undefined') {
                entry._rawContent = entry.content || '';
            }

            const raw = entry._rawContent;
            if (charRegex.test(raw) || outfitRegex.test(raw)) {
                let updated = raw.replace(charRegex, characterListText);
                updated = updated.replace(outfitRegex, outfitListText);
                entry.content = cleanRenderedText(updated);
            }
        });

        logger.debug('[CharacterInjection] 动态刷新全局世界书预发送文本缓冲区成功');
    } catch (err) {
        logger.warn('[CharacterInjection] 动态刷新全局世界书失败:', err);
    }
}

