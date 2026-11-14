/**
 * 浏览器端文件下载工具。
 */

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
