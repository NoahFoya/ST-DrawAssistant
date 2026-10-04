/**
 * 提示词预处理与意图解析模块。
 *
 * @remarks
 * 负责从原始输入指令中提取正反向提示词、剥离思考链与代码块干扰、
 * 展开 SillyTavern 宿主宏变量 ({{char}} / {{user}})、规整标点符号（中文逗号转半角）、
 * 受控标签去重并装配纯净的 GenerationRequest 领域请求对象。
 */

import type { GenerationRequest } from '@types';
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
 * 过滤消息文本中的干扰标签。
 *
 * @remarks
 * 剥离 HTML 注释、已闭合与未闭合的大模型思考链 (<think>...</think>) 以及代码块，
 * 避免推理模型的自我修正过程或代码块文本污染提示词或产生虚假生图指令。
 *
 * @param rawText 原始文本
 * @returns 净化后的文本
 */
export function sanitizeMessageText(rawText: string): string {
    if (!rawText || typeof rawText !== 'string') {
        return '';
    }

    let text = rawText;
    // 1. 剥离 HTML 注释
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    // 2. 剥离已闭合的思考链
    text = text.replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '');
    // 3. 剥离未闭合的思考链草稿（如流式生成截断中）
    text = text.replace(/<think(?:ing)?>[\s\S]*$/gi, '');
    // 4. 剥离代码块与代码标签
    text = text.replace(/<pre[\s\S]*?<\/pre>/gi, '');
    text = text.replace(/<code[\s\S]*?<\/code>/gi, '');
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`[^`\n]+`/g, '');

    return text.trim();
}

/**
 * 委托 SillyTavern 宿主环境展开宏变量。
 *
 * @remarks
 * 安全调用 SillyTavern.getContext().substituteParams 将文本中的 `{{char}}`、`{{user}}` 等展开为实际值；
 * 在非浏览器或测试环境中，若未探测到宿主上下文则安全原样返回。
 *
 * @param text 待展开宏的文本
 * @returns 展开后的文本
 */
export function expandHostMacros(text: string): string {
    if (!text || typeof text !== 'string') {
        return '';
    }

    try {
        const substituteFn =
            window?.SillyTavern?.getContext?.()?.substituteParams ||
            window?.substituteParams;
        if (typeof substituteFn === 'function') {
            return substituteFn(text);
        }
    } catch {
        // 宿主环境未就绪或非浏览器环境时原样返回
    }

    return text;
}

/**
 * 规范化提示词文本中的换行、标点符号与冗余逗号，支持受控去重。
 *
 * @remarks
 * 处理流程：
 * 1. 规整中文全角逗号与顿号为英文半角逗号；
 * 2. 按换行符拆分段落，逐段修剪；
 * 3. 按逗号拆分为词元并去除空白；
 * 4. 若开启 deduplicate，按大小写不敏感进行标签去重（严格保留 `<lora:...>` 等特殊语法标签）；
 * 5. 重新以 `, ` 连接。
 *
 * @param rawPrompt 原始提示词文本
 * @param deduplicate 是否执行标签去重，默认为 false
 * @returns 规整后的单行提示词文本
 */
export function cleanPromptText(rawPrompt: string, deduplicate = false): string {
    if (!rawPrompt) {
        return '';
    }

    // 1. 将中文全角逗号与顿号替换为半角英文逗号
    const normalized = rawPrompt.replace(/[，、]/g, ',');

    const segments = normalized
        .split(/[\r\n]+/)
        .map((seg) => seg.trim())
        .filter(Boolean);

    const tags: string[] = [];
    const seenTags = new Set<string>();

    for (const seg of segments) {
        const parts = seg.split(',');
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) {
                continue;
            }

            if (deduplicate) {
                // 特殊语法标签（如 <lora:...>）严格保留原样，不做大小写忽略比较
                const isSpecialTag = trimmed.startsWith('<') && trimmed.endsWith('>');
                const lookupKey = isSpecialTag ? trimmed : trimmed.toLowerCase();
                if (seenTags.has(lookupKey)) {
                    continue;
                }
                seenTags.add(lookupKey);
            }

            tags.push(trimmed);
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
 * @param startTag 起始占位标签 (默认 'image###')
 * @param endTag 结束占位标签 (默认 '###')
 */
export function extractDrawingCommands(
    text: string,
    startTag = 'image###',
    endTag = '###'
): ExtractedDrawingCommand[] {
    if (!text) return [];

    // 先行清洗思考链与代码块干扰，避免模型在思考草稿中留下的伪指令被错误提取
    const sanitizedText = sanitizeMessageText(text);

    const commands: ExtractedDrawingCommand[] = [];
    const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, 'gi');

    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = regex.exec(sanitizedText)) !== null) {
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
}

/**
 * 提示词预处理器。
 */
export class PromptPipeline {
    private readonly _settingsStore?: SettingsStore;
    private readonly _substituteParams?: (text: string) => string;

    public constructor(
        settingsStoreInstance?: SettingsStore,
        substituteParamsProvider?: (text: string) => string
    ) {
        this._settingsStore = settingsStoreInstance ?? settingsStore;
        this._substituteParams = substituteParamsProvider;
    }

    /**
     * 将原始提示词文本解析并装配为标准 GenerationRequest 领域请求对象。
     *
     * @remarks
     * 5 步清洗与装配处理流程：
     * 1. 干扰标签剥离：移除 HTML 注释、大模型思考链 (<think>) 与代码块，防止推理模型的自我修正文本污染生图意图；
     * 2. 正负词切分：支持通过管道符 `|` 切分正向与负向提示词，并与参数中传入的显式 negativePrompt 合并；
     * 3. 宿主宏替换：将 `{{char}}`、`{{user}}` 等展开为会话上下文中的实际角色名称；
     * 4. 文本清洗与去重：中文全角标点规整为半角，受控去重（依据 cleanPrompt 配置，保留 lora 语法）；
     * 5. 对象装配：封装为不可变的纯净 GenerationRequest。
     *
     * @param options 处理配置项
     * @returns 纯净生图意图请求对象
     */
    public buildGenerationRequest(options: BuildPromptOptions): GenerationRequest {
        const store = this._settingsStore ?? settingsStore;
        const currentSettings = store.getSettings();
        const shouldDeduplicate = Boolean(currentSettings?.cleanPrompt);

        // 1. 先行对原始提示词进行思考链与代码块清洗，防止模型思考草稿干扰提示词
        const sanitizedRaw = sanitizeMessageText(options.rawPrompt);

        // 2. 分离正向与负向提示词（以管道符 | 为界）
        const { positive: rawPositive, negative: rawNegative } = separatePromptByPipe(sanitizedRaw);

        // 提取 options.parameters 中的显式负向词 (若存在)
        const paramNegative =
            typeof options.parameters?.negativePrompt === 'string'
                ? options.parameters.negativePrompt.trim()
                : '';

        // 合并正文提取的负向词与参数显式指定的负向词
        const combinedNegative = [rawNegative, paramNegative].filter(Boolean).join(', ');

        // 3. 展开宿主宏变量 ({{char}}, {{user}} 等)
        const expander = this._substituteParams || expandHostMacros;
        const expandedPositive = expander(rawPositive);
        const expandedNegative = expander(combinedNegative);

        // 4. 清洗规整文本，标点规整并按配置受控执行标签去重
        const cleanPositive = cleanPromptText(expandedPositive, shouldDeduplicate);
        const cleanNegative = cleanPromptText(expandedNegative, shouldDeduplicate);

        // 5. 返回标准化 GenerationRequest
        return {
            prompt: cleanPositive,
            negativePrompt: cleanNegative || undefined,
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
        const settings = store.getSettings();
        const startTag = settings?.placeholderStart || 'image###';
        const endTag = settings?.placeholderEnd || '###';
        return extractDrawingCommands(text, startTag, endTag);
    }
}

/** 全局默认提示词预处理器实例 */
export const promptPipeline = new PromptPipeline();
