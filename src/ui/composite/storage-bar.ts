/**
 * 本地持久化存储监控与分级维护卡片 (StorageBar)。
 *
 * @remarks
 * 负责呈现浏览器 IndexedDB 存储使用量与资产分布，并提供安全的分级清理能力：
 * 1. 存储容量水位预警：动态计算已用容量与配额上限，使用率超 75% 切换预警色，超 90% 切换危险告警色；
 * 2. 资产统计分布展示：呈现总图片数、标星收藏数、未标星草稿数与生成失败记录；
 * 3. 分级清理控制：支持清理失败记录、清理未收藏草稿与清空全部存储；
 * 4. 操作确认防护：在清空等操作执行前，通过确认回调或原生确认框校验用户意图，
 *    在无确认通道时默认终止操作，避免资产被非预期删除。
 */

import type { UIComponent } from '../types';
import { Card } from '../components/card';
import { Button } from '../components/button';
import { ConfirmDialog } from '../feedback/confirm-dialog';

/** 存储统计概览数据模型 */
export interface StorageSummaryData {
    /** 已用存储字节数 */
    readonly usedBytes: number;
    /** 总配额字节数 */
    readonly totalBytes: number;
    /** 容量使用百分比 (0 ~ 100) */
    readonly usagePercentage: number;
    /** 缓存图片总数 */
    readonly totalImages: number;
    /** 标星收藏图片数 */
    readonly favoritedImages: number;
    /** 未标星草稿图片数 */
    readonly unfavoritedImages: number;
    /** 生成失败记录数 */
    readonly failedCount: number;
}

/** 异步或同步确认处理函数类型定义 */
export type StorageConfirmHandler = (message: string) => Promise<boolean> | boolean;

/** 存储卡片配置选项 */
export interface StorageBarOptions {
    /** 卡片主标题，默认 '本地存储空间 (IndexedDB)' */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** 初始存储数据 */
    initialData?: StorageSummaryData;
    /** 自定义操作确认处理器（未提供时使用全局确认对话框 ConfirmDialog.confirm） */
    confirmHandler?: StorageConfirmHandler;
    /** 刷新存储配额回调 */
    onRefresh?: () => void | Promise<void>;
    /** 清理失败记录回调 */
    onCleanFailed?: () => void | Promise<void>;
    /** 清理未标星草稿回调 */
    onCleanUnfavorited?: () => void | Promise<void>;
    /** 清空全部存储回调 */
    onClearAll?: () => void | Promise<void>;
    /** 附加 CSS 类名 */
    className?: string;
}

const DEFAULT_STORAGE: StorageSummaryData = {
    usedBytes: 0,
    totalBytes: 1024 * 1024 * 1024,
    usagePercentage: 0,
    totalImages: 0,
    favoritedImages: 0,
    unfavoritedImages: 0,
    failedCount: 0,
};

/**
 * 存储监控与维护卡片实现类。
 */
export class StorageBar implements UIComponent {
    public readonly element: HTMLElement;
    private readonly card: Card;

    private readonly confirmHandler?: StorageConfirmHandler;

    // 头部刷新按钮
    private readonly refreshBtn?: Button;

    // 操作按钮
    private cleanFailedBtn?: Button;
    private cleanUnfavoritedBtn?: Button;
    private clearAllBtn?: Button;

    // 进度条与标签 DOM 引用
    private usageTextEl!: HTMLElement;
    private pctBadgeEl!: HTMLElement;
    private fillBarEl!: HTMLElement;

    // 资产分布统计 DOM 引用
    private totalCountEl!: HTMLElement;
    private favCountEl!: HTMLElement;
    private unfavCountEl!: HTMLElement;
    private failedCountEl!: HTMLElement;

    private currentData: StorageSummaryData;

    public constructor(options: StorageBarOptions = {}) {
        this.currentData = options.initialData ?? DEFAULT_STORAGE;
        this.confirmHandler = options.confirmHandler;

        // 1. 初始化标准 Card 容器
        this.card = new Card({
            title: options.title ?? '本地存储空间 (IndexedDB)',
            subtitle: options.subtitle ?? '浏览器配额使用量、资产分布与分级安全清理',
        });

        this.element = this.card.element;
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 2. 头部右上角刷新按钮
        if (options.onRefresh) {
            this.refreshBtn = new Button({
                label: '刷新',
                variant: 'ghost',
                size: 'sm',
                onClick: async () => {
                    try {
                        this.setActionLoading('refresh', true);
                        await options.onRefresh?.();
                    } finally {
                        this.setActionLoading('refresh', false);
                    }
                },
            });
            this.card.setHeaderActions(this.refreshBtn.element);
        }

        // 3. 构建卡片主体内容区
        this.buildContent(options);

        // 4. 初始数据渲染
        this.update(this.currentData);
    }

    /**
     * 动态局部更新存储用量与资产统计。
     *
     * @param data 最新存储统计数据
     */
    public update(data: StorageSummaryData): void {
        this.currentData = data;

        const usedFormatted = this.formatBytes(data.usedBytes);
        const totalFormatted = this.formatBytes(data.totalBytes);
        const pct = Math.max(0, Math.min(100, data.usagePercentage));

        // 1. 进度条文字与宽度
        this.usageTextEl.textContent = `已用容量: ${usedFormatted} / ${totalFormatted}`;
        this.pctBadgeEl.textContent = `${pct.toFixed(1)}%`;
        this.fillBarEl.style.width = `${pct.toFixed(1)}%`;

        // 2. 水位变体色彩切换
        this.pctBadgeEl.classList.remove('is-warning', 'is-danger');
        this.fillBarEl.classList.remove('is-warning', 'is-danger');

        if (pct >= 90) {
            this.pctBadgeEl.classList.add('is-danger');
            this.fillBarEl.classList.add('is-danger');
        } else if (pct >= 75) {
            this.pctBadgeEl.classList.add('is-warning');
            this.fillBarEl.classList.add('is-warning');
        }

        // 3. 资产分布指标
        this.totalCountEl.textContent = `${data.totalImages} 张`;
        this.favCountEl.textContent = `${data.favoritedImages} 张`;
        this.unfavCountEl.textContent = `${data.unfavoritedImages} 张`;
        this.failedCountEl.textContent = `${data.failedCount} 项`;

        // 4. 动态更新按钮禁用状态
        if (this.cleanFailedBtn) {
            this.cleanFailedBtn.setDisabled(data.failedCount === 0);
        }
        if (this.cleanUnfavoritedBtn) {
            this.cleanUnfavoritedBtn.setDisabled(data.unfavoritedImages === 0);
        }
    }

    /**
     * 设置指定动作按钮的 Loading 状态。
     */
    public setActionLoading(
        action: 'refresh' | 'failed' | 'unfavorited' | 'clearAll',
        loading: boolean
    ): void {
        switch (action) {
            case 'refresh':
                this.refreshBtn?.setLoading(loading);
                break;
            case 'failed':
                this.cleanFailedBtn?.setLoading(loading);
                break;
            case 'unfavorited':
                this.cleanUnfavoritedBtn?.setLoading(loading);
                break;
            case 'clearAll':
                this.clearAllBtn?.setLoading(loading);
                break;
        }
    }

    /**
     * 获取当前存储数据快照。
     */
    public getData(): StorageSummaryData {
        return { ...this.currentData };
    }

    /**
     * 销毁组件与内部所有子控件。
     */
    public dispose(): void {
        this.refreshBtn?.dispose();
        this.cleanFailedBtn?.dispose();
        this.cleanUnfavoritedBtn?.dispose();
        this.clearAllBtn?.dispose();
        this.card.dispose();
    }

    // 私有辅助方法

    private buildContent(options: StorageBarOptions): void {
        const body = this.card.getBodyElement();

        // 1. 存储进度条区域
        const progressWrapper = document.createElement('div');
        progressWrapper.className = 'da-storage-progress-wrapper';

        const labelRow = document.createElement('div');
        labelRow.className = 'da-storage-label-row';

        this.usageTextEl = document.createElement('span');
        this.usageTextEl.className = 'da-storage-label';
        this.usageTextEl.textContent = '已用容量: 0 B / 1.0 GB';

        this.pctBadgeEl = document.createElement('span');
        this.pctBadgeEl.className = 'da-storage-pct-badge';
        this.pctBadgeEl.textContent = '0.0%';

        labelRow.appendChild(this.usageTextEl);
        labelRow.appendChild(this.pctBadgeEl);
        progressWrapper.appendChild(labelRow);

        const trackEl = document.createElement('div');
        trackEl.className = 'da-storage-track';

        this.fillBarEl = document.createElement('div');
        this.fillBarEl.className = 'da-storage-fill';
        this.fillBarEl.style.width = '0%';

        trackEl.appendChild(this.fillBarEl);
        progressWrapper.appendChild(trackEl);
        body.appendChild(progressWrapper);

        // 2. 资产分布 4 列指标网格
        const statsGrid = document.createElement('div');
        statsGrid.className = 'da-stat-grid';
        statsGrid.style.marginTop = '12px';

        const totalCard = this.createSummaryItem('全部图片', '0 张');
        this.totalCountEl = totalCard.valEl;
        statsGrid.appendChild(totalCard.cardEl);

        const favCard = this.createSummaryItem('★ 标星收藏', '0 张');
        this.favCountEl = favCard.valEl;
        statsGrid.appendChild(favCard.cardEl);

        const unfavCard = this.createSummaryItem('未标星草稿', '0 张');
        this.unfavCountEl = unfavCard.valEl;
        statsGrid.appendChild(unfavCard.cardEl);

        const failedCard = this.createSummaryItem('失败记录', '0 项');
        this.failedCountEl = failedCard.valEl;
        statsGrid.appendChild(failedCard.cardEl);

        body.appendChild(statsGrid);

        // 3. 存储维护三档工具条
        const actionsToolbar = document.createElement('div');
        actionsToolbar.className = 'da-storage-actions-toolbar';
        actionsToolbar.style.marginTop = '12px';
        actionsToolbar.style.display = 'flex';
        actionsToolbar.style.flexWrap = 'wrap';
        actionsToolbar.style.gap = '8px';

        // 档位 1：清理失败记录
        if (options.onCleanFailed) {
            this.cleanFailedBtn = new Button({
                label: '清理失败记录',
                variant: 'secondary',
                size: 'sm',
                onClick: async () => {
                    try {
                        this.setActionLoading('failed', true);
                        await options.onCleanFailed?.();
                    } finally {
                        this.setActionLoading('failed', false);
                    }
                },
            });
            actionsToolbar.appendChild(this.cleanFailedBtn.element);
        }

        // 档位 2：清理未标星草稿（二次确认保护）
        if (options.onCleanUnfavorited) {
            this.cleanUnfavoritedBtn = new Button({
                label: '清理未收藏图片',
                variant: 'secondary',
                size: 'sm',
                onClick: async () => {
                    const confirmed = await this.confirmAction(
                        '确定要清理全部未标星的草稿图片吗？已标星的收藏图片将完整保留。'
                    );
                    if (!confirmed) return;

                    try {
                        this.setActionLoading('unfavorited', true);
                        await options.onCleanUnfavorited?.();
                    } finally {
                        this.setActionLoading('unfavorited', false);
                    }
                },
            });
            actionsToolbar.appendChild(this.cleanUnfavoritedBtn.element);
        }

        // 档位 3：清空全部存储（破坏性二次确认保护）
        if (options.onClearAll) {
            this.clearAllBtn = new Button({
                label: '清空全部存储',
                variant: 'danger',
                size: 'sm',
                onClick: async () => {
                    const confirmed = await this.confirmAction(
                        '警告：此操作将清空包含收藏在内的全部本地缓存图片，不可恢复！是否确认清空？'
                    );
                    if (!confirmed) return;

                    try {
                        this.setActionLoading('clearAll', true);
                        await options.onClearAll?.();
                    } finally {
                        this.setActionLoading('clearAll', false);
                    }
                },
            });
            actionsToolbar.appendChild(this.clearAllBtn.element);
        }

        if (actionsToolbar.hasChildNodes()) {
            body.appendChild(actionsToolbar);
        }
    }

    private createSummaryItem(label: string, defaultVal: string): { cardEl: HTMLElement; valEl: HTMLElement } {
        const cardEl = document.createElement('div');
        cardEl.className = 'da-stat-card';

        const labelEl = document.createElement('div');
        labelEl.className = 'da-stat-card__label';
        labelEl.textContent = label;
        cardEl.appendChild(labelEl);

        const valEl = document.createElement('div');
        valEl.className = 'da-stat-card__val';
        valEl.textContent = defaultVal;
        cardEl.appendChild(valEl);

        return { cardEl, valEl };
    }

    private formatBytes(bytes: number): string {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        const val = bytes / Math.pow(1024, i);
        return `${val.toFixed(1)} ${units[i]}`;
    }

    /**
     * 请求用户操作确认。
     *
     * @remarks
     * 优先调用外部传入的异步确认处理器；
     * 若未提供则调用全局模态确认对话框 ConfirmDialog.confirm；
     * 若当前环境不支持确认交互，默认终止操作以保护数据安全。
     */
    private async confirmAction(message: string): Promise<boolean> {
        if (this.confirmHandler) {
            try {
                return await this.confirmHandler(message);
            } catch {
                return false;
            }
        }

        return ConfirmDialog.confirm({
            title: '存储清理确认',
            message,
            isDanger: true,
        });
    }
}
