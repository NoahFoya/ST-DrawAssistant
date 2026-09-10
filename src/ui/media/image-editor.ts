/**
 * 图像编辑器 (局部重绘画布与裁剪器)
 * 提供画笔涂抹蒙版、尺寸缩放与图生图底图编辑
 */

import { ThemeService } from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';
import { ModalService } from '../layout/modal-service';
import { IDisposable } from '../../types';

export interface ImageCropperOptions {
    imageSrc: string;
    aspectRatio?: number;
    onCrop?: (croppedBase64: string) => void;
    onConfirm?: (croppedBase64: string) => void;
    onCancel?: () => void;
}

/**
 * 弹出悬浮球图标正圆形裁剪模态框
 */
export function openImageCropperModal(options: ImageCropperOptions): IDisposable {
    if (typeof document === 'undefined') return { dispose: () => {} };

    const { imageSrc, onCrop, onConfirm, onCancel } = options;
    const cropCallback = onConfirm || onCrop;

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-cropper-backdrop';
    ThemeService.applyCurrentThemeToNode(backdrop);

    const panel = document.createElement('div');
    panel.className = 'da-cropper-panel';

    const title = document.createElement('h3');
    title.className = 'da-dialog-title';
    title.style.margin = '0';
    title.textContent = '裁剪悬浮球图标 (正圆形裁剪)';
    panel.appendChild(title);

    // 裁剪舞台与正圆形镂空遮罩
    const stage = document.createElement('div');
    stage.className = 'da-cropper-stage';

    const img = document.createElement('img');
    img.src = imageSrc;
    img.className = 'da-cropper-img';
    img.draggable = false;
    stage.appendChild(img);

    const maskCircle = document.createElement('div');
    maskCircle.className = 'da-cropper-mask-circle';
    stage.appendChild(maskCircle);

    panel.appendChild(stage);

    // 拖拽与缩放旋转状态
    let scale = 1.0;
    let offsetX = 0;
    let offsetY = 0;
    let rotation = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialOffsetX = 0;
    let initialOffsetY = 0;

    const updateTransform = () => {
        img.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${scale}) rotate(${rotation}deg)`;
    };

    // 拖拽平移事件
    stage.addEventListener('pointerdown', (e) => {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialOffsetX = offsetX;
        initialOffsetY = offsetY;
        stage.setPointerCapture?.(e.pointerId);
    });

    stage.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        offsetX = initialOffsetX + (e.clientX - dragStartX);
        offsetY = initialOffsetY + (e.clientY - dragStartY);
        updateTransform();
    });

    const stopDragging = (e: PointerEvent) => {
        if (!isDragging) return;
        isDragging = false;
        try {
            stage.releasePointerCapture?.(e.pointerId);
        } catch {}
    };

    stage.addEventListener('pointerup', stopDragging);
    stage.addEventListener('pointercancel', stopDragging);

    // 滚轮缩放
    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        scale = Math.max(0.5, Math.min(3.0, scale + delta));
        slider.value = String(scale);
        scaleLabel.textContent = `${Math.round(scale * 100)}%`;
        updateTransform();
    }, { passive: false });

    // 控制工具栏 (缩放滑块 + 旋转按钮)
    const controls = document.createElement('div');
    controls.className = 'da-cropper-controls';

    const sliderRow = document.createElement('div');
    sliderRow.className = 'da-cropper-slider-row';

    const scaleLabel = document.createElement('span');
    scaleLabel.textContent = '100%';
    scaleLabel.style.minWidth = '42px';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0.5';
    slider.max = '3.0';
    slider.step = '0.05';
    slider.value = '1.0';
    slider.className = 'da-slider-range da-flex-1';
    slider.oninput = () => {
        scale = parseFloat(slider.value) || 1.0;
        scaleLabel.textContent = `${Math.round(scale * 100)}%`;
        updateTransform();
    };

    sliderRow.appendChild(document.createTextNode('缩放:'));
    sliderRow.appendChild(slider);
    sliderRow.appendChild(scaleLabel);

    const btnRotate = document.createElement('button');
    btnRotate.type = 'button';
    btnRotate.className = 'da-btn da-btn--secondary da-btn--sm';
    btnRotate.textContent = '↺ 90°';
    btnRotate.title = '顺时针旋转 90 度';
    btnRotate.onclick = () => {
        rotation = (rotation + 90) % 360;
        updateTransform();
    };

    controls.appendChild(sliderRow);
    controls.appendChild(btnRotate);
    panel.appendChild(controls);

    // 底部操作区
    const btnGroup = document.createElement('div');
    btnGroup.className = 'da-dialog-actions';
    btnGroup.style.marginTop = '4px';

    let isSettled = false;

    const modalHandle = ModalService.getInstance().open(backdrop, {
        closeOnBackdrop: true,
        closeOnEscape: true,
        onClose: () => {
            if (!isSettled) {
                isSettled = true;
                onCancel?.();
            }
        }
    });

    const btnCancel = document.createElement('button');
    btnCancel.className = 'da-btn da-btn--secondary';
    btnCancel.textContent = '取消';
    btnCancel.onclick = () => {
        if (!isSettled) {
            isSettled = true;
            onCancel?.();
        }
        modalHandle.dispose();
    };

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'da-btn da-btn--primary';
    btnConfirm.textContent = '保存正圆形图标';
    btnConfirm.onclick = () => {
        try {
            const canvas = document.createElement('canvas');
            const outputSize = 160;
            canvas.width = outputSize;
            canvas.height = outputSize;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                FeedbackService.toastError('无法获取 Canvas 2D 绘图上下文');
                isSettled = true;
                modalHandle.dispose();
                return;
            }

            // 正圆形裁剪路径 (透明背景)
            ctx.beginPath();
            ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();

            // 依据中心点平移、旋转与缩放
            ctx.translate(outputSize / 2, outputSize / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.scale(scale, scale);

            const maskDiameter = 220;
            const canvasRatio = outputSize / maskDiameter;
            const natW = img.naturalWidth || outputSize;
            const natH = img.naturalHeight || outputSize;
            // 基础自适应以填充裁切圆环
            const baseCover = Math.max(maskDiameter / natW, maskDiameter / natH);
            const drawW = natW * baseCover * canvasRatio;
            const drawH = natH * baseCover * canvasRatio;

            ctx.drawImage(
                img,
                -drawW / 2 + offsetX * canvasRatio,
                -drawH / 2 + offsetY * canvasRatio,
                drawW,
                drawH
            );

            const croppedData = canvas.toDataURL('image/png');
            if (cropCallback) cropCallback(croppedData);
            FeedbackService.toastSuccess('悬浮球正圆形图标裁剪保存成功');
        } catch {
            FeedbackService.toastError('图像裁剪失败，请尝试更换图片');
        }
        isSettled = true;
        modalHandle.dispose();
    };

    btnGroup.appendChild(btnCancel);
    btnGroup.appendChild(btnConfirm);
    panel.appendChild(btnGroup);

    backdrop.appendChild(panel);
    updateTransform();

    return modalHandle;
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
export function openInpaintCanvasModal(options: InpaintModalOptions): IDisposable {
    const { imageSrc, initialPrompt, onConfirm, onCancel } = options;

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-inpaint-backdrop';
    ThemeService.applyCurrentThemeToNode(backdrop);

    const modal = document.createElement('div');
    modal.className = 'da-settings-panel da-inpaint-modal-panel';
    modal.addEventListener('click', (e) => e.stopPropagation());

    let isSettled = false;
    let isDrawing = false;
    let brushSize = 30;
    let isEraser = false;

    const stopDrawing = () => {
        isDrawing = false;
    };

    const cleanupResources = () => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('mouseup', stopDrawing);
            window.removeEventListener('touchend', stopDrawing);
        }
        if (!isSettled) {
            isSettled = true;
            onCancel?.();
        }
    };

    const modalHandle = ModalService.getInstance().open(backdrop, {
        closeOnBackdrop: true,
        closeOnEscape: true,
        onClose: cleanupResources
    });

    const header = document.createElement('div');
    header.className = 'da-header-bar';

    const title = document.createElement('h3');
    title.className = 'da-header-title';
    title.textContent = '局部重绘画布涂抹';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-modal-close-btn';
    closeBtn.title = '关闭画布';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => {
        if (!isSettled) {
            isSettled = true;
            onCancel?.();
        }
        modalHandle.dispose();
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
        const scaleX = canvas.width / (rect.width || 1);
        const scaleY = canvas.height / (rect.height || 1);
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

    if (typeof window !== 'undefined') {
        window.addEventListener('mouseup', stopDrawing);
        window.addEventListener('touchend', stopDrawing);
    }

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            e.preventDefault();
            isDrawing = true;
            draw(getPos(e.touches[0]));
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
            e.preventDefault();
            draw(getPos(e.touches[0]));
        }
    }, { passive: false });

    const toolbar = document.createElement('div');
    toolbar.className = 'da-filter-bar';

    const brushSizeInput = document.createElement('input');
    brushSizeInput.type = 'number';
    brushSizeInput.min = '5';
    brushSizeInput.max = '120';
    brushSizeInput.value = String(brushSize);
    brushSizeInput.className = 'da-input da-input-num-small da-brush-size-input';
    brushSizeInput.title = '调节画笔大小 (5-120px)';
    brushSizeInput.onchange = () => {
        brushSize = Math.max(5, Math.min(120, parseInt(brushSizeInput.value, 10) || 20));
        brushSizeInput.value = String(brushSize);
    };

    const eraserToggleBtn = document.createElement('button');
    eraserToggleBtn.className = 'da-btn da-btn--secondary';
    eraserToggleBtn.textContent = '橡皮擦';
    eraserToggleBtn.onclick = () => {
        isEraser = !isEraser;
        eraserToggleBtn.className = isEraser ? 'da-btn da-btn--primary' : 'da-btn da-btn--secondary';
    };

    const clearBtn = document.createElement('button');
    clearBtn.className = 'da-btn da-btn--secondary';
    clearBtn.textContent = '清空';
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
    cancelFooterBtn.className = 'da-btn da-btn--secondary';
    cancelFooterBtn.textContent = '取消';
    cancelFooterBtn.onclick = () => {
        if (!isSettled) {
            isSettled = true;
            onCancel?.();
        }
        modalHandle.dispose();
    };

    const confirmFooterBtn = document.createElement('button');
    confirmFooterBtn.className = 'da-btn da-btn--primary';
    confirmFooterBtn.textContent = '提交局部重绘';
    confirmFooterBtn.onclick = () => {
        const maskBase64 = maskCanvas.toDataURL('image/png');
        onConfirm({
            initImage: imageSrc,
            maskImage: maskBase64,
            prompt: promptInput.value.trim()
        });
        isSettled = true;
        modalHandle.dispose();
        FeedbackService.toastSuccess('已将局部重绘任务提交至队列');
    };

    footerActions.appendChild(cancelFooterBtn);
    footerActions.appendChild(confirmFooterBtn);
    modal.appendChild(footerActions);

    backdrop.appendChild(modal);

    return modalHandle;
}
