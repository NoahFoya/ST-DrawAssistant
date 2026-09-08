/**
 * 二进制数据转换纯函数工具
 */

/**
 * 将 Blob 数据转为 Base64 字符串（自动剥离 data: 前缀）。
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
 * 将 Base64 编码还原为 Blob。
 * 兼容带有 data:image/... 前缀的 DataURL 和纯 Base64。
 * Node.js 测试环境中 Buffer 可能共享内存池，需依据 byteOffset 和 byteLength 切片，避免将池中无关数据带入 Blob。
 */
export function base64ToBlob(base64: string, mimeType?: string): Blob {
    let resolvedMime = mimeType;
    let cleanBase64 = base64;

    if (base64.startsWith('data:')) {
        const match = base64.match(/^data:([^;,]+);base64,/);
        if (match && !resolvedMime) {
            resolvedMime = match[1];
        }
        cleanBase64 = base64.slice(base64.indexOf(',') + 1);
    }

    resolvedMime = resolvedMime || 'image/png';

    if (typeof atob !== 'undefined') {
        const binStr = atob(cleanBase64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
        }
        return new Blob([bytes.buffer as ArrayBuffer], { type: resolvedMime });
    } else if (typeof Buffer !== 'undefined') {
        const buf = Buffer.from(cleanBase64, 'base64');
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        return new Blob([ab], { type: resolvedMime });
    } else {
        throw new Error('当前运行环境不支持 Base64 解码');
    }
}
