/**
 * 提示词预处理与意图装配流水线。
 *
 * @remarks
 * 负责从原始输入指令中提取正反向提示词、规整换行与标点符号、
 * 融合 Prompt 预设配置并装配纯净的 GenerationRequest 领域请求对象。
 */

import type { GenerationRequest, PromptPresetData } from '@types';
import { type SettingsStore, settingsStore } from '../store/settings-store';

/**
 * 提示词通用拼接工具函数。
 *
 * @remarks
 * 过滤空值与空白字符串，并以英文逗号及空格 (, ) 进行连接，不改动词序与大小写。
 *
 * @param parts 待拼接的文本片段列表
 * @returns 逗号连接后的提示词字符串
 */
export function joinPromptParts(...parts: Array<string | undefined | null>): string {
    return parts
        .map((p) => (p ?? '').trim())
        .filter(Boolean)
        .join(', ');
}

/**
 * 规范化提示词文本中的换行、控制符与冗余逗号。
 *
 * @remarks
 * 处理流程：按换行符拆分 → 逐段修剪 → 过滤空段 → 按逗号拆分为词元 → 逐词修剪 → 过滤空词 → 逗号重新连接。
 * 严格保留 `<lora:name:weight>` 与 `<wlr:...>` 等语法标签。
 *
 * @param rawPrompt 原始提示词文本
 * @returns 规整后的单行提示词文本
 */
export function cleanPromptText(rawPrompt: string): string {
    if (!rawPrompt) {
        return '';
    }

    const segments = rawPrompt
        .split(/[\r\n]+/)
        .map((seg) => seg.trim())
        .filter(Boolean);

    const tags: string[] = [];
    for (const seg of segments) {
        const parts = seg.split(',');
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed) {
                tags.push(trimmed);
            }
        }
    }

    return tags.join(', ');
}

/** 楼层中提取出的绘图指令描述 */
export interface ExtractedDrawingCommand {
    rawMatch: string;
    promptText: string;
    instructionIndex: number;
}

/**
 * 从文本中扫描并提取绘图指令。
 * @param text 消息原文
 * @param startTag 起始占位标签 (默认 '<draw>')
 * @param endTag 结束占位标签 (默认 '</draw>')
 */
export function extractDrawingCommands(
    text: string,
    startTag = '<draw>',
    endTag = '</draw>'
): ExtractedDrawingCommand[] {
    if (!text) return [];

    const commands: ExtractedDrawingCommand[] = [];
    const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, 'gi');

    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = regex.exec(text)) !== null) {
        const promptText = (match[1] || '').trim();
        if (promptText) {
            commands.push({
                rawMatch: match[0],
                promptText,
                instructionIndex: idx++,
            });
        }
    }

    return commands;
}

/**
 * 按照首个英文管道符 `|` 分离正向提示词与负向提示词。
 *
 * @remarks
 * 遵循业界常规约定：首个管道符左侧为正向提示词，右侧为负向提示词。
 * 若不存在管道符，则全量文本视为正向提示词，负向词为空字符串。
 *
 * @param input 原始输入文本
 * @returns 正向与负向提示词对象
 */
export function separatePromptByPipe(input: string): { positive: string; negative: string } {
    const safe = (input ?? '').trim();
    const pipeIndex = safe.indexOf('|');

    if (pipeIndex !== -1) {
        return {
            positive: safe.substring(0, pipeIndex).trim(),
            negative: safe.substring(pipeIndex + 1).trim(),
        };
    }

    return {
        positive: safe,
        negative: '',
    };
}

/**
 * 构建提示词请求的入参配置项。
 */
export interface BuildPromptOptions {
    /** 用户原始输入或楼层提取文本 */
    rawPrompt: string;
    /** 可选的图生图原图数据（Blob 或 Base64 字符串） */
    sourceImage?: Blob | string;
    /** 可选的单次临时覆盖超参数 */
    parameters?: Record<string, unknown>;
    /** 可选显式指定的提示词方案 ID，未指定时读取当前活跃提供方的激活预设 */
    presetProfileId?: string;
    /** 可选的目标服务提供方标识 */
    providerType?: string;
}

/**
 * 提示词预处理流水线。
 */
export class PromptPipeline {
    private readonly _settingsStore?: SettingsStore;

    public constructor(settingsStoreInstance?: SettingsStore) {
        this._settingsStore = settingsStoreInstance ?? settingsStore;
    }

    /**
     * 将原始提示词文本解析并装配为标准 GenerationRequest。
     *
     * @remarks
     * 1. 分离正负向提示词；
     * 2. 清洗空白符与冗余逗号；
     * 3. 读取当前激活或指定的 PromptPreset，拼接前缀、后缀与默认负向词；
     * 4. 构建并返回包含纯净意图的 GenerationRequest。
     *
     * @param options 处理配置项
     * @returns 纯净生图意图请求对象
     */
    public buildGenerationRequest(options: BuildPromptOptions): GenerationRequest {
        // 1. 分离正向与负向提示词
        const { positive: rawPositive, negative: rawNegative } = separatePromptByPipe(options.rawPrompt);

        // 2. 清洗规整文本
        const cleanPositive = cleanPromptText(rawPositive);
        const cleanNegative = cleanPromptText(rawNegative);

        // 3. 读取 Prompt 预设
        let promptPreset: PromptPresetData | undefined;
        const store = this._settingsStore ?? settingsStore;

        if (store && typeof store.getPreset === 'function') {
            let targetProfileId = options.presetProfileId;

            if (!targetProfileId && typeof store.getProviderConfig === 'function' && options.providerType) {
                const config = store.getProviderConfig<any>(options.providerType as any);
                targetProfileId = config?.activePromptProfileId;
            }

            if (targetProfileId) {
                const preset = store.getPreset<PromptPresetData>('prompts', targetProfileId);
                promptPreset = preset?.data;
            }
        }

        // 4. 正向提示词装配：[前缀, 正向核心, 后缀]
        const prefix = promptPreset?.prefix;
        const suffix = promptPreset?.suffix;
        const fullPositive = joinPromptParts(prefix, cleanPositive, suffix);

        // 5. 负向提示词装配：优先使用指令中显式提取的负向词，若无则使用预设中的默认负向词
        const defaultNegative = promptPreset?.defaultNegative;
        let fullNegative: string | undefined;

        if (cleanNegative) {
            fullNegative = cleanNegative;
        } else if (defaultNegative) {
            fullNegative = cleanPromptText(defaultNegative);
        }

        // 6. 返回纯净 GenerationRequest
        return {
            prompt: fullPositive,
            negativePrompt: fullNegative || undefined,
            sourceImage: options.sourceImage,
            parameters: options.parameters,
        };
    }

    /**
     * 从文本中提取符合当前占位符配置的全部绘图指令
     * @param text 消息原文
     */
    public extractCommands(text: string): ExtractedDrawingCommand[] {
        const store = this._settingsStore ?? settingsStore;
        const settings = store.getAll();
        const startTag = settings.placeholderStart || '<draw>';
        const endTag = settings.placeholderEnd || '</draw>';
        return extractDrawingCommands(text, startTag, endTag);
    }
}

/** 全局默认单例提示词流水线 */
export const promptPipeline = new PromptPipeline();
