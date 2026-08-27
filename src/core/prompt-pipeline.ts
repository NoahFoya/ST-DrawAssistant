/**
 * @module core/prompt-pipeline
 * @description 提示词处理管道
 *
 * 职责：
 * - 提供生图正负向提示词的规范化构建流程
 * - 允许模块注册自定义提示词处理函数，按顺序依次清洗和丰富文本
 * - 自动拼接正负向前缀、后缀以及 LoRA 语法串
 */

import type { DrawAssistantSettings } from '../settings/types';
import { logger } from './logger';

// ─── 公开类型 ─────────────────────────────────────────────────────────────────

/** Prompt 处理器调用时携带的上下文信息 */
export interface PromptContext {
    /** 消息在 chat 数组中的索引 */
    messageIndex: number;
    /** 同一消息中的按钮序号（从 0 开始） */
    buttonIndex: number;
    /** 来自占位符的原始提示词文本 */
    rawPrompt: string;
}

/**
 * Prompt 处理器函数签名
 * 接收当前 prompt 字符串与调用上下文，返回处理后的字符串（支持异步）
 */
export type PromptProcessor = (
    prompt: string,
    context: PromptContext
) => string | Promise<string>;

// ─── 处理器注册表 ─────────────────────────────────────────────────────────────

const _processors: PromptProcessor[] = [];

/**
 * 注册一个 Prompt 处理器 Hook（由进阶扩展在初始化阶段调用）
 */
export function registerPromptProcessor(processor: PromptProcessor): void {
    _processors.push(processor);
}

// ─── 管道执行 ─────────────────────────────────────────────────────────────────

/**
 * 依次执行所有已注册的 Prompt 处理器
 * 单个处理器异常时记录警告并跳过，不中断主链路
 */
export async function runPromptProcessors(
    raw: string,
    ctx: PromptContext
): Promise<string> {
    let result = raw;
    for (const processor of _processors) {
        try {
            result = await processor(result, ctx);
        } catch (err) {
            logger.warn('Prompt 处理器异常，已跳过', err, 'PromptPipeline');
        }
    }
    return result;
}

// ─── 核心工具函数 ─────────────────────────────────────────────────────────────

/**
 * 清洗 HTML 渲染残留标签与转义实体，并根据配置清洗多余空格与空行
 * ST 消息文本经过 markdown 渲染后可能包含 HTML，注入引擎前需统一清洗
 */
export function cleanRenderedText(text: string, shouldCleanExtraSpaces: boolean = true): string {
    if (!text) return '';
    let cleaned = text
        .replace(/<(?!(lora:|wlr:))[^>]+>/gi, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, dec) => {
            try {
                return String.fromCodePoint(Number(dec));
            } catch {
                return _;
            }
        })
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
            try {
                return String.fromCodePoint(parseInt(hex, 16));
            } catch {
                return _;
            }
        });

    if (shouldCleanExtraSpaces) {
        cleaned = cleaned
            .replace(/\n\s*\n+/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/,\s*,+/g, ',')
            .replace(/,\s*$/g, '')
            .trim();
    }

    return cleaned.trim();
}

/**
 * 智能过滤多层级前缀/起手词串中跨层级重复的 Tag
 * 保留靠前层级（如 Checkpoint 底模的起手词优先），对后续层级（如 Prompt 预设前缀与后缀）中的重复 Tag 进行精准剥离
 *
 * @param prefixes 依次传入的各层级前缀字符串（如 [checkpointPositivePrefix, promptPrefix]）
 * @returns 剥离重复重叠 Tag 后拼合的规范前缀串
 */
export function combinePrefixesWithDeduplication(...prefixes: Array<string | undefined>): string {
    const seenKeys = new Set<string>();
    const resultParts: string[] = [];

    for (const rawPrefix of prefixes) {
        if (!rawPrefix) continue;
        const trimmed = rawPrefix.trim();
        if (!trimmed) continue;

        const tags = trimmed.split(/[\r\n,]+/);
        const validTagsForThisLayer: string[] = [];

        for (const rawTag of tags) {
            const tag = rawTag.trim();
            if (!tag) continue;
            const key = tag.toLowerCase();

            // 保留 LORA 标签语法 `<lora:name:1.0>` 与 WeiLin 标签语法 `<wlr:name:1.0:1.0>`
            if (key.startsWith('<lora:') || key.startsWith('<wlr:')) {
                validTagsForThisLayer.push(tag);
                continue;
            }

            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                validTagsForThisLayer.push(tag);
            }
        }

        if (validTagsForThisLayer.length > 0) {
            resultParts.push(validTagsForThisLayer.join(', '));
        }
    }

    return resultParts.join(', ');
}

// ─── 最终 Prompt 构建 ─────────────────────────────────────────────────────────

/**
 * 构建最终提交给驱动的正负向 Prompt 对
 *
 * 处理顺序：
 * 1. 按 `|` 拆分占位符文本为正向词与内嵌负向词
 * 2. 运行所有已注册的扩展 Hook（如角色宏展开）
 * 3. 拼接 Checkpoint 起手式与全局前缀（自动去重重叠 Tag）、处理后正向词、后缀、LoRA
 * 4. 拼接 Checkpoint 负向起手式与全局负向词（自动去重重叠 Tag）、内嵌负向词
 * 5. 对正负向词统一执行 cleanRenderedText 二次清洗
 */
export interface FinalPromptResult {
    /** 提交给生图驱动的完整拼接正向词 */
    positive: string;
    /** 提交给生图驱动的完整拼接负向词 */
    negative: string;
    /** 未经拼接拆解出来的原生正向词 */
    rawPositive: string;
    /** 未经拼接拆解出来的原生负向词 (若无则为 "") */
    rawNegative: string;
}

/**
 * 剥离 LoRA 名称末尾的 .safetensors 或 .ckpt 扩展名
 * 规避 WeiLin 插件 Python 后端固定拼接 .safetensors 导致 double-extension (.safetensors.safetensors) 的致命错误
 */
export function stripLoraExtension(name: string): string {
    if (!name) return '';
    return name.replace(/\.(safetensors|ckpt|pt|pth)$/i, '');
}

export async function buildFinalPrompt(
    promptText: string,
    settings: DrawAssistantSettings,
    ctx: PromptContext
): Promise<FinalPromptResult> {
    const safePrompt = (promptText ?? '').trim();
    let rawPositive = safePrompt;
    let negativeFromPrompt = '';

    if (safePrompt.includes('|')) {
        const parts = safePrompt.split('|');
        rawPositive = parts[0].trim();
        negativeFromPrompt = parts.slice(1).join('|').trim();
    }

    const processedPositive = await runPromptProcessors(rawPositive, ctx);

    const provider = settings.provider ?? 'comfyui';
    const loraSuffix = (settings.loras && settings.loras.length > 0)
        ? settings.loras.filter(l => l.name).map(l => {
            const cleanName = stripLoraExtension(l.name);
            if (provider === 'comfyui') {
                const modelWeight = l.weight ?? 1.0;
                const clipWeight = l.textWeight ?? modelWeight;
                const triggerWeight = l.triggerWeight ?? 1.0;
                return `<wlr:${cleanName}:${modelWeight}:${clipWeight}:${triggerWeight}>`;
            } else if (provider === 'sd-webui') {
                return `<lora:${cleanName}:${l.weight ?? 1.0}>`;
            }
            return '';
        }).filter(Boolean).join(', ')
        : '';

    // 精准清理模型起手式与提示词预设前缀之间的重叠重复 Tag
    const combinedPositivePrefix = combinePrefixesWithDeduplication(
        settings.checkpointPositivePrefix,
        settings.promptPrefix
    );

    const fullPositive = [
        combinedPositivePrefix,
        processedPositive,
        settings.promptSuffix,
        loraSuffix,
    ].map(s => (s ?? '').trim()).filter(Boolean).join(', ');

    // 精准清理模型负向起手式与提示词预设负向前缀之间的重叠重复 Tag
    const combinedNegativePrefix = combinePrefixesWithDeduplication(
        settings.checkpointNegativePrefix,
        settings.negativePrefix
    );

    const fullNegative = [
        combinedNegativePrefix,
        negativeFromPrompt,
    ].map(s => (s ?? '').trim()).filter(Boolean).join(', ');

    const shouldClean = settings.cleanExtraSpacesAndLines !== false;

    return {
        positive: cleanRenderedText(fullPositive, shouldClean),
        negative: cleanRenderedText(fullNegative, shouldClean),
        rawPositive: cleanRenderedText(rawPositive, shouldClean),
        rawNegative: cleanRenderedText(negativeFromPrompt, shouldClean),
    };
}
