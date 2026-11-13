/**
 * 酒馆原生世界书按条目勾选导入弹窗与双格式导出弹窗 (WorldbookImportModal)。
 *
 * @remarks
 * 1. 原生世界书导入 (`openWorldbookImportModal`)：
 *    - 完整展示 `parseStWorldbookEntries` 解析出的全部条目（包含 `═══` 分隔线与 `{{//...}}` 注释项，不自动剔除）；
 *    - 支持「全选 / 全不选 / 仅选原启用项」快捷筛选；
 *    - 支持选择「新建为独立预设」或「追加至当前预设」；
 * 2. 双格式选择导出 (`openPromptExportFormatModal`)：
 *    - 支持在「导出为酒馆原生世界书 JSON」与「导出为插件预设 JSON」之间一键选择并触发下载。
 */

import type { Disposable } from '../types';
import type { PromptInjectionEntry, PromptChannelPresetData, PresetItem } from '@types';
import type { ParsedStWorldbookResult } from '../../pipeline/worldbook-converter';
import { exportToStWorldbookJson } from '../../pipeline/worldbook-converter';
import { renderIcon } from '../components/icons';
import { overlayStack } from '../framework/overlay-stack';

/** 原生世界书导入模式 */
export type WorldbookImportApplyMode = 'create_preset' | 'append_current';

/** 原生世界书勾选导入确认结果 */
export interface WorldbookImportConfirmResult {
    /** 导入应用模式 */
    readonly mode: WorldbookImportApplyMode;
    /** 目标预设名称（mode 为 create_preset 时生效） */
    readonly presetName: string;
    /** 用户勾选要导入的提示词条目列表 */
    readonly selectedEntries: PromptInjectionEntry[];
}

/** 原生世界书勾选导入弹窗参数 */
export interface WorldbookImportModalOptions {
    /** 解析后的酒馆原生世界书结构 */
    readonly parsed: ParsedStWorldbookResult;
    /** 当前通道是否已有激活预设（决定是否允许“追加至当前预设”） */
    readonly hasActivePreset?: boolean;
    /** 当前激活预设名称（供展示提示） */
    readonly activePresetName?: string;
    /** 用户点击确认导入后的回调 */
    readonly onConfirm: (result: WorldbookImportConfirmResult) => void;
    /** 弹窗关闭回调 */
    readonly onClose?: () => void;
}

/** 提示词预设导出格式类型 */
export type PromptExportFormat = 'st-worldbook' | 'plugin-preset';

/** 双格式导出选择弹窗参数 */
export interface PromptExportFormatModalOptions {
    /** 当前预设对象 */
    readonly preset: PresetItem<PromptChannelPresetData>;
    /** 当前正在编辑的条目列表（优先导出最新编辑态） */
    readonly entries?: PromptInjectionEntry[];
    /** 文件名前缀 */
    readonly filenamePrefix?: string;
    /** 导出完成后的回调（供调用方或单测断言导出的格式与数据） */
    readonly onExported?: (
        format: PromptExportFormat,
        payload: Record<string, unknown>,
        filename: string
    ) => void;
    /** 弹窗关闭回调 */
    readonly onClose?: () => void;
}

let activeImportModal: Disposable | null = null;
let activeExportModal: Disposable | null = null;

function formatPositionSummary(entry: PromptInjectionEntry): string {
    const roleLabel = entry.role === 1 ? 'USER' : entry.role === 2 ? 'ASSISTANT' : 'SYSTEM';
    if (entry.position === 1) {
        return `@D=${entry.depth} · ${roleLabel} · Order=${entry.order}`;
    }
    if (entry.position === 2) {
        return `前置 · ${roleLabel} · Order=${entry.order}`;
    }
    return `后置 · ${roleLabel} · Order=${entry.order}`;
}

/**
 * 触发 JSON 对象文件下载。
 */
export function triggerJsonFileDownload(
    filename: string,
    payload: Record<string, unknown>
): void {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') {
        return;
    }
    const jsonText = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 打开酒馆原生世界书按条目勾选导入弹窗。
 */
export function openWorldbookImportModal(options: WorldbookImportModalOptions): Disposable {
    if (typeof document === 'undefined' || !options.parsed) {
        return { dispose: () => {} };
    }

    if (activeImportModal) {
        activeImportModal.dispose();
        activeImportModal = null;
    }

    let isDisposed = false;
    const items = options.parsed.items || [];
    const checkedStates: boolean[] = items.map(() => true);
    const canAppend = options.hasActivePreset !== false;
    let currentMode: WorldbookImportApplyMode = 'create_preset';
    let presetName = options.parsed.name || '导入的世界书预设';

    // 1. 遮罩与面板容器
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-prompt-import-backdrop';

    const panel = document.createElement('div');
    panel.className = 'da-modal-shell da-lora-modal-panel da-prompt-import-panel';

    // 2. 顶栏
    const header = document.createElement('div');
    header.className = 'da-lora-modal-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'da-lora-modal-title-group';

    const titleEl = document.createElement('span');
    titleEl.className = 'da-lora-modal-title';
    titleEl.textContent = `导入酒馆原生世界书：${options.parsed.name}`;
    titleGroup.appendChild(titleEl);

    const subtitleEl = document.createElement('span');
    subtitleEl.className = 'da-lora-modal-subtitle';
    subtitleEl.textContent = `共解析 ${items.length} 条世界书条目（完整保留原书分隔线与注释项），请勾选需要导入的条目`;
    titleGroup.appendChild(subtitleEl);

    header.appendChild(titleGroup);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'da-lora-modal-close';
    closeBtn.innerHTML = renderIcon('close', 16);
    closeBtn.title = '关闭 (Esc)';
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 3. 主体区：导入模式配置 + 快捷勾选工具栏 + 条目勾选列表
    const body = document.createElement('div');
    body.className = 'da-lora-modal-body da-prompt-import-body';

    const topControls = document.createElement('div');
    topControls.className = 'da-prompt-import-controls';

    // 模式选择与预设名输入
    const modeRow = document.createElement('div');
    modeRow.className = 'da-prompt-import-mode-row';

    const modeSelect = document.createElement('select');
    modeSelect.className = 'da-select da-prompt-import-mode-select';

    const optCreate = document.createElement('option');
    optCreate.value = 'create_preset';
    optCreate.textContent = '新建为独立预设';
    modeSelect.appendChild(optCreate);

    if (canAppend) {
        const optAppend = document.createElement('option');
        optAppend.value = 'append_current';
        optAppend.textContent = options.activePresetName
            ? `追加至当前预设（${options.activePresetName}）`
            : '追加至当前预设';
        modeSelect.appendChild(optAppend);
    }

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'da-input da-prompt-import-name-input';
    nameInput.value = presetName;
    nameInput.placeholder = '输入新预设名称';
    nameInput.oninput = () => {
        presetName = nameInput.value.trim();
        updateFooterState();
    };

    modeSelect.onchange = () => {
        currentMode = modeSelect.value as WorldbookImportApplyMode;
        nameInput.style.display = currentMode === 'create_preset' ? '' : 'none';
        updateFooterState();
    };

    modeRow.appendChild(modeSelect);
    modeRow.appendChild(nameInput);
    topControls.appendChild(modeRow);

    // 快捷选择按钮组
    const filterRow = document.createElement('div');
    filterRow.className = 'da-prompt-import-filter-row';

    const btnSelectAll = document.createElement('button');
    btnSelectAll.type = 'button';
    btnSelectAll.className = 'da-btn da-btn--secondary da-btn--sm da-prompt-select-all';
    btnSelectAll.textContent = '全选';

    const btnSelectNone = document.createElement('button');
    btnSelectNone.type = 'button';
    btnSelectNone.className = 'da-btn da-btn--secondary da-btn--sm da-prompt-select-none';
    btnSelectNone.textContent = '全不选';

    const btnSelectEnabled = document.createElement('button');
    btnSelectEnabled.type = 'button';
    btnSelectEnabled.className = 'da-btn da-btn--secondary da-btn--sm da-prompt-select-enabled';
    btnSelectEnabled.textContent = '仅选原启用项';

    filterRow.appendChild(btnSelectAll);
    filterRow.appendChild(btnSelectNone);
    filterRow.appendChild(btnSelectEnabled);
    topControls.appendChild(filterRow);
    body.appendChild(topControls);

    // 条目滚动列表
    const listContainer = document.createElement('div');
    listContainer.className = 'da-prompt-import-list';

    const checkboxElements: HTMLInputElement[] = [];

    items.forEach((item, idx) => {
        const { uid, entry } = item;
        const row = document.createElement('label');
        row.className = 'da-prompt-import-row';
        row.setAttribute('data-uid', String(uid));

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'da-prompt-import-checkbox';
        cb.checked = checkedStates[idx];
        cb.onchange = () => {
            checkedStates[idx] = cb.checked;
            updateFooterState();
        };
        checkboxElements.push(cb);
        row.appendChild(cb);

        const uidBadge = document.createElement('span');
        uidBadge.className = 'da-badge da-badge--neutral';
        uidBadge.textContent = `#${uid}`;
        row.appendChild(uidBadge);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'da-prompt-import-row__name';
        nameSpan.textContent = entry.name;
        row.appendChild(nameSpan);

        const metaGroup = document.createElement('div');
        metaGroup.className = 'da-prompt-import-row__meta';

        const stateBadge = document.createElement('span');
        stateBadge.className = entry.enabled
            ? 'da-badge da-badge--success'
            : 'da-badge da-badge--neutral';
        stateBadge.textContent = entry.enabled ? '原启用' : '原禁用';
        metaGroup.appendChild(stateBadge);

        const trigBadge = document.createElement('span');
        trigBadge.className =
            entry.triggerMode === 'always'
                ? 'da-badge da-badge--primary'
                : 'da-badge da-badge--warning';
        const kwCount = entry.keywords
            ? entry.keywords.split('|').filter(Boolean).length
            : 0;
        trigBadge.textContent =
            entry.triggerMode === 'always' ? '常驻' : `关键词 (${kwCount})`;
        metaGroup.appendChild(trigBadge);

        const posBadge = document.createElement('span');
        posBadge.className = 'da-badge da-badge--neutral';
        posBadge.textContent = formatPositionSummary(entry);
        metaGroup.appendChild(posBadge);

        row.appendChild(metaGroup);
        listContainer.appendChild(row);
    });

    body.appendChild(listContainer);
    panel.appendChild(body);

    // 4. 底栏
    const footer = document.createElement('div');
    footer.className = 'da-lora-modal-footer';

    const footerLeft = document.createElement('div');
    footerLeft.className = 'da-lora-modal-footer__left da-prompt-import-count';
    footer.appendChild(footerLeft);

    const footerRight = document.createElement('div');
    footerRight.className = 'da-lora-modal-footer__right';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'da-btn da-btn--secondary da-btn--sm';
    cancelBtn.textContent = '取消';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'da-btn da-btn--primary da-btn--sm da-prompt-import-submit';
    submitBtn.textContent = '确认导入';

    footerRight.appendChild(cancelBtn);
    footerRight.appendChild(submitBtn);
    footer.appendChild(footerRight);
    panel.appendChild(footer);

    function syncCheckboxesUI(): void {
        checkboxElements.forEach((cb, i) => {
            cb.checked = checkedStates[i];
        });
        updateFooterState();
    }

    function updateFooterState(): void {
        const selectedCount = checkedStates.filter(Boolean).length;
        footerLeft.textContent = `已勾选 ${selectedCount} / ${items.length} 条`;
        const validName =
            currentMode === 'append_current' || Boolean((presetName || '').trim());
        submitBtn.disabled = selectedCount === 0 || !validName;
    }

    btnSelectAll.onclick = () => {
        for (let i = 0; i < checkedStates.length; i++) {
            checkedStates[i] = true;
        }
        syncCheckboxesUI();
    };

    btnSelectNone.onclick = () => {
        for (let i = 0; i < checkedStates.length; i++) {
            checkedStates[i] = false;
        }
        syncCheckboxesUI();
    };

    btnSelectEnabled.onclick = () => {
        for (let i = 0; i < checkedStates.length; i++) {
            checkedStates[i] = Boolean(items[i]?.entry.enabled);
        }
        syncCheckboxesUI();
    };

    updateFooterState();
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    const dispose = () => {
        if (isDisposed) return;
        isDisposed = true;
        overlayStack.remove('worldbook-import-modal');
        backdrop.remove();
        if (activeImportModal?.dispose === dispose) {
            activeImportModal = null;
        }
        options.onClose?.();
    };
    overlayStack.push('worldbook-import-modal', () => dispose());

    closeBtn.onclick = () => dispose();
    cancelBtn.onclick = () => dispose();
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            dispose();
        }
    };

    submitBtn.onclick = () => {
        const selectedEntries = items
            .filter((_, i) => checkedStates[i])
            .map((item) => structuredClone(item.entry));
        if (selectedEntries.length === 0) {
            return;
        }
        options.onConfirm({
            mode: currentMode,
            presetName: (presetName || '').trim() || options.parsed.name || '导入的世界书预设',
            selectedEntries,
        });
        dispose();
    };

    const handle: Disposable = { dispose };
    activeImportModal = handle;
    return handle;
}

/**
 * 打开提示词预设双格式导出选择对话框（支持导出为酒馆原生世界书 JSON 或插件预设 JSON）。
 */
export function openPromptExportFormatModal(
    options: PromptExportFormatModalOptions
): Disposable {
    if (typeof document === 'undefined' || !options.preset) {
        return { dispose: () => {} };
    }

    if (activeExportModal) {
        activeExportModal.dispose();
        activeExportModal = null;
    }

    let isDisposed = false;
    const presetName = options.preset.name || options.preset.id || '提示词预设';
    const entries = options.entries ?? options.preset.data?.entries ?? [];
    const safeName = presetName.replace(/\s+/g, '_');
    const prefix = options.filenamePrefix ?? 'st-draw-prompt-';

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-prompt-export-backdrop';

    const panel = document.createElement('div');
    panel.className = 'da-dialog-panel da-prompt-export-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.className = 'da-dialog-title';
    titleEl.textContent = `导出提示词预设：${presetName}`;
    panel.appendChild(titleEl);

    const msgEl = document.createElement('div');
    msgEl.className = 'da-dialog-message';
    msgEl.textContent = `当前预设共包含 ${entries.length} 条提示词条目，请选择需要导出的 JSON 文件格式：`;
    panel.appendChild(msgEl);

    const choiceGroup = document.createElement('div');
    choiceGroup.className = 'da-prompt-export-choices';

    const btnStWorldbook = document.createElement('button');
    btnStWorldbook.type = 'button';
    btnStWorldbook.className = 'da-btn da-btn--primary da-btn--sm da-prompt-export-st-btn';
    btnStWorldbook.textContent = '导出为酒馆原生世界书 JSON';

    const btnPluginPreset = document.createElement('button');
    btnPluginPreset.type = 'button';
    btnPluginPreset.className = 'da-btn da-btn--secondary da-btn--sm da-prompt-export-plugin-btn';
    btnPluginPreset.textContent = '导出为插件预设 JSON';

    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'da-btn da-btn--ghost da-btn--sm da-prompt-export-cancel-btn';
    btnCancel.textContent = '取消';

    choiceGroup.appendChild(btnStWorldbook);
    choiceGroup.appendChild(btnPluginPreset);
    choiceGroup.appendChild(btnCancel);
    panel.appendChild(choiceGroup);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    const dispose = () => {
        if (isDisposed) return;
        isDisposed = true;
        overlayStack.remove('prompt-export-format-modal');
        backdrop.remove();
        if (activeExportModal?.dispose === dispose) {
            activeExportModal = null;
        }
        options.onClose?.();
    };
    overlayStack.push('prompt-export-format-modal', () => dispose());

    btnCancel.onclick = () => dispose();
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            dispose();
        }
    };

    btnStWorldbook.onclick = () => {
        const payload = exportToStWorldbookJson(presetName, entries);
        const filename = `worldbook_${safeName}.json`;
        triggerJsonFileDownload(filename, payload);
        options.onExported?.('st-worldbook', payload, filename);
        dispose();
    };

    btnPluginPreset.onclick = () => {
        const payload: Record<string, unknown> = {
            ...options.preset,
            data: { entries: structuredClone(entries) },
            updatedAt: Date.now(),
        };
        const filename = `${prefix}${safeName}.json`;
        triggerJsonFileDownload(filename, payload);
        options.onExported?.('plugin-preset', payload, filename);
        dispose();
    };

    const handle: Disposable = { dispose };
    activeExportModal = handle;
    return handle;
}
