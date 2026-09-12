/**
 * 本地图库画廊视图与存储概览 (gallery-view)
 * 提供历史生图网格预览、分页浏览、无引用图片检索与批量操作工具栏
 */

import { IDisposable, StoredImageRecord } from '../../types';
import { StorageService } from '../../state';
import { HostClient } from '../../host';
import { FeedbackService } from '../feedback/feedback';
import { openImageInfoPanel } from './image-info-panel';
import { escapeHtml } from '../foundation/utils';
import { Logger } from '../../utils';

const logger = new Logger('GalleryView');

export interface StorageCardHandle extends HTMLElement, IDisposable {
    refresh: () => Promise<void>;
}

export interface GalleryManagerHandle extends HTMLElement, IDisposable {
    reload: () => Promise<void>;
}

/**
 * 渲染本地存储空间概览组件
 *
 * 展示存储占用配额进度条，以及本地生图总数、⭐ 标星收藏数、无引用图片数等统计卡片
 */
export function renderStorageBar(
    storage?: StorageService,
    hostClient?: HostClient,
    _onCleanCallback?: () => Promise<void> | void
): StorageCardHandle {
    const container = document.createElement('div') as unknown as StorageCardHandle;
    container.className = 'da-storage-bar';

    // 存储使用率进度条
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

    // 存储指标数据卡片网格
    const statsWrapper = document.createElement('div');
    statsWrapper.className = 'da-stat-grid da-stat-grid--3-cols';
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

                if (ratio > 0.9) {
                    pctBadge.classList.add('is-danger');
                    fill.classList.add('is-danger');
                } else if (ratio > 0.7) {
                    pctBadge.classList.add('is-warning');
                    fill.classList.add('is-warning');
                } else {
                    pctBadge.classList.remove('is-danger', 'is-warning');
                    fill.classList.remove('is-danger', 'is-warning');
                }
            } catch (err) {
                logger.warn('获取浏览器存储估算配额失败:', err);
                label.textContent = '无法获取存储配额';
            }
        }

        if (storage) {
            try {
                const refIds = hostClient?.getReferencedImageIds ? hostClient.getReferencedImageIds() : new Set<string>();
                const stats = await storage.getStorageStats(refIds);
                statsWrapper.innerHTML = `
                    <div class="da-stat-card">
                        <div class="da-stat-card__val">${stats.totalCount}</div>
                        <div class="da-stat-card__label">本地生图总数</div>
                    </div>
                    <div class="da-stat-card da-stat-card--fav">
                        <div class="da-stat-card__val">${stats.favoriteCount}</div>
                        <div class="da-stat-card__label">⭐ 标星收藏</div>
                    </div>
                    <div class="da-stat-card da-stat-card--iso">
                        <div class="da-stat-card__val">${stats.isolatedCount}</div>
                        <div class="da-stat-card__label">无引用图片</div>
                    </div>
                `;
            } catch (err) {
                logger.warn('读取本地存储统计失败:', err);
                statsWrapper.innerHTML = `<div class="da-storage-error-hint">读取存储统计失败</div>`;
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
 * 创建画廊管理器
 * 支持单页 24 张分页浏览，翻页时主动释放上一页的临时 Object URL 避免内存滞留。
 * 提供无引用图片检索与分类、标星收藏以及批量操作工具栏（全选、反选、批量收藏与批量删除）。
 */
export function createGalleryManager(
    storage?: StorageService,
    hostClient?: HostClient,
    onStorageChange?: () => Promise<void> | void
): GalleryManagerHandle {
    const root = document.createElement('div') as unknown as GalleryManagerHandle;
    root.className = 'da-gallery-manager-widget';

    let allRecords: StoredImageRecord[] = [];
    let currentSearch = '';
    let currentSortOrder: 'desc' | 'asc' = 'desc';
    let filterMode: 'all' | 'favorite' | 'isolated' = 'all';

    // 批量管理状态
    let isBatchMode = false;
    const selectedIds = new Set<string>();

    // 分页参数 (单页 24 张)
    let currentPage = 1;
    const pageSize = 24;
    let activeObjectUrls: string[] = [];

    const clearObjectUrls = () => {
        for (const url of activeObjectUrls) {
            try {
                URL.revokeObjectURL(url);
            } catch {}
        }
        activeObjectUrls = [];
    };

    // 顶部检索与过滤工具栏
    const toolbarSection = document.createElement('div');
    toolbarSection.className = 'da-gallery-toolbar';

    // 图片网格流容器
    const streamSection = document.createElement('div');
    streamSection.className = 'da-gallery-stream-container';

    // 底部悬浮批量操作栏
    const floatingBatchBar = document.createElement('div');
    floatingBatchBar.className = 'da-batch-floating-bar';
    floatingBatchBar.style.display = 'none';

    root.appendChild(toolbarSection);
    root.appendChild(streamSection);
    root.appendChild(floatingBatchBar);

    /**
     * 根据当前过滤条件与搜索词计算过滤后的记录清单
     */
    const getFilteredRecords = (): StoredImageRecord[] => {
        let list = [...allRecords];

        const refIds = hostClient?.getReferencedImageIds ? hostClient.getReferencedImageIds() : new Set<string>();

        if (filterMode === 'favorite') {
            list = list.filter((r) => r.isFavorite);
        } else if (filterMode === 'isolated') {
            list = list.filter((r) => !refIds.has(r.id) && !r.isFavorite);
        }

        if (currentSearch) {
            list = list.filter((r) => {
                const prompt = (r.prompt || '').toLowerCase();
                const id = (r.id || '').toLowerCase();
                const engine = (r.metadata?.engine || '').toLowerCase();
                const engineParams = (r.metadata?.engineParams || {}) as Record<string, unknown>;
                const model = String(
                    engineParams.ckptName ||
                    engineParams.model ||
                    (r.metadata as any)?.ckptName ||
                    (r.metadata as any)?.model ||
                    ''
                ).toLowerCase();
                return (
                    prompt.includes(currentSearch) ||
                    id.includes(currentSearch) ||
                    engine.includes(currentSearch) ||
                    model.includes(currentSearch)
                );
            });
        }

        list.sort((a, b) => {
            const timeA = a.metadata?.createdAt || a.lastAccessedAt || 0;
            const timeB = b.metadata?.createdAt || b.lastAccessedAt || 0;
            return currentSortOrder === 'desc' ? timeB - timeA : timeA - timeB;
        });

        return list;
    };

    /**
     * 渲染一体化检索与过滤工具栏
     */
    const renderToolbar = () => {
        toolbarSection.innerHTML = '';

        // 行 1: 搜索框 + 排序按钮 + 批量管理切换 (通用 .da-filter-bar)
        const rowPrimary = document.createElement('div');
        rowPrimary.className = 'da-filter-bar';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'da-input da-input--search';
        searchInput.placeholder = '搜索提示词 / 图像 ID / 模型名...';
        searchInput.value = currentSearch;
        searchInput.oninput = () => {
            currentSearch = searchInput.value.trim().toLowerCase();
            currentPage = 1;
            renderStream();
        };

        const sortBtn = document.createElement('button');
        sortBtn.type = 'button';
        sortBtn.className = 'da-btn da-btn--secondary';
        sortBtn.textContent = currentSortOrder === 'desc' ? '最新优先' : '最早优先';
        sortBtn.onclick = () => {
            currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
            sortBtn.textContent = currentSortOrder === 'desc' ? '最新优先' : '最早优先';
            renderStream();
        };

        const batchToggleBtn = document.createElement('button');
        batchToggleBtn.type = 'button';
        batchToggleBtn.className = `da-btn da-btn--secondary ${isBatchMode ? 'is-active' : ''}`.trim();
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

        // 行 2: 状态分类筛选器 (通用 .da-filter-bar + .da-chip-group)
        const rowSecondary = document.createElement('div');
        rowSecondary.className = 'da-filter-bar';

        const refIds = hostClient?.getReferencedImageIds ? hostClient.getReferencedImageIds() : new Set<string>();
        const totalAll = allRecords.length;
        const totalFav = allRecords.filter((r) => r.isFavorite).length;
        const totalIso = allRecords.filter((r) => !refIds.has(r.id) && !r.isFavorite).length;

        const filterGroup = document.createElement('div');
        filterGroup.className = 'da-chip-group';

        const filterItems: { mode: 'all' | 'favorite' | 'isolated'; label: string; count: number }[] = [
            { mode: 'all', label: '全部图片', count: totalAll },
            { mode: 'favorite', label: '⭐ 标星收藏', count: totalFav },
            { mode: 'isolated', label: '无引用图片', count: totalIso }
        ];

        filterItems.forEach(({ mode, label, count }) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `da-chip da-chip--filter ${filterMode === mode ? 'is-active' : ''}`.trim();
            chip.innerHTML = `<span>${label}</span><span class="da-chip__badge">${count}</span>`;
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

    /**
     * 渲染底部悬浮批量操作栏
     */
    const renderFloatingBatchBar = () => {
        floatingBatchBar.innerHTML = '';
        if (!isBatchMode) return;

        const countLabel = document.createElement('span');
        countLabel.className = 'da-batch-count-label';
        countLabel.textContent = `已选择 ${selectedIds.size} 项`;

        const btnGroupLeft = document.createElement('div');
        btnGroupLeft.className = 'da-batch-btn-group';

        const selectAllBtn = document.createElement('button');
        selectAllBtn.type = 'button';
        selectAllBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        selectAllBtn.textContent = '全选当前页';
        selectAllBtn.onclick = () => {
            const filtered = getFilteredRecords();
            const startIdx = (currentPage - 1) * pageSize;
            const pageRecords = filtered.slice(startIdx, startIdx + pageSize);
            pageRecords.forEach((r) => selectedIds.add(r.id));
            renderFloatingBatchBar();
            renderStream();
        };

        const deselectAllBtn = document.createElement('button');
        deselectAllBtn.type = 'button';
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
        batchFavBtn.type = 'button';
        batchFavBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        batchFavBtn.textContent = '批量收藏';
        batchFavBtn.disabled = selectedIds.size === 0;
        batchFavBtn.onclick = async () => {
            if (!storage) return;
            let favCount = 0;
            for (const id of Array.from(selectedIds)) {
                const rec = allRecords.find((r) => r.id === id);
                if (rec && !rec.isFavorite) {
                    await storage.toggleFavorite(id);
                    rec.isFavorite = true;
                    favCount++;
                }
            }
            FeedbackService.toastSuccess(`已将选中的 ${favCount} 张图片设为标星收藏`);
            selectedIds.clear();
            await onStorageChange?.();
            renderToolbar();
            renderFloatingBatchBar();
            renderStream();
        };

        const batchDeleteBtn = document.createElement('button');
        batchDeleteBtn.type = 'button';
        batchDeleteBtn.className = 'da-btn da-btn--danger da-btn--sm';
        batchDeleteBtn.textContent = `批量删除 (${selectedIds.size})`;
        batchDeleteBtn.disabled = selectedIds.size === 0;
        batchDeleteBtn.onclick = async () => {
            if (!storage) return;
            const count = selectedIds.size;
            if (count === 0) return;
            const confirmed = await FeedbackService.confirm({
                title: '批量删除确认',
                message: `确定要永久删除已选中的 ${count} 张历史图片吗？此操作无法撤销。`,
                confirmText: '确认删除'
            });
            if (confirmed) {
                const ids = Array.from(selectedIds);
                await storage.deleteImages(ids);
                allRecords = allRecords.filter((r) => !selectedIds.has(r.id));
                selectedIds.clear();
                FeedbackService.toastSuccess(`已成功删除 ${count} 张历史生图`);
                await onStorageChange?.();
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

    /**
     * 渲染分页控制器
     */
    const renderPagination = (total: number, totalPages: number): HTMLElement | null => {
        if (total === 0) return null;

        const paginationEl = document.createElement('div');
        paginationEl.className = 'da-pagination';

        const infoEl = document.createElement('div');
        infoEl.className = 'da-pagination-info';
        infoEl.textContent = `共 ${total} 张图片 · 第 ${currentPage} / ${totalPages} 页`;
        paginationEl.appendChild(infoEl);

        const controlsEl = document.createElement('div');
        controlsEl.className = 'da-pagination-controls';

        // 首页按钮
        const firstBtn = document.createElement('button');
        firstBtn.type = 'button';
        firstBtn.className = 'da-pagination-btn';
        firstBtn.textContent = '⏮';
        firstBtn.title = '第一页';
        firstBtn.disabled = currentPage <= 1;
        firstBtn.onclick = () => {
            if (currentPage > 1) {
                currentPage = 1;
                renderStream();
            }
        };
        controlsEl.appendChild(firstBtn);

        // 上一页按钮
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'da-pagination-btn';
        prevBtn.textContent = '◀ 上一页';
        prevBtn.disabled = currentPage <= 1;
        prevBtn.onclick = () => {
            if (currentPage > 1) {
                currentPage--;
                renderStream();
            }
        };
        controlsEl.appendChild(prevBtn);

        // 动态页码按钮 (最多显示前后各 2 页)
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, currentPage + 2);

        if (startPage > 1) {
            const p1 = document.createElement('button');
            p1.type = 'button';
            p1.className = 'da-pagination-btn';
            p1.textContent = '1';
            p1.onclick = () => {
                currentPage = 1;
                renderStream();
            };
            controlsEl.appendChild(p1);
            if (startPage > 2) {
                const dots = document.createElement('span');
                dots.className = 'da-pagination-ellipsis';
                dots.textContent = '...';
                controlsEl.appendChild(dots);
            }
        }

        for (let p = startPage; p <= endPage; p++) {
            const pageBtn = document.createElement('button');
            pageBtn.type = 'button';
            pageBtn.className = `da-pagination-btn ${p === currentPage ? 'is-active' : ''}`;
            pageBtn.textContent = String(p);
            pageBtn.onclick = () => {
                if (currentPage !== p) {
                    currentPage = p;
                    renderStream();
                }
            };
            controlsEl.appendChild(pageBtn);
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                const dots = document.createElement('span');
                dots.className = 'da-pagination-ellipsis';
                dots.textContent = '...';
                controlsEl.appendChild(dots);
            }
            const pLast = document.createElement('button');
            pLast.type = 'button';
            pLast.className = 'da-pagination-btn';
            pLast.textContent = String(totalPages);
            pLast.onclick = () => {
                currentPage = totalPages;
                renderStream();
            };
            controlsEl.appendChild(pLast);
        }

        // 下一页按钮
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'da-pagination-btn';
        nextBtn.textContent = '下一页 ▶';
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.onclick = () => {
            if (currentPage < totalPages) {
                currentPage++;
                renderStream();
            }
        };
        controlsEl.appendChild(nextBtn);

        // 末页按钮
        const lastBtn = document.createElement('button');
        lastBtn.type = 'button';
        lastBtn.className = 'da-pagination-btn';
        lastBtn.textContent = '⏭';
        lastBtn.title = '最后一页';
        lastBtn.disabled = currentPage >= totalPages;
        lastBtn.onclick = () => {
            if (currentPage < totalPages) {
                currentPage = totalPages;
                renderStream();
            }
        };
        controlsEl.appendChild(lastBtn);

        paginationEl.appendChild(controlsEl);
        return paginationEl;
    };

    /**
     * 渲染媒体网格瀑布流
     */
    const renderStream = () => {
        streamSection.innerHTML = '';
        clearObjectUrls();

        const filtered = getFilteredRecords();
        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        // 越界保护
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        if (total === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'da-empty-tip da-empty-tip--card';
            emptyEl.innerHTML = `
                <div class="da-empty-tip__icon">🖼️</div>
                <div>暂无符合条件的历史生图记录</div>
            `;
            streamSection.appendChild(emptyEl);
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'da-media-grid';

        const startIdx = (currentPage - 1) * pageSize;
        const pageRecords = filtered.slice(startIdx, startIdx + pageSize);

        pageRecords.forEach((record) => {
            const item = document.createElement('div');
            item.className = `da-media-card ${selectedIds.has(record.id) ? 'is-selected' : ''}`;
            item.title = `${record.prompt || '无提示词'}\n点击查看全图与生成参数`;

            // 缩略图视口
            const img = document.createElement('img');
            img.className = 'da-media-card__thumb';
            img.alt = record.prompt || 'Gallery Image';
            img.loading = 'lazy';

            const blob = record.thumbnailBlob || record.originalBlob;
            const url = URL.createObjectURL(blob);
            activeObjectUrls.push(url);
            img.src = url;
            item.appendChild(img);

            // 批量选择勾选框
            if (isBatchMode) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'da-media-card__checkbox';
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

            // 常驻标星角标
            if (record.isFavorite) {
                const favBadge = document.createElement('span');
                favBadge.className = 'da-media-card__fav-badge';
                favBadge.textContent = '⭐';
                item.appendChild(favBadge);
            }

            // 悬停快捷操作栏
            const actions = document.createElement('div');
            actions.className = 'da-media-card__overlay';

            // 快捷标星/取消标星按钮
            const starBtn = document.createElement('button');
            starBtn.type = 'button';
            starBtn.className = 'da-overlay-btn';
            starBtn.innerHTML = record.isFavorite ? '⭐' : '☆';
            starBtn.title = record.isFavorite ? '取消收藏' : '添加标星收藏';
            starBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!storage) return;
                const newFav = await storage.toggleFavorite(record.id);
                record.isFavorite = newFav;
                starBtn.innerHTML = newFav ? '⭐' : '☆';
                await onStorageChange?.();
                renderToolbar();
                renderStream();
            };

            // 详情按钮
            const infoBtn = document.createElement('button');
            infoBtn.type = 'button';
            infoBtn.className = 'da-overlay-btn';
            infoBtn.title = '查看元数据与生图参数';
            infoBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
            infoBtn.onclick = (e) => {
                e.stopPropagation();
                openDetailPanel(record);
            };

            // 删除按钮
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'da-overlay-btn da-overlay-btn--danger';
            delBtn.title = '删除此图片';
            delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!storage) return;
                const ok = await FeedbackService.confirm({
                    title: '删除图片确认',
                    message: '确定要从画廊永久删除此图片吗？此操作无法撤销。',
                    confirmText: '确认删除'
                });
                if (ok) {
                    await storage.deleteImage(record.id);
                    allRecords = allRecords.filter((r) => r.id !== record.id);
                    selectedIds.delete(record.id);
                    await onStorageChange?.();
                    FeedbackService.toastSuccess('图片已删除');
                    renderToolbar();
                    renderFloatingBatchBar();
                    renderStream();
                }
            };

            actions.appendChild(starBtn);
            actions.appendChild(infoBtn);
            actions.appendChild(delBtn);
            item.appendChild(actions);

            // 卡片主体点击事件
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
                openDetailPanel(record);
            };

            grid.appendChild(item);
        });

        streamSection.appendChild(grid);

        // 渲染底部真分页条
        const paginationEl = renderPagination(total, totalPages);
        if (paginationEl) {
            streamSection.appendChild(paginationEl);
        }
    };

    /**
     * 打开全图预览与元数据详情面板
     */
    const openDetailPanel = (record: StoredImageRecord) => {
        openImageInfoPanel({
            id: record.id,
            uuid: record.id,
            prompt: record.prompt,
            negativePrompt: record.metadata?.negativePrompt,
            metadata: record.metadata,
            data: record.originalBlob,
            timestamp: record.metadata?.createdAt || record.lastAccessedAt,
            isFavorite: record.isFavorite,
            storage,
            onFavoriteChange: async (fav: boolean) => {
                record.isFavorite = fav;
                await onStorageChange?.();
                renderToolbar();
                renderStream();
            },
            onDelete: async () => {
                if (storage) {
                    await storage.deleteImage(record.id);
                }
                allRecords = allRecords.filter((r) => r.id !== record.id);
                selectedIds.delete(record.id);
                await onStorageChange?.();
                FeedbackService.toastSuccess('图片已从画廊移除');
                renderToolbar();
                renderFloatingBatchBar();
                renderStream();
            }
        });
    };

    /**
     * 重新加载图库数据并刷新整体界面
     */
    const reload = async () => {
        renderToolbar();
        if (!storage) {
            streamSection.innerHTML = '<div class="da-empty-tip">未挂载本地存储引擎</div>';
            return;
        }

        try {
            allRecords = await storage.listImages(10000, 0);
            renderToolbar();
            renderFloatingBatchBar();
            renderStream();
        } catch (err: any) {
            streamSection.innerHTML = `<div class="da-empty-tip da-empty-tip--error">读取画廊失败: ${escapeHtml(err?.message || err)}</div>`;
        }
    };

    renderToolbar();
    void reload();

    root.reload = reload;
    root.dispose = () => {
        clearObjectUrls();
        selectedIds.clear();
        allRecords = [];
        root.remove();
    };

    return root;
}

