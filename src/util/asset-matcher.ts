/**
 * 服务端资产模型与预设引用的归一化匹配引擎 (AssetMatcher)。
 *
 * 解决多端生图协议与模型命名格式差异造成的匹配假阳性问题：
 * 1. SD-WebUI 模型名称包含哈希后缀（如 "model.safetensors [77e9d1a3c6]"）；
 * 2. 模型扩展名差异或缺失（如 "model" vs "model.safetensors"、".ckpt"、".pt"、".gguf"、".sft"）；
 * 3. 跨操作系统路径分隔符差异（如 Windows 反斜杠 "\" 与 Unix 斜杠 "/"）；
 * 4. 子目录路径前缀差异（如包含子目录 "style/lora_name" 与纯名称 "lora_name"）；
 * 5. 英文字符大小写差异；
 * 6. ComfyUI Checkpoint 与 UNet (Flux/SD3) 联合模型检索；
 * 7. 自定义模型标识（customModel）优先级豁免。
 */

import type {
    ProviderType,
    DrawingPresetData,
    PromptPresetData,
    ProviderAssetCache,
} from '@types';

/**
 * 资产模型名称归一化，剥离哈希后缀、已知模型扩展名与冗余空格。
 *
 * @param name 原始模型名称或路径
 * @returns 归一化后的名称（小写，Unix 斜杠，无哈希与扩展名）
 */
export function normalizeAssetName(name: string): string {
    if (!name || typeof name !== 'string') {
        return '';
    }
    return name
        .replace(/\\/g, '/')
        .replace(/\s*\[[a-fA-F0-9]+\]\s*$/, '') // 剥离 SD-WebUI 哈希后缀，如 [77e9d1a3c6]
        .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, '') // 剥离常见模型文件扩展名
        .trim()
        .toLowerCase();
}

/**
 * 获取归一化资产路径的基础文件名（去掉所有父级目录）。
 *
 * @param normalizedName 已归一化的资产路径
 * @returns 仅包含最终文件名的字符串
 */
export function getAssetBaseName(normalizedName: string): string {
    if (!normalizedName) {
        return '';
    }
    const parts = normalizedName.split('/');
    return parts[parts.length - 1] ?? normalizedName;
}

/**
 * 比对目标候选模型名称是否存在于已知资产列表中。
 *
 * 采用由严到宽的分级比对策略：
 * 1. 严格全等匹配；
 * 2. 忽略大小写全等匹配；
 * 3. 归一化全路径比对（去除哈希与扩展名）；
 * 4. 基础文件名去路径容错比对（允许任一方包含子文件夹路径）。
 *
 * @param candidate 待检验的模型名称或标识
 * @param targetList 已知可用资产列表
 * @returns 是否匹配成功
 */
export function matchAssetText(
    candidate: string | undefined | null,
    targetList: readonly string[] | undefined | null
): boolean {
    if (!candidate || !targetList || targetList.length === 0) {
        return false;
    }
    const cleanCand = candidate.trim();
    if (!cleanCand) {
        return false;
    }

    // 1. 严格全等匹配
    if (targetList.includes(cleanCand)) {
        return true;
    }

    // 2. 忽略大小写全等匹配
    const candLower = cleanCand.toLowerCase();
    if (targetList.some((item) => item.toLowerCase() === candLower)) {
        return true;
    }

    // 3. 归一化全路径匹配
    const normCand = normalizeAssetName(cleanCand);
    if (!normCand) {
        return false;
    }

    for (const item of targetList) {
        const normItem = normalizeAssetName(item);
        if (normItem === normCand) {
            return true;
        }
    }

    // 4. 基础文件名去路径容错匹配（允许任一方带有子目录）
    const baseCand = getAssetBaseName(normCand);
    if (!baseCand) {
        return false;
    }

    for (const item of targetList) {
        const normItem = normalizeAssetName(item);
        const baseItem = getAssetBaseName(normItem);
        if (baseItem === baseCand) {
            return true;
        }
    }

    return false;
}

/** 校验预设资产参数选项 */
export interface ValidatePresetAssetsOptions {
    /** 当前激活的绘图预设数据 */
    drawingPreset?: DrawingPresetData | null;
    /** 当前引用的提示词预设数据 */
    promptPreset?: PromptPresetData | null;
    /** 服务端已同步的资产缓存快照 */
    assetCache?: ProviderAssetCache | null;
    /** 当前激活的服务提供方类型 */
    providerType: ProviderType;
}

/** 预设资产校验结果 */
export interface PresetAssetValidationResult {
    /** 是否全部可用模型均已就绪（无缺失项） */
    valid: boolean;
    /** 缺失的模型描述列表 */
    missing: string[];
}

/**
 * 校验当前绘图预设与提示词预设引用的模型资产在服务端是否存在。
 *
 * @param options 校验参数
 * @returns 校验结果与缺失资产列表
 */
export function validatePresetAssets(
    options: ValidatePresetAssetsOptions
): PresetAssetValidationResult {
    const { drawingPreset, promptPreset, assetCache, providerType } = options;
    const missing: string[] = [];

    // 若本地未缓存任何模型或服务端列表为空，不进行阻断拦截
    const knownCheckpoints = assetCache?.checkpoints || [];
    const knownUnets = assetCache?.unets || [];
    const allModels = [...knownCheckpoints, ...knownUnets];
    if (allModels.length === 0) {
        return { valid: true, missing: [] };
    }

    if (drawingPreset) {
        // 1. 主模型校验：若填写了自定义模型标识，生图以自定义标识为准，跳过主模型比对
        const hasCustomModel = Boolean(drawingPreset.customModel?.trim());
        const baseModel = drawingPreset.baseModel?.trim();
        if (baseModel && !hasCustomModel) {
            if (!matchAssetText(baseModel, allModels)) {
                missing.push(`主模型: ${baseModel}`);
            }
        }

        // 2. 外置 VAE 校验：排除系统自动或无 VAE 的特殊标识
        const vaeName = drawingPreset.vaeName?.trim();
        const defaultVae = providerType === 'comfyui' ? '' : 'automatic';
        if (
            vaeName &&
            vaeName !== defaultVae &&
            vaeName !== 'None' &&
            vaeName !== 'none'
        ) {
            const knownVaes = assetCache?.vaes;
            if (knownVaes && knownVaes.length > 0 && !matchAssetText(vaeName, knownVaes)) {
                missing.push(`VAE: ${vaeName}`);
            }
        }

        // 3. CLIP 编码器校验
        const clipName = drawingPreset.clipName?.trim();
        if (clipName) {
            const knownClips = assetCache?.clips;
            if (knownClips && knownClips.length > 0 && !matchAssetText(clipName, knownClips)) {
                missing.push(`CLIP: ${clipName}`);
            }
        }
    }

    // 4. LoRA 模型校验
    if (promptPreset?.loras && promptPreset.loras.length > 0) {
        const knownLoras = assetCache?.loras;
        if (knownLoras && knownLoras.length > 0) {
            for (const lora of promptPreset.loras) {
                const loraModel = (lora.modelName || '').trim();
                if (lora.enabled !== false && loraModel && !matchAssetText(loraModel, knownLoras)) {
                    missing.push(`LoRA: ${loraModel}`);
                }
            }
        }
    }

    return {
        valid: missing.length === 0,
        missing,
    };
}
