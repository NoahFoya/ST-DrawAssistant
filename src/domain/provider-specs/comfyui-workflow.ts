/**
 * ComfyUI API 工作流节点图解析、模板变量匹配与 WeiLin 节点识别纯领域逻辑。
 */

/** 替换变量信息 */
export interface VariableReplacementInfo {
    variable: string;
    nodeId: string;
    classType: string;
    field: string;
    prevValue: unknown;
}

/** 未匹配变量信息 */
export interface UnmatchedVariableInfo {
    variable: string;
    label: string;
    tip: string;
}

/** 工作流分析结果 */
export interface WorkflowAnalysisResult {
    success: boolean;
    error?: string;
    formattedJson: string;
    replaced: VariableReplacementInfo[];
    unmatched: UnmatchedVariableInfo[];
}

/** ComfyUI 工作流宏变量定义规范 */
export interface ComfyWorkflowVariableDefinition {
    variable: string;
    label: string;
    matchKeys: readonly string[];
    tip: string;
}

/** ComfyUI 标准模板变量定义字典 */
export const COMFYUI_VARIABLE_DEFINITIONS: readonly ComfyWorkflowVariableDefinition[] = [
    {
        variable: '%basemodel_name%',
        label: '主模型',
        matchKeys: ['ckpt_name', 'unet_name', 'model_name'],
        tip: '主模型文件名 (通常位于 CheckpointLoaderSimple 或 UNETLoader 节点)',
    },
    {
        variable: '%clip_name%',
        label: 'CLIP 模型',
        matchKeys: ['clip_name'],
        tip: 'CLIP 文本特征提取模型 (通常位于 CLIPLoader 节点)',
    },
    {
        variable: '%vae_name%',
        label: 'VAE 模型',
        matchKeys: ['vae_name'],
        tip: 'VAE 图像编解码模型 (通常位于 VAELoader 节点)',
    },
    {
        variable: '%prompt%',
        label: '正向提示词',
        matchKeys: ['positive', 'text'],
        tip: '包含正向起手式、风格修饰与主体描述词',
    },
    {
        variable: '%negative_prompt%',
        label: '负向提示词',
        matchKeys: ['negative', 'text'],
        tip: '包含负向过滤词与质量排除词',
    },
    {
        variable: '%seed%',
        label: '随机种子',
        matchKeys: ['seed', 'noise_seed'],
        tip: '随机种子数值 (通常位于 KSampler 或 Seed 节点)',
    },
    {
        variable: '%steps%',
        label: '采样步数',
        matchKeys: ['steps'],
        tip: '采样迭代步数 (通常位于 KSampler 节点)',
    },
    {
        variable: '%cfg%',
        label: '引导系数 (CFG Scale)',
        matchKeys: ['cfg', 'cfg_scale'],
        tip: '提示词引导系数 (通常位于 KSampler 节点)',
    },
    {
        variable: '%sampler_name%',
        label: '采样算法 (Sampler)',
        matchKeys: ['sampler_name', 'sampler'],
        tip: '采样算法名称 (如 euler, dpmpp_2m)',
    },
    {
        variable: '%scheduler%',
        label: '调度器 (Scheduler)',
        matchKeys: ['scheduler'],
        tip: '采样调度策略 (如 normal, karras)',
    },
    {
        variable: '%width%',
        label: '图像宽度',
        matchKeys: ['width'],
        tip: '生成宽度 (通常位于 EmptyLatentImage 节点)',
    },
    {
        variable: '%height%',
        label: '图像高度',
        matchKeys: ['height'],
        tip: '生成高度 (通常位于 EmptyLatentImage 节点)',
    },
    {
        variable: '%denoise%',
        label: '重绘幅度',
        matchKeys: ['denoise'],
        tip: '去噪强度 (通常位于图生图/重绘 KSampler 节点)',
    },
    {
        variable: '%input_image%',
        label: '重绘原图',
        matchKeys: ['image'],
        tip: '图生图或局部重绘上传后的原图文件名 (通常位于 LoadImage 节点)',
    },
    {
        variable: '%inpaint_mask%',
        label: '重绘蒙版',
        matchKeys: ['image'],
        tip: '局部重绘上传后的蒙版文件名 (通常位于加载蒙版 LoadImage 节点)',
    },
    {
        variable: '%mask_blur%',
        label: '蒙版羽化',
        matchKeys: ['grow_mask_by'],
        tip: '局部重绘蒙版边缘扩展像素 (通常位于 VAEEncodeForInpaint 节点)',
    },
] as const;

const COMFY_UI_LAYOUT_ERROR =
    '检测到当前内容为 ComfyUI Web 界面格式 (UI Layout)，非生图服务所需的 API Prompt 格式。请在新版 ComfyUI 菜单点击「工作流 (Workflow) → 导出 (API) / Export (API)」，或在旧版设置开启「Enable Dev mode Options」后通过「Save (API Format)」导出。';

const AUXILIARY_MODEL_LOADER_PATTERN =
    /(upscale|controlnet|lora|detailer|yolo|sam|bbox|ipadapter|clipvision|stylemodel|gligen|hypernetwork|embedding|facerestore|pulid|instantid|reactor|insightface)/i;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isComfyNodeEntry(value: unknown): boolean {
    if (!isPlainRecord(value)) return false;
    if (typeof value.class_type !== 'string' || !value.class_type.trim()) return false;
    return value.inputs === undefined || isPlainRecord(value.inputs);
}

function isComfyUiLayoutObject(obj: Record<string, unknown>): boolean {
    return Array.isArray(obj.nodes) && (Array.isArray(obj.links) || obj.version !== undefined);
}

export interface ParsedComfyWorkflowResult {
    ok: true;
    workflow: Record<string, unknown>;
    extractedName?: string;
    extraData?: Record<string, unknown>;
}

export interface ParsedComfyWorkflowError {
    ok: false;
    error: string;
}

/**
 * 统一解析 ComfyUI 工作流输入（支持原生 API Prompt JSON、{ prompt } 提交体以及插件导出的 { data: { workflow } } / { workflow } 预设格式）。
 */
export function parseComfyWorkflowInput(
    raw: unknown,
    options?: { requireNodes?: boolean }
): ParsedComfyWorkflowResult | ParsedComfyWorkflowError {
    let root: unknown = raw;
    if (typeof root === 'string') {
        const trimmed = root.trim();
        if (!trimmed) {
            return {
                ok: false,
                error: options?.requireNodes ? '工作流文件内容为空' : '工作流 JSON 内容为空',
            };
        }
        try {
            root = JSON.parse(trimmed);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: `JSON 语法解析错误: ${message}` };
        }
    }

    if (!isPlainRecord(root)) {
        return {
            ok: false,
            error: '无效的工作流数据：根节点必须为包含节点 ID 的 JSON 对象',
        };
    }

    if (isComfyUiLayoutObject(root)) {
        return { ok: false, error: COMFY_UI_LAYOUT_ERROR };
    }

    const extractedName =
        typeof root.name === 'string' && root.name.trim() ? root.name.trim() : undefined;
    let extraData: Record<string, unknown> | undefined;
    let target: unknown = root;

    if (isPlainRecord(root.data)) {
        if ('workflow' in root.data) {
            target = root.data.workflow;
            const rest = { ...root.data };
            delete rest.workflow;
            if (Object.keys(rest).length > 0) extraData = rest;
        } else {
            return {
                ok: false,
                error: '工作流预设格式错误：data 中未包含有效的 workflow 定义',
            };
        }
    } else if ('workflow' in root) {
        target = root.workflow;
    } else if (isPlainRecord(root.prompt) && !isComfyNodeEntry(root.prompt)) {
        target = root.prompt;
    }

    if (!isPlainRecord(target)) {
        return {
            ok: false,
            error: '无效的工作流数据：解析后的工作流必须为包含节点 ID 的 Object 字典结构',
        };
    }

    if (isComfyUiLayoutObject(target)) {
        return { ok: false, error: COMFY_UI_LAYOUT_ERROR };
    }

    const entries = Object.entries(target);
    if (entries.length === 0) {
        if (options?.requireNodes) {
            return {
                ok: false,
                error: '工作流文件未包含任何节点定义',
            };
        }
        return { ok: true, workflow: target, extractedName, extraData };
    }

    const nodeEntries = entries.filter(([, node]) => isComfyNodeEntry(node));
    const hasUnrelatedConfigShape =
        'entries' in target || 'accent' in target || 'characterRules' in target || 'providers' in target;

    if (nodeEntries.length === 0 || hasUnrelatedConfigShape) {
        return {
            ok: false,
            error: '工作流格式错误：未识别为 ComfyUI API Prompt 节点图（请使用 Save (API Format) 导出）',
        };
    }

    return { ok: true, workflow: target, extractedName, extraData };
}

/**
 * 判断工作流节点字段是否适合自动匹配或推荐绑定为指定模板变量。
 */
export function isWorkflowFieldEligibleForVariable(
    variable: string,
    classType: string,
    field: string
): boolean {
    const fieldLower = field.toLowerCase();
    const classLower = (classType || '').toLowerCase();

    if (variable === '%basemodel_name%' && fieldLower === 'model_name') {
        return !AUXILIARY_MODEL_LOADER_PATTERN.test(classLower);
    }

    if (variable === '%denoise%' && fieldLower === 'denoise') {
        return classLower.includes('sampler') && !classLower.includes('upscale');
    }

    return true;
}

/**
 * 检测解析后的 ComfyUI API 节点图对象中是否包含 WeiLin 扩展节点。
 */
export function hasWeilinNodeInGraph(workflow: Record<string, unknown> | undefined | null): boolean {
    if (!workflow || typeof workflow !== 'object') {
        return false;
    }
    return Object.values(workflow).some((node) => {
        if (!isPlainRecord(node)) {
            return false;
        }
        const classType =
            typeof node.class_type === 'string' ? node.class_type.trim() : '';
        const title =
            isPlainRecord(node._meta) && typeof node._meta.title === 'string'
                ? node._meta.title
                : '';
        return /weilin/i.test(classType) || /weilin/i.test(title);
    });
}

/**
 * 快速检测给定工作流 JSON 中是否包含 WeiLin 扩展节点。
 */
export function hasWeilinNodeInWorkflow(jsonStr: string): boolean {
    if (!jsonStr || typeof jsonStr !== 'string') return false;
    const parsed = parseComfyWorkflowInput(jsonStr);
    if (!parsed.ok) return false;
    return hasWeilinNodeInGraph(parsed.workflow);
}

interface WorkflowNodeItem {
    readonly class_type?: string;
    readonly _meta?: { title?: string };
    readonly title?: string;
    inputs?: Record<string, unknown>;
    readonly [key: string]: unknown;
}

/**
 * 遍历扫描 ComfyUI 工作流 JSON 的各节点输入参数 (inputs)，匹配并绑定模板变量。
 */
export function analyzeAndReplaceWorkflowVariables(jsonStr: string): WorkflowAnalysisResult {
    const parsedRes = parseComfyWorkflowInput(jsonStr);
    if (!parsedRes.ok) {
        return {
            success: false,
            error: parsedRes.error,
            formattedJson: jsonStr,
            replaced: [],
            unmatched: [],
        };
    }

    const parsed = structuredClone(parsedRes.workflow);

    const positiveNodeIds = new Set<string>();
    const negativeNodeIds = new Set<string>();

    for (const [, rawNode] of Object.entries(parsed)) {
        if (!rawNode || typeof rawNode !== 'object') continue;
        const node = rawNode as WorkflowNodeItem;
        if (!node.inputs) continue;
        const inputs = node.inputs;
        if (Array.isArray(inputs.positive) && inputs.positive.length >= 1) {
            positiveNodeIds.add(String(inputs.positive[0]));
        }
        if (Array.isArray(inputs.negative) && inputs.negative.length >= 1) {
            negativeNodeIds.add(String(inputs.negative[0]));
        }
    }

    const isExplicitNegative = (
        nodeId: string,
        node: { _meta?: { title?: string }; title?: string }
    ): boolean => {
        if (negativeNodeIds.has(nodeId)) return true;
        const title = String(node._meta?.title || node.title || '').toLowerCase();
        return title.includes('negative') || title.includes('负向') || title.includes('负面');
    };

    const isExplicitPositive = (
        nodeId: string,
        node: { _meta?: { title?: string }; title?: string }
    ): boolean => {
        if (positiveNodeIds.has(nodeId)) return true;
        const title = String(node._meta?.title || node.title || '').toLowerCase();
        return title.includes('positive') || title.includes('正向') || title.includes('正面');
    };

    const replaced: VariableReplacementInfo[] = [];
    const matchedVars = new Set<string>();

    for (const [nodeId, rawNode] of Object.entries(parsed)) {
        if (!rawNode || typeof rawNode !== 'object') continue;
        const node = rawNode as WorkflowNodeItem;
        if (!node.inputs) continue;
        const classType = node.class_type || node._meta?.title || 'Unknown';
        const inputs = node.inputs;

        for (const [field, val] of Object.entries(inputs)) {
            if (Array.isArray(val)) continue;

            const fieldLower = field.toLowerCase();
            const isTextField =
                fieldLower === 'text' || fieldLower === 'positive' || fieldLower === 'negative';

            let preferredVar: string | null = null;
            if (isTextField) {
                if (isExplicitNegative(nodeId, node) || fieldLower === 'negative') {
                    preferredVar = '%negative_prompt%';
                } else if (isExplicitPositive(nodeId, node) || fieldLower === 'positive') {
                    preferredVar = '%prompt%';
                }
            }

            for (const item of COMFYUI_VARIABLE_DEFINITIONS) {
                if (matchedVars.has(item.variable)) continue;

                if (typeof val === 'string' && val.trim() === item.variable) {
                    matchedVars.add(item.variable);
                    break;
                }

                if (
                    preferredVar &&
                    (item.variable === '%prompt%' || item.variable === '%negative_prompt%')
                ) {
                    if (item.variable !== preferredVar) continue;
                }

                if (!isWorkflowFieldEligibleForVariable(item.variable, classType, field)) {
                    continue;
                }

                const isMatch = item.matchKeys.some(
                    (k: string) => fieldLower === k.toLowerCase()
                );
                if (isMatch) {
                    inputs[field] = item.variable;
                    replaced.push({
                        variable: item.variable,
                        nodeId,
                        classType,
                        field,
                        prevValue: val,
                    });
                    matchedVars.add(item.variable);
                    break;
                }
            }
        }
    }

    const unmatched: UnmatchedVariableInfo[] = [];
    for (const item of COMFYUI_VARIABLE_DEFINITIONS) {
        if (!matchedVars.has(item.variable)) {
            unmatched.push({
                variable: item.variable,
                label: item.label,
                tip: item.tip,
            });
        }
    }

    return {
        success: true,
        formattedJson: JSON.stringify(parsed, null, 2),
        replaced,
        unmatched,
    };
}
