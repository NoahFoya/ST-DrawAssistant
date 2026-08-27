/**
 * @module ui/foundation/utils
 * @description UI 基础通用工具函数 (HTML 转义、字节格式化、颜色规范化等)
 */

/**
 * 安全转义 HTML 字符串，防止 XSS 注入
 *
 * @param str 任意待转义内容
 * @returns 转义后的安全 HTML 实体字符串
 */
export function escapeHtml(str: unknown): string {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * 格式化字节大小为人类可读文本 (B / KB / MB / GB)
 *
 * @param bytes 字节数
 * @returns 格式化后的字符串 (如 "1.25 MB")
 */
export function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 规范化十六进制颜色字符串 (#RGB / #RRGGBB)
 *
 * @param hex 颜色字符串
 * @returns 规范化的 #rrggbb 小写字符串或 null (若格式非法)
 */
export function normalizeHex(hex: string): string | null {
    if (!hex || typeof hex !== 'string') return null;
    let clean = hex.trim();
    if (!clean.startsWith('#')) clean = '#' + clean;
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
        return clean.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
        const r = clean[1];
        const g = clean[2];
        const b = clean[3];
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{8}$/.test(clean)) {
        return clean.toLowerCase();
    }
    return null;
}
