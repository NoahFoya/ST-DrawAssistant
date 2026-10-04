/**
 * 历史生图画廊选项卡视图 (GalleryTabView)。
 *
 * @remarks
 * 负责本地图像资产的浏览、检索、多维度筛选、批量管理与配额监控：
 * 1. 存储水位监控：集成 StorageBar，呈现容量使用率并支持安全清理未收藏草稿与分级备份；
 * 2. 检索与筛选：支持正向提示词模糊搜索、生图服务引擎筛选、标星收藏状态筛选及时间排序；
 * 3. 响应式媒体流：基于 MediaCard 与自适应 CSS Grid 实现 1:1 卡片展示与分页性能隔离；
 * 4. 交互联动机制：卡片点击呼出全屏 LightboxModal 大图预览，支持原位快速标星与删除确认；
 * 5. 批量管理：支持批量选择、元数据 JSON 导出与批量删除（默认保护标星资产）。
 */

import type { SettingsView, Disposable } from '../types';
import { StorageBar, type StorageSummaryData } from '../composite/storage-bar';
import { MediaCard, type MediaCardItemData } from '../composite/media-card';
import { Button } from '../components/button';
import { TextInput } from '../components/text-input';
import { Select } from '../components/select';
import { imageStorage } from '../../store/image-storage';
import { urlPool } from '../../store/url-pool';
import { lightboxModal, type LightboxItem } from '../media/lightbox-modal';
import { Toast } from '../feedback/toast';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { logger } from '../../util/logger';
import type { StoredImageRecord } from '@types';

/** 画廊每页呈现的最大卡片条目数 */
const DEFAULT_PAGE_SIZE = 24;

/**
 * 画廊管理选项卡实现类。
 */
export class GalleryTabView implements SettingsView, Disposable {
    public readonly id = 'gallery';
    public readonly title = '历史生图画廊';
    public readonly element: HTMLElement;

    // 内存数据与筛选状态
    private allRecords: StoredImageRecord[] = [];
    private filteredRecords: StoredImageRecord[] = [];
    private readonly selectedIds = new Set<string>();

    private keyword = '';
    private engineFilter = 'all';
    private favoriteFilter = 'all';
    private sortMode = 'time-desc';
    private currentPage = 1;
    private readonly pageSize = DEFAULT_PAGE_SIZE;
    private isBatchMode = false;

    // 子组件与 DOM 引用
    private readonly disposables: Disposable[] = [];
    private readonly activeCards: MediaCard[] = [];
    private readonly pageBlobUrls: string[] = [];
    private readonly pageUrlMap = new Map<string, string>();

    private storageBar!: StorageBar;
    private searchInput!: TextInput;
    private engineSelect!: Select;
    private favoriteSelect!: Select;
    private sortSelect!: Select;
    private batchToggleBtn!: Button;

    private gridContainer!: HTMLElement;
    private batchToolbarEl!: HTMLElement;
    private batchCountEl!: HTMLElement;
    private pageInfoEl!: HTMLElement;
    private prevPageBtn!: Button;
    private nextPageBtn!: Button;
    private renderSeq = 0;

    public constructor() {
        this.element = document.createElement('div');
        this.element.className = 'da-tab-pane da-gallery-manager-widget';

        this.initStructure();
    }

    /**
     * 构建画廊骨架与工具条组件。
     */
    private initStructure(): void {
        // 1. 顶部存储空间监控卡片 (StorageBar)
        this.storageBar = new StorageBar({
            title: '本地图像资产存储 (IndexedDB)',
            subtitle: '监控存储配额水位线，支持安全分级清理与数据导出',
            className: 'da-storage-bar',
            confirmHandler: (msg) => ConfirmDialog.confirm(msg),
            onRefresh: async () => {
                await this.refresh();
            },
            onCleanFailed: async () => {
                await this.cleanFailedRecords();
            },
            onCleanUnfavorited: async () => {
                await this.cleanUnfavoritedRecords();
            },
            onClearAll: async () => {
                await this.clearAllRecords();
            },
        });
        this.element.appendChild(this.storageBar.element);
        this.disposables.push(this.storageBar);

        // 2. 检索与多维过滤工具栏 (.da-gallery-toolbar)
        const toolbar = document.createElement('div');
        toolbar.className = 'da-gallery-toolbar';

        // (1) 搜索输入框
        this.searchInput = new TextInput({
            placeholder: '搜索提示词、模型或种子...',
            clearable: true,
            debounceMs: 200,
            onChange: (val) => {
                this.keyword = (val || '').trim().toLowerCase();
                this.currentPage = 1;
                void this.applyFiltersAndRender();
            },
        });
        toolbar.appendChild(this.searchInput.element);
        this.disposables.push(this.searchInput);

        const filterRow = document.createElement('div');
        filterRow.className = 'da-gallery-filter-row';

        // (2) 绘图后端服务筛选
        this.engineSelect = new Select({
            value: 'all',
            options: [
                { label: '全部服务', value: 'all' },
                { label: 'ComfyUI', value: 'comfyui' },
                { label: 'SD-WebUI / Forge', value: 'sdwebui' },
                { label: 'NovelAI', value: 'novelai' },
                { label: 'OpenAI 兼容', value: 'openai' },
            ],
            onChange: (val) => {
                this.engineFilter = val;
                this.currentPage = 1;
                void this.applyFiltersAndRender();
            },
        });
        filterRow.appendChild(this.engineSelect.element);
        this.disposables.push(this.engineSelect);

        // (3) 标星收藏状态筛选
        this.favoriteSelect = new Select({
            value: 'all',
            options: [
                { label: '全部记录', value: 'all' },
                { label: '仅标星收藏 ★', value: 'favorited' },
                { label: '仅未标星草稿 ☆', value: 'unfavorited' },
            ],
            onChange: (val) => {
                this.favoriteFilter = val;
                this.currentPage = 1;
                void this.applyFiltersAndRender();
            },
        });
        filterRow.appendChild(this.favoriteSelect.element);
        this.disposables.push(this.favoriteSelect);

        // (4) 排序方式
        this.sortSelect = new Select({
            value: 'time-desc',
            options: [
                { label: '时间倒序 (最新)', value: 'time-desc' },
                { label: '时间正序 (最早)', value: 'time-asc' },
            ],
            onChange: (val) => {
                this.sortMode = val;
                this.currentPage = 1;
                void this.applyFiltersAndRender();
            },
        });
        filterRow.appendChild(this.sortSelect.element);
        this.disposables.push(this.sortSelect);

        // (5) 批量选择管理切换按钮
        this.batchToggleBtn = new Button({
            label: '批量管理',
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
                this.toggleBatchMode();
            },
        });
        filterRow.appendChild(this.batchToggleBtn.element);
        this.disposables.push(this.batchToggleBtn);

        toolbar.appendChild(filterRow);
        this.element.appendChild(toolbar);

        // 3. 媒体网格主体容器 (.da-gallery-stream-container)
        const streamContainer = document.createElement('div');
        streamContainer.className = 'da-gallery-stream-container';

        this.gridContainer = document.createElement('div');
        this.gridContainer.className = 'da-media-grid';
        streamContainer.appendChild(this.gridContainer);

        this.element.appendChild(streamContainer);

        // 4. 批量操作粘性浮层条 (.da-gallery-batch-toolbar)
        this.initBatchToolbar();

        // 5. 底部分页控制器 (.da-gallery-pagination)
        this.initPagination();
    }

    /**
     * 初始化批量操作条。
     */
    private initBatchToolbar(): void {
        const bar = document.createElement('div');
        bar.className = 'da-gallery-batch-toolbar';
        bar.style.display = 'none';
        bar.style.padding = '8px 14px';
        bar.style.background = 'var(--da-bg-secondary, #1e2029)';
        bar.style.border = '1px solid var(--da-border-color, rgba(255, 255, 255, 0.15))';
        bar.style.borderRadius = 'var(--da-radius-md, 8px)';
        bar.style.alignItems = 'center';
        bar.style.justifyContent = 'space-between';
        bar.style.gap = '10px';

        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '10px';

        const countText = document.createElement('span');
        countText.style.fontSize = '12px';
        countText.style.fontWeight = '600';
        countText.style.color = 'var(--da-text-primary, #fff)';
        countText.textContent = '已选中 0 项';
        left.appendChild(countText);
        this.batchCountEl = countText;

        const selectAllBtn = new Button({
            label: '全选当前页',
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
                this.selectAllCurrentPage();
            },
        });
        left.appendChild(selectAllBtn.element);
        this.disposables.push(selectAllBtn);

        const deselectAllBtn = new Button({
            label: '取消全选',
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
                this.selectedIds.clear();
                this.updateBatchSelectionUI();
            },
        });
        left.appendChild(deselectAllBtn.element);
        this.disposables.push(deselectAllBtn);

        bar.appendChild(left);

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.alignItems = 'center';
        right.style.gap = '8px';

        // 导出选中项备份清单
        const exportBtn = new Button({
            label: '导出选中清单',
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
                this.exportSelectedBackup();
            },
        });
        right.appendChild(exportBtn.element);
        this.disposables.push(exportBtn);

        // 批量删除
        const deleteBatchBtn = new Button({
            label: '批量删除',
            variant: 'danger',
            size: 'sm',
            onClick: async () => {
                await this.deleteSelectedItems();
            },
        });
        right.appendChild(deleteBatchBtn.element);
        this.disposables.push(deleteBatchBtn);

        bar.appendChild(right);
        this.element.appendChild(bar);
        this.batchToolbarEl = bar;
    }

    /**
     * 初始化底部分页器。
     */
    private initPagination(): void {
        const pagination = document.createElement('div');
        pagination.className = 'da-gallery-pagination';
        pagination.style.display = 'flex';
        pagination.style.alignItems = 'center';
        pagination.style.justifyContent = 'center';
        pagination.style.gap = '12px';
        pagination.style.padding = '12px 0';

        this.prevPageBtn = new Button({
            label: '上一页',
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    void this.renderCurrentPage();
                }
            },
        });
        pagination.appendChild(this.prevPageBtn.element);
        this.disposables.push(this.prevPageBtn);

        this.pageInfoEl = document.createElement('span');
        this.pageInfoEl.style.fontSize = '12px';
        this.pageInfoEl.style.color = 'var(--da-text-secondary, #aaa)';
        this.pageInfoEl.textContent = '第 1 / 1 页 (共 0 项)';
        pagination.appendChild(this.pageInfoEl);

        this.nextPageBtn = new Button({
            label: '下一页',
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
                const totalPages = Math.ceil(this.filteredRecords.length / this.pageSize) || 1;
                if (this.currentPage < totalPages) {
                    this.currentPage++;
                    void this.renderCurrentPage();
                }
            },
        });
        pagination.appendChild(this.nextPageBtn.element);
        this.disposables.push(this.nextPageBtn);

        this.element.appendChild(pagination);
    }

    /**
     * 重新从本地存储检索全量记录并刷新视图。
     */
    public async refresh(): Promise<void> {
        try {
            // 读取本地 IndexedDB 中除已物理标记删除外的记录
            const records = await imageStorage.listImages({ limit: 10000 });
            this.allRecords = records.filter((r) => r.status !== 'deleted');

            // 重新汇总存储配额与统计卡片
            await this.refreshStorageSummary();

            // 执行过滤与重绘
            await this.applyFiltersAndRender();
        } catch (err) {
            logger.error('[GalleryTabView] 刷新图像画廊异常:', err);
            Toast.error('刷新画廊记录失败');
        }
    }

    /**
     * 重新计算存储统计概览并更新 StorageBar。
     */
    private async refreshStorageSummary(): Promise<void> {
        let favoritedCount = 0;
        let unfavoritedCount = 0;
        let failedCount = 0;

        for (const r of this.allRecords) {
            if (r.status === 'ready') {
                if (r.favorited) {
                    favoritedCount++;
                } else {
                    unfavoritedCount++;
                }
            } else if (r.status === 'failed') {
                failedCount++;
            }
        }

        const estimate = await imageStorage.getStorageEstimate();
        const totalBytes = estimate?.quotaBytes || 1024 * 1024 * 1024;
        const usedBytes = estimate?.usageBytes || 0;
        const usagePercentage = estimate?.usagePercent || 0;

        const summary: StorageSummaryData = {
            usedBytes,
            totalBytes,
            usagePercentage,
            totalImages: this.allRecords.filter((r) => r.status === 'ready').length,
            favoritedImages: favoritedCount,
            unfavoritedImages: unfavoritedCount,
            failedCount,
        };
        this.storageBar.update(summary);
    }

    /**
     * 执行关键词、引擎、标星与排序过滤并重新分页渲染。
     */
    private async applyFiltersAndRender(): Promise<void> {
        let result = [...this.allRecords];

        // 1. 关键词过滤（匹配 prompt、negativePrompt、模型名或 seed）
        if (this.keyword) {
            result = result.filter((r) => {
                const prompt = String(r.metadata?.prompt || '').toLowerCase();
                const neg = String(r.metadata?.negativePrompt || '').toLowerCase();
                const model = String(r.metadata?.modelName ?? (r.metadata as Record<string, unknown> | undefined)?.model ?? '').toLowerCase();
                const seed = String(r.metadata?.seed ?? '');
                return (
                    prompt.includes(this.keyword) ||
                    neg.includes(this.keyword) ||
                    model.includes(this.keyword) ||
                    seed.includes(this.keyword)
                );
            });
        }

        // 2. 生图引擎过滤
        if (this.engineFilter !== 'all') {
            result = result.filter((r) => {
                const engine = String(r.metadata?.engine || '').toLowerCase();
                return engine === this.engineFilter.toLowerCase();
            });
        }

        // 3. 标星收藏状态过滤
        if (this.favoriteFilter === 'favorited') {
            result = result.filter((r) => Boolean(r.favorited));
        } else if (this.favoriteFilter === 'unfavorited') {
            result = result.filter((r) => !r.favorited);
        }

        // 4. 排序规则
        if (this.sortMode === 'time-asc') {
            result.sort((a, b) => a.createdAt - b.createdAt);
        } else {
            result.sort((a, b) => b.createdAt - a.createdAt);
        }

        this.filteredRecords = result;
        await this.renderCurrentPage();
    }

    /**
     * 渲染当前页的媒体卡片列表。
     */
    private async renderCurrentPage(): Promise<void> {
        const seq = ++this.renderSeq;

        const totalItems = this.filteredRecords.length;
        const totalPages = Math.ceil(totalItems / this.pageSize) || 1;

        if (this.currentPage > totalPages) {
            this.currentPage = totalPages;
        }

        const startIndex = (this.currentPage - 1) * this.pageSize;
        const pageItems = this.filteredRecords.slice(startIndex, startIndex + this.pageSize);

        // 2. 更新分页指示状态
        this.pageInfoEl.textContent = `第 ${this.currentPage} / ${totalPages} 页 (共 ${totalItems} 项)`;
        this.prevPageBtn.setDisabled(this.currentPage <= 1);
        this.nextPageBtn.setDisabled(this.currentPage >= totalPages);

        // 3. 空状态展示
        if (pageItems.length === 0) {
            this.cleanCurrentPageCards();
            this.gridContainer.innerHTML = `
                <div class="da-gallery-empty" style="grid-column: 1 / -1; padding: 48px 0; text-align: center; color: var(--da-text-secondary, #888);">
                    <div style="font-size: 32px; margin-bottom: 8px;">🖼️</div>
                    <div style="font-size: 13px;">暂无匹配的图像资产记录</div>
                </div>
            `;
            return;
        }

        // 4. 组装并批量渲染当前页卡片（原子化收集）
        const newCards: MediaCard[] = [];
        const newUrls: string[] = [];

        for (const record of pageItems) {
            let displayUrl = record.remotePath ? record.remotePath : urlPool.getUrl(record.imageId);

            if (!displayUrl) {
                const blob = await imageStorage.getImageBlob(record.imageId);
                if (blob) {
                    displayUrl = URL.createObjectURL(blob);
                    newUrls.push(displayUrl);
                }
            }

            if (seq !== this.renderSeq) {
                for (const u of newUrls) {
                    try {
                        URL.revokeObjectURL(u);
                    } catch {
                        // 防御性释放过期渲染帧的临时 Object URL，忽略可能已提前注销的地址
                    }
                }
                return;
            }

            if (displayUrl) {
                this.pageUrlMap.set(record.imageId, displayUrl);
            }

            const itemData: MediaCardItemData = {
                id: record.imageId,
                status: record.status,
                url: displayUrl,
                isFavorite: Boolean(record.favorited),
            };

            const card = new MediaCard({
                item: itemData,
                selectable: this.isBatchMode,
                selected: this.selectedIds.has(record.imageId),
                onSelect: (selected, item) => {
                    if (selected) {
                        this.selectedIds.add(item.id);
                    } else {
                        this.selectedIds.delete(item.id);
                    }
                    this.updateBatchSelectionUI();
                },
                onPreview: () => {
                    void this.openLightboxForRecord(record.imageId);
                },
                onToggleFavorite: async (fav, item) => {
                    await imageStorage.toggleFavorite(item.id);
                    this.allRecords = this.allRecords.map((r) =>
                        r.imageId === item.id ? { ...r, favorited: fav } : r
                    );
                    this.filteredRecords = this.filteredRecords.map((r) =>
                        r.imageId === item.id ? { ...r, favorited: fav } : r
                    );
                    await this.refreshStorageSummary();
                    Toast.success(fav ? '已标星收藏 ★' : '已取消收藏 ☆');
                },
                onDelete: async (item) => {
                    const confirmed = await ConfirmDialog.confirm({
                        title: '删除图片记录',
                        message: '确定要删除此图像记录吗？',
                        isDanger: true,
                    });
                    if (!confirmed) return;

                    await imageStorage.deleteImage(item.id);
                    this.allRecords = this.allRecords.filter((r) => r.imageId !== item.id);
                    this.selectedIds.delete(item.id);
                    await this.refreshStorageSummary();
                    await this.applyFiltersAndRender();
                    Toast.success('图像已移除');
                },
            });

            newCards.push(card);
        }

        if (seq !== this.renderSeq) {
            for (const c of newCards) {
                c.dispose();
            }
            for (const u of newUrls) {
                try {
                    URL.revokeObjectURL(u);
                } catch {
                    // 防御性释放过期渲染帧的临时 Object URL，忽略可能已提前注销的地址
                }
            }
            return;
        }

        // 清理旧卡片与挂载新卡片
        this.cleanCurrentPageCards();
        this.pageBlobUrls.push(...newUrls);
        this.activeCards.push(...newCards);
        this.gridContainer.innerHTML = '';
        for (const card of newCards) {
            this.gridContainer.appendChild(card.element);
        }

        this.updateBatchSelectionUI();
    }

    /**
     * 为当前选中的记录或卡片打开大图画廊预览。
     */
    private async openLightboxForRecord(focusedImageId: string): Promise<void> {
        const lightboxItems: LightboxItem[] = [];
        let startIndex = 0;

        for (let i = 0; i < this.filteredRecords.length; i++) {
            const r = this.filteredRecords[i];
            let url = r.remotePath || urlPool.getUrl(r.imageId) || this.pageUrlMap.get(r.imageId);
            if (!url && r.imageId === focusedImageId) {
                // 若当前聚焦的图像在当前页还未命中 URL，异步从 storage 读取并创建
                const blob = await imageStorage.getImageBlob(r.imageId);
                if (blob) {
                    url = URL.createObjectURL(blob);
                    this.pageBlobUrls.push(url);
                    this.pageUrlMap.set(r.imageId, url);
                }
            }

            if (url) {
                lightboxItems.push({
                    url,
                    imageId: r.imageId,
                    title: r.metadata?.prompt || '未命名作品',
                    favorited: Boolean(r.favorited),
                });
                if (r.imageId === focusedImageId) {
                    startIndex = lightboxItems.length - 1;
                }
            }
        }

        if (lightboxItems.length > 0) {
            lightboxModal.openItems(lightboxItems, startIndex);
        } else {
            Toast.info('暂无可预览的完整图像资源');
        }
    }

    /**
     * 切换批量多选管理模式。
     */
    private toggleBatchMode(): void {
        this.isBatchMode = !this.isBatchMode;
        this.batchToggleBtn.setLabel(this.isBatchMode ? '退出管理' : '批量管理');
        this.batchToolbarEl.style.display = this.isBatchMode ? 'flex' : 'none';

        for (const card of this.activeCards) {
            card.setSelectable(this.isBatchMode);
        }

        if (!this.isBatchMode) {
            this.selectedIds.clear();
        }
        this.updateBatchSelectionUI();
    }

    /**
     * 全选当前页所有条目。
     */
    private selectAllCurrentPage(): void {
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const pageItems = this.filteredRecords.slice(startIndex, startIndex + this.pageSize);

        for (const r of pageItems) {
            this.selectedIds.add(r.imageId);
        }
        for (const card of this.activeCards) {
            card.setSelected(true);
        }
        this.updateBatchSelectionUI();
    }

    /**
     * 更新批量选择条中的已选数量计数。
     */
    private updateBatchSelectionUI(): void {
        if (this.batchCountEl) {
            this.batchCountEl.textContent = `已选中 ${this.selectedIds.size} 项`;
        }
    }

    /**
     * 导出已选记录的 JSON 备份清单。
     */
    private exportSelectedBackup(): void {
        if (this.selectedIds.size === 0) {
            Toast.info('请先勾选需要导出的图像记录');
            return;
        }

        const selectedRecords = this.allRecords.filter((r) => this.selectedIds.has(r.imageId));
        const exportData = {
            exportVersion: '1.0.0',
            exportedAt: Date.now(),
            count: selectedRecords.length,
            records: selectedRecords,
        };

        try {
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `st_draw_backup_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            Toast.success(`成功导出 ${selectedRecords.length} 项备份清单`);
        } catch (err) {
            logger.error('[GalleryTabView] 导出备份异常:', err);
            Toast.error('导出失败，请重试');
        }
    }

    /**
     * 批量删除已选条目（默认自动保护已标星收藏项）。
     */
    private async deleteSelectedItems(): Promise<void> {
        if (this.selectedIds.size === 0) {
            Toast.info('请先勾选需要删除的条目');
            return;
        }

        const toDelete: StoredImageRecord[] = [];
        let protectedCount = 0;

        for (const id of this.selectedIds) {
            const rec = this.allRecords.find((r) => r.imageId === id);
            if (rec) {
                if (rec.favorited) {
                    protectedCount++;
                } else {
                    toDelete.push(rec);
                }
            }
        }

        let confirmMsg = `确定要批量删除选中的 ${toDelete.length} 张未标星图片吗？`;
        if (protectedCount > 0) {
            confirmMsg += `\n（检测到 ${protectedCount} 项已标星收藏，将受到自动保护不被删除）`;
        }

        const confirmed = await ConfirmDialog.confirm({
            title: '批量删除图片',
            message: confirmMsg,
            isDanger: true,
        });
        if (!confirmed) return;

        for (const rec of toDelete) {
            await imageStorage.deleteImage(rec.imageId);
            this.selectedIds.delete(rec.imageId);
        }

        Toast.success(`已批量删除 ${toDelete.length} 张图片`);
        await this.refresh();
    }

    /**
     * 清理所有失败记录。
     */
    private async cleanFailedRecords(): Promise<void> {
        let count = 0;
        for (const r of this.allRecords) {
            if (r.status === 'failed') {
                await imageStorage.deleteImage(r.imageId);
                count++;
            }
        }
        Toast.success(`已清理 ${count} 条失败记录`);
        await this.refresh();
    }

    /**
     * 清理所有未标星草稿图片。
     */
    private async cleanUnfavoritedRecords(): Promise<void> {
        let count = 0;
        for (const r of this.allRecords) {
            if (r.status === 'ready' && !r.favorited) {
                await imageStorage.deleteImage(r.imageId);
                count++;
            }
        }
        Toast.success(`已安全清理 ${count} 张未标星草稿图片`);
        await this.refresh();
    }

    /**
     * 清空全部存储记录（弹出二次确认，且保护标星资产）。
     */
    private async clearAllRecords(): Promise<void> {
        let count = 0;
        for (const r of this.allRecords) {
            if (!r.favorited) {
                await imageStorage.deleteImage(r.imageId);
                count++;
            }
        }
        Toast.success(`已清理 ${count} 条非收藏记录`);
        await this.refresh();
    }

    /**
     * 清理当前页卡片与临时生成的 Object URL。
     */
    private cleanCurrentPageCards(): void {
        for (const card of this.activeCards) {
            card.dispose();
        }
        this.activeCards.length = 0;

        for (const url of this.pageBlobUrls) {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // 忽略注销异常
            }
        }
        this.pageBlobUrls.length = 0;
        this.pageUrlMap.clear();
    }

    /**
     * 当选项卡被激活切换展示时触发自动刷新。
     */
    public activate(): void {
        void this.refresh();
    }

    /**
     * 当选项卡切出隐藏时触发。
     */
    public deactivate(): void {
        // 停用切出时不作多余操作
    }


    /**
     * 释放画廊视图所有资源。
     */
    public dispose(): void {
        this.cleanCurrentPageCards();

        for (const d of this.disposables) {
            try {
                d.dispose();
            } catch {
                // 忽略销毁异常
            }
        }
        this.disposables.length = 0;
        this.element.innerHTML = '';
    }
}
