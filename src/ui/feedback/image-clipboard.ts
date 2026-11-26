/**
 * 图像剪贴板复制与轻提示反馈辅助。
 */

import { copyImageBlobToClipboard } from '../../util/browser-io';
import { Toast } from './toast';

/**
 * 解析图像 Blob 并写入系统剪贴板，统一输出中文轻提示反馈。
 */
export async function copyResolvedImageWithToast(
    resolveBlob: () => Promise<Blob | null | undefined>
): Promise<boolean> {
    let blob: Blob | null | undefined = null;
    try {
        blob = await resolveBlob();
    } catch {
        blob = null;
    }
    if (!blob || blob.size === 0) {
        Toast.error('获取图片数据失败');
        return false;
    }

    const ok = await copyImageBlobToClipboard(blob);
    if (ok) {
        Toast.success('已复制图片到剪贴板');
        return true;
    }

    Toast.error('当前浏览器不支持复制图片，请使用右键或下载');
    return false;
}
