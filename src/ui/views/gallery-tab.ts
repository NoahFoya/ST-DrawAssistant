/**
 * 历史生图画廊选项卡 (GalleryTab)
 *
 * 功能：
 * 1. 提供历史生图资产的网格化浏览、关键词检索、排序与多引擎/收藏状态过滤；
 * 2. 集成存储配额监控、数据备份导出与未收藏记录清理；
 * 3. 支持单张图片的详情查看、大图预览、提示词复用，以及多选批量导出与删除。
 *
 * Tips：
 * 1. 采用分页机制控制单次渲染节点规模，保障大量图片记录下的 DOM 渲染性能；
 * 2. 批量删除与清空操作提供确认拦截，已标星收藏的资产受保护避免误删。
 */

import { createElement } from '../../util/dom';
import { createStorageBar, StorageBarHandle } from '../composite/storage-bar';
import { createMediaCard, MediaCardHandle } from '../composite/media-card';
import { createTextInput, TextInputHandle } from '../components/input';
import { createSelect, SelectHandle } from '../components/select';
import { createButton, ButtonHandle } from '../components/button';
import { Toast } from '../components/feedback';
import type { PersistentStorage } from '../../store/storage';
import type { MediaCardItemModel, StoredImageRecord } from '@types';

export interface GalleryTabOptions {
    storage?: PersistentStorage;
    pageSize?: number;
    onPreview?: (item: MediaCardItemModel) => void;
    onViewInfo?: (record: StoredImageRecord) => void;
    onReusePrompt?: (prompt: string, negativePrompt?: string) => void;
    onDelete?: (recordId: string) => Promise<boolean> | boolean;
    onToggleFavorite?: (recordId: string, isFav: boolean) => Promise<boolean> | boolean;
}

export interface GalleryTabHandle {
    readonly element: HTMLElement;
    refresh(): Promise<void>;
    dispose(): void;
}

export function renderGalleryTab(options: GalleryTabOptions = {}): GalleryTabHandle {
    const root = createElement('div', { className: 'da-tab-pane da-gallery-manager-widget' });
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    let allRecords: StoredImageRecord[] = [];
    let filteredRecords: StoredImageRecord[] = [];
    let currentPage = 1;
    let pageSize = options.pageSize || 24;
    const selectedIds = new Set<string>();

    let keyword = '';
    let sortMode = 'time-desc';
    let engineFilter = 'all';
    let favFilter = 'all';

    // 缓存卡片句柄与当前页分配的临时展示 Object URL
    let cardHandles: MediaCardHandle[] = [];
    const pageBlobUrls: string[] = [];

    const revokePageBlobUrls = () => {
        for (const url of pageBlobUrls) {
            if (url.startsWith('blob:')) {
                try {
                    URL.revokeObjectURL(url);
                } catch {
                    // 忽略销毁异常
                }
            }
        }
        pageBlobUrls.length = 0;
    };

    // 1. 顶部存储配额监控条 (StorageBar 紧凑模式)
    const storageBar: StorageBarHandle = createStorageBar({
        compact: true,
        initialQuota: {
            usedBytes: 0,
            totalBytes: 1024 * 1024 * 1024,
            imageCount: 0
        },
        onExportBackup: async () => {
            if (allRecords.length === 0) {
                Toast.info('暂无可导出的图片资产');
                return;
            }
            try {
                const exportData = {
                    version: '1.0.0',
                    exportedAt: Date.now(),
                    totalCount: allRecords.length,
                    records: allRecords.map((r) => ({
                        id: r.id,
                        hash: r.hash,
                        isFavorite: r.isFavorite,
                        metadata: r.metadata
                    }))
                };
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `st_draw_backup_${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
                Toast.success(`成功导出 ${allRecords.length} 条记录备份清单`);
            } catch (err: any) {
                Toast.error(`导出备份失败: ${err?.message || '未知异常'}`);
            }
        },
        onClearStorage: async () => {
            if (allRecords.length === 0) {
                Toast.info('存储已为空');
                return;
            }
            if (options.storage) {
                for (const r of allRecords) {
                    if (!r.isFavorite) {
                        await options.storage.deleteImage(r.id);
                    }
                }
                Toast.success('已清理未收藏的图片缓存');
                await refresh();
            }
        }
    });
    regDisposer(storageBar);
    root.appendChild(storageBar.element);

    // 2. 检索与过滤工具栏 (.da-gallery-toolbar) - 单行弹性自适应排布
    const toolbar = createElement('div', { className: 'da-gallery-toolbar' });

    // 搜索输入框 (检索变体、带清空按钮)
    const searchInput: TextInputHandle = createTextInput({
        placeholder: '搜索提示词、模型或种子...',
        variant: 'search',
        showClear: true,
        onChange: (val) => {
            keyword = val.trim().toLowerCase();
            currentPage = 1;
            applyFilters();
        }
    });
    regDisposer(searchInput);
    searchInput.element.style.flex = '2';
    searchInput.element.style.minWidth = '180px';
    toolbar.appendChild(searchInput.element);

    // 筛选选择框行
    const filterRow = createElement('div', {
        className: 'da-gallery-filter-row',
        attributes: { style: 'display: flex; gap: 8px; flex-wrap: wrap; flex: 3; align-items: center;' }
    });

    // 排序下拉
    const sortSelect: SelectHandle = createSelect({
        options: [
            { label: '按生成时间 (最新在前)', value: 'time-desc' },
            { label: '按生成时间 (最早在前)', value: 'time-asc' },
            { label: '按图片尺寸 (高分辨率优先)', value: 'size-desc' }
        ],
        value: sortMode,
        onChange: (val) => {
            sortMode = val;
            applyFilters();
        }
    });
    regDisposer(sortSelect);
    sortSelect.element.style.flex = '1';
    sortSelect.element.style.minWidth = '130px';
    filterRow.appendChild(sortSelect.element);

    // 引擎下拉
    const engineSelect: SelectHandle = createSelect({
        options: [
            { label: '全部生图引擎', value: 'all' },
            { label: 'ComfyUI', value: 'comfyui' },
            { label: 'SD-WebUI / Forge', value: 'sdwebui' },
            { label: 'NovelAI', value: 'novelai' },
            { label: 'OpenAI 兼容模型', value: 'openai' }
        ],
        value: engineFilter,
        onChange: (val) => {
            engineFilter = val;
            currentPage = 1;
            applyFilters();
        }
    });
    regDisposer(engineSelect);
    engineSelect.element.style.flex = '1';
    engineSelect.element.style.minWidth = '120px';
    filterRow.appendChild(engineSelect.element);

    // 收藏状态下拉
    const favSelect: SelectHandle = createSelect({
        options: [
            { label: '全部图片', value: 'all' },
            { label: '仅看标星收藏 ★', value: 'favorite' }
        ],
        value: favFilter,
        onChange: (val) => {
            favFilter = val;
            currentPage = 1;
            applyFilters();
        }
    });
    regDisposer(favSelect);
    favSelect.element.style.flex = '1';
    favSelect.element.style.minWidth = '100px';
    filterRow.appendChild(favSelect.element);

    toolbar.appendChild(filterRow);
    root.appendChild(toolbar);

    // 3. 自适应媒体流式卡片网格 (.da-gallery-stream-container)
    const streamContainer = createElement('div', { className: 'da-gallery-stream-container' });
    const grid = createElement('div', { className: 'da-media-grid' });
    streamContainer.appendChild(grid);
    root.appendChild(streamContainer);

    // 空状态提示
    const emptyState = createElement('div', {
        className: 'da-gallery-empty-state',
        attributes: { style: 'display: none; padding: 48px 0; text-align: center; color: var(--da-text-secondary);' }
    });
    emptyState.innerHTML = `
        <div style="font-size: 2.2em; opacity: 0.4; margin-bottom: 8px;">🎨</div>
        <div style="font-size: var(--da-font-size-md, 14px); font-weight: 500;">画廊空空如也</div>
        <div style="font-size: var(--da-font-size-xs, 12px); opacity: 0.7; margin-top: 4px;">完成绘画后生成的图片将自动收纳于此</div>
    `;
    streamContainer.appendChild(emptyState);

    // 4. 粘性悬浮批处理控制台 (.da-gallery-batch-actions)
    const batchBar = createElement('div', {
        className: 'da-gallery-batch-actions',
        attributes: { style: 'display: none; position: sticky; bottom: 12px; z-index: var(--da-z-fab, 100); background: var(--da-bg-card, rgba(30, 34, 45, 0.95)); backdrop-filter: blur(10px); border: 1px solid var(--da-separator); border-radius: var(--da-radius-md, 10px); padding: 10px 16px; align-items: center; justify-content: space-between; box-shadow: var(--da-shadow-lg); margin-top: 8px;' }
    });

    const batchCountEl = createElement('span', {
        className: 'da-batch-count',
        attributes: { style: 'font-weight: 600; font-size: 13px; color: var(--da-accent-color);' }
    });
    batchBar.appendChild(batchCountEl);

    const batchButtonsWrapper = createElement('div', {
        attributes: { style: 'display: flex; gap: 8px; align-items: center;' }
    });

    // 全选按钮
    const selectAllBtn: ButtonHandle = createButton({
        text: '全选当页',
        variant: 'secondary',
        onClick: () => {
            const pageRecords = getPageRecords();
            for (const r of pageRecords) {
                selectedIds.add(r.id);
            }
            updateSelectionState();
        }
    });
    regDisposer(selectAllBtn);
    batchButtonsWrapper.appendChild(selectAllBtn.element);

    // 反选/取消选择
    const cancelSelectBtn: ButtonHandle = createButton({
        text: '取消全选',
        variant: 'secondary',
        onClick: () => {
            selectedIds.clear();
            updateSelectionState();
        }
    });
    regDisposer(cancelSelectBtn);
    batchButtonsWrapper.appendChild(cancelSelectBtn.element);

    // 批量删除按钮
    const batchDeleteBtn: ButtonHandle = createButton({
        text: '批量删除',
        variant: 'danger',
        icon: 'trash',
        onClick: async () => {
            if (selectedIds.size === 0) return;
            if (!confirm(`确定要删除选中的 ${selectedIds.size} 张图片吗？`)) return;

            if (options.storage) {
                for (const id of selectedIds) {
                    await options.storage.deleteImage(id);
                }
                Toast.success(`成功删除 ${selectedIds.size} 张图片`);
                selectedIds.clear();
                await refresh();
            }
        }
    });
    regDisposer(batchDeleteBtn);
    batchButtonsWrapper.appendChild(batchDeleteBtn.element);

    batchBar.appendChild(batchButtonsWrapper);
    root.appendChild(batchBar);

    // 5. 标准分页控制条 (.da-pagination)
    const paginationBar = createElement('div', {
        className: 'da-pagination',
        attributes: { style: 'display: flex; align-items: center; justify-content: space-between; padding: 12px 4px; margin-top: 10px; border-top: 1px solid var(--da-separator);' }
    });

    const pageInfoEl = createElement('div', {
        className: 'da-pagination__info',
        attributes: { style: 'font-size: var(--da-font-size-xs, 12px); color: var(--da-text-secondary);' }
    });
    paginationBar.appendChild(pageInfoEl);

    const paginationControls = createElement('div', {
        attributes: { style: 'display: flex; gap: 8px; align-items: center;' }
    });

    const prevPageBtn: ButtonHandle = createButton({
        text: '上一页',
        variant: 'secondary',
        onClick: () => {
            if (currentPage > 1) {
                currentPage--;
                renderCurrentPage();
            }
        }
    });
    regDisposer(prevPageBtn);
    paginationControls.appendChild(prevPageBtn.element);

    const pageIndicator = createElement('span', {
        attributes: { style: 'font-weight: 600; font-size: var(--da-font-size-xs, 12px); min-width: 40px; text-align: center;' }
    });
    paginationControls.appendChild(pageIndicator);

    const nextPageBtn: ButtonHandle = createButton({
        text: '下一页',
        variant: 'secondary',
        onClick: () => {
            const maxPage = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
            if (currentPage < maxPage) {
                currentPage++;
                renderCurrentPage();
            }
        }
    });
    regDisposer(nextPageBtn);
    paginationControls.appendChild(nextPageBtn.element);

    paginationBar.appendChild(paginationControls);
    root.appendChild(paginationBar);

    // 6. 数据过滤与分页逻辑
    function applyFilters() {
        filteredRecords = allRecords.filter((r) => {
            if (keyword) {
                const prompt = (r.metadata?.prompt || r.prompt || '').toLowerCase();
                const ep = r.metadata?.engineParams as Record<string, unknown> | undefined;
                const overrides = (ep?.override_settings || {}) as Record<string, unknown>;
                const vars = (ep?.variables || {}) as Record<string, unknown>;
                const params = (ep?.parameters || {}) as Record<string, unknown>;
                const model = String(
                    ep?.model ||
                    ep?.checkpoint ||
                    overrides.sd_model_checkpoint ||
                    vars.model_name ||
                    ''
                ).toLowerCase();
                const seed = String(
                    ep?.seed ||
                    vars.seed ||
                    params.seed ||
                    ''
                );
                if (!prompt.includes(keyword) && !model.includes(keyword) && !seed.includes(keyword)) {
                    return false;
                }
            }
            if (engineFilter !== 'all') {
                if (r.metadata?.engine !== engineFilter) {
                    return false;
                }
            }
            if (favFilter === 'favorite') {
                if (!r.isFavorite) {
                    return false;
                }
            }
            return true;
        });

        filteredRecords.sort((a, b) => {
            if (sortMode === 'time-asc') {
                return (a.metadata?.createdAt || 0) - (b.metadata?.createdAt || 0);
            }
            if (sortMode === 'size-desc') {
                const sizeA = (a.metadata?.dimensions?.width || 0) * (a.metadata?.dimensions?.height || 0);
                const sizeB = (b.metadata?.dimensions?.width || 0) * (b.metadata?.dimensions?.height || 0);
                return sizeB - sizeA;
            }
            return (b.metadata?.createdAt || 0) - (a.metadata?.createdAt || 0);
        });

        currentPage = 1;
        renderCurrentPage();
    }

    function getPageRecords(): StoredImageRecord[] {
        const start = (currentPage - 1) * pageSize;
        return filteredRecords.slice(start, start + pageSize);
    }

    function renderCurrentPage() {
        for (const card of cardHandles) {
            card.dispose();
        }
        cardHandles = [];
        revokePageBlobUrls();
        grid.innerHTML = '';

        const pageRecords = getPageRecords();
        const maxPage = Math.max(1, Math.ceil(filteredRecords.length / pageSize));

        if (filteredRecords.length === 0) {
            emptyState.style.display = 'block';
            grid.style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            grid.style.display = 'grid';

            for (const r of pageRecords) {
                let url = '';
                if (r.originalBlob) {
                    url = URL.createObjectURL(r.originalBlob);
                    pageBlobUrls.push(url);
                }

                const itemModel: MediaCardItemModel = {
                    id: r.id,
                    url,
                    prompt: r.metadata?.prompt || r.prompt || '',
                    negativePrompt: r.metadata?.negativePrompt || '',
                    width: r.metadata?.dimensions?.width || 512,
                    height: r.metadata?.dimensions?.height || 512,
                    createdAt: r.metadata?.createdAt || Date.now(),
                    isFavorite: Boolean(r.isFavorite)
                };

                const card: MediaCardHandle = createMediaCard({
                    item: itemModel,
                    selectable: true,
                    selected: selectedIds.has(r.id),
                    onSelect: (selected) => {
                        if (selected) {
                            selectedIds.add(r.id);
                        } else {
                            selectedIds.delete(r.id);
                        }
                        updateSelectionState();
                    },
                    onPreview: () => {
                        options.onPreview?.(itemModel);
                    },
                    onReusePrompt: (p, np) => {
                        options.onReusePrompt?.(p, np);
                    },
                    onToggleFavorite: async (newFav) => {
                        r.isFavorite = newFav;
                        if (options.onToggleFavorite) {
                            await options.onToggleFavorite(r.id, newFav);
                        } else if (options.storage) {
                            await options.storage.setFavorite(r.id, newFav);
                        }
                        Toast.success(newFav ? '已加入标星收藏 ★' : '已取消收藏');
                    },
                    onDelete: async () => {
                        if (!confirm('确定要删除这张图片吗？')) return;
                        if (options.onDelete) {
                            await options.onDelete(r.id);
                        } else if (options.storage) {
                            await options.storage.deleteImage(r.id);
                        }
                        selectedIds.delete(r.id);
                        Toast.success('图片已删除');
                        await refresh();
                    }
                });

                cardHandles.push(card);
                grid.appendChild(card.element);
            }
        }

        pageInfoEl.textContent = `共 ${filteredRecords.length} 张图片 (当前显示 ${pageRecords.length} 项)`;
        pageIndicator.textContent = `${currentPage} / ${maxPage}`;
        prevPageBtn.setDisabled(currentPage <= 1);
        nextPageBtn.setDisabled(currentPage >= maxPage);

        updateSelectionState();
    }

    function updateSelectionState() {
        if (selectedIds.size > 0) {
            batchBar.style.display = 'flex';
            batchCountEl.textContent = `已选择 ${selectedIds.size} 项`;
        } else {
            batchBar.style.display = 'none';
        }

        for (const c of cardHandles) {
            c.setSelected(selectedIds.has(c.getItem().id));
        }
    }

    async function refresh(): Promise<void> {
        if (options.storage) {
            try {
                allRecords = await options.storage.listRecords(2000, 0);

                let totalBytes = 0;
                for (const r of allRecords) {
                    if (r.originalBlob) {
                        totalBytes += r.originalBlob.size;
                    }
                }
                const quotaTotal = 1024 * 1024 * 1024; // 1GB
                storageBar.update({
                    usedBytes: totalBytes,
                    totalBytes: quotaTotal,
                    imageCount: allRecords.length
                });
            } catch (err) {
                console.error('[ST-DrawAssistant][GalleryTab] 加载图片记录失败', err);
            }
        }
        applyFilters();
    }

    refresh();

    return {
        element: root,
        async refresh(): Promise<void> {
            await refresh();
        },
        dispose(): void {
            for (const c of cardHandles) {
                c.dispose();
            }
            cardHandles = [];
            revokePageBlobUrls();
            for (const d of disposers) {
                d();
            }
        }
    };
}
