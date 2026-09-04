/**
 * @module common/utils/binary
 * @description 二进制数据与 Base64 格式互转通用工具函数
 */

/**
 * 将 Blob 数据转换为 Base64 文本编码 (自动剥离 data: 前缀)
 *
 * 设计意图：跨浏览器与 Node.js 运行环境兼容。在浏览器优先通过 FileReader 处理大对象，
 * 在 Node.js 环境或测试环境后备使用 Buffer 与 ArrayBuffer。
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
 * 将 Base64 编码文本解码为二进制 Blob
 *
 * 设计意图：支持包含或不包含 data: 前缀的输入。通过 ArrayBuffer 明确指定内存切片，
 * 避免 Node.js Buffer 内存池共享导致的切片越界与类型不兼容。
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
