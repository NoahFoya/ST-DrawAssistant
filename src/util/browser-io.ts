/**
 * 浏览器端剪贴板与文件下载 IO 工具。
 *
 * @remarks
 * 统一封装剪贴板文本复制（优先异步 Clipboard API，受限环境自动降级为临时 textarea）
 * 与浏览器端文本 / JSON 文件下载（延迟回收临时 Object URL）。
 */

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
 * 为 `<img>` 元素绑定跨应用拖拽分享支持：
 * 在指针悬停/按下时预加载 File 对象，于 `dragstart` 同步写入 `DataTransfer.items` 与 `DownloadURL`。
 */
export function attachImageDragFile(
    imgEl: HTMLImageElement,
    resolveBlob: () => Promise<Blob | null>,
    fileNameBase: string
): () => void {
    imgEl.draggable = true;
    let cachedFile: File | null = null;
    let loading = false;

    const ensureCachedFile = async (): Promise<void> => {
        if (cachedFile || loading) return;
        loading = true;
        try {
            const blob = await resolveBlob();
            if (blob && blob.size > 0 && typeof File !== 'undefined') {
                const mime = blob.type || 'image/png';
                const ext = inferImageExt(mime);
                cachedFile = new File([blob], `${fileNameBase}.${ext}`, { type: mime });
            }
        } catch {
            // 忽略预加载异常
        } finally {
            loading = false;
        }
    };

    const onPreload = () => {
        void ensureCachedFile();
    };

    const onDragStart = (e: DragEvent) => {
        if (!e.dataTransfer) return;
        if (cachedFile && e.dataTransfer.items) {
            try {
                e.dataTransfer.items.add(cachedFile);
            } catch {
                // 部分宿主环境可能限制 items.add
            }
        }
        if (imgEl.src) {
            const mime = cachedFile?.type || 'image/png';
            const name = cachedFile?.name || `${fileNameBase}.png`;
            try {
                e.dataTransfer.setData('DownloadURL', `${mime}:${name}:${imgEl.src}`);
            } catch {
                // 忽略部分浏览器不支持 DownloadURL 的情况
            }
        }
    };

    imgEl.addEventListener('pointerenter', onPreload);
    imgEl.addEventListener('pointerdown', onPreload);
    imgEl.addEventListener('dragstart', onDragStart);

    return () => {
        imgEl.removeEventListener('pointerenter', onPreload);
        imgEl.removeEventListener('pointerdown', onPreload);
        imgEl.removeEventListener('dragstart', onDragStart);
    };
}
