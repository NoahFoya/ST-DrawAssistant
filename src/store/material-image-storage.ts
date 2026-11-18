/**
 * 素材库立绘与服装预览图 IndexedDB 存储服务 (MaterialImageStorage)。
 *
 * @remarks
 * 负责角色立绘与服装预览图的本地二进制持久化与单文件导入导出转换：
 * 1. 二进制图片以压缩后的 WebP Blob 形式存入独立 IndexedDB 表（st_draw_assistant_materials / avatars），
 *    避免将图片 Base64 数据写入 SillyTavern 宿主 extensionSettings；
 * 2. 导出角色或服装预设 JSON 时，按需将 avatarId 对应的 Blob 编码为 _embeddedAvatarDataUrl 写入导出文件；
 * 3. 导入预设 JSON 时，自动提取 _embeddedAvatarDataUrl 写入本地 IndexedDB 生成新 avatarId，并从预设数据中移除内嵌字段。
 */

import localforage from 'localforage';
import { blobToBase64, dataUrlToBlob } from '../util/http-client';
import { compressMaterialAvatar } from '../util/image-compress';
import { logger } from '../util/logger';

/** 预设导出 JSON 中携带内嵌压缩预览图的数据字段名 */
export const EMBEDDED_AVATAR_FIELD = '_embeddedAvatarDataUrl' as const;

function isQuotaExceededError(err: unknown): boolean {
    if (!err || !(err instanceof Error)) return false;
    return (
        err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        /quota\s*exceeded|exceeded.*quota/i.test(err.message || '')
    );
}

/**
 * 素材预览图存储管理器。
 */
export class MaterialImageStorage {
    private readonly _store: LocalForage;
    private readonly _memoryFallback = new Map<string, Blob>();

    public constructor() {
        this._store = localforage.createInstance({
            name: 'st_draw_assistant_materials',
            storeName: 'avatars',
            description: 'ST-DrawAssistant 角色立绘与服装预览图表',
        });
    }

    private async _setBlob(avatarId: string, blob: Blob): Promise<void> {
        if (typeof indexedDB === 'undefined') {
            this._memoryFallback.set(avatarId, blob);
            return;
        }
        try {
            await this._store.setItem(avatarId, blob);
        } catch (err) {
            if (isQuotaExceededError(err)) {
                throw new Error('浏览器本地存储配额已满（QuotaExceededError），无法保存更多素材预览图');
            }
            if (this._store.driver() === localforage.LOCALSTORAGE) {
                this._memoryFallback.set(avatarId, blob);
                return;
            }
            throw err;
        }
    }

    /**
     * 压缩并保存上传的素材图片，返回生成的唯一 avatarId。
     */
    public async saveAvatar(fileOrBlob: Blob): Promise<string> {
        const compressed = await compressMaterialAvatar(fileOrBlob);
        const avatarId = `mat_img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        await this._setBlob(avatarId, compressed);
        return avatarId;
    }

    /**
     * 根据 avatarId 读取二进制图片 Blob。
     */
    public async getAvatarBlob(avatarId: string): Promise<Blob | null> {
        const trimmed = (avatarId || '').trim();
        if (!trimmed) {
            return null;
        }

        if (this._memoryFallback.has(trimmed)) {
            return this._memoryFallback.get(trimmed) || null;
        }

        try {
            const val = await this._store.getItem<unknown>(trimmed);
            if (val instanceof Blob) {
                return val;
            }
        } catch {
            // 无 IndexedDB 驱动环境时忽略配置异常
        }

        return null;
    }

    /**
     * 删除指定的素材图片记录。
     */
    public async deleteAvatar(avatarId: string): Promise<void> {
        const trimmed = (avatarId || '').trim();
        if (!trimmed) {
            return;
        }
        this._memoryFallback.delete(trimmed);
        try {
            await this._store.removeItem(trimmed);
        } catch {
            // 忽略驱动异常
        }
    }

    /**
     * 将指定 avatarId 对应的图片导出为 Data URL，供预设单文件导出使用。
     */
    public async exportAvatarAsDataUrl(avatarId: string): Promise<string | null> {
        const blob = await this.getAvatarBlob(avatarId);
        if (!blob) {
            return null;
        }
        try {
            return await blobToBase64(blob, true);
        } catch (err) {
            logger.warn('编码素材预览图 Data URL 失败:', err);
            return null;
        }
    }

    /**
     * 从导入预设中的内嵌 Data URL 还原图片并存入本地数据库，返回新的 avatarId。
     */
    public async importAvatarFromDataUrl(dataUrl: string): Promise<string | null> {
        const decoded = dataUrlToBlob(dataUrl);
        if (!decoded) {
            return null;
        }
        return this.saveAvatar(decoded);
    }

    /**
     * 清空全部素材图片存储（供测试隔离使用）。
     */
    public async clearAll(): Promise<void> {
        this._memoryFallback.clear();
        try {
            await this._store.clear();
        } catch {
            // 忽略驱动异常
        }
    }
}

/** 全局素材图片存储单例 */
export const materialImageStorage = new MaterialImageStorage();
