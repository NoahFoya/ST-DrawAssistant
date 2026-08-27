/**
 * @module extensions/character-manager/domain/prompt-hook
 * @description 角色与服装提示词构建钩子 (beforePromptBuild 单向宏替换与公式求值)
 */

import { CharacterStorage } from '../data/storage';
import { PipelineHookContext } from '../../../core/contracts';
import { IHostBridge } from '../../../core/foundation/host-bridge';
import {
    CharacterProfile,
    OutfitProfile,
    RegexFormulaScheme
} from '../types';

/**
 * 创建角色与服装宏展开流水线钩子处理函数
 *
 * @param storage 角色与服装存储管理器实例
 * @param _host 宿主环境桥接实例 (可选)
 * @returns 符合 IPipelineHooks 规范的异步提示词转换函数
 */
export function createCharacterPromptHook(storage: CharacterStorage, _host?: IHostBridge) {
    return async (prompt: string, _context?: PipelineHookContext): Promise<string> => {
        if (!prompt || typeof prompt !== 'string') return prompt;

        const characters = storage.getCharacters();
        const outfits = storage.getOutfits();
        const formulas = storage.getFormulas();
        const activeFormulaId = storage.getActiveFormulaId();
        const activeFormulaScheme =
            formulas.find((f) => f.id === activeFormulaId) || formulas[0];

        // 匹配并展开 $角色/服装-后缀$ 宏语法
        const macroRegex = /\$([^$]+)\$/g;
        const expanded = prompt.replace(macroRegex, (match, macroInner: string) => {
            const trimmed = macroInner.trim();
            if (!trimmed) return match;

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

            // 未命中任何角色或服装宏定义时，原样保留原文，防止误删用户输入
            return match;
        });

        return expanded;
    };
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
