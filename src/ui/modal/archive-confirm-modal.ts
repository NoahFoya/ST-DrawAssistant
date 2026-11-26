/**
 * 楼层角色与服装档案即时确认模态弹窗 (ArchiveConfirmModal)。
 *
 * @remarks
 * 当从楼层消息中检测到 `<character>...</character>` 或 `<outfit>...</outfit>` 档案块（或用户点击楼层折叠胶囊徽标）时唤出：
 * 1. 单/多对象统一检视：单条档案直接展开编辑；多条档案顶部提供 Tab 切换栏隔离展示与独立配置策略；
 * 2. 唯一名称冲突实时校验：编辑名称时即时检索现有预设库及同批待导入条目，动态刷新冲突徽标与可用合并策略；
 * 3. 全量标准字段展示：涵盖名称、别名、触发词、描述、绑定服装（角色）及平铺展开的全部部位（含空部位），所有标签输入框均接入词库自动补全并随内容自适应高度。
 */

import type { Disposable } from '../types';
import type { CharacterPresetData, OutfitPresetData } from '@types';
import {
    findConflictingArchivePreset,
    buildMergedArchivePreset,
    type ExtractedArchiveItem,
    type ArchiveImportStrategy,
} from '../../pipeline/archive-extractor';
import {
    CHARACTER_PART_DEFS,
    OUTFIT_PART_DEFS,
    type MaterialPartDef,
} from '../../pipeline/material-definitions';
import { settingsStore, type SettingsStore } from '../../store/settings-store';
import { promptInjector } from '../../pipeline/prompt-injector';
import { attachTagAutocomplete } from '../composite/tag-autocomplete';
import { renderIcon } from '../components/icons';
import { bindBackdropDismiss, overlayStack } from '../framework/overlay-stack';
import { Toast } from '../feedback/toast';
import { reportRuntimeError } from '../feedback/error-feedback';

export interface ArchiveConfirmModalOptions {
    /** 提取出的角色与服装档案列表 */
    readonly items: ExtractedArchiveItem[];
    /** 可选配置存储实例（默认使用全局 settingsStore） */
    readonly store?: SettingsStore;
    /** 确认导入完成后的回调，返回实际写入的档案条数 */
    readonly onConfirmed?: (savedCount: number) => void;
    /** 弹窗关闭回调 */
    readonly onClose?: () => void;
}

interface ItemUiRefs {
    paneEl: HTMLElement;
    tabBtn?: HTMLButtonElement;
    tabNameEl?: HTMLElement;
    tabStateEl?: HTMLElement;
    statusBadgeEl: HTMLElement;
    strategySelect: HTMLSelectElement;
    nameInput: HTMLInputElement;
    autoTextareas: HTMLTextAreaElement[];
}

let activeModalInstance: Disposable | null = null;

/** 依据文本域实际内容自动调整高度，兼顾空字段紧凑展示与长标签完整可见 */
function syncAutoTextareaHeight(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    if (el.scrollHeight > 0) {
        el.style.height = `${el.scrollHeight}px`;
    }
}

function getStrategyOptions(hasConflict: boolean): Array<{ value: ArchiveImportStrategy; label: string }> {
    return hasConflict
        ? [
              { value: 'overwrite', label: '覆盖更新同名档案' },
              { value: 'fill_empty', label: '仅填补空字段' },
              { value: 'skip', label: '跳过不处理' },
          ]
        : [
              { value: 'import_new', label: '导入为新档案' },
              { value: 'skip', label: '跳过不导入' },
          ];
}

function parseOutfitRefList(raw: string): string[] {
    const out: string[] = [];
    for (const seg of raw.split(/[|,，]+/)) {
        const clean = seg.trim();
        if (clean && !out.includes(clean)) {
            out.push(clean);
        }
    }
    return out;
}

/**
 * 弹出角色与服装档案即时确认对话框。
 *
 * @param options 弹窗配置项
 * @returns 资源释放句柄
 */
export function openArchiveConfirmModal(options: ArchiveConfirmModalOptions): Disposable {
    if (typeof document === 'undefined' || !Array.isArray(options.items) || options.items.length === 0) {
        return { dispose: () => {} };
    }

    // 保证全局单实例，不堆叠多个档案确认遮罩
    if (activeModalInstance) {
        activeModalInstance.dispose();
        activeModalInstance = null;
    }

    const store = options.store ?? settingsStore;
    let isDisposed = false;
    let isSubmitting = false;

    const workingItems: ExtractedArchiveItem[] = structuredClone(options.items);
    const findConflictFor = (item: ExtractedArchiveItem) => {
        if (item.kind === 'character') {
            return findConflictingArchivePreset(
                item,
                store.getPresets<CharacterPresetData>('characters')
            );
        }
        return findConflictingArchivePreset(
            item,
            store.getPresets<OutfitPresetData>('outfits')
        );
    };

    const strategies: ArchiveImportStrategy[] = workingItems.map((item) =>
        findConflictFor(item) ? 'overwrite' : 'import_new'
    );

    let activeIndex = 0;
    const itemRefs: ItemUiRefs[] = [];
    const autocompleteHandles: Disposable[] = [];

    // 1. 全屏遮罩与独立模态外壳
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-archive-confirm-backdrop';

    const panel = document.createElement('div');
    panel.className = 'da-modal-shell da-archive-confirm-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '核对并导入档案');

    // 2. 固定顶部标题栏
    const header = document.createElement('div');
    header.className = 'da-archive-confirm-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'da-archive-confirm-title-group';

    const titleEl = document.createElement('h3');
    titleEl.className = 'da-archive-confirm-title';
    titleEl.textContent = '检测到角色 / 服装档案';
    titleGroup.appendChild(titleEl);

    const subtitleEl = document.createElement('p');
    subtitleEl.className = 'da-archive-confirm-subtitle';
    subtitleEl.textContent = '核对并编辑提取出的基础信息与全量部位标签，确认后导入或合并至素材库';
    titleGroup.appendChild(subtitleEl);
    header.appendChild(titleGroup);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'da-archive-confirm-close';
    closeBtn.innerHTML = renderIcon('close', 16);
    closeBtn.setAttribute('aria-label', '关闭弹窗');
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 3. 多对象独立 Tab 切换条（仅 2 条及以上时展示）
    let tabBar: HTMLElement | null = null;
    if (workingItems.length > 1) {
        tabBar = document.createElement('div');
        tabBar.className = 'da-archive-confirm-tabs';
        tabBar.setAttribute('role', 'tablist');
        panel.appendChild(tabBar);
    }

    // 4. 独立可滚动主体区
    const body = document.createElement('div');
    body.className = 'da-archive-confirm-body';
    panel.appendChild(body);

    const summaryText = document.createElement('span');

    const updateSummary = () => {
        const activeCharCount = workingItems.filter(
            (item, i) => item.kind === 'character' && strategies[i] !== 'skip'
        ).length;
        const activeOutfitCount = workingItems.filter(
            (item, i) => item.kind === 'outfit' && strategies[i] !== 'skip'
        ).length;
        const skippedCount = strategies.filter((s) => s === 'skip').length;
        const parts: string[] = [
            `待应用 ${workingItems.length - skippedCount}/${workingItems.length} 项（角色 ${activeCharCount}，服装 ${activeOutfitCount}）`,
        ];
        if (skippedCount > 0) {
            parts.push(`已跳过 ${skippedCount}`);
        }
        summaryText.textContent = parts.join(' · ');
    };

    const findEarlierBatchDuplicateIdx = (idx: number): number => {
        const current = workingItems[idx];
        const key = current?.name.trim().toLowerCase();
        if (!key) return -1;
        for (let i = 0; i < idx; i++) {
            if (strategies[i] === 'skip') continue;
            const other = workingItems[i];
            if (other.kind === current.kind && other.name.trim().toLowerCase() === key) {
                return i;
            }
        }
        return -1;
    };

    const syncSameKindConflictStates = (kind: ExtractedArchiveItem['kind']) => {
        workingItems.forEach((other, oIdx) => {
            if (other.kind === kind) {
                syncItemConflictAndStrategy(oIdx);
            }
        });
    };

    const syncItemConflictAndStrategy = (idx: number) => {
        const refs = itemRefs[idx];
        const item = workingItems[idx];
        if (!refs) return;

        const existing = findConflictFor(item);
        const batchDupIdx = existing ? -1 : findEarlierBatchDuplicateIdx(idx);
        const hasConflict = Boolean(existing);

        if (strategies[idx] !== 'skip') {
            if (hasConflict && strategies[idx] === 'import_new') {
                strategies[idx] = 'overwrite';
            } else if (!hasConflict && strategies[idx] !== 'import_new') {
                strategies[idx] = 'import_new';
            }
        }

        // 更新策略选项列表
        const currentStrategy = strategies[idx];
        refs.strategySelect.innerHTML = '';
        for (const opt of getStrategyOptions(hasConflict)) {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            o.selected = opt.value === currentStrategy;
            refs.strategySelect.appendChild(o);
        }

        // 更新冲突状态徽标与跳过样式
        if (hasConflict) {
            refs.statusBadgeEl.className = 'da-badge da-badge--warning';
            refs.statusBadgeEl.textContent = `已存在同名预设: ${existing!.data?.name || existing!.name}`;
        } else if (batchDupIdx !== -1) {
            refs.statusBadgeEl.className = 'da-badge da-badge--warning';
            refs.statusBadgeEl.textContent = `与本批第 ${batchDupIdx + 1} 项重名`;
        } else {
            refs.statusBadgeEl.className = 'da-badge da-badge--success';
            refs.statusBadgeEl.textContent = '全新档案';
        }

        const isSkipped = currentStrategy === 'skip';
        refs.paneEl.classList.toggle('is-skipped', isSkipped);

        // 同步 Tab 标签名称与状态徽记
        if (refs.tabNameEl) {
            refs.tabNameEl.textContent = item.name.trim() || (item.kind === 'character' ? '未命名角色' : '未命名服装');
        }
        if (refs.tabStateEl) {
            refs.tabStateEl.className = 'da-archive-confirm-tab__state';
            if (isSkipped) {
                refs.tabStateEl.textContent = '跳过';
                refs.tabStateEl.classList.add('is-skipped');
            } else if (hasConflict || batchDupIdx !== -1) {
                refs.tabStateEl.textContent = hasConflict ? '同名' : '重名';
                refs.tabStateEl.classList.add('is-conflict');
            } else {
                refs.tabStateEl.textContent = '新增';
                refs.tabStateEl.classList.add('is-new');
            }
        }

        updateSummary();
    };

    const setActiveTab = (nextIdx: number) => {
        activeIndex = nextIdx;
        itemRefs.forEach((refs, i) => {
            const isActive = i === activeIndex;
            refs.paneEl.classList.toggle('is-active', isActive);
            if (refs.tabBtn) {
                refs.tabBtn.classList.toggle('is-active', isActive);
                refs.tabBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            }
            if (isActive) {
                for (const ta of refs.autoTextareas) {
                    syncAutoTextareaHeight(ta);
                }
            }
        });
        body.scrollTop = 0;
    };

    const createLabeledInput = (
        id: string,
        labelText: string,
        required: boolean,
        value: string,
        placeholder: string,
        inputClass: string,
        onValueChange: (val: string) => void
    ): { fieldEl: HTMLElement; inputEl: HTMLInputElement } => {
        const fieldEl = document.createElement('div');
        fieldEl.className = 'da-archive-field-box';
        fieldEl.classList.toggle('has-value', Boolean(value.trim()));

        const labelEl = document.createElement('label');
        labelEl.className = 'da-archive-field-label';
        labelEl.htmlFor = id;
        labelEl.textContent = labelText;
        if (required) {
            const mark = document.createElement('span');
            mark.className = 'da-required-mark';
            mark.textContent = ' *';
            labelEl.appendChild(mark);
        }
        fieldEl.appendChild(labelEl);

        const inputEl = document.createElement('input');
        inputEl.id = id;
        inputEl.type = 'text';
        inputEl.className = `da-input da-archive-input ${inputClass}`;
        inputEl.value = value;
        inputEl.placeholder = placeholder;
        inputEl.oninput = () => {
            fieldEl.classList.toggle('has-value', Boolean(inputEl.value.trim()));
            onValueChange(inputEl.value);
        };
        fieldEl.appendChild(inputEl);

        return { fieldEl, inputEl };
    };

    const uidPrefix = `da-arch-${Date.now().toString(36)}`;

    workingItems.forEach((item, idx) => {
        const pane = document.createElement('div');
        pane.className = 'da-archive-tab-pane';
        pane.dataset.tabIndex = String(idx);
        const autoTextareas: HTMLTextAreaElement[] = [];

        // Tab 按钮
        let tabBtn: HTMLButtonElement | undefined;
        let tabNameEl: HTMLElement | undefined;
        let tabStateEl: HTMLElement | undefined;
        if (tabBar) {
            tabBtn = document.createElement('button');
            tabBtn.type = 'button';
            tabBtn.className = 'da-archive-confirm-tab';
            tabBtn.setAttribute('role', 'tab');

            tabNameEl = document.createElement('span');
            tabNameEl.className = 'da-archive-confirm-tab__name';
            tabBtn.appendChild(tabNameEl);

            tabStateEl = document.createElement('span');
            tabStateEl.className = 'da-archive-confirm-tab__state';
            tabBtn.appendChild(tabStateEl);

            tabBtn.onclick = () => setActiveTab(idx);
            tabBar.appendChild(tabBtn);
        }

        // A. 对象顶栏：类型、冲突状态与导入策略
        const itemToolbar = document.createElement('div');
        itemToolbar.className = 'da-archive-item-toolbar';

        const badgeGroup = document.createElement('div');
        badgeGroup.className = 'da-archive-confirm-card__badges';

        const kindBadge = document.createElement('span');
        kindBadge.className = 'da-badge da-badge--primary';
        kindBadge.textContent = item.kind === 'character' ? '角色档案' : '服装档案';
        badgeGroup.appendChild(kindBadge);

        const statusBadgeEl = document.createElement('span');
        badgeGroup.appendChild(statusBadgeEl);
        itemToolbar.appendChild(badgeGroup);

        const strategyWrap = document.createElement('div');
        strategyWrap.className = 'da-archive-strategy-wrap';

        const strategyLabel = document.createElement('label');
        strategyLabel.className = 'da-archive-strategy-label';
        strategyLabel.htmlFor = `${uidPrefix}-${idx}-strategy`;
        strategyLabel.textContent = '导入策略';

        const strategySelect = document.createElement('select');
        strategySelect.id = `${uidPrefix}-${idx}-strategy`;
        strategySelect.className = 'da-select da-archive-strategy-select';
        strategySelect.onchange = () => {
            strategies[idx] = strategySelect.value as ArchiveImportStrategy;
            syncSameKindConflictStates(item.kind);
        };

        strategyWrap.appendChild(strategyLabel);
        strategyWrap.appendChild(strategySelect);
        itemToolbar.appendChild(strategyWrap);
        pane.appendChild(itemToolbar);

        // B. 基础档案区
        const metaSection = document.createElement('section');
        metaSection.className = 'da-archive-section';

        const metaHeader = document.createElement('div');
        metaHeader.className = 'da-archive-section__header';

        const metaSectionTitle = document.createElement('h4');
        metaSectionTitle.className = 'da-archive-section__title';
        metaSectionTitle.textContent = '基础信息';
        metaHeader.appendChild(metaSectionTitle);
        metaSection.appendChild(metaHeader);

        const row1 = document.createElement('div');
        row1.className = 'da-archive-confirm-grid-2';

        const { fieldEl: nameField, inputEl: nameInput } = createLabeledInput(
            `${uidPrefix}-${idx}-name`,
            '名称',
            true,
            item.name || '',
            '输入唯一名称',
            'da-archive-name-input',
            (val) => {
                item.name = val.trim();
                nameInput.classList.remove('is-invalid');
                syncSameKindConflictStates(item.kind);
            }
        );

        const { fieldEl: aliasesField } = createLabeledInput(
            `${uidPrefix}-${idx}-aliases`,
            '别名 (以 | 分隔)',
            false,
            item.aliases || '',
            '例如: alice|爱丽丝',
            'da-archive-aliases-input',
            (val) => {
                item.aliases = val.trim();
            }
        );

        row1.appendChild(nameField);
        row1.appendChild(aliasesField);
        metaSection.appendChild(row1);

        const row2 = document.createElement('div');
        row2.className =
            item.kind === 'character'
                ? 'da-archive-confirm-grid-2'
                : 'da-archive-confirm-grid-1';

        const { fieldEl: triggerField, inputEl: triggerInput } = createLabeledInput(
            `${uidPrefix}-${idx}-trigger`,
            item.kind === 'character' ? '角色触发词 (Trigger Tags)' : '服装触发词 (Trigger Tags)',
            false,
            item.trigger || '',
            item.kind === 'character'
                ? '官方角色与作品标签或专用触发标签，原创角色留空'
                : '官方服饰/套装标签或专用触发标签，通用或自设服装留空',
            'da-archive-trigger-input',
            (val) => {
                item.trigger = val.trim();
            }
        );
        autocompleteHandles.push(
            attachTagAutocomplete(triggerInput, { mode: 'lexicon-only' })
        );
        row2.appendChild(triggerField);

        if (item.kind === 'character') {
            const { fieldEl: outfitsField } = createLabeledInput(
                `${uidPrefix}-${idx}-outfits`,
                '绑定服装 (以 , 或 | 分隔)',
                false,
                item.boundOutfitIds.join(', '),
                '例如: 学院制服, 居家常服',
                'da-archive-outfits-input',
                (val) => {
                    item.boundOutfitIds = parseOutfitRefList(val);
                }
            );
            row2.appendChild(outfitsField);
        }
        metaSection.appendChild(row2);

        const descBox = document.createElement('div');
        descBox.className = 'da-archive-field-box';
        descBox.classList.toggle('has-value', Boolean((item.description || '').trim()));

        const descLabel = document.createElement('label');
        descLabel.className = 'da-archive-field-label';
        descLabel.htmlFor = `${uidPrefix}-${idx}-desc`;
        descLabel.textContent = item.kind === 'character' ? '角色描述' : '服装描述';
        descBox.appendChild(descLabel);

        const descInput = document.createElement('textarea');
        descInput.id = `${uidPrefix}-${idx}-desc`;
        descInput.className = 'da-textarea da-archive-desc-input da-archive-auto-textarea';
        descInput.rows = 1;
        descInput.value = item.description || '';
        descInput.placeholder =
            item.kind === 'character'
                ? '人设背景、性格与故事定位说明'
                : '服装款式、风格剪裁与适用场合说明';
        descInput.oninput = () => {
            item.description = descInput.value.trim();
            descBox.classList.toggle('has-value', Boolean(item.description));
            syncAutoTextareaHeight(descInput);
        };
        autoTextareas.push(descInput);
        descBox.appendChild(descInput);
        metaSection.appendChild(descBox);
        pane.appendChild(metaSection);

        // C. 全部标准部位区（双栏网格平铺展示全部部位）
        const partDefs: ReadonlyArray<MaterialPartDef<string>> =
            item.kind === 'character' ? CHARACTER_PART_DEFS : OUTFIT_PART_DEFS;

        const partsSection = document.createElement('section');
        partsSection.className = 'da-archive-section';

        const partsHeader = document.createElement('div');
        partsHeader.className = 'da-archive-section__header';

        const partsSectionTitle = document.createElement('h4');
        partsSectionTitle.className = 'da-archive-section__title';
        partsSectionTitle.textContent = '部位标签';
        partsHeader.appendChild(partsSectionTitle);

        const partsCountEl = document.createElement('span');
        partsCountEl.className = 'da-archive-section__count';
        const syncPartsCount = () => {
            const filledCount = partDefs.reduce(
                (acc, def) => (item.parts[def.key]?.trim() ? acc + 1 : acc),
                0
            );
            partsCountEl.textContent = `已填 ${filledCount} / ${partDefs.length}`;
            partsCountEl.classList.toggle('has-filled', filledCount > 0);
        };
        syncPartsCount();
        partsHeader.appendChild(partsCountEl);
        partsSection.appendChild(partsHeader);

        const partsGrid = document.createElement('div');
        partsGrid.className = 'da-archive-parts-grid';

        for (const def of partDefs) {
            const pBox = document.createElement('div');
            pBox.className = 'da-archive-field-box';
            pBox.classList.toggle('has-value', Boolean((item.parts[def.key] || '').trim()));

            const pLabelRow = document.createElement('div');
            pLabelRow.className = 'da-archive-field-label-row';

            const pLabel = document.createElement('label');
            pLabel.className = 'da-archive-field-label';
            pLabel.htmlFor = `${uidPrefix}-${idx}-part-${def.key}`;
            pLabel.textContent = def.label;

            const pKeyCode = document.createElement('code');
            pKeyCode.className = 'da-archive-field-key';
            pKeyCode.textContent = def.key;

            pLabelRow.appendChild(pLabel);
            pLabelRow.appendChild(pKeyCode);
            pBox.appendChild(pLabelRow);

            const pTextarea = document.createElement('textarea');
            pTextarea.id = `${uidPrefix}-${idx}-part-${def.key}`;
            pTextarea.className = 'da-textarea da-archive-part-textarea da-archive-auto-textarea';
            pTextarea.rows = 1;
            pTextarea.value = item.parts[def.key] || '';
            pTextarea.placeholder = def.placeholder;
            pTextarea.oninput = () => {
                item.parts[def.key] = pTextarea.value.trim();
                pBox.classList.toggle('has-value', Boolean(item.parts[def.key]));
                syncPartsCount();
                syncAutoTextareaHeight(pTextarea);
            };
            autocompleteHandles.push(
                attachTagAutocomplete(pTextarea, { mode: 'lexicon-only' })
            );
            autoTextareas.push(pTextarea);

            pBox.appendChild(pTextarea);
            partsGrid.appendChild(pBox);
        }

        partsSection.appendChild(partsGrid);

        pane.appendChild(partsSection);
        body.appendChild(pane);

        itemRefs.push({
            paneEl: pane,
            tabBtn,
            tabNameEl,
            tabStateEl,
            statusBadgeEl,
            strategySelect,
            nameInput,
            autoTextareas,
        });

        syncItemConflictAndStrategy(idx);
    });

    // 5. 固定底部操作栏
    const footer = document.createElement('div');
    footer.className = 'da-archive-confirm-footer';

    const footerLeft = document.createElement('div');
    footerLeft.className = 'da-archive-footer-left';

    summaryText.className = 'da-archive-summary-text';
    footerLeft.appendChild(summaryText);

    const autoActivateLabel = document.createElement('label');
    autoActivateLabel.className = 'da-archive-auto-activate-label';

    const autoActivateCheckbox = document.createElement('input');
    autoActivateCheckbox.type = 'checkbox';
    autoActivateCheckbox.className = 'da-archive-auto-activate-checkbox';
    autoActivateCheckbox.checked = true;

    const autoActivateText = document.createElement('span');
    autoActivateText.textContent = '导入后自动在当前启用预设中开启（关键词触发）';
    autoActivateLabel.appendChild(autoActivateCheckbox);
    autoActivateLabel.appendChild(autoActivateText);
    footerLeft.appendChild(autoActivateLabel);
    footer.appendChild(footerLeft);

    const footerRight = document.createElement('div');
    footerRight.className = 'da-archive-footer-right';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'da-btn da-btn--secondary da-btn--sm';
    cancelBtn.textContent = '暂不导入';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'da-btn da-btn--primary da-btn--sm da-archive-confirm-submit';
    confirmBtn.textContent = '确认应用';

    footerRight.appendChild(cancelBtn);
    footerRight.appendChild(confirmBtn);
    footer.appendChild(footerRight);
    panel.appendChild(footer);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    // 挂载完成后激活首项并测算可见文本域真实高度
    setActiveTab(0);
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            if (!isDisposed) {
                for (const ta of itemRefs[activeIndex]?.autoTextareas || []) {
                    syncAutoTextareaHeight(ta);
                }
            }
        });
    }

    // 6. 事件绑定与销毁
    let unbindBackdrop = () => {};
    const dispose = () => {
        if (isDisposed) return;
        isDisposed = true;
        unbindBackdrop();
        overlayStack.remove('archive-confirm-modal');
        for (const h of autocompleteHandles) {
            h.dispose();
        }
        autocompleteHandles.length = 0;
        backdrop.remove();
        if (activeModalInstance?.dispose === dispose) {
            activeModalInstance = null;
        }
        options.onClose?.();
    };
    overlayStack.push('archive-confirm-modal', () => dispose(), () => dispose());

    closeBtn.onclick = () => dispose();
    cancelBtn.onclick = () => dispose();
    unbindBackdrop = bindBackdropDismiss(backdrop, () => dispose());

    confirmBtn.onclick = () => {
        if (isSubmitting || isDisposed) return;

        // 校验非跳过条目必填名称，防止空名称被静默跳过
        const missingIdx = workingItems.findIndex(
            (item, idx) => strategies[idx] !== 'skip' && !item.name.trim()
        );
        if (missingIdx !== -1) {
            setActiveTab(missingIdx);
            const targetInput = itemRefs[missingIdx]?.nameInput;
            if (targetInput) {
                targetInput.classList.add('is-invalid');
                targetInput.focus();
            }
            Toast.warning('请先填写档案名称后再确认导入');
            return;
        }

        const dupIdx = workingItems.findIndex(
            (_, idx) => strategies[idx] !== 'skip' && findEarlierBatchDuplicateIdx(idx) !== -1
        );
        if (dupIdx !== -1) {
            setActiveTab(dupIdx);
            const targetInput = itemRefs[dupIdx]?.nameInput;
            if (targetInput) {
                targetInput.classList.add('is-invalid');
                targetInput.focus();
            }
            Toast.warning('同批次存在重名档案，请修改名称或将重复项设为跳过后再确认导入');
            return;
        }

        isSubmitting = true;
        confirmBtn.disabled = true;

        try {
            let savedCount = 0;

            // 优先处理服装条目，确保后续角色保存时 OUTFITS 名称能即时映射为新建服装的预设 ID
            const ordered = workingItems
                .map((item, idx) => ({ item, idx }))
                .sort((a, b) => {
                    if (a.item.kind === b.item.kind) return a.idx - b.idx;
                    return a.item.kind === 'outfit' ? -1 : 1;
                });

            for (const { item, idx } of ordered) {
                const strategy = strategies[idx];
                if (strategy === 'skip') {
                    continue;
                }

                const category = item.kind === 'character' ? 'characters' : 'outfits';
                const existingPreset = findConflictFor(item);
                const existingOutfits =
                    item.kind === 'character'
                        ? store.getPresets<OutfitPresetData>('outfits')
                        : undefined;
                const merged = buildMergedArchivePreset(
                    item,
                    existingPreset,
                    strategy,
                    existingOutfits
                );
                store.savePreset(category, merged, undefined, {
                    autoActivateMaterial: autoActivateCheckbox.checked,
                });
                savedCount++;
            }

            if (savedCount > 0) {
                void promptInjector.scheduleSyncToHost();
                Toast.success(`已成功保存 ${savedCount} 项角色/服装档案`);
            }
            options.onConfirmed?.(savedCount);
            dispose();
        } catch (err: unknown) {
            reportRuntimeError(
                '[ArchiveConfirmModal] 保存角色/服装档案异常:',
                '保存档案失败，请前往「日志与统计」查看详情',
                err
            );
        } finally {
            isSubmitting = false;
            if (!isDisposed) {
                confirmBtn.disabled = false;
            }
        }
    };

    const handle: Disposable = { dispose };
    activeModalInstance = handle;
    return handle;
}
