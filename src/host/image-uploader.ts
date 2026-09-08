/**
 * 宿主图片上传工具
 * 调用 SillyTavern 原生 POST /api/images/upload 端点上传生成的图片，获取持久化相对路径。
 */

import { HOST_API_IMAGES_UPLOAD } from '../constants';

export interface HostUploadResult {
    ok: boolean;
    path?: string;
    error?: string;
}

/**
 * 将 Blob 图片上传到 SillyTavern 宿主图库。
 * 必须携带宿主 CSRF 请求头，否则请求会被宿主服务端拒绝。
 */
export async function uploadImageToHost(
    blob: Blob,
    fileName = 'image.png',
    headersProvider?: () => Record<string, string>
): Promise<HostUploadResult> {
    try {
        const formData = new FormData();
        formData.append('avatar', blob, fileName);

        const headers = headersProvider ? headersProvider() : {};
        const response = await fetch(HOST_API_IMAGES_UPLOAD, {
            method: 'POST',
            headers,
            body: formData
        });

        if (!response.ok) {
            return {
                ok: false,
                error: `宿主图库上传失败: HTTP ${response.status} ${response.statusText}`
            };
        }

        const data = await response.json();
        const uploadedPath = data?.path || data?.url || data?.name;
        if (!uploadedPath) {
            return {
                ok: false,
                error: '宿主图库返回未包含图片有效路径'
            };
        }

        return {
            ok: true,
            path: uploadedPath
        };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
        };
    }
}
