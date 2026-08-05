/**
 * @module ui/components/image-cropper-modal
 * @description 交互式圆形图片裁剪模态框
 *
 * 职责：
 * - 接收用户选择的图片 DataURL
 * - 提供 Canvas 圆形视口遮罩
 * - 支持鼠标/触控拖拽平移与无级缩放 (100% ~ 300%)
 * - 点击确认输出 128x128 高清圆形 PNG Base64
 */

import { logger } from '../../core/logger';

export interface CropperOptions {
    imageSrc: string;
    onConfirm: (croppedBase64: string) => void;
    onCancel?: () => void;
}

/**
 * 弹出圆形图片裁剪模态框
 */
export function openImageCropperModal(options: CropperOptions): void {
    const { imageSrc, onConfirm, onCancel } = options;

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop da-cropper-backdrop';

    const modal = document.createElement('div');
    modal.className = 'da-cropper-modal';
    modal.innerHTML = `
        <div class="da-cropper-header">
            <span class="da-cropper-title">裁剪悬浮球图标</span>
            <button class="da-cropper-close-btn" id="da-cropper-close">✕</button>
        </div>
        <div class="da-cropper-body">
            <div class="da-cropper-canvas-wrapper">
                <canvas id="da-cropper-canvas" width="260" height="260"></canvas>
            </div>
            <div class="da-cropper-controls">
                <span class="da-cropper-label">缩放</span>
                <input type="range" id="da-cropper-scale" min="1" max="3" step="0.02" value="1" class="da-input" />
            </div>
        </div>
        <div class="da-cropper-footer">
            <button class="da-btn secondary" id="da-cropper-cancel-btn">取消</button>
            <button class="da-btn primary" id="da-cropper-confirm-btn">确认裁剪</button>
        </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const canvas = modal.querySelector<HTMLCanvasElement>('#da-cropper-canvas')!;
    const ctx = canvas.getContext('2d')!;
    const scaleInput = modal.querySelector<HTMLInputElement>('#da-cropper-scale')!;
    const confirmBtn = modal.querySelector<HTMLButtonElement>('#da-cropper-confirm-btn')!;
    const cancelBtn = modal.querySelector<HTMLButtonElement>('#da-cropper-cancel-btn')!;
    const closeBtn = modal.querySelector<HTMLButtonElement>('#da-cropper-close')!;

    const img = new Image();
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;
    let scale = 1;

    const CANVAS_SIZE = 260;
    const CIRCLE_RADIUS = 90; // 圆形视口半径 90px (直径 180px)
    const CENTER = CANVAS_SIZE / 2;

    const closeModal = () => {
        if (backdrop.parentNode) {
            backdrop.parentNode.removeChild(backdrop);
        }
    };

    const draw = () => {
        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        if (!img.complete || img.naturalWidth === 0) return;

        ctx.save();

        // 1. 绘制底层图片
        const baseScale = Math.max(
            (CIRCLE_RADIUS * 2) / img.naturalWidth,
            (CIRCLE_RADIUS * 2) / img.naturalHeight
        );
        const curWidth = img.naturalWidth * baseScale * scale;
        const curHeight = img.naturalHeight * baseScale * scale;

        const drawX = CENTER - curWidth / 2 + offsetX;
        const drawY = CENTER - curHeight / 2 + offsetY;

        ctx.drawImage(img, drawX, drawY, curWidth, curHeight);

        // 2. 绘制暗色蒙版层 (中间挖出圆形透光区)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.beginPath();
        ctx.rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        ctx.arc(CENTER, CENTER, CIRCLE_RADIUS, 0, Math.PI * 2, true);
        ctx.fill();

        // 3. 绘制圆形边缘亮色边框
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(CENTER, CENTER, CIRCLE_RADIUS, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    };

    img.onload = () => {
        draw();
    };
    img.src = imageSrc;

    // 缩放控制
    scaleInput.addEventListener('input', () => {
        scale = parseFloat(scaleInput.value);
        draw();
    });

    // 鼠标/触控拖拽平移
    const handleStart = (clientX: number, clientY: number) => {
        isDragging = true;
        startX = clientX - offsetX;
        startY = clientY - offsetY;
    };

    const handleMove = (clientX: number, clientY: number) => {
        if (!isDragging) return;
        offsetX = clientX - startX;
        offsetY = clientY - startY;
        draw();
    };

    const handleEnd = () => {
        isDragging = false;
    };

    canvas.addEventListener('mousedown', (e) => {
        handleStart(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) {
            handleMove(e.clientX, e.clientY);
        }
    });

    window.addEventListener('mouseup', handleEnd);

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            handleStart(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches.length === 1) {
            handleMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });

    canvas.addEventListener('touchend', handleEnd);

    // 取消
    cancelBtn.addEventListener('click', () => {
        closeModal();
        if (onCancel) onCancel();
    });
    closeBtn.addEventListener('click', () => {
        closeModal();
        if (onCancel) onCancel();
    });

    // 确认裁剪 (导出 128x128 圆形 PNG)
    confirmBtn.addEventListener('click', () => {
        try {
            const outCanvas = document.createElement('canvas');
            outCanvas.width = 128;
            outCanvas.height = 128;
            const outCtx = outCanvas.getContext('2d')!;

            // 圆形剪切
            outCtx.beginPath();
            outCtx.arc(64, 64, 64, 0, Math.PI * 2);
            outCtx.clip();

            const baseScale = Math.max(
                (CIRCLE_RADIUS * 2) / img.naturalWidth,
                (CIRCLE_RADIUS * 2) / img.naturalHeight
            );
            const curWidth = img.naturalWidth * baseScale * scale;
            const curHeight = img.naturalHeight * baseScale * scale;

            const ratio = 128 / (CIRCLE_RADIUS * 2);
            const drawX = (CENTER - curWidth / 2 + offsetX - (CENTER - CIRCLE_RADIUS)) * ratio;
            const drawY = (CENTER - curHeight / 2 + offsetY - (CENTER - CIRCLE_RADIUS)) * ratio;
            const drawW = curWidth * ratio;
            const drawH = curHeight * ratio;

            outCtx.drawImage(img, drawX, drawY, drawW, drawH);

            const croppedBase64 = outCanvas.toDataURL('image/png');
            closeModal();
            onConfirm(croppedBase64);
        } catch (err) {
            logger.error('导出圆形裁剪图片失败', err);
            closeModal();
        }
    });
}
