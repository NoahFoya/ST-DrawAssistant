/**
 * 标签输入联想与宏语法状态反馈组件 (TagAutocomplete)。
 *
 * @remarks
 * 支持两种防循环嵌套工作模式：
 * 1. `lexicon-only`（素材库专用）：
 *    - 仅检索浏览器 IndexedDB 本地词库（「自定义词汇」+「已启用导入词汇文件」）；
 *    - 禁止触发 `$` 素材宏联想，并在失焦或补全时自动剥离任何 `$...$` 宏标记，防止素材词条循环嵌套。
 * 2. `prompt-with-macro`（生图提示词编辑框与重绘面板专用）：
 *    - 同时支持本地词库联想与 `$` 素材宏（含 `$ID-补充字段$` 链式后缀）补全；
 *    - 在编辑框下方实时渲染宏调用状态胶囊栏（区分已生效宏与未匹配/未知后缀宏）。
 * 3. 键盘事件隔离：
 *    - 候选浮层展开时按 `Escape` 仅收起浮层并阻止事件冒泡，不误关外层弹窗。
 */

import type { Disposable } from '../types';
import {
    lexiconIndexService,
    type LexiconIndexService,
    type LexiconCandidateItem,
} from '../../pipeline/lexicon-index-service';
import {
    stripNestedMacroTokens,
    searchMaterialMacros,
    inspectPromptMacros,
} from '../../pipeline/macro-resolver';
import { eventBus } from '../../util/event-bus';
import { computeAnchoredPosition, viewportService } from '../layout/viewport';

/** 编辑框联想工作模式 */
export type TagAutocompleteMode = 'lexicon-only' | 'prompt-with-macro';

/** 联想组件配置项 */
export interface TagAutocompleteOptions {
    /** 联想模式：素材库用 'lexicon-only'，生图编辑框用 'prompt-with-macro' */
    readonly mode: TagAutocompleteMode;
    /** 候选列表最大展示条数（默认 15） */
    readonly limit?: number;
    /** 可选自定义检索服务实例（默认使用全局 lexiconIndexService） */
    readonly indexService?: LexiconIndexService;
    /** 选中候选词并完成回填后的可选回调 */
    readonly onSelect?: (item: LexiconCandidateItem, newValue: string) => void;
}

/** 光标处提取出的当前输入片段信息 */
export interface CursorTokenRange {
    /** 当前片段文本（去除首尾空白） */
    readonly token: string;
    /** 片段在原字符串中的起始替换索引 */
    readonly replaceStart: number;
    /** 片段在原字符串中的结束替换索引 */
    readonly replaceEnd: number;
}

const attachedInstances = new WeakMap<HTMLElement, TagAutocomplete>();

/**
 * 提取光标所在位置的当前逗号分隔词条或 `$宏` 片段。
 */
export function extractTokenAtCursor(
    text: string,
    cursorPos: number,
): CursorTokenRange {
    const safeText = text || '';
    const pos = Math.max(0, Math.min(cursorPos, safeText.length));

    // 1. 向前查找最近的分隔符（英文逗号、中文逗号、换行）
    let segStart = 0;
    for (let i = pos - 1; i >= 0; i--) {
        const ch = safeText[i];
        if (ch === ',' || ch === '，' || ch === '\n' || ch === '\r') {
            segStart = i + 1;
            break;
        }
    }

    // 跳过分隔符后的前导空格与制表符
    while (
        segStart < pos &&
        (safeText[segStart] === ' ' || safeText[segStart] === '\t')
    ) {
        segStart++;
    }

    // 若片段中存在未闭合的 '$'（例如在空格后输入 $ranran），以最后一个未配对 '$' 作为起点
    const sliceBeforeCursor = safeText.slice(segStart, pos);
    const dollarCount = (sliceBeforeCursor.match(/\$/g) || []).length;
    if (dollarCount % 2 === 1) {
        const lastDollarOffset = sliceBeforeCursor.lastIndexOf('$');
        if (lastDollarOffset > 0) {
            segStart += lastDollarOffset;
        }
    }

    // 2. 向后查找当前词条的结束边界
    let segEnd = pos;
    while (segEnd < safeText.length) {
        const ch = safeText[segEnd];
        if (ch === ',' || ch === '，' || ch === '\n' || ch === '\r') {
            break;
        }
        segEnd++;
    }

    const token = safeText.slice(segStart, pos).trim();
    return {
        token,
        replaceStart: segStart,
        replaceEnd: segEnd,
    };
}

/**
 * 标签输入联想与宏状态反馈控制器。
 */
export class TagAutocomplete implements Disposable {
    public readonly target: HTMLInputElement | HTMLTextAreaElement;
    public readonly mode: TagAutocompleteMode;

    private readonly _limit: number;
    private readonly _indexService: LexiconIndexService;
    private readonly _onSelect?: (item: LexiconCandidateItem, newValue: string) => void;

    private _popupEl: HTMLDivElement | null = null;
    private _statusBarEl: HTMLDivElement | null = null;
    private _candidates: LexiconCandidateItem[] = [];
    private _activeIndex = 0;
    private _isOpen = false;
    private _disposed = false;
    private _queryDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private _blurTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly _disposers: Array<() => void> = [];

    public constructor(
        target: HTMLInputElement | HTMLTextAreaElement,
        options: TagAutocompleteOptions,
    ) {
        this.target = target;
        this.mode = options.mode;
        this._limit = options.limit ?? 15;
        this._indexService = options.indexService ?? lexiconIndexService;
        this._onSelect = options.onSelect;

        this._initPopupDom();
        if (this.mode === 'prompt-with-macro') {
            this._initMacroStatusBar();
        }
        this._bindEvents();

        // 预热本地词库索引
        void this._indexService.ensureLoaded().then(() => {
            if (!this._disposed && this.mode === 'prompt-with-macro') {
                this.refreshMacroStatus();
            }
        });
    }

    /**
     * 当前候选浮层是否处于展开状态。
     */
    public isPopupOpen(): boolean {
        return this._isOpen;
    }

    /**
     * 获取当前展示的候选列表快照。
     */
    public getCandidates(): readonly LexiconCandidateItem[] {
        return this._candidates;
    }

    /**
     * 刷新编辑框下方的 `$宏$` 调用状态胶囊栏（仅 `prompt-with-macro` 模式生效）。
     */
    public refreshMacroStatus(): void {
        if (this.mode !== 'prompt-with-macro') {
            return;
        }
        this._ensureStatusBarMounted();
        if (!this._statusBarEl) {
            return;
        }

        const diagnostics = inspectPromptMacros(this.target.value || '');
        if (diagnostics.length === 0) {
            this._statusBarEl.style.display = 'none';
            this._statusBarEl.innerHTML = '';
            return;
        }

        this._statusBarEl.style.display = 'flex';
        this._statusBarEl.innerHTML = '';

        const titleEl = document.createElement('span');
        titleEl.className = 'da-macro-status-bar__title';
        titleEl.textContent = '宏状态:';
        this._statusBarEl.appendChild(titleEl);

        for (const diag of diagnostics) {
            const chip = document.createElement('span');
            let statusModifier = 'da-macro-status-chip--invalid';
            let labelText = `✕ ${diag.rawToken} (未生效)`;

            if (diag.status === 'active') {
                statusModifier = 'da-macro-status-chip--active da-macro-status-chip--valid';
                labelText = `✓ ${diag.rawToken}${diag.materialName ? ` (${diag.materialName})` : ''}`;
            } else if (diag.status === 'inactive') {
                statusModifier = 'da-macro-status-chip--inactive da-macro-status-chip--valid';
                labelText = `⚠ ${diag.rawToken}${diag.materialName ? ` (${diag.materialName}·未启用)` : ' (未启用)'}`;
            }

            chip.className = `da-macro-status-chip ${statusModifier}`;
            chip.textContent = labelText;
            chip.title = diag.expandedTags
                ? `${diag.reason}\n展开 Tags: ${diag.expandedTags}`
                : diag.reason;
            this._statusBarEl.appendChild(chip);
        }
    }

    /**
     * 收起候选浮层。
     */
    public closePopup(): void {
        this._isOpen = false;
        this._candidates = [];
        this._activeIndex = 0;
        if (this._popupEl) {
            this._popupEl.classList.remove('da-autocomplete-popup--open');
            this._popupEl.innerHTML = '';
        }
    }

    /**
     * 销毁联想实例并移除浮层 DOM 与事件监听。
     */
    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this.closePopup();

        if (this._queryDebounceTimer) {
            clearTimeout(this._queryDebounceTimer);
            this._queryDebounceTimer = null;
        }
        if (this._blurTimer) {
            clearTimeout(this._blurTimer);
            this._blurTimer = null;
        }

        for (const fn of this._disposers) {
            try {
                fn();
            } catch {
                // 忽略解绑异常
            }
        }
        this._disposers.length = 0;

        if (this._popupEl && this._popupEl.parentNode) {
            this._popupEl.parentNode.removeChild(this._popupEl);
        }
        this._popupEl = null;

        if (this._statusBarEl && this._statusBarEl.parentNode) {
            this._statusBarEl.parentNode.removeChild(this._statusBarEl);
        }
        this._statusBarEl = null;

        attachedInstances.delete(this.target);
    }

    private _initPopupDom(): void {
        if (typeof document === 'undefined') {
            return;
        }
        const popup = document.createElement('div');
        popup.className = 'da-autocomplete-popup st-da-root';
        popup.setAttribute('role', 'listbox');
        document.body.appendChild(popup);
        this._popupEl = popup;
    }

    private _initMacroStatusBar(): void {
        if (typeof document === 'undefined') {
            return;
        }
        const bar = document.createElement('div');
        bar.className = 'da-macro-status-bar';
        bar.style.display = 'none';
        this._statusBarEl = bar;
        this._ensureStatusBarMounted();
        this.refreshMacroStatus();
    }

    private _ensureStatusBarMounted(): void {
        if (!this._statusBarEl || !this.target.parentNode) {
            return;
        }
        // 若目标输入框被包含在双层镜像编辑器容器中，将状态栏挂载到外层容器外部同级，防止污染双层结构
        const highlightWrapper = this.target.closest?.('.da-highlight-editor');
        const mountParent = highlightWrapper?.parentNode || this.target.parentNode;
        const refNode = highlightWrapper ? highlightWrapper.nextSibling : this.target.nextSibling;

        if (this._statusBarEl.parentNode !== mountParent || this._statusBarEl.nextSibling !== refNode) {
            mountParent.insertBefore(this._statusBarEl, refNode);
        }
    }

    private _bindEvents(): void {
        let isComposing = false;

        const onCompositionStart = () => {
            isComposing = true;
        };

        const onCompositionEnd = () => {
            isComposing = false;
            onInput();
        };

        const onInput = () => {
            if (isComposing) {
                return;
            }
            if (this.mode === 'prompt-with-macro') {
                this.refreshMacroStatus();
            }
            // 80ms 微防抖：快速连击时不反复触发全量检索
            if (this._queryDebounceTimer) {
                clearTimeout(this._queryDebounceTimer);
            }
            this._queryDebounceTimer = setTimeout(() => {
                if (!this._disposed) {
                    this._handleQueryUpdate();
                }
            }, 80);
        };

        const onKeyDown = (rawEvent: Event) => {
            const e = rawEvent as KeyboardEvent;
            // 处于中文输入法组合拼音阶段时放行全部按键（含 Enter/Space），避免劫持输入法选词
            if (e.isComposing || isComposing || e.keyCode === 229) {
                return;
            }

            if (!this._isOpen || this._candidates.length === 0) {
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                this._activeIndex = (this._activeIndex + 1) % this._candidates.length;
                this._renderCandidates();
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                this._activeIndex =
                    (this._activeIndex - 1 + this._candidates.length) %
                    this._candidates.length;
                this._renderCandidates();
                return;
            }

            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                this._applyCandidate(this._activeIndex);
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.closePopup();
            }
        };

        const onBlur = () => {
            // 在 lexicon-only 模式下，失焦时自动剥离可能手动粘贴的 $...$ 宏，防止循环嵌套
            if (this.mode === 'lexicon-only' && this.target.value.includes('$')) {
                const cleaned = stripNestedMacroTokens(this.target.value);
                if (cleaned !== this.target.value) {
                    this.target.value = cleaned;
                    this.target.dispatchEvent(new Event('input', { bubbles: true }));
                    this.target.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            if (this._blurTimer) {
                clearTimeout(this._blurTimer);
            }
            this._blurTimer = setTimeout(() => {
                this._blurTimer = null;
                if (!this._disposed) {
                    this.closePopup();
                }
            }, 120);
        };

        this.target.addEventListener('compositionstart', onCompositionStart);
        this.target.addEventListener('compositionend', onCompositionEnd);
        this.target.addEventListener('input', onInput);
        this.target.addEventListener('keydown', onKeyDown, true);
        this.target.addEventListener('blur', onBlur);

        const onDocMouseDown = (e: MouseEvent) => {
            if (!this._isOpen) return;
            const clickTarget = e.target as Node | null;
            if (
                clickTarget &&
                !this.target.contains(clickTarget) &&
                !this._popupEl?.contains(clickTarget)
            ) {
                this.closePopup();
            }
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('mousedown', onDocMouseDown, true);
            this._disposers.push(() => {
                document.removeEventListener('mousedown', onDocMouseDown, true);
            });
        }

        const onScrollCapture = (e: Event) => {
            if (!this._isOpen) return;
            // 忽略浮层内部列表自身滚动，防止触控滑动选词时误收起
            if (e.target === this._popupEl || this._popupEl?.contains(e.target as Node)) {
                return;
            }
            this._positionPopup();
        };

        const unbindViewport = viewportService.subscribe(() => {
            if (this._isOpen) {
                this._positionPopup();
            }
        });

        if (typeof window !== 'undefined') {
            window.addEventListener('scroll', onScrollCapture, true);
            this._disposers.push(() => {
                window.removeEventListener('scroll', onScrollCapture, true);
            });
        }
        this._disposers.push(unbindViewport);

        this._disposers.push(() => {
            this.target.removeEventListener('compositionstart', onCompositionStart);
            this.target.removeEventListener('compositionend', onCompositionEnd);
            this.target.removeEventListener('input', onInput);
            this.target.removeEventListener('keydown', onKeyDown, true);
            this.target.removeEventListener('blur', onBlur);
        });

        if (this.mode === 'prompt-with-macro') {
            const unlistenSettings = eventBus.on('settings:updated', () => {
                this.refreshMacroStatus();
            });
            this._disposers.push(unlistenSettings);
        }
    }

    private _handleQueryUpdate(): void {
        const cursor =
            typeof this.target.selectionStart === 'number'
                ? this.target.selectionStart
                : this.target.value.length;

        const { token } = extractTokenAtCursor(this.target.value, cursor);
        if (!token) {
            this.closePopup();
            return;
        }

        // 1. 以 '$' 开头的输入片段：仅在 prompt-with-macro 模式下触发素材宏联想
        if (token.startsWith('$')) {
            if (this.mode === 'lexicon-only') {
                this.closePopup();
                return;
            }
            const macroItems = searchMaterialMacros(
                token,
                undefined,
                this._limit,
            );
            this._updatePopupWithCandidates(macroItems);
            return;
        }

        // 2. 普通中英词条输入片段：检索本地词库
        void this._indexService.ensureLoaded().then(() => {
            if (this._disposed) return;
            const currentCursor =
                typeof this.target.selectionStart === 'number'
                    ? this.target.selectionStart
                    : this.target.value.length;
            const latest = extractTokenAtCursor(this.target.value, currentCursor);
            if (!latest.token || latest.token.startsWith('$')) {
                return;
            }
            const lexiconItems = this._indexService.searchLexicon(
                latest.token,
                this._limit,
            );
            this._updatePopupWithCandidates(lexiconItems);
        });
    }

    private _updatePopupWithCandidates(items: LexiconCandidateItem[]): void {
        if (!items || items.length === 0) {
            this.closePopup();
            return;
        }
        this._candidates = items;
        this._activeIndex = 0;
        this._isOpen = true;
        this._positionPopup();
        this._renderCandidates();
    }

    private _positionPopup(): void {
        if (!this._popupEl || typeof window === 'undefined') {
            return;
        }
        const rect = this.target.getBoundingClientRect();
        const desiredWidth = Math.max(220, Math.min(460, rect.width || 300));
        const pos = computeAnchoredPosition({
            anchorRect: rect,
            floatingWidth: desiredWidth,
            floatingHeight: 220,
            preferredPlacement: 'bottom',
            align: 'start',
            gap: 4,
            margin: 8,
        });

        this._popupEl.style.width = `${Math.min(desiredWidth, pos.maxWidth)}px`;
        this._popupEl.style.maxHeight = `${Math.min(240, pos.maxHeight)}px`;
        this._popupEl.style.left = `${pos.left}px`;
        this._popupEl.style.top = `${pos.top}px`;
        this._popupEl.classList.add('da-autocomplete-popup--open');
    }

    private _renderCandidates(): void {
        if (!this._popupEl) {
            return;
        }
        this._popupEl.innerHTML = '';

        this._candidates.forEach((item, idx) => {
            const row = document.createElement('div');
            const isMacro =
                item.kind === 'material-macro' || item.kind === 'material-suffix';
            row.className = `da-autocomplete-item${
                idx === this._activeIndex ? ' is-active' : ''
            }${isMacro ? ' da-autocomplete-item--macro' : ''}`;
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(idx === this._activeIndex));

            const main = document.createElement('div');
            main.className = 'da-autocomplete-item__main';

            const labelEl = document.createElement('span');
            labelEl.className = 'da-autocomplete-item__label';
            labelEl.textContent = item.label;
            main.appendChild(labelEl);

            if (item.subLabel) {
                const subEl = document.createElement('span');
                subEl.className = 'da-autocomplete-item__sub';
                subEl.textContent = item.subLabel;
                main.appendChild(subEl);
            }

            const meta = document.createElement('div');
            meta.className = 'da-autocomplete-item__meta';

            if (typeof item.count === 'number' && item.count > 0) {
                const countEl = document.createElement('span');
                countEl.className = 'da-autocomplete-item__count';
                countEl.textContent =
                    item.count >= 1000
                        ? `${(item.count / 1000).toFixed(1)}k`
                        : String(item.count);
                meta.appendChild(countEl);
            }

            const badgeEl = document.createElement('span');
            badgeEl.className = 'da-autocomplete-item__badge';
            badgeEl.textContent = item.badge;
            meta.appendChild(badgeEl);

            row.appendChild(main);
            row.appendChild(meta);

            // 使用 mousedown preventDefault 避免点击候选时先触发输入框 blur
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._applyCandidate(idx);
            });

            this._popupEl!.appendChild(row);
        });
    }

    private _applyCandidate(index: number): void {
        const candidate = this._candidates[index];
        if (!candidate) {
            return;
        }

        const rawValue = this.target.value || '';
        const cursor =
            typeof this.target.selectionStart === 'number'
                ? this.target.selectionStart
                : rawValue.length;

        const { replaceStart, replaceEnd } = extractTokenAtCursor(rawValue, cursor);
        const safeInsert =
            this.mode === 'lexicon-only'
                ? stripNestedMacroTokens(candidate.insertText)
                : candidate.insertText;

        const prefix = rawValue.slice(0, replaceStart);
        const suffix = rawValue.slice(replaceEnd);
        const trimmedSuffix = suffix.trimStart();

        const needsComma =
            trimmedSuffix.length === 0 ||
            (!trimmedSuffix.startsWith(',') && !trimmedSuffix.startsWith('，'));

        const insertedSegment = needsComma ? `${safeInsert}, ` : safeInsert;
        const nextValue = `${prefix}${insertedSegment}${suffix}`;
        const nextCursor = prefix.length + insertedSegment.length;

        this.target.value = nextValue;
        try {
            this.target.setSelectionRange(nextCursor, nextCursor);
        } catch {
            // 部分 input 类型不支持 setSelectionRange 时忽略
        }

        this.closePopup();
        this.target.dispatchEvent(new Event('input', { bubbles: true }));
        this.target.dispatchEvent(new Event('change', { bubbles: true }));

        if (this.mode === 'prompt-with-macro') {
            this.refreshMacroStatus();
        }
        this._onSelect?.(candidate, nextValue);
    }
}

/**
 * 为单个输入框或文本域挂载标签联想组件（同一元素重复调用时复用已有实例）。
 */
export function attachTagAutocomplete(
    target: HTMLInputElement | HTMLTextAreaElement,
    options: TagAutocompleteOptions,
): TagAutocomplete {
    const existing = attachedInstances.get(target);
    if (existing) {
        return existing;
    }
    const instance = new TagAutocomplete(target, options);
    attachedInstances.set(target, instance);
    return instance;
}

/**
 * 在容器节点上通过事件委托为匹配选择器的一切输入控件动态挂载标签联想（适用于 Preact 动态列表）。
 */
export function bindDelegatedTagAutocomplete(
    container: HTMLElement,
    selector: string,
    options: TagAutocompleteOptions,
): Disposable {
    const created = new Set<TagAutocomplete>();

    const ensureForTarget = (rawTarget: EventTarget | null) => {
        // 自动清理已被 DOM 树移除的陈旧实例，防止内存驻留与浮层残留
        for (const inst of created) {
            if (!inst.target.isConnected) {
                inst.dispose();
                created.delete(inst);
            }
        }

        if (
            !(rawTarget instanceof HTMLInputElement) &&
            !(rawTarget instanceof HTMLTextAreaElement)
        ) {
            return;
        }
        if (!rawTarget.matches(selector)) {
            return;
        }
        if (!attachedInstances.has(rawTarget)) {
            const inst = attachTagAutocomplete(rawTarget, options);
            created.add(inst);
        }
    };

    const onFocusIn = (e: FocusEvent) => {
        ensureForTarget(e.target);
    };

    const onInputCapture = (e: Event) => {
        ensureForTarget(e.target);
    };

    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('input', onInputCapture, true);

    return {
        dispose: () => {
            container.removeEventListener('focusin', onFocusIn);
            container.removeEventListener('input', onInputCapture, true);
            for (const inst of created) {
                inst.dispose();
            }
            created.clear();
        },
    };
}
