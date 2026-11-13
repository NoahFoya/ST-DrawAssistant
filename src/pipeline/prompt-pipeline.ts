/**
 * 提示词预处理与意图解析模块。
 *
 * @remarks
 * 负责从原始输入指令中提取正负向提示词、剥离思考链与代码块干扰、
 * 规整标点符号（中文逗号转半角）、受控标签去重并装配纯净的 GenerationRequest 领域请求对象。
 */

import type {
    GenerationRequest,
    ProviderType,
    PromptPresetData,
    DrawingPresetData,
    LoraSyntaxMode,
} from '@types';
import { type SettingsStore, settingsStore } from '../store/settings-store';
import { resolvePromptMacros } from './macro-resolver';
import { logger } from '../util/logger';

/**
 * 将 WebUI 权重语法 (tag:1.2) 或 (tag:0.8) 转换为 NovelAI 花括号/方括号增强语法（如 {tag} 或 [tag]）。
 *
 * @param text 输入提示词
 * @returns 转换后的提示词
 */
export function convertWeightToBrackets(text: string): string {
    return text.replace(/\(([^():]+):([0-9.]+)\)/g, (_match, tag, weightStr) => {
        const weight = parseFloat(weightStr);
        const trimmedTag = tag.trim();
        if (isNaN(weight) || weight === 1.0) {
            return trimmedTag;
        }
        if (weight > 1.0) {
            const count = Math.min(5, Math.max(1, Math.round((weight - 1.0) / 0.1)));
            return '{'.repeat(count) + trimmedTag + '}'.repeat(count);
        } else {
            const count = Math.min(5, Math.max(1, Math.round((1.0 - weight) / 0.1)));
            return '['.repeat(count) + trimmedTag + ']'.repeat(count);
        }
    });
}

/**
 * 合并预设通用负向提示词与用户自定义负向提示词并去重。
 *
 * @param presetNegative 预设通用负向提示词
 * @param userNegative 用户特定排除负向提示词
 * @returns 合并去重后的负向提示词字符串
 */
export function mergeNegativePrompts(presetNegative?: string, userNegative?: string): string {
    const p1 = (presetNegative ?? '').trim();
    const p2 = (userNegative ?? '').trim();
    if (!p1 && !p2) return '';
    if (!p1) return p2;
    if (!p2) return p1;

    const seen = new Set<string>();
    const tags: string[] = [];
    for (const part of `${p1}, ${p2}`.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const lookup = trimmed.toLowerCase();
        if (seen.has(lookup)) continue;
        seen.add(lookup);
        tags.push(trimmed);
    }
    return tags.join(', ');
}

/**
 * 剥离文本中的 LoRA 语法标签 (<lora:...> 与 <wlr:...>)，用于适配不支持 LoRA 语法的后端。
 *
 * @param text 输入文本
 * @returns 剥离 LoRA 语法后的文本
 */
export function stripLoraSyntax(text: string): string {
    if (!text) {
        return '';
    }
    return text.replace(/<(?:lora|wlr):[^>]+>/gi, ' ').trim();
}

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

/** 楼层中提取出的生图指令描述 */
export interface ExtractedDrawingCommand {
    rawMatch: string;
    promptText: string;
    instructionIndex: number;
}

/**
 * 从文本中扫描并提取生图指令。
 * @param text 消息原文
 * @param startTag 起始标签 (默认 'image###')
 * @param endTag 结束标签 (默认 '###')
 */
export function extractDrawingCommands(
    text: string,
    startTag = 'image###',
    endTag = '###'
): ExtractedDrawingCommand[] {
    if (!text) return [];

    // 严格空字符处理：当配置项为空或纯空白时，回退到默认指令标签
    const cleanStart = (startTag || '').trim() || 'image###';
    const cleanEnd = (endTag || '').trim() || '###';

    // 先行清洗思考链与代码块干扰，避免模型在思考草稿中留下的伪指令被错误提取
    const sanitizedText = sanitizeMessageText(text);

    const commands: ExtractedDrawingCommand[] = [];
    const escapedStart = cleanStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = cleanEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, 'gi');

    let match: RegExpExecArray | null;
    let idx = 0;
    let lastIndexBeforeMatch = -1;
    while ((match = regex.exec(sanitizedText)) !== null) {
        // 零宽匹配防御：若正则未能向前推进，强制步进防止死循环
        if (regex.lastIndex === lastIndexBeforeMatch) {
            regex.lastIndex++;
        }
        lastIndexBeforeMatch = regex.lastIndex;

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

/** 可被格式化为 LoRA 标签的输入数据规范 */
export interface FormatLoraTagInput {
    modelName?: string;
    modelWeight?: number;
    clipWeight?: number;
    triggerWeight?: number;
}

/**
 * 根据指定模式将 LoRA 条目格式化为提示词标签。
 *
 * @param item LoRA 条目数据
 * @param mode 语法模式 ('standard' | 'weilin')，默认 'standard'
 * @returns 格式化后的标签字符串
 */
export function formatLoraTag(
    item: FormatLoraTagInput,
    mode: LoraSyntaxMode = 'standard'
): string {
    if (!item) {
        return '';
    }
    const rawName = item.modelName || '';
    if (!rawName) {
        return '';
    }
    const cleanName = rawName.replace(/\.(safetensors|pt|ckpt|pth)$/i, '').trim();
    if (!cleanName) {
        return '';
    }

    const rawModel = typeof item.modelWeight === 'number' ? item.modelWeight : undefined;

    // 过滤无效或数值为 0 的主权重
    if (rawModel !== undefined && (!Number.isFinite(rawModel) || Math.abs(rawModel) < 0.001)) {
        return '';
    }
    const baseModel = rawModel !== undefined ? rawModel : 0.8;
    const clampedModel = Math.max(-5.0, Math.min(5.0, Number(baseModel.toFixed(3))));
    if (Math.abs(clampedModel) < 0.001) {
        return '';
    }

    const clampedClip =
        typeof item.clipWeight === 'number' && Number.isFinite(item.clipWeight)
            ? Math.max(-5.0, Math.min(5.0, Number(item.clipWeight.toFixed(3))))
            : clampedModel;

    if (mode === 'weilin') {
        const clampedTrigger =
            typeof item.triggerWeight === 'number' && Number.isFinite(item.triggerWeight)
                ? Math.max(-5.0, Math.min(5.0, Number(item.triggerWeight.toFixed(3))))
                : 1.0;
        return `<wlr:${cleanName}:${clampedModel}:${clampedClip}:${clampedTrigger}>`;
    }

    if (clampedModel === clampedClip) {
        return `<lora:${cleanName}:${clampedModel}>`;
    }
    return `<lora:${cleanName}:${clampedModel}:${clampedClip}>`;
}

/**
 * 构建提示词请求的入参配置项。
 */
export interface BuildPromptOptions {
    /** 用户原始输入或楼层提取文本 */
    rawPrompt: string;
    /** 可选的图生图原图数据（Blob 或 Base64 字符串） */
    sourceImage?: Blob | string;
    /** 可选的局部重绘蒙版遮罩数据（Blob 或 Base64 字符串） */
    maskImage?: Blob | string;
    /** 可选的单次调用覆盖参数（优先于预设参数） */
    parameters?: Record<string, unknown>;
    /** 目标生图服务提供方类型 */
    providerType?: ProviderType;
}

/**
 * 提示词预处理器。
 */
export class PromptPipeline {
    private readonly _settingsStore: SettingsStore;

    public constructor(settingsStoreInstance?: SettingsStore) {
        this._settingsStore = settingsStoreInstance ?? settingsStore;
    }

    /**
     * 解析原始提示词、展开素材宏、应用预设并装配 GenerationRequest 请求对象：
     * 1. 过滤干扰标签（思考链、代码块）；
     * 2. 分离正负向提示词；
     * 3. 解析与展开本地素材库宏 ($名称$ 与 $名称-部位$)；
     * 4. 解析关联的提示词与生图预设；
     * 5. 应用预设前缀、后缀与通用负向词；
     * 6. 依据后端能力分流组装 LoRA 词条；
     * 7. NovelAI 画质标签与权重括号语法转换；
     * 8. 剥离不支持后端的残留 LoRA 标签；
     * 9. 规整标点符号并按配置执行标签去重。
     *
     * @param options 处理配置项
     * @returns 装配好的生图请求对象
     */
    public buildGenerationRequest(options: BuildPromptOptions): GenerationRequest {
        const currentSettings = this._settingsStore.getSettings();
        const shouldDeduplicate = Boolean(currentSettings?.cleanPrompt);
        const provider = options.providerType;
        const params = options.parameters || {};

        // 1. 先行对原始提示词进行思考链与代码块清洗，防止模型思考草稿干扰提示词
        const sanitizedRaw = sanitizeMessageText(options.rawPrompt);

        // 2. 分离正向与负向提示词（以管道符 | 为界）
        const { positive: rawPositive, negative: rawNegative } = separatePromptByPipe(sanitizedRaw);

        // 提取 options.parameters 中的显式负向词 (若存在)
        const paramNegative =
            typeof params.negativePrompt === 'string'
                ? params.negativePrompt.trim()
                : '';

        // 合并正文提取的负向词与参数显式指定的负向词
        const combinedNegative = [rawNegative, paramNegative].filter(Boolean).join(', ');

        // 3. 展开本地素材库宏 ($ID$ / $ID-key1-key2$)
        let positive = rawPositive;
        let negative = combinedNegative;

        const allUnresolvedMacros: string[] = [];

        const applyMaterialMacros = (input: string): string => {
            if (!input || !input.includes('$')) {
                return input;
            }
            const res = resolvePromptMacros(input, currentSettings);
            if (res.unresolvedMacros.length > 0) {
                allUnresolvedMacros.push(...res.unresolvedMacros);
            }
            return res.text;
        };

        positive = applyMaterialMacros(positive);
        negative = applyMaterialMacros(negative);

        // 4. 解析绑定的提示词预设 (PromptPresetData)
        let promptPreset: PromptPresetData | undefined;
        let drawingPreset: DrawingPresetData | undefined;
        let promptPresetId = params.promptPresetId as string | undefined;
        if (provider) {
            const drawingPresetId = params.drawingPresetId as string | undefined;
            if (drawingPresetId && drawingPresetId !== 'default') {
                const dp = this._settingsStore.getPreset<DrawingPresetData>('drawing', drawingPresetId, provider);
                if (!dp) {
                    throw new Error(`关联的生图预设已失效或不存在 (ID: ${drawingPresetId})，请重新选择预设`);
                }
                drawingPreset = dp.data;
            } else if (drawingPresetId === 'default') {
                drawingPreset = this._settingsStore.getPreset<DrawingPresetData>('drawing', 'default', provider)?.data;
            }
            if (!promptPresetId) {
                promptPresetId = drawingPreset?.promptPresetId;
            }
        }
        if (promptPresetId) {
            const pp = this._settingsStore.getPreset<PromptPresetData>('prompts', promptPresetId, provider);
            if (!pp) {
                throw new Error(`关联的提示词预设已失效或不存在 (ID: ${promptPresetId})，请重新选择预设`);
            }
            promptPreset = pp.data;
        }

        // 5. 应用提示词预设（前缀、后缀、负向词基底，同样支持本地素材宏展开）
        if (promptPreset) {
            const prefix = applyMaterialMacros((promptPreset.positivePrefix || '').trim());
            const suffix = applyMaterialMacros((promptPreset.positiveSuffix || '').trim());
            const defaultNeg = applyMaterialMacros((promptPreset.negativePrompt || '').trim());

            if (prefix) {
                positive = positive ? `${prefix}, ${positive}` : prefix;
            }

            // 6. 依据 ProviderType 能力分流组装 LoRA 词条 (置于主体后、后缀前)
            if (Array.isArray(promptPreset.loras) && promptPreset.loras.length > 0) {
                if (provider === 'sdwebui' || provider === 'comfyui') {
                    // SD-WebUI 强制标准双权重语法；ComfyUI 遵从预设配置的语法模式 ('standard' 或 'weilin')
                    const syntaxMode = provider === 'sdwebui' ? 'standard' : (promptPreset.loraSyntaxMode ?? 'standard');
                    for (const lora of promptPreset.loras) {
                        const rawName = lora?.modelName?.trim() || '';
                        if (lora?.enabled === false || !rawName) continue;
                        const cleanName = rawName.replace(/\.(safetensors|pt|ckpt|pth)$/i, '').trim();
                        const tagRegex = new RegExp(
                            `<(?:lora|wlr):${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`,
                            'i'
                        );
                        if (!tagRegex.test(positive)) {
                            const tag = formatLoraTag(lora, syntaxMode);
                            if (tag) positive = positive ? `${positive}, ${tag}` : tag;
                        }
                    }
                }
                // openai 与 novelai 不支持 lora 提示词语法，跳过组装
            }

            if (suffix) {
                positive = positive ? `${positive}, ${suffix}` : suffix;
            }
            if (defaultNeg) {
                negative = mergeNegativePrompts(defaultNeg, negative);
            }
        }

        if (allUnresolvedMacros.length > 0) {
            const uniqueUnresolved = Array.from(new Set(allUnresolvedMacros));
            logger.warn(`未找到角色/服装宏定义：${uniqueUnresolved.map((m) => `$${m}$`).join(', ')}`);
        }

        // 7. 若为 NovelAI，按需应用官方画质标签与权重括号转换
        if (provider === 'novelai') {
            const enableQualityTags = Boolean(params.qualityTags ?? drawingPreset?.qualityTags);
            if (enableQualityTags && !positive.includes('masterpiece')) {
                const model = String(params.baseModel ?? drawingPreset?.baseModel ?? '');
                const isV4 = model.includes('4-5') || model.includes('v4');
                const qualityPrefix = isV4
                    ? 'very aesthetic, masterpiece, absurdres'
                    : 'masterpiece, best quality';
                positive = positive ? `${qualityPrefix}, ${positive}` : qualityPrefix;
            }

            const enableConvertSyntax = Boolean(params.convertSyntax ?? drawingPreset?.convertSyntax);
            if (enableConvertSyntax) {
                positive = convertWeightToBrackets(positive);
                if (negative) {
                    negative = convertWeightToBrackets(negative);
                }
            }
        }

        // 8. 针对不支持 LoRA 语法标签的后端（NovelAI、OpenAI），自动剥离残留的 <lora:...> 与 <wlr:...>
        if (provider === 'novelai' || provider === 'openai') {
            positive = stripLoraSyntax(positive);
            if (negative) {
                negative = stripLoraSyntax(negative);
            }
        }

        // 9. 统一清洗规整文本与标点符号，严格按配置决定是否执行保序标签去重
        const cleanPositive = cleanPromptText(positive, shouldDeduplicate);
        const cleanNegative = cleanPromptText(negative, shouldDeduplicate);

        return {
            prompt: cleanPositive,
            negativePrompt: cleanNegative || undefined,
            sourceImage: options.sourceImage ?? (params.sourceImage as Blob | string | undefined),
            maskImage: options.maskImage ?? (params.maskImage as Blob | string | undefined),
            parameters: options.parameters,
        };
    }

    /**
     * 从文本中提取符合当前指令标签配置的全部生图指令
     * @param text 消息原文
     */
    public extractCommands(text: string): ExtractedDrawingCommand[] {
        const settings = this._settingsStore.getSettings();
        const startTag = settings?.promptStartTag || 'image###';
        const endTag = settings?.promptEndTag || '###';
        return extractDrawingCommands(text, startTag, endTag);
    }
}

/** 全局默认提示词预处理器实例 */
export const promptPipeline = new PromptPipeline();
