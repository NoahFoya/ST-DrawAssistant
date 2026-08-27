/**
 * @module ui/media/image-editor
 * @description 图像编辑器：局部重绘画布与图像正方形裁剪器 (Media & Editor Domain)
 */

import { ThemeService } from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';

export interface ImageCropperOptions {
    imageSrc: string;
    aspectRatio?: number;
    onCrop?: (croppedBase64: string) => void;
    onConfirm?: (croppedBase64: string) => void;
    onCancel?: () => void;
}

/**
 * 弹出图像裁剪与图标预览模态框
 */
export function openImageCropperModal(options: ImageCropperOptions): void {
    const { imageSrc, onCrop, onConfirm, onCancel } = options;
    const cropCallback = onConfirm || onCrop;

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-cropper-backdrop';
    backdrop.style.zIndex = '100085';
    ThemeService.applyCurrentThemeToNode(backdrop);

    const panel = document.createElement('div');
    panel.className = 'da-settings-panel da-dialog-panel';
    panel.style.maxWidth = '460px';

    const title = document.createElement('h3');
    title.className = 'da-dialog-title';
    title.textContent = '裁剪悬浮球图标 (1:1 正方形)';
    panel.appendChild(title);

    const imgContainer = document.createElement('div');
    imgContainer.className = 'da-cropper-container';

    const img = document.createElement('img');
    img.src = imageSrc;
    img.className = 'da-cropper-preview-img';
    imgContainer.appendChild(img);
    panel.appendChild(imgContainer);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'da-dialog-actions';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'da-btn secondary';
    btnCancel.textContent = '取消';
    btnCancel.onclick = () => {
        backdrop.remove();
        if (onCancel) onCancel();
    };

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'da-btn primary';
    btnConfirm.textContent = '保存图标';
    btnConfirm.onclick = () => {
        try {
            const canvas = document.createElement('canvas');
            const size = 128;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const minSide = Math.min(img.naturalWidth, img.naturalHeight);
                const sx = (img.naturalWidth - minSide) / 2;
                const sy = (img.naturalHeight - minSide) / 2;
                ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
                const croppedData = canvas.toDataURL('image/png');
                if (cropCallback) cropCallback(croppedData);
                FeedbackService.toastSuccess('悬浮球图标裁剪保存成功');
            }
        } catch {
            FeedbackService.toastError('图像裁剪失败，请尝试更换图片');
        }
        backdrop.remove();
    };

    btnGroup.appendChild(btnCancel);
    btnGroup.appendChild(btnConfirm);
    panel.appendChild(btnGroup);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
}

export interface InpaintModalOptions {
    imageSrc: string;
    initialPrompt: string;
    onConfirm: (result: { initImage: string; maskImage: string; prompt: string }) => void;
    onCancel?: () => void;
}

/**
 * 打开局部重绘 Canvas 画布涂抹模态框
 */
export function openInpaintCanvasModal(options: InpaintModalOptions): void {
    const { imageSrc, initialPrompt, onConfirm, onCancel } = options;

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-inpaint-backdrop';
    backdrop.style.zIndex = '100095';
    ThemeService.applyCurrentThemeToNode(backdrop);

    const modal = document.createElement('div');
    modal.className = 'da-settings-panel da-inpaint-modal-panel';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'da-header-bar';

    const title = document.createElement('h3');
    title.className = 'da-header-title';
    title.textContent = '🖌️ 局部重绘画布涂抹';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-close-red-dot';
    closeBtn.title = '关闭画布';
    closeBtn.onclick = () => {
        backdrop.remove();
        onCancel?.();
    };

    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'da-inpaint-canvas-wrapper';

    const canvas = document.createElement('canvas');
    canvas.className = 'da-inpaint-canvas';
    canvasWrapper.appendChild(canvas);
    modal.appendChild(canvasWrapper);

    const ctx = canvas.getContext('2d')!;
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d')!;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageSrc;

    let isDrawing = false;
    let brushSize = 30;
    let isEraser = false;

    img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        maskCanvas.width = img.naturalWidth;
        maskCanvas.height = img.naturalHeight;

        ctx.drawImage(img, 0, 0);
        maskCtx.fillStyle = '#000000';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    };

    const getPos = (e: MouseEvent | Touch): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const draw = (pos: { x: number; y: number }) => {
        if (!isDrawing) return;

        if (isEraser) {
            maskCtx.globalCompositeOperation = 'source-over';
            maskCtx.fillStyle = '#000000';
            maskCtx.beginPath();
            maskCtx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
            maskCtx.fill();
        } else {
            maskCtx.globalCompositeOperation = 'source-over';
            maskCtx.fillStyle = '#ffffff';
            maskCtx.beginPath();
            maskCtx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
            maskCtx.fill();
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        ctx.save();
        ctx.fillStyle = 'rgba(255, 0, 0, 0.45)';
        ctx.globalCompositeOperation = 'source-over';

        const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = maskCanvas.width;
        tempCanvas.height = maskCanvas.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        const imgData = tempCtx.createImageData(maskCanvas.width, maskCanvas.height);

        for (let i = 0; i < maskData.data.length; i += 4) {
            if (maskData.data[i] > 128) {
                imgData.data[i] = 255;
                imgData.data[i + 1] = 0;
                imgData.data[i + 2] = 0;
                imgData.data[i + 3] = 120;
            }
        }
        tempCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();
    };

    canvas.addEventListener('mousedown', (e) => {
        isDrawing = true;
        draw(getPos(e));
    });

    canvas.addEventListener('mousemove', (e) => {
        draw(getPos(e));
    });

    window.addEventListener('mouseup', () => {
        isDrawing = false;
    });

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            e.preventDefault();
            isDrawing = true;
            draw(getPos(e.touches[0]));
        }
    });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
            e.preventDefault();
            draw(getPos(e.touches[0]));
        }
    });

    window.addEventListener('touchend', () => {
        isDrawing = false;
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'da-inpaint-toolbar';

    const brushSizeInput = document.createElement('input');
    brushSizeInput.type = 'range';
    brushSizeInput.min = '5';
    brushSizeInput.max = '120';
    brushSizeInput.value = String(brushSize);
    brushSizeInput.className = 'da-range-slider';
    brushSizeInput.title = '调节画笔大小';
    brushSizeInput.oninput = () => {
        brushSize = parseInt(brushSizeInput.value, 10);
    };

    const eraserToggleBtn = document.createElement('button');
    eraserToggleBtn.className = 'da-btn secondary';
    eraserToggleBtn.innerHTML = '🧹 橡皮擦';
    eraserToggleBtn.onclick = () => {
        isEraser = !isEraser;
        eraserToggleBtn.className = isEraser ? 'da-btn primary' : 'da-btn secondary';
    };

    const clearBtn = document.createElement('button');
    clearBtn.className = 'da-btn secondary';
    clearBtn.innerHTML = '🗑️ 清空';
    clearBtn.onclick = () => {
        maskCtx.fillStyle = '#000000';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };

    toolbar.appendChild(brushSizeInput);
    toolbar.appendChild(eraserToggleBtn);
    toolbar.appendChild(clearBtn);
    modal.appendChild(toolbar);

    const promptInput = document.createElement('textarea');
    promptInput.className = 'da-textarea';
    promptInput.rows = 2;
    promptInput.placeholder = '输入局部重绘正向提示词...';
    promptInput.value = initialPrompt;
    modal.appendChild(promptInput);

    const footerActions = document.createElement('div');
    footerActions.className = 'da-dialog-actions';

    const cancelFooterBtn = document.createElement('button');
    cancelFooterBtn.className = 'da-btn secondary';
    cancelFooterBtn.textContent = '取消';
    cancelFooterBtn.onclick = () => {
        backdrop.remove();
        onCancel?.();
    };

    const confirmFooterBtn = document.createElement('button');
    confirmFooterBtn.className = 'da-btn primary';
    confirmFooterBtn.textContent = '🎨 提交局部重绘';
    confirmFooterBtn.onclick = () => {
        const maskBase64 = maskCanvas.toDataURL('image/png');
        onConfirm({
            initImage: imageSrc,
            maskImage: maskBase64,
            prompt: promptInput.value.trim()
        });
        backdrop.remove();
        FeedbackService.toastSuccess('已将局部重绘任务提交至队列');
    };

    footerActions.appendChild(cancelFooterBtn);
    footerActions.appendChild(confirmFooterBtn);
    modal.appendChild(footerActions);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
}
