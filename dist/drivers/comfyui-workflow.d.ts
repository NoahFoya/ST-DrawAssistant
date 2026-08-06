/**
 * @module drivers/comfyui-workflow
 * @description ComfyUI Workflow 工作流变量解析与参数注入引擎
 *
 * 职责：
 * - 持有内置默认工作流模版
 * - 深度搜索与解析 %prompt%, %width%, %height% 等占位符变量
 * - 动态追加正负向 Prefix/Suffix 及 Lora 组合
 * - 从 /history 响应结构中安全提取 SaveImage 输出节点结果
 *
 * 规范参考：
 * - .agents/Skills/comfyui-api-reference/SKILL.md §4 (Workflow API JSON 结构规范)
 */
import type { GenerateOptions } from './types';
export interface WorkflowNode {
    inputs: Record<string, unknown>;
    class_type: string;
    _meta?: Record<string, unknown>;
}
export type WorkflowJson = Record<string, WorkflowNode>;
/**
 * 获取工作流 JSON 对象
 * - 若 workflowJsonStr 非空，解析用户自定义工作流
 * - 否则使用内置 Wai 工作流
 *
 * @param workflowJsonStr 用户在设置面板中粘贴的工作流 JSON 字符串
 */
export declare function loadWorkflow(workflowJsonStr: string): WorkflowJson;
/**
 * 使用正则与类型解析将工作流 JSON 字符串中的 %xxx% 变量替换为实际运行参数
 * 纯粹变量映射：直接将前置编译完成的 options.prompt 映射至 %prompt%
 *
 * @param workflowJsonStr 用户定义的 ComfyUI API 格式工作流 JSON 字符串
 * @param options 生图运行参数 (含 prompt, negativePrompt, width, height, steps, cfgScale, seed 等)
 * @returns 完成参数注入可直接提交至 /prompt 的工作流 JSON 对象
 */
export declare function substituteWorkflowVariables(workflowJsonStr: string, options: GenerateOptions): WorkflowJson;
/**
 * 从 /history 响应的 outputs 中提取输出图像信息
 *
 * @param outputs history 响应的 outputs 字段
 * @param saveImageNodeId SaveImage 节点 ID（如 "99"）
 * @returns 第一张输出图像的引用，若无则返回 null
 */
export declare function extractFirstOutputImage(outputs: Record<string, {
    images?: Array<{
        filename: string;
        subfolder: string;
        type: string;
    }>;
}>, saveImageNodeId: string): {
    filename: string;
    subfolder: string;
    type: string;
} | null;
//# sourceMappingURL=comfyui-workflow.d.ts.map