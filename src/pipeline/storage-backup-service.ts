/**
 * 图像服务端备份与转存调度服务 (StorageBackupService)。
 *
 * @remarks
 * 架构原则与主从存储哲学：
 * 1. 唯一事实主库 (SSOT)：本地 IndexedDB 存储原始高清 Blob 与元数据，作为前端即时渲染与画廊交互的核心依据；
 * 2. 弱依赖副本：SillyTavern 宿主静态目录通过 POST /api/images/upload 转存，作为支持跨设备同步的次级备份；
 * 3. 容错与非阻塞：服务端上传失败或网络中断时安全捕获并返回 null，绝不中断前端主流程或阻塞楼层秒显时序；
 * 4. 单向正向原则：备份服务仅将 IndexedDB 数据单向同步至服务端，不反向覆盖或污染本地主库。
 */

import type { DrawingSlotEntry } from '@types';
import { settingsStore } from '../store/settings-store';
import { imageStorage } from '../store/image-storage';
import { logger } from '../util/logger';

/** 备份同步检查与执行结果 */
export interface BackupSyncResult {
    /** 最终可用的服务端静态相对路径 */
    readonly imageUrl?: string;
    /** 是否发生了新增备份更新（用于决定是否触发会话持久化） */
    readonly hasChanges: boolean;
}

/** 宿主上下文必要接口抽象 */
export interface HostUploadContextLike {
    getRequestHeaders?(): Record<string, string>;
}

export class StorageBackupService {
    private readonly _getContext: () => HostUploadContextLike | undefined;

    public constructor(options?: { getContext?: () => HostUploadContextLike | undefined }) {
        this._getContext =
            options?.getContext ??
            (() => {
                return window.SillyTavern?.getContext?.();
            });
    }

    /**
     * 将二进制 ArrayBuffer 转换为 Base64 编码字符串。
     *
     * @param buffer 原始二进制缓冲区
     * @param mimeType 图像 MIME 类型
     * @param withPrefix 是否携带 Data URL 前缀
     */
    private arrayBufferToBase64(buffer: ArrayBuffer, mimeType: string, withPrefix: boolean): string {
        let base64 = '';
        if (typeof Buffer !== 'undefined') {
            base64 = Buffer.from(buffer).toString('base64');
        } else {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, i + chunkSize);
                binary += String.fromCharCode(...chunk);
            }
            base64 = btoa(binary);
        }
        return withPrefix ? `data:${mimeType};base64,${base64}` : base64;
    }

    /**
     * 将图像 Blob 对象统一转为 Base64 字符串。
     *
     * @remarks
     * 主要作为宿主 /api/images/upload JSON 请求体的编码辅助。
     *
     * @param blob 目标二进制数据
     * @param withPrefix 是否包含 data:image/png;base64, 前缀
     */
    public async convertBlobToBase64(blob: Blob | unknown, withPrefix = true): Promise<string> {
        if (!blob) {
            return '';
        }

        const mimeType = (blob as { type?: string }).type || 'image/png';

        // 1. 标准环境使用 arrayBuffer
        if (typeof (blob as Blob).arrayBuffer === 'function') {
            const buffer = await (blob as Blob).arrayBuffer();
            return this.arrayBufferToBase64(buffer, mimeType, withPrefix);
        }

        // 2. Node.js 环境 Buffer 处理
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(blob)) {
            const base64 = blob.toString('base64');
            return withPrefix ? `data:${mimeType};base64,${base64}` : base64;
        }

        // 3. 非标 Blob 重新封装尝试
        try {
            if (typeof Blob !== 'undefined') {
                const standardBlob = new Blob([blob as BlobPart], { type: mimeType });
                if (typeof standardBlob.arrayBuffer === 'function') {
                    const buffer = await standardBlob.arrayBuffer();
                    return this.arrayBufferToBase64(buffer, mimeType, withPrefix);
                }
            }
        } catch {
            // 继续尝试 FileReader
        }

        // 4. 浏览器 FileReader 备用方案
        return new Promise((resolve, reject) => {
            try {
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
                reader.onerror = (err) => reject(err);
                reader.readAsDataURL(blob as Blob);
            } catch (err) {
                reject(err);
            }
        });
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

            const rawBase64 = await this.convertBlobToBase64(blob, false);
            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    image: rawBase64,
                    filename,
                    ch_name: characterName,
                    format: 'png',
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
     * 单向正向同步指定插槽的服务端备份。
     *
     * @remarks
     * 1. 严格以本地 IndexedDB 为核心事实主库；
     * 2. 若当前配置开启了 saveToServer 且插槽尚未记录 imageUrl，则自动读取本地 Blob 上传并补全；
     * 3. 若本地 IndexedDB 缺失，绝不反向向本地写入，安全返回现有状态。
     *
     * @param slot 目标图像插槽元数据
     * @param characterName 当前角色名称
     */
    public async syncSlotBackup(
        slot: DrawingSlotEntry,
        characterName?: string
    ): Promise<BackupSyncResult> {
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

        // 服务端转存检查与执行
        if (settings.saveToServer && !finalImageUrl && slot.imageId) {
            const blob = await imageStorage.getImageBlob(slot.imageId);
            if (blob) {
                const uploaded = await this.uploadToServer(blob, `${slot.imageId}.png`, characterName);
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

/** 全局单例服务端备份服务 */
export const storageBackupService = new StorageBackupService();
