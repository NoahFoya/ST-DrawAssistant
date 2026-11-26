/**
 * 浏览器端剪贴板与文件下载 IO 工具。
 *
 * @remarks
 * 统一封装剪贴板文本复制（优先异步 Clipboard API，受限环境自动降级为临时 textarea）
 * 与浏览器端文本 / JSON / 图像文件下载（按真实二进制格式匹配扩展名并延迟回收临时 Object URL）。
 */

import { detectImageMimeFromHeader } from './image-metadata';

/**
 * 复制文本至系统剪贴板。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.readOnly = true;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        try {
            textarea.select();
            return document.execCommand('copy');
        } finally {
            textarea.remove();
        }
    } catch {
        return false;
    }
}

/**
 * 触发浏览器端文本文件下载，并延迟回收临时 Object URL 以确保下载触发完成。
 */
export function downloadTextFile(
    filename: string,
    content: string,
    mimeType = 'text/plain;charset=utf-8'
): void {
    if (
        typeof document === 'undefined' ||
        typeof Blob === 'undefined' ||
        typeof URL === 'undefined' ||
        typeof URL.createObjectURL !== 'function'
    ) {
        return;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    try {
        a.click();
    } finally {
        a.remove();
        setTimeout(() => {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // 忽略临时 URL 回收异常
            }
        }, 1000);
    }
}

/**
 * 触发浏览器端 JSON 文件下载，支持传入待序列化对象或已格式化 JSON 字符串。
 */
export function downloadJsonFile(
    filename: string,
    data: unknown,
    mimeType = 'application/json'
): void {
    const jsonText = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    downloadTextFile(filename, jsonText, mimeType);
}

function inferImageExt(mimeType: string): string {
    const lower = mimeType.toLowerCase();
    if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
    if (lower.includes('webp')) return 'webp';
    if (lower.includes('gif')) return 'gif';
    return 'png';
}

function inferImageExtFromUrl(url: string): string {
    const lower = url.trim().toLowerCase();
    if (lower.startsWith('data:image/')) {
        const semi = lower.indexOf(';');
        const mime = semi !== -1 ? lower.slice(5, semi) : lower.slice(5);
        return inferImageExt(mime);
    }
    const cleanPath = lower.split('?')[0].split('#')[0];
    if (cleanPath.endsWith('.webp')) return 'webp';
    if (cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg')) return 'jpg';
    if (cleanPath.endsWith('.gif')) return 'gif';
    return 'png';
}

/**
 * 综合二进制魔数、MIME 类型与备用 URL 嗅探真实图像格式与文件扩展名。
 */
export async function resolveImageFormatInfo(
    blob?: Blob | null,
    fallbackUrl?: string
): Promise<{ mimeType: string; ext: string }> {
    if (blob && blob.size > 0) {
        if (typeof blob.arrayBuffer === 'function' && typeof blob.slice === 'function') {
            try {
                const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
                const detected = detectImageMimeFromHeader(header);
                if (detected) {
                    return { mimeType: detected, ext: inferImageExt(detected) };
                }
            } catch {
                // 忽略部分 mock 环境 slice/arrayBuffer 异常，降级为 type 字段推断
            }
        }
        const mime = blob.type || 'image/png';
        return { mimeType: mime, ext: inferImageExt(mime) };
    }
    if (fallbackUrl) {
        const ext = inferImageExtFromUrl(fallbackUrl);
        const mimeType =
            ext === 'jpg'
                ? 'image/jpeg'
                : ext === 'webp'
                  ? 'image/webp'
                  : ext === 'gif'
                    ? 'image/gif'
                    : 'image/png';
        return { mimeType, ext };
    }
    return { mimeType: 'image/png', ext: 'png' };
}

/** 统一图像资产下载参数 */
export interface DownloadImageAssetOptions {
    readonly blob?: Blob | null;
    readonly resolveBlob?: () => Promise<Blob | null | undefined>;
    readonly url?: string;
    readonly fileNameBase: string;
}

/**
 * 统一下载图像资产至本地：优先读取原始 Blob 以保证元数据与画质完整，并按真实二进制格式匹配扩展名（.png / .webp / .jpg）。
 */
export async function downloadImageAsset(options: DownloadImageAssetOptions): Promise<boolean> {
    if (typeof document === 'undefined') {
        return false;
    }

    let resolvedBlob: Blob | null | undefined = options.blob;
    if ((!resolvedBlob || resolvedBlob.size === 0) && options.resolveBlob) {
        try {
            resolvedBlob = await options.resolveBlob();
        } catch {
            resolvedBlob = null;
        }
    }

    let downloadUrl = options.url || '';
    let tempObjectUrl: string | undefined;

    try {
        if (resolvedBlob && resolvedBlob.size > 0) {
            tempObjectUrl = URL.createObjectURL(resolvedBlob);
            downloadUrl = tempObjectUrl;
        }
        if (!downloadUrl) {
            return false;
        }

        const { ext } = await resolveImageFormatInfo(resolvedBlob, downloadUrl);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `${options.fileNameBase}.${ext}`;
        a.style.display = 'none';
        document.body.appendChild(a);
        try {
            a.click();
        } finally {
            a.remove();
        }
        return true;
    } finally {
        if (tempObjectUrl) {
            const revokeTarget = tempObjectUrl;
            setTimeout(() => {
                try {
                    URL.revokeObjectURL(revokeTarget);
                } catch {
                    // 忽略临时 URL 回收异常
                }
            }, 1500);
        }
    }
}

/**
 * 将图像 Blob 转换为 PNG Blob（浏览器 ClipboardItem 通用要求 image/png）。
 */
async function convertBlobToPng(blob: Blob): Promise<Blob> {
    if (blob.type === 'image/png') {
        return blob;
    }
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('图片解码失败'));
            el.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 1;
        canvas.height = img.naturalHeight || img.height || 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('无法创建画布上下文');
        }
        ctx.drawImage(img, 0, 0);
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (out) => (out ? resolve(out) : reject(new Error('PNG 编码失败'))),
                'image/png'
            );
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * 复制图像 Blob 至系统剪贴板（支持直接粘贴到微信、QQ 等桌面社交软件）。
 */
export async function copyImageBlobToClipboard(blob: Blob): Promise<boolean> {
    try {
        if (
            typeof navigator === 'undefined' ||
            typeof ClipboardItem === 'undefined' ||
            !navigator.clipboard?.write
        ) {
            return false;
        }
        const pngBlob = await convertBlobToPng(blob);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        return true;
    } catch {
        return false;
    }
}

/**
 * 以 UTF-8 编码读取浏览器 `File` 对象文本内容。
 */
export function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error || new Error(`读取文件失败: ${file.name}`));
        reader.readAsText(file, 'utf-8');
    });
}

