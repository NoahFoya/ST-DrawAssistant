/**
 * 图像二进制格式转换工具 (ImageUtils)
 *
 * 功能：
 * 1. 提供 Blob、Base64 与 ArrayBuffer 之间的高效互转纯函数；
 * 2. 处理 Base64 Data URL 前缀剥离与补齐。
 *
 * Tips：
 * 1. 环境兼容：浏览器环境优先基于 FileReader 读取，环境不支持时回退至 Buffer 转换；
 * 2. 线程性能：大图转换均采用异步设计，避免阻塞浏览器 UI 渲染主线程。
 */

/**
 * 将 Blob 数据转换为 Base64 编码字符串。
 *
 * @param blob 待转换的二进制 Blob
 * @param includePrefix 是否保留 data:image/...;base64, 前缀，默认 false
 * @returns Base64 字符串
 */
export async function blobToBase64(blob: Blob, includePrefix: boolean = false): Promise<string> {
    if (typeof FileReader !== 'undefined') {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const res = reader.result as string;
                if (includePrefix) {
                    resolve(res);
                } else {
                    const commaIdx = res.indexOf(',');
                    resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
                }
            };
            reader.onerror = () => {
                reject(reader.error || new Error('FileReader 读取 Blob 失败'));
            };
            reader.readAsDataURL(blob);
        });
    }

    // Node.js 或无 DOM 测试环境降级方案
    const buffer = await blob.arrayBuffer();
    let base64 = '';
    if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(buffer).toString('base64');
    } else {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        base64 = btoa(binary);
    }

    if (includePrefix) {
        const mime = blob.type || 'image/png';
        return `data:${mime};base64,${base64}`;
    }
    return base64;
}

/**
 * 将 Base64 字符串还原为二进制 Blob。
 *
 * @param base64 Base64 字符串或 DataURL
 * @param defaultMime 缺省 MIME 类型，默认为 'image/png'
 */
export function base64ToBlob(base64: string, defaultMime: string = 'image/png'): Blob {
    let resolvedMime = defaultMime;
    let cleanBase64 = base64.trim();

    if (cleanBase64.startsWith('data:')) {
        const match = cleanBase64.match(/^data:([^;,]+);base64,/);
        if (match && match[1]) {
            resolvedMime = match[1];
        }
        const commaIdx = cleanBase64.indexOf(',');
        cleanBase64 = commaIdx >= 0 ? cleanBase64.slice(commaIdx + 1) : cleanBase64;
    }

    if (typeof atob !== 'undefined') {
        const binStr = atob(cleanBase64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
        }
        return new Blob([bytes.buffer as ArrayBuffer], { type: resolvedMime });
    }

    if (typeof Buffer !== 'undefined') {
        const buf = Buffer.from(cleanBase64, 'base64');
        // Node 内部 Buffer 实例可能共享底层内存池，依据 byteOffset 与 byteLength 切片，防止将内存池其他字节带入 Blob
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        return new Blob([ab], { type: resolvedMime });
    }

    throw new Error('当前运行环境不支持 Base64 解码');
}

/**
 * 将 Blob 转换为 ArrayBuffer。
 */
export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return blob.arrayBuffer();
}

/**
 * 将 ArrayBuffer 封装为 Blob。
 */
export function arrayBufferToBlob(buffer: ArrayBuffer, mimeType: string = 'image/png'): Blob {
    return new Blob([buffer], { type: mimeType });
}
