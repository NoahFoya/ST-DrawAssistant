/**
 * 全屏大图灯箱组件 (LightboxModal)。
 *
 * @remarks
 * 负责本地图库与楼层大图全屏预览、缩放平移、翻页与快捷操作：
 * 1. 全屏视窗：全屏暗色遮罩展示图片；
 * 2. 交互手势：支持滚轮缩放 (0.2x ~ 5.0x)、鼠标拖拽平移及双击复位；
 * 3. 统一顶栏矢量操作：收藏（星标 SVG）、元信息（`!` 感叹号 SVG）、编辑与重新生成（当具备楼层上下文时呈现，便于移动端唤出）、下载图片（下箭头 SVG）、关闭（叉号 SVG）；
 * 4. 键盘与生命周期：支持 Esc 退出、左右方向键翻页，销毁时自动注销全局监听。
 */

import type { Disposable } from '../types';
import { imageStorage } from '../../store/image-storage';
import { eventBus } from '../../util/event-bus';
import { renderIcon } from '../components/icons';
import { overlayStack } from '../framework/overlay-stack';
import { imageInfoModal } from './image-info-modal';
import { Toast } from '../feedback/toast';
import { logger } from '../../util/logger';

/** 灯箱条目数据接口 */
export interface LightboxItem {
    /** 图像展示 URL（Blob URL、远程路径或 Data URL） */
    readonly url: string;
    /** 本地资产唯一标识符，存在时支持标星收藏与元信息检视 */
    readonly imageId?: string;
    /** 图像标题或提示词简述 */
    readonly title?: string;
    /** 初始标星收藏状态 */
    favorited?: boolean;
    /** 收藏状态变更同步回调 */
    readonly onFavoriteChange?: (favorited: boolean) => void;
    /** 打开图片编辑面板回调（移动端辅助唤出入口） */
    readonly onEdit?: () => void;
}

/** 单图快捷打开灯箱视窗时的可选配置项 */
export interface LightboxOpenOptions {
    /** 本地资产唯一标识符，存在时可触发标星收藏联动 */
    imageId?: string;
    /** 初始标星收藏状态 */
    favorited?: boolean;
    /** 图像标题或提示词简述 */
    title?: string;
    /** 收藏状态变更同步回调 */
    onFavoriteChange?: (favorited: boolean) => void;
    /** 打开图片编辑面板回调 */
    onEdit?: () => void;
}

/**
 * 全屏大图灯箱视窗类。
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
    private infoBtnEl?: HTMLButtonElement;
    private editBtnEl?: HTMLButtonElement;

    // 全局事件解绑器与灯箱自建回退 URL 管理列表（独立于楼层会话 urlPool）
    private readonly disposers: (() => void)[] = [];
    private readonly failedFallbackIds = new Set<string>();
    private readonly allocatedFallbackUrls: string[] = [];

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
        backdrop.className = 'da-lightbox-backdrop da-modal-backdrop da-modal-backdrop--fullscreen st-da-root';
        backdrop.style.display = 'none';

        // 2. 图片展示区
        const stage = document.createElement('div');
        stage.className = 'da-lightbox-stage';

        const wrapper = document.createElement('div');
        wrapper.className = 'da-lightbox-image-wrapper';

        const img = document.createElement('img');
        img.className = 'da-lightbox-img';
        img.alt = '图像全屏预览';
        img.addEventListener('error', async () => {
            if (!this.isOpenState) return;
            const currentItem = this.items[this.currentIndex];
            if (currentItem && currentItem.imageId && !this.failedFallbackIds.has(currentItem.imageId)) {
                this.failedFallbackIds.add(currentItem.imageId);
                try {
                    const blob = await imageStorage.getImageBlob(currentItem.imageId);
                    if (blob && blob.size > 0) {
                        const fallbackUrl = URL.createObjectURL(blob);
                        this.allocatedFallbackUrls.push(fallbackUrl);
                        img.src = fallbackUrl;
                        return;
                    }
                } catch (err) {
                    logger.warn(`[LightboxModal] 本地 Blob 回退载入失败 (imageId: ${currentItem.imageId})`, err);
                }
            }
            Toast.error('图片资源无法载入');
        });

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

        // 1. 收藏按钮 (星标矢量图标)
        const favBtn = document.createElement('button');
        favBtn.type = 'button';
        favBtn.className = 'da-lightbox-btn';
        favBtn.title = '收藏';
        favBtn.innerHTML = renderIcon('star', 17);
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.toggleCurrentFavorite();
        });
        headerActions.appendChild(favBtn);

        // 2. 元信息按钮 (`!` 圆圈感叹号矢量图标)
        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'da-lightbox-btn';
        infoBtn.title = '查看元信息';
        infoBtn.innerHTML = renderIcon('info', 17);
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.openCurrentMetadata();
        });
        headerActions.appendChild(infoBtn);

        // 3. 原图下载按钮 (下箭头矢量图标)
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'da-lightbox-btn';
        downloadBtn.title = '下载图片';
        downloadBtn.innerHTML = renderIcon('download', 17);
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadCurrent();
        });
        headerActions.appendChild(downloadBtn);

        // 4. 图片操作按钮（当绑定了楼层编辑回调时展示，方便移动端用户从预览唤出编辑面板）
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'da-lightbox-btn';
        editBtn.title = '编辑与重新生成';
        editBtn.innerHTML = renderIcon('sliders', 17);
        editBtn.style.display = 'none';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = this.items[this.currentIndex];
            if (item?.onEdit) {
                const editCallback = item.onEdit;
                this.close();
                editCallback();
            }
        });
        headerActions.appendChild(editBtn);

        // 5. 关闭预览按钮
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-lightbox-btn';
        closeBtn.title = '关闭预览 (Esc)';
        closeBtn.innerHTML = renderIcon('close', 18);
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
        prevBtn.innerHTML = renderIcon('chevronLeft', 20);
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prev();
        });
        backdrop.appendChild(prevBtn);

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'da-lightbox-nav da-lightbox-next';
        nextBtn.title = '下一张 (右箭头)';
        nextBtn.innerHTML = renderIcon('chevronRight', 20);
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.next();
        });
        backdrop.appendChild(nextBtn);

        // 5. 底部悬浮控制胶囊
        const toolbar = document.createElement('div');
        toolbar.className = 'da-lightbox-toolbar';

        const zoomInBtn = document.createElement('button');
        zoomInBtn.type = 'button';
        zoomInBtn.className = 'da-lightbox-btn';
        zoomInBtn.title = '放大';
        zoomInBtn.innerHTML = renderIcon('zoomIn', 17);
        zoomInBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.adjustZoom(0.25);
        });
        toolbar.appendChild(zoomInBtn);

        const zoomOutBtn = document.createElement('button');
        zoomOutBtn.type = 'button';
        zoomOutBtn.className = 'da-lightbox-btn';
        zoomOutBtn.title = '缩小';
        zoomOutBtn.innerHTML = renderIcon('zoomOut', 17);
        zoomOutBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.adjustZoom(-0.25);
        });
        toolbar.appendChild(zoomOutBtn);

        const divider = document.createElement('div');
        divider.className = 'da-lightbox-divider';
        toolbar.appendChild(divider);

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'da-lightbox-btn';
        resetBtn.title = '重置视图 (1:1)';
        resetBtn.innerHTML = renderIcon('refresh', 17);
        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.resetTransform();
        });
        toolbar.appendChild(resetBtn);

        const scaleText = document.createElement('span');
        scaleText.className = 'da-lightbox-scale-indicator';
        scaleText.textContent = '100%';
        toolbar.appendChild(scaleText);

        backdrop.appendChild(toolbar);

        // 6. 保存 DOM 引用（保持游离态，在 openItems() 打开时动态挂至 document.body 末位以保证置顶层级）
        this.backdropEl = backdrop;
        this.wrapperEl = wrapper;
        this.imgEl = img;
        this.counterEl = counter;
        this.titleEl = title;
        this.scaleTextEl = scaleText;
        this.prevBtnEl = prevBtn;
        this.nextBtnEl = nextBtn;
        this.favBtnEl = favBtn;
        this.infoBtnEl = infoBtn;
        this.editBtnEl = editBtn;

        // 7. 绑定拖拽与滚轮手势交互
        this.bindGestures(stage);

        // 8. 绑定键盘事件
        this.bindKeyboard();

        // 9. 监听全局收藏状态变更并实时同步当前视窗按钮
        const unsubFav = eventBus.on('image:favorite-changed', ({ imageId, favorited }) => {
            const currentItem = this.items[this.currentIndex];
            if (currentItem && currentItem.imageId === imageId) {
                currentItem.favorited = favorited;
                this.updateFavButtonState(currentItem);
            }
        });
        this.disposers.push(unsubFav);
    }

    /**
     * 绑定鼠标拖拽平移与滚轮缩放事件。
     */
    private bindGestures(stage: HTMLElement): void {
        stage.addEventListener(
            'wheel',
            (e) => {
                if (!this.isOpenState) return;
                e.preventDefault();
                const step = e.deltaY < 0 ? 0.15 : -0.15;
                this.adjustZoom(step);
            },
            { passive: false }
        );

        stage.addEventListener('dblclick', (e) => {
            if (!this.isOpenState) return;
            e.stopPropagation();
            this.resetTransform();
        });

        // 统一 PointerEvent 手势：放大态拖拽平移，常态水平轻扫切图，双击/双触复原
        let activePointerId: number | null = null;
        let pointerStartX = 0;
        let pointerStartY = 0;
        let pointerStartAt = 0;
        let lastTouchTapAt = 0;

        const finishPointerGesture = (e?: PointerEvent) => {
            if (activePointerId === null) {
                return;
            }
            if (e && e.pointerId !== activePointerId) {
                return;
            }

            const startedAt = pointerStartAt;
            const startX = pointerStartX;
            const startY = pointerStartY;
            const pid = activePointerId;
            activePointerId = null;

            if (this.isDragging) {
                this.isDragging = false;
                stage.classList.remove('is-dragging');
            }
            if (stage.hasPointerCapture?.(pid)) {
                stage.releasePointerCapture?.(pid);
            }

            // 未放大状态下识别水平轻扫切图
            if (e && e.type === 'pointerup' && this.zoom <= 1.05 && this.items.length > 1) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                const elapsed = Date.now() - startedAt;
                if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.35 && elapsed < 500) {
                    if (dx > 0) {
                        this.prev();
                    } else {
                        this.next();
                    }
                }
            }
        };

        stage.addEventListener('pointerdown', (e) => {
            if (!this.isOpenState || (e.pointerType === 'mouse' && e.button !== 0)) return;
            if (e.pointerType === 'touch') {
                const now = Date.now();
                if (now - lastTouchTapAt < 280) {
                    lastTouchTapAt = 0;
                    this.resetTransform();
                    return;
                }
                lastTouchTapAt = now;
            }

            activePointerId = e.pointerId;
            pointerStartX = e.clientX;
            pointerStartY = e.clientY;
            pointerStartAt = Date.now();
            this.isDragging = this.zoom > 1.05;
            this.dragStartX = e.clientX - this.translateX;
            this.dragStartY = e.clientY - this.translateY;
            stage.setPointerCapture?.(e.pointerId);
            if (this.isDragging) {
                stage.classList.add('is-dragging');
            }
        });

        const onPointerMove = (e: PointerEvent) => {
            if (activePointerId === null || e.pointerId !== activePointerId) return;
            if (!this.isDragging && this.zoom <= 1.05) return;
            this.isDragging = true;
            stage.classList.add('is-dragging');
            this.translateX = e.clientX - this.dragStartX;
            this.translateY = e.clientY - this.dragStartY;
            this.applyTransform();
        };

        const onPointerEnd = (e: PointerEvent) => {
            finishPointerGesture(e);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerEnd);
        window.addEventListener('pointercancel', onPointerEnd);
        this.disposers.push(() => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerEnd);
            window.removeEventListener('pointercancel', onPointerEnd);
        });
    }

    /**
     * 绑定全屏方向键切图与缩放等快捷键盘操作（Escape 退出由全局浮层栈调度）。
     */
    private bindKeyboard(): void {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!this.isOpenState || !overlayStack.isTop('lightbox-modal')) return;
            if (e.key === 'ArrowLeft') {
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
     * 应用平移与缩放矩阵。
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
    public open(imagePath?: string, options?: LightboxOpenOptions | string[]): void {
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
        itemsToOpen = [
            {
                url: imagePath || '',
                imageId: opt.imageId,
                favorited: opt.favorited,
                title: opt.title,
                onFavoriteChange: opt.onFavoriteChange,
                onEdit: opt.onEdit,
            },
        ];

        this.openItems(itemsToOpen, 0);
    }

    /**
     * 基于完整条目列表打开大图灯箱。
     *
     * @param items 图像条目列表
     * @param startIndex 起始聚焦索引
     */
    public openItems(items: LightboxItem[], startIndex = 0): void {
        if (!items || items.length === 0) {
            return;
        }

        this.revokeAllocatedFallbackUrls();
        this.failedFallbackIds.clear();
        this.items = [...items];
        this.currentIndex = Math.max(0, Math.min(startIndex, this.items.length - 1));
        this.isOpenState = true;
        overlayStack.push('lightbox-modal', () => this.close());

        if (this.backdropEl && typeof document !== 'undefined') {
            // 每次打开均追加入 body 末位，与 SettingsModal / ImageInfoModal 同处正确绘制序
            document.body.appendChild(this.backdropEl);
            this.backdropEl.style.display = 'flex';
        }

        this.renderCurrentItem();
        this.resetTransform();
    }

    /**
     * 渲染当前聚焦的条目。
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

        if (this.prevBtnEl) {
            this.prevBtnEl.style.display = total > 1 ? 'flex' : 'none';
            this.prevBtnEl.classList.toggle('is-disabled', this.currentIndex <= 0);
        }
        if (this.nextBtnEl) {
            this.nextBtnEl.style.display = total > 1 ? 'flex' : 'none';
            this.nextBtnEl.classList.toggle('is-disabled', this.currentIndex >= total - 1);
        }

        if (this.infoBtnEl) {
            this.infoBtnEl.style.display = item.imageId ? 'flex' : 'none';
        }
        if (this.editBtnEl) {
            this.editBtnEl.style.display = item.onEdit ? 'flex' : 'none';
        }

        this.updateFavButtonState(item);
    }

    /**
     * 更新标星收藏按钮视觉呈现（统一使用矢量星标）。
     */
    private updateFavButtonState(item: LightboxItem): void {
        if (!this.favBtnEl) return;

        if (!item.imageId) {
            this.favBtnEl.style.display = 'none';
            return;
        }

        this.favBtnEl.style.display = 'flex';
        const isFav = Boolean(item.favorited);
        this.favBtnEl.innerHTML = renderIcon(isFav ? 'starFilled' : 'star', 17);
        this.favBtnEl.classList.toggle('is-active', isFav);
        this.favBtnEl.style.color = isFav ? 'var(--da-color-fav, #eab308)' : '';
        this.favBtnEl.title = isFav ? '取消收藏' : '加入收藏';
    }

    /**
     * 切换当前展示图像的标星收藏状态。
     */
    public async toggleCurrentFavorite(): Promise<boolean> {
        const item = this.items[this.currentIndex];
        if (!item || !item.imageId) {
            Toast.info('该图片未在本地图库注册，无法收藏');
            return false;
        }

        try {
            const newFav = await imageStorage.toggleFavorite(item.imageId);
            item.favorited = newFav;
            this.updateFavButtonState(item);
            item.onFavoriteChange?.(newFav);

            if (newFav) {
                Toast.success('已加入收藏');
            } else {
                Toast.info('已取消收藏');
            }
            return newFav;
        } catch (err) {
            logger.error('切换图像标星收藏异常:', err);
            Toast.error('操作失败，请重试');
            return false;
        }
    }

    /**
     * 打开当前图像的元信息弹窗。
     */
    private async openCurrentMetadata(): Promise<void> {
        const snapshotItems = [...this.items];
        const snapshotIndex = this.currentIndex;
        const item = snapshotItems[snapshotIndex];
        if (!item) return;

        const record = item.imageId ? await imageStorage.getImageRecord(item.imageId) : undefined;
        this.close();
        imageInfoModal.open({
            record,
            metadata: record?.metadata,
            imageUrl: item.url,
            onEdit: item.onEdit,
            onPreview: () => this.openItems(snapshotItems, snapshotIndex),
        });
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
        overlayStack.remove('lightbox-modal');
        if (this.backdropEl) {
            this.backdropEl.style.display = 'none';
            this.backdropEl.remove();
        }
        this.revokeAllocatedFallbackUrls();
        this.failedFallbackIds.clear();
        this.resetTransform();
    }

    private revokeAllocatedFallbackUrls(): void {
        for (const url of this.allocatedFallbackUrls) {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // 忽略释放异常
            }
        }
        this.allocatedFallbackUrls.length = 0;
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
