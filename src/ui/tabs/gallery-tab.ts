/**
 * @module ui/tabs/gallery-tab
 * @description 图库管理与历史作品流 Tab 组件
 *
 * 职责：
 * - 从 IndexedDB 检索历史生成图片，支持关键词过滤与排序
 * - 呈现全局存储空间使用配额与清除废弃垃圾垃圾数据
 *
 * IndexedDB 图库读取策略：
 * 优先读取 thumbnails 表的 WebP 缩略图用于列表展示，
 * 按需从 images 表读取原图；删除操作同时清理两张表中的记录。
 */

import {
    getGalleryImages,
    getThumbnailFromDB,
    saveThumbnailToDB,
    getImageFromDB,
    type StoredImageRecord,
} from '../../storage/image-db';
import { generateThumbnail } from '../../utils/image-utils';
import { exportImagesToZip } from '../../utils/zip-utils';
import { renderStorageBar } from '../components/controls';
import { openImageInfoPanel } from '../components/modals';
import { FeedbackService } from '../feedback-service';
import { galleryDeleteBatch, galleryScanIsolated, subscribeGalleryChange } from '../../storage/image-db';
import { DisposableBag, type IDisposable } from '../../core/disposable';

export function renderGalleryTab(): [HTMLElement, IDisposable] {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-gallery-tab';

    let currentPage = 1;
    const pageSize = 24;
    let currentSearch = '';
    let currentSortOrder: 'asc' | 'desc' = 'desc';

    const selectedUuids = new Set<string>();

    const refreshGallery = async () => {
        container.innerHTML = '';
        selectedUuids.clear();

        // ── Card 1: 存储概览与空间清理指示条 ───────────────────────────────
        container.appendChild(renderStorageBar(() => refreshGallery()));

        // ── Card 2: 查找与筛选卡片 ──────────────────────────────────────────
        const cardSearch = document.createElement('div');
        cardSearch.className = 'da-section-card';

        const headerSearch = document.createElement('div');
        headerSearch.className = 'da-section-header';
        headerSearch.innerHTML = `
            <span class="da-section-title">查找与筛选</span>
            <span class="da-section-desc">按生成提示词、模型名或唯一标识搜索，支持按创建时间倒序或正序排列</span>
        `;
        cardSearch.appendChild(headerSearch);

        const searchRow = document.createElement('div');
        searchRow.className = 'da-gallery-search-row';

        const searchRowLeft = document.createElement('div');
        searchRowLeft.className = 'da-gallery-row-left';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'da-input';
        searchInput.placeholder = '搜索提示词 / 模型名称 / UUID...';
        searchInput.value = currentSearch;

        const sortSelect = document.createElement('select');
        sortSelect.className = 'da-select da-control-fixed-140';
        sortSelect.innerHTML = `
            <option value="desc" ${currentSortOrder === 'desc' ? 'selected' : ''}>最新创建</option>
            <option value="asc" ${currentSortOrder === 'asc' ? 'selected' : ''}>最早创建</option>
        `;

        searchRowLeft.appendChild(searchInput);
        searchRowLeft.appendChild(sortSelect);

        const searchRowRight = document.createElement('div');
        searchRowRight.className = 'da-gallery-row-right';

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'da-btn secondary';
        refreshBtn.textContent = '刷新列表';
        refreshBtn.addEventListener('click', () => refreshGallery());

        searchRowRight.appendChild(refreshBtn);

        searchInput.addEventListener('input', () => {
            currentSearch = searchInput.value;
            currentPage = 1;
            renderGridSection();
        });

        sortSelect.addEventListener('change', () => {
            currentSortOrder = sortSelect.value as 'asc' | 'desc';
            renderGridSection();
        });

        searchRow.appendChild(searchRowLeft);
        searchRow.appendChild(searchRowRight);
        cardSearch.appendChild(searchRow);
        container.appendChild(cardSearch);

        // ── Card 3: 批量管理卡片 ─────────────────────────────────────────────
        const cardBatch = document.createElement('div');
        cardBatch.className = 'da-section-card';

        const headerBatch = document.createElement('div');
        headerBatch.className = 'da-section-header';
        headerBatch.innerHTML = `
            <span class="da-section-title">批量管理</span>
            <span class="da-section-desc">快速全选、反选、一键选择游离在聊天记录之外的废弃废图，批量打包导出 ZIP 或永久删除</span>
        `;
        cardBatch.appendChild(headerBatch);

        const batchRow = document.createElement('div');
        batchRow.className = 'da-gallery-batch-row';

        const batchRowLeft = document.createElement('div');
        batchRowLeft.className = 'da-gallery-row-left';

        const selectAllBtn = document.createElement('button');
        selectAllBtn.className = 'da-btn secondary';
        selectAllBtn.textContent = '全选';

        const selectInverseBtn = document.createElement('button');
        selectInverseBtn.className = 'da-btn secondary';
        selectInverseBtn.textContent = '反选';

        const batchSelectIsolatedBtn = document.createElement('button');
        batchSelectIsolatedBtn.className = 'da-btn secondary';
        batchSelectIsolatedBtn.textContent = '勾选孤立废图';

        batchRowLeft.appendChild(selectAllBtn);
        batchRowLeft.appendChild(selectInverseBtn);
        batchRowLeft.appendChild(batchSelectIsolatedBtn);

        const batchRowRight = document.createElement('div');
        batchRowRight.className = 'da-gallery-row-right';

        const batchExportBtn = document.createElement('button');
        batchExportBtn.className = 'da-btn primary';
        batchExportBtn.textContent = '导出选中图片 (ZIP)';

        const batchDeleteBtn = document.createElement('button');
        batchDeleteBtn.className = 'da-btn danger';
        batchDeleteBtn.textContent = '批量删除选中图片';

        batchRowRight.appendChild(batchExportBtn);
        batchRowRight.appendChild(batchDeleteBtn);

        batchRow.appendChild(batchRowLeft);
        batchRow.appendChild(batchRowRight);
        cardBatch.appendChild(batchRow);
        container.appendChild(cardBatch);

        // ── Card 4: 网格容器与分页区 ──────────────────────────────────────────
        const gridArea = document.createElement('div');
        gridArea.className = 'da-gallery-grid-area';
        container.appendChild(gridArea);

        let lastFetchedUuids: string[] = [];

        const updateCheckboxState = () => {
            const checkboxes = gridArea.querySelectorAll<HTMLInputElement>('.da-card-checkbox');
            checkboxes.forEach(cb => {
                const uuid = cb.getAttribute('data-uuid');
                if (uuid) cb.checked = selectedSetHas(uuid);
            });
        };

        const selectedSetHas = (uuid: string) => selectedUuids.has(uuid);

        selectAllBtn.addEventListener('click', () => {
            if (lastFetchedUuids.length === 0) return;
            lastFetchedUuids.forEach(id => selectedUuids.add(id));
            updateCheckboxState();
        });

        selectInverseBtn.addEventListener('click', () => {
            if (lastFetchedUuids.length === 0) return;
            lastFetchedUuids.forEach(id => {
                if (selectedUuids.has(id)) {
                    selectedUuids.delete(id);
                } else {
                    selectedUuids.add(id);
                }
            });
            updateCheckboxState();
        });

        batchExportBtn.addEventListener('click', () => {
            if (selectedUuids.size === 0) {
                FeedbackService.toastError('请先在下方网格中勾选需要导出的图片卡片。', '批量导出提醒');
                return;
            }
            void exportImagesToZip(Array.from(selectedUuids));
        });

        batchDeleteBtn.addEventListener('click', async () => {
            if (selectedUuids.size === 0) {
                FeedbackService.toastError('请先在下方网格中勾选需要删除的图片卡片。', '批量删除提醒');
                return;
            }
            const count = selectedUuids.size;
            const ok = await FeedbackService.confirmDelete('gallery_batch', count);
            if (ok) {
                await galleryDeleteBatch(selectedUuids);
                FeedbackService.toastSuccess(`已成功删除 ${count} 张历史图片。`, '批量删除完成');
                refreshGallery();
            }
        });

        batchSelectIsolatedBtn.addEventListener('click', async () => {
            batchSelectIsolatedBtn.disabled = true;
            batchSelectIsolatedBtn.textContent = '查找中...';
            try {
                const isolated = await galleryScanIsolated();
                selectedUuids.clear();
                isolated.forEach(id => selectedUuids.add(id));
                FeedbackService.toastSuccess(`已成功勾选 ${isolated.length} 张未在当前聊天引用的孤立废图。`, '孤立废图查找');
                currentSearch = '';
                searchInput.value = '';
                currentPage = 1;
                renderGridSection();
            } finally {
                batchSelectIsolatedBtn.disabled = false;
                batchSelectIsolatedBtn.textContent = '勾选孤立废图';
            }
        });

        const renderGridSection = async () => {
            gridArea.innerHTML = '';
            const offset = (currentPage - 1) * pageSize;
            const res = await getGalleryImages({
                limit: pageSize,
                offset,
                searchText: currentSearch,
                sortBy: 'timestamp',
                sortOrder: currentSortOrder,
            });

            lastFetchedUuids = res.items.map(i => i.uuid);

            if (res.items.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'da-section-card';
                empty.style.textAlign = 'center';
                empty.style.padding = '40px 15px';
                empty.style.color = 'var(--da-text-secondary)';
                empty.style.fontSize = '0.9em';
                empty.textContent = res.total === 0 ? '图库为空，发起生图后图像将自动保存在此。' : '没有符合搜索条件的图像。';
                gridArea.appendChild(empty);
                return;
            }

            // 网格 DOM
            const grid = document.createElement('div');
            grid.className = 'da-gallery-grid-container';

            for (const item of res.items) {
                grid.appendChild(await createGalleryCard(item, selectedUuids, () => refreshGallery()));
            }
            gridArea.appendChild(grid);

            // 分页按钮
            const totalPages = Math.ceil(res.total / pageSize);
            if (totalPages > 1) {
                const pageBar = document.createElement('div');
                pageBar.className = 'da-flex-center-row';
                pageBar.style.justifyContent = 'center';
                pageBar.style.marginTop = '15px';

                const prevBtn = document.createElement('button');
                prevBtn.className = 'da-btn secondary';
                prevBtn.disabled = currentPage <= 1;
                prevBtn.textContent = '上一页';
                prevBtn.addEventListener('click', () => {
                    if (currentPage > 1) {
                        currentPage--;
                        renderGridSection();
                    }
                });

                const pageInfo = document.createElement('span');
                pageInfo.style.fontSize = '0.85em';
                pageInfo.style.color = 'var(--da-text-secondary)';
                pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页 (共 ${res.total} 张)`;

                const nextBtn = document.createElement('button');
                nextBtn.className = 'da-btn secondary';
                nextBtn.disabled = currentPage >= totalPages;
                nextBtn.textContent = '下一页';
                nextBtn.addEventListener('click', () => {
                    if (currentPage < totalPages) {
                        currentPage++;
                        renderGridSection();
                    }
                });

                pageBar.appendChild(prevBtn);
                pageBar.appendChild(pageInfo);
                pageBar.appendChild(nextBtn);
                gridArea.appendChild(pageBar);
            }
        };

        await renderGridSection();
    };

    // 订阅图库变更事件，自动刷新（新图生成/删除后无需手动刷新）
    const bag = new DisposableBag();
    bag.add(subscribeGalleryChange(() => {
        void refreshGallery();
    }));

    void refreshGallery();
    return [container, bag];
}

/**
 * 创建单张图库卡片
 */
async function createGalleryCard(
    record: StoredImageRecord,
    selectedSet: Set<string>,
    onRefresh: () => void
): Promise<HTMLElement> {
    const card = document.createElement('div');
    card.className = 'da-gallery-card';

    // 复选框 overlay
    const checkOverlay = document.createElement('div');
    checkOverlay.className = 'da-gallery-check-overlay';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'da-card-checkbox';
    checkbox.setAttribute('data-uuid', record.uuid);
    checkbox.checked = selectedSet.has(record.uuid);

    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            selectedSet.add(record.uuid);
        } else {
            selectedSet.delete(record.uuid);
        }
    });

    checkOverlay.appendChild(checkbox);
    card.appendChild(checkOverlay);

    const imgContainer = document.createElement('div');
    imgContainer.className = 'da-gallery-img-container';

    const img = document.createElement('img');
    img.className = 'da-gallery-img';
    img.loading = 'lazy';

    // 缩略图懒加载与自动补全生成
    const cachedThumb = await getThumbnailFromDB(record.uuid);
    if (cachedThumb && cachedThumb.data) {
        img.src = `data:image/webp;base64,${cachedThumb.data}`;
    } else {
        const fullSrc = record.data.startsWith('data:') ? record.data : `data:${record.mime};base64,${record.data}`;
        img.src = fullSrc;
        void generateThumbnail(record.uuid, record.data, record.mime).then(thumb => {
            if (thumb.data) void saveThumbnailToDB(thumb);
        });
    }

    const handleOpenInfo = async () => {
        const fullRecord = await getImageFromDB(record.uuid);
        openImageInfoPanel(fullRecord ?? record, {
            onRefresh,
            onDelete: async (uuid: string) => {
                await galleryDeleteBatch([uuid]);
                FeedbackService.toastSuccess(`已彻底删除图像 #${uuid.slice(0, 8)}`, '删除成功');
                onRefresh();
            },
        });
    };

    imgContainer.addEventListener('click', handleOpenInfo);

    imgContainer.appendChild(img);
    card.appendChild(imgContainer);

    // 信息底部栏
    const footer = document.createElement('div');
    footer.className = 'da-gallery-card-footer';

    const promptText = document.createElement('span');
    promptText.className = 'da-gallery-prompt-text';
    promptText.title = record.prompt;
    promptText.textContent = record.prompt || '无提示词';

    const subInfo = document.createElement('div');
    subInfo.className = 'da-gallery-card-subinfo';

    const timeSpan = document.createElement('span');
    timeSpan.textContent = new Date(record.timestamp).toLocaleDateString();

    const infoBtn = document.createElement('button');
    infoBtn.className = 'da-btn secondary';
    infoBtn.title = '查看详情元数据';
    infoBtn.textContent = '详情';

    infoBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleOpenInfo();
    });

    subInfo.appendChild(timeSpan);
    subInfo.appendChild(infoBtn);

    footer.appendChild(promptText);
    footer.appendChild(subInfo);
    card.appendChild(footer);

    return card;
}
