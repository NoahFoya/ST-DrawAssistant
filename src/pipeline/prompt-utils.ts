/**
 * 提示词文本处理工具函数
 * 提供首个管道符正负词拆分、文本拼接与占位符提取
 */

/**
 * 拼接提示词片段，过滤空值并使用逗号连接
 */
export function joinPromptParts(...parts: Array<string | undefined | null>): string {
    return parts
        .map((p) => (p || '').trim())
        .filter(Boolean)
        .join(', ');
}

/**
 * 依据首个管道符 | 分隔正向与负向提示词
 * 保留文本内部的换行与标点，仅按首个管道符拆分
 */
export function separatePromptByPipe(input: string): { positive: string; negative: string } {
    const safe = (input || '').trim();
    const pipeIdx = safe.indexOf('|');
    if (pipeIdx !== -1) {
        return {
            positive: safe.substring(0, pipeIdx).trim(),
            negative: safe.substring(pipeIdx + 1).trim()
        };
    }
    return {
        positive: safe,
        negative: ''
    };
}

export interface ExtractedPlaceholder {
    prompt: string;
    negativePrompt?: string;
    rawMatch?: string;
}

/**
 * 清理聊天文本，过滤思考标签 (<think>)、代码块与 HTML 注释，避免非正文内容干扰占位符解析
 */
export function sanitizeMessageText(rawText: string): string {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = rawText;
    // 移除 HTML 注释
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    // 移除已闭合的思考链内容
    text = text.replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '');
    // 移除未闭合的思考链草稿（如流式打字阶段）
    text = text.replace(/<think(?:ing)?>[\s\S]*$/gi, '');
    // 移除 HTML 代码块与 Markdown 代码块/行内代码，避免示例代码中的指令符被误触发
    text = text.replace(/<pre[\s\S]*?<\/pre>/gi, '');
    text = text.replace(/<code[\s\S]*?<\/code>/gi, '');
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`[^`\n]+`/g, '');
    return text;
}

/**
 * 从文本中提取生图占位符，支持正负向提示词拆分与原始标记保留
 */
export function extractPlaceholders(
    text: string,
    startTag = 'image###',
    endTag = '###'
): ExtractedPlaceholder[] {
    const results: ExtractedPlaceholder[] = [];
    if (!text || !startTag || !endTag) return results;

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
