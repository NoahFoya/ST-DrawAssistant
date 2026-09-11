/**
 * 生图结果存储与聊天记录保存
 * 支持本地数据库独立存储 (split) 与 Base64 聊天记录内嵌 (embedded)。
 * 消息内图片按分支 (swipeId) 和按钮槽位 (buttonIndex) 隔离存储，
 * 保存后触发 asset:saved 并防抖持久化酒馆聊天记录。
 */

import {
    IDisposable,
    CoreEventMap,
    StoredImageRecord,
    ImageMetadata,
    DrawAssistantSettings,
    ChatImageEntry,
    ChatImagesRoot,
    GenerationResult
} from '../types';
import { Logger } from '../utils/logger';
import { TypedEventBus } from '../utils/event-bus';
import { blobToBase64 } from '../utils/binary';
import { FeedbackService } from '../ui/feedback/feedback';
import { StorageService } from '../state/storage-service';
import { HostClient } from '../host/host-client';
import { TaskManager } from './task-manager';

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

        this._disposables.push(
            this._events.on('task:completed', ({ taskId, result }: { taskId: string; result: GenerationResult }) => {
                void this.integrate(taskId, result);
            })
        );
    }

    /**
     * 保存生成结果并按 [swipeId][buttonIndex] 写入聊天记录
     */
    public async integrate(taskId: string, result: GenerationResult): Promise<StoredImageRecord[]> {
        if (this._isDisposed) return [];

        const task = this._tasks.getTask(taskId);
        if (!task || task.status === 'CANCELLED' || task.status === 'FAILED') {
            this._logger.info(`任务 [${taskId}] 状态非完成态 (${task?.status || '不存在'})，跳过持久化`);
            return [];
        }

        const settings = this._getSettings();
        const shouldSaveToIndexedDB = settings.saveToIndexedDB !== false;
        const shouldSaveToServer = Boolean(settings.saveToServer);
        const shouldEmbedBase64 = Boolean(settings.embedToBase64);

        const contextInfo = task.request.contextInfo;
        const messageId = contextInfo?.messageId;
        const savedRecords: StoredImageRecord[] = [];

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

        const images = result.images;
        if (!images || images.length === 0) {
            this._logger.warn(`任务 [${taskId}] 未返回有效图片数据，跳过持久化集成`);
            return [];
        }

        if (images.length > 1) {
            this._logger.debug(`后端返回了 ${images.length} 张图片，采纳首张图片写入当前插槽`);
        }

        const img = images[0];
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

        let finalAssetId = assetId;
        // 默认持久化至浏览器本地 IndexedDB
        if (shouldSaveToIndexedDB) {
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
        } else {
            this._events.emit('asset:saved', { assetId: finalAssetId, record });
            savedRecords.push(record);
        }

        // 可选叠加项 1：写入酒馆服务端静态资产目录 (/api/images/upload)
        let serverStaticUrl: string | undefined;
        if (shouldSaveToServer) {
            try {
                const charName = this._host.getCurrentCharacter()?.name || undefined;
                const filename = `${finalAssetId}.${img.format || 'png'}`;
                const uploadRes = await this._host.uploadImageToServer(img.blob, {
                    filename,
                    characterName: charName,
                    format: img.format
                });
                if (uploadRes?.path) {
                    serverStaticUrl = uploadRes.path;
                    this._logger.info(`已上传图片至酒馆服务端静态目录: ${serverStaticUrl}`);
                }
            } catch (uploadErr) {
                this._logger.warn(`上传图片至酒馆服务端失败 [${finalAssetId}]，安全降级至本地`, uploadErr);
                FeedbackService.toastWarn('上传图片至酒馆服务端失败，已降级保存在浏览器本地');
            }
        }

        // 可选叠加项 2：写入聊天记录内嵌 Base64
        let embeddedBase64: string | undefined;
        if (shouldEmbedBase64) {
            try {
                const rawB64 = await blobToBase64(img.blob);
                embeddedBase64 = `data:image/${img.format || 'png'};base64,${rawB64}`;
            } catch (b64Err) {
                this._logger.warn(`生成 Base64 内嵌数据异常 [${finalAssetId}]`, b64Err);
            }
        }

        const strategy = serverStaticUrl ? 'server' : (shouldEmbedBase64 ? 'embedded' : 'split');

        // 将生成的图片绑定至对应的楼层插槽元数据
        if (typeof messageId === 'number') {
            try {
                const chat = typeof this._host.getChat === 'function' ? this._host.getChat() : null;
                if (Array.isArray(chat) && chat.length > 0 && !chat[messageId]) {
                    this._logger.warn(`楼层 #${messageId} 已不存在（可能已被删除），跳过元数据写入`);
                } else {
                    const slotIndex = buttonIndex;
                    const chatEntry: ChatImageEntry = {
                        uuid: finalAssetId,
                        mime: `image/${img.format || 'png'}`,
                        format: img.format || 'png',
                        engine: result.engine,
                        prompt: task.request.prompt,
                        negativePrompt: task.request.negativePrompt,
                        timestamp: metadata.createdAt,
                        storageStrategy: strategy,
                        url: serverStaticUrl,
                        base64: embeddedBase64,
                        metadata: {
                            durationMs: result.durationMs,
                            params: task.request.engineOptions
                        }
                    };

                    const prevDaImages = (this._host.readChatMessageExtra<ChatImagesRoot>(messageId, 'da_images') || {}) as ChatImagesRoot;
                    const swipeImages = { ...(prevDaImages[effectiveSwipeId] || {}) };
                    swipeImages[slotIndex] = chatEntry;

                    const updatedRoot: ChatImagesRoot = {
                        ...prevDaImages,
                        [effectiveSwipeId]: swipeImages
                    };

                    this._host.writeChatMessageExtra(messageId, 'da_images', updatedRoot);
                    this._logger.info(`已将生图资产写入楼层 #${messageId} (Swipe: ${effectiveSwipeId}, Slot: ${slotIndex})`);
                }
            } catch (err) {
                this._logger.error(`写入消息元数据异常 [楼层: ${messageId}]`, err);
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
