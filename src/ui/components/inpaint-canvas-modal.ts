/**
 * @module ui/components/inpaint-canvas-modal
 * @description 局部重绘 (Inpaint) 画布蒙版涂抹模态框
 *
 * 职责：
 * - 在 Canvas 画板上加载原图并提供半透明遮罩涂抹功能
 * - 支持调整笔刷粗细、橡皮擦擦除与一键清空遮罩
 * - 确认提交时合成生成原图 Base64 与黑白二值化遮罩图 Mask Base64
 */

import { applyCurrentThemeToNode } from '../tabs/theme-tab';

export interface InpaintModalOptions {
    imageSrc: string;
    initialPrompt: string;
    onConfirm: (result: { initImage: string; maskImage: string; prompt: string }) => void;
    onCancel?: () => void;
}

/**
 * 打开局部重绘 Canvas 画布涂抹模态框
 *
 * @param options 包含源图 URL、初始提示词和提交/取消回调的配置项
 */
export function openInpaintCanvasModal(options: InpaintModalOptions): void {
    const { imageSrc, initialPrompt, onConfirm, onCancel } = options;

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';
    backdrop.style.zIndex = '10007';
    applyCurrentThemeToNode(backdrop);

    const modal = document.createElement('div');
    modal.className = 'da-settings-panel';
    modal.style.width = '92%';
    modal.style.maxWidth = '640px';
    modal.style.padding = '20px';
    modal.style.borderRadius = '12px';
    modal.style.background = 'var(--da-bg-secondary, #1e1e2e)';
    modal.style.boxShadow = '0 10px 40px rgba(0,0,0,0.6)';
    modal.style.border = '1px solid var(--da-border-color, rgba(255,255,255,0.15))';
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
    title.style.color = 'var(--da-text-primary)';
    title.textContent = '局部重绘画布涂抹';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-close-red-dot';
    closeBtn.title = '关闭';
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
    canvasWrapper.style.maxHeight = '360px';
    canvasWrapper.style.background = 'var(--da-bg-primary, #000)';
    canvasWrapper.style.borderRadius = '8px';
    canvasWrapper.style.overflow = 'hidden';
    canvasWrapper.style.display = 'flex';
    canvasWrapper.style.justifyContent = 'center';
    canvasWrapper.style.alignItems = 'center';
    canvasWrapper.style.marginBottom = '12px';

    const canvas = document.createElement('canvas');
    canvas.style.cursor = 'crosshair';
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '360px';

    canvasWrapper.appendChild(canvas);
    modal.appendChild(canvasWrapper);

    const ctx = canvas.getContext('2d')!;

    // 蒙版画笔 Canvas (用于独立生成黑白 Mask)
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d')!;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageSrc;

    let isDrawing = false;
    let brushSize = 24;

    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        maskCanvas.width = img.width;
        maskCanvas.height = img.height;

        // 初始化 Mask 为纯黑 (保留区域)
        maskCtx.fillStyle = '#000000';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

        redraw();
    };

    function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 绘制底层原图
        ctx.drawImage(img, 0, 0);

        // 叠加半透明蒙版层
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.drawImage(maskCanvas, 0, 0);
        ctx.restore();
    }

    function getCanvasPoint(e: MouseEvent | TouchEvent) {
        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY,
        };
    }

    function drawLine(start: { x: number; y: number }, end: { x: number; y: number }) {
        maskCtx.strokeStyle = '#ffffff'; // 蒙版重绘区域为白色
        maskCtx.fillStyle = '#ffffff';
        maskCtx.lineWidth = brushSize;
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';

        maskCtx.beginPath();
        maskCtx.moveTo(start.x, start.y);
        maskCtx.lineTo(end.x, end.y);
        maskCtx.stroke();

        redraw();
    }

    let lastPos = { x: 0, y: 0 };

    const startDraw = (e: MouseEvent | TouchEvent) => {
        e.preventDefault();
        isDrawing = true;
        lastPos = getCanvasPoint(e);
        drawLine(lastPos, lastPos);
    };

    const moveDraw = (e: MouseEvent | TouchEvent) => {
        if (!isDrawing) return;
        e.preventDefault();
        const currentPos = getCanvasPoint(e);
        drawLine(lastPos, currentPos);
        lastPos = currentPos;
    };

    const stopDraw = () => {
        isDrawing = false;
    };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', stopDraw);

    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    window.addEventListener('touchend', stopDraw);

    // 3. Controls (Brush Size + Clear)
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.justifyContent = 'space-between';
    controls.style.alignItems = 'center';
    controls.style.marginBottom = '12px';

    const brushLabel = document.createElement('label');
    brushLabel.style.fontSize = '0.85em';
    brushLabel.style.color = 'var(--da-text-secondary)';
    brushLabel.innerHTML = `画笔大小: <span id="da-brush-size-val">${brushSize}</span>px`;

    const brushSlider = document.createElement('input');
    brushSlider.type = 'range';
    brushSlider.className = 'da-input';
    brushSlider.min = '5';
    brushSlider.max = '80';
    brushSlider.value = String(brushSize);
    brushSlider.style.width = '160px';
    brushSlider.addEventListener('input', () => {
        brushSize = parseInt(brushSlider.value, 10);
        const valSpan = controls.querySelector('#da-brush-size-val');
        if (valSpan) valSpan.textContent = String(brushSize);
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'da-btn secondary';
    clearBtn.style.padding = '4px 10px';
    clearBtn.style.fontSize = '0.8em';
    clearBtn.innerHTML = '<i class="fa-solid fa-trash" style="margin-right:4px;"></i>清空涂抹';
    clearBtn.addEventListener('click', () => {
        maskCtx.fillStyle = '#000000';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        redraw();
    });

    const ctrlLeft = document.createElement('div');
    ctrlLeft.style.display = 'flex';
    ctrlLeft.style.alignItems = 'center';
    ctrlLeft.style.gap = '10px';
    ctrlLeft.appendChild(brushLabel);
    ctrlLeft.appendChild(brushSlider);

    controls.appendChild(ctrlLeft);
    controls.appendChild(clearBtn);
    modal.appendChild(controls);

    // 4. Prompt Textarea
    const promptInput = document.createElement('textarea');
    promptInput.className = 'da-input';
    promptInput.style.width = '100%';
    promptInput.style.boxSizing = 'border-box';
    promptInput.style.height = '60px';
    promptInput.style.fontSize = '0.85em';
    promptInput.style.marginBottom = '15px';
    promptInput.value = initialPrompt;

    modal.appendChild(promptInput);

    // 5. Footer Confirm
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'da-btn secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => {
        backdrop.remove();
        onCancel?.();
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'da-btn primary';
    confirmBtn.innerHTML = '<i class="fa-solid fa-paper-plane" style="margin-right:4px;"></i>开始局部重绘';
    confirmBtn.addEventListener('click', () => {
        const initImage = imageSrc;
        const maskImage = maskCanvas.toDataURL('image/png');
        const prompt = promptInput.value.trim();

        backdrop.remove();
        onConfirm({ initImage, maskImage, prompt });
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
}
