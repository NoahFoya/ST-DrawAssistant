/**
 * 素材库立绘与服装预览图 IndexedDB 存储服务 (MaterialImageStorage)。
 *
 * @remarks
 * 负责角色立绘与服装预览图的本地二进制持久化与单文件导入导出转换：
 * 1. 二进制图片以压缩后的 WebP Blob 形式存入独立 IndexedDB 表（st_draw_assistant_materials / avatars），
 *    避免将大体积 Base64 字符串写入 SillyTavern 宿主 extensionSettings；
 * 2. 导出角色或服装预设 JSON 时，按需将 avatarId 对应的 Blob 编码为 _embeddedAvatarDataUrl 写入导出文件；
 * 3. 导入预设 JSON 时，自动提取 _embeddedAvatarDataUrl 写入本地 IndexedDB 生成新 avatarId，并从预设数据中移除内嵌字段。
 */

import localforage from 'localforage';
import { base64ToBlob } from '../util/http-client';

/** 预设导出 JSON 中携带内嵌压缩预览图的数据字段名 */
export const EMBEDDED_AVATAR_FIELD = '_embeddedAvatarDataUrl' as const;

/**
 * 将 Blob 编码为 Base64 Data URL 字符串。
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
    if (typeof FileReader !== 'undefined') {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('读取图片二进制失败'));
            reader.readAsDataURL(blob);
        });
    }

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const mime = blob.type || 'image/webp';
    return `data:${mime};base64,${base64}`;
}

/**
 * 将 Base64 Data URL 字符串解码还原为 Blob。
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return null;
    }

    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) {
        return null;
    }

    const header = dataUrl.slice(0, commaIdx);
    const body = dataUrl.slice(commaIdx + 1).trim();
    if (!body) {
        return null;
    }

    const mimeMatch = header.match(/^data:([^;,]+)/i);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/webp';
    const isBase64 = /;base64/i.test(header);

    try {
        if (!isBase64) {
            return new Blob([decodeURIComponent(body)], { type: mimeType });
        }
        return base64ToBlob(body, mimeType);
    } catch {
        return null;
    }
}

/**
 * 将上传的图片等比缩放至最大边长限制并转码为高画质 WebP Blob。
 */
export async function compressMaterialAvatar(blob: Blob, maxEdge = 1024): Promise<Blob> {
    if (!blob) {
        return blob;
    }

    const calcSize = (w: number, h: number): { width: number; height: number } => {
        if (w <= maxEdge && h <= maxEdge) {
            return { width: w, height: h };
        }
        const ratio = Math.min(maxEdge / w, maxEdge / h);
        return {
            width: Math.max(1, Math.round(w * ratio)),
            height: Math.max(1, Math.round(h * ratio)),
        };
    };

    try {
        if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
            const bitmap = await createImageBitmap(blob);
            try {
                const { width, height } = calcSize(bitmap.width, bitmap.height);
                const canvas = new OffscreenCanvas(width, height);
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(bitmap, 0, 0, width, height);
                    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
                }
            } finally {
                bitmap.close();
            }
        } else if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
            const url = URL.createObjectURL(blob);
            try {
                const img = document.createElement('img');
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = () => reject(new Error('解码上传图片失败'));
                    img.src = url;
                });
                const { width, height } = calcSize(
                    img.naturalWidth || 512,
                    img.naturalHeight || 512
                );
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (ctx && typeof canvas.toBlob === 'function') {
                    ctx.drawImage(img, 0, 0, width, height);
                    const encoded = await new Promise<Blob | null>((resolve) => {
                        canvas.toBlob((b) => resolve(b), 'image/webp', 0.86);
                    });
                    if (encoded) {
                        return encoded;
                    }
                }
            } finally {
                URL.revokeObjectURL(url);
            }
        }
    } catch {
        // 非浏览器环境或转码异常时保留原始 Blob
    }

    return blob;
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
        try {
            await this._store.setItem(avatarId, blob);
            // 部分测试环境（如模拟 localStorage 驱动）无法原样序列化 Blob，读回校验非 Blob 时启用内存存储
            const verify = await this._store.getItem<unknown>(avatarId);
            if (!(verify instanceof Blob)) {
                this._memoryFallback.set(avatarId, blob);
            }
        } catch {
            this._memoryFallback.set(avatarId, blob);
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
            if (typeof val === 'string' && val.startsWith('data:')) {
                return dataUrlToBlob(val);
            }
        } catch {
            // 非浏览器测试环境忽略驱动异常
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
            return await blobToDataUrl(blob);
        } catch {
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
