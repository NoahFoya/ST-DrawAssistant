/**
 * 剪贴板文本复制工具。
 *
 * @remarks
 * 优先使用异步 Clipboard API，在非 HTTPS 或权限受限环境下自动降级为临时 textarea 复制。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        textarea.remove();
        return success;
    } catch {
        return false;
    }
}
