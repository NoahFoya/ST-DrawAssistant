/**
 * 本地持久化存储监控条与操作栏组件 (StorageBar)
 *
 * 功能：
 * 1. 展示 IndexedDB 存储使用量占比与进度高亮条；
 * 2. 呈现已用空间、总可用配额与历史生图总数 3 列核心统计卡片；
 * 3. 提供一键导出全量数据备份与清理历史记录操作入口。
 *
 * Tips：
 * 1. 提供标准展开与紧凑 (compact) 两种渲染形态；
 * 2. 存储容量超过 80% 或 90% 警戒线时自动切换高亮警示色。
 */

import type { StorageQuotaInfo } from '@types';
import { createStatCard, StatCardHandle } from './stat-card';
import { createButton, ButtonHandle } from '../components/button';
import { formatBytes } from '../../util/dom';

export interface StorageBarOptions {
    initialQuota?: StorageQuotaInfo;
    onExportBackup?: () => void | Promise<void>;
    onClearStorage?: () => void | Promise<void>;
    className?: string;
    compact?: boolean;
}

export interface StorageBarHandle {
    readonly element: HTMLElement;
    update(quota: StorageQuotaInfo): void;
    dispose(): void;
}

export function createStorageBar(options: StorageBarOptions): StorageBarHandle {
    const root = document.createElement('div');
    root.className = 'da-storage-bar';
    if (options.className) root.classList.add(options.className);

    if (options.compact) {
        root.classList.add('da-storage-bar--compact');

        const infoRow = document.createElement('div');
        infoRow.className = 'da-storage-compact-info';

        const iconEl = document.createElement('span');
        iconEl.className = 'da-storage-icon';
        iconEl.textContent = '💾';

        const labelEl = document.createElement('span');
        labelEl.className = 'da-storage-label';
        labelEl.textContent = '本地存储:';

        const track = document.createElement('div');
        track.className = 'da-storage-track';

        const fill = document.createElement('div');
        fill.className = 'da-storage-fill';
        fill.style.width = '0%';
        track.appendChild(fill);

        const pctBadge = document.createElement('span');
        pctBadge.className = 'da-storage-pct-badge';
        pctBadge.textContent = '0.0 %';

        const summaryText = document.createElement('span');
        summaryText.className = 'da-storage-summary-text';
        summaryText.textContent = '0 B / 1.0 GB · 0 张图片';

        infoRow.appendChild(iconEl);
        infoRow.appendChild(labelEl);
        infoRow.appendChild(track);
        infoRow.appendChild(pctBadge);
        infoRow.appendChild(summaryText);
        root.appendChild(infoRow);

        const actionsToolbar = document.createElement('div');
        actionsToolbar.className = 'da-storage-actions-toolbar';

        let exportBtn: ButtonHandle | null = null;
        if (options.onExportBackup) {
            exportBtn = createButton({
                text: '导出备份',
                variant: 'secondary',
                size: 'sm',
                icon: 'download',
                onClick: async () => {
                    try {
                        exportBtn?.setLoading(true);
                        await options.onExportBackup?.();
                    } finally {
                        exportBtn?.setLoading(false);
                    }
                }
            });
            actionsToolbar.appendChild(exportBtn.element);
        }

        let clearBtn: ButtonHandle | null = null;
        if (options.onClearStorage) {
            clearBtn = createButton({
                text: '清理未收藏',
                variant: 'danger',
                size: 'sm',
                icon: 'trash',
                onClick: async () => {
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
                        const ok = window.confirm('确定要清理未标星收藏的图片缓存吗？未收藏的图片将被删除。');
                        if (!ok) return;
                    }
                    try {
                        clearBtn?.setLoading(true);
                        await options.onClearStorage?.();
                    } finally {
                        clearBtn?.setLoading(false);
                    }
                }
            });
            actionsToolbar.appendChild(clearBtn.element);
        }

        if (actionsToolbar.hasChildNodes()) {
            root.appendChild(actionsToolbar);
        }

        const applyCompactQuota = (quota: StorageQuotaInfo) => {
            const total = Math.max(1, quota.totalBytes);
            const used = Math.max(0, quota.usedBytes);
            const pct = Math.min(100, Math.max(0, (used / total) * 100));

            pctBadge.textContent = `${pct.toFixed(1)} %`;
            fill.style.width = `${pct.toFixed(1)}%`;

            pctBadge.classList.remove('is-warning', 'is-danger');
            fill.classList.remove('is-warning', 'is-danger');

            if (pct >= 90) {
                pctBadge.classList.add('is-danger');
                fill.classList.add('is-danger');
            } else if (pct >= 75) {
                pctBadge.classList.add('is-warning');
                fill.classList.add('is-warning');
            }

            summaryText.textContent = `${formatBytes(used)} / ${formatBytes(total)} · ${quota.imageCount} 张图片`;
        };

        if (options.initialQuota) {
            applyCompactQuota(options.initialQuota);
        }

        return {
            element: root,
            update(quota: StorageQuotaInfo): void {
                applyCompactQuota(quota);
            },
            dispose(): void {
                exportBtn?.dispose();
                clearBtn?.dispose();
                root.remove();
            }
        };
    }

    // 1. 顶部标签与百分比行 (标准仪表盘模式)
    const progressWrapper = document.createElement('div');
    progressWrapper.className = 'da-storage-progress-wrapper';

    const labelRow = document.createElement('div');
    labelRow.className = 'da-storage-label-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'da-storage-label';
    labelEl.textContent = 'IndexedDB 本地存储空间';

    const pctBadge = document.createElement('span');
    pctBadge.className = 'da-storage-pct-badge';
    pctBadge.textContent = '0.0 %';

    labelRow.appendChild(labelEl);
    labelRow.appendChild(pctBadge);
    progressWrapper.appendChild(labelRow);

    // 进度条轨道与填充条
    const track = document.createElement('div');
    track.className = 'da-storage-track';

    const fill = document.createElement('div');
    fill.className = 'da-storage-fill';
    fill.style.width = '0%';

    track.appendChild(fill);
    progressWrapper.appendChild(track);
    root.appendChild(progressWrapper);

    // 2. 3 列等宽统计指标网格
    const statsGrid = document.createElement('div');
    statsGrid.className = 'da-storage-stats-grid';

    const usedCard: StatCardHandle = createStatCard({
        label: '已用容量',
        value: '0',
        unit: 'MB',
        variant: 'info'
    });

    const countCard: StatCardHandle = createStatCard({
        label: '缓存图片',
        value: 0,
        unit: '张',
        variant: 'info'
    });

    const freeCard: StatCardHandle = createStatCard({
        label: '可用配额',
        value: '0',
        unit: 'MB',
        variant: 'info'
    });

    statsGrid.appendChild(usedCard.element);
    statsGrid.appendChild(countCard.element);
    statsGrid.appendChild(freeCard.element);
    root.appendChild(statsGrid);

    // 3. 底部快捷操作条带
    const actionsToolbar = document.createElement('div');
    actionsToolbar.className = 'da-storage-actions-toolbar da-card-actions-right';

    let exportBtn: ButtonHandle | null = null;
    if (options.onExportBackup) {
        exportBtn = createButton({
            text: '导出离线备份',
            variant: 'secondary',
            size: 'sm',
            icon: 'download',
            onClick: async () => {
                try {
                    exportBtn?.setLoading(true);
                    await options.onExportBackup?.();
                } finally {
                    exportBtn?.setLoading(false);
                }
            }
        });
        actionsToolbar.appendChild(exportBtn.element);
    }

    let clearBtn: ButtonHandle | null = null;
    if (options.onClearStorage) {
        clearBtn = createButton({
            text: '清空本地存储',
            variant: 'danger',
            size: 'sm',
            icon: 'trash',
            onClick: async () => {
                if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
                    const ok = window.confirm('确定要清空本地 IndexedDB 存储的所有图片吗？未备份的历史图片将永久丢失。');
                    if (!ok) return;
                }
                try {
                    clearBtn?.setLoading(true);
                    await options.onClearStorage?.();
                } finally {
                    clearBtn?.setLoading(false);
                }
            }
        });
        actionsToolbar.appendChild(clearBtn.element);
    }

    if (actionsToolbar.hasChildNodes()) {
        root.appendChild(actionsToolbar);
    }

    const applyQuota = (quota: StorageQuotaInfo) => {
        const total = Math.max(1, quota.totalBytes);
        const used = Math.max(0, quota.usedBytes);
        const free = Math.max(0, total - used);
        const pct = Math.min(100, Math.max(0, (used / total) * 100));

        pctBadge.textContent = `${pct.toFixed(1)} %`;
        fill.style.width = `${pct.toFixed(1)}%`;

        pctBadge.classList.remove('is-warning', 'is-danger');
        fill.classList.remove('is-warning', 'is-danger');

        if (pct >= 90) {
            pctBadge.classList.add('is-danger');
            fill.classList.add('is-danger');
        } else if (pct >= 75) {
            pctBadge.classList.add('is-warning');
            fill.classList.add('is-warning');
        }

        const [usedVal, usedUnit] = formatBytes(used).split(' ');
        usedCard.setValue(usedVal || '0', usedUnit || 'B');

        countCard.setValue(quota.imageCount, '张');

        const [freeVal, freeUnit] = formatBytes(free).split(' ');
        freeCard.setValue(freeVal || '0', freeUnit || 'B');
    };

    if (options.initialQuota) {
        applyQuota(options.initialQuota);
    }

    return {
        element: root,
        update(quota: StorageQuotaInfo): void {
            applyQuota(quota);
        },
        dispose(): void {
            usedCard.dispose();
            countCard.dispose();
            freeCard.dispose();
            exportBtn?.dispose();
            clearBtn?.dispose();
            root.remove();
        }
    };
}
