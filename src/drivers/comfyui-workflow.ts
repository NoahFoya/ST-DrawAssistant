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

// ─── 工作流节点类型 ────────────────────────────────────────────────────────────

export type WorkflowJson = Record<string, {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
}>;

// ─── 内置 Wai 工作流 ─────────────────────────────────────────────────────────

/**
 * 内置 Wai Illustrious SDXL 工作流
 * 节点结构：
 *   114 CheckpointLoaderSimple → 113 WeiLinPromptUI → 63 KSampler → 8 VAEDecode → 99 SaveImage
 *   12 CLIPTextEncode（负向）→ 63 KSampler.negative
 *   119/118/120 PrimitiveInt（宽/高/批量）→ 28 EmptyLatentImage → 63 KSampler.latent_image
 */
const BUILTIN_WAI_WORKFLOW: WorkflowJson = {
    "8": {
        "inputs": { "samples": ["63", 0], "vae": ["114", 2] },
        "class_type": "VAEDecode",
        "_meta": { "title": "VAE解码" }
    },
    "12": {
        "inputs": {
            "text": "score_1, score_2, score_3, bad anatomy, bad proportions, deformed anatomy, deformed face, deformed eyes, text, multiple fingers, watermark, artist name",
            "clip": ["113", 2]
        },
        "class_type": "CLIPTextEncode",
        "_meta": { "title": "CLIP文本编码（负向）" }
    },
    "28": {
        "inputs": {
            "width": ["119", 0],
            "height": ["118", 0],
            "batch_size": ["120", 0]
        },
        "class_type": "EmptyLatentImage",
        "_meta": { "title": "空Latent图像" }
    },
    "63": {
        "inputs": {
            "seed": 536474517963359,
            "steps": 18,
            "cfg": 6,
            "sampler_name": "euler_ancestral",
            "scheduler": "normal",
            "denoise": 1,
            "model": ["113", 3],
            "positive": ["113", 1],
            "negative": ["12", 0],
            "latent_image": ["28", 0]
        },
        "class_type": "KSampler",
        "_meta": { "title": "K采样器" }
    },
    "99": {
        "inputs": { "filename_prefix": "ComfyUI", "images": ["8", 0] },
        "class_type": "SaveImage",
        "_meta": { "title": "保存图像" }
    },
    "113": {
        "inputs": {
            "positive": "masterpiece, best quality, 1girl",
            "auto_random": false,
            "lora_str": "",
            "temp_str": "[]",
            "temp_lora_str": "",
            "opt_clip": ["114", 1],
            "opt_model": ["114", 0]
        },
        "class_type": "WeiLinPromptUI",
        "_meta": { "title": "WeiLin 全能提示词编辑器" }
    },
    "114": {
        "inputs": { "ckpt_name": "waiIllustriousSDXL_v170.safetensors" },
        "class_type": "CheckpointLoaderSimple",
        "_meta": { "title": "Checkpoint加载器（简易）" }
    },
    "118": {
        "inputs": { "value": 1344 },
        "class_type": "PrimitiveInt",
        "_meta": { "title": "画高" }
    },
    "119": {
        "inputs": { "value": 1024 },
        "class_type": "PrimitiveInt",
        "_meta": { "title": "画宽" }
    },
    "120": {
        "inputs": { "value": 1 },
        "class_type": "PrimitiveInt",
        "_meta": { "title": "批量次数" }
    }
};

// ─── 工作流加载 ───────────────────────────────────────────────────────────────

/**
 * 获取工作流 JSON 对象
 * - 若 workflowJsonStr 非空，解析用户自定义工作流
 * - 否则使用内置 Wai 工作流（深拷贝，避免直接修改原对象）
 *
 * @param workflowJsonStr 用户在设置面板中粘贴的工作流 JSON 字符串
 */
export function loadWorkflow(workflowJsonStr: string): WorkflowJson {
    if (workflowJsonStr.trim()) {
        try {
            return JSON.parse(workflowJsonStr) as WorkflowJson;
        } catch {
            console.warn('[ST-DrawAssistant] Failed to parse custom workflow JSON, falling back to builtin');
        }
    }
    // 深拷贝内置工作流，确保每次生图独立
    return JSON.parse(JSON.stringify(BUILTIN_WAI_WORKFLOW)) as WorkflowJson;
}

// ─── 参数注入 ─────────────────────────────────────────────────────────────────

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
export function injectParams(
    workflow: WorkflowJson,
    options: GenerateOptions,
    injection: WorkflowInjectionConfig,
    promptPrefix: string,
    negativePrefix: string
): WorkflowJson {
    // 组合最终正向提示词：全局前缀 + AI 生成提示词
    const finalPositive = [promptPrefix, options.prompt]
        .filter(Boolean)
        .join(', ');

    // 组合最终负向提示词：设置中的默认值 + 可选的额外负向提示词
    const finalNegative = [
        negativePrefix,
        options.negativePrompt ?? '',
    ].filter(Boolean).join(', ');

    // ── 注入正向提示词 ────────────────────────────────────────────────────────
    const posNode = workflow[injection.positiveNodeId];
    if (posNode) {
        posNode.inputs[injection.positiveField] = finalPositive;
    } else {
        console.warn(`[ST-DrawAssistant] 正向提示词节点 "${injection.positiveNodeId}" 不存在于工作流中`);
    }

    // ── 注入负向提示词 ────────────────────────────────────────────────────────
    const negNode = workflow[injection.negativeNodeId];
    if (negNode) {
        negNode.inputs[injection.negativeField] = finalNegative;
    } else {
        console.warn(`[ST-DrawAssistant] 负向提示词节点 "${injection.negativeNodeId}" 不存在于工作流中`);
    }

    // ── 注入宽度 ──────────────────────────────────────────────────────────────
    const widthNode = workflow[injection.widthNodeId];
    if (widthNode) {
        widthNode.inputs[injection.widthField] = options.width;
    }

    // ── 注入高度 ──────────────────────────────────────────────────────────────
    const heightNode = workflow[injection.heightNodeId];
    if (heightNode) {
        heightNode.inputs[injection.heightField] = options.height;
    }

    // ── 注入 KSampler 参数 ────────────────────────────────────────────────────
    const samplerNode = workflow[injection.kSamplerNodeId];
    if (samplerNode) {
        // 使用随机种子（若 options.seed 为 -1 或未提供）
        samplerNode.inputs['seed'] = (options.seed !== undefined && options.seed >= 0)
            ? options.seed
            : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        samplerNode.inputs['steps'] = options.steps;
        samplerNode.inputs['cfg'] = options.cfgScale;
        samplerNode.inputs['sampler_name'] = options.samplerName;
        if ('scheduler' in options && options.scheduler) {
            samplerNode.inputs['scheduler'] = options.scheduler;
        }
    } else {
        console.warn(`[ST-DrawAssistant] KSampler 节点 "${injection.kSamplerNodeId}" 不存在于工作流中`);
    }

    return workflow;
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
