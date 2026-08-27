/**
 * @module ui/media/gallery-view
 * @description 本地图库画廊管理中枢与存储配额指示条 (Gallery & Media Domain)
 */

import { IStorageAdapter, StoredImageRecord } from '../../core/state/storage-adapter';
import { IDisposable } from '../../core/foundation/disposable';
import { IHostBridge } from '../../core/foundation/host-bridge';
import { FeedbackService } from '../feedback/feedback';
import { openImageInfoPanel } from './image-info-panel';

/**
 * 渲染 IndexedDB 存储空间与配额占比指示条组件
 */
export function renderStorageBar(_options?: unknown): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-storage-bar';

    const label = document.createElement('div');
    label.className = 'da-storage-label';
    label.textContent = '本地 IndexedDB 存储使用率估算...';
    container.appendChild(label);

    const track = document.createElement('div');
    track.className = 'da-storage-track';

    const fill = document.createElement('div');
    fill.className = 'da-storage-fill';
    track.appendChild(fill);
    container.appendChild(track);

    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        navigator.storage
            .estimate()
            .then((est) => {
                const usedMB = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
                const quotaMB = ((est.quota || 0) / (1024 * 1024)).toFixed(0);
                const pct = est.quota ? (((est.usage || 0) / est.quota) * 100).toFixed(1) : '0';

                label.textContent = `已用空间: ${usedMB} MB / 额度约 ${quotaMB} MB (${pct}%)`;
                fill.style.width = `${pct}%`;
            })
            .catch(() => {
                label.textContent = '无法获取浏览器 Storage 估算信息';
            });
    }

    return container;
}

/**
 * 画廊管理中枢操作句柄
 */
export interface GalleryManagerHandle extends HTMLElement, IDisposable {
    reload: () => Promise<void>;
}

/**
 * 创建历史画廊管理中枢业务组件
 */
export function createGalleryManager(storage: IStorageAdapter, hostBridge?: IHostBridge): GalleryManagerHandle {
    const container = document.createElement('div') as unknown as GalleryManagerHandle;
    container.className = 'da-gallery-manager-widget';

    let allRecords: StoredImageRecord[] = [];
    let currentSearch = '';
    let currentSortOrder: 'desc' | 'asc' = 'desc';
    let filterFavoriteOnly = false;
    let filterIsolatedOnly = false;

    let currentPage = 1;
    let pageSize = 24;
    let activeObjectUrls: string[] = [];

    const clearObjectUrls = () => {
        activeObjectUrls.forEach((url) => {
            try {
                URL.revokeObjectURL(url);
            } catch {}
        });
        activeObjectUrls = [];
    };

    const getFilteredRecords = (): StoredImageRecord[] => {
        let list = [...allRecords];

        if (filterFavoriteOnly) {
            list = list.filter((r) => r.isFavorite);
        }

        if (filterIsolatedOnly) {
            const referenced = hostBridge?.getReferencedImageIds() || new Set<string>();
            list = list.filter((r) => !referenced.has(r.id) && !r.isFavorite);
        }

        if (currentSearch) {
            list = list.filter((r) => {
                const p = (r.prompt || '').toLowerCase();
                const id = (r.id || '').toLowerCase();
                const model = String(r.metadata?.ckptName || r.metadata?.model || '').toLowerCase();
                return p.includes(currentSearch) || id.includes(currentSearch) || model.includes(currentSearch);
            });
        }

        list.sort((a, b) => {
            return currentSortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
        });

        return list;
    };

    const filterSection = document.createElement('div');
    filterSection.className = 'da-gallery-filter-row';

    const batchSection = document.createElement('div');
    batchSection.className = 'da-gallery-batch-row';

    const streamSection = document.createElement('div');
    streamSection.className = 'da-gallery-stream-container';

    container.appendChild(filterSection);
    container.appendChild(batchSection);
    container.appendChild(streamSection);

    const renderFilterRow = () => {
        filterSection.innerHTML = '';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'da-input da-gallery-search';
        searchInput.placeholder = '🔍 搜索提示词、模型或 ID...';
        searchInput.value = currentSearch;
        searchInput.oninput = () => {
            currentSearch = searchInput.value.trim().toLowerCase();
            currentPage = 1;
            renderStream();
        };

        const sortBtn = document.createElement('button');
        sortBtn.className = 'da-btn secondary da-gallery-sort-btn';
        sortBtn.innerHTML = currentSortOrder === 'desc' ? '⬇️ 最新在先' : '⬆️ 最旧在先';
        sortBtn.onclick = () => {
            currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
            sortBtn.innerHTML = currentSortOrder === 'desc' ? '⬇️ 最新在先' : '⬆️ 最旧在先';
            renderStream();
        };

        const favFilterBtn = document.createElement('button');
        favFilterBtn.className = `da-btn secondary da-gallery-filter-btn ${filterFavoriteOnly ? 'active' : ''}`;
        favFilterBtn.innerHTML = filterFavoriteOnly ? '⭐ 仅看收藏' : '☆ 全部图片';
        favFilterBtn.onclick = () => {
            filterFavoriteOnly = !filterFavoriteOnly;
            favFilterBtn.className = `da-btn secondary da-gallery-filter-btn ${filterFavoriteOnly ? 'active' : ''}`;
            favFilterBtn.innerHTML = filterFavoriteOnly ? '⭐ 仅看收藏' : '☆ 全部图片';
            currentPage = 1;
            renderStream();
        };

        filterSection.appendChild(searchInput);
        filterSection.appendChild(sortBtn);
        filterSection.appendChild(favFilterBtn);
    };

    const renderStream = () => {
        streamSection.innerHTML = '';
        clearObjectUrls();

        const filtered = getFilteredRecords();
        const total = filtered.length;

        if (total === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'da-gallery-empty';
            emptyEl.textContent = '暂无符合条件的生图记录';
            streamSection.appendChild(emptyEl);
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'da-image-grid';

        const startIdx = 0;
        const endIdx = currentPage * pageSize;
        const pageRecords = filtered.slice(startIdx, endIdx);

        pageRecords.forEach((record) => {
            const item = document.createElement('div');
            item.className = 'da-gallery-item';
            item.title = `${record.prompt || '无提示词'}\n点击查看大图与生成参数`;

            const img = document.createElement('img');
            img.className = 'da-gallery-thumb';
            img.alt = record.prompt || '生图';

            if (record.thumbnailData) {
                const url = URL.createObjectURL(record.thumbnailData);
                activeObjectUrls.push(url);
                img.src = url;
            } else if (record.data instanceof Blob) {
                const url = URL.createObjectURL(record.data);
                activeObjectUrls.push(url);
                img.src = url;
            } else if (typeof record.data === 'string') {
                img.src = record.data.startsWith('data:') || record.data.startsWith('http')
                    ? record.data
                    : `data:image/png;base64,${record.data}`;
            }

            img.onclick = () => {
                openImageInfoPanel({
                    id: record.id,
                    prompt: record.prompt,
                    metadata: record.metadata,
                    data: record.data,
                    timestamp: record.timestamp,
                    isFavorite: record.isFavorite,
                    onFavoriteChange: async () => {
                        const newFav = await storage.toggleFavorite(record.id);
                        record.isFavorite = newFav;
                        renderStream();
                    },
                    onDelete: async () => {
                        await storage.deleteImage(record.id);
                        allRecords = allRecords.filter((r) => r.id !== record.id);
                        renderStream();
                        FeedbackService.toastSuccess('图片已从本地图库移除');
                    }
                });
            };

            item.appendChild(img);

            if (record.isFavorite) {
                const favBadge = document.createElement('span');
                favBadge.className = 'da-gallery-fav-badge';
                favBadge.textContent = '⭐';
                item.appendChild(favBadge);
            }

            grid.appendChild(item);
        });

        streamSection.appendChild(grid);

        if (endIdx < total) {
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'da-btn secondary da-gallery-load-more';
            loadMoreBtn.textContent = `加载更多 (${endIdx}/${total})`;
            loadMoreBtn.onclick = () => {
                currentPage++;
                renderStream();
            };
            streamSection.appendChild(loadMoreBtn);
        }
    };

    container.reload = async () => {
        try {
            allRecords = await storage.getAllImages();
            renderFilterRow();
            renderStream();
        } catch (err: any) {
            FeedbackService.toastError(`加载本地图库失败: ${err?.message || err}`);
        }
    };

    container.dispose = () => {
        clearObjectUrls();
    };

    void container.reload();
    return container;
}
