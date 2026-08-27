/**
 * @module domain/pipeline/variable-evaluator
 * @description 动态变量与 LoRA 标签求值引擎 (<lora:...>, <wlr:...>)
 */
export interface ParsedLoraTag {
    raw: string;
    name: string;
    modelWeight: number;
    clipWeight?: number;
    triggerWeight?: number;
}
export declare class VariableEvaluator {
    /**
     * 提取并解析提示词中的所有 <lora:name:weight> 或 <wlr:name:weight:clip:trigger> 标签，并返回纯净提示词
     *
     * @param text 包含 LoRA 标签的原始提示词
     * @returns 清洗后的提示词文本与解析出的 LoRA 标签数组
     */
    parseLoraTags(text: string): {
        cleanText: string;
        loras: ParsedLoraTag[];
    };
    /**
     * 展开全局变量占位符
     */
    evaluateVariables(text: string, variables: Record<string, string>): string;
    /**
     * 清洗提示词中的多余空行、连续空格及孤立逗号 (cleanExtraSpacesAndLines)
     */
    cleanPrompt(text: string): string;
}
//# sourceMappingURL=variable-evaluator.d.ts.map