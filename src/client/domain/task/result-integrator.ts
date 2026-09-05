/**
 * @module domain/task/result-integrator
 * @description 生图结果存储与聊天记录保存
 *
 * 说明：
 * 1. 存储策略 (StorageStrategy)：
 *    - split: (默认) 原图存入本地数据库，聊天记录仅保存图片 ID，保持聊天记录文件小；
 *    - embedded: 原图转为 Base64 直接写入聊天记录，便于随聊天记录导出图片；
 *    - server: 服务端插件存储模式；
 * 2. 消息中的图片组织结构 (msg.extra.da_images[swipeId][buttonIndex])：
 *    - [swipeId]：按酒馆消息分支隔离，切换回答分支时展示对应分支的图片；
 *    - [buttonIndex]：按按钮槽位隔离，单条消息内多个占位符时支持独立保存；
 * 3. 图片保存成功后触发 asset:saved 事件，并防抖保存聊天记录。
 */

import { IDisposable } from '../../../common';
import { TypedEventBus } from '../../core/event-bus';
import {
    CoreEventMap,
    StoredImageRecord,
    ImageMetadata,
    DrawAssistantSettings,
    ChatImageEntry,
    ChatImagesRoot
} from '../../core/types';
import { Logger } from '../../core/logger';
import { StorageService } from '../../core/storage/storage-service';
import { HostClient } from '../../core/host/host-client';
import { TaskManager } from './task-manager';
import { GenerationResult } from '../types';
import { blobToBase64 } from '../../../common/utils/binary';

export interface ResultIntegratorOptions {
    events: TypedEventBus<CoreEventMap>;
    storage: StorageService;
    host: HostClient;
    tasks: TaskManager;
    getSettings: () => DrawAssistantSettings;
}

export class ResultIntegrator implements IDisposable {
    private readonly _events: TypedEventBus<CoreEventMap>;
    private readonly _storage: StorageService;
    private readonly _host: HostClient;
    private readonly _tasks: TaskManager;
    private readonly _getSettings: () => DrawAssistantSettings;
    private readonly _logger = new Logger('ResultIntegrator');
    private readonly _disposables: IDisposable[] = [];
    private _isDisposed = false;

    constructor(options: ResultIntegratorOptions) {
        this._events = options.events;
        this._storage = options.storage;
        this._host = options.host;
        this._tasks = options.tasks;
        this._getSettings = options.getSettings;

        // 监听生图任务完成事件并保存结果
        this._disposables.push(
            this._events.on('task:completed', ({ taskId, result }: { taskId: string; result: GenerationResult }) => {
                void this.integrate(taskId, result);
            })
        );
    }

    /**
     * 保存生成结果并按 [swipeId][buttonIndex] 写入聊天记录
     *
     * @param taskId 任务标识
     * @param result 生成结果
     * @returns 已保存的图像记录列表
     */
    public async integrate(taskId: string, result: GenerationResult): Promise<StoredImageRecord[]> {
        if (this._isDisposed) return [];

        const task = this._tasks.getTask(taskId);
        if (!task || task.status === 'CANCELLED' || task.status === 'FAILED') {
            this._logger.info(`任务 [${taskId}] 状态非正常完成 (${task?.status || '不存在'})，跳过保存`);
            return [];
        }

        const settings = this._getSettings();
        const strategy = settings.storageStrategy || 'split';
        const contextInfo = task.request.contextInfo;
        const messageId = contextInfo?.messageId;
        const savedRecords: StoredImageRecord[] = [];

        // 解析当前楼层的 swipeId 与 buttonIndex
        let swipeId = contextInfo?.swipeId;
        const buttonIndex = contextInfo?.buttonIndex ?? 0;

        if (typeof messageId === 'number' && typeof swipeId !== 'number') {
            try {
                const msg = this._host.getChatMessage(messageId);
                swipeId = msg?.swipe_id ?? (msg?.extra?.swipe_id as number | undefined) ?? 0;
            } catch {
                swipeId = 0;
            }
        }
        const effectiveSwipeId = swipeId ?? 0;

        for (let i = 0; i < result.images.length; i++) {
            const img = result.images[i];
            const assetId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const metadata: ImageMetadata = {
                assetId,
                engine: result.engine,
                createdAt: Date.now(),
                prompt: task.request.prompt,
                negativePrompt: task.request.negativePrompt,
                contextInfo: task.request.contextInfo,
                durationMs: result.durationMs,
                engineParams: task.request.engineOptions,
                rawResponse: img.metadata
            };

            const record: StoredImageRecord = {
                id: assetId,
                prompt: task.request.prompt,
                originalBlob: img.blob,
                metadata
            };

            // 保存到本地数据库 (支持哈希去重与容量清理)
            let finalAssetId = assetId;
            try {
                const returnedId = await this._storage.saveImage(record, {
                    deduplicate: settings.deduplicateHash !== false,
                    maxStoredImages: settings.maxStoredImages
                });
                if (returnedId) {
                    finalAssetId = returnedId;
                }
                this._events.emit('asset:saved', { assetId: finalAssetId, record });
                savedRecords.push(record);
            } catch (err) {
                this._logger.error(`保存图像资产到数据库异常 [${assetId}]`, err);
            }

            // 若任务关联了聊天楼层，组织消息扩展数据
            if (typeof messageId === 'number') {
                try {
                    let embeddedBase64: string | undefined;

                    // 当用户启用 embedded 模式时，将原图转为 Base64 并直接内嵌在聊天元数据中
                    if (strategy === 'embedded') {
                        const rawB64 = await blobToBase64(img.blob);
                        embeddedBase64 = `data:image/${img.format || 'png'};base64,${rawB64}`;
                    }

                    const effectiveSlotIndex = result.images.length > 1 ? buttonIndex + i : buttonIndex;
                    const chatEntry: ChatImageEntry = {
                        uuid: finalAssetId,
                        mime: `image/${img.format || 'png'}`,
                        format: img.format || 'png',
                        engine: result.engine,
                        prompt: task.request.prompt,
                        negativePrompt: task.request.negativePrompt,
                        timestamp: metadata.createdAt,
                        storageStrategy: strategy,
                        base64: embeddedBase64,
                        metadata: {
                            durationMs: result.durationMs,
                            params: task.request.engineOptions
                        }
                    };

                    // 读取当前楼层的 da_images 根对象并按 [swipeId][buttonIndex] 增量合并
                    const prevDaImages = (this._host.readChatMessageExtra<ChatImagesRoot>(messageId, 'da_images') || {}) as ChatImagesRoot;
                    const swipeImages = { ...(prevDaImages[effectiveSwipeId] || {}) };
                    swipeImages[effectiveSlotIndex] = chatEntry;

                    const updatedRoot: ChatImagesRoot = {
                        ...prevDaImages,
                        [effectiveSwipeId]: swipeImages
                    };

                    this._host.writeChatMessageExtra(messageId, 'da_images', updatedRoot);
                    this._logger.info(`已成功将生图资产持久化至楼层 #${messageId} (Swipe: ${effectiveSwipeId}, Button: ${effectiveSlotIndex})`);
                } catch (err) {
                    this._logger.error(`写入消息元数据异常 [楼层: ${messageId}]`, err);
                }
            }
        }

        return savedRecords;
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
    }
}
