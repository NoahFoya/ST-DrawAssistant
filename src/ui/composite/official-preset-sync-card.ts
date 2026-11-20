/**
 * 官方预设更新摘要卡片 (OfficialPresetSyncCard)。
 *
 * @remarks
 * 共用于更新说明弹窗 (ChangelogModal) 与「关于与支持」选项卡：
 * 1. 基于 `settingsStore.previewOfficialPresetSync()` 实时汇总 5 大分类的「新增」与「官方有更新」统计；
 * 2. 提供一键「补充新增」（仅补充本地缺失的新官方预设，绝不覆盖用户已微调的参数）；
 * 3. 提供「查看差异并选择性更新...」打开独立弹窗，逐条勾选需要覆盖更新或新增的官方预设（与「恢复出厂设置」职责分离）。
 */

import type { Disposable, UIComponent } from '../types';
import {
    settingsStore,
    type OfficialPresetCategoryDiff,
    type OfficialPresetSyncResult,
} from '../../store/settings-store';
import { updateService } from '../../pipeline/update-service';
import { eventBus } from '../../util/event-bus';
import { Button } from '../components/button';
import { Toast } from '../feedback/toast';
import { logger } from '../../util/logger';
import { openOfficialPresetSyncModal } from '../modal/official-preset-sync-modal';

export interface OfficialPresetSyncCardOptions {
    /** 卡片标题 */
    readonly title?: string;
    /** 紧凑模式（用于更新弹窗内部），默认 false */
    readonly compact?: boolean;
    /** 同步完成后回调 */
    readonly onSyncComplete?: (result: OfficialPresetSyncResult) => void;
    /** 附加类名 */
    readonly className?: string;
}

function formatDiffSummary(diff: OfficialPresetCategoryDiff): string {
    const parts: string[] = [];
    if (diff.addCount > 0) parts.push(`新增 ${diff.addCount} 项`);
    if (diff.overwriteCount > 0) parts.push(`可更新 ${diff.overwriteCount} 项`);
    if (parts.length === 0) return '已是最新';
    return parts.join(' · ');
}

export class OfficialPresetSyncCard implements UIComponent, Disposable {
    public readonly element: HTMLElement;

    private latestPreview: OfficialPresetSyncResult | null = null;
    private isLoadingPreview = false;
    private isSyncing = false;
    private isDisposed = false;

    private readonly summaryBadgeEl: HTMLElement;
    private readonly categoriesContainer: HTMLElement;
    private readonly addOnlyBtn: Button;
    private readonly manageBtn: Button;
    private readonly refreshBtn: Button;
    private readonly options: OfficialPresetSyncCardOptions;
    private unlistenSettings: (() => void) | null = null;

    public constructor(options: OfficialPresetSyncCardOptions = {}) {
        this.options = options;

        this.element = document.createElement('div');
        this.element.className = [
            'da-sync-card',
            options.compact ? 'da-sync-card--compact' : '',
            options.className,
        ]
            .filter(Boolean)
            .join(' ');

        const header = document.createElement('div');
        header.className = 'da-sync-card__header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'da-sync-card__title-wrap';

        const titleEl = document.createElement('div');
        titleEl.className = 'da-sync-card__title';
        titleEl.textContent = options.title || '官方预设更新（增量补充与选择性同步）';
        titleWrap.appendChild(titleEl);

        const descEl = document.createElement('div');
        descEl.className = 'da-sync-card__desc';
        descEl.textContent =
            '「补充新增」仅导入缺失的新增官方预设，不改动您已调整的参数；若需更新已有官方预设，请点击「选择性更新」逐条勾选。';
        titleWrap.appendChild(descEl);

        header.appendChild(titleWrap);

        this.summaryBadgeEl = document.createElement('span');
        this.summaryBadgeEl.className = 'da-sync-card__badge';
        this.summaryBadgeEl.textContent = '正在检测差异...';
        header.appendChild(this.summaryBadgeEl);

        this.element.appendChild(header);

        this.categoriesContainer = document.createElement('div');
        this.categoriesContainer.className = 'da-sync-card__categories';
        this.element.appendChild(this.categoriesContainer);

        const footer = document.createElement('div');
        footer.className = 'da-sync-card__actions';

        this.addOnlyBtn = new Button({
            label: '补充新增预设',
            variant: 'primary',
            size: 'sm',
            disabled: true,
            onClick: () => void this.handleAddOnlySync(),
        });
        this.manageBtn = new Button({
            label: '查看差异并选择性更新...',
            variant: 'secondary',
            size: 'sm',
            disabled: true,
            onClick: () => this.handleOpenSyncModal(),
        });
        this.refreshBtn = new Button({
            label: '重新检测',
            variant: 'ghost',
            size: 'sm',
            onClick: () => void this.refreshPreview(true),
        });

        footer.appendChild(this.addOnlyBtn.element);
        footer.appendChild(this.manageBtn.element);
        footer.appendChild(this.refreshBtn.element);
        this.element.appendChild(footer);

        this.unlistenSettings = eventBus.on('settings:updated', (payload) => {
            if (this.isDisposed || this.isSyncing) return;
            if (
                !payload ||
                payload.isReset ||
                payload.key?.startsWith('presets') ||
                payload.keys?.includes('presets')
            ) {
                void this.refreshPreview(false);
            }
        });

        void this.refreshPreview(false);
    }

    public async refreshPreview(forceReload = false): Promise<void> {
        if (this.isDisposed || this.isLoadingPreview) return;
        this.isLoadingPreview = true;
        this.updateControlsState();

        try {
            this.latestPreview = await settingsStore.previewOfficialPresetSync({
                loaderOptions: forceReload ? { forceReload: true } : undefined,
            });
        } catch (err) {
            logger.warn('[OfficialPresetSyncCard] 预览官方预设差异失败:', err);
            this.latestPreview = null;
        } finally {
            this.isLoadingPreview = false;
            if (!this.isDisposed) {
                this.renderCategories();
                this.updateControlsState();
            }
        }
    }

    private renderCategories(): void {
        this.categoriesContainer.innerHTML = '';
        if (!this.latestPreview) {
            const errEl = document.createElement('div');
            errEl.className = 'da-sync-card__hint';
            errEl.textContent = '暂时无法读取官方预设文件，请点击「重新检测」重试。';
            this.categoriesContainer.appendChild(errEl);
            return;
        }

        for (const diff of this.latestPreview.categories) {
            const row = document.createElement('div');
            row.className = 'da-sync-card__category-item da-sync-card__category-item--readonly';

            const labelText = document.createElement('span');
            labelText.className = 'da-sync-card__category-label';
            labelText.textContent = diff.label;

            const statText = document.createElement('span');
            statText.className =
                diff.overwriteCount > 0 || diff.addCount > 0
                    ? 'da-sync-card__category-stat da-sync-card__category-stat--pending'
                    : 'da-sync-card__category-stat';
            statText.textContent = formatDiffSummary(diff);

            row.appendChild(labelText);
            row.appendChild(statText);
            this.categoriesContainer.appendChild(row);
        }
    }

    private updateControlsState(): void {
        if (this.isLoadingPreview) {
            this.summaryBadgeEl.textContent = '正在检测差异...';
            this.summaryBadgeEl.className = 'da-sync-card__badge';
            this.addOnlyBtn.setDisabled(true);
            this.manageBtn.setDisabled(true);
            this.refreshBtn.setDisabled(true);
            return;
        }

        this.refreshBtn.setDisabled(this.isSyncing);

        if (!this.latestPreview) {
            this.summaryBadgeEl.textContent = '检测失败';
            this.summaryBadgeEl.className = 'da-sync-card__badge';
            this.addOnlyBtn.setDisabled(true);
            this.manageBtn.setDisabled(true);
            return;
        }

        const addCount = this.latestPreview.totalAddCount;
        const updateCount = this.latestPreview.totalOverwriteCount;
        const preserved = this.latestPreview.totalCustomPreservedCount;
        const totalDiffs = addCount + updateCount;

        if (this.isSyncing) {
            this.addOnlyBtn.setLabel('正在补充...');
            this.addOnlyBtn.setDisabled(true);
            this.manageBtn.setDisabled(true);
            return;
        }

        if (totalDiffs === 0) {
            this.summaryBadgeEl.textContent = `全部官方预设已最新${preserved > 0 ? ` · 保留自建 ${preserved} 项` : ''}`;
            this.summaryBadgeEl.className = 'da-sync-card__badge da-sync-card__badge--ok';
            this.addOnlyBtn.setLabel('暂无新增预设');
            this.addOnlyBtn.setDisabled(true);
            this.manageBtn.setLabel('查看差异明细');
            this.manageBtn.setDisabled(true);
        } else {
            const badgeParts: string[] = [];
            if (addCount > 0) badgeParts.push(`新增 ${addCount} 项`);
            if (updateCount > 0) badgeParts.push(`可更新 ${updateCount} 项`);
            if (preserved > 0) badgeParts.push(`保留自建 ${preserved} 项`);
            this.summaryBadgeEl.textContent = badgeParts.join(' · ');
            this.summaryBadgeEl.className = 'da-sync-card__badge da-sync-card__badge--pending';

            this.addOnlyBtn.setLabel(addCount > 0 ? `补充新增 (${addCount} 项)` : '暂无新增预设');
            this.addOnlyBtn.setDisabled(addCount === 0);
            this.manageBtn.setLabel(`查看差异并选择性更新 (${totalDiffs})`);
            this.manageBtn.setDisabled(false);
        }
    }

    private handleOpenSyncModal(): void {
        openOfficialPresetSyncModal({
            initialPreview: this.latestPreview,
            onSyncComplete: (result) => {
                this.options.onSyncComplete?.(result);
                void this.refreshPreview(false);
            },
        });
    }

    private async handleAddOnlySync(): Promise<void> {
        if (this.isSyncing || !this.latestPreview || this.latestPreview.totalAddCount === 0) return;
        this.isSyncing = true;
        this.updateControlsState();

        try {
            const result = await settingsStore.syncOfficialPresets({
                mode: 'add-only',
                loaderOptions: { forceReload: true },
            });
            updateService.markChangelogAsSeen();
            Toast.show(
                `已安全补充 ${result.totalAddCount} 项新增官方预设（未覆盖任何已有预设）`,
                {
                    level: 'success',
                    duration: 4000,
                }
            );
            this.options.onSyncComplete?.(result);
            await this.refreshPreview(false);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('[OfficialPresetSyncCard] 补充新增官方预设失败:', err);
            Toast.show(`补充官方预设失败: ${msg}`, { level: 'error' });
        } finally {
            this.isSyncing = false;
            if (!this.isDisposed) {
                this.updateControlsState();
            }
        }
    }

    public dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
        this.addOnlyBtn.dispose();
        this.manageBtn.dispose();
        this.refreshBtn.dispose();
        this.element.parentElement?.removeChild(this.element);
    }
}
