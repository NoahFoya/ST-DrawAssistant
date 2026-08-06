/**
 * @module core/character-injection
 * @description 角色与服装提示词注入引擎
 *
 * 职责：
 * - 动态解析活动的设定启用方案 (EnableSchemeProfile)
 * - 根据规则 (ALL / match) 过滤匹配的角色与服装实体
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
 * 根据当前角色卡名称获取活动的设定启用方案 (匹配第一个)
 */
export function resolveActiveEnableScheme(characterCardName?: string): EnableSchemeProfile {
    const schemes = getEnableSchemes();
    if (schemes.length === 0) {
        throw new Error('[ST-DrawAssistant] 未在系统中发现任何设定启用方案');
    }

    let targetCard = characterCardName;
    if (!targetCard) {
        try {
            const ctx = getContext();
            const win = window as unknown as { SillyTavern?: { getContext?: () => { name2?: string } } };
            targetCard = win.SillyTavern?.getContext?.()?.name2 || (ctx as unknown as { name2?: string })?.name2 || '';
        } catch {
            targetCard = '';
        }
    }

    if (targetCard && targetCard.trim()) {
        const normTarget = targetCard.trim().toLowerCase();
        const matched = schemes.find(s => {
            if (!s.boundCharacterCards) return false;
            const cardNames = s.boundCharacterCards
                .split(/,|\n/)
                .map(c => c.trim().toLowerCase())
                .filter(Boolean);
            return cardNames.includes(normTarget);
        });
        if (matched) return matched;
    }

    return schemes[0];
}

/**
 * 筛选符合规则且启用的角色实体
 */
export function filterEnabledCharacters(
    scheme: EnableSchemeProfile,
    textContent: string
): CharacterProfile[] {
    const allChars = getCharacterProfiles();
    const rules = scheme.characterRules || {};
    const normText = (textContent || '').toLowerCase();

    return allChars.filter(char => {
        const config = rules[char.id];
        // 默认若未单独设置规则则视为启用全量匹配
        const enabled = config ? config.enabled : true;
        if (!enabled) return false;

        const rule = config ? config.rule : 'ALL';
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
 * 筛选符合规则且启用的通用服装实体
 */
export function filterEnabledOutfits(
    scheme: EnableSchemeProfile,
    textContent: string
): OutfitProfile[] {
    const allOutfits = getOutfitProfiles();
    const rules = scheme.outfitRules || {};
    const normText = (textContent || '').toLowerCase();

    return allOutfits.filter(outfit => {
        const config = rules[outfit.id];
        const enabled = config ? config.enabled : true;
        if (!enabled) return false;

        const rule = config ? config.rule : 'match';
        if (rule === 'ALL') return true;

        // match 规则：检索服装中文名或英文名
        if (outfit.nameCN && normText.includes(outfit.nameCN.trim().toLowerCase())) return true;
        if (outfit.nameEN && normText.includes(outfit.nameEN.trim().toLowerCase())) return true;

        return false;
    });
}

/**
 * 展开角色专属服装列表 {outfits}
 */
export function resolveInnerOutfits(
    char: CharacterProfile,
    templateScheme: InjectionTemplateScheme
): string {
    if (!char.outfitList || char.outfitList.length === 0) return '';
    const innerTpl = templateScheme.innerOutfitTemplate || '';
    if (!innerTpl.trim()) return '';

    const allOutfits = getOutfitProfiles();
    const renderedLines: string[] = [];

    char.outfitList.forEach(outfitName => {
        const nameTrim = outfitName.trim().toLowerCase();
        const matchedOutfit = allOutfits.find(o =>
            (o.nameCN && o.nameCN.trim().toLowerCase() === nameTrim) ||
            (o.nameEN && o.nameEN.trim().toLowerCase() === nameTrim)
        );

        if (matchedOutfit) {
            const line = innerTpl
                .replace(/{nameCN}/g, matchedOutfit.nameCN || '')
                .replace(/{nameEN}/g, matchedOutfit.nameEN || '')
                .replace(/{upperBody}/g, matchedOutfit.upperBody || '')
                .replace(/{upperBodyBack}/g, matchedOutfit.upperBodyBack || '')
                .replace(/{fullBody}/g, matchedOutfit.fullBody || '')
                .replace(/{lowerBody}/g, matchedOutfit.fullBody || '')
                .replace(/{fullBodyBack}/g, matchedOutfit.fullBodyBack || '')
                .replace(/{lowerBodyBack}/g, matchedOutfit.fullBodyBack || '');
            renderedLines.push(line);
        }
    });

    return renderedLines.join('\n');
}

/**
 * 清洗模板渲染后的多余空行与全空占位符行
 */
export function cleanRenderedText(text: string): string {
    if (!text) return '';
    const lines = text.split('\n');
    const cleaned = lines.filter(line => {
        // 如果整行包含未选中的 {xxx} 或全为空白符号，则过滤该行
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
    const tplScheme = getInjectionTemplates()[0]; // 默认取当前启用的注入模板方案

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
        scheme: scheme.name,
        matchedChars: activeChars.map(c => c.nameCN),
        matchedOutfits: activeOutfits.map(o => o.nameCN)
    });

    return { characterListText, outfitListText };
}

/**
 * 在 Prompt / 文本中容错替换角色与服装占位符
 *
 * 容错别名规则：
 * - 角色占位符别名：{{角色启用列表}}, {{角色列表}}, {{通用角色启用列表}}
 * - 服装占位符别名：{{服装启用列表}}, {{服装列表}}, {{通用服装启用列表}}
 */
export function injectCharacterPlaceholders(promptText: string, textContent?: string): string {
    if (!promptText) return '';

    const matchText = textContent || promptText;
    const { characterListText, outfitListText } = renderCharacterAndOutfitInjection(matchText);

    let result = promptText;

    // 容错匹配替换 {{角色启用列表}} 及其别名
    const charRegex = /{{(角色启用列表|角色列表|通用角色启用列表)}}/gi;
    result = result.replace(charRegex, characterListText);

    // 容错匹配替换 {{服装启用列表}} 及其别名
    const outfitRegex = /{{(服装启用列表|服装列表|通用服装启用列表)}}/gi;
    result = result.replace(outfitRegex, outfitListText);

    return result;
}
