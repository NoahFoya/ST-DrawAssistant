/**
 * @module src/ui/media/lightbox-modal
 * @description 全屏沉浸式图像预览大灯箱组件 (LightboxModal)
 *
 * 遵循规范：
 * 1. 全屏沉浸背景遮罩与模糊滤镜，点击遮罩或按 Esc 快速退出；
 * 2. 中心高保真原图展示：鼠标滚轮平滑缩放 (20% ~ 500%)，鼠标拖拽平移视口；
 * 3. 悬浮底栏工具条：放大、缩小、1:1 复位、自适应窗口、一键下载、查看参数抽屉；
 * 4. 键盘监听：Esc (退出)、ArrowLeft (前一张)、ArrowRight (后一张)。
 */

import { createElement } from '../../util/dom';
import { createButton, ButtonHandle } from '../components/button';
import { getIconSvg } from '../components/icons';
import { Toast } from '../components/feedback';
import type { MediaCardItemModel } from '@types';

export interface LightboxModalOptions {
    items?: MediaCardItemModel[];
    initialIndex?: number;
    containerEl?: HTMLElement;
    onViewInfo?: (item: MediaCardItemModel) => void;
    onClose?: () => void;
}

export interface LightboxModalHandle {
    readonly element: HTMLElement;
    open(items: MediaCardItemModel[], startIndex?: number): void;
    close(): void;
    isOpen(): boolean;
    next(): void;
    prev(): void;
    dispose(): void;
}

export function createLightboxModal(options: LightboxModalOptions = {}): LightboxModalHandle {
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    let items = options.items || [];
    let currentIndex = options.initialIndex || 0;
    let isOpen = false;

    let zoom = 1.0;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    // 1. 全屏遮罩层
    const backdrop = createElement('div', {
        className: 'da-lightbox-backdrop st-da-root',
        attributes: {
            style: 'display: none; position: fixed; inset: 0; z-index: var(--da-z-dialog, 100095); background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); flex-direction: column; overflow: hidden; user-select: none;'
        }
    });

    // 2. 顶栏操作栏
    const topBar = createElement('div', {
        attributes: {
            style: 'height: 48px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; z-index: 10; background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6) 0%, transparent 100%);'
        }
    });

    const infoEl = createElement('div', {
        attributes: { style: 'color: #fff; font-size: 13px; font-weight: 500;' }
    });
    topBar.appendChild(infoEl);

    const topActions = createElement('div', {
        attributes: { style: 'display: flex; gap: 8px; align-items: center;' }
    });

    const zoomBadge = createElement('span', {
        attributes: { style: 'font-size: 12px; color: rgba(255, 255, 255, 0.7); min-width: 45px; text-align: center;' },
        textContent: '100%'
    });
    topActions.appendChild(zoomBadge);

    const closeBtn = createElement('button', {
        className: 'da-icon-btn',
        attributes: { type: 'button', 'aria-label': '关闭预览', title: '退出预览 (Esc)', style: 'color: #fff; background: rgba(255, 255, 255, 0.15);' }
    });
    closeBtn.innerHTML = getIconSvg('close');
    closeBtn.addEventListener('click', () => close());
    topActions.appendChild(closeBtn);

    topBar.appendChild(topActions);
    backdrop.appendChild(topBar);

    // 3. 图像交互主舞台
    const stage = createElement('div', {
        attributes: {
            style: 'flex: 1; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; cursor: grab;'
        }
    });

    const imgEl = createElement('img', {
        attributes: {
            style: 'max-width: 90%; max-height: 90%; object-fit: contain; pointer-events: auto; transition: transform 0.08s ease-out; transform-origin: center center; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6); border-radius: 4px;'
        }
    });
    stage.appendChild(imgEl);

    // 左箭头翻页按钮
    const prevArrow = createElement('button', {
        className: 'da-icon-btn',
        attributes: {
            type: 'button',
            title: '上一张 (左箭头)',
            style: 'position: absolute; left: 16px; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 50%; background: rgba(0, 0, 0, 0.45); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); z-index: 5;'
        }
    });
    prevArrow.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
    `;
    prevArrow.addEventListener('click', (e) => {
        e.stopPropagation();
        prev();
    });
    stage.appendChild(prevArrow);

    // 右箭头翻页按钮
    const nextArrow = createElement('button', {
        className: 'da-icon-btn',
        attributes: {
            type: 'button',
            title: '下一张 (右箭头)',
            style: 'position: absolute; right: 16px; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 50%; background: rgba(0, 0, 0, 0.45); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); z-index: 5;'
        }
    });
    nextArrow.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
    `;
    nextArrow.addEventListener('click', (e) => {
        e.stopPropagation();
        next();
    });
    stage.appendChild(nextArrow);

    backdrop.appendChild(stage);

    // 4. 底部浮动控制栏
    const bottomBar = createElement('div', {
        attributes: {
            style: 'height: 52px; padding: 0 20px; display: flex; align-items: center; justify-content: center; gap: 10px; z-index: 10; background: linear-gradient(to top, rgba(0, 0, 0, 0.6) 0%, transparent 100%);'
        }
    });

    const toolbarWrapper = createElement('div', {
        attributes: {
            style: 'display: flex; gap: 8px; background: rgba(30, 34, 45, 0.85); backdrop-filter: blur(8px); padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);'
        }
    });

    // 放大
    const zoomInBtn: ButtonHandle = createButton({
        text: '放大',
        variant: 'secondary',
        onClick: () => {
            zoom = Math.min(5.0, zoom + 0.25);
            applyTransform();
        }
    });
    regDisposer(zoomInBtn);
    toolbarWrapper.appendChild(zoomInBtn.element);

    // 缩小
    const zoomOutBtn: ButtonHandle = createButton({
        text: '缩小',
        variant: 'secondary',
        onClick: () => {
            zoom = Math.max(0.25, zoom - 0.25);
            applyTransform();
        }
    });
    regDisposer(zoomOutBtn);
    toolbarWrapper.appendChild(zoomOutBtn.element);

    // 1:1 复原
    const resetZoomBtn: ButtonHandle = createButton({
        text: '1:1 原图',
        variant: 'secondary',
        onClick: () => {
            zoom = 1.0;
            translateX = 0;
            translateY = 0;
            applyTransform();
        }
    });
    regDisposer(resetZoomBtn);
    toolbarWrapper.appendChild(resetZoomBtn.element);

    // 下载原图
    const downloadBtn: ButtonHandle = createButton({
        text: '下载',
        variant: 'secondary',
        icon: 'download',
        onClick: () => {
            const currentItem = items[currentIndex];
            if (!currentItem) return;
            const a = document.createElement('a');
            a.href = currentItem.url;
            a.download = `st_draw_${currentItem.id || Date.now()}.png`;
            a.click();
            Toast.success('图片已开始下载');
        }
    });
    regDisposer(downloadBtn);
    toolbarWrapper.appendChild(downloadBtn.element);

    // 参数详情
    const infoBtn: ButtonHandle = createButton({
        text: '生图参数',
        variant: 'secondary',
        icon: 'palette',
        onClick: () => {
            const currentItem = items[currentIndex];
            if (currentItem && options.onViewInfo) {
                options.onViewInfo(currentItem);
            }
        }
    });
    regDisposer(infoBtn);
    toolbarWrapper.appendChild(infoBtn.element);

    bottomBar.appendChild(toolbarWrapper);
    backdrop.appendChild(bottomBar);

    // 5. 交互逻辑：缩放与拖拽
    function applyTransform() {
        imgEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${zoom})`;
        zoomBadge.textContent = `${Math.round(zoom * 100)}%`;
    }

    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        zoom = Math.max(0.2, Math.min(5.0, zoom + delta));
        applyTransform();
    }, { passive: false });

    stage.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        stage.style.cursor = 'grabbing';
    });

    const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        applyTransform();
    };

    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            stage.style.cursor = 'grab';
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

    // 键盘监听
    const onKeyDown = (e: KeyboardEvent) => {
        if (!isOpen) return;
        if (e.key === 'Escape') {
            close();
        } else if (e.key === 'ArrowLeft') {
            prev();
        } else if (e.key === 'ArrowRight') {
            next();
        } else if (e.key === '+' || e.key === '=') {
            zoom = Math.min(5.0, zoom + 0.25);
            applyTransform();
        } else if (e.key === '-') {
            zoom = Math.max(0.25, zoom - 0.25);
            applyTransform();
        }
    };
    document.addEventListener('keydown', onKeyDown);
    disposers.push(() => document.removeEventListener('keydown', onKeyDown));

    function renderCurrentItem() {
        if (items.length === 0) {
            infoEl.textContent = '暂无图片';
            imgEl.src = '';
            prevArrow.style.display = 'none';
            nextArrow.style.display = 'none';
            return;
        }

        const item = items[currentIndex];
        imgEl.src = item.url;
        imgEl.alt = item.prompt || '大图预览';

        infoEl.textContent = `第 ${currentIndex + 1} / ${items.length} 张 · ${item.width || '--'} × ${item.height || '--'}`;

        prevArrow.style.display = items.length > 1 ? '' : 'none';
        nextArrow.style.display = items.length > 1 ? '' : 'none';

        zoom = 1.0;
        translateX = 0;
        translateY = 0;
        applyTransform();
    }

    function open(newItems: MediaCardItemModel[], startIndex = 0) {
        items = newItems;
        currentIndex = Math.max(0, Math.min(startIndex, items.length - 1));
        isOpen = true;
        const targetParent = options.containerEl || (typeof document !== 'undefined' ? document.body : null);
        if (targetParent && !targetParent.contains(backdrop)) {
            targetParent.appendChild(backdrop);
        }
        backdrop.style.display = 'flex';
        renderCurrentItem();
    }

    function close() {
        isOpen = false;
        backdrop.style.display = 'none';
        options.onClose?.();
    }

    function next() {
        if (items.length <= 1) return;
        currentIndex = (currentIndex + 1) % items.length;
        renderCurrentItem();
    }

    function prev() {
        if (items.length <= 1) return;
        currentIndex = (currentIndex - 1 + items.length) % items.length;
        renderCurrentItem();
    }

    disposers.push(() => backdrop.remove());

    return {
        element: backdrop,
        open,
        close,
        isOpen(): boolean {
            return isOpen;
        },
        next,
        prev,
        dispose(): void {
            for (const d of disposers) {
                d();
            }
        }
    };
}
