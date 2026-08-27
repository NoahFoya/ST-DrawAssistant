/**
 * @module core/variables/macro-variables
 * @description 可配置模型与生图参数变量注册表 (ParameterVariables)
 */
export interface ParameterVariable {
    key: string;
    name: string;
    category: 'prompt' | 'model' | 'sampler' | 'resolution' | 'other';
    type: 'string' | 'number';
    description: string;
}
export declare const PARAMETER_VARIABLES: ParameterVariable[];
/**
 * 提示词清洗与规范化工具
 */
export declare function cleanPromptFormatting(rawPrompt: string): string;
//# sourceMappingURL=macro-variables.d.ts.map