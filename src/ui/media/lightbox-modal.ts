/**
 * 全屏大图画廊灯箱视窗组件 (LightboxModal)。
 *
 * @remarks
 * 负责全屏高保真图像预览、手势平移缩放、前后翻页与标星收藏快捷操作：
 * 1. 视窗层级与环境：依托 .da-lightbox-backdrop 提供沉浸式暗色模糊遮罩；
 * 2. 变换舞台：支持滚轮缩放 (0.2x ~ 5.0x)、鼠标拖拽平移及双击原图比例复位；
 * 3. 标星收藏管理：支持直接基于 imageId 调用 imageStorage.toggleFavorite 切换收藏状态；
 * 4. 键盘接管与生命周期：接管 Esc 退出、左右方向键切图，并在销毁时彻底解绑全局监听。
 */

import type { Disposable } from '../types';
import { imageStorage } from '../../store/image-storage';
import { Toast } from '../feedback/toast';
import { logger } from '../../util/logger';

/** 灯箱画廊条目数据接口 */
export interface LightboxItem {
    /** 图像展示 URL（Blob URL、远程路径或 Data URL） */
    readonly url: string;
    /** 本地资产唯一标识符，存在时支持标星收藏 */
    readonly imageId?: string;
    /** 图像标题或提示词简述 */
    readonly title?: string;
    /** 初始标星收藏状态 */
    favorited?: boolean;
}

/** 单图快捷打开灯箱视窗时的可选配置项 */
export interface LightboxOpenOptions {
    /** 本地资产唯一标识符，存在时可触发标星收藏联动 */
    imageId?: string;
    /** 初始标星收藏状态 */
    favorited?: boolean;
    /** 图像标题或提示词简述 */
    title?: string;
}

/**
 * 全屏大图画廊灯箱视窗类。
 */
export class LightboxModal implements Disposable {
    private isOpenState = false;
    private items: LightboxItem[] = [];
    private currentIndex = 0;

    // 缩放平移变换状态
    private zoom = 1.0;
    private translateX = 0;
    private translateY = 0;
    private isDragging = false;
    private dragStartX = 0;
    private dragStartY = 0;

    // DOM 元素引用
    private backdropEl?: HTMLElement;
    private wrapperEl?: HTMLElement;
    private imgEl?: HTMLImageElement;
    private counterEl?: HTMLElement;
    private titleEl?: HTMLElement;
    private scaleTextEl?: HTMLElement;
    private prevBtnEl?: HTMLElement;
    private nextBtnEl?: HTMLElement;
    private favBtnEl?: HTMLButtonElement;

    // 全局事件解绑器列表
    private readonly disposers: (() => void)[] = [];

    public constructor() {
        this.initDom();
    }

    /**
     * 初始化灯箱全屏 DOM 骨架与全局监听。
     */
    private initDom(): void {
        if (typeof document === 'undefined') {
            return;
        }

        // 1. 全屏遮罩
        const backdrop = document.createElement('div');
        backdrop.className = 'da-lightbox-backdrop';
        backdrop.style.display = 'none';

        // 2. 交互舞台
        const stage = document.createElement('div');
        stage.className = 'da-lightbox-stage';

        const wrapper = document.createElement('div');
        wrapper.className = 'da-lightbox-image-wrapper';

        const img = document.createElement('img');
        img.className = 'da-lightbox-img';
        img.alt = '图像全屏预览';

        wrapper.appendChild(img);
        stage.appendChild(wrapper);
        backdrop.appendChild(stage);

        // 3. 顶部信息与操作栏
        const header = document.createElement('div');
        header.className = 'da-lightbox-header';

        const info = document.createElement('div');
        info.className = 'da-lightbox-info';

        const counter = document.createElement('span');
        counter.className = 'da-lightbox-counter';
        counter.textContent = '1 / 1';

        const title = document.createElement('span');
        title.className = 'da-lightbox-title';

        info.appendChild(counter);
        info.appendChild(title);
        header.appendChild(info);

        const headerActions = document.createElement('div');
        headerActions.className = 'da-lightbox-header-actions';

        // 标星收藏按钮
        const favBtn = document.createElement('button');
        favBtn.type = 'button';
        favBtn.className = 'da-lightbox-btn';
        favBtn.title = '标星收藏';
        favBtn.innerHTML = '☆';
        favBtn.style.fontSize = '18px';
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.toggleCurrentFavorite();
        });
        headerActions.appendChild(favBtn);

        // 原图下载按钮
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'da-lightbox-btn';
        downloadBtn.title = '下载图片';
        downloadBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
        `;
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadCurrent();
        });
        headerActions.appendChild(downloadBtn);

        // 关闭预览按钮
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-lightbox-btn';
        closeBtn.title = '关闭预览 (Esc)';
        closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
        headerActions.appendChild(closeBtn);

        header.appendChild(headerActions);
        backdrop.appendChild(header);

        // 4. 左右翻页导航按钮
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'da-lightbox-nav da-lightbox-prev';
        prevBtn.title = '上一张 (左箭头)';
        prevBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
        `;
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prev();
        });
        backdrop.appendChild(prevBtn);

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'da-lightbox-nav da-lightbox-next';
        nextBtn.title = '下一张 (右箭头)';
        nextBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
        `;
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.next();
        });
        backdrop.appendChild(nextBtn);

        // 5. 底部悬浮控制胶囊
        const toolbar = document.createElement('div');
        toolbar.className = 'da-lightbox-toolbar';

        // 放大
        const zoomInBtn = document.createElement('button');
        zoomInBtn.type = 'button';
        zoomInBtn.className = 'da-lightbox-btn';
        zoomInBtn.title = '放大';
        zoomInBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="11" y1="8" x2="11" y2="14"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
        `;
        zoomInBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.adjustZoom(0.25);
        });
        toolbar.appendChild(zoomInBtn);

        // 缩小
        const zoomOutBtn = document.createElement('button');
        zoomOutBtn.type = 'button';
        zoomOutBtn.className = 'da-lightbox-btn';
        zoomOutBtn.title = '缩小';
        zoomOutBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
        `;
        zoomOutBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.adjustZoom(-0.25);
        });
        toolbar.appendChild(zoomOutBtn);

        const divider = document.createElement('div');
        divider.className = 'da-lightbox-divider';
        toolbar.appendChild(divider);

        // 1:1 复原
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'da-lightbox-btn';
        resetBtn.title = '1:1 适应重置';
        resetBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1 4 1 10 7 10"></polyline>
                <polyline points="23 20 23 14 17 14"></polyline>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
            </svg>
        `;
        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.resetTransform();
        });
        toolbar.appendChild(resetBtn);

        // 缩放百分比指示器
        const scaleText = document.createElement('span');
        scaleText.className = 'da-lightbox-scale-indicator';
        scaleText.textContent = '100%';
        toolbar.appendChild(scaleText);

        backdrop.appendChild(toolbar);

        // 6. 挂载到 body
        document.body.appendChild(backdrop);

        // 保存 DOM 引用
        this.backdropEl = backdrop;
        this.wrapperEl = wrapper;
        this.imgEl = img;
        this.counterEl = counter;
        this.titleEl = title;
        this.scaleTextEl = scaleText;
        this.prevBtnEl = prevBtn;
        this.nextBtnEl = nextBtn;
        this.favBtnEl = favBtn;

        // 7. 绑定拖拽与滚轮手势交互
        this.bindGestures(stage);

        // 8. 绑定键盘事件
        this.bindKeyboard();
    }

    /**
     * 绑定舞台鼠标拖拽平移与滚轮缩放事件。
     */
    private bindGestures(stage: HTMLElement): void {
        // 滚轮缩放
        stage.addEventListener('wheel', (e) => {
            if (!this.isOpenState) return;
            e.preventDefault();
            const step = e.deltaY < 0 ? 0.15 : -0.15;
            this.adjustZoom(step);
        }, { passive: false });

        // 双击还原
        stage.addEventListener('dblclick', (e) => {
            if (!this.isOpenState) return;
            e.stopPropagation();
            this.resetTransform();
        });

        // 拖拽起始
        stage.addEventListener('mousedown', (e) => {
            if (!this.isOpenState || e.button !== 0) return;
            this.isDragging = true;
            this.dragStartX = e.clientX - this.translateX;
            this.dragStartY = e.clientY - this.translateY;
            stage.classList.add('is-dragging');
        });

        // 全局拖拽移动与松开
        const onMouseMove = (e: MouseEvent) => {
            if (!this.isDragging) return;
            this.translateX = e.clientX - this.dragStartX;
            this.translateY = e.clientY - this.dragStartY;
            this.applyTransform();
        };

        const onMouseUp = () => {
            if (this.isDragging) {
                this.isDragging = false;
                stage.classList.remove('is-dragging');
            }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        this.disposers.push(() => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        });
    }

    /**
     * 绑定全局键盘操作（Esc 退出、方向键切图）。
     */
    private bindKeyboard(): void {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!this.isOpenState) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.prev();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.next();
            } else if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                this.adjustZoom(0.25);
            } else if (e.key === '-') {
                e.preventDefault();
                this.adjustZoom(-0.25);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        this.disposers.push(() => {
            window.removeEventListener('keydown', onKeyDown);
        });
    }

    /**
     * 应用当前舞台平移与缩放矩阵。
     */
    private applyTransform(): void {
        if (!this.wrapperEl) return;
        this.wrapperEl.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.zoom})`;
        if (this.scaleTextEl) {
            this.scaleTextEl.textContent = `${Math.round(this.zoom * 100)}%`;
        }
    }

    /**
     * 微调缩放倍率并限制在 [0.2, 5.0] 区间。
     */
    private adjustZoom(delta: number): void {
        this.zoom = Math.max(0.2, Math.min(5.0, this.zoom + delta));
        this.applyTransform();
    }

    /**
     * 复位平移与缩放至 1:1 默认视口。
     */
    private resetTransform(): void {
        this.zoom = 1.0;
        this.translateX = 0;
        this.translateY = 0;
        this.applyTransform();
    }

    /**
     * 打开全屏灯箱预览。
     *
     * @param imagePath 目标图像 URL
     * @param options 可选参数：图像 ID / 初始标星状态 / 标题，或多图路径列表
     */
    public open(
        imagePath?: string,
        options?: LightboxOpenOptions | string[]
    ): void {
        if (!imagePath && (!options || !Array.isArray(options) || options.length === 0)) {
            return;
        }

        let itemsToOpen: LightboxItem[] = [];

        if (Array.isArray(options)) {
            itemsToOpen = options.map((url) => ({ url }));
            const foundIdx = imagePath ? options.indexOf(imagePath) : 0;
            this.openItems(itemsToOpen, Math.max(0, foundIdx));
            return;
        }

        const opt = (options as LightboxOpenOptions) || {};
        itemsToOpen = [{
            url: imagePath || '',
            imageId: opt.imageId,
            favorited: opt.favorited,
            title: opt.title,
        }];

        this.openItems(itemsToOpen, 0);
    }

    /**
     * 基于完整条目列表打开画廊灯箱。
     *
     * @param items 图像条目列表
     * @param startIndex 起始聚焦索引
     */
    public openItems(items: LightboxItem[], startIndex = 0): void {
        if (!items || items.length === 0) {
            return;
        }

        this.items = [...items];
        this.currentIndex = Math.max(0, Math.min(startIndex, this.items.length - 1));
        this.isOpenState = true;

        if (this.backdropEl) {
            if (!this.backdropEl.parentNode && typeof document !== 'undefined') {
                document.body.appendChild(this.backdropEl);
            }
            this.backdropEl.style.display = 'flex';
        }

        this.renderCurrentItem();
        this.resetTransform();
    }

    /**
     * 渲染当前聚焦的画廊条目。
     */
    private renderCurrentItem(): void {
        const item = this.items[this.currentIndex];
        if (!item) return;

        if (this.imgEl) {
            this.imgEl.src = item.url;
        }

        const total = this.items.length;
        if (this.counterEl) {
            this.counterEl.textContent = `${this.currentIndex + 1} / ${total}`;
            this.counterEl.style.display = total > 1 ? 'inline-block' : 'none';
        }

        if (this.titleEl) {
            this.titleEl.textContent = item.title || '';
            this.titleEl.title = item.title || '';
        }

        // 更新翻页按钮可用状态
        if (this.prevBtnEl) {
            this.prevBtnEl.style.display = total > 1 ? 'flex' : 'none';
            this.prevBtnEl.classList.toggle('is-disabled', this.currentIndex <= 0);
        }
        if (this.nextBtnEl) {
            this.nextBtnEl.style.display = total > 1 ? 'flex' : 'none';
            this.nextBtnEl.classList.toggle('is-disabled', this.currentIndex >= total - 1);
        }

        // 更新标星收藏按钮状态
        this.updateFavButtonState(item);
    }

    /**
     * 更新标星收藏按钮视觉呈现。
     */
    private updateFavButtonState(item: LightboxItem): void {
        if (!this.favBtnEl) return;

        // 若当前条目无 imageId，禁用或隐藏收藏按钮
        if (!item.imageId) {
            this.favBtnEl.style.display = 'none';
            return;
        }

        this.favBtnEl.style.display = 'flex';
        const isFav = Boolean(item.favorited);
        this.favBtnEl.innerHTML = isFav ? '★' : '☆';
        this.favBtnEl.style.color = isFav ? 'var(--da-primary, #ffaa00)' : 'var(--da-text-secondary, #ddd)';
        this.favBtnEl.title = isFav ? '取消标星收藏' : '标星收藏';
    }

    /**
     * 切换当前展示图像的标星收藏状态。
     */
    public async toggleCurrentFavorite(): Promise<boolean> {
        const item = this.items[this.currentIndex];
        if (!item || !item.imageId) {
            Toast.info('当前图像无唯一标识，无法进行标星收藏');
            return false;
        }

        try {
            const newFav = await imageStorage.toggleFavorite(item.imageId);
            item.favorited = newFav;
            this.updateFavButtonState(item);

            if (newFav) {
                Toast.success('已加入标星收藏 ★');
            } else {
                Toast.info('已取消标星收藏 ☆');
            }
            return newFav;
        } catch (err) {
            logger.error('切换图像标星收藏异常:', err);
            Toast.error('操作失败，请重试');
            return false;
        }
    }

    /**
     * 触发下载当前大图。
     */
    private downloadCurrent(): void {
        const item = this.items[this.currentIndex];
        if (!item || !item.url) return;

        try {
            const a = document.createElement('a');
            a.href = item.url;
            a.download = `st_draw_${item.imageId || Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            Toast.success('已开始下载原图');
        } catch (err) {
            logger.error('下载大图异常:', err);
            Toast.error('下载失败，请检查网络或图片资源');
        }
    }

    /**
     * 切换查看上一张图像。
     */
    public prev(): void {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.renderCurrentItem();
            this.resetTransform();
        }
    }

    /**
     * 切换查看下一张图像。
     */
    public next(): void {
        if (this.currentIndex < this.items.length - 1) {
            this.currentIndex++;
            this.renderCurrentItem();
            this.resetTransform();
        }
    }

    /**
     * 关闭全屏预览。
     */
    public close(): void {
        this.isOpenState = false;
        if (this.backdropEl) {
            this.backdropEl.style.display = 'none';
        }
        this.resetTransform();
    }

    /**
     * 查询灯箱当前是否正处于打开展示状态。
     */
    public isOpen(): boolean {
        return this.isOpenState;
    }

    /**
     * 销毁灯箱并释放所有事件监听与 DOM 节点。
     */
    public dispose(): void {
        this.close();
        for (const disposer of this.disposers) {
            try {
                disposer();
            } catch {
                // 忽略注销时的异常
            }
        }
        this.disposers.length = 0;

        if (this.backdropEl && this.backdropEl.parentNode) {
            this.backdropEl.parentNode.removeChild(this.backdropEl);
        }
        this.backdropEl = undefined;
    }
}

/** 全局默认单例大图灯箱组件 */
export const lightboxModal = new LightboxModal();
