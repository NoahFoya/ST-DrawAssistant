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

/** 服务端资产精确比对解析结果 */
export type AssetMatchResolution =
    | { readonly status: 'matched'; readonly value: string }
    | { readonly status: 'ambiguous'; readonly candidates: string[] }
    | { readonly status: 'missing' };

/** 过滤并保持去重顺序的匹配集收集辅助 */
function collectUniqueMatches(
    targetList: readonly string[],
    predicate: (item: string) => boolean
): string[] {
    const seen = new Set<string>();
    const results: string[] = [];
    for (const item of targetList) {
        if (!seen.has(item) && predicate(item)) {
            seen.add(item);
            results.push(item);
        }
    }
    return results;
}

/**
 * 解析候选模型名称在服务端已知资产列表中的精确对应项：
 * 1. 严格全等匹配；
 * 2. 忽略大小写全等匹配；
 * 3. 归一化全路径匹配（去除哈希与扩展名）；
 * 4. 基础文件名去路径匹配（若跨子目录出现同名歧义则返回 ambiguous，避免猜错）。
 */
export function resolveAssetMatch(
    candidate: string | undefined | null,
    targetList: readonly string[] | undefined | null
): AssetMatchResolution {
    if (!candidate || !targetList || targetList.length === 0) {
        return { status: 'missing' };
    }
    const cleanCand = candidate.trim();
    if (!cleanCand) {
        return { status: 'missing' };
    }

    // 1. 严格全等匹配
    if (targetList.includes(cleanCand)) {
        return { status: 'matched', value: cleanCand };
    }

    // 2. 忽略大小写全等匹配
    const candLower = cleanCand.toLowerCase();
    const ciMatches = collectUniqueMatches(targetList, (item) => item.toLowerCase() === candLower);
    if (ciMatches.length === 1) {
        return { status: 'matched', value: ciMatches[0] };
    }
    if (ciMatches.length > 1) {
        return { status: 'ambiguous', candidates: ciMatches };
    }

    // 3. 归一化全路径匹配
    const normCand = normalizeAssetName(cleanCand);
    if (!normCand) {
        return { status: 'missing' };
    }

    const normMatches = collectUniqueMatches(targetList, (item) => normalizeAssetName(item) === normCand);
    if (normMatches.length === 1) {
        return { status: 'matched', value: normMatches[0] };
    }
    if (normMatches.length > 1) {
        return { status: 'ambiguous', candidates: normMatches };
    }

    // 4. 基础文件名去路径匹配（允许任一方带有子目录，存在多目录重名时标记歧义）
    const baseCand = getAssetBaseName(normCand);
    if (!baseCand) {
        return { status: 'missing' };
    }

    const baseMatches = collectUniqueMatches(
        targetList,
        (item) => getAssetBaseName(normalizeAssetName(item)) === baseCand
    );
    if (baseMatches.length === 1) {
        return { status: 'matched', value: baseMatches[0] };
    }
    if (baseMatches.length > 1) {
        return { status: 'ambiguous', candidates: baseMatches };
    }

    return { status: 'missing' };
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
    return resolveAssetMatch(candidate, targetList).status !== 'missing';
}

/** 校验预设资产参数选项 */
export interface ValidatePresetAssetsOptions {
    /** 当前激活的生图参数预设数据 */
    drawingPreset?: DrawingPresetData | null;
    /** 当前引用的提示词预设数据 */
    promptPreset?: PromptPresetData | null;
    /** 多候选提示词预设列表（如轮询池，优先与 promptPreset 合并校验 LoRA） */
    promptPresets?: ReadonlyArray<PromptPresetData | null | undefined>;
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
 * 校验当前生图参数预设与提示词预设引用的模型资产在服务端是否存在。
 *
 * @param options 校验参数
 * @returns 校验结果与缺失资产列表
 */
export function validatePresetAssets(
    options: ValidatePresetAssetsOptions
): PresetAssetValidationResult {
    const { drawingPreset, assetCache, providerType } = options;
    const missing: string[] = [];

    const knownCheckpoints = assetCache?.checkpoints || [];
    const knownUnets = assetCache?.unets || [];
    const allModels = [...knownCheckpoints, ...knownUnets];

    if (drawingPreset) {
        // 1. 主模型校验：仅在已缓存主模型或 UNET 列表且未填写自定义模型标识时比对
        const hasCustomModel = Boolean(drawingPreset.customModel?.trim());
        const baseModel = drawingPreset.baseModel?.trim();
        if (allModels.length > 0 && baseModel && !hasCustomModel) {
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

    // 4. LoRA 模型校验（合并单预设与轮询候选池）
    const promptPresetsToCheck: PromptPresetData[] = [];
    if (options.promptPreset) {
        promptPresetsToCheck.push(options.promptPreset);
    }
    if (options.promptPresets) {
        for (const p of options.promptPresets) {
            if (p) promptPresetsToCheck.push(p);
        }
    }
    if (promptPresetsToCheck.length > 0) {
        const knownLoras = assetCache?.loras;
        if (knownLoras && knownLoras.length > 0) {
            const seenMissingLoras = new Set<string>();
            for (const presetItem of promptPresetsToCheck) {
                if (!presetItem.loras || presetItem.loras.length === 0) continue;
                for (const lora of presetItem.loras) {
                    const loraModel = (lora.modelName || '').trim();
                    if (
                        lora.enabled !== false &&
                        loraModel &&
                        !matchAssetText(loraModel, knownLoras) &&
                        !seenMissingLoras.has(loraModel)
                    ) {
                        seenMissingLoras.add(loraModel);
                        missing.push(`LoRA: ${loraModel}`);
                    }
                }
            }
        }
    }

    return {
        valid: missing.length === 0,
        missing,
    };
}
