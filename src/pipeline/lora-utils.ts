/**
 * LoRA 触发判断、标签格式化、协议剥离与异常提醒纯工具模块。
 *
 * @remarks
 * 独立于 `PromptPipeline` 与 `providerRegistry` 存放，避免 `src/provider/*`
 * 与 `src/pipeline/prompt-pipeline.ts` 形成模块初始化期循环依赖。
 */

import type { LoraConfigItem, ProviderType, ResolvedLoraSpec } from '@types';
import { splitCommaKeywordTokens } from './material-definitions';
import { matchKeywordToken } from './prompt-injector';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';

/** 文本标签协议类型：SD-WebUI 标准 `<lora:...>` 或 ComfyUI-WeiLin `<wlr:...>` */
export type LoraTagProtocol = 'lora' | 'wlr';

/** LoRA 条目默认权重统一常量 */
export const DEFAULT_LORA_WEIGHTS = Object.freeze({
    modelWeight: 0.8,
    clipWeight: 0.8,
    triggerWeight: 1.0,
});

/** 不兼容 LoRA 标签分类剥离配置 */
export interface StripLoraTagsOptions {
    /** 是否保留标准 <lora:...> 标签 */
    allowLora?: boolean;
    /** 是否保留 WeiLin <wlr:...> 标签 */
    allowWlr?: boolean;
}

/** 正/负向提示词联合清洗与警告配置 */
export interface SanitizeLoraPromptsOptions extends StripLoraTagsOptions {
    /** 触发提醒的服务/流程显示名称 */
    sourceLabel: string;
    /** 给用户展示的修正指引说明 */
    guidance: string;
}

/** 不兼容 LoRA 标签剥离结果 */
export interface StripLoraTagsResult {
    readonly text: string;
    readonly strippedTags: string[];
}

/** 可被格式化为 LoRA 标签或权重摘要的输入数据规范 */
export interface FormatLoraTagInput {
    modelName?: string;
    modelWeight?: number;
    clipWeight?: number;
    triggerWeight?: number;
}

/** 格式化单条 LoRA 的统一静态三权重摘要 */
export function formatLoraWeightSummary(
    item: Pick<FormatLoraTagInput, 'modelWeight' | 'clipWeight' | 'triggerWeight'>
): string {
    const fmt = (val: number | undefined, fallback: number): string =>
        (typeof val === 'number' && Number.isFinite(val) ? val : fallback).toFixed(2);
    return `Model ${fmt(item.modelWeight, DEFAULT_LORA_WEIGHTS.modelWeight)} / CLIP ${fmt(item.clipWeight, DEFAULT_LORA_WEIGHTS.clipWeight)} / Trigger ${fmt(item.triggerWeight, DEFAULT_LORA_WEIGHTS.triggerWeight)}`;
}

/** 判断指定服务提供方是否支持 LoRA 模型加载（`sdwebui` / `comfyui`） */
export function supportsLoraSyntax(provider?: ProviderType): boolean {
    return provider === 'sdwebui' || provider === 'comfyui';
}

/** 统一提取不含目录斜杠差异与扩展名的基础 LoRA 名称 */
export function cleanLoraModelBaseName(modelName: string): string {
    if (!modelName || typeof modelName !== 'string') {
        return '';
    }
    return modelName
        .replace(/\\/g, '/')
        .replace(/\.(safetensors|pt|ckpt|pth)$/i, '')
        .trim();
}

/** 将单条 LoRA 权重限定在合法安全区间并最多保留 3 位小数 */
function clampLoraWeight(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(-5.0, Math.min(5.0, Number(value.toFixed(3))));
}

/**
 * 按当前执行路径支持的协议白名单剥离不兼容的 LoRA 文本标签，并返回被剥离的标签清单以便发出显式提醒。
 */
export function stripIncompatibleLoraTags(
    text: string,
    options: StripLoraTagsOptions = {}
): StripLoraTagsResult {
    if (!text) {
        return { text: '', strippedTags: [] };
    }
    const tagPattern = /<(?:lora|wlr):[^>]+>/gi;
    if (!tagPattern.test(text)) {
        return { text: text.trim(), strippedTags: [] };
    }

    const allowLora = Boolean(options.allowLora);
    const allowWlr = Boolean(options.allowWlr);
    const strippedTags: string[] = [];

    const replaced = text.replace(/<(?:lora|wlr):[^>]+>/gi, (match) => {
        const lower = match.toLowerCase();
        if (lower.startsWith('<lora:') && allowLora) {
            return match;
        }
        if (lower.startsWith('<wlr:') && allowWlr) {
            return match;
        }
        strippedTags.push(match);
        return ' ';
    });

    if (strippedTags.length === 0) {
        return { text: text.trim(), strippedTags: [] };
    }

    const cleaned = replaced
        .replace(/,[ \t]*(?:,[ \t]*)+/g, ', ')
        .replace(/^\s*,\s*|\s*,\s*$/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

    return { text: cleaned, strippedTags };
}

/**
 * 当正/负向文本中被剥离不兼容 LoRA 标签时，统一输出日志与可见警告提醒。
 */
export function warnStrippedLoraTags(
    sourceLabel: string,
    strippedTags: readonly string[],
    guidance: string
): void {
    if (!strippedTags || strippedTags.length === 0) {
        return;
    }
    const preview =
        strippedTags.length <= 3
            ? strippedTags.join(', ')
            : `${strippedTags.slice(0, 3).join(', ')} 等 ${strippedTags.length} 项`;
    const message = `${sourceLabel}已自动剥离不兼容的手写标签 (${preview})：${guidance}`;
    logger.warn(`[LoraGuard] ${message}`);
    eventBus.emit('toast:show', {
        type: 'warn',
        message,
        duration: 5000,
    });
}

/**
 * 统一对正向与负向提示词执行协议白名单清洗，合并剥离结果并输出显式告警。
 */
export function sanitizeLoraPrompts(
    positivePrompt: string,
    negativePrompt: string | undefined,
    options: SanitizeLoraPromptsOptions
): {
    readonly positivePrompt: string;
    readonly negativePrompt: string;
    readonly strippedTags: string[];
} {
    const posRes = stripIncompatibleLoraTags(positivePrompt, {
        allowLora: options.allowLora,
        allowWlr: options.allowWlr,
    });
    const strippedTags = [...posRes.strippedTags];

    let cleanedNeg = '';
    if (negativePrompt) {
        const negRes = stripIncompatibleLoraTags(negativePrompt, {
            allowLora: false,
            allowWlr: false,
        });
        cleanedNeg = negRes.text;
        strippedTags.push(...negRes.strippedTags);
    }

    warnStrippedLoraTags(options.sourceLabel, strippedTags, options.guidance);

    return {
        positivePrompt: posRes.text,
        negativePrompt: cleanedNeg,
        strippedTags,
    };
}

/**
 * 剥离文本中的 LoRA 语法标签 (<lora:...> 与 <wlr:...>)，用于适配不支持 LoRA 语法的后端。
 */
export function stripLoraSyntax(text: string): string {
    return stripIncompatibleLoraTags(text, { allowLora: false, allowWlr: false }).text;
}

/**
 * 判断单条 LoRA 配置在当次生图提示词下是否满足挂载条件。
 */
export function isLoraTriggeredForPrompt(
    lora: LoraConfigItem | undefined | null,
    rawPositive: string,
    expandedPositive: string
): boolean {
    if (!lora || lora.enabled === false || !lora.modelName?.trim()) {
        return false;
    }
    if (lora.triggerMode !== 'keyword') {
        return true;
    }
    const tokens = splitCommaKeywordTokens(lora.keywords);
    if (tokens.length === 0) {
        return false;
    }
    const combinedRaw = [rawPositive, expandedPositive].filter(Boolean).join('\n');
    if (!combinedRaw.trim()) {
        return false;
    }
    const combinedLower = combinedRaw.toLowerCase();
    for (const token of tokens) {
        // 对纯英文标签启用全词边界校验（avoid substring false positives），中文与 /regex/ 保持语义命中
        if (matchKeywordToken(token, combinedRaw, combinedLower, false, true)) {
            return true;
        }
    }
    return false;
}

/**
 * 从提示词预设的 LoRA 列表筛选当次触发的有效条目并规范化为结构化运行时配置。
 */
export function resolveTriggeredLoras(
    loras: readonly LoraConfigItem[] | undefined,
    rawPositive: string,
    expandedPositive: string
): ResolvedLoraSpec[] {
    if (!Array.isArray(loras) || loras.length === 0) {
        return [];
    }
    const resolved: ResolvedLoraSpec[] = [];
    for (const lora of loras) {
        const rawName = lora?.modelName?.trim() || '';
        if (!rawName || !isLoraTriggeredForPrompt(lora, rawPositive, expandedPositive)) {
            continue;
        }
        if (typeof lora.modelWeight === 'number' && !Number.isFinite(lora.modelWeight)) {
            continue;
        }
        const modelWeight = clampLoraWeight(lora.modelWeight, DEFAULT_LORA_WEIGHTS.modelWeight);
        const clipWeight = clampLoraWeight(lora.clipWeight, modelWeight);
        if (Math.abs(modelWeight) < 0.001 && Math.abs(clipWeight) < 0.001) {
            continue;
        }
        const triggerWeight = clampLoraWeight(lora.triggerWeight, DEFAULT_LORA_WEIGHTS.triggerWeight);
        resolved.push({
            modelName: rawName,
            modelWeight,
            clipWeight,
            triggerWeight,
        });
    }
    return resolved;
}

/**
 * 根据指定协议将 LoRA 条目格式化为提示词标签。
 */
export function formatLoraTag(
    item: FormatLoraTagInput,
    protocol: LoraTagProtocol = 'lora'
): string {
    if (!item) {
        return '';
    }
    const rawName = item.modelName || '';
    if (!rawName) {
        return '';
    }
    const cleanName = cleanLoraModelBaseName(rawName);
    if (!cleanName) {
        return '';
    }

    const rawModel = typeof item.modelWeight === 'number' ? item.modelWeight : undefined;
    if (rawModel !== undefined && (!Number.isFinite(rawModel) || Math.abs(rawModel) < 0.001)) {
        return '';
    }
    const clampedModel = clampLoraWeight(rawModel, DEFAULT_LORA_WEIGHTS.modelWeight);
    if (Math.abs(clampedModel) < 0.001) {
        return '';
    }

    const clampedClip = clampLoraWeight(item.clipWeight, clampedModel);

    if (protocol === 'wlr') {
        const clampedTrigger = clampLoraWeight(
            item.triggerWeight,
            DEFAULT_LORA_WEIGHTS.triggerWeight
        );
        return `<wlr:${cleanName}:${clampedModel}:${clampedClip}:${clampedTrigger}>`;
    }

    if (clampedModel === clampedClip) {
        return `<lora:${cleanName}:${clampedModel}>`;
    }
    return `<lora:${cleanName}:${clampedModel}:${clampedClip}>`;
}

/**
 * 将结构化 LoRA 条目按文本标签协议（`<lora:...>` 或 `<wlr:...>`）追加到正向提示词末尾（跳过正文已存在的同名标签）。
 */
export function applyTextLoraTagsToPrompt(
    prompt: string,
    loras: readonly ResolvedLoraSpec[] | undefined,
    protocol: LoraTagProtocol
): string {
    const trimmedPrompt = (prompt || '').trim();
    if (!Array.isArray(loras) || loras.length === 0) {
        return trimmedPrompt;
    }

    let result = trimmedPrompt;
    const normalizedLowerPrefix = result.replace(/\\/g, '/').toLowerCase();
    for (const lora of loras) {
        const cleanName = cleanLoraModelBaseName(lora.modelName);
        if (!cleanName) continue;

        const escapedName = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const dedupRegex = new RegExp(`<(?:lora|wlr):${escapedName}:`, 'i');
        if (dedupRegex.test(normalizedLowerPrefix)) {
            continue;
        }

        const tag = formatLoraTag(lora, protocol);
        if (tag) {
            result = result ? `${result}, ${tag}` : tag;
        }
    }

    return result;
}
