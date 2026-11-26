/**
 * 楼层装饰纯辅助函数集合 (FloorHelpers)。
 *
 * @remarks
 * 从 MessageDecorator 中抽离无实例状态依赖的纯计算、资产预校验与 DOM 指令节点替换逻辑，
 * 以便独立进行单元测试并保持主控制器聚焦于事件调度与交互生命周期。
 */

import type { promptPipeline } from '../../pipeline/prompt-pipeline';
import { settingsStore } from '../../store/settings-store';

type ExtractedFloorCommand = ReturnType<typeof promptPipeline.extractCommands>[number];

const IGNORED_FLOOR_CONTAINER_TAGS = new Set(['CODE', 'PRE', 'DETAILS']);
const NON_TEXT_VISIBLE_TAGS = new Set([
    'IMG',
    'SVG',
    'VIDEO',
    'AUDIO',
    'CANVAS',
    'BUTTON',
    'INPUT',
    'TEXTAREA',
]);

function isInsideIgnoredFloorNode(node: Node, root: HTMLElement): boolean {
    let cur: Node | null = node.parentNode;
    while (cur && cur !== root) {
        if (cur instanceof Element) {
            if (
                IGNORED_FLOOR_CONTAINER_TAGS.has(cur.tagName) ||
                cur.classList.contains('da-floor-slot') ||
                cur.classList.contains('da-floor-archive-badges')
            ) {
                return true;
            }
        }
        cur = cur.parentNode;
    }
    return false;
}

function createFloorSlotElement(instructionIndex: number): HTMLElement {
    const slotElement = document.createElement('div');
    slotElement.className = 'da-floor-slot';
    slotElement.setAttribute('data-instruction-index', String(instructionIndex));
    return slotElement;
}

function resolveCommandTagPair(cmd: ExtractedFloorCommand): { startTag: string; endTag: string } {
    const settings = settingsStore.getSettings();
    const cfgStart = (settings?.promptStartTag || 'image###').trim() || 'image###';
    const cfgEnd = (settings?.promptEndTag || '###').trim() || '###';
    if (cmd.rawMatch.trimStart().toLowerCase().startsWith(cfgStart.toLowerCase())) {
        return { startTag: cfgStart, endTag: cfgEnd };
    }
    return { startTag: 'image###', endTag: '###' };
}

function collectEligibleTextSpans(
    container: HTMLElement
): { spans: Array<{ node: Text; start: number; end: number }>; concat: string } {
    const spans: Array<{ node: Text; start: number; end: number }> = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let offset = 0;
    const chunks: string[] = [];

    while (true) {
        const node = walker.nextNode() as Text | null;
        if (!node) break;
        if (isInsideIgnoredFloorNode(node, container)) {
            continue;
        }
        const value = node.nodeValue || '';
        if (!value) {
            continue;
        }
        spans.push({ node, start: offset, end: offset + value.length });
        chunks.push(value);
        offset += value.length;
    }

    return { spans, concat: chunks.join('') };
}

function normalizePromptCompareText(raw: string): string {
    return (raw || '')
        .replace(/^\s*[-*+>]\s+/gm, '')
        .replace(/^\s*#{1,6}\s+/gm, '')
        .replace(/\s+/g, '')
        .toLowerCase();
}

function containsNonSlotVisibleContent(node: Node, slotElement: HTMLElement): boolean {
    if (node === slotElement) {
        return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {
        return Boolean((node.nodeValue || '').trim());
    }
    if (node instanceof Element) {
        if (
            NON_TEXT_VISIBLE_TAGS.has(node.tagName) ||
            node.classList.contains('da-floor-slot') ||
            node.classList.contains('da-floor-archive-badges')
        ) {
            return true;
        }
        for (let i = 0; i < node.childNodes.length; i++) {
            if (containsNonSlotVisibleContent(node.childNodes[i], slotElement)) {
                return true;
            }
        }
    }
    return false;
}

function collectTouchedAncestors(node: Node, root: HTMLElement): Element[] {
    const list: Element[] = [];
    let cur = node.parentNode;
    while (cur && cur !== root) {
        if (cur instanceof Element) {
            list.push(cur);
        }
        cur = cur.parentNode;
    }
    return list;
}

function trimAdjacentBreakNodes(parent: Node | null, anchor: Node, direction: 'after' | 'before'): void {
    if (!parent) return;
    let cursor = direction === 'after' ? anchor.nextSibling : anchor.previousSibling;
    while (cursor) {
        const next = direction === 'after' ? cursor.nextSibling : cursor.previousSibling;
        if (cursor.nodeType === Node.TEXT_NODE && !(cursor.nodeValue || '').trim()) {
            parent.removeChild(cursor);
            cursor = next;
            continue;
        }
        if (cursor instanceof Element && cursor.tagName === 'BR') {
            parent.removeChild(cursor);
            cursor = next;
            continue;
        }
        break;
    }
}

function tryReplaceAcrossDomNodes(
    container: HTMLElement,
    cmd: ExtractedFloorCommand
): HTMLElement | null {
    const { spans, concat } = collectEligibleTextSpans(container);
    if (spans.length === 0 || !concat) {
        return null;
    }

    const { startTag, endTag } = resolveCommandTagPair(cmd);
    const lowerConcat = concat.toLowerCase();
    const lowerStart = startTag.toLowerCase();
    const lowerEnd = endTag.toLowerCase();

    const candidates: Array<{ sPos: number; eEnd: number; body: string }> = [];
    let cursor = 0;
    while (cursor < lowerConcat.length) {
        const sPos = lowerConcat.indexOf(lowerStart, cursor);
        if (sPos === -1) break;
        const bodyStart = sPos + lowerStart.length;
        const ePos = lowerConcat.indexOf(lowerEnd, bodyStart);
        if (ePos === -1) break;
        const nestedStart = lowerConcat.indexOf(lowerStart, bodyStart);
        if (nestedStart !== -1 && nestedStart < ePos) {
            cursor = nestedStart;
            continue;
        }
        candidates.push({
            sPos,
            eEnd: ePos + lowerEnd.length,
            body: concat.slice(bodyStart, ePos),
        });
        cursor = ePos + lowerEnd.length;
    }

    if (candidates.length === 0) {
        return null;
    }

    const targetPromptText =
        typeof cmd.promptText === 'string'
            ? cmd.promptText
            : ((cmd as { rawPrompt?: string }).rawPrompt ?? '');
    const normalizedTarget = normalizePromptCompareText(targetPromptText);
    const chosen =
        candidates.find((c) => {
            if (!normalizedTarget) return true;
            const normBody = normalizePromptCompareText(c.body);
            return normBody === normalizedTarget || normBody.startsWith(normalizedTarget.slice(0, 24));
        }) || candidates[0];

    const startSpanIdx = spans.findIndex((s) => chosen.sPos >= s.start && chosen.sPos < s.end);
    const endSpanIdx = spans.findIndex((s) => chosen.eEnd - 1 >= s.start && chosen.eEnd - 1 < s.end);
    if (startSpanIdx === -1 || endSpanIdx === -1) {
        return null;
    }

    const startSpan = spans[startSpanIdx];
    const endSpan = spans[endSpanIdx];
    const startLocal = chosen.sPos - startSpan.start;
    const endLocal = chosen.eEnd - endSpan.start;
    const slotElement = createFloorSlotElement(cmd.instructionIndex);

    if (startSpanIdx === endSpanIdx) {
        const node = startSpan.node;
        const val = node.nodeValue || '';
        const fragment = document.createDocumentFragment();
        const beforeText = val.slice(0, startLocal);
        const afterText = val.slice(endLocal);
        if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
        fragment.appendChild(slotElement);
        if (afterText) fragment.appendChild(document.createTextNode(afterText));
        node.parentNode?.replaceChild(fragment, node);
        return slotElement;
    }

    // 跨多个 DOM 节点（如 Markdown 拆出的多段 <p> / <br> / <ul><li>）：先收集受影响祖先再清文本并剪除空壳
    const touchedSet = new Set<Element>();
    const touchedOrdered: Element[] = [];
    for (let i = startSpanIdx; i <= endSpanIdx; i++) {
        for (const anc of collectTouchedAncestors(spans[i].node, container)) {
            if (!touchedSet.has(anc)) {
                touchedSet.add(anc);
                touchedOrdered.push(anc);
            }
        }
    }

    const startNode = startSpan.node;
    const endNode = endSpan.node;
    startNode.nodeValue = (startNode.nodeValue || '').slice(0, startLocal);
    startNode.parentNode?.insertBefore(slotElement, startNode.nextSibling);

    for (let i = startSpanIdx + 1; i < endSpanIdx; i++) {
        spans[i].node.nodeValue = '';
    }
    endNode.nodeValue = (endNode.nodeValue || '').slice(endLocal);

    trimAdjacentBreakNodes(slotElement.parentNode, slotElement, 'after');
    trimAdjacentBreakNodes(endNode.parentNode, endNode, 'before');

    for (const ancestor of touchedOrdered) {
        if (!container.contains(ancestor)) continue;
        if (!containsNonSlotVisibleContent(ancestor, slotElement)) {
            if (ancestor.contains(slotElement)) {
                ancestor.parentNode?.insertBefore(slotElement, ancestor);
            }
            ancestor.remove();
        }
    }

    return slotElement;
}

/**
 * 将消息文本节点中的生图指令标记替换为 `.da-floor-slot` 挂载容器节点。
 *
 * @param container 消息文本宿主 DOM 容器 (.mes_text)
 * @param commands 已提取的生图指令列表
 * @returns instructionIndex 到容器 DOM 节点的映射
 */
export function replaceCommandsWithFloorSlots(
    container: HTMLElement,
    commands: ExtractedFloorCommand[]
): Map<number, HTMLElement> {
    const slotsMap = new Map<number, HTMLElement>();
    if (!container || commands.length === 0) {
        return slotsMap;
    }

    // 先检查是否已有现成容器
    for (const cmd of commands) {
        const existing = container.querySelector(
            `.da-floor-slot[data-instruction-index="${cmd.instructionIndex}"]`
        ) as HTMLElement | null;
        if (existing) {
            slotsMap.set(cmd.instructionIndex, existing);
        }
    }

    // 若全部容器已就绪，直接返回
    if (slotsMap.size === commands.length) {
        return slotsMap;
    }

    for (const cmd of commands) {
        if (slotsMap.has(cmd.instructionIndex)) {
            continue;
        }

        // 每次动态重新遍历纯文本节点，避免多指令切分导致脱落节点的 DOMException
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        let targetTextNode: Text | null = null;
        let matchIndex = -1;
        let matchLength = cmd.rawMatch.length;

        while (true) {
            const node = walker.nextNode() as Text | null;
            if (!node) {
                break;
            }
            if (isInsideIgnoredFloorNode(node, container)) {
                continue;
            }
            const content = node.nodeValue || '';
            const idx = content.indexOf(cmd.rawMatch);
            if (idx !== -1) {
                targetTextNode = node;
                matchIndex = idx;
                matchLength = cmd.rawMatch.length;
                break;
            }
        }

        // 若完整 rawMatch 遇到换行或空格在 Markdown 渲染中被规范化，先尝试在单节点内用宽松空白正则匹配
        if (!targetTextNode) {
            const tokens = cmd.rawMatch.trim().split(/\s+/).filter(Boolean);
            if (tokens.length > 0) {
                const looseRegex = new RegExp(
                    tokens.map((t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
                );
                const looseWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
                while (true) {
                    const node = looseWalker.nextNode() as Text | null;
                    if (!node) break;
                    if (isInsideIgnoredFloorNode(node, container)) {
                        continue;
                    }
                    const content = node.nodeValue || '';
                    const m = looseRegex.exec(content);
                    if (m && m.index !== undefined) {
                        targetTextNode = node;
                        matchIndex = m.index;
                        matchLength = m[0].length;
                        break;
                    }
                }
            }
        }

        if (targetTextNode && targetTextNode.parentNode && matchIndex !== -1) {
            const parentNode = targetTextNode.parentNode;
            const textContent = targetTextNode.nodeValue || '';
            const beforeText = textContent.substring(0, matchIndex);
            const afterText = textContent.substring(matchIndex + matchLength);
            const slotElement = createFloorSlotElement(cmd.instructionIndex);

            const fragment = document.createDocumentFragment();
            if (beforeText) {
                fragment.appendChild(document.createTextNode(beforeText));
            }
            fragment.appendChild(slotElement);
            if (afterText) {
                fragment.appendChild(document.createTextNode(afterText));
            }

            parentNode.replaceChild(fragment, targetTextNode);
            slotsMap.set(cmd.instructionIndex, slotElement);
            continue;
        }

        // 当指令内包含多行/空行或列表而被宿主 Markdown 拆分为多节点时，执行跨节点匹配与空容器回收
        const crossNodeSlot = tryReplaceAcrossDomNodes(container, cmd);
        if (crossNodeSlot) {
            slotsMap.set(cmd.instructionIndex, crossNodeSlot);
        }
    }

    return slotsMap;
}
