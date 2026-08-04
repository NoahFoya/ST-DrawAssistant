/**
 * ComfyUI Workflow 注入工具
 *
 * 职责：
 * 1. 持有 Wai 工作流作为内置默认工作流
 * 2. 根据 WorkflowInjectionConfig 将生成参数注入到工作流节点
 * 3. 返回可直接 POST 到 /prompt 的 workflow 对象
 *
 * 策略：直接修改已知节点 ID 的 inputs 字段，不依赖节点类型扫描。
 * 这样即使工作流含有自定义节点（如 WeiLinPromptUI），也能正确注入。
 */
import type { GenerateOptions } from './types';
import type { WorkflowInjectionConfig } from '../settings/types';
export type WorkflowJson = Record<string, {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: {
        title?: string;
    };
}>;
/**
 * 获取工作流 JSON 对象
 * - 若 workflowJsonStr 非空，解析用户自定义工作流
 * - 否则使用内置 Wai 工作流（深拷贝，避免直接修改原对象）
 *
 * @param workflowJsonStr 用户在设置面板中粘贴的工作流 JSON 字符串
 */
export declare function loadWorkflow(workflowJsonStr: string): WorkflowJson;
/**
 * 将生成参数注入到工作流节点
 *
 * @param workflow 工作流对象（将被原地修改）
 * @param options 生成参数
 * @param injection 注入点配置
 * @param promptPrefix 全局正向提示词前缀
 * @param negativePrefix 全局负向提示词
 * @returns 注入后的工作流对象（同一引用，已原地修改）
 */
export declare function injectParams(workflow: WorkflowJson, options: GenerateOptions, injection: WorkflowInjectionConfig, promptPrefix: string, negativePrefix: string): WorkflowJson;
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