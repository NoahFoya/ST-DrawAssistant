/**
 * @module extensions/character-manager/macro-engine
 * @description 树形宏规则 (Macro Rule Tree) 递归展开与条件求值引擎
 */

import { CharacterRule, OutfitRule } from './types';

export interface MacroRuleNode {
    id: string;
    name: string;
    enabled: boolean;
    pattern?: string;        // 正则表达式匹配条件
    replacement?: string;    // 替换/注入的目标文本
    children?: MacroRuleNode[];
}

export interface MacroEvaluationContext {
    characterName?: string;
    characterRule?: CharacterRule;
    outfitRule?: OutfitRule;
    variables?: Record<string, string>;
}

export class MacroEngine {
    /**
     * 递归展开树形宏规则
     */
    public evaluateTree(
        prompt: string,
        nodes: MacroRuleNode[],
        context: MacroEvaluationContext,
        depth = 0,
        maxDepth = 10
    ): string {
        if (!prompt || !nodes || depth >= maxDepth) return prompt;

        let result = prompt;

        for (const node of nodes) {
            if (!node.enabled) continue;

            if (node.pattern && node.replacement !== undefined) {
                try {
                    const regex = new RegExp(node.pattern, 'gi');
                    if (regex.test(result)) {
                        // 变量宏展开
                        const replaced = this.interpolate(node.replacement, context);
                        result = result.replace(regex, replaced);
                    }
                } catch {
                    // 正则异常跳过
                }
            }

            // 递归子节点
            if (node.children && node.children.length > 0) {
                result = this.evaluateTree(result, node.children, context, depth + 1, maxDepth);
            }
        }

        return result;
    }

    /**
     * 变量替换插值
     */
    private interpolate(template: string, context: MacroEvaluationContext): string {
        if (!template) return '';

        return template.replace(/\{([^}]+)\}/g, (match, key) => {
            const trimmed = key.trim();
            if (trimmed === 'name' || trimmed === 'characterName') {
                return context.characterName || context.characterRule?.nameCN || '';
            }
            if (trimmed === 'hair' || trimmed === 'hairStyle') {
                return context.characterRule?.hair || '';
            }
            if (trimmed === 'eyes' || trimmed === 'eyeColor') {
                return context.characterRule?.eyes || '';
            }
            if (trimmed === 'outfit' || trimmed === 'outfitUpper') {
                return context.outfitRule?.upperBody || '';
            }
            if (context.variables && context.variables[trimmed] !== undefined) {
                return context.variables[trimmed];
            }
            return match;
        });
    }
}
