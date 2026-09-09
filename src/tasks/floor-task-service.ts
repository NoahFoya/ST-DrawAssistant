/**
 * 楼层生图业务服务 (FloorTaskService)
 * 独立于 DOM 表现层，专门负责楼层场景的任务提交流水线、任务取消与资产级联清理。
 */

import { IDisposable, ChatImagesRoot, ChatImageEntry } from '../types';
import { HostClient } from '../host/host-client';
import { SettingsStore } from '../state/settings-store';
import { TaskManager } from './task-manager';
import { PromptPipeline, PipelineProcessResult } from '../pipeline/prompt-pipeline';
import { StorageService } from '../state/storage-service';
import { normalizePromptPunctuation } from '../pipeline/prompt-utils';

export interface FloorTaskContext {
    prompt: string;
    negativePrompt?: string;
    messageId: number;
    swipeId: number;
    slotIndex: number;
    overridePrompt?: string;
    overrideNegativePrompt?: string;
    overrideInpaintData?: { initImageBlob: Blob; maskImageBlob: Blob };
}

export interface FloorTaskServiceOptions {
    host: HostClient;
    store: SettingsStore;
    taskManager: TaskManager;
    pipeline: PromptPipeline;
    storage: StorageService;
}

export interface SubmitFloorTaskResult {
    taskId: string;
    processResult: PipelineProcessResult;
}

export class FloorTaskService implements IDisposable {
    private readonly _host: HostClient;
    private readonly _store: SettingsStore;
    private readonly _taskManager: TaskManager;
    private readonly _pipeline: PromptPipeline;
    private readonly _storage: StorageService;
    private _isDisposed = false;

    constructor(options: FloorTaskServiceOptions) {
        this._host = options.host;
        this._store = options.store;
        this._taskManager = options.taskManager;
        this._pipeline = options.pipeline;
        this._storage = options.storage;
    }

    /**
     * 提交楼层生图任务
     * 执行全角中文标点标准化清洗，调用 PromptPipeline 生成标准化请求，并提交到 TaskManager。
     */
    public async submitTask(ctx: FloorTaskContext): Promise<SubmitFloorTaskResult> {
        if (this._isDisposed) {
            throw new Error('FloorTaskService has been disposed');
        }

        const settings = this._store.getState();
        const activeProvider = settings.activeProvider || 'comfyui';
        const engineConfig = this._store.getEngineConfig(activeProvider) || {};

        const rawPositive = ctx.overridePrompt || ctx.prompt;
        const rawNegative = ctx.overrideNegativePrompt || ctx.negativePrompt;

        // 统一前置清洗全角中文标点（，；：（）等），避免影响后续分词与模型提示词解析
        const promptToUse = normalizePromptPunctuation(rawPositive);
        const negativeToUse = rawNegative ? normalizePromptPunctuation(rawNegative) : undefined;

        const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const imageInputs = ctx.overrideInpaintData ? {
            initImageBlob: ctx.overrideInpaintData.initImageBlob,
            maskImageBlob: ctx.overrideInpaintData.maskImageBlob
        } : undefined;

        // 流水线处理
        const processResult = await this._pipeline.process({
            rawPrompt: promptToUse,
            negativePrompt: negativeToUse,
            targetEngine: activeProvider,
            taskId,
            engineOptions: engineConfig as Record<string, unknown>,
            imageInputs,
            contextInfo: {
                messageId: ctx.messageId,
                swipeId: ctx.swipeId,
                buttonIndex: ctx.slotIndex
            }
        }, settings);

        // 提交至任务管理器
        await this._taskManager.submit({
            request: processResult.request,
            messageId: ctx.messageId
        });

        return {
            taskId,
            processResult
        };
    }

    /**
     * 取消正在运行的楼层生图任务
     */
    public cancelTask(taskId: string, reason = '用户在楼层主动中断'): void {
        if (this._isDisposed || !taskId) return;
        this._taskManager.cancelTask(taskId, reason);
    }

    /**
     * 安全获取指定楼层、分支及插槽索引所持有的图片持久化记录
     */
    public getImageEntry(messageId: number, swipeId: number, slotIndex: number): ChatImageEntry | undefined {
        const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(messageId, 'da_images');
        return daImages ? daImages[swipeId]?.[slotIndex] : undefined;
    }

    /**
     * 级联删除指定楼层的图片资产：
     * 1. 清理宿主消息 extra 中的 da_images[swipeId][slotIndex]；
     * 2. 若配置了服务端保存且存在静态 URL，从服务端磁盘物理删除；
     * 3. 若存在本地 IndexedDB 记录，释放 Object URL 并从数据库物理删除。
     */
    public async deleteImage(
        messageId: number,
        swipeId: number,
        slotIndex: number,
        assetId?: string
    ): Promise<void> {
        const daImages = this._host.readChatMessageExtra<ChatImagesRoot>(messageId, 'da_images');
        const entry = daImages ? daImages[swipeId]?.[slotIndex] : undefined;
        const uuidToDelete = assetId || entry?.uuid;

        // 1. 宿主消息 extra 元数据清理
        if (daImages && entry) {
            delete daImages[swipeId][slotIndex];
            if (Object.keys(daImages[swipeId]).length === 0) {
                delete daImages[swipeId];
            }
            this._host.writeChatMessageExtra(messageId, 'da_images', daImages);
        }

        // 2. 服务端静态文件级联清理
        if (entry?.url) {
            try {
                await this._host.deleteImageFromServer(entry.url);
            } catch (err) {
                console.warn('[FloorTaskService] 删除服务端静态文件异常:', err);
            }
        }

        // 3. 本地数据库与临时 URL 级联清理
        if (uuidToDelete) {
            this._storage.releaseImageUrl(uuidToDelete);
            try {
                await this._storage.delete(uuidToDelete);
            } catch (err) {
                console.warn('[FloorTaskService] 删除本地 IndexedDB 记录异常:', err);
            }
        }
    }

    public dispose(): void {
        this._isDisposed = true;
    }
}
