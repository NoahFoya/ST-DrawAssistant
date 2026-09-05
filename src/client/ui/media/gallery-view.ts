/**
 * @module ui/media/gallery-view
 * @description 本地图库画廊管理系统与资产存储仪表盘 (Gallery & Media Domain)
 */

import { IDisposable, StoredImageRecord } from '../../core';
import { StorageService } from '../../core/storage';
import { HostClient } from '../../core/host';
import { FeedbackService } from '../feedback/feedback';
import { openLightboxModal } from './lightbox-modal';

export interface StorageCardHandle extends HTMLElement, IDisposable {
    refresh: () => Promise<void>;
}

export interface GalleryManagerHandle extends HTMLElement, IDisposable {
    reload: () => Promise<void>;
}

/**
 * 渲染本地存储资产概览仪表盘组件
 */
export function renderStorageBar(
    storage?: StorageService,
    _hostClient?: HostClient,
    _onCleanCallback?: () => Promise<void> | void
): StorageCardHandle {
    const container = document.createElement('div') as unknown as StorageCardHandle;
    container.className = 'da-storage-bar da-storage-dashboard';

    // 1. 存储水位进度条区域
    const progressWrapper = document.createElement('div');
    progressWrapper.className = 'da-storage-progress-wrapper';

    const labelRow = document.createElement('div');
    labelRow.className = 'da-storage-label-row';

    const label = document.createElement('div');
    label.className = 'da-storage-label';
    label.textContent = '本地存储使用率计算中...';

    const pctBadge = document.createElement('span');
    pctBadge.className = 'da-storage-pct-badge';
    pctBadge.textContent = '0%';

    labelRow.appendChild(label);
    labelRow.appendChild(pctBadge);
    progressWrapper.appendChild(labelRow);

    const track = document.createElement('div');
    track.className = 'da-storage-track';

    const fill = document.createElement('div');
    fill.className = 'da-storage-fill';
    track.appendChild(fill);
    progressWrapper.appendChild(track);
    container.appendChild(progressWrapper);

    const statsWrapper = document.createElement('div');
    statsWrapper.className = 'da-storage-stats-grid';
    container.appendChild(statsWrapper);

    const refreshData = async () => {
        if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
            try {
                const est = await navigator.storage.estimate();
                const usedMB = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
                const quotaMB = ((est.quota || 0) / (1024 * 1024)).toFixed(0);
                const ratio = est.quota ? (est.usage || 0) / est.quota : 0;
                const pct = (ratio * 100).toFixed(1);

                label.textContent = `已用存储: ${usedMB} MB / 浏览器额度约 ${quotaMB} MB`;
                pctBadge.textContent = `${pct}%`;
                fill.style.width = `${Math.min(100, Math.max(0, parseFloat(pct)))}%`;
            } catch {
                label.textContent = '存储估算正常';
            }
        }

        if (storage) {
            try {
                const count = await storage.count();
                statsWrapper.innerHTML = `
                    <div class="da-storage-metric-card">
                        <div class="da-storage-metric-num">${count}</div>
                        <div class="da-storage-metric-label">本地生图总数</div>
                    </div>
                `;
            } catch {
                statsWrapper.innerHTML = '';
            }
        }
    };

    void refreshData();

    container.refresh = refreshData;
    container.dispose = () => {
        container.remove();
    };

    return container;
}

/**
 * 创建画廊列表动态管理器
 */
export function createGalleryManager(
    storage?: StorageService,
    _hostClient?: HostClient,
    onStorageChange?: () => Promise<void> | void
): GalleryManagerHandle {
    const root = document.createElement('div') as unknown as GalleryManagerHandle;
    root.className = 'da-gallery-manager';

    const grid = document.createElement('div');
    grid.className = 'da-gallery-grid';
    root.appendChild(grid);

    const trackedUrls = new Set<string>();

    const cleanupTrackedUrls = () => {
        trackedUrls.forEach((u) => {
            try {
                URL.revokeObjectURL(u);
            } catch {}
        });
        trackedUrls.clear();
    };

    const reload = async () => {
        cleanupTrackedUrls();
        grid.innerHTML = '';
        if (!storage) {
            grid.innerHTML = '<div style="color:var(--da-text-muted);text-align:center;padding:24px;">未挂载本地存储引擎</div>';
            return;
        }

        try {
            const records: StoredImageRecord[] = await storage.getAll();
            if (records.length === 0) {
                grid.innerHTML = '<div style="color:var(--da-text-muted);text-align:center;padding:24px;">暂无历史生图记录</div>';
                return;
            }

            records.forEach((record) => {
                const item = document.createElement('div');
                item.className = 'da-gallery-item';

                const img = document.createElement('img');
                const blob = record.thumbnailBlob || record.originalBlob;
                const url = URL.createObjectURL(blob);
                trackedUrls.add(url);
                img.src = url;
                img.loading = 'lazy';
                img.alt = record.prompt || 'Gallery Image';

                img.onclick = () => {
                    const origUrl = URL.createObjectURL(record.originalBlob);
                    trackedUrls.add(origUrl);
                    openLightboxModal(origUrl);
                };

                const delBtn = document.createElement('button');
                delBtn.className = 'da-gallery-item-del';
                delBtn.title = '删除此图片';
                delBtn.textContent = '✕';
                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    const ok = await FeedbackService.confirm({
                        title: '删除图片确认',
                        message: '确定要删除此图片吗？'
                    });
                    if (ok) {
                        await storage.delete(record.id);
                        URL.revokeObjectURL(url);
                        trackedUrls.delete(url);
                        item.remove();
                        await onStorageChange?.();
                        FeedbackService.toastSuccess('图片已删除');
                    }
                };

                item.appendChild(img);
                item.appendChild(delBtn);
                grid.appendChild(item);
            });
        } catch (err: any) {
            grid.innerHTML = `<div style="color:var(--da-error);text-align:center;padding:24px;">读取画廊失败: ${err?.message || err}</div>`;
        }
    };

    void reload();

    root.reload = reload;
    root.dispose = () => {
        cleanupTrackedUrls();
        root.remove();
    };

    return root;
}
