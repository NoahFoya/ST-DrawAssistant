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
import { DEFAULT_WAI_WORKFLOW_JSON } from '../settings/defaults';
import { logger } from '../core/logger';

// ─── 工作流节点类型 ────────────────────────────────────────────────────────────

export interface WorkflowNode {
    inputs: Record<string, unknown>;
    class_type: string;
    _meta?: Record<string, unknown>;
}

export type WorkflowJson = Record<string, WorkflowNode>;

// ─── 工作流加载 ───────────────────────────────────────────────────────────────

/**
 * 获取工作流 JSON 对象
 * - 若 workflowJsonStr 非空，解析用户自定义工作流
 * - 否则使用内置 Wai 工作流
 *
 * @param workflowJsonStr 用户在设置面板中粘贴的工作流 JSON 字符串
 */
export function loadWorkflow(workflowJsonStr: string): WorkflowJson {
    const rawJson = workflowJsonStr && workflowJsonStr.trim() ? workflowJsonStr : DEFAULT_WAI_WORKFLOW_JSON;
    try {
        return JSON.parse(rawJson) as WorkflowJson;
    } catch (err) {
        logger.error('致命错误: 工作流 JSON 解析失败!', err);
        throw new Error(`工作流 JSON 语法错误: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * 使用正则与类型解析将工作流 JSON 字符串中的 %xxx% 变量替换为实际运行参数
 * 提示词正负向按五段式 / 三段式精准顺序拼接后注入工作流
 *
 * @param workflowJsonStr 用户定义的 ComfyUI API 格式工作流 JSON 字符串
 * @param options 生图运行参数 (含 prompt, negativePrompt, width, height, steps, cfgScale, seed 等)
 * @param promptPrefix 正向前缀提示词
 * @param negativePrefix 负向提示词
 * @param checkpointPosPrefix 模型专用正向提示词 (归属于模型预设)
 * @param checkpointNegPrefix 模型专用负向提示词 (归属于模型预设)
 * @param promptSuffix 正向后缀提示词 (含格式化追加的 Lora 标签)
 * @returns 完成参数注入可直接提交至 /prompt 的工作流 JSON 对象
 */
export function substituteWorkflowVariables(
    workflowJsonStr: string,
    options: GenerateOptions,
    promptPrefix: string,
    negativePrefix: string,
    checkpointPosPrefix: string = '',
    checkpointNegPrefix: string = '',
    promptSuffix: string = ''
): WorkflowJson {
    const rawJson = workflowJsonStr && workflowJsonStr.trim() ? workflowJsonStr : DEFAULT_WAI_WORKFLOW_JSON;

    // 组合最终正向与负向提示词 (防范二次重复拼接：若 options.prompt 已包含前缀，则直接使用 options.prompt)
    let finalPositive = (options.prompt || '').trim();
    if (promptPrefix || checkpointPosPrefix || promptSuffix) {
        const hasPrefix = (promptPrefix && finalPositive.includes(promptPrefix.trim())) ||
                          (checkpointPosPrefix && finalPositive.includes(checkpointPosPrefix.trim()));
        if (!hasPrefix) {
            finalPositive = [checkpointPosPrefix, promptPrefix, options.prompt, promptSuffix]
                .map(s => (s ?? '').trim())
                .filter(Boolean)
                .join(', ');
        }
    }

    let finalNegative = (options.negativePrompt || '').trim();
    if (negativePrefix || checkpointNegPrefix) {
        const hasNegPrefix = (negativePrefix && finalNegative.includes(negativePrefix.trim())) ||
                             (checkpointNegPrefix && finalNegative.includes(checkpointNegPrefix.trim()));
        if (!hasNegPrefix) {
            finalNegative = [
                checkpointNegPrefix,
                negativePrefix,
                options.negativePrompt ?? '',
            ].map(s => (s ?? '').trim()).filter(Boolean).join(', ');
        }
    }

    const seed = (options.seed !== undefined && options.seed >= 0)
        ? options.seed
        : Math.floor(Math.random() * 1000000000000000);

    const stringVarMap: Record<string, string> = {
        '%prompt%': finalPositive,
        '%negative_prompt%': finalNegative,
        '%ckpt_name%': options.ckptName || '',
        '%clip_name%': options.clipName || '',
        '%vae_name%': options.vaeName || '',
        '%sampler_name%': options.samplerName || 'euler_ancestral',
        '%scheduler%': options.scheduler || 'normal',
    };

    const numVarMap: Record<string, number> = {
        '%width%': options.width,
        '%height%': options.height,
        '%steps%': options.steps,
        '%cfg%': options.cfgScale,
        '%seed%': seed,
        '%denoise%': options.denoise ?? 1.0,
    };

    let processed = rawJson;

    // 1. 替换数值变量（处理带引号与不带引号情况，确保符合 JSON 语法）
    //    数值变量的替换内容为纯数字字符串，不含 $ 等特殊字符，直接替换安全。
    for (const [key, numVal] of Object.entries(numVarMap)) {
        const quotedKeyRegex = new RegExp(`"\\${key}"`, 'g');
        const rawKeyRegex = new RegExp(`\\${key}`, 'g');
        const numStr = String(numVal);
        processed = processed.replace(quotedKeyRegex, numStr);
        processed = processed.replace(rawKeyRegex, numStr);
    }

    // 2. 替换字符串变量（使用函数形式 replacement 防止用户输入的 $ 被误解释）
    //    String.replace(regex, string) 中 $1/$&/$' 等有特殊语义（MDN 确认）。
    //    用户提示词前缀可能含 LoRA 语法 <lora:name_$1:0.8> 或货币符号 $100，
    //    必须使用函数形式 replace(regex, () => str) 才能将返回值视为纯字面量。
    for (const [key, strVal] of Object.entries(stringVarMap)) {
        const escapedStr = JSON.stringify(strVal).slice(1, -1);
        const rawKeyRegex = new RegExp(`\\${key}`, 'g');
        processed = processed.replace(rawKeyRegex, () => escapedStr);
    }

    try {
        return JSON.parse(processed) as WorkflowJson;
    } catch (err) {
        logger.error('变量替换后 JSON 解析失败:', { err, processed });
        throw new Error(`工作流变量解析错误: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// ─── 输出图像提取 ─────────────────────────────────────────────────────────────

/**
 * 从 /history 响应的 outputs 中提取输出图像信息
 *
 * @param outputs history 响应的 outputs 字段
 * @param saveImageNodeId SaveImage 节点 ID（如 "99"）
 * @returns 第一张输出图像的引用，若无则返回 null
 */
export function extractFirstOutputImage(
    outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>,
    saveImageNodeId: string
): { filename: string; subfolder: string; type: string } | null {
    // 优先从 SaveImage 节点获取
    const saveNode = outputs[saveImageNodeId];
    if (saveNode?.images?.[0]) {
        return saveNode.images[0];
    }

    // 后备：扫描所有节点找到第一个有 images 输出的节点
    for (const nodeOutput of Object.values(outputs)) {
        if (nodeOutput.images?.[0]) {
            return nodeOutput.images[0];
        }
    }

    return null;
}
