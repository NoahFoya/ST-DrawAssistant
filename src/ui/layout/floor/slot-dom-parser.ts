/**
 * 插槽 DOM 算法解析器 (SlotDomParser)
 * 职责：
 * 1. 纯 DOM 树文本遍历与占位符匹配；
 * 2. 严格过滤代码块、语法高亮区与思维链折叠区域；
 * 3. 基于字符逻辑偏移量使用 Range 精准逆序原位替换占位符；
 * 4. 规范化消除紧邻换行符与孤立空段落（<p><br></p>），为独占段落赋予紧凑样式；
 * 5. 清理多余失效的插槽。
 * 
 * 纯函数/无状态设计，不依赖任何业务服务（TaskManager、StorageService 等）。
 */

/** 需严格跳过的代码块容器标签 */
const CODE_RELATED_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'BUTTON',
    'PRE',
    'CODE',
    'TEXTAREA',
    'KBD',
    'SAMP',
    'VAR'
]);

/** 需严格跳过的高亮代码块样式类模式 */
const CODE_CLASS_PATTERNS = ['hljs', 'highlight', 'prism', 'language-', 'CodeMirror', 'ace_'];

/** 需严格跳过的思维链与思考折叠容器样式类模式 */
const THINKING_CLASS_PATTERNS = ['think', 'thinking', 'thought', 'reasoning', 'chat-thought', 'mind-fold', 'thinking-details'];

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 统一判定节点是否处于代码块、思维链或禁止注入的容器内部
 */
export function isNodeInCodeOrThinking(node: Node): boolean {
    const parent = node.parentElement;
    if (!parent) return false;
    const parentTag = parent.tagName || '';
    if (CODE_RELATED_TAGS.has(parentTag)) return true;
    if (parent.closest('pre, code, textarea, kbd, samp')) return true;
    if (parent.closest('details.thinking, .think, .thinking, .thought, .reasoning, .chat-thought, .mind-fold, details[class*="think"]')) return true;

    const parentClass = parent.className;
    if (typeof parentClass === 'string') {
        if (CODE_CLASS_PATTERNS.some((p) => parentClass.includes(p))) return true;
        if (THINKING_CLASS_PATTERNS.some((p) => parentClass.includes(p))) return true;
    }
    return false;
}

export interface NodeRangeInfo {
    node: Node;
    start: number;
    end: number;
}

export interface SlotMatchItem {
    fullMatch: string;
    content: string;
    startIndex: number;
    endIndex: number;
}

export interface ScanTextNodeResult {
    logicalText: string;
    nodeInfos: NodeRangeInfo[];
    matches: SlotMatchItem[];
}

export class SlotDomParser {
    /**
     * 快速判定正文节点是否可能包含合法的占位符起始标记
     */
    public static hasPlaceholder(textNode: HTMLElement, startTag: string): boolean {
        const textContent = textNode.textContent || '';
        return textContent.includes(startTag);
    }

    /**
     * 遍历正文中的有效文本节点，构建逻辑文本与匹配项集合
     */
    public static scanTextNode(
        textNode: HTMLElement,
        startTag: string,
        endTag: string,
        doc: Document = textNode.ownerDocument || document
    ): ScanTextNodeResult {
        const walker = doc.createTreeWalker(
            textNode,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node: Node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName !== 'BR') {
                        return NodeFilter.FILTER_SKIP;
                    }
                    if (node.parentElement?.closest('.da-floor-slot, .st-da-root') || isNodeInCodeOrThinking(node)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const nodeInfos: NodeRangeInfo[] = [];
        let logicalText = '';
        let n: Node | null;

        while ((n = walker.nextNode())) {
            const start = logicalText.length;
            let text = '';
            if (n.nodeType === Node.TEXT_NODE) {
                text = n.textContent || '';
            } else if ((n as Element).tagName === 'BR') {
                text = '\n';
            }
            logicalText += text;
            nodeInfos.push({ node: n, start, end: logicalText.length });
        }

        const pattern = new RegExp(`${escapeRegExp(startTag)}([\\s\\S]*?)${escapeRegExp(endTag)}`, 'g');
        const matches: SlotMatchItem[] = [];
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(logicalText)) !== null) {
            matches.push({
                fullMatch: match[0],
                content: match[1],
                startIndex: match.index,
                endIndex: match.index + match[0].length
            });
        }

        return {
            logicalText,
            nodeInfos,
            matches
        };
    }

    /**
     * 利用 Range 在原始 DOM 树中原位删除占位符并插入插槽元素
     */
    public static replaceMatchWithSlot(
        doc: Document,
        matchItem: SlotMatchItem,
        nodeInfos: NodeRangeInfo[],
        slotElement: HTMLElement
    ): boolean {
        const nodesToProcess = nodeInfos.filter(
            (info) => matchItem.startIndex < info.end && matchItem.endIndex > info.start
        );
        if (nodesToProcess.length === 0) return false;

        const firstNodeInfo = nodesToProcess[0];
        const lastNodeInfo = nodesToProcess[nodesToProcess.length - 1];

        const range = doc.createRange();
        try {
            const startOffset = matchItem.startIndex - firstNodeInfo.start;
            if (firstNodeInfo.node.nodeType === Node.TEXT_NODE) {
                const startLen = firstNodeInfo.node.textContent?.length ?? 0;
                range.setStart(firstNodeInfo.node, Math.min(Math.max(0, startOffset), startLen));
            } else {
                range.setStartBefore(firstNodeInfo.node);
            }

            const endOffset = matchItem.endIndex - lastNodeInfo.start;
            if (lastNodeInfo.node.nodeType === Node.TEXT_NODE) {
                const endLen = lastNodeInfo.node.textContent?.length ?? 0;
                range.setEnd(lastNodeInfo.node, Math.min(Math.max(0, endOffset), endLen));
            } else {
                range.setEndAfter(lastNodeInfo.node);
            }
        } catch (err) {
            console.warn('[SlotDomParser] Range 边界计算异常，跳过此占位符', err);
            return false;
        }

        range.deleteContents();
        range.insertNode(slotElement);

        // 紧邻文本换行轻量规整，消除换行残留
        const prev = slotElement.previousSibling;
        if (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent) {
            if (prev.textContent.endsWith('\n')) {
                prev.textContent = prev.textContent.replace(/\n+$/, '');
            }
        }
        const next = slotElement.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE && next.textContent) {
            if (next.textContent.startsWith('\n')) {
                next.textContent = next.textContent.replace(/^\n+/, '');
            }
        }

        // 段落级收拢与紧凑化
        this.compactEmptyParagraphs(slotElement);

        return true;
    }

    /**
     * 段落级紧凑化与空段落移除：
     * 1. 插槽所属父级 <p> 若除插槽外无其他正文，标记 .da-floor-slot-p 紧凑样式类消除 1em 默认上下间距；
     * 2. 若插槽紧邻的前后兄弟是纯空段落（如 <p><br></p> 或 <p></p>），安全移除以消除空行。
     */
    public static compactEmptyParagraphs(slotElement: HTMLElement): void {
        const parentP = slotElement.closest('p');
        if (!parentP) return;

        // 检查段落除插槽外是否无实际文本内容
        const clone = parentP.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.da-floor-slot').forEach((s) => s.remove());
        if (clone.textContent?.trim() === '') {
            parentP.classList.add('da-floor-slot-p');

            // 检查 parentP 紧邻的前后兄弟是否为纯空段落（由大模型 \n\n 产生的空行）
            const prevP = parentP.previousElementSibling;
            if (prevP && prevP.tagName === 'P' && (prevP.textContent?.trim() === '' || prevP.innerHTML.trim() === '<br>')) {
                prevP.remove();
            }
            const nextP = parentP.nextElementSibling;
            if (nextP && nextP.tagName === 'P' && (nextP.textContent?.trim() === '' || nextP.innerHTML.trim() === '<br>')) {
                nextP.remove();
            }
        }
    }

    /**
     * 清理超出有效索引范围或失效的插槽
     */
    public static cleanStaleSlots(
        textNode: HTMLElement,
        isValidSlot: (slotIndex: number) => boolean,
        onRemoveSlot?: (slot: HTMLElement) => void
    ): void {
        const currentSlots = Array.from(textNode.querySelectorAll<HTMLElement>('.da-floor-slot'));
        for (const slot of currentSlots) {
            const idx = parseInt(slot.dataset.slotIndex || '0', 10);
            if (!isValidSlot(idx)) {
                if (onRemoveSlot) {
                    onRemoveSlot(slot);
                }
                slot.remove();
            }
        }
    }
}
