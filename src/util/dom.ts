/**
 * DOM 辅助与文本安全工具 (src/util/dom.ts)
 *
 * 核心功能：
 * 1. 提供原生 DOM 节点的声明式创建与属性/事件装配 (createElement)；
 * 2. 提供 HTML 实体安全转义 (escapeHtml)，防止拼接文本引起 XSS 注入；
 * 3. 提供数值闭区间限制 (clamp)、存储字节友好格式化 (formatBytes) 与十六进制颜色规范化 (normalizeHex)。
 *
 * 注意事项：
 * 1. createElement 依赖浏览器宿主 DOM API，在非 DOM 运行时环境中不可调用；
 * 2. 拼接 HTML 字符串时必须使用 escapeHtml 转义外部不可信输入。
 */

export interface ElementOptions {
    className?: string;
    textContent?: string;
    innerHTML?: string;
    attributes?: Record<string, string>;
    dataset?: Record<string, string>;
    children?: (Node | string)[];
    events?: Record<string, EventListenerOrEventListenerObject>;
}

/**
 * 安全转义 HTML 实体，防止未转义文本拼接导致 XSS 注入。
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
 * 声明式构建原生 DOM 元素。
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options: ElementOptions = {}
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);

    if (options.className) {
        el.className = options.className;
    }

    if (options.textContent !== undefined) {
        el.textContent = options.textContent;
    } else if (options.innerHTML !== undefined) {
        el.innerHTML = options.innerHTML;
    }

    if (options.attributes) {
        for (const [key, val] of Object.entries(options.attributes)) {
            if (val !== undefined && val !== null) {
                el.setAttribute(key, val);
            }
        }
    }

    if (options.dataset) {
        for (const [key, val] of Object.entries(options.dataset)) {
            if (val !== undefined && val !== null) {
                el.dataset[key] = val;
            }
        }
    }

    if (options.children) {
        for (const child of options.children) {
            if (typeof child === 'string') {
                el.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                el.appendChild(child);
            }
        }
    }

    if (options.events) {
        for (const [eventName, listener] of Object.entries(options.events)) {
            el.addEventListener(eventName, listener);
        }
    }

    return el;
}

/**
 * 将数值限制在指定的 [min, max] 闭区间内。
 */
export function clamp(val: number, min: number, max: number): number {
    return Math.min(Math.max(val, min), max);
}

/**
 * 格式化字节大小为人类友好文本 (B / KB / MB / GB)。
 */
export function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0 || isNaN(bytes)) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    const val = bytes / Math.pow(k, i);
    return `${parseFloat(val.toFixed(2))} ${units[i]}`;
}

/**
 * 规范化十六进制颜色字符串 (#RGB / #RRGGBB / #RRGGBBAA)。
 * 若格式非法则返回 null。
 */
export function normalizeHex(hex: string): string | null {
    if (!hex || typeof hex !== 'string') return null;
    let clean = hex.trim();
    if (!clean.startsWith('#')) {
        clean = '#' + clean;
    }

    // 6 位 #rrggbb
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
        return clean.toLowerCase();
    }
    // 3 位 #rgb 展开为 #rrggbb
    if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
        const r = clean[1];
        const g = clean[2];
        const b = clean[3];
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    // 8 位 #rrggbbaa
    if (/^#[0-9a-fA-F]{8}$/.test(clean)) {
        return clean.toLowerCase();
    }

    return null;
}
