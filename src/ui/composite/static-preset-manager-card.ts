/**
 * 本地预设按需管理卡片 (StaticPresetManagerCard)。
 *
 * @remarks
 * 参考本地词库「按需载入 / 卸载」交互模式：
 * 1. 基于 `settingsStore.getStaticPresetCatalog()` 按 5 大分类折叠展示全部本地预设；
 * 2. 支持单条「载入 / 卸载」、分类级「一键载入 / 一键卸载」与全局「全部载入 / 全部卸载」；
 * 3. 直接按需写入或移除本地预设池，不弹出覆盖确认弹窗。
 */

import type { Disposable, UIComponent } from '../types';
import {
    settingsStore,
    type OfficialPresetSyncCategory,
    type StaticPresetCatalogCategory,
    type StaticPresetCatalogItem,
} from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { Button } from '../components/button';
import { ICONS } from '../components/icons';
import { Toast } from '../feedback/toast';
import { logger } from '../../util/logger';

export interface StaticPresetManagerCardOptions {
    /** 卡片标题 */
    readonly title?: string;
    /** 附加类名 */
    readonly className?: string;
}

export class StaticPresetManagerCard implements UIComponent, Disposable {
    public readonly element: HTMLElement;

    private catalog: StaticPresetCatalogCategory[] = [];
    private isLoading = false;
    private isBusy = false;
    private isDisposed = false;
    private readonly expandedCategories = new Set<OfficialPresetSyncCategory>(['prompts']);

    private readonly summaryBadgeEl: HTMLElement;
    private readonly categoriesContainer: HTMLElement;
    private readonly loadAllBtn: Button;
    private readonly unloadAllBtn: Button;
    private readonly refreshBtn: Button;
    private unlistenSettings: (() => void) | null = null;

    public constructor(options: StaticPresetManagerCardOptions = {}) {
        this.element = document.createElement('div');
        this.element.className = ['da-sync-card', 'da-static-preset-card', options.className]
            .filter(Boolean)
            .join(' ');

        const header = document.createElement('div');
        header.className = 'da-sync-card__header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'da-sync-card__title-wrap';

        const titleEl = document.createElement('div');
        titleEl.className = 'da-sync-card__title';
        titleEl.textContent = options.title || '本地预设管理';
        titleWrap.appendChild(titleEl);

        const descEl = document.createElement('div');
        descEl.className = 'da-sync-card__desc';
        descEl.textContent =
            '按分类载入或卸载本地预设；卸载仅移除对应条目，不影响您自建的预设。';
        titleWrap.appendChild(descEl);

        header.appendChild(titleWrap);

        this.summaryBadgeEl = document.createElement('span');
        this.summaryBadgeEl.className = 'da-sync-card__badge';
        this.summaryBadgeEl.textContent = '正在读取清单...';
        header.appendChild(this.summaryBadgeEl);

        this.element.appendChild(header);

        const toolbar = document.createElement('div');
        toolbar.className = 'da-sync-card__actions da-static-preset-toolbar';

        this.loadAllBtn = new Button({
            label: '全部载入',
            variant: 'primary',
            size: 'sm',
            disabled: true,
            onClick: () => void this.handleLoadAll(),
        });
        this.unloadAllBtn = new Button({
            label: '全部卸载',
            variant: 'danger',
            size: 'sm',
            disabled: true,
            onClick: () => void this.handleUnloadAll(),
        });
        this.refreshBtn = new Button({
            label: '刷新',
            variant: 'ghost',
            size: 'sm',
            onClick: () => void this.refreshCatalog(true),
        });

        toolbar.appendChild(this.loadAllBtn.element);
        toolbar.appendChild(this.unloadAllBtn.element);
        toolbar.appendChild(this.refreshBtn.element);
        this.element.appendChild(toolbar);

        this.categoriesContainer = document.createElement('div');
        this.categoriesContainer.className = 'da-static-preset-categories';
        this.element.appendChild(this.categoriesContainer);

        this.unlistenSettings = eventBus.on('settings:updated', (payload) => {
            if (this.isDisposed || this.isBusy) return;
            if (!payload.keys || payload.keys.includes('presets')) {
                void this.refreshCatalog(false);
            }
        });

        void this.refreshCatalog(false);
    }

    public async refreshCatalog(forceReload: boolean): Promise<void> {
        if (this.isDisposed || this.isLoading) return;
        this.isLoading = true;
        this.updateControlsState();

        try {
            const nextCatalog = await settingsStore.getStaticPresetCatalog(
                forceReload ? { forceReload: true } : undefined
            );
            if (this.isDisposed) return;
            this.catalog = nextCatalog;
            this.renderCatalog();
        } catch (err) {
            if (this.isDisposed) return;
            logger.warn('[StaticPresetManagerCard] 读取静态预设目录失败:', err);
            this.summaryBadgeEl.textContent = '读取失败';
            this.summaryBadgeEl.className = 'da-sync-card__badge';
            this.categoriesContainer.innerHTML = '';
            const errEl = document.createElement('div');
            errEl.className = 'da-sync-card__hint';
            errEl.textContent = '无法读取本地预设清单，请点击「刷新」重试。';
            this.categoriesContainer.appendChild(errEl);
        } finally {
            this.isLoading = false;
            this.updateControlsState();
        }
    }

    private renderCatalog(): void {
        this.categoriesContainer.innerHTML = '';

        const totalLoaded = this.catalog.reduce((sum, c) => sum + c.loadedCount, 0);
        const totalAll = this.catalog.reduce((sum, c) => sum + c.totalCount, 0);

        this.summaryBadgeEl.textContent = `已载入 ${totalLoaded} / ${totalAll} 项`;
        this.summaryBadgeEl.className =
            totalLoaded === totalAll && totalAll > 0
                ? 'da-sync-card__badge da-sync-card__badge--ok'
                : 'da-sync-card__badge da-sync-card__badge--pending';

        for (const cat of this.catalog) {
            const section = document.createElement('div');
            section.className = 'da-static-preset-group';
            const isExpanded = this.expandedCategories.has(cat.category);

            const groupHeader = document.createElement('div');
            groupHeader.className = 'da-static-preset-group__header';
            groupHeader.onclick = () => {
                if (this.expandedCategories.has(cat.category)) {
                    this.expandedCategories.delete(cat.category);
                } else {
                    this.expandedCategories.add(cat.category);
                }
                this.renderCatalog();
            };

            const left = document.createElement('div');
            left.className = 'da-static-preset-group__left';

            const chevron = document.createElement('span');
            chevron.className = `da-static-preset-chevron${isExpanded ? ' is-expanded' : ''}`;
            chevron.innerHTML = ICONS.chevronRight;
            left.appendChild(chevron);

            const titleSpan = document.createElement('span');
            titleSpan.className = 'da-static-preset-group__title';
            titleSpan.textContent = cat.label;
            left.appendChild(titleSpan);

            const countSpan = document.createElement('span');
            countSpan.className = 'da-static-preset-group__count';
            countSpan.textContent = `${cat.loadedCount} / ${cat.totalCount}`;
            left.appendChild(countSpan);

            groupHeader.appendChild(left);

            const right = document.createElement('div');
            right.className = 'da-static-preset-group__actions';

            const unloadedKeys = cat.items.filter((i) => !i.loaded).map((i) => i.key);
            const loadedKeys = cat.items.filter((i) => i.loaded).map((i) => i.key);

            if (unloadedKeys.length > 0) {
                const loadCatBtn = document.createElement('button');
                loadCatBtn.type = 'button';
                loadCatBtn.className = 'da-btn da-btn--primary da-btn--sm';
                loadCatBtn.textContent = '载入本类';
                loadCatBtn.disabled = this.isBusy;
                loadCatBtn.onclick = (e) => {
                    e.stopPropagation();
                    void this.handleLoadKeys(unloadedKeys, `「${cat.label}」`);
                };
                right.appendChild(loadCatBtn);
            }

            if (loadedKeys.length > 0) {
                const unloadCatBtn = document.createElement('button');
                unloadCatBtn.type = 'button';
                unloadCatBtn.className = 'da-btn da-btn--danger da-btn--sm';
                unloadCatBtn.textContent = '卸载本类';
                unloadCatBtn.disabled = this.isBusy;
                unloadCatBtn.onclick = (e) => {
                    e.stopPropagation();
                    void this.handleUnloadKeys(loadedKeys, `「${cat.label}」`);
                };
                right.appendChild(unloadCatBtn);
            }

            groupHeader.appendChild(right);
            section.appendChild(groupHeader);

            if (isExpanded) {
                const listEl = document.createElement('div');
                listEl.className = 'da-static-preset-list';
                for (const item of cat.items) {
                    listEl.appendChild(this.createItemRow(item));
                }
                section.appendChild(listEl);
            }

            this.categoriesContainer.appendChild(section);
        }
    }

    private createItemRow(item: StaticPresetCatalogItem): HTMLElement {
        const row = document.createElement('div');
        row.className = `da-static-preset-row${item.loaded ? '' : ' is-unloaded'}`;

        const info = document.createElement('div');
        info.className = 'da-static-preset-row__info';

        const titleLine = document.createElement('div');
        titleLine.className = 'da-static-preset-row__title';

        const badge = document.createElement('span');
        badge.className = 'da-static-preset-row__bucket';
        badge.textContent = item.bucketLabel;
        titleLine.appendChild(badge);

        const nameEl = document.createElement('span');
        nameEl.className = 'da-static-preset-row__name';
        nameEl.textContent = item.officialName;
        titleLine.appendChild(nameEl);

        info.appendChild(titleLine);

        if (item.description) {
            const descEl = document.createElement('div');
            descEl.className = 'da-static-preset-row__desc';
            descEl.textContent = item.description;
            descEl.title = item.description;
            info.appendChild(descEl);
        }

        row.appendChild(info);

        const actionWrap = document.createElement('div');
        actionWrap.className = 'da-static-preset-row__action';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.disabled = this.isBusy;
        if (item.loaded) {
            btn.className = 'da-btn da-btn--danger da-btn--sm';
            btn.textContent = '卸载';
            btn.onclick = () => void this.handleUnloadKeys([item.key], `「${item.officialName}」`);
        } else {
            btn.className = 'da-btn da-btn--primary da-btn--sm';
            btn.textContent = '载入';
            btn.onclick = () => void this.handleLoadKeys([item.key], `「${item.officialName}」`);
        }
        actionWrap.appendChild(btn);
        row.appendChild(actionWrap);

        return row;
    }

    private async handleLoadAll(): Promise<void> {
        const keys = this.catalog.flatMap((c) =>
            c.items.filter((i) => !i.loaded).map((i) => i.key)
        );
        await this.handleLoadKeys(keys, '全部本地预设');
    }

    private async handleUnloadAll(): Promise<void> {
        const keys = this.catalog.flatMap((c) =>
            c.items.filter((i) => i.loaded).map((i) => i.key)
        );
        await this.handleUnloadKeys(keys, '全部本地预设');
    }

    private async handleLoadKeys(keys: readonly string[], label: string): Promise<void> {
        if (this.isDisposed || this.isBusy || keys.length === 0) return;
        this.isBusy = true;
        this.updateControlsState();
        try {
            const count = await settingsStore.loadStaticPresetItems(keys);
            if (this.isDisposed) return;
            await this.refreshCatalog(false);
            Toast.show(`已载入 ${label}（${count || keys.length} 项）`, { level: 'success' });
        } catch (err) {
            logger.error('[StaticPresetManagerCard] 载入本地预设失败:', err);
            Toast.show('载入本地预设失败，请稍后重试', { level: 'error' });
        } finally {
            this.isBusy = false;
            this.updateControlsState();
        }
    }

    private async handleUnloadKeys(keys: readonly string[], label: string): Promise<void> {
        if (this.isDisposed || this.isBusy || keys.length === 0) return;
        this.isBusy = true;
        this.updateControlsState();
        try {
            const count = await settingsStore.unloadStaticPresetItems(keys);
            if (this.isDisposed) return;
            await this.refreshCatalog(false);
            Toast.show(`已卸载 ${label}（${count} 项）`, { level: 'info' });
        } catch (err) {
            logger.error('[StaticPresetManagerCard] 卸载本地预设失败:', err);
            Toast.show('卸载本地预设失败，请稍后重试', { level: 'error' });
        } finally {
            this.isBusy = false;
            this.updateControlsState();
        }
    }

    private updateControlsState(): void {
        const disabled = this.isLoading || this.isBusy;
        const hasUnloaded = this.catalog.some((c) => c.items.some((i) => !i.loaded));
        const hasLoaded = this.catalog.some((c) => c.items.some((i) => i.loaded));
        this.loadAllBtn.setDisabled(disabled || !hasUnloaded);
        this.unloadAllBtn.setDisabled(disabled || !hasLoaded);
        this.refreshBtn.setDisabled(disabled);
        const innerBtns = this.categoriesContainer.querySelectorAll('button');
        innerBtns.forEach((btn) => {
            btn.disabled = disabled;
        });
    }

    public dispose(): void {
        this.isDisposed = true;
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
        this.loadAllBtn.dispose();
        this.unloadAllBtn.dispose();
        this.refreshBtn.dispose();
        this.element.parentElement?.removeChild(this.element);
    }
}
