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
import { logger } from '../util/logger';

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

export class ServerStorageService {
    private readonly _getContext: () => HostUploadContextLike | undefined;

    public constructor(options?: { getContext?: () => HostUploadContextLike | undefined }) {
        this._getContext =
            options?.getContext ??
            (() => {
                return window.SillyTavern?.getContext?.();
            });
    }

    /**
     * 将图像 Blob 对象转为 Base64 字符串。
     *
     * @remarks
     * 优先通过标准 arrayBuffer 异步读取二进制缓冲区并编码为 Base64。
     *
     * @param blob 目标二进制数据
     * @param withPrefix 是否包含 data:image/png;base64, 前缀
     */
    public async convertBlobToBase64(blob?: Blob | null, withPrefix = true): Promise<string> {
        if (!blob) {
            return '';
        }

        const mimeType = blob.type || 'image/png';

        // 1. 优先使用标准 arrayBuffer 读取二进制缓冲区
        if (typeof blob.arrayBuffer === 'function') {
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
            }
            const base64 = btoa(binary);
            return withPrefix ? `data:${mimeType};base64,${base64}` : base64;
        }

        // 2. 备用：原生 FileReader 异步读取
        if (typeof FileReader !== 'undefined') {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const result = reader.result as string;
                    if (!result) {
                        resolve('');
                        return;
                    }
                    if (withPrefix) {
                        resolve(result);
                    } else {
                        const commaIndex = result.indexOf(',');
                        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
                    }
                };
                reader.onerror = () => reject(reader.error ?? new Error('FileReader 转换 Base64 失败'));
                reader.readAsDataURL(blob);
            });
        }

        return '';
    }

    /**
     * 向宿主服务 POST /api/images/upload 上传静态图片。
     *
     * @param blob 目标二进制数据
     * @param filename 目标文件名
     * @param characterName 关联角色名称
     * @returns 成功返回相对路径（如 /User Avatars/...），失败返回 null
     */
    public async uploadToServer(
        blob: Blob,
        filename: string,
        characterName?: string
    ): Promise<string | null> {
        if (typeof window === 'undefined' || typeof fetch === 'undefined') {
            return null;
        }

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

            const rawBase64 = await this.convertBlobToBase64(blob, false);
            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers,
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
            logger.warn('上传图片至 SillyTavern 宿主服务端发生网络或解析异常:', err);
            return null;
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
     * @returns 包含可用静态相对路径与变更标识的同步结果结构
     */
    public async syncSlotServerImage(
        slot: DrawingSlotEntry,
        characterName?: string
    ): Promise<ServerStorageSyncResult> {
        const settings = settingsStore.getSettings();
        let finalImageUrl = slot.imageUrl;
        let hasChanges = false;

        // 若本地数据库已有 remotePath 记录，优先直接复用
        if (slot.imageId && !finalImageUrl) {
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

        // 服务端上传检查与执行
        if (settings.saveToServer && !finalImageUrl && slot.imageId) {
            const blob = await imageStorage.getImageBlob(slot.imageId);
            if (blob) {
                const mimeType = (blob.type || 'image/png').toLowerCase();
                const ext = mimeType.includes('webp')
                    ? 'webp'
                    : mimeType.includes('jpeg') || mimeType.includes('jpg')
                      ? 'jpg'
                      : 'png';
                const uploaded = await this.uploadToServer(blob, `${slot.imageId}.${ext}`, characterName);
                if (uploaded) {
                    finalImageUrl = uploaded;
                    hasChanges = true;

                    // 同步更新本地数据库中的 remotePath 引用
                    await imageStorage.updateImageRecord(slot.imageId, { remotePath: uploaded }).catch((err) => {
                        logger.warn(`更新本地图像 remotePath 失败 [${slot.imageId}]:`, err);
                    });
                }
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
