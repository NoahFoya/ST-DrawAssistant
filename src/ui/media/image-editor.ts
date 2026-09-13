/**
 * @module src/ui/media/image-editor
 * @description 局部重绘画布涂鸦模态窗 (InpaintModal) 与正圆形头像裁剪器 (CircularCropper)
 *
 * 遵循规范 (styles/features/inpaint.css)：
 * 1. InpaintModal：
 *    - 双层 Canvas 渲染与涂鸦架构：底图层 + 顶层半透明红色蒙版层；
 *    - 画笔尺寸微调 (NumberInput，严格剔除滑块)、橡皮擦切换、一键反转蒙版 (Invert)、一键清空 (Clear)；
 *    - 输出导出：导出原始图片 Blob 与二值化黑白蒙版 (White: Inpaint 重绘区, Black: 保留区)；
 * 2. CircularCropper：
 *    - 针对悬浮球正圆形头像，运用 9999px box-shadow 构建圆外暗化同心遮罩；
 *    - 滚轮缩放与鼠标拖拽平移，一键裁剪导出 1:1 正圆形 Blob。
 */

import { createElement } from '../../util/dom';
import { createButton, ButtonHandle } from '../components/button';
import { createNumberInput, NumberInputHandle } from '../components/input';
import { Toast } from '../components/feedback';
import { getIconSvg } from '../components/icons';

// 1. 局部重绘蒙版画布模态窗 (InpaintModal)

import type { InpaintResult } from '@types';
export type { InpaintResult };

export interface InpaintModalOptions {
    title?: string;
    imageBlob?: Blob;
    imageUrl?: string;
    brushSize?: number;
    containerEl?: HTMLElement;
    onConfirm?: (result: InpaintResult) => void;
    onClose?: () => void;
}

export interface InpaintModalHandle {
    readonly element: HTMLElement;
    open(imageBlob: Blob): void;
    close(): void;
    isOpen(): boolean;
    clearMask(): void;
    invertMask(): void;
    dispose(): void;
}

export function createInpaintModal(options: InpaintModalOptions = {}): InpaintModalHandle {
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    let isOpen = false;
    let currentImage: HTMLImageElement | null = null;
    let currentBlob: Blob | null = options.imageBlob || null;
    let brushSize = options.brushSize || 32;
    let isEraser = false;
    let isDrawing = false;

    // 1. 遮罩外壳 (.da-inpaint-backdrop)
    const backdrop = createElement('div', {
        className: 'da-inpaint-backdrop st-da-root',
        attributes: { style: 'display: none;' }
    });

    // 2. 居中操作面板 (.da-inpaint-modal-panel)
    const panel = createElement('div', { className: 'da-inpaint-modal-panel' });
    backdrop.appendChild(panel);

    // 3. 顶栏
    const header = createElement('div', {
        attributes: {
            style: 'display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid var(--da-border-color);'
        }
    });

    const titleEl = createElement('h3', {
        attributes: { style: 'margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; color: var(--da-text-primary);' }
    });
    titleEl.innerHTML = `${getIconSvg('palette')} <span>${options.title || '局部重绘蒙版绘制 (Inpaint Canvas)'}</span>`;
    header.appendChild(titleEl);

    const closeBtn = createElement('button', {
        className: 'da-icon-btn',
        attributes: { type: 'button', 'aria-label': '关闭', title: '关闭 (Esc)' }
    });
    closeBtn.innerHTML = getIconSvg('close');
    closeBtn.addEventListener('click', () => close());
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // 4. 画布视窗容器 (.da-inpaint-canvas-wrapper)
    const canvasWrapper = createElement('div', { className: 'da-inpaint-canvas-wrapper' });
    const canvas = createElement('canvas', { className: 'da-inpaint-canvas' });
    canvasWrapper.appendChild(canvas);
    panel.appendChild(canvasWrapper);

    const ctx = canvas.getContext('2d');

    // 辅助离屏蒙版画布 (用于二值化黑白导出)
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d');

    // 5. 底部工具控制条
    const toolbar = createElement('div', {
        attributes: {
            style: 'display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--da-border-color);'
        }
    });

    const leftControls = createElement('div', {
        attributes: { style: 'display: flex; gap: 8px; align-items: center;' }
    });

    // 画笔尺寸调节微调框 (等宽数值输入控件，步进精确调整)
    const sizeLabel = createElement('span', {
        attributes: { style: 'font-size: 13px; color: var(--da-text-secondary);' },
        textContent: '画笔粗细:'
    });
    leftControls.appendChild(sizeLabel);

    const brushInput: NumberInputHandle = createNumberInput({
        value: brushSize,
        min: 4,
        max: 160,
        step: 4,
        unit: 'px',
        onChange: (val) => {
            brushSize = val;
        }
    });
    regDisposer(brushInput);
    brushInput.element.style.width = '90px';
    leftControls.appendChild(brushInput.element);

    // 橡皮擦切换
    const eraserBtn: ButtonHandle = createButton({
        text: '橡皮擦',
        variant: 'secondary',
        onClick: () => {
            isEraser = !isEraser;
            eraserBtn.setText(isEraser ? '画笔模式' : '橡皮擦');
            eraserBtn.element.classList.toggle('da-btn--primary', isEraser);
            eraserBtn.element.classList.toggle('da-btn--secondary', !isEraser);
        }
    });
    regDisposer(eraserBtn);
    leftControls.appendChild(eraserBtn.element);

    // 一键反转蒙版
    const invertBtn: ButtonHandle = createButton({
        text: '反转蒙版',
        variant: 'secondary',
        onClick: () => {
            invertMask();
        }
    });
    regDisposer(invertBtn);
    leftControls.appendChild(invertBtn.element);

    // 一键清空蒙版
    const clearBtn: ButtonHandle = createButton({
        text: '清空涂鸦',
        variant: 'secondary',
        onClick: () => {
            clearMask();
        }
    });
    regDisposer(clearBtn);
    leftControls.appendChild(clearBtn.element);

    toolbar.appendChild(leftControls);

    // 确认与取消
    const rightControls = createElement('div', {
        attributes: { style: 'display: flex; gap: 8px; align-items: center;' }
    });

    const cancelBtn: ButtonHandle = createButton({
        text: '取消',
        variant: 'secondary',
        onClick: () => close()
    });
    regDisposer(cancelBtn);
    rightControls.appendChild(cancelBtn.element);

    const confirmBtn: ButtonHandle = createButton({
        text: '应用重绘蒙版',
        variant: 'primary',
        icon: 'check',
        onClick: async () => {
            if (!currentBlob || !currentImage) {
                Toast.warn('缺少原始基底图片');
                return;
            }

            // 生成二值化黑白蒙版 Blob (White: 涂鸦区域 Inpaint, Black: 保持区域 Keep)
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = currentImage.naturalWidth || canvas.width;
            exportCanvas.height = currentImage.naturalHeight || canvas.height;
            const expCtx = exportCanvas.getContext('2d');

            if (expCtx) {
                // 底色全黑
                expCtx.fillStyle = '#000000';
                expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

                // 绘制涂鸦蒙版像素
                expCtx.drawImage(maskCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
            }

            exportCanvas.toBlob((maskBlob) => {
                if (!maskBlob) {
                    Toast.error('导出蒙版失败');
                    return;
                }
                const maskBase64 = exportCanvas.toDataURL('image/png');
                options.onConfirm?.({
                    baseBlob: currentBlob!,
                    maskBlob,
                    maskBase64
                });
                Toast.success('重绘蒙版生成完成');
                close();
            }, 'image/png');
        }
    });
    regDisposer(confirmBtn);
    rightControls.appendChild(confirmBtn.element);

    toolbar.appendChild(rightControls);
    panel.appendChild(toolbar);

    // 6. 绘图事件绑定
    function drawStroke(x: number, y: number) {
        if (!ctx || !maskCtx) return;

        // 顶层主视窗：半透明红色指示
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        if (isEraser) {
            // 擦除：恢复底图
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fill();
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
            ctx.fill();
        }
        ctx.restore();

        // 离屏纯黑白蒙版：白色为涂鸦
        maskCtx.save();
        maskCtx.beginPath();
        maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        if (isEraser) {
            maskCtx.globalCompositeOperation = 'destination-out';
            maskCtx.fill();
        } else {
            maskCtx.globalCompositeOperation = 'source-over';
            maskCtx.fillStyle = '#ffffff';
            maskCtx.fill();
        }
        maskCtx.restore();
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
        if (e.button !== 0) return;
        isDrawing = true;
        const { x, y } = getCanvasCoords(e);
        drawStroke(x, y);
    });

    const onMouseMove = (e: MouseEvent) => {
        if (!isDrawing) return;
        const { x, y } = getCanvasCoords(e);
        drawStroke(x, y);
    };

    const onMouseUp = () => {
        if (isDrawing) {
            isDrawing = false;
        }
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        disposers.push(() => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        });
    }

    function redrawCanvas() {
        if (!ctx || !currentImage) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);

        // 叠加离屏涂鸦半透明预览
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    function clearMask() {
        if (!maskCtx) return;
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        redrawCanvas();
        Toast.info('蒙版涂鸦已清空');
    }

    function invertMask() {
        if (!maskCtx) return;
        const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const data = imgData.data;

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha > 0) {
                // 涂鸦过变透明
                data[i + 3] = 0;
            } else {
                // 未涂鸦变白色
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
                data[i + 3] = 255;
            }
        }
        maskCtx.putImageData(imgData, 0, 0);
        redrawCanvas();
        Toast.info('蒙版已反转');
    }

    function loadBlob(blob: Blob) {
        currentBlob = blob;
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            currentImage = img;
            canvas.width = img.naturalWidth || 512;
            canvas.height = img.naturalHeight || 512;
            maskCanvas.width = canvas.width;
            maskCanvas.height = canvas.height;

            clearMask();
            URL.revokeObjectURL(url);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            Toast.error('底图加载失败，请重试');
        };
        img.src = url;
    }

    // 键盘 Esc 监听
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && isOpen) {
            close();
        }
    };
    document.addEventListener('keydown', onKeyDown);
    disposers.push(() => document.removeEventListener('keydown', onKeyDown));

    disposers.push(() => backdrop.remove());

    function open(blob: Blob) {
        isOpen = true;
        const targetParent = options.containerEl || (typeof document !== 'undefined' ? document.body : null);
        if (targetParent && !targetParent.contains(backdrop)) {
            targetParent.appendChild(backdrop);
        }
        backdrop.style.display = 'flex';
        loadBlob(blob);
    }

    function close() {
        isOpen = false;
        backdrop.style.display = 'none';
        options.onClose?.();
    }

    return {
        element: backdrop,
        open,
        close,
        isOpen(): boolean {
            return isOpen;
        },
        clearMask,
        invertMask,
        dispose(): void {
            for (const d of disposers) {
                d();
            }
        }
    };
}

// 2. 正圆形头像裁剪器 (CircularCropper)

export interface CircularCropperOptions {
    containerEl?: HTMLElement;
    onConfirm?: (croppedBlob: Blob, dataUrl: string) => void;
    onClose?: () => void;
}

export interface CircularCropperHandle {
    readonly element: HTMLElement;
    open(imageBlob: Blob): void;
    close(): void;
    isOpen(): boolean;
    dispose(): void;
}

export function createCircularCropper(options: CircularCropperOptions = {}): CircularCropperHandle {
    const disposers: (() => void)[] = [];

    let isOpen = false;
    let currentImage: HTMLImageElement | null = null;
    let zoom = 1.0;
    let posX = 0;
    let posY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const backdrop = createElement('div', {
        className: 'da-cropper-backdrop st-da-root',
        attributes: {
            style: 'display: none; position: fixed; inset: 0; z-index: var(--da-z-modal, 100050); background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(6px); align-items: center; justify-content: center;'
        }
    });

    const panel = createElement('div', {
        className: 'da-cropper-panel',
        attributes: {
            style: 'width: 380px; background: var(--da-bg-secondary); border-radius: 14px; border: 1px solid var(--da-border-color); padding: 18px; display: flex; flex-direction: column; gap: 14px; box-shadow: var(--da-shadow-lg);'
        }
    });
    backdrop.appendChild(panel);

    const titleEl = createElement('h4', {
        attributes: { style: 'margin: 0; font-size: 15px; font-weight: 600; color: var(--da-text-primary); text-align: center;' },
        textContent: '调整正圆形头像裁切'
    });
    panel.appendChild(titleEl);

    // 裁剪视口视窗
    const cropWrapper = createElement('div', {
        attributes: {
            style: 'position: relative; width: 280px; height: 280px; margin: 0 auto; overflow: hidden; background: #12141a; border-radius: 8px; cursor: grab;'
        }
    });

    const imgEl = createElement('img', {
        attributes: {
            style: 'position: absolute; pointer-events: none; transform-origin: center center;'
        }
    });
    cropWrapper.appendChild(imgEl);

    // 正圆遮罩圈 (运用 9999px 阴影构建圆外暗化同心遮罩)
    const circleMask = createElement('div', {
        className: 'da-cropper-preview-circle',
        attributes: {
            style: 'position: absolute; top: 50%; left: 50%; width: 200px; height: 200px; transform: translate(-50%, -50%); border-radius: 50%; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.65); border: 2px solid var(--da-accent-color); pointer-events: none;'
        }
    });
    cropWrapper.appendChild(circleMask);
    panel.appendChild(cropWrapper);

    // 缩放滚轮与拖拽
    function updateTransform() {
        imgEl.style.transform = `translate(${posX}px, ${posY}px) scale(${zoom})`;
    }

    cropWrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        zoom = Math.max(0.2, Math.min(4.0, zoom + delta));
        updateTransform();
    }, { passive: false });

    cropWrapper.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        startX = e.clientX - posX;
        startY = e.clientY - posY;
        cropWrapper.style.cursor = 'grabbing';
    });

    const onCropMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        posX = e.clientX - startX;
        posY = e.clientY - startY;
        updateTransform();
    };

    const onCropMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            cropWrapper.style.cursor = 'grab';
        }
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('mousemove', onCropMouseMove);
        window.addEventListener('mouseup', onCropMouseUp);
        disposers.push(() => {
            window.removeEventListener('mousemove', onCropMouseMove);
            window.removeEventListener('mouseup', onCropMouseUp);
        });
    }

    // 动作栏
    const actionsRow = createElement('div', {
        attributes: { style: 'display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px;' }
    });

    const cancelBtn = createButton({
        text: '取消',
        variant: 'secondary',
        onClick: () => close()
    });
    actionsRow.appendChild(cancelBtn.element);

    const confirmBtn = createButton({
        text: '确认裁剪',
        variant: 'primary',
        icon: 'check',
        onClick: () => {
            if (!currentImage) return;

            // 裁剪导出 200x200 像素
            const outCanvas = document.createElement('canvas');
            outCanvas.width = 200;
            outCanvas.height = 200;
            const ctx = outCanvas.getContext('2d');

            if (ctx) {
                ctx.beginPath();
                ctx.arc(100, 100, 100, 0, Math.PI * 2);
                ctx.clip();

                // 绘制当前可视区域映射
                const centerX = 140; // 280/2
                const centerY = 140;
                ctx.translate(100, 100);
                ctx.scale(zoom, zoom);
                ctx.translate(posX + (currentImage.width * zoom) / 2 - centerX, posY + (currentImage.height * zoom) / 2 - centerY);
                ctx.drawImage(currentImage, -currentImage.width / 2, -currentImage.height / 2);
            }

            outCanvas.toBlob((blob) => {
                if (!blob) return;
                const dataUrl = outCanvas.toDataURL('image/png');
                options.onConfirm?.(blob, dataUrl);
                Toast.success('头像裁剪完成');
                close();
            }, 'image/png');
        }
    });
    actionsRow.appendChild(confirmBtn.element);
    panel.appendChild(actionsRow);

    disposers.push(() => backdrop.remove());

    let currentCropperUrl: string | null = null;

    const revokeCropperUrl = () => {
        if (currentCropperUrl) {
            try {
                URL.revokeObjectURL(currentCropperUrl);
            } catch {
                // 忽略注销异常
            }
            currentCropperUrl = null;
        }
    };

    function open(blob: Blob) {
        isOpen = true;
        const targetParent = options.containerEl || (typeof document !== 'undefined' ? document.body : null);
        if (targetParent && !targetParent.contains(backdrop)) {
            targetParent.appendChild(backdrop);
        }
        backdrop.style.display = 'flex';
        zoom = 1.0;
        posX = 0;
        posY = 0;

        revokeCropperUrl();
        currentCropperUrl = URL.createObjectURL(blob);
        const url = currentCropperUrl;

        const img = new Image();
        img.onload = () => {
            currentImage = img;
            imgEl.src = url;
            imgEl.style.width = '200px';
            imgEl.style.height = 'auto';
            posX = 40; // 居中 280 - 200 / 2
            posY = 40;
            updateTransform();
        };
        img.onerror = () => {
            revokeCropperUrl();
            Toast.error('裁剪原图加载失败');
        };
        img.src = url;
    }

    function close() {
        isOpen = false;
        backdrop.style.display = 'none';
        revokeCropperUrl();
        options.onClose?.();
    }

    return {
        element: backdrop,
        open,
        close,
        isOpen(): boolean {
            return isOpen;
        },
        dispose(): void {
            revokeCropperUrl();
            for (const d of disposers) {
                d();
            }
        }
    };
}
