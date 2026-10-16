/**
 * 历史生图画廊视图模型 (GalleryViewModel)。
 *
 * @remarks
 * 将画廊的数据检索、关键词与多维过滤、排序、分页、批量勾选、标星收藏、
 * JSON 备份导出、大图灯箱预览及临时 Object URL 生命周期管理从视图层剥离为纯状态模型。
 */

import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import type { StoredImageRecord } from '@types';
import type { Disposable } from '../types';
import type { StorageSummaryData } from '../composite/storage-bar';
import { StorageMaintenanceService } from './storage-maintenance';
import { imageStorage } from '../../store/image-storage';
import { urlPool } from '../../store/url-pool';
import { lightboxModal, type LightboxItem } from '../media/lightbox-modal';
import { Toast } from '../feedback/toast';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { logger } from '../../util/logger';

export const DEFAULT_GALLERY_PAGE_SIZE = 24;

export class GalleryViewModel implements Disposable {
    public readonly pageSize: number;

    /** 全量有效图像记录 */
    public readonly allRecords: Signal<StoredImageRecord[]>;
    /** 存储空间水位摘要 */
    public readonly storageSummary: Signal<StorageSummaryData>;

    /** 检索与筛选条件信号 */
    public readonly keyword: Signal<string>;
    public readonly engineFilter: Signal<string>;
    public readonly favoriteFilter: Signal<string>;
    public readonly sortMode: Signal<string>;
    public readonly currentPage: Signal<number>;

    /** 批量管理模式与已选 ID 集合 */
    public readonly isBatchMode: Signal<boolean>;
    public readonly selectedIds: Signal<Set<string>>;

    /** 当前页已解析的图像 URL 映射表 (imageId -> url) */
    public readonly pageUrlMap: Signal<Map<string, string>>;

    /** 经过关键词、引擎、收藏状态与排序后的记录列表 */
    public readonly filteredRecords: ReadonlySignal<StoredImageRecord[]>;
    /** 总页数 */
    public readonly totalPages: ReadonlySignal<number>;
    /** 当前页切片记录列表 */
    public readonly pageRecords: ReadonlySignal<StoredImageRecord[]>;

    private readonly allocatedBlobUrls: string[] = [];
    private renderSeq = 0;

    public constructor(pageSize = DEFAULT_GALLERY_PAGE_SIZE) {
        this.pageSize = pageSize;

        this.allRecords = signal<StoredImageRecord[]>([]);
        this.storageSummary = signal<StorageSummaryData>({
            usedBytes: 0,
            totalBytes: 1024 * 1024 * 1024,
            usagePercentage: 0,
            totalImages: 0,
            favoritedImages: 0,
            unfavoritedImages: 0,
            failedCount: 0,
        });

        this.keyword = signal<string>('');
        this.engineFilter = signal<string>('all');
        this.favoriteFilter = signal<string>('all');
        this.sortMode = signal<string>('time-desc');
        this.currentPage = signal<number>(1);

        this.isBatchMode = signal<boolean>(false);
        this.selectedIds = signal<Set<string>>(new Set());
        this.pageUrlMap = signal<Map<string, string>>(new Map());

        this.filteredRecords = computed(() => {
            let result = [...this.allRecords.value];
            const kw = this.keyword.value.trim().toLowerCase();
            const eng = this.engineFilter.value;
            const fav = this.favoriteFilter.value;
            const sort = this.sortMode.value;

            if (kw) {
                result = result.filter((r) => {
                    const prompt = String(r.metadata?.prompt || '').toLowerCase();
                    const neg = String(r.metadata?.negativePrompt || '').toLowerCase();
                    const model = String(
                        r.metadata?.modelName ??
                            (r.metadata as Record<string, unknown> | undefined)?.model ??
                            ''
                    ).toLowerCase();
                    const seed = String(r.metadata?.seed ?? '');
                    return (
                        prompt.includes(kw) ||
                        neg.includes(kw) ||
                        model.includes(kw) ||
                        seed.includes(kw)
                    );
                });
            }

            if (eng !== 'all') {
                result = result.filter(
                    (r) => String(r.metadata?.engine || '').toLowerCase() === eng.toLowerCase()
                );
            }

            if (fav === 'favorited') {
                result = result.filter((r) => Boolean(r.favorited));
            } else if (fav === 'unfavorited') {
                result = result.filter((r) => !r.favorited);
            }

            if (sort === 'time-asc') {
                result.sort((a, b) => a.createdAt - b.createdAt);
            } else {
                result.sort((a, b) => b.createdAt - a.createdAt);
            }

            return result;
        });

        this.totalPages = computed(
            () => Math.ceil(this.filteredRecords.value.length / this.pageSize) || 1
        );

        this.pageRecords = computed(() => {
            const total = this.totalPages.value;
            const page = Math.min(Math.max(1, this.currentPage.value), total);
            const startIndex = (page - 1) * this.pageSize;
            return this.filteredRecords.value.slice(startIndex, startIndex + this.pageSize);
        });
    }

    /**
     * 重新从 IndexedDB 加载全量记录并刷新统计摘要与当前页资源。
     */
    public async refresh(): Promise<void> {
        try {
            const records = await imageStorage.listImages({ limit: 10000 });
            this.allRecords.value = records.filter((r) => r.status !== 'deleted');
            this.storageSummary.value = await StorageMaintenanceService.computeStorageSummary(
                this.allRecords.value
            );
            if (this.currentPage.value > this.totalPages.value) {
                this.currentPage.value = this.totalPages.value;
            }
            await this.resolveCurrentPageUrls();
        } catch (err) {
            logger.error('[GalleryViewModel] 刷新图像画廊异常:', err);
            Toast.error('刷新画廊记录失败');
        }
    }

    /**
     * 为当前页记录异步解析本地 Blob URL。
     */
    public async resolveCurrentPageUrls(): Promise<void> {
        const seq = ++this.renderSeq;
        const items = this.pageRecords.value;
        const nextMap = new Map<string, string>();
        const newUrls: string[] = [];

        for (const record of items) {
            let displayUrl = record.remotePath
                ? record.remotePath
                : urlPool.getUrl(record.imageId);

            if (!displayUrl && typeof imageStorage.getImageBlob === 'function') {
                try {
                    const blob = await imageStorage.getImageBlob(record.imageId);
                    if (blob) {
                        displayUrl = URL.createObjectURL(blob);
                        newUrls.push(displayUrl);
                    }
                } catch {
                    // 忽略单张图片 Blob 读取异常
                }
            }

            if (seq !== this.renderSeq) {
                for (const u of newUrls) {
                    try {
                        URL.revokeObjectURL(u);
                    } catch {
                        // 忽略提前释放异常
                    }
                }
                return;
            }

            if (displayUrl) {
                nextMap.set(record.imageId, displayUrl);
            }
        }

        this.revokeAllocatedUrls();
        this.allocatedBlobUrls.push(...newUrls);
        this.pageUrlMap.value = nextMap;
    }

    /**
     * 获取指定记录的展示 URL。
     */
    public getDisplayUrl(record: StoredImageRecord): string | undefined {
        return (
            record.remotePath ||
            urlPool.getUrl(record.imageId) ||
            this.pageUrlMap.value.get(record.imageId)
        );
    }

    public setKeyword(val: string): void {
        this.keyword.value = (val || '').trim().toLowerCase();
        this.currentPage.value = 1;
        void this.resolveCurrentPageUrls();
    }

    public setEngineFilter(val: string): void {
        this.engineFilter.value = val;
        this.currentPage.value = 1;
        void this.resolveCurrentPageUrls();
    }

    public setFavoriteFilter(val: string): void {
        this.favoriteFilter.value = val;
        this.currentPage.value = 1;
        void this.resolveCurrentPageUrls();
    }

    public setSortMode(val: string): void {
        this.sortMode.value = val;
        this.currentPage.value = 1;
        void this.resolveCurrentPageUrls();
    }

    public prevPage(): void {
        if (this.currentPage.value > 1) {
            this.currentPage.value -= 1;
            void this.resolveCurrentPageUrls();
        }
    }

    public nextPage(): void {
        if (this.currentPage.value < this.totalPages.value) {
            this.currentPage.value += 1;
            void this.resolveCurrentPageUrls();
        }
    }

    public toggleBatchMode(): void {
        const next = !this.isBatchMode.value;
        this.isBatchMode.value = next;
        if (!next) {
            this.selectedIds.value = new Set();
        }
    }

    public toggleSelectItem(imageId: string, selected: boolean): void {
        const next = new Set(this.selectedIds.value);
        if (selected) {
            next.add(imageId);
        } else {
            next.delete(imageId);
        }
        this.selectedIds.value = next;
    }

    public selectAllCurrentPage(): void {
        const next = new Set(this.selectedIds.value);
        for (const r of this.pageRecords.value) {
            next.add(r.imageId);
        }
        this.selectedIds.value = next;
    }

    public clearSelection(): void {
        this.selectedIds.value = new Set();
    }

    /**
     * 切换单张图片标星收藏状态。
     */
    public async toggleFavorite(imageId: string, fav: boolean): Promise<void> {
        await imageStorage.toggleFavorite(imageId);
        this.allRecords.value = this.allRecords.value.map((r) =>
            r.imageId === imageId ? { ...r, favorited: fav } : r
        );
        this.storageSummary.value = await StorageMaintenanceService.computeStorageSummary(
            this.allRecords.value
        );
        Toast.success(fav ? '已标星收藏 ★' : '已取消收藏 ☆');
    }

    /**
     * 删除单张图片记录。
     */
    public async deleteSingleRecord(imageId: string): Promise<void> {
        const confirmed = await ConfirmDialog.confirm({
            title: '删除图片记录',
            message: '确定要删除此图像记录吗？',
            isDanger: true,
        });
        if (!confirmed) return;

        await imageStorage.deleteImage(imageId);
        this.allRecords.value = this.allRecords.value.filter((r) => r.imageId !== imageId);
        const nextSel = new Set(this.selectedIds.value);
        nextSel.delete(imageId);
        this.selectedIds.value = nextSel;

        this.storageSummary.value = await StorageMaintenanceService.computeStorageSummary(
            this.allRecords.value
        );
        await this.resolveCurrentPageUrls();
        Toast.success('图像已移除');
    }

    /**
     * 导出选中项的 JSON 备份清单。
     */
    public exportSelectedBackup(): void {
        const sel = this.selectedIds.value;
        if (sel.size === 0) {
            Toast.info('请先勾选需要导出的图像记录');
            return;
        }

        const selectedRecords = this.allRecords.value.filter((r) => sel.has(r.imageId));
        const exportData = {
            exportVersion: '1.0.0',
            exportedAt: Date.now(),
            count: selectedRecords.length,
            records: selectedRecords,
        };

        try {
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json',
            });
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
            logger.error('[GalleryViewModel] 导出备份异常:', err);
            Toast.error('导出失败，请重试');
        }
    }

    /**
     * 批量删除已选记录（自动保护标星收藏记录）。
     */
    public async deleteSelectedItems(): Promise<void> {
        const sel = this.selectedIds.value;
        if (sel.size === 0) {
            Toast.info('请先勾选需要删除的条目');
            return;
        }

        const toDelete: StoredImageRecord[] = [];
        let protectedCount = 0;

        for (const id of sel) {
            const rec = this.allRecords.value.find((r) => r.imageId === id);
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

        const nextSel = new Set(sel);
        for (const rec of toDelete) {
            await imageStorage.deleteImage(rec.imageId);
            nextSel.delete(rec.imageId);
        }
        this.selectedIds.value = nextSel;

        Toast.success(`已批量删除 ${toDelete.length} 张图片`);
        await this.refresh();
    }

    /**
     * 打开全屏大图预览灯箱。
     */
    public async openLightboxForRecord(focusedImageId: string): Promise<void> {
        const lightboxItems: LightboxItem[] = [];
        let startIndex = 0;
        const filtered = this.filteredRecords.value;

        for (let i = 0; i < filtered.length; i++) {
            const r = filtered[i];
            let url = this.getDisplayUrl(r);
            if (
                !url &&
                r.imageId === focusedImageId &&
                typeof imageStorage.getImageBlob === 'function'
            ) {
                const blob = await imageStorage.getImageBlob(r.imageId);
                if (blob) {
                    url = URL.createObjectURL(blob);
                    this.allocatedBlobUrls.push(url);
                    const nextMap = new Map(this.pageUrlMap.value);
                    nextMap.set(r.imageId, url);
                    this.pageUrlMap.value = nextMap;
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

    public async cleanFailedRecords(): Promise<void> {
        const count = await StorageMaintenanceService.cleanFailedRecords(this.allRecords.value);
        Toast.success(`已清理 ${count} 条失败记录`);
        await this.refresh();
    }

    public async cleanUnfavoritedRecords(): Promise<void> {
        const count = await StorageMaintenanceService.cleanUnfavoritedRecords(
            this.allRecords.value
        );
        Toast.success(`已安全清理 ${count} 张未标星草稿图片`);
        await this.refresh();
    }

    public async clearAllRecords(): Promise<void> {
        const count = await StorageMaintenanceService.clearAllRecords(true, this.allRecords.value);
        Toast.success(`已清理 ${count} 条非收藏记录`);
        await this.refresh();
    }

    private revokeAllocatedUrls(): void {
        for (const url of this.allocatedBlobUrls) {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // 忽略释放异常
            }
        }
        this.allocatedBlobUrls.length = 0;
    }

    public dispose(): void {
        this.revokeAllocatedUrls();
        this.pageUrlMap.value = new Map();
    }
}
