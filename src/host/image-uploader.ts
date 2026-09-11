/**
 * 宿主图片上传工具
 * 调用 SillyTavern 原生 POST /api/images/upload 端点上传生成的图片，获取持久化相对路径。
 */

import { HOST_API_IMAGES_UPLOAD } from '../constants';
import { blobToBase64 } from '../utils/binary';

export interface HostUploadResult {
    ok: boolean;
    path?: string;
    error?: string;
}

/**
 * 将 Blob 图片上传到 SillyTavern 宿主图库 (/api/images/upload)。
 * 发送标准 JSON 载荷 { image, format, filename } 并携带 CSRF 标头。
 */
export async function uploadImageToHost(
    blob: Blob,
    fileName = 'image.png',
    headersProvider?: () => Record<string, string>
): Promise<HostUploadResult> {
    try {
        const base64Data = await blobToBase64(blob);
        const format = blob.type.includes('jpeg') ? 'jpeg' : blob.type.includes('webp') ? 'webp' : 'png';
        const uploadBody: Record<string, unknown> = {
            image: base64Data,
            format,
            filename: fileName
        };

        const customHeaders = headersProvider ? headersProvider() : {};
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...customHeaders
        };

        const response = await fetch(HOST_API_IMAGES_UPLOAD, {
            method: 'POST',
            headers,
            body: JSON.stringify(uploadBody)
        });

        if (!response.ok) {
            return {
                ok: false,
                error: `宿主图库上传失败: HTTP ${response.status} ${response.statusText}`
            };
        }

        const data = await response.json().catch(() => null);
        const uploadedPath = data?.path || data?.url || data?.name;
        if (!uploadedPath) {
            return {
                ok: false,
                error: '宿主图库返回未包含图片有效路径'
            };
        }

        const normalizedPath = String(uploadedPath).startsWith('/') ? String(uploadedPath) : `/${uploadedPath}`;
        return {
            ok: true,
            path: normalizedPath
        };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
        };
    }
}

