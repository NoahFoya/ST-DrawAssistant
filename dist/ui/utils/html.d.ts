/**
 * @module ui/utils/html
 * @description XSS 防护转义与安全 HTML 模板标签工具 (html, escapeHtml)
 */
/**
 * 标记为无需再次转义的安全 HTML 字符串包装对象
 */
export declare class SafeString {
    readonly value: string;
    constructor(value: string);
    toString(): string;
}
/**
 * 将原始 HTML 片段标记为安全内容（避免在 html 模板标签中被重复转义）
 *
 * @param rawHtml 已验证安全的 HTML 字符串
 * @returns SafeString 包装对象
 */
export declare function safe(rawHtml: string): SafeString;
/**
 * 对未知或不可信的文本进行 HTML 实体转义，防止 XSS 攻击
 *
 * @param str 待转义的原始值
 * @returns 已转义的纯文本 HTML 实体安全字符串
 */
export declare function escapeHtml(str: unknown): string;
/**
 * 安全 HTML 模板标签
 *
 * @example
 * const domStr = html`<div class="da-title">${userInput}</div>`;
 */
export declare function html(strings: TemplateStringsArray, ...values: unknown[]): string;
/**
 * 将 HTML 字符串转换为真实的 DOM 节点
 */
export declare function createDom<T extends HTMLElement = HTMLElement>(htmlStr: string): T;
//# sourceMappingURL=html.d.ts.map