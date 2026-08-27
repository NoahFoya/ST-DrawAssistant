/**
 * @module ui/media/gallery-view
 * @description 本地图库画廊管理系统与资产存储仪表盘 (Gallery & Media Domain)
 *
 * 参考 Civitai / Eagle / Midjourney 现代生图素材管理范式：
 * 1. 资产概览仪表盘 (Storage Dashboard)：多级水位预警 + 3 栏核心指标卡片 + 分级治理操作；
 * 2. 一体化检索工具栏 (Unified Toolbar)：全宽弹性模糊搜索 + 排序切换 + 胶囊分段分类 (带实时数量 Badge)；
 * 3. 自适应媒体网格 (Media Grid)：满铺卡片 + 悬停顶部暗角浮层 + 金色收藏 Badge；
 * 4. 底部悬浮批量控制台 (Floating Batch Bar)：多选模式下悬浮展现，避免挤压视图；
 * 5. 严格的 Object URL 内存回收与分页流。
 */

import { IStorageAdapter, StoredImageRecord, IDisposable, IHostBridge } from '../../core';
import { FeedbackService } from '../feedback/feedback';
import { openImageInfoPanel } from './image-info-panel';

/**
 * 存储概览与治理仪表盘句柄
 */
export interface StorageCardHandle extends HTMLElement, IDisposable {
    refresh: () => Promise<void>;
}

/**
 * 渲染本地存储资产概览仪表盘组件
 */
export function renderStorageBar(
    storage?: IStorageAdapter,
    hostBridge?: IHostBridge,
    onCleanCallback?: () => Promise<void> | void
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

    // 2. 统计指标概览 (横向 3 栏并列数据卡片)
    const statsWrapper = document.createElement('div');
    statsWrapper.className = 'da-storage-stats-grid';
    container.appendChild(statsWrapper);

    // 3. 安全治理操作栏
    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'da-storage-actions-toolbar';
    container.appendChild(actionsWrapper);

    const refreshData = async () => {
        // 更新浏览器存储配额
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

                // 水位状态色预警
                pctBadge.classList.remove('is-warning', 'is-danger');
                fill.classList.remove('is-warning', 'is-danger');
                if (ratio > 0.9) {
                    pctBadge.classList.add('is-danger');
                    fill.classList.add('is-danger');
                } else if (ratio > 0.7) {
                    pctBadge.classList.add('is-warning');
                    fill.classList.add('is-warning');
                }
            } catch {
                label.textContent = '无法获取浏览器存储配额估算信息';
                pctBadge.textContent = '--';
            }
        }

        // 更新图库统计指标
        if (storage) {
            try {
                const refIds = hostBridge?.getReferencedImageIds ? hostBridge.getReferencedImageIds() : new Set<string>();
                const stats = await storage.getStorageStats(refIds);

                statsWrapper.innerHTML = `
                    <div class="da-storage-metric-card">
                        <div class="da-storage-metric-num">${stats.totalCount}</div>
                        <div class="da-storage-metric-label">本地生图总数</div>
                    </div>
                    <div class="da-storage-metric-card is-fav">
                        <div class="da-storage-metric-num">${stats.favoriteCount}</div>
                        <div class="da-storage-metric-label">⭐ 标星收藏</div>
                    </div>
                    <div class="da-storage-metric-card is-iso">
                        <div class="da-storage-metric-num">${stats.isolatedCount}</div>
                        <div class="da-storage-metric-label">孤立未引用</div>
                    </div>
                `;
            } catch {
                statsWrapper.innerHTML = '';
            }
        }
    };

    // 渲染操作按钮
    const renderActions = () => {
        actionsWrapper.innerHTML = '';

        if (!storage) return;

        // 清理孤立图片
        const cleanIsoBtn = document.createElement('button');
        cleanIsoBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        cleanIsoBtn.textContent = '清理孤立图片';
        cleanIsoBtn.title = '扫描当前会话，清除已被聊天删除的孤立历史图片（保留已收藏图片）';
        cleanIsoBtn.onclick = async () => {
            const refIds = hostBridge?.getReferencedImageIds ? hostBridge.getReferencedImageIds() : new Set<string>();
            const count = await storage.cleanIsolatedImages(refIds);
            FeedbackService.toastSuccess(count > 0 ? `已清理 ${count} 张孤立历史图片` : '未发现需要清理的孤立图片');
            await refreshData();
            await onCleanCallback?.();
        };

        // 清空未收藏缓存
        const cleanNonFavBtn = document.createElement('button');
        cleanNonFavBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        cleanNonFavBtn.textContent = '清空未收藏缓存';
        cleanNonFavBtn.title = '保留所有已收藏图片，释放其余试绘历史图片缓存';
        cleanNonFavBtn.onclick = async () => {
            const confirmed = window.confirm('确认清空所有未收藏的历史图片缓存吗？已收藏的图片将受到严格保护。');
            if (confirmed) {
                const count = await storage.cleanNonFavorites();
                FeedbackService.toastSuccess(`已清空非收藏缓存，共释放 ${count} 张图片`);
                await refreshData();
                await onCleanCallback?.();
            }
        };

        // 清空全部图库 (危险)
        const clearAllBtn = document.createElement('button');
        clearAllBtn.className = 'da-btn da-btn--danger da-btn--sm';
        clearAllBtn.textContent = '清空全部图库';
        clearAllBtn.title = '清空本地 IndexedDB 中的所有图片记录（包括收藏项）';
        clearAllBtn.onclick = async () => {
            const confirmed = window.confirm('⚠️ 危险操作：此操作将永久清空本地全部图库数据（包含所有收藏图片），无法撤销！是否确定清空？');
            if (confirmed) {
                await storage.clear();
                FeedbackService.toastSuccess('已清空全部本地图库数据');
                await refreshData();
                await onCleanCallback?.();
            }
        };

        // 刷新统计
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        refreshBtn.textContent = '刷新统计';
        refreshBtn.onclick = async () => {
            await refreshData();
            FeedbackService.toastSuccess('存储配额与图库统计已更新');
        };

        actionsWrapper.appendChild(cleanIsoBtn);
        actionsWrapper.appendChild(cleanNonFavBtn);
        actionsWrapper.appendChild(clearAllBtn);
        actionsWrapper.appendChild(refreshBtn);
    };

    renderActions();
    void refreshData();

    container.refresh = refreshData;
    container.dispose = () => {
        // 无需额外销毁
    };

    return container;
}

/**
 * 画廊管理组件操作句柄
 */
export interface GalleryManagerHandle extends HTMLElement, IDisposable {
    reload: () => Promise<void>;
}

/**
 * 创建历史画廊管理业务组件
 */
export function createGalleryManager(
    storage: IStorageAdapter,
    hostBridge?: IHostBridge,
    onDataMutated?: () => Promise<void> | void
): GalleryManagerHandle {
    const container = document.createElement('div') as unknown as GalleryManagerHandle;
    container.className = 'da-gallery-manager-widget';

    let allRecords: StoredImageRecord[] = [];
    let currentSearch = '';
    let currentSortOrder: 'desc' | 'asc' = 'desc';
    let filterMode: 'all' | 'favorite' | 'isolated' = 'all';

    // 多选批量管理状态
    let isBatchMode = false;
    const selectedIds = new Set<string>();

    let currentPage = 1;
    const pageSize = 24;
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

        if (filterMode === 'favorite') {
            list = list.filter((r) => r.isFavorite);
        } else if (filterMode === 'isolated') {
            const referenced = hostBridge?.getReferencedImageIds ? hostBridge.getReferencedImageIds() : new Set<string>();
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

    // 1. 顶部一体化工具栏容器
    const toolbarSection = document.createElement('div');
    toolbarSection.className = 'da-gallery-toolbar';

    // 2. 图片网格流容器
    const streamSection = document.createElement('div');
    streamSection.className = 'da-gallery-stream-container';

    // 3. 底部悬浮批量控制台
    const floatingBatchBar = document.createElement('div');
    floatingBatchBar.className = 'da-batch-floating-bar';
    floatingBatchBar.style.display = 'none';

    container.appendChild(toolbarSection);
    container.appendChild(streamSection);
    container.appendChild(floatingBatchBar);

    // 渲染一体化检索与过滤工具栏
    const renderToolbar = () => {
        toolbarSection.innerHTML = '';

        // 行 1: 搜索框 + 排序下拉 + 批量管理开关
        const rowPrimary = document.createElement('div');
        rowPrimary.className = 'da-gallery-toolbar-row-primary';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'da-input da-gallery-search';
        searchInput.placeholder = '搜索提示词、模型或 ID...';
        searchInput.value = currentSearch;
        searchInput.oninput = () => {
            currentSearch = searchInput.value.trim().toLowerCase();
            currentPage = 1;
            renderStream();
        };

        const sortBtn = document.createElement('button');
        sortBtn.className = 'da-btn da-btn--secondary da-gallery-sort-btn';
        sortBtn.textContent = currentSortOrder === 'desc' ? '最新优先' : '最早优先';
        sortBtn.onclick = () => {
            currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
            sortBtn.textContent = currentSortOrder === 'desc' ? '最新优先' : '最早优先';
            renderStream();
        };

        const batchToggleBtn = document.createElement('button');
        batchToggleBtn.className = `da-btn da-btn--secondary da-gallery-batch-toggle ${isBatchMode ? 'is-active' : ''}`;
        batchToggleBtn.textContent = isBatchMode ? '退出批量' : '批量管理';
        batchToggleBtn.onclick = () => {
            isBatchMode = !isBatchMode;
            if (!isBatchMode) selectedIds.clear();
            floatingBatchBar.style.display = isBatchMode ? 'flex' : 'none';
            renderToolbar();
            renderFloatingBatchBar();
            renderStream();
        };

        rowPrimary.appendChild(searchInput);
        rowPrimary.appendChild(sortBtn);
        rowPrimary.appendChild(batchToggleBtn);

        // 行 2: 分段胶囊筛选器（带即时数量统计 Badge）
        const rowSecondary = document.createElement('div');
        rowSecondary.className = 'da-gallery-toolbar-row-secondary';

        const referenced = hostBridge?.getReferencedImageIds ? hostBridge.getReferencedImageIds() : new Set<string>();
        const totalAll = allRecords.length;
        const totalFav = allRecords.filter((r) => r.isFavorite).length;
        const totalIso = allRecords.filter((r) => !referenced.has(r.id) && !r.isFavorite).length;

        const filterGroup = document.createElement('div');
        filterGroup.className = 'da-gallery-filter-chips';

        const filterItems: { mode: 'all' | 'favorite' | 'isolated'; label: string; count: number }[] = [
            { mode: 'all', label: '全部图片', count: totalAll },
            { mode: 'favorite', label: '⭐ 仅看收藏', count: totalFav },
            { mode: 'isolated', label: '仅看孤立', count: totalIso }
        ];

        filterItems.forEach(({ mode, label, count }) => {
            const chip = document.createElement('button');
            chip.className = `da-gallery-chip ${filterMode === mode ? 'is-active' : ''}`;
            chip.innerHTML = `<span>${label}</span><span class="da-chip-badge">${count}</span>`;
            chip.onclick = () => {
                filterMode = mode;
                currentPage = 1;
                renderToolbar();
                renderStream();
            };
            filterGroup.appendChild(chip);
        });

        rowSecondary.appendChild(filterGroup);

        toolbarSection.appendChild(rowPrimary);
        toolbarSection.appendChild(rowSecondary);
    };

    // 渲染底部悬浮批量控制台
    const renderFloatingBatchBar = () => {
        floatingBatchBar.innerHTML = '';
        if (!isBatchMode) return;

        const countLabel = document.createElement('span');
        countLabel.className = 'da-batch-count-label';
        countLabel.textContent = `已选择 ${selectedIds.size} 项`;

        const btnGroupLeft = document.createElement('div');
        btnGroupLeft.className = 'da-batch-btn-group';

        const selectAllBtn = document.createElement('button');
        selectAllBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        selectAllBtn.textContent = '全选';
        selectAllBtn.onclick = () => {
            const filtered = getFilteredRecords();
            filtered.forEach((r) => selectedIds.add(r.id));
            renderFloatingBatchBar();
            renderStream();
        };

        const deselectAllBtn = document.createElement('button');
        deselectAllBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        deselectAllBtn.textContent = '取消全选';
        deselectAllBtn.onclick = () => {
            selectedIds.clear();
            renderFloatingBatchBar();
            renderStream();
        };

        btnGroupLeft.appendChild(selectAllBtn);
        btnGroupLeft.appendChild(deselectAllBtn);

        const btnGroupRight = document.createElement('div');
        btnGroupRight.className = 'da-batch-btn-group';

        const batchFavBtn = document.createElement('button');
        batchFavBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        batchFavBtn.textContent = '批量收藏';
        batchFavBtn.disabled = selectedIds.size === 0;
        batchFavBtn.onclick = async () => {
            for (const id of Array.from(selectedIds)) {
                const rec = allRecords.find((r) => r.id === id);
                if (rec && !rec.isFavorite) {
                    await storage.toggleFavorite(id);
                    rec.isFavorite = true;
                }
            }
            FeedbackService.toastSuccess(`已批量收藏 ${selectedIds.size} 张图片`);
            selectedIds.clear();
            await onDataMutated?.();
            renderToolbar();
            renderFloatingBatchBar();
            renderStream();
        };

        const batchDeleteBtn = document.createElement('button');
        batchDeleteBtn.className = 'da-btn da-btn--danger da-btn--sm';
        batchDeleteBtn.textContent = `批量删除 (${selectedIds.size})`;
        batchDeleteBtn.disabled = selectedIds.size === 0;
        batchDeleteBtn.onclick = async () => {
            const count = selectedIds.size;
            if (count === 0) return;
            const confirmed = window.confirm(`确认批量删除已选中的 ${count} 张历史图片吗？此操作无法撤销。`);
            if (confirmed) {
                await storage.deleteImages(Array.from(selectedIds));
                allRecords = allRecords.filter((r) => !selectedIds.has(r.id));
                selectedIds.clear();
                FeedbackService.toastSuccess(`已成功删除 ${count} 张图片`);
                await onDataMutated?.();
                renderToolbar();
                renderFloatingBatchBar();
                renderStream();
            }
        };

        btnGroupRight.appendChild(batchFavBtn);
        btnGroupRight.appendChild(batchDeleteBtn);

        floatingBatchBar.appendChild(countLabel);
        floatingBatchBar.appendChild(btnGroupLeft);
        floatingBatchBar.appendChild(btnGroupRight);
    };

    // 渲染自适应媒体网格瀑布流
    const renderStream = () => {
        streamSection.innerHTML = '';
        clearObjectUrls();

        const filtered = getFilteredRecords();
        const total = filtered.length;

        if (total === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'da-gallery-empty';
            emptyEl.innerHTML = `
                <div style="font-size: 28px; margin-bottom: 8px;">🖼️</div>
                <div>暂无符合条件的生图记录</div>
            `;
            streamSection.appendChild(emptyEl);
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'da-image-grid da-media-grid';

        const endIdx = currentPage * pageSize;
        const pageRecords = filtered.slice(0, endIdx);

        pageRecords.forEach((record) => {
            const item = document.createElement('div');
            item.className = `da-gallery-item da-media-card ${selectedIds.has(record.id) ? 'is-selected' : ''}`;
            item.title = `${record.prompt || '无提示词'}\n点击查看大图与生成参数`;

            // 1. 底层图片
            const img = document.createElement('img');
            img.className = 'da-gallery-thumb da-media-card__thumb';
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
            item.appendChild(img);

            // 2. 多选复选框 (左上角)
            if (isBatchMode) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'da-gallery-checkbox da-media-card__checkbox';
                checkbox.checked = selectedIds.has(record.id);
                checkbox.onclick = (e) => {
                    e.stopPropagation();
                    if (checkbox.checked) {
                        selectedIds.add(record.id);
                        item.classList.add('is-selected');
                    } else {
                        selectedIds.delete(record.id);
                        item.classList.remove('is-selected');
                    }
                    renderFloatingBatchBar();
                };
                item.appendChild(checkbox);
            }

            // 3. 常驻收藏徽章 (右上角)
            if (record.isFavorite) {
                const favBadge = document.createElement('span');
                favBadge.className = 'da-gallery-fav-badge da-media-card__fav-badge';
                favBadge.textContent = '⭐';
                item.appendChild(favBadge);
            }

            // 4. 悬停浮层快捷操作栏 (顶部渐变悬浮)
            const overlay = document.createElement('div');
            overlay.className = 'da-gallery-overlay da-media-card__overlay';

            const starBtn = document.createElement('button');
            starBtn.className = 'da-gallery-action-btn';
            starBtn.innerHTML = record.isFavorite ? '⭐' : '☆';
            starBtn.title = record.isFavorite ? '取消收藏' : '添加收藏';
            starBtn.onclick = async (e) => {
                e.stopPropagation();
                const newFav = await storage.toggleFavorite(record.id);
                record.isFavorite = newFav;
                starBtn.innerHTML = newFav ? '⭐' : '☆';
                await onDataMutated?.();
                renderToolbar();
                renderStream();
            };

            const delBtn = document.createElement('button');
            delBtn.className = 'da-gallery-action-btn da-action-del';
            delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
            delBtn.title = '删除此图片';
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                await storage.deleteImage(record.id);
                allRecords = allRecords.filter((r) => r.id !== record.id);
                selectedIds.delete(record.id);
                FeedbackService.toastSuccess('图片已从本地图库移除');
                await onDataMutated?.();
                renderToolbar();
                renderFloatingBatchBar();
                renderStream();
            };

            overlay.appendChild(starBtn);
            overlay.appendChild(delBtn);
            item.appendChild(overlay);

            item.onclick = () => {
                if (isBatchMode) {
                    if (selectedIds.has(record.id)) {
                        selectedIds.delete(record.id);
                        item.classList.remove('is-selected');
                    } else {
                        selectedIds.add(record.id);
                        item.classList.add('is-selected');
                    }
                    renderFloatingBatchBar();
                    return;
                }

                // 非批量模式下打开元数据大图面板
                openImageInfoPanel({
                    id: record.id,
                    prompt: record.prompt,
                    metadata: record.metadata,
                    data: record.data,
                    timestamp: record.timestamp,
                    isFavorite: record.isFavorite,
                    storage,
                    onFavoriteChange: async () => {
                        const newFav = await storage.toggleFavorite(record.id);
                        record.isFavorite = newFav;
                        await onDataMutated?.();
                        renderToolbar();
                        renderStream();
                    },
                    onDelete: async () => {
                        await storage.deleteImage(record.id);
                        allRecords = allRecords.filter((r) => r.id !== record.id);
                        await onDataMutated?.();
                        renderToolbar();
                        renderStream();
                        FeedbackService.toastSuccess('图片已从本地图库移除');
                    }
                });
            };

            grid.appendChild(item);
        });

        streamSection.appendChild(grid);

        if (endIdx < total) {
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'da-btn da-btn--secondary da-gallery-load-more';
            loadMoreBtn.textContent = `加载更多 (${pageRecords.length} / ${total})`;
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
            renderToolbar();
            renderFloatingBatchBar();
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
