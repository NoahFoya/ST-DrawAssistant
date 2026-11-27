/**
 * 楼层 DOM 定位、容器挂载与 MutationObserver 恢复控制器 (`floor-dom-locator.ts`)。
 */

import { matchesFloorSlotScope } from '../../pipeline/floor-coordinator';

export interface ObservedLatestFloorState {
    chatId: string;
    messageId: number;
    swipeId: number;
    mesText: HTMLElement;
    expectedNodes: Set<HTMLElement>;
}

/** 构造楼层插件 DOM 节点清理 CSS 选择器 */
export function buildFloorCleanupSelector(
    scopePrefix: string,
    preserveFloorSlots?: boolean
): string {
    const prefix = scopePrefix ? `${scopePrefix} ` : '';
    const slotSelector = preserveFloorSlots
        ? '.da-floor-slot.da-floor-slot--appended'
        : '.da-floor-slot';
    return [
        '.da-floor-action-wrapper',
        '.da-floor-image-container',
        '.da-floor-image-skeleton',
        '.da-floor-archive-badges',
        slotSelector,
    ]
        .map((sel) => `${prefix}${sel}`)
        .join(', ');
}

/** 获取指定楼层对应的 `.mes` 外壳及其正文挂载容器（`.mes_text` 或回退 `.mes`） */
export function getMessageTextContainer(
    messageId: number
): { messageDom: HTMLElement; mesText: HTMLElement } | null {
    if (typeof document === 'undefined') {
        return null;
    }
    const messageDom = document.querySelector(
        `#chat .mes[mesid="${messageId}"]`
    ) as HTMLElement | null;
    if (!messageDom) {
        return null;
    }
    const mesText = (messageDom.querySelector('.mes_text') || messageDom) as HTMLElement;
    return { messageDom, mesText };
}

/** 动态解析指定楼层与指令序号当前在 DOM 中的活跃插槽元素 */
export function resolveSlotElement(
    messageId: number,
    instructionIndex: number,
    fallbackContainer?: HTMLElement | null
): HTMLElement | null {
    const containerInfo = getMessageTextContainer(messageId);
    if (!containerInfo) {
        return typeof document === 'undefined' ? (fallbackContainer ?? null) : null;
    }
    const { messageDom, mesText } = containerInfo;
    const liveSlot = messageDom.querySelector(
        `.da-floor-slot[data-instruction-index="${instructionIndex}"]`
    ) as HTMLElement | null;
    if (liveSlot) {
        return liveSlot;
    }
    if (
        fallbackContainer &&
        fallbackContainer.isConnected &&
        messageDom.contains(fallbackContainer)
    ) {
        return fallbackContainer;
    }
    return mesText;
}

/** 查找或补偿挂载当前生图指令对应的 `.da-floor-slot` 容器节点 */
export function ensureCommandSlotElement(
    targetContainer: HTMLElement,
    slotsMap: Map<number, HTMLElement>,
    instructionIndex: number,
    suppressObserver: (fn: () => void) => void
): HTMLElement {
    const directSlot = slotsMap.get(instructionIndex);
    if (directSlot) {
        return directSlot;
    }

    let resolved!: HTMLElement;
    // 结构补偿挂载：若正文被外部脚本改写导致指令文本不在正文节点中，则在末尾追加独立容器
    suppressObserver(() => {
        const existing = targetContainer.querySelector(
            `.da-floor-slot[data-instruction-index="${instructionIndex}"]`
        ) as HTMLElement | null;
        if (existing) {
            resolved = existing;
        } else {
            const appended = document.createElement('div');
            appended.className = 'da-floor-slot da-floor-slot--appended';
            appended.setAttribute('data-instruction-index', String(instructionIndex));
            targetContainer.appendChild(appended);
            resolved = appended;
        }
        slotsMap.set(instructionIndex, resolved);
    });
    return resolved;
}

/** 将视觉内容（图片/骨架屏）或交互按钮按展示在前、按钮在后的顺序挂入目标容器 */
export function mountToSlot(
    mountTarget: HTMLElement,
    element: HTMLElement,
    role: 'visual' | 'button'
): void {
    const isStructuredSlot = mountTarget.classList.contains('da-floor-slot');
    if (role === 'visual') {
        if (isStructuredSlot) {
            if (
                !element.isConnected ||
                element.parentElement !== mountTarget ||
                mountTarget.firstElementChild !== element
            ) {
                mountTarget.insertBefore(element, mountTarget.firstChild);
            }
        } else if (!element.isConnected || element.parentElement !== mountTarget) {
            const firstBtn = mountTarget.querySelector(':scope > .da-floor-action-wrapper');
            if (firstBtn) {
                mountTarget.insertBefore(element, firstBtn);
            } else {
                mountTarget.appendChild(element);
            }
        }
        return;
    }

    const hasTrailingVisual = Boolean(
        element.parentElement === mountTarget &&
            element.nextElementSibling &&
            (element.nextElementSibling.classList.contains('da-floor-image-container') ||
                element.nextElementSibling.classList.contains('da-floor-image-skeleton'))
    );
    if (!element.isConnected || element.parentElement !== mountTarget || hasTrailingVisual) {
        mountTarget.appendChild(element);
    }
}

/** 清扫指定楼层 DOM 中可能残留的插件节点 */
export function purgeMessageFloorDom(
    messageId: number,
    suppressObserver: (fn: () => void) => void,
    options?: { preserveFloorSlots?: boolean }
): void {
    if (typeof document === 'undefined') {
        return;
    }
    const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!messageDom) {
        return;
    }
    const selector = buildFloorCleanupSelector('', options?.preserveFloorSlots);
    suppressObserver(() => {
        for (const node of messageDom.querySelectorAll(selector)) {
            node.remove();
        }
    });
}

/** 判断 DOM 节点是否属于插件自身的 `.da-floor-*` 元素 */
function isPluginFloorDomNode(node: Node): boolean {
    if (!(node instanceof Element)) {
        return false;
    }
    for (const cls of node.classList) {
        if (cls.startsWith('da-floor-')) {
            return true;
        }
    }
    return false;
}

/** 判断 MutationRecord 是否全部由插件自身楼层节点引发 */
function isPluginOnlyMutation(mutation: MutationRecord): boolean {
    if (mutation.target instanceof Element && isPluginFloorDomNode(mutation.target)) {
        return true;
    }
    if (mutation.type === 'childList') {
        const changed = [
            ...Array.from(mutation.addedNodes),
            ...Array.from(mutation.removedNodes),
        ];
        return changed.length > 0 && changed.every((n) => isPluginFloorDomNode(n));
    }
    return false;
}

/** 收集重建楼层期间需要临时锁定高度的内联图片插槽 */
export function lockPreviouslyDecoratedSlots(): {
    previouslyDecoratedEls: Set<Element>;
    unlockHeights: () => void;
} {
    const previouslyDecoratedEls = new Set<Element>();
    const lockedSlots: Array<{ slot: HTMLElement; prevMinHeight: string }> = [];

    if (typeof document !== 'undefined') {
        for (const mesEl of document.querySelectorAll('#chat .mes[mesid]')) {
            if (
                mesEl.querySelector(
                    '.da-floor-slot, .da-floor-action-wrapper, .da-floor-image-container, .da-floor-image-skeleton, .da-floor-archive-badges'
                )
            ) {
                previouslyDecoratedEls.add(mesEl);
                for (const slot of mesEl.querySelectorAll<HTMLElement>(
                    '.da-floor-slot:not(.da-floor-slot--appended)'
                )) {
                    if (!slot.querySelector('.da-floor-image-container')) {
                        continue;
                    }
                    const currentHeight = slot.offsetHeight;
                    if (currentHeight > 0) {
                        lockedSlots.push({ slot, prevMinHeight: slot.style.minHeight });
                        slot.setAttribute('data-da-resync-lock', '1');
                        slot.style.minHeight = `${currentHeight}px`;
                    }
                }
            }
        }
    }

    return {
        previouslyDecoratedEls,
        unlockHeights: () => {
            for (const { slot, prevMinHeight } of lockedSlots) {
                slot.removeAttribute('data-da-resync-lock');
                slot.style.minHeight = prevMinHeight;
            }
        },
    };
}

/**
 * 封装最新 AI 楼层 DOM 脱离自动恢复与正文静默稳定性等待监听器。
 */
export class FloorObserverController {
    private latestFloorObserver: MutationObserver | null = null;
    private observedLatestFloor: ObservedLatestFloorState | null = null;
    private observerRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly selfMutatingDepths = new Map<number, number>();
    public readonly stabilityWaitMessages = new Set<number>();

    /** 在自身 DOM 修改期间屏蔽同楼层的 MutationObserver 回调，防止自我触发循环 */
    public runSuppressed(messageId: number, fn: () => void): void {
        const prev = this.selfMutatingDepths.get(messageId) ?? 0;
        this.selfMutatingDepths.set(messageId, prev + 1);
        try {
            fn();
        } finally {
            const next = (this.selfMutatingDepths.get(messageId) ?? 1) - 1;
            if (next <= 0) {
                this.latestFloorObserver?.takeRecords();
                this.selfMutatingDepths.delete(messageId);
            } else {
                this.selfMutatingDepths.set(messageId, next);
            }
        }
    }

    public getObservedFloor(): ObservedLatestFloorState | null {
        return this.observedLatestFloor;
    }

    public disconnect(): void {
        if (this.observerRecoveryTimer !== null) {
            clearTimeout(this.observerRecoveryTimer);
            this.observerRecoveryTimer = null;
        }
        if (this.latestFloorObserver) {
            this.latestFloorObserver.disconnect();
            this.latestFloorObserver = null;
        }
        this.observedLatestFloor = null;
    }

    public clearAllState(): void {
        this.disconnect();
        this.stabilityWaitMessages.clear();
        this.selfMutatingDepths.clear();
    }

    public collectExpectedNodes(
        mesText: HTMLElement,
        chatId: string,
        messageId: number,
        swipeId: number,
        elementGroups: Array<Map<string, HTMLElement>>
    ): Set<HTMLElement> {
        const nodes = new Set<HTMLElement>();
        for (const el of mesText.querySelectorAll('.da-floor-slot, .da-floor-archive-badges')) {
            nodes.add(el as HTMLElement);
        }
        for (const map of elementGroups) {
            for (const [key, el] of map.entries()) {
                if (matchesFloorSlotScope(key, chatId, messageId, swipeId) && mesText.contains(el)) {
                    nodes.add(el);
                }
            }
        }
        return nodes;
    }

    public syncExpectedNodesIfTarget(
        messageId: number,
        getElementGroups: () => Array<Map<string, HTMLElement>>
    ): void {
        const observed = this.observedLatestFloor;
        if (!observed || observed.messageId !== messageId) {
            return;
        }
        observed.expectedNodes = this.collectExpectedNodes(
            observed.mesText,
            observed.chatId,
            observed.messageId,
            observed.swipeId,
            getElementGroups()
        );
    }

    public updateLatestFloorObserver(params: {
        chatId: string;
        messageId: number;
        swipeId: number;
        mesText: HTMLElement;
        shouldWatch: boolean;
        getElementGroups: () => Array<Map<string, HTMLElement>>;
        onCheckNeedsRecovery: (observed: ObservedLatestFloorState) => boolean;
        onRecover: (observed: ObservedLatestFloorState) => Promise<void>;
    }): void {
        const {
            chatId,
            messageId,
            swipeId,
            mesText,
            shouldWatch,
            getElementGroups,
            onCheckNeedsRecovery,
            onRecover,
        } = params;

        if (!shouldWatch || typeof MutationObserver === 'undefined') {
            if (this.observedLatestFloor?.messageId === messageId) {
                this.disconnect();
            }
            return;
        }

        const expectedNodes = this.collectExpectedNodes(
            mesText,
            chatId,
            messageId,
            swipeId,
            getElementGroups()
        );
        if (expectedNodes.size === 0) {
            if (this.observedLatestFloor?.messageId === messageId) {
                this.disconnect();
            }
            return;
        }

        if (
            this.latestFloorObserver &&
            this.observedLatestFloor &&
            this.observedLatestFloor.mesText === mesText
        ) {
            this.observedLatestFloor.chatId = chatId;
            this.observedLatestFloor.messageId = messageId;
            this.observedLatestFloor.swipeId = swipeId;
            this.observedLatestFloor.expectedNodes = expectedNodes;
            return;
        }

        this.disconnect();
        const observedState: ObservedLatestFloorState = {
            chatId,
            messageId,
            swipeId,
            mesText,
            expectedNodes,
        };
        this.observedLatestFloor = observedState;

        this.latestFloorObserver = new MutationObserver(() => {
            if (
                this.observedLatestFloor !== observedState ||
                (this.selfMutatingDepths.get(observedState.messageId) ?? 0) > 0
            ) {
                return;
            }
            if (!onCheckNeedsRecovery(observedState)) {
                return;
            }
            if (this.observerRecoveryTimer !== null) {
                clearTimeout(this.observerRecoveryTimer);
            }
            this.observerRecoveryTimer = setTimeout(() => {
                this.observerRecoveryTimer = null;
                void onRecover(observedState);
            }, 0);
        });

        this.latestFloorObserver.observe(mesText, { childList: true, subtree: true });
    }

    /** 等待宿主完成流式生成且目标楼层 DOM 在连续 quietMs 内不再发生外部改写 */
    public async waitForFloorDomStable(
        messageId: number,
        options?: {
            quietMs?: number;
            maxWaitMs?: number;
            signal?: AbortSignal;
            isDisposed?: boolean;
            isAborted?: () => boolean;
            isHostGenerating?: () => boolean;
            waitForGenerationEnd?: () => Promise<void>;
        }
    ): Promise<boolean> {
        const quietMs = options?.quietMs ?? 300;
        const maxWaitMs = options?.maxWaitMs ?? 3000;
        const isAborted = (): boolean =>
            Boolean(options?.isDisposed || options?.signal?.aborted || options?.isAborted?.());

        if (isAborted()) {
            return false;
        }

        const hasDom = typeof document !== 'undefined' && typeof MutationObserver !== 'undefined';
        const messageDom = hasDom
            ? (document.querySelector(`#chat .mes[mesid="${messageId}"]`) as HTMLElement | null)
            : null;
        const hostGenerating = Boolean(options?.isHostGenerating?.());

        if (!messageDom && !hostGenerating) {
            return !isAborted();
        }

        this.stabilityWaitMessages.add(messageId);
        try {
            return await new Promise<boolean>((resolve) => {
                let settled = false;
                let generationFinished = !hostGenerating;
                let quietTimer: ReturnType<typeof setTimeout> | null = null;
                let maxTimer: ReturnType<typeof setTimeout> | null = null;
                let observer: MutationObserver | null = null;

                const cleanup = () => {
                    if (quietTimer !== null) {
                        clearTimeout(quietTimer);
                        quietTimer = null;
                    }
                    if (maxTimer !== null) {
                        clearTimeout(maxTimer);
                        maxTimer = null;
                    }
                    observer?.disconnect();
                    observer = null;
                    options?.signal?.removeEventListener('abort', onAbort);
                };

                const finish = (ok: boolean) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(ok && !isAborted());
                };

                const onAbort = () => finish(false);

                const armQuietTimer = () => {
                    if (settled || !generationFinished) {
                        return;
                    }
                    if (quietTimer !== null) {
                        clearTimeout(quietTimer);
                    }
                    if (!messageDom) {
                        finish(true);
                        return;
                    }
                    quietTimer = setTimeout(() => {
                        quietTimer = null;
                        finish(true);
                    }, quietMs);
                };

                options?.signal?.addEventListener('abort', onAbort, { once: true });

                maxTimer = setTimeout(() => {
                    maxTimer = null;
                    finish(true);
                }, maxWaitMs);

                if (messageDom) {
                    observer = new MutationObserver((mutations) => {
                        if (settled || (this.selfMutatingDepths.get(messageId) ?? 0) > 0) {
                            return;
                        }
                        const hasExternalMutation = mutations.some(
                            (m) => !isPluginOnlyMutation(m)
                        );
                        if (hasExternalMutation) {
                            armQuietTimer();
                        }
                    });
                    observer.observe(messageDom, {
                        childList: true,
                        subtree: true,
                        characterData: true,
                    });
                }

                if (!generationFinished && options?.waitForGenerationEnd) {
                    void options.waitForGenerationEnd().then(() => {
                        if (settled) return;
                        if (isAborted()) {
                            finish(false);
                            return;
                        }
                        generationFinished = true;
                        armQuietTimer();
                    });
                } else {
                    armQuietTimer();
                }
            });
        } finally {
            this.stabilityWaitMessages.delete(messageId);
        }
    }
}
