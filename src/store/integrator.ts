/**
 * 生图结果整合与消息楼层协同
 *
 * 功能：
 * 1. 协调任务完成流转、本地分立存储持久化与轻量级元数据条目构建；
 * 2. 将生成结果写入聊天楼层数据结构 [swipeId][buttonIndex]；
 * 3. 触发 MESSAGE_UPDATED 事件与 saveChat 会话持久化。
 *
 * Tips：
 * 1. 楼层隔离：严格按 swipeId 与 buttonIndex 双重索引挂载图片，避免滑动重掷时图片错位；
 * 2. 存储容错：服务端上传失败时自动降级保留本地 IndexedDB 存储，不阻断主流程。
 */

import type {
    TaskItem,
    ImageGenerationResult,
    StoredImageRecord,
    ChatImageEntry,
    ChatImagesRoot,
    StorageStrategy
} from '@types';
import { PersistentStorage } from './storage';
import { SettingsStore } from './settings';
import type { IDisposable } from '@util/event-bus';
import { TypedEventBus } from '@util/event-bus';
import { blobToBase64 } from '@util/image';
import type { TaskEventMap } from './task';

/** 宿主聊天楼层与持久化接口提供者声明 (支持依赖注入) */
export interface ResultIntegratorHostProvider {
    getChatMessage?: (messageId: number) => any;
    writeChatMessageExtra?: (messageId: number, key: string, data: any) => void;
    readChatMessageExtra?: <T>(messageId: number, key: string) => T | undefined;
    emitMessageUpdated?: (messageId: number) => void;
    saveChat?: () => Promise<void>;
    uploadImageToServer?: (blob: Blob, options: { filename: string; characterName?: string; format?: string }) => Promise<{ path: string } | null>;
    getCurrentCharacterName?: () => string | undefined;
}

export interface ResultIntegratorOptions {
    storage: PersistentStorage;
    settingsStore?: SettingsStore;
    events?: TypedEventBus<TaskEventMap>;
    hostProvider?: ResultIntegratorHostProvider;
    autoListenEvents?: boolean;
}

export class ResultIntegrator implements IDisposable {
    private readonly _storage: PersistentStorage;
    private _settingsStore?: SettingsStore;
    private readonly _events?: TypedEventBus<TaskEventMap>;
    private readonly _host: ResultIntegratorHostProvider;
    private readonly _disposables: IDisposable[] = [];
    private _isDisposed = false;

    constructor(options: ResultIntegratorOptions) {
        this._storage = options.storage;
        this._settingsStore = options.settingsStore;
        this._events = options.events;
        this._host = { ...this._resolveDefaultHostProvider(), ...(options.hostProvider || {}) };

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
     * 绑定配置存储中心
     */
    public bindSettingsStore(store: SettingsStore): void {
        this._settingsStore = store;
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
            },
            uploadImageToServer: async (blob: Blob, options: { filename: string; characterName?: string; format?: string }) => {
                if (typeof window === 'undefined' || typeof fetch === 'undefined') {
                    return null;
                }
                try {
                    const ctx = window.SillyTavern?.getContext?.();
                    const headers: Record<string, string> = {
                        ...(ctx?.getRequestHeaders ? ctx.getRequestHeaders() : {}),
                        'Content-Type': 'application/json'
                    };
                    const base64 = await blobToBase64(blob, false);
                    const response = await fetch('/api/images/upload', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            image: base64,
                            filename: options.filename,
                            ch_name: options.characterName,
                            format: options.format || 'png'
                        })
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (data?.path) {
                            const normalizedPath = String(data.path).startsWith('/') ? data.path : `/${data.path}`;
                            return { path: normalizedPath };
                        }
                    }
                    return null;
                } catch (err) {
                    console.warn('[ST-DrawAssistant][ResultIntegrator] 上传图片至酒馆服务端失败:', err);
                    return null;
                }
            },
            getCurrentCharacterName: () => {
                if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
                    const ctx = window.SillyTavern.getContext();
                    const rawId = ctx.characterId;
                    const charId = typeof rawId === 'number' ? rawId : parseInt(String(rawId), 10);
                    if (!Number.isNaN(charId) && ctx.characters && ctx.characters[charId]) {
                        return (ctx.characters[charId] as any)?.name;
                    }
                }
                return undefined;
            }
        };
    }

    /**
     * 整合单次生图结果：持久化存储并写入聊天记录楼层
     * @param task 已完成的生图任务对象
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

        const imageId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const format = result.mimeType?.replace('image/', '') || 'png';

        // 1. 本地持久化：二进制原图默认存入 IndexedDB
        const storedRecord: StoredImageRecord = {
            id: imageId,
            prompt: task.params.prompt,
            originalBlob: result.blob,
            metadata: {
                id: imageId,
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
                engineParams: task.params,
                rawResponse: result.metadata
            }
        };

        const deduplicate = this._settingsStore?.get('deduplicateHash') ?? true;
        const maxStoredImages = this._settingsStore?.get('maxStoredImages') ?? 500;

        let finalImageId = imageId;
        try {
            finalImageId = await this._storage.saveImage(storedRecord, {
                deduplicate,
                maxStoredImages
            });
        } catch {
            // 保存失败降级继续
        }

        // 2. 检查叠加存储选项：上传服务端与内嵌 Base64
        const shouldSaveToServer = this._settingsStore?.get('saveToServer') ?? false;
        const shouldEmbedBase64 = this._settingsStore?.get('embedToBase64') ?? false;

        let serverStaticUrl: string | undefined;
        if (shouldSaveToServer && this._host.uploadImageToServer) {
            try {
                const charName = this._host.getCurrentCharacterName?.();
                const filename = `${finalImageId}.${format}`;
                const uploadRes = await this._host.uploadImageToServer(result.blob, {
                    filename,
                    characterName: charName,
                    format
                });
                if (uploadRes?.path) {
                    serverStaticUrl = uploadRes.path;
                }
            } catch (uploadErr) {
                console.warn('[ST-DrawAssistant][ResultIntegrator] 上传图片至服务端失败，降级本地存储:', uploadErr);
            }
        }

        let embeddedBase64: string | undefined;
        if (shouldEmbedBase64) {
            try {
                embeddedBase64 = await blobToBase64(result.blob, true);
            } catch (b64Err) {
                console.warn('[ST-DrawAssistant][ResultIntegrator] 生成 Base64 内嵌数据异常:', b64Err);
            }
        }

        const strategy: StorageStrategy = serverStaticUrl
            ? 'server'
            : (shouldEmbedBase64 && embeddedBase64 ? 'embedded' : 'split');

        // 3. 楼层插槽绑定：按 [swipeId][buttonIndex] 写入目标消息 extra
        const messageId = task.identity.messageId;
        if (typeof messageId === 'number' && this._host.writeChatMessageExtra) {
            const swipeId = task.identity.swipeId ?? 0;
            const buttonIndex = task.identity.buttonIndex ?? 0;

            const chatEntry: ChatImageEntry = {
                id: finalImageId,
                mimeType: result.mimeType || 'image/png',
                extension: format,
                engine: String(task.engine),
                prompt: task.params.prompt,
                negativePrompt: task.params.negativePrompt,
                createdAt: Date.now(),
                storageStrategy: strategy,
                url: serverStaticUrl,
                base64: embeddedBase64,
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

            // 4. 数据保存：先触发视图更新通知，再持久化保存聊天
            try {
                this._host.emitMessageUpdated?.(messageId);
                await this._host.saveChat?.();
            } catch {
                // saveChat / emitMessageUpdated 为宿主可选接口，宿主抛错不应中断整合流程
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
