/**
 * 本地图库状态模型 (GalleryState)。
 *
 * @remarks
 * 管理本地图库的状态与交互逻辑：
 * 包含关键词检索、引擎筛选、收藏状态筛选、排序、分页、批量操作、
 * JSON 备份导出、全屏大图预览及 Blob Object URL 内存生命周期管理。
 */

import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import type { DrawingTask, ProviderType, StoredImageRecord } from '@types';
import type { Disposable } from '../types';
import type { StorageSummaryData } from '../composite/storage-bar';
import { StorageMaintenanceService, GALLERY_QUERY_LIMIT } from './storage-maintenance';
import { imageStorage } from '../../store/image-storage';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { downloadJsonFile } from '../../util/browser-io';
import { validateCurrentPresetAssets } from '../../pipeline/floor-coordinator';
import {
    generationOrchestrator,
    type SubmitTaskOptions,
} from '../../pipeline/generation-orchestrator';
import {
    buildRegenerationSubmitSpec,
    inspectRecordForRegeneration,
    type InpaintOverrideInput,
    type ReplayMode,
    type SeedMode,
} from '../../pipeline/regeneration-planner';
import { imageActionPanel } from '../media/image-action-panel';
import { lightboxModal, type LightboxItem } from '../media/lightbox-modal';
import { Toast } from '../feedback/toast';
import { reportRuntimeError } from '../feedback/error-feedback';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { logger } from '../../util/logger';

const DEFAULT_GALLERY_PAGE_SIZE = 24;

export class GalleryState implements Disposable {
    public readonly pageSize: number;

    /** 全量有效图像记录 */
    public readonly allRecords: Signal<StoredImageRecord[]>;
    /** 存储空间容量摘要 */
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
    /** 已确认无法载入的图像 ID 集合（记录加载失败项，避免重绘时重复请求） */
    public readonly loadFailedIds: Signal<Set<string>>;
    /** 图库通道进行中与待处理的生图任务（用于卡片实时呈现进度与重试/取消） */
    public readonly galleryTasks: Signal<DrawingTask[]>;
    /** 实时耗时刷新时间戳（仅在存在进行中图库任务时启用 1 秒定时器） */
    public readonly taskTickNow: Signal<number>;

    /** 经过关键词、引擎、收藏状态与排序后的记录列表 */
    public readonly filteredRecords: ReadonlySignal<StoredImageRecord[]>;
    /** 总页数 */
    public readonly totalPages: ReadonlySignal<number>;
    /** 当前页切片记录列表 */
    public readonly pageRecords: ReadonlySignal<StoredImageRecord[]>;

    private readonly allocatedBlobUrls = new Set<string>();
    private readonly lightboxHeldUrls = new Set<string>();
    private readonly autoRecoveryAttemptedIds = new Set<string>();
    private readonly dismissedTaskIds = new Set<string>();
    private readonly gallerySubmitSpecs = new Map<string, SubmitTaskOptions>();
    private readonly temporaryPreviewUrls = new Map<string, string>();
    private readonly disposers: (() => void)[] = [];
    private taskTickTimer: ReturnType<typeof setInterval> | null = null;
    private renderSeq = 0;
    private refreshSeq = 0;
    private regenOpenSeq = 0;
    private isActive = false;
    private isDisposed = false;

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
        this.loadFailedIds = signal<Set<string>>(new Set());
        this.galleryTasks = signal<DrawingTask[]>([]);
        this.taskTickNow = signal<number>(Date.now());

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
                    const model = String(r.metadata?.baseModel ?? '').toLowerCase();
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

        // 监听全局收藏状态变更并实时同步视图模型列表
        const unsubFav = eventBus.on('image:favorite-changed', ({ imageId, favorited }) => {
            if (this.isDisposed) return;
            const hasItem = this.allRecords.value.some((r) => r.imageId === imageId);
            if (!hasItem) return;
            this.allRecords.value = this.allRecords.value.map((r) =>
                r.imageId === imageId ? { ...r, favorited } : r
            );
            void StorageMaintenanceService.computeStorageSummary(this.allRecords.value).then((summary) => {
                if (this.isDisposed) return;
                this.storageSummary.value = summary;
            });
        });

        // 监听全局图片删除、任务状态变更与生成完成事件（后台持久化后同步刷新图库状态）
        const unsubDeleted = eventBus.on('image:deleted', ({ imageId }) => {
            if (this.isDisposed) return;
            this.removeRecordFromMemory(imageId);
        });
        const unsubTaskStatus = eventBus.on('task:status', (payload) => {
            if (this.isDisposed || !payload?.task || payload.task.destination !== 'gallery') {
                return;
            }
            if (this.isActive) {
                this.syncGalleryTasks();
                if (payload.status === 'failed') {
                    Toast.error('图库重新生成失败，可在卡片重试或前往「日志与统计」查看详情');
                } else if (payload.status === 'cancelled' && !payload.silentToast) {
                    Toast.info('图库生成任务已取消');
                }
            }
        });
        const unsubReady = eventBus.on('image:ready', (payload) => {
            if (this.isDisposed || !this.isActive) return;
            this.syncGalleryTasks();
            void this.refresh();
            if (payload?.destination === 'gallery') {
                Toast.success('新图片已生成并保存至本地图库');
            }
        });

        this.disposers.push(unsubFav, unsubDeleted, unsubTaskStatus, unsubReady);
    }

    /**
     * 页签激活时标记为活跃并拉取最新图库记录与图库通道任务状态。
     */
    public activate(): void {
        if (this.isDisposed) return;
        this.isActive = true;
        this.syncGalleryTasks();
        void this.refresh();
    }

    /**
     * 页签切出时停用活跃监听，避免后台任务就绪时触发无谓查询。
     */
    public deactivate(): void {
        this.isActive = false;
        this.stopTaskTickTimer();
    }

    private stopTaskTickTimer(): void {
        if (this.taskTickTimer !== null) {
            clearInterval(this.taskTickTimer);
            this.taskTickTimer = null;
        }
    }

    /**
     * 同步图库独立通道中的活跃及失败任务列表，并按需启停耗时计时器。
     */
    public syncGalleryTasks(): void {
        if (this.isDisposed) return;
        const tasks = generationOrchestrator
            .getTasksByDestination('gallery')
            .filter(
                (t) =>
                    (t.status === 'pending' || t.status === 'generating' || t.status === 'failed') &&
                    !this.dismissedTaskIds.has(t.taskId)
            );
        this.galleryTasks.value = tasks;

        const hasRunning = tasks.some((t) => t.status === 'pending' || t.status === 'generating');
        if (hasRunning && this.isActive) {
            this.taskTickNow.value = Date.now();
            if (this.taskTickTimer === null) {
                this.taskTickTimer = setInterval(() => {
                    if (this.isDisposed || !this.isActive) {
                        this.stopTaskTickTimer();
                        return;
                    }
                    this.taskTickNow.value = Date.now();
                }, 1000);
            }
        } else {
            this.stopTaskTickTimer();
        }
    }

    /**
     * 从图库记录唤起统一重绘工作台（默认优先复现原图参数，支持切换当前全局配置与种子模式）。
     */
    public async openRegenerateForRecord(
        record: StoredImageRecord,
        preferredUrl?: string
    ): Promise<void> {
        if (this.isDisposed) return;
        const seq = ++this.regenOpenSeq;

        let displayUrl =
            preferredUrl ||
            this.getDisplayUrl(record) ||
            this.temporaryPreviewUrls.get(record.imageId);
        if (!displayUrl) {
            try {
                const blob = await imageStorage.getImageBlob(record.imageId);
                if (this.isDisposed || seq !== this.regenOpenSeq) return;
                if (blob && blob.size > 0) {
                    displayUrl = URL.createObjectURL(blob);
                    this.temporaryPreviewUrls.set(record.imageId, displayUrl);
                }
            } catch {
                // 忽略临时 URL 解析异常
            }
        }

        if (this.isDisposed || seq !== this.regenOpenSeq) return;

        const inspection = inspectRecordForRegeneration(record);

        imageActionPanel.open({
            source: 'gallery',
            imageId: record.imageId,
            imageUrl: displayUrl,
            prompt: inspection.originalPrompt || inspection.currentPrompt,
            negativePrompt:
                inspection.originalNegativePrompt || inspection.currentNegativePrompt,
            record,
            defaultReplayMode: inspection.hasReplaySnapshot ? 'original' : 'current',
            onSubmitRegenerate: async (decision) => {
                return await this.submitGalleryRegen(record, {
                    replayMode: decision.replayMode,
                    seedMode: decision.seedMode,
                    editedPrompt: decision.prompt,
                    editedNegativePrompt: decision.negativePrompt,
                });
            },
            onSubmitInpaint: async (inpaintData, decision) => {
                return await this.submitGalleryRegen(record, {
                    replayMode: decision.replayMode,
                    seedMode: decision.seedMode,
                    editedPrompt: inpaintData.prompt,
                    editedNegativePrompt: inpaintData.negativePrompt,
                    inpaint: {
                        initImage: inpaintData.initImage,
                        maskImage: inpaintData.maskImage,
                        width: inpaintData.width,
                        height: inpaintData.height,
                        denoiseStrength: inpaintData.denoiseStrength,
                        maskBlur: inpaintData.maskBlur,
                    },
                });
            },
        });
    }

    private async submitGalleryRegen(
        record: StoredImageRecord,
        options: {
            replayMode: ReplayMode;
            seedMode: SeedMode;
            editedPrompt: string;
            editedNegativePrompt?: string;
            inpaint?: InpaintOverrideInput;
        }
    ): Promise<boolean> {
        const spec = buildRegenerationSubmitSpec({
            record,
            replayMode: options.replayMode,
            seedMode: options.seedMode,
            editedPrompt: options.editedPrompt,
            editedNegativePrompt: options.editedNegativePrompt,
            inpaint: options.inpaint,
        });
        const targetProvider =
            spec.providerType ?? (settingsStore.getSettings().activeProvider as ProviderType);

        if (options.replayMode === 'current') {
            const check = validateCurrentPresetAssets(targetProvider);
            if (!check.valid) {
                const confirmed = await ConfirmDialog.confirm({
                    title: '模型缺失确认',
                    message: `当前生图参数预设引用的部分模型未在服务端检测到：\n- ${check.missing.join('\n- ')}\n\n是否仍继续尝试生图？`,
                    confirmText: '继续生图',
                    cancelText: '取消',
                });
                if (!confirmed) {
                    return false;
                }
            }
        }

        const submitOptions: SubmitTaskOptions = {
            destination: 'gallery',
            ...spec,
            providerType: targetProvider,
        };

        try {
            const taskId = await generationOrchestrator.submitTask(submitOptions);
            this.gallerySubmitSpecs.set(taskId, submitOptions);
            this.currentPage.value = 1;
            this.syncGalleryTasks();
            Toast.info('已加入图库生成队列');
            return true;
        } catch (err) {
            reportRuntimeError(
                '[GalleryState] 提交图库重绘任务失败:',
                '提交重新生成任务失败，请前往「日志与统计」查看详情',
                err
            );
            return false;
        }
    }

    /** 取消进行中的图库任务 */
    public cancelGalleryTask(taskId: string): void {
        generationOrchestrator.cancelTask(taskId, '用户主动取消图库任务');
        this.syncGalleryTasks();
    }

    /** 从图库网格移除失败任务的临时占位卡片 */
    public dismissGalleryTask(taskId: string): void {
        this.dismissedTaskIds.add(taskId);
        this.gallerySubmitSpecs.delete(taskId);
        this.syncGalleryTasks();
    }

    /** 一键重试失败的图库任务 */
    public async retryGalleryTask(taskId: string): Promise<void> {
        const spec = this.gallerySubmitSpecs.get(taskId);
        if (!spec) {
            this.dismissGalleryTask(taskId);
            Toast.info('未找到任务参数快照，请从原图卡片重新发起生成');
            return;
        }
        try {
            const nextTaskId = await generationOrchestrator.submitTask(spec);
            this.dismissedTaskIds.add(taskId);
            this.gallerySubmitSpecs.delete(taskId);
            this.gallerySubmitSpecs.set(nextTaskId, spec);
            this.currentPage.value = 1;
            this.syncGalleryTasks();
            Toast.info('已重新提交图库生成任务');
        } catch (err) {
            reportRuntimeError(
                '[GalleryState] 重试图库任务失败:',
                '重新提交失败，请前往「日志与统计」查看详情',
                err
            );
        }
    }

    private removeRecordFromMemory(imageId: string): void {
        const hadRecord = this.allRecords.value.some((r) => r.imageId === imageId);
        if (hadRecord) {
            this.allRecords.value = this.allRecords.value.filter((r) => r.imageId !== imageId);
        }

        if (this.selectedIds.value.has(imageId)) {
            const nextSel = new Set(this.selectedIds.value);
            nextSel.delete(imageId);
            this.selectedIds.value = nextSel;
        }

        const tempUrl = this.temporaryPreviewUrls.get(imageId);
        if (tempUrl) {
            this.revokeUrlForce(tempUrl);
            this.temporaryPreviewUrls.delete(imageId);
        }

        const currentMap = this.pageUrlMap.value;
        const oldUrl = currentMap.get(imageId);
        if (oldUrl || currentMap.has(imageId)) {
            const nextUrlMap = new Map(currentMap);
            if (oldUrl) {
                this.revokeUrlForce(oldUrl);
            }
            nextUrlMap.delete(imageId);
            this.pageUrlMap.value = nextUrlMap;
        }

        if (hadRecord) {
            void StorageMaintenanceService.computeStorageSummary(this.allRecords.value).then(
                (summary) => {
                    if (this.isDisposed) return;
                    this.storageSummary.value = summary;
                }
            );
        }
    }

    /**
     * 重新从 IndexedDB 加载全量记录并刷新统计摘要与当前页资源。
     */
    public async refresh(): Promise<void> {
        if (this.isDisposed) return;
        const seq = ++this.refreshSeq;
        try {
            this.autoRecoveryAttemptedIds.clear();
            if (this.loadFailedIds.value.size > 0) {
                this.loadFailedIds.value = new Set();
            }
            const records = await imageStorage.listImages({ limit: GALLERY_QUERY_LIMIT });
            if (this.isDisposed || seq !== this.refreshSeq) return;
            const summary = await StorageMaintenanceService.computeStorageSummary(records);
            if (this.isDisposed || seq !== this.refreshSeq) return;
            this.allRecords.value = records;
            this.storageSummary.value = summary;
            if (this.currentPage.value > this.totalPages.value) {
                this.currentPage.value = this.totalPages.value;
            }
            await this.resolveCurrentPageUrls();
        } catch (err) {
            if (!this.isDisposed && seq === this.refreshSeq) {
                reportRuntimeError(
                    '[GalleryState] 刷新本地图库异常:',
                    '刷新本地图库记录失败，请前往「日志与统计」查看详情',
                    err
                );
            }
        }
    }

    /**
     * 为当前页记录异步解析本地 Blob URL（独立于楼层会话 urlPool，防止切会话时误释放图库资源）。
     */
    public async resolveCurrentPageUrls(): Promise<void> {
        if (this.isDisposed) return;
        const seq = ++this.renderSeq;
        const items = this.pageRecords.value;
        const nextMap = new Map<string, string>();
        const newUrls: string[] = [];

        for (const record of items) {
            let displayUrl: string | undefined = record.remotePath || undefined;

            if (!displayUrl) {
                try {
                    const blob = await imageStorage.getImageBlob(record.imageId);
                    if (blob && blob.size > 0) {
                        displayUrl = URL.createObjectURL(blob);
                        newUrls.push(displayUrl);
                    }
                } catch {
                    // 忽略单张图片 Blob 读取异常
                }
            }

            if (this.isDisposed || seq !== this.renderSeq) {
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
        for (const u of newUrls) {
            this.allocatedBlobUrls.add(u);
        }
        this.pageUrlMap.value = nextMap;
    }

    /**
     * 获取指定记录的展示 URL（优先使用页面已解析或回退生成的有效 URL，其次使用 remotePath）。
     */
    public getDisplayUrl(record: StoredImageRecord): string | undefined {
        return this.pageUrlMap.value.get(record.imageId) || record.remotePath;
    }

    /**
     * 当图库卡片加载异常或用户点击重试时，尝试从 IndexedDB 重新生成本地 Blob URL。
     *
     * @remarks
     * 静默自动恢复在同一页面周期内对同一 `imageId` 仅允许执行一次：
     * 若新 URL 仍触发 `error`（如存储中是非空但不可解码的损坏二进制），直接进入 `loadFailedIds`
     * 终止进一步重试，仅当用户手动点击「重试」时清除拦截重新载入。
     */
    public async retryLoadRecord(imageId: string, silent = false): Promise<boolean> {
        const markFailed = () => {
            if (!this.loadFailedIds.value.has(imageId)) {
                const nextFailed = new Set(this.loadFailedIds.value);
                nextFailed.add(imageId);
                this.loadFailedIds.value = nextFailed;
            }
        };

        const clearFailed = () => {
            if (this.loadFailedIds.value.has(imageId)) {
                const nextFailed = new Set(this.loadFailedIds.value);
                nextFailed.delete(imageId);
                this.loadFailedIds.value = nextFailed;
            }
        };

        if (silent) {
            if (this.autoRecoveryAttemptedIds.has(imageId)) {
                markFailed();
                return false;
            }
            this.autoRecoveryAttemptedIds.add(imageId);
        } else {
            this.autoRecoveryAttemptedIds.delete(imageId);
            clearFailed();
        }

        try {
            const blob = await imageStorage.getImageBlob(imageId);
            if (this.isDisposed) {
                return false;
            }
            if (!blob || blob.size === 0) {
                markFailed();
                if (!silent) {
                    Toast.warning('本地存储中未找到有效图像数据');
                }
                return false;
            }

            const prevUrl = this.pageUrlMap.value.get(imageId);
            if (prevUrl) {
                this.revokeUrlForce(prevUrl);
            }

            const freshUrl = URL.createObjectURL(blob);
            this.allocatedBlobUrls.add(freshUrl);
            clearFailed();
            const nextMap = new Map(this.pageUrlMap.value);
            nextMap.set(imageId, freshUrl);
            this.pageUrlMap.value = nextMap;
            return true;
        } catch (err) {
            markFailed();
            if (!silent) {
                reportRuntimeError(
                    `[GalleryState] 重试载入图像失败 (imageId: ${imageId}):`,
                    '重新载入图像失败，请前往「日志与统计」查看详情',
                    err,
                    'warn'
                );
            } else {
                logger.warn(`[GalleryState] 重试载入图像失败 (imageId: ${imageId}):`, err);
            }
            return false;
        }
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

    /**
     * 清空当前所有勾选选区。
     */
    public clearSelection(): void {
        this.selectedIds.value = new Set();
    }

    /**
     * 切换单张图片标星收藏状态。
     *
     * @param imageId 目标图片唯一标识符
     * @param fav 目标标星状态
     */
    public async toggleFavorite(imageId: string, _fav?: boolean): Promise<void> {
        if (this.isDisposed) return;
        let changed = false;
        const off = eventBus.on('image:favorite-changed', (payload) => {
            if (payload.imageId === imageId) {
                changed = true;
            }
        });
        let nextFav = false;
        try {
            nextFav = await imageStorage.toggleFavorite(imageId);
        } finally {
            off();
        }
        if (this.isDisposed) return;
        if (!changed) {
            Toast.error('操作失败：本地图像记录不存在');
            return;
        }
        Toast.success(nextFav ? '已加入收藏' : '已取消收藏');
    }

    /**
     * 删除单张图片记录。
     *
     * @param imageId 目标图片唯一标识符
     */
    public async deleteSingleRecord(imageId: string): Promise<void> {
        if (this.isDisposed) return;
        const confirmed = await ConfirmDialog.confirm({
            title: '删除图片记录',
            message: '确定要删除此图像记录吗？',
            isDanger: true,
        });
        if (!confirmed || this.isDisposed) return;

        await imageStorage.deleteImage(imageId);
        if (this.isDisposed) return;
        this.removeRecordFromMemory(imageId);

        const summary = await StorageMaintenanceService.computeStorageSummary(this.allRecords.value);
        if (this.isDisposed) return;
        this.storageSummary.value = summary;
        await this.resolveCurrentPageUrls();
        if (this.isDisposed) return;
        Toast.success('图片已删除');
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
            downloadJsonFile(`st_draw_backup_${Date.now()}.json`, exportData);
            Toast.success(`成功导出 ${selectedRecords.length} 项备份清单`);
        } catch (err) {
            reportRuntimeError(
                '[GalleryState] 导出备份异常:',
                '导出失败，请前往「日志与统计」查看详情',
                err
            );
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

        if (toDelete.length === 0) {
            Toast.info(
                protectedCount > 0
                    ? `选中的 ${protectedCount} 项均已标星收藏，受保护无法批量删除`
                    : '没有可删除的未标星图片'
            );
            return;
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
        if (!confirmed || this.isDisposed) return;

        const nextSel = new Set(sel);
        const nextUrlMap = new Map(this.pageUrlMap.value);
        for (const rec of toDelete) {
            await imageStorage.deleteImage(rec.imageId);
            if (this.isDisposed) return;
            nextSel.delete(rec.imageId);
            const tempUrl = this.temporaryPreviewUrls.get(rec.imageId);
            if (tempUrl) {
                this.revokeUrlForce(tempUrl);
                this.temporaryPreviewUrls.delete(rec.imageId);
            }
            const oldUrl = nextUrlMap.get(rec.imageId);
            if (oldUrl) {
                this.revokeUrlForce(oldUrl);
            }
            nextUrlMap.delete(rec.imageId);
        }
        this.selectedIds.value = nextSel;
        this.pageUrlMap.value = nextUrlMap;

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

        // 释放上一轮仅由灯箱持有的过期 Blob URL，再为本轮灯箱会话锁定当前展示 URL
        for (const heldUrl of this.lightboxHeldUrls) {
            if (!this.allocatedBlobUrls.has(heldUrl) && heldUrl.startsWith('blob:')) {
                try {
                    URL.revokeObjectURL(heldUrl);
                } catch {
                    // 忽略过期 Blob URL 回收异常
                }
            }
        }
        this.lightboxHeldUrls.clear();

        for (let i = 0; i < filtered.length; i++) {
            const r = filtered[i];
            let url = this.getDisplayUrl(r);
            if (!url && r.imageId === focusedImageId) {
                const blob = await imageStorage.getImageBlob(r.imageId);
                if (this.isDisposed) return;
                if (blob && blob.size > 0) {
                    url = URL.createObjectURL(blob);
                    this.allocatedBlobUrls.add(url);
                    const nextMap = new Map(this.pageUrlMap.value);
                    nextMap.set(r.imageId, url);
                    this.pageUrlMap.value = nextMap;
                }
            }

            if (url) {
                if (url.startsWith('blob:')) {
                    this.lightboxHeldUrls.add(url);
                }
                const resolvedRecordUrl = url;
                lightboxItems.push({
                    url: resolvedRecordUrl,
                    imageId: r.imageId,
                    title: r.metadata?.prompt || '未命名作品',
                    favorited: Boolean(r.favorited),
                    onEdit: () => {
                        void this.openRegenerateForRecord(r, resolvedRecordUrl);
                    },
                    onFavoriteChange: (newFav) => {
                        if (this.isDisposed) return;
                        this.allRecords.value = this.allRecords.value.map((rec) =>
                            rec.imageId === r.imageId ? { ...rec, favorited: newFav } : rec
                        );
                        void StorageMaintenanceService.computeStorageSummary(this.allRecords.value).then(
                            (summary) => {
                                if (this.isDisposed) return;
                                this.storageSummary.value = summary;
                            }
                        );
                    },
                });
                if (r.imageId === focusedImageId) {
                    startIndex = lightboxItems.length - 1;
                }
            }
        }

        if (this.isDisposed) return;

        if (lightboxItems.length > 0) {
            lightboxModal.openItems(lightboxItems, startIndex);
        } else {
            Toast.info('暂无可预览的完整图像资源');
        }
    }

    private revokeUrlForce(url: string): void {
        this.allocatedBlobUrls.delete(url);
        this.lightboxHeldUrls.delete(url);
        if (url.startsWith('blob:')) {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // 忽略释放异常
            }
        }
    }

    private revokeAllocatedUrls(): void {
        for (const url of Array.from(this.allocatedBlobUrls)) {
            this.allocatedBlobUrls.delete(url);
            if (this.lightboxHeldUrls.has(url)) {
                continue;
            }
            if (url.startsWith('blob:')) {
                try {
                    URL.revokeObjectURL(url);
                } catch {
                    // 忽略释放异常
                }
            }
        }
    }

    public dispose(): void {
        this.isActive = false;
        this.isDisposed = true;
        this.stopTaskTickTimer();
        this.renderSeq += 1;
        this.refreshSeq += 1;
        this.regenOpenSeq += 1;
        for (const url of this.temporaryPreviewUrls.values()) {
            if (url.startsWith('blob:')) {
                try {
                    URL.revokeObjectURL(url);
                } catch {
                    // 忽略释放异常
                }
            }
        }
        this.temporaryPreviewUrls.clear();
        this.gallerySubmitSpecs.clear();
        for (const url of this.lightboxHeldUrls) {
            if (url.startsWith('blob:')) {
                try {
                    URL.revokeObjectURL(url);
                } catch {
                    // 忽略释放异常
                }
            }
        }
        this.lightboxHeldUrls.clear();
        this.revokeAllocatedUrls();
        this.pageUrlMap.value = new Map();
        for (const disposer of this.disposers) {
            try {
                disposer();
            } catch {
                // 忽略注销异常
            }
        }
        this.disposers.length = 0;
    }
}
