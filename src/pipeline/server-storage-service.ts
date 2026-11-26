/**
 * 可选宿主服务端存储服务 (ServerStorageService)。
 *
 * @remarks
 * 存储模型与执行策略：
 * 1. 存储目标选择：本地 IndexedDB 存储原始图像 Blob 与元数据，作为前端即时渲染与画廊交互的基础；
 * 2. 可选服务端存储：当用户在设置中开启 saveToServer 时，将图像上传至 SillyTavern 宿主静态目录 (/api/images/upload)，供跨端访问或静态路径引用；
 * 3. 容错与非阻塞：服务端上传失败或网络中断时安全捕获并返回 null，不阻断前端主流程与楼层呈现时序；
 * 4. 单向同步：服务仅在开启配置时将本地图像上传至服务端并记录返回路径，不影响本地存储状态。
 */

import type { DrawingSlotEntry } from '@types';
import { settingsStore } from '../store/settings-store';
import { imageStorage } from '../store/image-storage';
import { blobToBase64 } from '../util/http-client';
import { logger } from '../util/logger';
import { getHostContext } from '../host';

/** 服务端存储同步检查与执行结果 */
export interface ServerStorageSyncResult {
    /** 最终可用的服务端静态相对路径 */
    readonly imageUrl?: string;
    /** 是否发生了路径更新（用于决定是否触发会话持久化） */
    readonly hasChanges: boolean;
}

/** 宿主上下文上传接口抽象 */
export interface HostUploadContextLike {
    getRequestHeaders?(): Record<string, string>;
}

const SERVER_UPLOAD_TIMEOUT_MS = 30_000;

interface InFlightUploadEntry {
    readonly promise: Promise<string | null>;
    readonly controller: AbortController;
    consumers: number;
}

export class ServerStorageService {
    private readonly _getContext: () => HostUploadContextLike | undefined;
    private readonly _inFlightUploads = new Map<string, InFlightUploadEntry>();

    public constructor(options?: { getContext?: () => HostUploadContextLike | undefined }) {
        this._getContext = options?.getContext ?? (() => getHostContext());
    }

    /**
     * 向宿主服务 POST /api/images/upload 上传静态图片。
     *
     * @param blob 目标二进制数据
     * @param filename 目标文件名
     * @param characterName 关联角色名称
     * @param signal 可选中止信号
     * @returns 成功返回服务端返回的相对路径（如 /images/...），失败返回 null
     */
    public async uploadToServer(
        blob: Blob,
        filename: string,
        characterName?: string,
        signal?: AbortSignal
    ): Promise<string | null> {
        if (typeof window === 'undefined' || typeof fetch === 'undefined' || signal?.aborted) {
            return null;
        }

        const timeoutController = new AbortController();
        const onExternalAbort = () => timeoutController.abort();
        signal?.addEventListener('abort', onExternalAbort, { once: true });
        const timeoutTimer = setTimeout(() => {
            timeoutController.abort();
        }, SERVER_UPLOAD_TIMEOUT_MS);

        try {
            const hostContext = this._getContext();
            const headers: Record<string, string> = {
                ...(hostContext?.getRequestHeaders ? hostContext.getRequestHeaders() : {}),
                'Content-Type': 'application/json',
            };

            const mimeType = (blob.type || 'image/png').toLowerCase();
            const format = mimeType.includes('webp')
                ? 'webp'
                : mimeType.includes('jpeg') || mimeType.includes('jpg')
                  ? 'jpg'
                  : 'png';

            const rawBase64 = await blobToBase64(blob, false);
            if (signal?.aborted || timeoutController.signal.aborted) {
                return null;
            }
            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers,
                signal: timeoutController.signal,
                body: JSON.stringify({
                    image: rawBase64,
                    filename,
                    ch_name: characterName,
                    format,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                if (data?.path) {
                    const normalized = String(data.path).startsWith('/') ? data.path : `/${data.path}`;
                    return normalized;
                }
            }

            logger.warn(`上传图片至 SillyTavern 宿主服务端响应状态异常: ${response.status}`);
            return null;
        } catch (err) {
            if (signal?.aborted) {
                return null;
            }
            if (timeoutController.signal.aborted) {
                logger.warn(`上传图片至 SillyTavern 宿主服务端超时 (${Math.round(SERVER_UPLOAD_TIMEOUT_MS / 1000)}s)`);
                return null;
            }
            logger.warn('上传图片至 SillyTavern 宿主服务端发生网络或解析异常:', err);
            return null;
        } finally {
            clearTimeout(timeoutTimer);
            signal?.removeEventListener('abort', onExternalAbort);
        }
    }

    /**
     * 同步指定楼层图片的服务端存储路径。
     *
     * @remarks
     * 1. 以本地 IndexedDB 为核心事实基础；
     * 2. 若当前配置开启了 saveToServer 且记录尚未包含 imageUrl，则自动读取本地 Blob 上传至宿主服务并补全路径；
     * 3. 若本地数据不存在，安全返回现有状态。
     *
     * @param slot 目标图像元数据
     * @param characterName 当前角色名称
     * @param signal 可选中止信号
     * @returns 包含可用静态相对路径与变更标识的同步结果结构
     */
    public async syncSlotServerImage(
        slot: DrawingSlotEntry,
        characterName?: string,
        signal?: AbortSignal
    ): Promise<ServerStorageSyncResult> {
        const settings = settingsStore.getSettings();
        let finalImageUrl = slot.imageUrl;
        let hasChanges = false;

        if (signal?.aborted) {
            return {
                imageUrl: finalImageUrl,
                hasChanges,
            };
        }

        // 仅在启用服务端转存时复用本地记录中的 remotePath，关闭该开关时不再绑定远程路径
        if (settings.saveToServer && slot.imageId && !finalImageUrl) {
            try {
                const localRecord = await imageStorage.getImageRecord(slot.imageId);
                if (localRecord?.remotePath) {
                    finalImageUrl = localRecord.remotePath;
                    hasChanges = true;
                }
            } catch (err) {
                logger.warn(`读取本地图像元数据失败 [${slot.imageId}]:`, err);
            }
        }

        // 服务端上传并发复用：同一 imageId 仅发起一次上传，各调用方独立监听取消信号
        if (settings.saveToServer && !finalImageUrl && slot.imageId && !signal?.aborted) {
            const imageId = slot.imageId;
            let entry = this._inFlightUploads.get(imageId);
            if (!entry || entry.controller.signal.aborted) {
                const controller = new AbortController();
                let uploadPromise!: Promise<string | null>;
                uploadPromise = (async (): Promise<string | null> => {
                    try {
                        const blob = await imageStorage.getImageBlob(imageId);
                        if (!blob || controller.signal.aborted) {
                            return null;
                        }
                        const mimeType = (blob.type || 'image/png').toLowerCase();
                        const ext = mimeType.includes('webp')
                            ? 'webp'
                            : mimeType.includes('jpeg') || mimeType.includes('jpg')
                              ? 'jpg'
                              : 'png';
                        const uploaded = await this.uploadToServer(
                            blob,
                            `${imageId}.${ext}`,
                            characterName,
                            controller.signal
                        );
                        if (uploaded && !controller.signal.aborted) {
                            await imageStorage
                                .updateImageRecord(imageId, { remotePath: uploaded })
                                .catch((err) => {
                                    logger.warn(`更新本地图像 remotePath 失败 [${imageId}]:`, err);
                                });
                            return uploaded;
                        }
                        return null;
                    } finally {
                        if (this._inFlightUploads.get(imageId)?.promise === uploadPromise) {
                            this._inFlightUploads.delete(imageId);
                        }
                    }
                })();
                entry = { promise: uploadPromise, controller, consumers: 0 };
                this._inFlightUploads.set(imageId, entry);
            }

            entry.consumers += 1;
            const currentEntry = entry;
            let uploaded: string | null = null;
            if (!signal) {
                try {
                    uploaded = await currentEntry.promise;
                } finally {
                    currentEntry.consumers = Math.max(0, currentEntry.consumers - 1);
                }
            } else {
                uploaded = await new Promise<string | null>((resolve) => {
                    let settled = false;
                    const cleanup = () => {
                        if (settled) return;
                        settled = true;
                        signal.removeEventListener('abort', onAbort);
                        currentEntry.consumers = Math.max(0, currentEntry.consumers - 1);
                    };
                    const onAbort = () => {
                        cleanup();
                        if (currentEntry.consumers === 0 && !currentEntry.controller.signal.aborted) {
                            currentEntry.controller.abort();
                            if (this._inFlightUploads.get(imageId) === currentEntry) {
                                this._inFlightUploads.delete(imageId);
                            }
                        }
                        resolve(null);
                    };
                    signal.addEventListener('abort', onAbort, { once: true });
                    currentEntry.promise.then(
                        (path) => {
                            cleanup();
                            resolve(path);
                        },
                        () => {
                            cleanup();
                            resolve(null);
                        }
                    );
                });
            }

            if (uploaded && !signal?.aborted) {
                finalImageUrl = uploaded;
                hasChanges = true;
            }
        }

        return {
            imageUrl: finalImageUrl,
            hasChanges,
        };
    }
}

/** 全局单例服务端存储服务 */
export const serverStorageService = new ServerStorageService();
