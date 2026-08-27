/**
 * @module extensions/character-manager/macro-engine
 * @description 树形宏规则 (Macro Rule Tree) 递归展开与条件求值引擎
 */
import { CharacterRule, OutfitRule } from './types';
export interface MacroRuleNode {
    id: string;
    name: string;
    enabled: boolean;
    pattern?: string;
    replacement?: string;
    children?: MacroRuleNode[];
}
export interface MacroEvaluationContext {
    characterName?: string;
    characterRule?: CharacterRule;
    outfitRule?: OutfitRule;
    variables?: Record<string, string>;
}
export declare class MacroEngine {
    /**
     * 递归展开树形宏规则
     */
    evaluateTree(prompt: string, nodes: MacroRuleNode[], context: MacroEvaluationContext, depth?: number, maxDepth?: number): string;
    /**
     * 变量替换插值
     */
    private interpolate;
}
//# sourceMappingURL=macro-engine.d.ts.map