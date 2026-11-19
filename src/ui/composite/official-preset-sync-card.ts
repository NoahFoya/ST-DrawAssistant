/**
 * 官方预设快速同步复合卡片 (OfficialPresetSyncCard)。
 *
 * @remarks
 * 共用于更新说明弹窗 (ChangelogModal) 与「关于与维护」选项卡：
 * 1. 基于 `settingsStore.previewOfficialPresetSync()` 实时计算 5 大分类的差异统计；
 * 2. 支持按分类勾选同步（保护已微调的本地绘图参数等），默认全部勾选；
 * 3. 执行非破坏性覆盖式同步：仅覆盖同名官方预设与补充新增官方项，完整保留用户自建与改名副本。
 */

import type { Disposable, UIComponent } from '../types';
import {
    ALL_OFFICIAL_SYNC_CATEGORIES,
    settingsStore,
    type OfficialPresetCategoryDiff,
    type OfficialPresetSyncCategory,
    type OfficialPresetSyncResult,
} from '../../store/settings-store';
import { updateService } from '../../pipeline/update-service';
import { eventBus } from '../../util/event-bus';
import { Button } from '../components/button';
import { Toast } from '../feedback/toast';
import { logger } from '../../util/logger';

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
    if (diff.overwriteCount > 0) parts.push(`覆盖同名 ${diff.overwriteCount} 项`);
    if (diff.addCount > 0) parts.push(`新增 ${diff.addCount} 项`);
    if (parts.length === 0) return '已是最新';
    return parts.join(' · ');
}

export class OfficialPresetSyncCard implements UIComponent, Disposable {
    public readonly element: HTMLElement;

    private readonly selectedCategories = new Set<OfficialPresetSyncCategory>(
        ALL_OFFICIAL_SYNC_CATEGORIES
    );
    private latestPreview: OfficialPresetSyncResult | null = null;
    private isLoadingPreview = false;
    private isSyncing = false;
    private isDisposed = false;

    private readonly summaryBadgeEl: HTMLElement;
    private readonly categoriesContainer: HTMLElement;
    private readonly syncBtn: Button;
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
        titleEl.textContent = options.title || '官方预设快速同步（覆盖同名 + 补充新增）';
        titleWrap.appendChild(titleEl);

        const descEl = document.createElement('div');
        descEl.className = 'da-sync-card__desc';
        descEl.textContent =
            '仅覆盖更新与官方同名的默认预设并补充新增官方项（保留现有绑定 ID），不会删除或改动您的其他自定义预设。';
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

        this.syncBtn = new Button({
            label: '快速同步选中预设',
            variant: 'primary',
            size: 'sm',
            disabled: true,
            onClick: () => void this.handleSync(),
        });
        this.refreshBtn = new Button({
            label: '重新检测',
            variant: 'ghost',
            size: 'sm',
            onClick: () => void this.refreshPreview(true),
        });

        footer.appendChild(this.syncBtn.element);
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
            const row = document.createElement('label');
            row.className = 'da-sync-card__category-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'da-sync-card__checkbox';
            checkbox.checked = this.selectedCategories.has(diff.category);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selectedCategories.add(diff.category);
                } else {
                    this.selectedCategories.delete(diff.category);
                }
                this.updateControlsState();
            });

            const labelText = document.createElement('span');
            labelText.className = 'da-sync-card__category-label';
            labelText.textContent = diff.label;

            const statText = document.createElement('span');
            statText.className =
                diff.overwriteCount > 0 || diff.addCount > 0
                    ? 'da-sync-card__category-stat da-sync-card__category-stat--pending'
                    : 'da-sync-card__category-stat';
            statText.textContent = formatDiffSummary(diff);

            row.appendChild(checkbox);
            row.appendChild(labelText);
            row.appendChild(statText);
            this.categoriesContainer.appendChild(row);
        }
    }

    private updateControlsState(): void {
        if (this.isLoadingPreview) {
            this.summaryBadgeEl.textContent = '正在检测差异...';
            this.summaryBadgeEl.className = 'da-sync-card__badge';
            this.syncBtn.setDisabled(true);
            this.refreshBtn.setDisabled(true);
            return;
        }

        this.refreshBtn.setDisabled(this.isSyncing);

        if (!this.latestPreview) {
            this.summaryBadgeEl.textContent = '检测失败';
            this.summaryBadgeEl.className = 'da-sync-card__badge';
            this.syncBtn.setDisabled(true);
            return;
        }

        let selectedOverwrite = 0;
        let selectedAdd = 0;
        for (const diff of this.latestPreview.categories) {
            if (this.selectedCategories.has(diff.category)) {
                selectedOverwrite += diff.overwriteCount;
                selectedAdd += diff.addCount;
            }
        }
        const hasPendingChanges = selectedOverwrite + selectedAdd > 0;
        const preserved = this.latestPreview.totalCustomPreservedCount;

        if (this.isSyncing) {
            this.syncBtn.setLabel('正在同步...');
            this.syncBtn.setDisabled(true);
            return;
        }

        if (this.latestPreview.totalOverwriteCount + this.latestPreview.totalAddCount === 0) {
            this.summaryBadgeEl.textContent = `全部官方预设已最新${preserved > 0 ? ` · 保留自建 ${preserved} 项` : ''}`;
            this.summaryBadgeEl.className = 'da-sync-card__badge da-sync-card__badge--ok';
            this.syncBtn.setLabel('官方预设已是最新');
            this.syncBtn.setDisabled(true);
        } else if (!hasPendingChanges) {
            this.summaryBadgeEl.textContent = '未勾选存在变更的分类';
            this.summaryBadgeEl.className = 'da-sync-card__badge';
            this.syncBtn.setLabel('请选择需同步的分类');
            this.syncBtn.setDisabled(true);
        } else {
            this.summaryBadgeEl.textContent = `待更新 ${selectedOverwrite} 项 · 新增 ${selectedAdd} 项${preserved > 0 ? ` · 保留自建 ${preserved} 项` : ''}`;
            this.summaryBadgeEl.className = 'da-sync-card__badge da-sync-card__badge--pending';
            this.syncBtn.setLabel(`快速同步 (${selectedOverwrite + selectedAdd} 项变更)`);
            this.syncBtn.setDisabled(false);
        }
    }

    private async handleSync(): Promise<void> {
        if (this.isSyncing || this.selectedCategories.size === 0) return;
        this.isSyncing = true;
        this.updateControlsState();

        try {
            const result = await settingsStore.syncOfficialPresets({
                categories: Array.from(this.selectedCategories),
                loaderOptions: { forceReload: true },
            });
            updateService.markChangelogAsSeen();
            Toast.show(
                `同步完成：覆盖同名 ${result.totalOverwriteCount} 项，补充新增 ${result.totalAddCount} 项（已保留自建 ${result.totalCustomPreservedCount} 项）`,
                {
                    level: 'success',
                    duration: 4000,
                }
            );
            this.options.onSyncComplete?.(result);
            await this.refreshPreview(false);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('[OfficialPresetSyncCard] 同步官方预设失败:', err);
            Toast.show(`同步官方预设失败: ${msg}`, { level: 'error' });
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
        this.syncBtn.dispose();
        this.refreshBtn.dispose();
        this.element.parentElement?.removeChild(this.element);
    }
}
