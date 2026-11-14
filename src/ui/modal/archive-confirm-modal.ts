/**
 * 楼层角色与服装档案即时确认模态弹窗 (ArchiveConfirmModal)。
 *
 * @remarks
 * 当从楼层消息中检测到 `<角色>...</角色>` 或 `<服装>...</服装>` 档案块（或用户点击楼层折叠胶囊徽标）时唤出：
 * 1. 单楼层合并展示：同一消息内提取的多条角色与服装档案集中于同一弹窗展示，不设后台堆积队列；
 * 2. 同名冲突与 Diff 对比：自动按名称或别名比对现有库，标注「全新档案」或「已存在同名预设」，并展示基础属性与各部位字段的变化；
 * 3. 策略选择与在线微调：支持逐项选择「新建导入 / 覆盖更新 / 仅填补空字段 / 跳过」，所有标签字段均采用全宽文本域编辑。
 */

import type { Disposable } from '../types';
import type { CharacterPresetData, OutfitPresetData } from '@types';
import {
    computeArchiveDiff,
    buildMergedArchivePreset,
    type ExtractedArchiveItem,
    type ArchiveImportStrategy,
} from '../../pipeline/archive-extractor';
import {
    CHARACTER_PART_DEFS,
    OUTFIT_PART_DEFS,
} from '../../pipeline/material-definitions';
import { settingsStore, type SettingsStore } from '../../store/settings-store';
import { promptInjector } from '../../pipeline/prompt-injector';
import { attachTagAutocomplete } from '../composite/tag-autocomplete';
import { renderIcon } from '../components/icons';
import { overlayStack } from '../framework/overlay-stack';
import { Toast } from '../feedback/toast';

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

let activeModalInstance: Disposable | null = null;

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

    // 克隆可编辑副本与每项的导入策略
    const workingItems: ExtractedArchiveItem[] = structuredClone(options.items);
    const strategies: ArchiveImportStrategy[] = workingItems.map((item) => {
        const list =
            item.kind === 'character'
                ? store.getPresets<CharacterPresetData>('characters')
                : store.getPresets<OutfitPresetData>('outfits');
        const diff = computeArchiveDiff(item, list);
        return diff.hasConflict ? 'overwrite' : 'import_new';
    });

    // 1. 全屏遮罩与模态外壳
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-archive-confirm-backdrop';

    const panel = document.createElement('div');
    panel.className = 'da-modal-shell da-lora-modal-panel da-archive-confirm-panel';

    // 2. 头部顶栏
    const header = document.createElement('div');
    header.className = 'da-lora-modal-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'da-lora-modal-title-group';

    const titleEl = document.createElement('span');
    titleEl.className = 'da-lora-modal-title';
    titleEl.textContent = '检测到角色 / 服装档案';
    titleGroup.appendChild(titleEl);

    const subtitleEl = document.createElement('span');
    subtitleEl.className = 'da-lora-modal-subtitle';
    subtitleEl.textContent = '核对提取出的基础属性与各部位标签，确认导入或更新至素材库';
    titleGroup.appendChild(subtitleEl);

    header.appendChild(titleGroup);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'da-lora-modal-close';
    closeBtn.innerHTML = renderIcon('close', 16);
    closeBtn.setAttribute('aria-label', '关闭弹窗');
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 3. 主体滚动区：逐项渲染提取档案卡片
    const body = document.createElement('div');
    body.className = 'da-lora-modal-body da-archive-confirm-body';

    const autocompleteHandles: Disposable[] = [];

    workingItems.forEach((item, idx) => {
        const existingList =
            item.kind === 'character'
                ? store.getPresets<CharacterPresetData>('characters')
                : store.getPresets<OutfitPresetData>('outfits');
        const diff = computeArchiveDiff(item, existingList);
        const partDefs = item.kind === 'character' ? CHARACTER_PART_DEFS : OUTFIT_PART_DEFS;

        const card = document.createElement('div');
        card.className = 'da-card da-archive-confirm-card';

        // 卡片顶栏：类型徽标 + 冲突状态 + 导入动作选择
        const cardHeader = document.createElement('div');
        cardHeader.className = 'da-archive-confirm-card__header';

        const badgeGroup = document.createElement('div');
        badgeGroup.className = 'da-archive-confirm-card__badges';

        const kindBadge = document.createElement('span');
        kindBadge.className = 'da-badge da-badge--primary';
        kindBadge.textContent = item.kind === 'character' ? '👤 角色档案' : '👗 服装档案';
        badgeGroup.appendChild(kindBadge);

        const statusBadge = document.createElement('span');
        statusBadge.className = diff.hasConflict ? 'da-badge da-badge--warning' : 'da-badge da-badge--success';
        statusBadge.textContent = diff.hasConflict
            ? `已存在同名预设: ${diff.existingPresetName}`
            : '全新档案';
        badgeGroup.appendChild(statusBadge);
        cardHeader.appendChild(badgeGroup);

        const strategySelect = document.createElement('select');
        strategySelect.className = 'da-select da-archive-strategy-select';

        const optionDefs: Array<{ value: ArchiveImportStrategy; label: string }> = diff.hasConflict
            ? [
                  { value: 'overwrite', label: '覆盖更新同名档案' },
                  { value: 'fill_empty', label: '仅填补空字段' },
                  { value: 'skip', label: '跳过不处理' },
              ]
            : [
                  { value: 'import_new', label: '导入为新档案' },
                  { value: 'skip', label: '跳过不导入' },
              ];

        for (const opt of optionDefs) {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            if (opt.value === strategies[idx]) {
                o.selected = true;
            }
            strategySelect.appendChild(o);
        }

        strategySelect.onchange = () => {
            strategies[idx] = strategySelect.value as ArchiveImportStrategy;
            card.style.opacity = strategies[idx] === 'skip' ? '0.55' : '1';
        };
        cardHeader.appendChild(strategySelect);
        card.appendChild(cardHeader);

        // 基础属性编辑第 1 行：名称 + 别名
        const metaRow = document.createElement('div');
        metaRow.className = 'da-archive-confirm-grid-2';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'da-input da-archive-name-input';
        nameInput.value = item.name || '';
        nameInput.placeholder = '唯一名称 (NAME)';
        nameInput.title = '唯一名称 (NAME)';
        nameInput.oninput = () => {
            item.name = nameInput.value.trim();
        };

        const aliasesInput = document.createElement('input');
        aliasesInput.type = 'text';
        aliasesInput.className = 'da-input da-archive-aliases-input';
        aliasesInput.value = item.aliases || '';
        aliasesInput.placeholder = '别名列表 (以 | 分隔，选填)';
        aliasesInput.title = '别名列表 (以 | 分隔)';
        aliasesInput.oninput = () => {
            item.aliases = aliasesInput.value.trim();
        };

        metaRow.appendChild(nameInput);
        metaRow.appendChild(aliasesInput);
        card.appendChild(metaRow);

        // 基础属性编辑第 2 行：角色触发词/服装专属标识 + 角色描述/服装描述
        const descRow = document.createElement('div');
        descRow.className = 'da-archive-confirm-grid-2';

        const triggerInput = document.createElement('input');
        triggerInput.type = 'text';
        triggerInput.className = 'da-input da-archive-trigger-input';
        triggerInput.value = item.trigger || '';
        const triggerDiff = diff.triggerDiff;
        const triggerModifiedNotice =
            diff.hasConflict && triggerDiff?.status === 'modified'
                ? ` [与原记录不同，原值: ${triggerDiff.oldValue || '空'}]`
                : '';
        triggerInput.placeholder =
            item.kind === 'character'
                ? `角色专属标签 (特定角色与作品出处英文 tags，原创角色留空即可)${triggerModifiedNotice}`
                : `服装专属标识 (特定服饰专属英文 tags，通用或自设服装留空即可)${triggerModifiedNotice}`;
        triggerInput.title =
            item.kind === 'character'
                ? `角色触发词 (TRIGGER)${triggerModifiedNotice}`
                : `服装专属标识 (TRIGGER)${triggerModifiedNotice}`;
        triggerInput.oninput = () => {
            const val = triggerInput.value.trim();
            item.trigger = val;
        };
        autocompleteHandles.push(
            attachTagAutocomplete(triggerInput, { mode: 'lexicon-only' })
        );

        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.className = 'da-input da-archive-desc-input';
        descInput.value = item.description || '';
        const descModifiedNotice =
            diff.hasConflict && diff.descriptionDiff?.status === 'modified'
                ? ` [与原记录不同，原值: ${diff.descriptionDiff.oldValue || '空'}]`
                : '';
        descInput.placeholder =
            item.kind === 'character'
                ? `角色描述 (人设背景与故事定位)${descModifiedNotice}`
                : `服装描述 (风格剪裁与外观说明)${descModifiedNotice}`;
        descInput.title =
            item.kind === 'character'
                ? `角色描述 (DESCRIPTION)${descModifiedNotice}`
                : `服装描述 (DESCRIPTION)${descModifiedNotice}`;
        descInput.oninput = () => {
            item.description = descInput.value.trim();
        };

        descRow.appendChild(triggerInput);
        descRow.appendChild(descInput);
        card.appendChild(descRow);

        // 基础特征全宽文本域（角色为体貌特征，服装为服饰风格）
        const baseTraitBox = document.createElement('div');
        baseTraitBox.className = 'da-archive-field-box';

        const baseTraitDiff = diff.baseTraitDiff;
        const baseTraitLabelName =
            item.kind === 'character' ? '体貌特征 (APPEARANCE)' : '服饰风格 (STYLE)';
        const baseTraitLabel = document.createElement('span');
        baseTraitLabel.className = 'da-archive-field-label';
        baseTraitLabel.textContent =
            diff.hasConflict && baseTraitDiff?.status === 'modified'
                ? `${baseTraitLabelName} [与原记录不同，原值: ${baseTraitDiff.oldValue || '空'}]`
                : `${baseTraitLabelName} (常驻展开)`;
        baseTraitBox.appendChild(baseTraitLabel);

        const baseTraitTextarea = document.createElement('textarea');
        baseTraitTextarea.className = 'da-textarea da-archive-base-textarea';
        baseTraitTextarea.rows = 2;
        baseTraitTextarea.value = item.baseTrait || '';
        baseTraitTextarea.placeholder =
            item.kind === 'character'
                ? '输入体型、肤色、身材特征等基础体貌 Tags（勿填发型与眼睛）'
                : '输入服饰版型、整体款式、主色调与设计基调 Tags';
        baseTraitTextarea.oninput = () => {
            const val = baseTraitTextarea.value.trim();
            item.baseTrait = val;
        };
        autocompleteHandles.push(
            attachTagAutocomplete(baseTraitTextarea, { mode: 'lexicon-only' })
        );
        baseTraitBox.appendChild(baseTraitTextarea);
        card.appendChild(baseTraitBox);

        // 非空部位字段全宽文本域列表
        const activePartDefs = partDefs.filter((def) => Boolean((item.parts[def.key] || '').trim()));
        if (activePartDefs.length > 0) {
            const partsSection = document.createElement('div');
            partsSection.className = 'da-archive-parts-section';

            const partsHeader = document.createElement('span');
            partsHeader.className = 'da-archive-parts-header';
            partsHeader.textContent = `提取出的部位特征 (${activePartDefs.length} 项)`;
            partsSection.appendChild(partsHeader);

            for (const def of activePartDefs) {
                const pDiff = diff.partDiffs.find((d) => d.key === def.key);
                const pBox = document.createElement('div');
                pBox.className = 'da-archive-field-box';

                const pLabel = document.createElement('span');
                pLabel.className = 'da-archive-field-label';
                pLabel.textContent =
                    diff.hasConflict && pDiff?.status === 'modified'
                        ? `${def.label} (-${def.key}) [原值: ${pDiff.oldValue || '空'}]`
                        : `${def.label} (-${def.key})`;
                pBox.appendChild(pLabel);

                const pTextarea = document.createElement('textarea');
                pTextarea.className = 'da-textarea da-archive-part-textarea';
                pTextarea.rows = 2;
                pTextarea.value = item.parts[def.key] || '';
                pTextarea.placeholder = def.placeholder;
                pTextarea.oninput = () => {
                    item.parts[def.key] = pTextarea.value.trim();
                };
                autocompleteHandles.push(
                    attachTagAutocomplete(pTextarea, { mode: 'lexicon-only' })
                );
                pBox.appendChild(pTextarea);
                partsSection.appendChild(pBox);
            }

            card.appendChild(partsSection);
        }

        body.appendChild(card);
    });

    panel.appendChild(body);

    // 4. 底部操作栏
    const footer = document.createElement('div');
    footer.className = 'da-lora-modal-footer';

    const footerLeft = document.createElement('div');
    footerLeft.className = 'da-lora-modal-footer__left da-archive-footer-left';

    const charCount = workingItems.filter((i) => i.kind === 'character').length;
    const outfitCount = workingItems.filter((i) => i.kind === 'outfit').length;
    const summaryText = document.createElement('span');
    summaryText.className = 'da-archive-summary-text';
    summaryText.textContent = `共提取 ${workingItems.length} 项档案（角色 ${charCount}，服装 ${outfitCount}）`;
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
    footerRight.className = 'da-lora-modal-footer__right';

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

    // 5. 事件处理与销毁
    const dispose = () => {
        if (isDisposed) return;
        isDisposed = true;
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
    overlayStack.push('archive-confirm-modal', () => dispose());

    closeBtn.onclick = () => dispose();
    cancelBtn.onclick = () => dispose();
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            dispose();
        }
    };

    confirmBtn.onclick = () => {
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
            if (strategy === 'skip' || !item.name.trim()) {
                continue;
            }

            const category = item.kind === 'character' ? 'characters' : 'outfits';
            const existingList =
                item.kind === 'character'
                    ? store.getPresets<CharacterPresetData>('characters')
                    : store.getPresets<OutfitPresetData>('outfits');

            const diff = computeArchiveDiff(item, existingList);
            const existingPreset = diff.existingPresetId
                ? existingList.find((p) => p.id === diff.existingPresetId)
                : undefined;

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
    };

    const handle: Disposable = { dispose };
    activeModalInstance = handle;
    return handle;
}
