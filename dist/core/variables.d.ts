/**
 * @module core/variables
 * @description 可配置模型与生图参数变量注册表
 *
 * 职责：
 * - 定义工作流 JSON 模板中占位符变量 (如 %prompt%, %ckpt_name%) 的常量元数据
 * - 提供可视化蓝图编辑器与模板替换引擎的变量选择基准
 */
export interface ParameterVariable {
    key: string;
    name: string;
    category: 'prompt' | 'model' | 'sampler' | 'resolution' | 'other';
    type: 'string' | 'number';
    description: string;
}
export declare const PARAMETER_VARIABLES: ParameterVariable[];
//# sourceMappingURL=variables.d.ts.map