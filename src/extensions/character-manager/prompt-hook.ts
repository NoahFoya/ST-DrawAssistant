/**
 * @module extensions/character-manager/prompt-hook
 * @description 提示词前置拦截钩子实现 (beforePromptBuild 标签注入、精准方案匹配、宏展开与正则公式求值)
 */

import { CharacterStorage } from './storage';
import { PipelineHookContext } from '../../domain/pipeline/pipeline-hooks';
import { IHostBridge } from '../../core/foundation/host-bridge';
import {
    CharacterProfile,
    OutfitProfile,
    EnableSchemeProfile,
    RegexFormulaScheme
} from './types';

export function createCharacterPromptHook(storage: CharacterStorage, host: IHostBridge) {
    return async (prompt: string, context: PipelineHookContext): Promise<string> => {
        if (!prompt || typeof prompt !== 'string') return prompt;

        const characters = storage.getCharacters();
        const outfits = storage.getOutfits();
        const schemes = storage.getSchemes();
        const formulas = storage.getFormulas();
        const activeFormulaId = storage.getActiveFormulaId();
        const activeFormulaScheme =
            formulas.find((f) => f.id === activeFormulaId) || formulas[0];

        // 1. 获取宿主当前激活角色名，解析激活的 EnableScheme
        const currentChar = host.getCurrentCharacter();
        const currentCharName = currentChar?.name || '';
        const activeScheme = resolveActiveScheme(schemes, currentCharName, context.chatId);

        // 2. 匹配并展开 $角色/服装-后缀$ 宏语法
        const macroRegex = /\$([^$]+)\$/g;
        let expanded = prompt.replace(macroRegex, (_, macroInner: string) => {
            const trimmed = macroInner.trim();
            if (!trimmed) return '';

            // 3.1 尝试匹配角色宏
            for (const char of characters) {
                const nameKeys = [char.nameCN, char.nameEN].filter(Boolean);
                for (const key of nameKeys) {
                    if (trimmed === key || trimmed.startsWith(`${key}-`)) {
                        return evaluateCharacterMacro(char, trimmed, key, activeFormulaScheme);
                    }
                }
            }

            // 3.2 尝试匹配服装宏
            for (const outfit of outfits) {
                const nameKeys = [outfit.nameCN, outfit.nameEN].filter(Boolean);
                for (const key of nameKeys) {
                    if (trimmed === key || trimmed.startsWith(`${key}-`)) {
                        return evaluateOutfitMacro(outfit, trimmed, key, activeFormulaScheme);
                    }
                }
            }

            return '';
        });

        // 4. 自动注入白名单启用的全局实体标签 (ALL 规则)
        if (activeScheme) {
            const autoTags: string[] = [];
            for (const char of characters) {
                if (activeScheme.characterRules?.[char.id] === 'ALL') {
                    const charTags = [
                        char.nameEN,
                        char.charOrigin,
                        char.bodyTraits,
                        char.facialFeatures,
                        char.upperBodySFW,
                        char.lowerBodySFW
                    ]
                        .filter(Boolean)
                        .join(', ');
                    if (charTags) autoTags.push(charTags);
                }
            }
            for (const outfit of outfits) {
                if (activeScheme.outfitRules?.[outfit.id] === 'ALL') {
                    const outfitTags = [
                        outfit.nameEN,
                        outfit.headAccessory,
                        outfit.upperBody,
                        outfit.lowerBody,
                        outfit.footwear,
                        outfit.accessories
                    ]
                        .filter(Boolean)
                        .join(', ');
                    if (outfitTags) autoTags.push(outfitTags);
                }
            }

            const autoStr = autoTags.filter(Boolean).join(', ');
            if (autoStr) {
                expanded = [expanded, autoStr].filter(Boolean).join(', ');
            }
        }

        return expanded;
    };
}

/**
 * 解析当前匹配的启用方案
 *
 * 匹配优先级：
 * 1. 优先精准匹配聊天记录 boundChatId；
 * 2. 其次匹配 boundCharacterCards (支持逗号或换行分隔的多角色名单)；
 * 3. 兜底使用全局通用方案 (boundCharacterCards 为空或为 'ALL')。
 *
 * @param schemes 启用方案列表
 * @param currentCharName 当前酒馆激活的角色卡名称
 * @param chatId 当前聊天记录 ID
 * @returns 命中的启用方案对象
 */
function resolveActiveScheme(
    schemes: EnableSchemeProfile[],
    currentCharName: string,
    chatId?: string
): EnableSchemeProfile | undefined {
    if (!schemes || schemes.length === 0) return undefined;

    // 1. 优先匹配 chatId
    if (chatId) {
        const chatMatch = schemes.find((s) => s.boundChatId === chatId);
        if (chatMatch) return chatMatch;
    }

    // 2. 精准匹配角色名
    if (currentCharName) {
        const charMatch = schemes.find((s) => {
            if (!s.boundCharacterCards) return false;
            const names = s.boundCharacterCards.split(/,|\n/).map((n) => n.trim());
            return names.includes(currentCharName);
        });
        if (charMatch) return charMatch;
    }

    // 3. 全局通用方案（boundCharacterCards 为空）
    const globalScheme = schemes.find((s) => !s.boundCharacterCards || s.boundCharacterCards === 'ALL');
    return globalScheme || schemes[0];
}

/**
 * 根据宏规则公式计算角色宏展开标签
 *
 * @param char 角色预设数据对象
 * @param macroText 完整宏文本 (如 "default_girl-from_behind")
 * @param matchedKey 命中的前缀名称 (如 "default_girl")
 * @param formulaScheme 当前生效的正则宏公式方案
 * @returns 展开后的提示词标签字符串
 */
function evaluateCharacterMacro(
    char: CharacterProfile,
    macroText: string,
    matchedKey: string,
    formulaScheme?: RegexFormulaScheme
): string {
    const suffix = macroText.slice(matchedKey.length).trim();
    const tags: string[] = [];

    // 1. 提取固定变量
    const fixedVars = formulaScheme?.characterMacroRules?.fixedVars || ['nameEN'];
    fixedVars.forEach((v) => {
        const val = (char as any)[v];
        if (typeof val === 'string' && val.trim()) tags.push(val.trim());
    });

    // 2. 正则公式匹配
    let matchedFormula = false;
    if (suffix && formulaScheme?.characterMacroRules?.formulas) {
        for (const f of formulaScheme.characterMacroRules.formulas) {
            if (!f.enabled) continue;
            if (f.pattern && suffix.includes(f.pattern)) {
                matchedFormula = true;
                f.outputVars.forEach((varKey) => {
                    const val = (char as any)[varKey];
                    if (typeof val === 'string' && val.trim()) tags.push(val.trim());
                });
                if (f.customTag && f.customTag.trim()) tags.push(f.customTag.trim());
            }
        }
    }

    // 3. 兜底默认全特征展开
    if (!matchedFormula && !suffix) {
        const defaultTags = [
            char.nameEN,
            char.bodyTraits,
            char.facialFeatures,
            char.upperBodySFW,
            char.lowerBodySFW
        ]
            .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            .map((t) => t.trim());
        return Array.from(new Set([...tags, ...defaultTags])).join(', ');
    }

    return tags.filter(Boolean).join(', ');
}

/**
 * 根据宏规则公式计算服装宏展开标签
 *
 * @param outfit 服装预设数据对象
 * @param macroText 完整宏文本 (如 "sailor_suit-from_behind")
 * @param matchedKey 命中的前缀名称 (如 "sailor_suit")
 * @param formulaScheme 当前生效的正则宏公式方案
 * @returns 展开后的提示词标签字符串
 */
function evaluateOutfitMacro(
    outfit: OutfitProfile,
    macroText: string,
    matchedKey: string,
    formulaScheme?: RegexFormulaScheme
): string {
    const suffix = macroText.slice(matchedKey.length).trim();
    const tags: string[] = [];

    const fixedVars = formulaScheme?.outfitMacroRules?.fixedVars || ['nameEN'];
    fixedVars.forEach((v) => {
        const val = (outfit as any)[v];
        if (typeof val === 'string' && val.trim()) tags.push(val.trim());
    });

    let matchedFormula = false;
    if (suffix && formulaScheme?.outfitMacroRules?.formulas) {
        for (const f of formulaScheme.outfitMacroRules.formulas) {
            if (!f.enabled) continue;
            if (f.pattern && suffix.includes(f.pattern)) {
                matchedFormula = true;
                f.outputVars.forEach((varKey) => {
                    const val = (outfit as any)[varKey];
                    if (typeof val === 'string' && val.trim()) tags.push(val.trim());
                });
                if (f.customTag && f.customTag.trim()) tags.push(f.customTag.trim());
            }
        }
    }

    if (!matchedFormula && !suffix) {
        const defaultTags = [
            outfit.nameEN,
            outfit.headAccessory,
            outfit.upperBody,
            outfit.lowerBody,
            outfit.footwear,
            outfit.accessories
        ]
            .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            .map((t) => t.trim());
        return Array.from(new Set([...tags, ...defaultTags])).join(', ');
    }

    return tags.filter(Boolean).join(', ');
}
