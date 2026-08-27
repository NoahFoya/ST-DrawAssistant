/**
 * @module ui/utils/html
 * @description XSS 防护转义与安全 HTML 模板标签工具 (html, escapeHtml)
 */

/**
 * 标记为无需再次转义的安全 HTML 字符串包装对象
 */
export class SafeString {
    constructor(public readonly value: string) {}
    toString(): string {
        return this.value;
    }
}

/**
 * 将原始 HTML 片段标记为安全内容（避免在 html 模板标签中被重复转义）
 *
 * @param rawHtml 已验证安全的 HTML 字符串
 * @returns SafeString 包装对象
 */
export function safe(rawHtml: string): SafeString {
    return new SafeString(rawHtml);
}

/**
 * 对未知或不可信的文本进行 HTML 实体转义，防止 XSS 攻击
 *
 * @param str 待转义的原始值
 * @returns 已转义的纯文本 HTML 实体安全字符串
 */
export function escapeHtml(str: unknown): string {
    if (str === null || str === undefined) return '';
    if (str instanceof SafeString) return str.value;

    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 安全 HTML 模板标签
 *
 * @example
 * const domStr = html`<div class="da-title">${userInput}</div>`;
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
    let result = '';
    for (let i = 0; i < strings.length; i++) {
        result += strings[i];
        if (i < values.length) {
            const val = values[i];
            if (Array.isArray(val)) {
                result += val.map((item) => escapeHtml(item)).join('');
            } else {
                result += escapeHtml(val);
            }
        }
    }
    return result.trim();
}

/**
 * 将 HTML 字符串转换为真实的 DOM 节点
 */
export function createDom<T extends HTMLElement = HTMLElement>(htmlStr: string): T {
    const template = document.createElement('template');
    template.innerHTML = htmlStr.trim();
    return template.content.firstElementChild as T;
}
