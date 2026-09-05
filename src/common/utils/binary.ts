/**
 * @module common/utils/binary
 * @description 二进制数据与 Base64 格式互转通用工具函数
 */

/**
 * 将 Blob 数据转换为 Base64 文本编码 (自动剥离 data: 前缀)
 *
 * 兼容浏览器与 Node.js 环境：浏览器环境使用 FileReader，Node.js 或测试环境使用 Buffer。
 */
export async function blobToBase64(blob: Blob): Promise<string> {
    if (typeof FileReader !== 'undefined') {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const res = reader.result as string;
                const commaIdx = res.indexOf(',');
                resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    const buffer = await blob.arrayBuffer();
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(buffer).toString('base64');
    }

    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * 将 Base64 文本解码为二进制 Blob
 *
 * 说明：
 * 1. 支持带前缀的 `data:image/...;base64,` 字符串，也支持纯 Base64 字符串；
 * 2. Node.js 环境中小 Buffer 会共享内部 ArrayBuffer，直接读取 buf.buffer 会包含多余数据，
 *    因此需要通过 slice 根据偏移量和长度截取实际数据块。
 */
export function base64ToBlob(base64: string, mimeType = 'image/png'): Blob {
    const cleanBase64 = base64.startsWith('data:')
        ? base64.slice(base64.indexOf(',') + 1)
        : base64;

    if (typeof atob !== 'undefined') {
        const binStr = atob(cleanBase64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
        }
        return new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
    } else if (typeof Buffer !== 'undefined') {
        const buf = Buffer.from(cleanBase64, 'base64');
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        return new Blob([ab], { type: mimeType });
    } else {
        throw new Error('当前运行环境不支持 Base64 解码');
    }
}
