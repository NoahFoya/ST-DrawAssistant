/**
 * @module utils/html
 * @description HTML 字符串与属性转义工具
 *
 * 职责：
 * - 提供防范 XSS 的 HTML 标签与属性安全转义函数
 */

/**
 * 转义字符串作为文本节点内容插值
 *
 * @param str 原始未经处理的文本字符串
 * @returns 转义后的 HTML 安全字符串
 */
export function escapeHtml(str: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 转义字符串作为 HTML 属性值插值
 *
 * @param str 原始未经处理的属性字符串
 * @returns 转义后的 HTML 属性安全字符串
 */
export function escapeHtmlAttr(str: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
