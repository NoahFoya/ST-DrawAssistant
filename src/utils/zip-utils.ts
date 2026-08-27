/**
 * @module utils/zip-utils
 * @description ZIP 打包下载工具模块 (ZipUtils)
 *
 * 职责：
 * - 纯前端轻量级 Store 方式打包 Base64 图片为 ZIP 压缩包并自动触发下载
 * - 将选中的多张图片及其生成元数据 JSON 序列化导出为单包 ZIP 压缩文件
 * - 支持未引入 JSZip 场景下的容错与多文件打包降级
 */

import type { StoredImageRecord } from '../storage/image-db';
import { getImageFromDB } from '../storage/image-db';
import { logger } from '../core/logger';

/**
 * 将指定 UUID 列表的图片及生成元数据打包导出为 ZIP 文件并触发下载
 *
 * 当环境中存在 JSZip 时打包为包含图片、独立 JSON 元数据和清单的 ZIP 压缩包；
 * 当无 JSZip 时自动降级为导出包含完整记录的 JSON 格式文件。
 *
 * @param uuids 要打包导出的图像 UUID 列表
 * @returns 打包或导出完成的 Promise
 */
export async function exportImagesToZip(uuids: string[]): Promise<void> {
    if (uuids.length === 0) return;

    logger.info(`开始打包导出 ${uuids.length} 张图片数据...`);

    const records: StoredImageRecord[] = [];
    for (const id of uuids) {
        const rec = await getImageFromDB(id);
        if (rec) records.push(rec);
    }

    if (records.length === 0) {
        alert('选中的图片在中存储无法定位，请刷新后重试。');
        return;
    }

    // 检查全局 JSZip 对象（宿主 SillyTavern 内置或全局挂载）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const JSZip = (window as any).JSZip;

    if (typeof JSZip === 'function') {
        const zip = new JSZip();
        const imgFolder = zip.folder('images');
        const metaFolder = zip.folder('metadata');

        const manifest: Array<{ uuid: string; prompt: string; timestamp: string }> = [];

        for (const rec of records) {
            const ext = rec.mime.split('/')[1] || 'png';
            const base64Data = rec.data.startsWith('data:') ? rec.data.split(',')[1] : rec.data;

            imgFolder?.file(`${rec.uuid}.${ext}`, base64Data, { base64: true });
            metaFolder?.file(`${rec.uuid}.json`, JSON.stringify({
                uuid: rec.uuid,
                prompt: rec.prompt,
                timestamp: new Date(rec.timestamp).toISOString(),
                mime: rec.mime,
                metadata: rec.metadata,
            }, null, 2));

            manifest.push({
                uuid: rec.uuid,
                prompt: rec.prompt,
                timestamp: new Date(rec.timestamp).toISOString(),
            });
        }

        zip.file('manifest.json', JSON.stringify(manifest, null, 2));

        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `st-draw-gallery-export-${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);

        logger.info(`已通过 JSZip 成功打包导出 ${records.length} 张图片为 ZIP 压缩包`);
    } else {
        // 无 JSZip 时的打包导出降级：导出单文件 JSON 镜像包
        logger.info('环境未找到 JSZip，降级为一键导出 JSON 图库镜像文件');
        const payload = JSON.stringify(records, null, 2);
        const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `st-draw-gallery-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
