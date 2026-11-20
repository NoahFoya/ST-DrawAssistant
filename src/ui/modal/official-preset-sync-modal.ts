/**
 * 官方预设差异明细与选择性更新独立弹窗 (OfficialPresetSyncModal)。
 *
 * @remarks
 * 将「非破坏性更新」与「恢复出厂设置」职责彻底分离：
 * 1. 按分类展示每一条存在差异的官方预设（「新增」/「官方有更新」/「改名并更新」）；
 * 2. 默认仅勾选「新增」项，已有同名/同 ID 预设需用户主动勾选才覆盖，防止误覆盖已微调的默认参数；
 * 3. 支持「仅选新增项」「全选变更项」「清空选择」快捷切换，复用 .da-submodal-* 统一规范。
 */

import type { Disposable } from '../types';
import {
    settingsStore,
    type OfficialPresetDiffItem,
    type OfficialPresetSyncResult,
} from '../../store/settings-store';
import { updateService } from '../../pipeline/update-service';
import { renderIcon } from '../components/icons';
import { bindBackdropDismiss, overlayStack } from '../framework/overlay-stack';
import { Toast } from '../feedback/toast';
import { logger } from '../../util/logger';

export interface OfficialPresetSyncModalOptions {
    /** 预先计算好的差异预览结果（未传时打开后自动加载） */
    readonly initialPreview?: OfficialPresetSyncResult | null;
    /** 同步完成回调 */
    readonly onSyncComplete?: (result: OfficialPresetSyncResult) => void;
    /** 弹窗关闭回调 */
    readonly onClose?: () => void;
}

let activeSyncModalInstance: Disposable | null = null;

/**
 * 弹出官方预设差异明细与选择性更新独立弹窗。
 */
export function openOfficialPresetSyncModal(
    options: OfficialPresetSyncModalOptions = {}
): Disposable {
    if (typeof document === 'undefined') {
        return { dispose: () => {} };
    }

    if (activeSyncModalInstance) {
        activeSyncModalInstance.dispose();
        activeSyncModalInstance = null;
    }

    let isDisposed = false;
    let isApplying = false;
    let preview: OfficialPresetSyncResult | null = options.initialPreview ?? null;
    const selectedKeys = new Set<string>();
    const checkboxMap = new Map<string, HTMLInputElement>();
    const allDiffItems: OfficialPresetDiffItem[] = [];

    const seedDefaultSelection = (res: OfficialPresetSyncResult | null) => {
        selectedKeys.clear();
        if (!res) return;
        for (const cat of res.categories) {
            for (const item of cat.items) {
                if (item.kind === 'add') {
                    selectedKeys.add(item.key);
                }
            }
        }
    };
    seedDefaultSelection(preview);

    // 1. 全屏遮罩与居中外壳（复用 .da-submodal-* 规范）
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-submodal-backdrop da-sync-modal-backdrop';

    const panel = document.createElement('div');
    panel.className = 'da-modal-shell da-submodal-panel da-sync-modal-panel';

    // 2. 顶栏
    const header = document.createElement('div');
    header.className = 'da-submodal-header da-sync-modal-header';

    const titleBox = document.createElement('div');
    titleBox.className = 'da-submodal-title-group da-sync-modal-title-group';

    const titleText = document.createElement('span');
    titleText.className = 'da-submodal-title da-sync-modal-title';
    titleText.textContent = '官方预设差异与选择性更新';
    titleBox.appendChild(titleText);

    const subtitleText = document.createElement('span');
    subtitleText.className = 'da-submodal-subtitle da-sync-modal-subtitle';
    subtitleText.textContent =
        '默认仅勾选缺失的新增官方预设；已有官方预设（含您微调过参数的条目）需主动勾选才会覆盖更新';
    titleBox.appendChild(subtitleText);
    header.appendChild(titleBox);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'da-submodal-close da-sync-modal-close';
    closeBtn.innerHTML = renderIcon('close', 16);
    closeBtn.title = '关闭 (Esc)';
    closeBtn.setAttribute('aria-label', '关闭弹窗');
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 3. 主体区域
    const body = document.createElement('div');
    body.className = 'da-submodal-body da-sync-modal-body';

    const toolbar = document.createElement('div');
    toolbar.className = 'da-sync-modal-toolbar';

    const toolbarLabel = document.createElement('span');
    toolbarLabel.className = 'da-sync-modal-toolbar__label';
    toolbarLabel.textContent = '快捷选择:';
    toolbar.appendChild(toolbarLabel);

    const selectAddsOnlyBtn = document.createElement('button');
    selectAddsOnlyBtn.type = 'button';
    selectAddsOnlyBtn.className = 'da-btn da-btn--secondary da-btn--sm';
    selectAddsOnlyBtn.textContent = '仅选新增项';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.className = 'da-btn da-btn--ghost da-btn--sm';
    selectAllBtn.textContent = '全选变更项';

    const clearAllBtn = document.createElement('button');
    clearAllBtn.type = 'button';
    clearAllBtn.className = 'da-btn da-btn--ghost da-btn--sm';
    clearAllBtn.textContent = '清空选择';

    toolbar.appendChild(selectAddsOnlyBtn);
    toolbar.appendChild(selectAllBtn);
    toolbar.appendChild(clearAllBtn);
    body.appendChild(toolbar);

    const listContainer = document.createElement('div');
    listContainer.className = 'da-sync-modal-list';
    body.appendChild(listContainer);
    panel.appendChild(body);

    // 4. 底栏
    const footer = document.createElement('div');
    footer.className = 'da-submodal-footer da-sync-modal-footer';

    const leftSummary = document.createElement('div');
    leftSummary.className = 'da-submodal-footer__left da-sync-modal-footer__summary';

    const rightActions = document.createElement('div');
    rightActions.className = 'da-submodal-footer__right da-sync-modal-footer__actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'da-btn da-btn--ghost da-btn--sm';
    cancelBtn.textContent = '取消';

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'da-btn da-btn--primary da-btn--sm';
    applyBtn.textContent = '应用所选同步';

    rightActions.appendChild(cancelBtn);
    rightActions.appendChild(applyBtn);
    footer.appendChild(leftSummary);
    footer.appendChild(rightActions);
    panel.appendChild(footer);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    const syncFooterSummary = () => {
        let addSelected = 0;
        let updateSelected = 0;
        for (const item of allDiffItems) {
            if (!selectedKeys.has(item.key)) continue;
            if (item.kind === 'add') addSelected += 1;
            else updateSelected += 1;
        }
        const total = addSelected + updateSelected;
        if (total === 0) {
            leftSummary.textContent = '未选择任何同步项';
        } else {
            leftSummary.textContent = `已选 ${total} 项（新增 ${addSelected} · 覆盖更新 ${updateSelected}）`;
        }
        applyBtn.disabled = isApplying || total === 0;
        applyBtn.textContent = isApplying
            ? '正在同步...'
            : total > 0
              ? `应用所选 (${total})`
              : '应用所选同步';
    };

    const syncCheckboxInputs = () => {
        for (const [key, input] of checkboxMap.entries()) {
            input.checked = selectedKeys.has(key);
        }
        syncFooterSummary();
    };

    const renderList = () => {
        listContainer.innerHTML = '';
        checkboxMap.clear();
        allDiffItems.length = 0;

        if (!preview) {
            const empty = document.createElement('div');
            empty.className = 'da-sync-modal-empty';
            empty.textContent = '正在加载官方预设差异...';
            listContainer.appendChild(empty);
            syncFooterSummary();
            return;
        }

        const totalDiffs = preview.totalAddCount + preview.totalOverwriteCount;
        if (totalDiffs === 0) {
            const empty = document.createElement('div');
            empty.className = 'da-sync-modal-empty';
            empty.textContent = '当前全部官方预设已是最新版本，无需更新。';
            listContainer.appendChild(empty);
            syncFooterSummary();
            return;
        }

        for (const cat of preview.categories) {
            const section = document.createElement('div');
            section.className = 'da-sync-modal-group';

            const catHeader = document.createElement('div');
            catHeader.className = 'da-sync-modal-group__header';

            const catTitle = document.createElement('span');
            catTitle.className = 'da-sync-modal-group__title';
            catTitle.textContent = cat.label;

            const catStat = document.createElement('span');
            catStat.className = 'da-sync-modal-group__stat';
            if (cat.items.length === 0) {
                catStat.textContent = '已是最新';
            } else {
                const parts: string[] = [];
                if (cat.addCount > 0) parts.push(`新增 ${cat.addCount}`);
                if (cat.overwriteCount > 0) parts.push(`可更新 ${cat.overwriteCount}`);
                catStat.textContent = parts.join(' · ');
            }

            catHeader.appendChild(catTitle);
            catHeader.appendChild(catStat);
            section.appendChild(catHeader);

            if (cat.items.length > 0) {
                const itemsWrap = document.createElement('div');
                itemsWrap.className = 'da-sync-modal-group__items';

                for (const item of cat.items) {
                    allDiffItems.push(item);

                    const row = document.createElement('label');
                    row.className = 'da-sync-modal-item';

                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'da-sync-card__checkbox';
                    cb.checked = selectedKeys.has(item.key);
                    cb.addEventListener('change', () => {
                        if (cb.checked) selectedKeys.add(item.key);
                        else selectedKeys.delete(item.key);
                        syncFooterSummary();
                    });
                    checkboxMap.set(item.key, cb);

                    const info = document.createElement('div');
                    info.className = 'da-sync-modal-item__info';

                    const nameEl = document.createElement('div');
                    nameEl.className = 'da-sync-modal-item__name';
                    nameEl.textContent =
                        item.renamed && item.localName
                            ? `${item.localName} → ${item.officialName}`
                            : item.officialName;
                    info.appendChild(nameEl);

                    const metaEl = document.createElement('div');
                    metaEl.className = 'da-sync-modal-item__meta';
                    metaEl.textContent = item.description
                        ? `${item.bucketLabel} · ${item.description}`
                        : item.bucketLabel;
                    info.appendChild(metaEl);

                    const tag = document.createElement('span');
                    tag.className =
                        item.kind === 'add'
                            ? 'da-sync-modal-tag da-sync-modal-tag--add'
                            : 'da-sync-modal-tag da-sync-modal-tag--update';
                    tag.textContent =
                        item.kind === 'add'
                            ? '新增'
                            : item.renamed
                              ? '改名并更新'
                              : '官方有更新';
                    if (item.kind === 'update') {
                        tag.title = '勾选后将用新版官方定义覆盖您当前该预设的内容';
                    }

                    row.appendChild(cb);
                    row.appendChild(info);
                    row.appendChild(tag);
                    itemsWrap.appendChild(row);
                }

                section.appendChild(itemsWrap);
            }

            listContainer.appendChild(section);
        }

        syncFooterSummary();
    };

    selectAddsOnlyBtn.addEventListener('click', () => {
        selectedKeys.clear();
        for (const item of allDiffItems) {
            if (item.kind === 'add') selectedKeys.add(item.key);
        }
        syncCheckboxInputs();
    });

    selectAllBtn.addEventListener('click', () => {
        for (const item of allDiffItems) {
            selectedKeys.add(item.key);
        }
        syncCheckboxInputs();
    });

    clearAllBtn.addEventListener('click', () => {
        selectedKeys.clear();
        syncCheckboxInputs();
    });

    renderList();

    if (!preview) {
        void settingsStore
            .previewOfficialPresetSync({ loaderOptions: { forceReload: true } })
            .then((res) => {
                if (isDisposed) return;
                preview = res;
                seedDefaultSelection(preview);
                renderList();
            })
            .catch((err) => {
                if (isDisposed) return;
                logger.warn('[OfficialPresetSyncModal] 加载官方预设差异失败:', err);
                listContainer.innerHTML = '';
                const errEl = document.createElement('div');
                errEl.className = 'da-sync-modal-empty';
                errEl.textContent = '读取官方预设失败，请稍后重试。';
                listContainer.appendChild(errEl);
            });
    }

    const handleCancel = () => {
        dispose(true);
    };

    const unbindBackdrop = bindBackdropDismiss(backdrop, handleCancel);
    overlayStack.push('official-preset-sync-modal', handleCancel, () => dispose(false));

    function dispose(triggerOnClose = true): void {
        if (isDisposed) return;
        isDisposed = true;
        overlayStack.remove('official-preset-sync-modal');
        unbindBackdrop();
        backdrop.parentElement?.removeChild(backdrop);
        if (activeSyncModalInstance?.dispose === instance.dispose) {
            activeSyncModalInstance = null;
        }
        if (triggerOnClose) {
            options.onClose?.();
        }
    }

    closeBtn.addEventListener('click', handleCancel);
    cancelBtn.addEventListener('click', handleCancel);
    applyBtn.addEventListener('click', async () => {
        if (isApplying || selectedKeys.size === 0) return;
        isApplying = true;
        syncFooterSummary();

        try {
            const result = await settingsStore.syncOfficialPresets({
                mode: 'selected',
                selectedItemKeys: Array.from(selectedKeys),
                loaderOptions: { forceReload: true },
            });
            updateService.markChangelogAsSeen();
            Toast.show(
                `同步完成：新增 ${result.totalAddCount} 项，覆盖更新 ${result.totalOverwriteCount} 项（保留其余 ${result.totalCustomPreservedCount} 项）`,
                { level: 'success', duration: 4000 }
            );
            options.onSyncComplete?.(result);
            dispose(false);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('[OfficialPresetSyncModal] 执行官方预设同步失败:', err);
            Toast.show(`同步官方预设失败: ${msg}`, { level: 'error' });
        } finally {
            isApplying = false;
            if (!isDisposed) {
                syncFooterSummary();
            }
        }
    });

    const instance: Disposable = { dispose: () => dispose(true) };
    activeSyncModalInstance = instance;
    return instance;
}
