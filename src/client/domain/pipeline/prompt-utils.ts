/**
 * @module domain/pipeline/prompt-utils
 * @description 提示词文本处理辅助工具函数
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
 *
 * 保留文本内部的换行与标点，仅按第一个 | 拆分正负向提示词。
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
