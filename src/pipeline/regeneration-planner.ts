/**
 * 全流程图像重绘规划器 (`regeneration-planner.ts`)。
 *
 * @remarks
 * 作为图库重新生成与楼层编辑重绘共用的纯业务调度规划模块，负责：
 * 1. 分析历史图像记录 (`StoredImageRecord`) 的可复现能力、目标引擎能力与默认提示词来源；
 * 2. 将展示/归档形态的 `ImageGenerationMetadata` 规范化映射为各生图引擎可直接消费的 `SubmitTaskOptions`；
 * 3. 在「复现原参数 ('original')」与「按当前全局配置 ('current')」双模式下防止提示词双拼与种子锁定冲突。
 */

import type {
    AppliedLoraMetadata,
    GenerationParameters,
    ImageGenerationMetadata,
    ProviderRegistry,
    ProviderType,
    ResolvedLoraSpec,
    StoredImageRecord,
    WorkflowPresetData,
} from '@types';
import { DEFAULT_LORA_WEIGHTS } from '../domain';
import { providerRegistry } from '../provider/registry';
import { settingsStore, type SettingsStore } from '../store/settings-store';
import type { SubmitTaskOptions } from './generation-orchestrator';

/** 重绘参数来源模式：'original' 复现原图引擎与参数快照；'current' 使用当前激活服务与预设 */
export type ReplayMode = 'original' | 'current';

/** 重绘随机种子策略：'random' 重新随机种子；'fixed' 沿用原图记录种子 */
export type SeedMode = 'random' | 'fixed';

/** 局部重绘覆盖参数输入 */
export interface InpaintOverrideInput {
    readonly initImage: Blob | string;
    readonly maskImage: Blob | string;
    readonly width?: number;
    readonly height?: number;
    readonly denoiseStrength?: number;
    readonly maskBlur?: number;
}

/** 面板与引擎交互能力快照 */
export interface RegenActionCapabilities {
    readonly targetProvider: ProviderType;
    readonly supportsNegative: boolean;
    readonly supportsInpaint: boolean;
    readonly supportsSeed: boolean;
}

/** 历史记录重绘诊断与预览信息 */
export interface RecordReplayInspection {
    /** 是否具备可用的历史引擎与核心生成参数快照 */
    readonly hasReplaySnapshot: boolean;
    /** 历史记录中的原始服务提供方类型 */
    readonly sourceEngine?: ProviderType;
    readonly sourceEngineLabel: string;
    /** 当前全局激活的服务提供方类型 */
    readonly activeEngine: ProviderType;
    readonly activeEngineLabel: string;
    /** 原图是否记录了合法非负随机种子 */
    readonly hasFixedSeed: boolean;
    readonly recordedSeed?: number;
    /** 「复现原参数」模式的简明规格摘要 */
    readonly originalSummary: string;
    /** 「按当前配置」模式的简明规格摘要 */
    readonly currentSummary: string;
    /** 建议在「复现原参数」模式下填入的终稿正/负向提示词 */
    readonly originalPrompt: string;
    readonly originalNegativePrompt: string;
    /** 建议在「按当前配置」模式下填入的原始指令正/负向提示词 */
    readonly currentPrompt: string;
    readonly currentNegativePrompt: string;
    /** 「按当前配置」模式是否以 raw 管线重新编译提示词预设 */
    readonly currentUsesRawPipeline: boolean;
    /** 当原记录绑定的 ComfyUI 工作流预设已被删除时的提示信息 */
    readonly missingWorkflowWarning?: string;
}

/** 构造统一重绘提交参数入参 */
export interface BuildRegenSubmitSpecInput {
    readonly record?: StoredImageRecord;
    readonly fallbackRawPrompt?: string;
    readonly fallbackRawNegativePrompt?: string;
    readonly replayMode: ReplayMode;
    readonly seedMode: SeedMode;
    readonly editedPrompt: string;
    readonly editedNegativePrompt?: string;
    readonly inpaint?: InpaintOverrideInput;
    readonly store?: Pick<SettingsStore, 'get' | 'getSettings' | 'getPreset' | 'getProviderConfig'>;
}

const VALID_PROVIDERS = new Set<ProviderType>([
    'comfyui',
    'sdwebui',
    'novelai',
    'openai',
    'gemini',
    'grok',
]);

const SEED_CAPABLE_PROVIDERS = new Set<ProviderType>(['comfyui', 'sdwebui', 'novelai']);

const PROVIDER_DISPLAY_NAMES: Readonly<Record<ProviderType, string>> = {
    comfyui: 'ComfyUI',
    sdwebui: 'SD-WebUI / Forge',
    novelai: 'NovelAI',
    openai: 'OpenAI 兼容',
    gemini: 'Google Gemini',
    grok: 'xAI Grok',
};

/** 校验并归一化服务提供方标识 */
export function normalizeProviderType(engine: unknown): ProviderType | undefined {
    if (typeof engine !== 'string') {
        return undefined;
    }
    const trimmed = engine.trim().toLowerCase() as ProviderType;
    return VALID_PROVIDERS.has(trimmed) ? trimmed : undefined;
}

/** 获取服务提供方可读显示名称 */
export function getProviderDisplayLabel(provider?: ProviderType): string {
    if (!provider) {
        return '未知服务';
    }
    return PROVIDER_DISPLAY_NAMES[provider] || provider;
}

/** 将持久化 LoRA 元数据转换回运行时 LoRA 请求结构 */
export function toResolvedLoras(
    loras?: readonly AppliedLoraMetadata[]
): ResolvedLoraSpec[] | undefined {
    if (!Array.isArray(loras) || loras.length === 0) {
        return undefined;
    }
    const result: ResolvedLoraSpec[] = [];
    for (const item of loras) {
        if (!item?.modelName || typeof item.modelName !== 'string') {
            continue;
        }
        result.push({
            modelName: item.modelName,
            modelWeight:
                typeof item.modelWeight === 'number' && Number.isFinite(item.modelWeight)
                    ? item.modelWeight
                    : DEFAULT_LORA_WEIGHTS.modelWeight,
            clipWeight:
                typeof item.clipWeight === 'number' && Number.isFinite(item.clipWeight)
                    ? item.clipWeight
                    : typeof item.modelWeight === 'number' && Number.isFinite(item.modelWeight)
                      ? item.modelWeight
                      : DEFAULT_LORA_WEIGHTS.clipWeight,
            triggerWeight:
                typeof item.triggerWeight === 'number' && Number.isFinite(item.triggerWeight)
                    ? item.triggerWeight
                    : DEFAULT_LORA_WEIGHTS.triggerWeight,
        });
    }
    return result.length > 0 ? result : undefined;
}

/** 解析在当前重绘模式下实际生效的引擎及其功能能力 */
export function resolveRegenCapabilities(
    record: StoredImageRecord | undefined,
    replayMode: ReplayMode,
    store: Pick<SettingsStore, 'getSettings'> = settingsStore,
    registry: Pick<ProviderRegistry, 'getProvider'> = providerRegistry
): RegenActionCapabilities {
    const activeEngine = normalizeProviderType(store.getSettings()?.activeProvider) ?? 'comfyui';
    const sourceEngine = normalizeProviderType(record?.metadata?.engine);
    const targetProvider =
        replayMode === 'original' && sourceEngine ? sourceEngine : activeEngine;

    const provider = registry.getProvider(targetProvider);
    return {
        targetProvider,
        supportsNegative: provider?.supportsNegativePrompt !== false,
        supportsInpaint: provider?.supportsInpaint === true,
        supportsSeed: SEED_CAPABLE_PROVIDERS.has(targetProvider),
    };
}

/** 格式化紧凑参数摘要文本（用于动作面板展示） */
function formatReplaySummary(
    engine: ProviderType | undefined,
    meta: ImageGenerationMetadata | undefined
): string {
    const parts: string[] = [getProviderDisplayLabel(engine)];
    if (meta?.width && meta?.height) {
        parts.push(`${meta.width}×${meta.height}`);
    } else if (meta?.aspectRatio) {
        parts.push(meta.aspectRatio);
    }
    if (meta?.sampler) {
        parts.push(meta.sampler);
    }
    if (typeof meta?.steps === 'number' && Number.isFinite(meta.steps)) {
        parts.push(`${meta.steps}步`);
    }
    return parts.join(' · ');
}

/**
 * 诊断图像资产记录的重绘可复现信息与各模式初始提示词建议。
 */
export function inspectRecordForRegeneration(
    record: StoredImageRecord | undefined,
    fallbackRawPrompt = '',
    fallbackRawNegativePrompt = '',
    store: Pick<SettingsStore, 'getSettings' | 'getPreset'> = settingsStore
): RecordReplayInspection {
    const activeEngine = normalizeProviderType(store.getSettings()?.activeProvider) ?? 'comfyui';
    const meta = record?.metadata;
    const sourceEngine = normalizeProviderType(meta?.engine);
    const hasReplaySnapshot = Boolean(
        sourceEngine &&
            meta &&
            (meta.prompt ||
                meta.width ||
                meta.height ||
                meta.baseModel ||
                meta.workflowId ||
                meta.aspectRatio ||
                meta.steps !== undefined)
    );

    const rawSeed = meta?.seed;
    const hasFixedSeed =
        typeof rawSeed === 'number' && Number.isFinite(rawSeed) && rawSeed >= 0;
    const recordedSeed = hasFixedSeed ? Math.floor(rawSeed) : undefined;

    let missingWorkflowWarning: string | undefined;
    if (sourceEngine === 'comfyui' && meta?.workflowId) {
        const wfPreset = store.getPreset<WorkflowPresetData>('workflows', meta.workflowId);
        if (!wfPreset?.data?.workflow) {
            missingWorkflowWarning = `原记录使用的工作流模板 (${meta.workflowId}) 已不存在，复现原参数将尝试回退或报错，建议改用「按当前配置」`;
        }
    }

    const originalPrompt = (meta?.prompt || meta?.rawPrompt || fallbackRawPrompt || '').trim();
    const originalNegativePrompt = (
        meta?.negativePrompt ||
        meta?.rawNegativePrompt ||
        fallbackRawNegativePrompt ||
        ''
    ).trim();

    const rawPrompt = (meta?.rawPrompt || fallbackRawPrompt || '').trim();
    const rawNegative = (meta?.rawNegativePrompt || fallbackRawNegativePrompt || '').trim();
    const currentUsesRawPipeline = Boolean(rawPrompt);

    return {
        hasReplaySnapshot,
        sourceEngine,
        sourceEngineLabel: getProviderDisplayLabel(sourceEngine),
        activeEngine,
        activeEngineLabel: getProviderDisplayLabel(activeEngine),
        hasFixedSeed,
        recordedSeed,
        originalSummary: hasReplaySnapshot
            ? formatReplaySummary(sourceEngine, meta)
            : '无完整参数快照',
        currentSummary: getProviderDisplayLabel(activeEngine),
        originalPrompt,
        originalNegativePrompt,
        currentPrompt: currentUsesRawPipeline ? rawPrompt : originalPrompt,
        currentNegativePrompt: currentUsesRawPipeline ? rawNegative : originalNegativePrompt,
        currentUsesRawPipeline,
        missingWorkflowWarning,
    };
}

/** 将历史元数据快照完整映射为对应 Provider 可直接消费的覆盖参数对象 */
function buildOriginalParameterOverrides(
    providerType: ProviderType,
    meta: ImageGenerationMetadata,
    seedMode: SeedMode,
    inpaint: InpaintOverrideInput | undefined,
    sourceImageId: string | undefined,
    store: Pick<SettingsStore, 'getPreset'>
): GenerationParameters {
    const params: GenerationParameters = {};

    if (sourceImageId) {
        params.parentImageId = sourceImageId;
    }

    if (SEED_CAPABLE_PROVIDERS.has(providerType)) {
        const recordedSeed =
            typeof meta.seed === 'number' && Number.isFinite(meta.seed) && meta.seed >= 0
                ? Math.floor(meta.seed)
                : undefined;
        params.seed = seedMode === 'fixed' && recordedSeed !== undefined ? recordedSeed : -1;
    }

    if (!inpaint) {
        if (typeof meta.width === 'number' && Number.isFinite(meta.width) && meta.width > 0) {
            params.width = meta.width;
        }
        if (typeof meta.height === 'number' && Number.isFinite(meta.height) && meta.height > 0) {
            params.height = meta.height;
        }
    } else {
        params.mode = 'inpaint';
        params.sourceImage = inpaint.initImage;
        params.maskImage = inpaint.maskImage;
        if (inpaint.width && inpaint.height) {
            params.width = inpaint.width;
            params.height = inpaint.height;
        }
        if (typeof inpaint.denoiseStrength === 'number') {
            params.denoiseStrength = inpaint.denoiseStrength;
        }
        if (typeof inpaint.maskBlur === 'number') {
            params.maskBlur = inpaint.maskBlur;
        }
    }

    if (typeof meta.steps === 'number' && Number.isFinite(meta.steps)) {
        params.steps = meta.steps;
    }
    if (typeof meta.cfgScale === 'number' && Number.isFinite(meta.cfgScale)) {
        params.cfgScale = meta.cfgScale;
    }
    if (typeof meta.sampler === 'string' && meta.sampler.trim()) {
        params.samplerName = meta.sampler.trim();
    }
    if (typeof meta.scheduler === 'string' && meta.scheduler.trim()) {
        params.scheduler = meta.scheduler.trim();
    }
    if (typeof meta.baseModel === 'string' && meta.baseModel.trim()) {
        params.baseModel = meta.baseModel.trim();
    }

    if (providerType === 'comfyui') {
        if (typeof meta.workflowId === 'string' && meta.workflowId.trim()) {
            const wfId = meta.workflowId.trim();
            if (!inpaint) {
                params.workflowId = wfId;
                params.txt2imgWorkflowId = wfId;
            } else if (meta.mode === 'inpaint') {
                // 仅当原图自身是局绘产出工作流且仍存在时回填为 inpaintPresetId；文生图历史图执行局绘交由当前激活预设的局绘工作流处理
                const wf = store.getPreset<WorkflowPresetData>('workflows', wfId);
                if (wf?.data?.workflow) {
                    params.workflowId = wfId;
                    params.inpaintPresetId = wfId;
                }
            }
        }
        if (typeof meta.clipName === 'string' && meta.clipName.trim()) {
            params.clipName = meta.clipName.trim();
        }
        if (typeof meta.vaeName === 'string' && meta.vaeName.trim()) {
            params.vaeName = meta.vaeName.trim();
        }
        if (Array.isArray(meta.extraModels) && meta.extraModels.length > 0) {
            params.extraModels = [...meta.extraModels];
        }
    } else if (providerType === 'sdwebui') {
        if (typeof meta.vaeName === 'string' && meta.vaeName.trim()) {
            params.vaeName = meta.vaeName.trim();
        }
        if (typeof meta.clipSkip === 'number' && Number.isFinite(meta.clipSkip)) {
            params.clipSkip = meta.clipSkip;
        }
        if (meta.enableHires !== undefined) {
            params.enableHires = Boolean(meta.enableHires);
            if (meta.hiresUpscaler) params.hiresUpscaler = String(meta.hiresUpscaler);
            if (typeof meta.hiresScale === 'number') params.hiresScale = meta.hiresScale;
            if (typeof meta.hiresSteps === 'number') params.hiresSteps = meta.hiresSteps;
            if (typeof meta.hiresDenoise === 'number') params.hiresDenoise = meta.hiresDenoise;
        }
    } else if (providerType === 'novelai') {
        if (typeof meta.cfgRescale === 'number' && Number.isFinite(meta.cfgRescale)) {
            params.cfgRescale = meta.cfgRescale;
        }
        if (typeof meta.smeaMode === 'string' && meta.smeaMode.trim()) {
            params.smeaMode = meta.smeaMode.trim();
        }
        if (meta.decrisper !== undefined) {
            params.decrisper = Boolean(meta.decrisper);
        }
    } else {
        if (typeof meta.aspectRatio === 'string' && meta.aspectRatio.trim()) {
            params.aspectRatio = meta.aspectRatio.trim();
        }
        if (typeof meta.imageSize === 'string' && meta.imageSize.trim()) {
            params.imageSize = meta.imageSize.trim();
        }
        if (typeof meta.resolution === 'string' && meta.resolution.trim()) {
            params.resolution = meta.resolution.trim();
        }
        if (typeof meta.quality === 'string' && meta.quality.trim()) {
            params.quality = meta.quality.trim();
        }
        if (typeof meta.style === 'string' && meta.style.trim()) {
            params.style = meta.style.trim();
        }
        if (typeof meta.background === 'string' && meta.background.trim()) {
            params.background = meta.background.trim();
        }
        if (typeof meta.outputFormat === 'string' && meta.outputFormat.trim()) {
            params.outputFormat = meta.outputFormat.trim();
        }
    }

    return params;
}

/**
 * 将用户在操作面板做出的重绘决策统一构建为 `GenerationOrchestrator.submitTask` 可直接消费的规范提交对象。
 */
export function buildRegenerationSubmitSpec(
    input: BuildRegenSubmitSpecInput
): Omit<SubmitTaskOptions, 'destination' | 'target'> {
    const store = input.store ?? settingsStore;
    const activeEngine = normalizeProviderType(store.getSettings()?.activeProvider) ?? 'comfyui';
    const meta = input.record?.metadata;
    const sourceEngine = normalizeProviderType(meta?.engine);

    const canReplayOriginal = input.replayMode === 'original' && Boolean(sourceEngine && meta);
    const providerType: ProviderType = canReplayOriginal && sourceEngine ? sourceEngine : activeEngine;

    const originRawPrompt = (meta?.rawPrompt || input.fallbackRawPrompt || '').trim() || undefined;
    const originRawNegativePrompt =
        (meta?.rawNegativePrompt || input.fallbackRawNegativePrompt || '').trim() || undefined;

    if (canReplayOriginal && meta) {
        const parameters = buildOriginalParameterOverrides(
            providerType,
            meta,
            input.seedMode,
            input.inpaint,
            input.record?.imageId,
            store
        );
        const trimmedNeg = (input.editedNegativePrompt || '').trim();
        if (trimmedNeg) {
            parameters.negativePrompt = trimmedNeg;
        }

        return {
            providerType,
            sourceImageId: input.record?.imageId,
            sourceChatId: input.record?.chatId,
            rawPrompt: input.editedPrompt,
            promptMode: 'final',
            explicitLoras: toResolvedLoras(meta.loras),
            originRawPrompt,
            originRawNegativePrompt,
            sourceImage: input.inpaint?.initImage,
            maskImage: input.inpaint?.maskImage,
            parameters,
        };
    }

    // 「按当前全局配置」模式：若历史记录中存在原始指令文本，走 raw 管线重新拼接当前预设；否则直发终稿防止双拼
    const shouldUseRawPipeline = Boolean(originRawPrompt);
    const parameters: GenerationParameters = {};
    if (input.record?.imageId) {
        parameters.parentImageId = input.record.imageId;
    }

    const trimmedNeg = (input.editedNegativePrompt || '').trim();
    if (trimmedNeg) {
        parameters.negativePrompt = trimmedNeg;
    }

    if (SEED_CAPABLE_PROVIDERS.has(providerType)) {
        const recordedSeed =
            typeof meta?.seed === 'number' && Number.isFinite(meta.seed) && meta.seed >= 0
                ? Math.floor(meta.seed)
                : undefined;
        if (input.seedMode === 'fixed' && recordedSeed !== undefined) {
            parameters.seed = recordedSeed;
        } else if (input.seedMode === 'random') {
            parameters.seed = -1;
        }
    }

    if (input.inpaint) {
        parameters.mode = 'inpaint';
        parameters.sourceImage = input.inpaint.initImage;
        parameters.maskImage = input.inpaint.maskImage;
        if (input.inpaint.width && input.inpaint.height) {
            parameters.width = input.inpaint.width;
            parameters.height = input.inpaint.height;
        }
        if (typeof input.inpaint.denoiseStrength === 'number') {
            parameters.denoiseStrength = input.inpaint.denoiseStrength;
        }
        if (typeof input.inpaint.maskBlur === 'number') {
            parameters.maskBlur = input.inpaint.maskBlur;
        }
    }

    return {
        providerType,
        sourceImageId: input.record?.imageId,
        sourceChatId: input.record?.chatId,
        rawPrompt: input.editedPrompt,
        promptMode: shouldUseRawPipeline ? 'raw' : 'final',
        explicitLoras: shouldUseRawPipeline ? undefined : toResolvedLoras(meta?.loras),
        originRawPrompt,
        originRawNegativePrompt,
        sourceImage: input.inpaint?.initImage,
        maskImage: input.inpaint?.maskImage,
        parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    };
}
