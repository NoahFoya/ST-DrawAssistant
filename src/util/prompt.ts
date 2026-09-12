/**
 * 提示词纯文本与正则基础算法工具集
 * 提供标点归一化、管道符切分、安全拼接、思考链过滤、占位符提取、文本替换与 LoRA 语法生成
 * 纯函数设计，不依赖外部环境、DOM 或持久化状态
 */

export interface ExtractedPlaceholder {
    /** 提取出的正向提示词文本 */
    prompt: string;
    /** 提取出的负向提示词文本（若无则为 undefined） */
    negativePrompt?: string;
    /** 原始完整匹配文本（包含前后标签），供楼层 DOM 原位替换使用 */
    rawMatch: string;
}

export interface LoraFormatItem {
    /** LoRA 模型名称或文件名 */
    name: string;
    /** 基础模型权重，缺省为 1.0 */
    weight?: number;
    /** 文本编码器权重，缺省同基础权重 */
    clipWeight?: number;
    /** 触发词引导权重，主要供 WeiLin 4段式语法使用，缺省为 1.0 */
    triggerWeight?: number;
}

export interface RegexReplacementRule {
    /** 匹配模式，支持 RegExp 实例或字符串 */
    pattern: RegExp | string;
    /** 替换目标字符串 */
    replacement: string;
}

/**
 * 转义正则特殊字符，保证纯文本字符串作为正则匹配模式时的安全性
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 规范化提示词标点与符号
 * 将中文全角标点统一转换为英文半角符号，规整连续空白与多余逗号，清理首尾游离逗号
 */
export function normalizePromptPunctuation(text: string): string {
    if (!text || typeof text !== 'string') {
        return '';
    }

    return text
        .replace(/，/g, ', ')
        .replace(/；/g, '; ')
        .replace(/：/g, ': ')
        .replace(/（/g, '(')
        .replace(/）/g, ')')
        .replace(/[\t\f\v ]+/g, ' ')
        .replace(/ ,/g, ',')
        .replace(/ ;/g, ';')
        .replace(/,\s*(?:,\s*)+/g, ', ')
        .replace(/^[\s,;]+|[\s,;]+$/g, '')
        .trim();
}

/**
 * 依据首个未转义管道符 | 切分正向与负向提示词
 * 若未包含管道符，则正向为完整规范化文本，负向返回空字符串
 */
export function separatePromptByPipe(input: string): { positive: string; negative: string } {
    const normalized = normalizePromptPunctuation(input || '');
    const pipeIndex = normalized.indexOf('|');

    if (pipeIndex === -1) {
        return {
            positive: normalized,
            negative: ''
        };
    }

    return {
        positive: normalizePromptPunctuation(normalized.substring(0, pipeIndex)),
        negative: normalizePromptPunctuation(normalized.substring(pipeIndex + 1))
    };
}

/**
 * 安全拼接多个提示词片段，过滤空值并使用逗号连接
 * 自动剥离各片段首尾既有的逗号与空白，杜绝连续逗号产生
 */
export function joinPromptParts(...parts: Array<string | undefined | null>): string {
    return parts
        .map((p) => {
            if (!p || typeof p !== 'string') return '';
            return p.trim().replace(/^[\s,]+|[\s,]+$/g, '');
        })
        .filter(Boolean)
        .join(', ');
}

/**
 * 过滤聊天消息中的非提示词干扰标签
 * 剥离 HTML 注释、已闭合思考链、未闭合思考链草稿、代码块与行内代码
 */
export function sanitizeMessageText(rawText: string): string {
    if (!rawText || typeof rawText !== 'string') {
        return '';
    }

    let text = rawText;
    // 剥离 HTML 注释
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    // 剥离已闭合思考链
    text = text.replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '');
    // 剥离未闭合的思考链草稿（如流式打字生成中）
    text = text.replace(/<think(?:ing)?>[\s\S]*$/gi, '');
    // 剥离代码块与代码标签
    text = text.replace(/<pre[\s\S]*?<\/pre>/gi, '');
    text = text.replace(/<code[\s\S]*?<\/code>/gi, '');
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`[^`\n]+`/g, '');

    return text.trim();
}

/**
 * 从文本中提取生图占位符，支持管道符正负分离与原始标记保留
 */
export function extractPlaceholders(
    text: string,
    startTag = 'image###',
    endTag = '###'
): ExtractedPlaceholder[] {
    const results: ExtractedPlaceholder[] = [];
    if (!text || !startTag || !endTag) {
        return results;
    }

    const cleanedText = sanitizeMessageText(text);
    let startIndex = 0;

    while (startIndex < cleanedText.length) {
        const start = cleanedText.indexOf(startTag, startIndex);
        if (start === -1) break;

        const end = cleanedText.indexOf(endTag, start + startTag.length);
        if (end === -1) break;

        const rawMatch = cleanedText.substring(start, end + endTag.length);
        const rawContent = cleanedText.substring(start + startTag.length, end).trim();

        if (rawContent) {
            const { positive, negative } = separatePromptByPipe(rawContent);
            results.push({
                prompt: positive,
                negativePrompt: negative ? negative : undefined,
                rawMatch
            });
        }

        startIndex = end + endTag.length;
    }

    return results;
}

/**
 * 字典纯文本替换工具，用于世界书视觉外观标签展开与提示词宏替换
 * 精准匹配键名并安全替换，未匹配的文本保持原样
 */
export function applyTextReplacements(text: string, replacements: Record<string, string>): string {
    if (!text || !replacements || typeof text !== 'string') {
        return text || '';
    }

    let result = text;
    for (const [key, val] of Object.entries(replacements)) {
        if (!key) continue;
        const pattern = new RegExp(escapeRegExp(key), 'g');
        result = result.replace(pattern, () => val ?? '');
    }

    return result;
}

/**
 * 顺序执行提示词正则替换规则
 * 依次应用各规则的正则匹配与替换，常用于敏感词规避与词汇过滤
 */
export function applyRegexRules(text: string, rules: RegexReplacementRule[]): string {
    if (!text || !Array.isArray(rules) || rules.length === 0) {
        return text || '';
    }

    let result = text;
    for (const rule of rules) {
        if (!rule || !rule.pattern) continue;
        const pattern = typeof rule.pattern === 'string'
            ? new RegExp(escapeRegExp(rule.pattern), 'g')
            : rule.pattern;
        result = result.replace(pattern, rule.replacement ?? '');
    }

    return result;
}

/**
 * 按照后端引擎语法格式化 LoRA 标签
 * 支持 SD-WebUI A1111 语法 (<lora:name:weight>) 与 ComfyUI WeiLin 4段式语法 (<wlr:name:model:clip:trigger>)
 */
export function formatLoraTag(lora: LoraFormatItem, syntax: 'webui' | 'weilin' = 'webui'): string {
    if (!lora || !lora.name) {
        return '';
    }

    // 剔除常见的模型文件后缀
    const cleanName = lora.name.replace(/\.(safetensors|pt|ckpt|pth)$/i, '').trim();
    if (!cleanName) {
        return '';
    }

    const modelWeight = lora.weight ?? 1.0;
    const clipWeight = lora.clipWeight ?? modelWeight;
    const triggerWeight = lora.triggerWeight ?? 1.0;

    if (syntax === 'weilin') {
        return `<wlr:${cleanName}:${modelWeight}:${clipWeight}:${triggerWeight}>`;
    }

    return `<lora:${cleanName}:${modelWeight}>`;
}
