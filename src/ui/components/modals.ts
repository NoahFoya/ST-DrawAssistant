/**
 * @module ui/components/modals
 * @description 扩展统一 UI 模态弹窗组件库 (Consolidated Modals)
 */

export interface ConfirmDialogOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
}

export interface PromptDialogOptions {
    title?: string;
    message: string;
    defaultValue?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
}

export interface TripleChoiceDialogOptions {
    title?: string;
    message: string;
    saveText?: string;
    discardText?: string;
    cancelText?: string;
}

export type TripleChoiceResult = 'save' | 'discard' | 'cancel';

/**
 * 弹出确认操作对话框 (非阻塞 DOM 模态框)
 */
export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root';
        backdrop.style.zIndex = '100090';
        backdrop.style.display = 'flex';
        backdrop.style.alignItems = 'center';
        backdrop.style.justifyContent = 'center';

        const dialog = document.createElement('div');
        dialog.className = 'da-settings-panel da-dialog-panel';
        dialog.style.width = '90%';
        dialog.style.maxWidth = '420px';
        dialog.style.padding = '20px';
        dialog.style.borderRadius = '12px';
        dialog.style.background = 'var(--da-bg-secondary)';
        dialog.style.border = '1px solid var(--da-border-color)';
        dialog.style.boxShadow = 'var(--da-shadow-lg)';
        dialog.style.color = 'var(--da-text-primary)';
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const titleEl = document.createElement('div');
        titleEl.style.fontSize = '1.1em';
        titleEl.style.fontWeight = 'bold';
        titleEl.style.marginBottom = '10px';
        titleEl.style.color = 'var(--da-accent-color)';
        titleEl.textContent = options.title || '操作确认';

        const messageEl = document.createElement('div');
        messageEl.style.fontSize = '0.9em';
        messageEl.style.lineHeight = '1.5';
        messageEl.style.marginBottom = '20px';
        messageEl.style.color = 'var(--da-text-primary)';
        messageEl.textContent = options.message;

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.justifyContent = 'flex-end';
        btnGroup.style.gap = '10px';

        const btnCancel = document.createElement('button');
        btnCancel.className = 'da-btn secondary';
        btnCancel.textContent = options.cancelText || '取消';

        const btnConfirm = document.createElement('button');
        btnConfirm.className = options.isDangerous ? 'da-btn danger' : 'da-btn primary';
        btnConfirm.textContent = options.confirmText || '确定';

        const cleanup = (result: boolean) => {
            document.removeEventListener('keydown', keyHandler);
            backdrop.remove();
            resolve(result);
        };

        btnCancel.addEventListener('click', () => cleanup(false));
        btnConfirm.addEventListener('click', () => cleanup(true));

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cleanup(false);
            } else if (e.key === 'Enter' && !options.isDangerous) {
                e.preventDefault();
                cleanup(true);
            }
        };
        document.addEventListener('keydown', keyHandler);
        backdrop.addEventListener('click', () => cleanup(false));

        btnGroup.appendChild(btnCancel);
        btnGroup.appendChild(btnConfirm);

        dialog.appendChild(titleEl);
        dialog.appendChild(messageEl);
        dialog.appendChild(btnGroup);

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        btnConfirm.focus();
    });
}

/**
 * 弹出文本输入对话框 (替代原生 prompt)
 */
export function showPromptDialog(options: PromptDialogOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root';
        backdrop.style.zIndex = '100090';
        backdrop.style.display = 'flex';
        backdrop.style.alignItems = 'center';
        backdrop.style.justifyContent = 'center';

        const dialog = document.createElement('div');
        dialog.className = 'da-settings-panel da-dialog-panel';
        dialog.style.width = '90%';
        dialog.style.maxWidth = '420px';
        dialog.style.padding = '20px';
        dialog.style.borderRadius = '12px';
        dialog.style.background = 'var(--da-bg-secondary)';
        dialog.style.border = '1px solid var(--da-border-color)';
        dialog.style.boxShadow = 'var(--da-shadow-lg)';
        dialog.style.color = 'var(--da-text-primary)';
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const titleEl = document.createElement('div');
        titleEl.style.fontSize = '1.1em';
        titleEl.style.fontWeight = 'bold';
        titleEl.style.marginBottom = '8px';
        titleEl.style.color = 'var(--da-accent-color)';
        titleEl.textContent = options.title || '请输入';

        const messageEl = document.createElement('div');
        messageEl.style.fontSize = '0.9em';
        messageEl.style.marginBottom = '12px';
        messageEl.style.color = 'var(--da-text-secondary)';
        messageEl.textContent = options.message;

        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'da-input';
        inputEl.value = options.defaultValue || '';
        inputEl.placeholder = options.placeholder || '';
        inputEl.style.width = '100%';
        inputEl.style.marginBottom = '18px';
        inputEl.style.boxSizing = 'border-box';

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.justifyContent = 'flex-end';
        btnGroup.style.gap = '10px';

        const btnCancel = document.createElement('button');
        btnCancel.className = 'da-btn secondary';
        btnCancel.textContent = options.cancelText || '取消';

        const btnConfirm = document.createElement('button');
        btnConfirm.className = 'da-btn primary';
        btnConfirm.textContent = options.confirmText || '确定';

        const cleanup = (result: string | null) => {
            document.removeEventListener('keydown', keyHandler);
            backdrop.remove();
            resolve(result);
        };

        btnCancel.addEventListener('click', () => cleanup(null));
        btnConfirm.addEventListener('click', () => {
            const val = inputEl.value.trim();
            cleanup(val ? val : null);
        });

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cleanup(null);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const val = inputEl.value.trim();
                cleanup(val ? val : null);
            }
        };
        document.addEventListener('keydown', keyHandler);
        backdrop.addEventListener('click', () => cleanup(null));

        btnGroup.appendChild(btnCancel);
        btnGroup.appendChild(btnConfirm);

        dialog.appendChild(titleEl);
        dialog.appendChild(messageEl);
        dialog.appendChild(inputEl);
        dialog.appendChild(btnGroup);

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        requestAnimationFrame(() => {
            inputEl.focus();
            inputEl.select();
        });
    });
}

/**
 * 弹出全屏 Lightbox 大图预览模态框
 */
export function openLightboxModal(imgSrc: string): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';
    backdrop.style.zIndex = '100100';
    backdrop.style.display = 'flex';
    backdrop.style.alignItems = 'center';
    backdrop.style.justifyContent = 'center';
    backdrop.style.cursor = 'zoom-out';
    backdrop.style.background = 'rgba(0, 0, 0, 0.88)';
    backdrop.style.backdropFilter = 'blur(14px)';

    const img = document.createElement('img');
    img.src = imgSrc.startsWith('data:') ? imgSrc : `data:image/png;base64,${imgSrc}`;
    img.style.maxWidth = '94vw';
    img.style.maxHeight = '94vh';
    img.style.objectFit = 'contain';
    img.style.borderRadius = '8px';
    img.style.boxShadow = '0 20px 60px rgba(0, 0, 0, 0.8)';

    const closeBadge = document.createElement('div');
    closeBadge.style.position = 'absolute';
    closeBadge.style.top = '20px';
    closeBadge.style.right = '24px';
    closeBadge.style.color = 'var(--da-text-on-accent, #ffffff)';
    closeBadge.style.fontSize = '1.4em';
    closeBadge.style.cursor = 'pointer';
    closeBadge.style.padding = '4px 12px';
    closeBadge.style.borderRadius = '8px';
    closeBadge.style.background = 'rgba(255, 255, 255, 0.15)';
    closeBadge.textContent = '✕';

    backdrop.appendChild(img);
    backdrop.appendChild(closeBadge);
    backdrop.onclick = () => backdrop.remove();
    document.body.appendChild(backdrop);
}

/**
 * 弹出图像元数据详情展示面板
 */
export function openImageInfoPanel(metadata: Record<string, any>, imageSrc?: string): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';
    backdrop.style.zIndex = '100095';
    backdrop.style.display = 'flex';
    backdrop.style.alignItems = 'center';
    backdrop.style.justifyContent = 'center';

    const panel = document.createElement('div');
    panel.className = 'da-settings-panel';
    panel.style.width = '90%';
    panel.style.maxWidth = '680px';
    panel.style.padding = '20px';
    panel.style.borderRadius = '12px';
    panel.style.background = 'var(--da-bg-secondary)';
    panel.style.border = '1px solid var(--da-border-color)';
    panel.style.boxShadow = '0 16px 48px rgba(0,0,0,0.7)';
    panel.style.color = 'var(--da-text-primary)';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '16px';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.style.color = 'var(--da-accent-color)';
    title.textContent = '🖼️ 图像生成元数据详情';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-close-red-dot';
    closeBtn.onclick = () => backdrop.remove();

    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    if (imageSrc) {
        const previewImg = document.createElement('img');
        previewImg.src = imageSrc.startsWith('data:') ? imageSrc : `data:image/png;base64,${imageSrc}`;
        previewImg.style.maxHeight = '180px';
        previewImg.style.maxWidth = '100%';
        previewImg.style.objectFit = 'contain';
        previewImg.style.borderRadius = '8px';
        previewImg.style.marginBottom = '12px';
        previewImg.style.alignSelf = 'center';
        panel.appendChild(previewImg);
    }

    const body = document.createElement('div');
    body.style.maxHeight = '60vh';
    body.style.overflowY = 'auto';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '10px';

    for (const [k, v] of Object.entries(metadata)) {
        const row = document.createElement('div');
        row.style.padding = '8px 12px';
        row.style.background = 'var(--da-bg-primary)';
        row.style.borderRadius = '6px';
        row.style.fontSize = '0.9em';

        const label = document.createElement('div');
        label.style.fontWeight = 'bold';
        label.style.color = 'var(--da-accent-color)';
        label.style.marginBottom = '4px';
        label.textContent = k;

        const val = document.createElement('div');
        val.style.wordBreak = 'break-all';
        val.style.color = 'var(--da-text-secondary)';
        val.textContent = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);

        row.appendChild(label);
        row.appendChild(val);
        body.appendChild(row);
    }

    panel.appendChild(body);
    backdrop.appendChild(panel);
    backdrop.onclick = () => backdrop.remove();
    document.body.appendChild(backdrop);
}
