/**
 * @module extensions/character-manager/domain/macro-engine
 * @description 树形宏规则 (Macro Rule Tree) 递归展开与条件求值引擎
 */

import { CharacterRule, OutfitRule } from '../types';

/** 树形宏规则节点数据结构 */
export interface MacroRuleNode {
    /** 节点唯一标识 */
    id: string;
    /** 规则节点显示名称 */
    name: string;
    /** 是否启用当前规则节点 */
    enabled: boolean;
    /** 正则表达式匹配条件表达式 */
    pattern?: string;
    /** 匹配命中后注入或替换的目标模板文本 */
    replacement?: string;
    /** 嵌套子规则节点列表 */
    children?: MacroRuleNode[];
}

/** 宏求值上下文上下文对象 */
export interface MacroEvaluationContext {
    /** 当前生效的角色名称 */
    characterName?: string;
    /** 当前角色的特征描述规则 */
    characterRule?: CharacterRule;
    /** 当前选中的服装描述规则 */
    outfitRule?: OutfitRule;
    /** 附加动态变量字典 */
    variables?: Record<string, string>;
}

/**
 * 树形宏规则求值引擎
 */
export class MacroEngine {
    /**
     * 递归遍历并对提示词应用树形宏规则
     *
     * @param prompt 待展开求值的原始提示词文本
     * @param nodes 树形规则节点数组
     * @param context 求值上下文信息
     * @param depth 当前递归层级深度 (内部递归使用)
     * @param maxDepth 最大允许递归层级深度，防止循环引用
     * @returns 展开求值后的提示词文本
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
                        const replaced = this.interpolate(node.replacement, context);
                        result = result.replace(regex, replaced);
                    }
                } catch {
                    // 正则表达式语法非法时安全跳过当前节点，避免阻断流水线
                }
            }

            if (node.children && node.children.length > 0) {
                result = this.evaluateTree(result, node.children, context, depth + 1, maxDepth);
            }
        }

        return result;
    }

    /**
     * 将模板文本中的占位符 `{key}` 替换为上下文中的实际属性值
     *
     * @param template 包含占位符的模板字符串
     * @param context 宏求值上下文对象
     * @returns 插值替换后的字符串
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
