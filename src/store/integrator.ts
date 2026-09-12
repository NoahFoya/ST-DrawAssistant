/**
 * 生图结果整合与消息楼层事务协调器
 * 职责：协调任务完成流转、本地分立存储持久化、构建轻量级元数据条目、
 * 写入聊天楼层插槽 [swipeId][buttonIndex]，并触发 MESSAGE_UPDATED 与 saveChat 事务闭环。
 */

import type {
    TaskItem,
    ImageGenerationResult,
    StoredImageRecord,
    ChatImageEntry,
    ChatImagesRoot
} from '@types';
import { PersistentStorage } from './storage';
import { TypedEventBus, IDisposable } from '../util/event-bus';
import { TaskEventMap } from './task';

/** 宿主聊天楼层与持久化接口提供者声明 (支持依赖注入) */
export interface ResultIntegratorHostProvider {
    getChatMessage?: (messageId: number) => any;
    writeChatMessageExtra?: (messageId: number, key: string, data: any) => void;
    readChatMessageExtra?: <T>(messageId: number, key: string) => T | undefined;
    emitMessageUpdated?: (messageId: number) => void;
    saveChat?: () => Promise<void>;
}

export interface ResultIntegratorOptions {
    storage: PersistentStorage;
    events?: TypedEventBus<TaskEventMap>;
    hostProvider?: ResultIntegratorHostProvider;
    autoListenEvents?: boolean;
}

export class ResultIntegrator implements IDisposable {
    private readonly _storage: PersistentStorage;
    private readonly _events?: TypedEventBus<TaskEventMap>;
    private readonly _host: ResultIntegratorHostProvider;
    private readonly _disposables: IDisposable[] = [];
    private _isDisposed = false;

    constructor(options: ResultIntegratorOptions) {
        this._storage = options.storage;
        this._events = options.events;
        this._host = options.hostProvider || this._resolveDefaultHostProvider();

        // 可选自动监听任务完成事件并执行整合
        if (options.autoListenEvents && this._events) {
            this._disposables.push(
                this._events.on('task:completed', () => {
                    // 由上层功能控制器按需调用 integrate
                })
            );
        }
    }

    /**
     * 默认探测并绑定 SillyTavern 宿主 API
     */
    private _resolveDefaultHostProvider(): ResultIntegratorHostProvider {
        return {
            getChatMessage: (messageId: number) => {
                if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
                    const chat = window.SillyTavern.getContext().chat;
                    return Array.isArray(chat) ? chat[messageId] : undefined;
                }
                return undefined;
            },
            readChatMessageExtra: <T>(messageId: number, key: string) => {
                if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
                    const chat = window.SillyTavern.getContext().chat;
                    return chat?.[messageId]?.extra?.[key] as T | undefined;
                }
                return undefined;
            },
            writeChatMessageExtra: (messageId: number, key: string, data: any) => {
                if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
                    const chat = window.SillyTavern.getContext().chat;
                    if (chat && chat[messageId]) {
                        if (!chat[messageId].extra) chat[messageId].extra = {};
                        chat[messageId].extra[key] = data;
                    }
                }
            },
            emitMessageUpdated: (messageId: number) => {
                if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
                    const { eventSource, eventTypes } = window.SillyTavern.getContext();
                    if (eventSource && eventTypes?.MESSAGE_UPDATED) {
                        eventSource.emit(eventTypes.MESSAGE_UPDATED, messageId);
                    }
                }
            },
            saveChat: async () => {
                if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
                    const ctx = window.SillyTavern.getContext();
                    if (typeof ctx.saveChat === 'function') {
                        await ctx.saveChat();
                    }
                }
            }
        };
    }

    /**
     * 整合单次生图结果：持久化存储并写入聊天记录楼层
     * @param task 已完成的任务实体
     * @param result 生图响应结果
     * @returns 持久化后的图片资产记录
     */
    public async integrate(
        task: TaskItem,
        result: ImageGenerationResult
    ): Promise<StoredImageRecord | null> {
        if (this._isDisposed || !task || !result || !result.blob) {
            return null;
        }

        const assetId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const format = result.mimeType?.replace('image/', '') || 'png';

        // 1. 本地持久化：二进制原图存入 IndexedDB
        const storedRecord: StoredImageRecord = {
            id: assetId,
            prompt: task.params.prompt,
            originalBlob: result.blob,
            metadata: {
                assetId,
                engine: String(task.engine),
                createdAt: Date.now(),
                prompt: task.params.prompt,
                negativePrompt: task.params.negativePrompt,
                durationMs: result.durationMs,
                dimensions: {
                    width: result.width,
                    height: result.height
                },
                contextInfo: {
                    chatId: task.identity.chatId,
                    messageId: task.identity.messageId,
                    swipeId: task.identity.swipeId,
                    buttonIndex: task.identity.buttonIndex
                },
                rawResponse: result.metadata
            }
        };

        let finalAssetId = assetId;
        try {
            finalAssetId = await this._storage.saveImage(storedRecord);
        } catch {
            // 保存失败降级继续
        }

        // 2. 楼层插槽绑定：按 [swipeId][buttonIndex] 写入目标消息 extra
        const messageId = task.identity.messageId;
        if (typeof messageId === 'number' && this._host.writeChatMessageExtra) {
            const swipeId = task.identity.swipeId ?? 0;
            const buttonIndex = task.identity.buttonIndex ?? 0;

            const chatEntry: ChatImageEntry = {
                uuid: finalAssetId,
                mime: result.mimeType || 'image/png',
                format,
                engine: String(task.engine),
                prompt: task.params.prompt,
                negativePrompt: task.params.negativePrompt,
                timestamp: Date.now(),
                storageStrategy: 'split',
                metadata: {
                    durationMs: result.durationMs,
                    width: result.width,
                    height: result.height,
                    seed: result.seed,
                    extra: result.metadata
                }
            };

            const prevRoot = (this._host.readChatMessageExtra?.<ChatImagesRoot>(messageId, 'da_images') || {}) as ChatImagesRoot;
            const swipeImages = { ...(prevRoot[swipeId] || {}) };
            swipeImages[buttonIndex] = chatEntry;

            const updatedRoot: ChatImagesRoot = {
                ...prevRoot,
                [swipeId]: swipeImages
            };

            this._host.writeChatMessageExtra(messageId, 'da_images', updatedRoot);

            // 3. 事务闭环：先通知视图更新，再持久化保存聊天
            try {
                this._host.emitMessageUpdated?.(messageId);
                await this._host.saveChat?.();
            } catch {
                // 忽略外部宿主保存抛错
            }
        }

        return storedRecord;
    }

    /**
     * 销毁整合器
     */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
    }
}
