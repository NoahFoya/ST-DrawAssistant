/**
 * @module ui/components/inpaint-canvas-modal
 * @description 局部重绘 (Inpaint) 画布蒙版涂抹模态框
 */

/**
 * 局部重绘模态框初始化参数选项
 */
export interface InpaintModalOptions {
    /** 待重绘的底图 DataURL 或 ObjectURL 引用 */
    imageSrc: string;
    /** 初始提示词文本 */
    initialPrompt: string;
    /** 确认提交重绘时的回调函数 */
    onConfirm: (result: {
        initImage: string;
        maskImage: string;
        prompt: string;
        initBlob?: Blob;
        maskBlob?: Blob;
    }) => void;
    /** 取消重绘时的回调函数 */
    onCancel?: () => void;
}

/**
 * 打开局部重绘 Canvas 画布涂抹模态框
 *
 * @param options 重绘模态框参数配置
 */
export function openInpaintCanvasModal(options: InpaintModalOptions): void {
    const { imageSrc, initialPrompt, onConfirm, onCancel } = options;

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';
    backdrop.style.zIndex = '100095';
    backdrop.style.display = 'flex';
    backdrop.style.alignItems = 'center';
    backdrop.style.justifyContent = 'center';

    const modal = document.createElement('div');
    modal.className = 'da-settings-panel';
    modal.style.width = '92%';
    modal.style.maxWidth = '680px';
    modal.style.padding = '20px';
    modal.style.borderRadius = '12px';
    modal.style.background = 'var(--da-bg-secondary)';
    modal.style.border = '1px solid var(--da-border-color)';
    modal.style.boxShadow = '0 16px 48px rgba(0,0,0,0.7)';
    modal.style.color = 'var(--da-text-primary)';
    modal.addEventListener('click', (e) => e.stopPropagation());

    // 1. Header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '12px';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.style.fontSize = '1.1em';
    title.style.color = 'var(--da-accent-color)';
    title.textContent = '🎨 局部重绘画布涂抹 (Inpaint Mask Editor)';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-close-red-dot';
    closeBtn.addEventListener('click', () => {
        backdrop.remove();
        onCancel?.();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // 2. Canvas Container
    const canvasWrapper = document.createElement('div');
    canvasWrapper.style.position = 'relative';
    canvasWrapper.style.width = '100%';
    canvasWrapper.style.maxHeight = '380px';
    canvasWrapper.style.background = 'var(--da-bg-primary)';
    canvasWrapper.style.borderRadius = '8px';
    canvasWrapper.style.overflow = 'hidden';
    canvasWrapper.style.display = 'flex';
    canvasWrapper.style.justifyContent = 'center';
    canvasWrapper.style.alignItems = 'center';
    canvasWrapper.style.marginBottom = '12px';

    const canvas = document.createElement('canvas');
    canvas.style.cursor = 'crosshair';
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '380px';

    canvasWrapper.appendChild(canvas);
    modal.appendChild(canvasWrapper);

    const ctx = canvas.getContext('2d')!;
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d')!;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageSrc;

    let isDrawing = false;
    let brushSize = 24;
    let isEraser = false;

    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        maskCanvas.width = img.width;
        maskCanvas.height = img.height;

        maskCtx.fillStyle = '#000000';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        redraw();
    };

    function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.drawImage(maskCanvas, 0, 0);
        ctx.restore();
    }

    function getCanvasCoords(e: MouseEvent): { x: number; y: number } {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    canvas.addEventListener('mousedown', (e) => {
        isDrawing = true;
        draw(e);
    });

    window.addEventListener('mouseup', () => {
        isDrawing = false;
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        draw(e);
    });

    function draw(e: MouseEvent) {
        const { x, y } = getCanvasCoords(e);
        maskCtx.beginPath();
        maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        maskCtx.fillStyle = isEraser ? '#000000' : '#ffffff';
        maskCtx.fill();
        redraw();
    }

    // 3. Toolbar (Brush size, Eraser, Clear)
    const toolbar = document.createElement('div');
    toolbar.style.display = 'flex';
    toolbar.style.alignItems = 'center';
    toolbar.style.gap = '10px';
    toolbar.style.marginBottom = '12px';

    const brushLabel = document.createElement('span');
    brushLabel.style.fontSize = '0.85em';
    brushLabel.textContent = `笔刷大小: ${brushSize}px`;

    const brushSlider = document.createElement('input');
    brushSlider.type = 'range';
    brushSlider.min = '6';
    brushSlider.max = '96';
    brushSlider.value = String(brushSize);
    brushSlider.className = 'da-slider';
    brushSlider.addEventListener('input', () => {
        brushSize = Number(brushSlider.value);
        brushLabel.textContent = `笔刷大小: ${brushSize}px`;
    });

    const eraserBtn = document.createElement('button');
    eraserBtn.className = 'da-btn secondary';
    eraserBtn.textContent = '✏️ 画笔';
    eraserBtn.addEventListener('click', () => {
        isEraser = !isEraser;
        eraserBtn.textContent = isEraser ? '🧹 橡皮擦 (擦除蒙版)' : '✏️ 画笔 (涂抹蒙版)';
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'da-btn secondary';
    clearBtn.textContent = '🔄 清空遮罩';
    clearBtn.addEventListener('click', () => {
        maskCtx.fillStyle = '#000000';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        redraw();
    });

    toolbar.appendChild(brushLabel);
    toolbar.appendChild(brushSlider);
    toolbar.appendChild(eraserBtn);
    toolbar.appendChild(clearBtn);
    modal.appendChild(toolbar);

    // 4. Prompt Input
    const promptInput = document.createElement('textarea');
    promptInput.className = 'da-input';
    promptInput.rows = 2;
    promptInput.value = initialPrompt;
    promptInput.placeholder = '输入局部重绘专用提示词 (选填)...';
    promptInput.style.width = '100%';
    promptInput.style.marginBottom = '14px';
    promptInput.style.boxSizing = 'border-box';
    modal.appendChild(promptInput);

    // 5. Actions (Cancel, Confirm)
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '10px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'da-btn secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => {
        backdrop.remove();
        onCancel?.();
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'da-btn primary';
    confirmBtn.textContent = '🚀 开始局部重绘';
    confirmBtn.addEventListener('click', async () => {
        const initImage = canvas.toDataURL('image/png');
        const maskImage = maskCanvas.toDataURL('image/png');
        const prompt = promptInput.value.trim();

        const initBlob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
        const maskBlob = await new Promise<Blob>((res) => maskCanvas.toBlob((b) => res(b!), 'image/png'));

        backdrop.remove();
        onConfirm({ initImage, maskImage, prompt, initBlob, maskBlob });
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
}
