/**
 * 画廊媒体卡片组件 (MediaCard)。
 *
 * @remarks
 * 负责呈现画廊单张图像资产与其生成生命周期：
 * 1. 四态状态机分流：generating（骨架屏动效与耗时）、ready（图像展示）、failed（异常提示与重试）、deleted（已删除）；
 * 2. 属性驱动细粒度更新：根据状态、URL 与收藏状态的局部差异定向更新 DOM，避免整卡重绘引起的画面闪烁；
 * 3. 图像加载容错占位：为图像节点挂载 onerror 监听，在网络故障或资源不可用时切换为加载失败状态；
 * 4. 交互语义分流：批量选择模式下单选切换多选态；常规浏览模式下单选触发预览大图；快捷按钮精确拦截冒泡。
 */

import type { UIComponent } from '../types';

/** 媒体条目生命周期状态 */
export type MediaCardStatus = 'generating' | 'ready' | 'failed' | 'deleted';

/** 媒体卡片条目数据模型 */
export interface MediaCardItemData {
    /** 图像全局唯一标识符 */
    readonly id: string;
    /** 生图生命周期状态 */
    readonly status: MediaCardStatus;
    /** 图像呈现 URL（支持远程路径、Base64 或 Blob Object URL） */
    readonly url?: string;
    /** 是否已标星收藏 */
    readonly isFavorite?: boolean;
    /** 失败异常描述信息 */
    readonly errorMessage?: string;
    /** 生成耗时（秒） */
    readonly durationSec?: number;
}

/** 媒体卡片配置选项 */
export interface MediaCardOptions {
    /** 关联的媒体数据项 */
    item: MediaCardItemData;
    /** 是否启用批量选择模式，默认 false */
    selectable?: boolean;
    /** 初始是否处于选中状态，默认 false */
    selected?: boolean;
    /** 选中状态变更回调 */
    onSelect?: (selected: boolean, item: MediaCardItemData) => void;
    /** 点击卡片预览大图回调 */
    onPreview?: (item: MediaCardItemData) => void;
    /** 切换标星收藏回调 */
    onToggleFavorite?: (favorite: boolean, item: MediaCardItemData) => void;
    /** 失败卡片点击重试回调 */
    onRetry?: (item: MediaCardItemData) => void;
    /** 删除媒体卡片回调 */
    onDelete?: (item: MediaCardItemData) => void;
    /** 附加 CSS 类名 */
    className?: string;
}

/**
 * 画廊媒体卡片实现类。
 */
export class MediaCard implements UIComponent {
    public readonly element: HTMLElement;

    private item: MediaCardItemData;
    private isSelectable: boolean;
    private isSelectedState: boolean;

    private checkboxEl?: HTMLInputElement;
    private favBtnEl?: HTMLButtonElement;
    private deleteBtnEl?: HTMLButtonElement;
    private imgEl?: HTMLImageElement;
    private stateBoxEl?: HTMLElement;
    private durationTextEl?: HTMLElement;
    private errorTextEl?: HTMLElement;

    private readonly cardClickHandler: () => void;
    private readonly onSelectCallback?: (selected: boolean, item: MediaCardItemData) => void;
    private readonly onPreviewCallback?: (item: MediaCardItemData) => void;
    private readonly onToggleFavoriteCallback?: (favorite: boolean, item: MediaCardItemData) => void;
    private readonly onRetryCallback?: (item: MediaCardItemData) => void;
    private readonly onDeleteCallback?: (item: MediaCardItemData) => void;

    public constructor(options: MediaCardOptions) {
        this.item = { ...options.item };
        this.isSelectable = options.selectable ?? false;
        this.isSelectedState = options.selected ?? false;

        this.onSelectCallback = options.onSelect;
        this.onPreviewCallback = options.onPreview;
        this.onToggleFavoriteCallback = options.onToggleFavorite;
        this.onRetryCallback = options.onRetry;
        this.onDeleteCallback = options.onDelete;

        // 1. 创建卡片根容器
        this.element = document.createElement('div');
        this.element.className = 'da-media-card';
        this.element.setAttribute('data-id', this.item.id);
        if (options.className) {
            this.element.classList.add(options.className);
        }
        if (this.isSelectedState) {
            this.element.classList.add('is-selected');
        }

        // 2. 组装左上角复选框
        this.buildCheckbox();

        // 3. 组装右上角悬停删除按钮
        this.buildOverlay();

        // 4. 组装右下角可交互收藏星标
        this.buildFavButton();

        // 5. 渲染 4 态主体内容
        this.renderStateContent();

        // 6. 绑定卡片单击行为
        this.cardClickHandler = () => {
            if (this.isSelectable) {
                this.setSelected(!this.isSelectedState);
            } else if (this.item.status === 'ready') {
                this.onPreviewCallback?.(this.item);
            }
        };
        this.element.addEventListener('click', this.cardClickHandler);
    }

    /**
     * 属性驱动细粒度局部更新。
     *
     * @remarks
     * 区分状态切换、URL切替与属性更新：
     * 仅当 status 变化时才重新构建主体状态；
     * 当 status 未变且仅变更图片 URL 时直接更新 img.src；
     * 仅当 isFavorite 变化时局部切换星标样式，避免破坏图片 DOM 节点与画面闪烁。
     *
     * @param patch 待更新的数据增量
     */
    public update(patch: Partial<MediaCardItemData>): void {
        const prevStatus = this.item.status;
        const prevUrl = this.item.url;
        this.item = { ...this.item, ...patch };

        // 1. 状态改变时，重构主体状态 DOM
        if (patch.status !== undefined && patch.status !== prevStatus) {
            this.renderStateContent();
            return;
        }

        // 2. 状态未变但处于 ready 时，仅局部更新图像源
        if (this.item.status === 'ready' && patch.url !== undefined && patch.url !== prevUrl) {
            if (this.imgEl) {
                this.imgEl.src = patch.url;
            } else {
                this.renderReadyState();
            }
        }

        // 3. 状态未变但处于 generating 时，更新耗时文字
        if (this.item.status === 'generating' && patch.durationSec !== undefined && this.durationTextEl) {
            this.durationTextEl.textContent = `生成中 (${patch.durationSec.toFixed(0)}s)...`;
        }

        // 4. 状态未变但处于 failed 时，更新错误说明
        if (this.item.status === 'failed' && patch.errorMessage !== undefined && this.errorTextEl) {
            this.errorTextEl.textContent = patch.errorMessage || '生图失败';
        }

        // 5. 局部更新收藏星标按钮
        if (patch.isFavorite !== undefined && this.favBtnEl) {
            this.favBtnEl.textContent = this.item.isFavorite ? '★' : '☆';
            this.favBtnEl.classList.toggle('is-active', !!this.item.isFavorite);
            this.favBtnEl.title = this.item.isFavorite ? '取消标星收藏' : '加入标星收藏';
        }
    }

    /**
     * 设置多选勾选状态。
     *
     * @param selected 是否选中
     */
    public setSelected(selected: boolean): void {
        if (this.isSelectedState === selected) {
            return;
        }
        this.isSelectedState = selected;
        this.element.classList.toggle('is-selected', selected);
        if (this.checkboxEl) {
            this.checkboxEl.checked = selected;
        }
        this.onSelectCallback?.(selected, this.item);
    }

    /**
     * 获取当前选中状态。
     */
    public isSelected(): boolean {
        return this.isSelectedState;
    }

    /**
     * 设置是否开启多选模式。
     */
    public setSelectable(selectable: boolean): void {
        if (this.isSelectable === selectable) {
            return;
        }
        this.isSelectable = selectable;
        if (selectable) {
            if (!this.checkboxEl) {
                this.buildCheckbox();
            }
            if (this.checkboxEl) {
                this.checkboxEl.style.display = 'block';
            }
        } else {
            if (this.checkboxEl) {
                this.checkboxEl.style.display = 'none';
            }
        }
    }

    /**
     * 获取当前卡片条目完整数据快照。
     */
    public getData(): MediaCardItemData {
        return { ...this.item };
    }

    /**
     * 销毁组件，解绑事件并清理 DOM 引用。
     */
    public dispose(): void {
        this.element.removeEventListener('click', this.cardClickHandler);
        this.element.remove();
    }

    // ─────────────────────────────────────────────────────────────
    // 私有辅助方法
    // ─────────────────────────────────────────────────────────────

    private buildCheckbox(): void {
        if (!this.isSelectable && !this.checkboxEl) {
            return;
        }

        if (!this.checkboxEl) {
            this.checkboxEl = document.createElement('input');
            this.checkboxEl.type = 'checkbox';
            this.checkboxEl.className = 'da-media-card__checkbox';
            this.checkboxEl.checked = this.isSelectedState;

            this.checkboxEl.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            this.checkboxEl.addEventListener('change', () => {
                this.setSelected(this.checkboxEl!.checked);
            });

            this.element.appendChild(this.checkboxEl);
        }

        this.checkboxEl.style.display = this.isSelectable ? 'block' : 'none';
    }

    private buildOverlay(): void {
        if (!this.onDeleteCallback) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'da-media-card__overlay';

        this.deleteBtnEl = document.createElement('button');
        this.deleteBtnEl.type = 'button';
        this.deleteBtnEl.className = 'da-media-card__action-btn da-media-card__action-btn--danger';
        this.deleteBtnEl.title = '删除此图片';
        this.deleteBtnEl.textContent = '🗑';

        this.deleteBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onDeleteCallback?.(this.item);
        });

        overlay.appendChild(this.deleteBtnEl);
        this.element.appendChild(overlay);
    }

    private buildFavButton(): void {
        this.favBtnEl = document.createElement('button');
        this.favBtnEl.type = 'button';
        this.favBtnEl.className = 'da-media-card__fav-btn';
        const isFav = !!this.item.isFavorite;
        this.favBtnEl.textContent = isFav ? '★' : '☆';
        if (isFav) {
            this.favBtnEl.classList.add('is-active');
        }
        this.favBtnEl.title = isFav ? '取消标星收藏' : '加入标星收藏';

        this.favBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const nextFav = !this.item.isFavorite;
            this.update({ isFavorite: nextFav });
            this.onToggleFavoriteCallback?.(nextFav, this.item);
        });

        this.element.appendChild(this.favBtnEl);
    }

    private renderStateContent(): void {
        // 清理旧主体 DOM 节点
        this.imgEl?.remove();
        this.imgEl = undefined;
        this.stateBoxEl?.remove();
        this.stateBoxEl = undefined;
        this.durationTextEl = undefined;
        this.errorTextEl = undefined;

        this.element.classList.remove(
            'da-media-card--generating',
            'da-media-card--ready',
            'da-media-card--failed',
            'da-media-card--deleted'
        );
        this.element.classList.add(`da-media-card--${this.item.status}`);

        switch (this.item.status) {
            case 'ready':
                this.renderReadyState();
                break;
            case 'generating':
                this.renderGeneratingState();
                break;
            case 'failed':
                this.renderFailedState();
                break;
            case 'deleted':
                this.renderDeletedState();
                break;
        }
    }

    private renderReadyState(): void {
        if (!this.item.url) return;

        this.imgEl = document.createElement('img');
        this.imgEl.className = 'da-media-card__thumb';
        this.imgEl.src = this.item.url;
        this.imgEl.alt = '生图资产';
        this.imgEl.loading = 'lazy';

        // 图像加载异常时切换为加载失败重试状态
        this.imgEl.addEventListener('error', () => {
            this.update({
                status: 'failed',
                errorMessage: '图像资源无法载入',
            });
        });

        this.element.appendChild(this.imgEl);
    }

    private renderGeneratingState(): void {
        this.stateBoxEl = document.createElement('div');
        this.stateBoxEl.className = 'da-media-card__state-box';

        const spinner = document.createElement('div');
        spinner.className = 'da-spinner da-spinner--sm';

        this.durationTextEl = document.createElement('div');
        this.durationTextEl.className = 'da-media-card__state-text';
        this.durationTextEl.textContent = this.item.durationSec
            ? `生成中 (${this.item.durationSec.toFixed(0)}s)...`
            : '生成中...';

        this.stateBoxEl.appendChild(spinner);
        this.stateBoxEl.appendChild(this.durationTextEl);
        this.element.appendChild(this.stateBoxEl);
    }

    private renderFailedState(): void {
        this.stateBoxEl = document.createElement('div');
        this.stateBoxEl.className = 'da-media-card__state-box';

        const icon = document.createElement('div');
        icon.textContent = '⚠️';
        icon.style.fontSize = '20px';

        this.errorTextEl = document.createElement('div');
        this.errorTextEl.className = 'da-media-card__state-text';
        this.errorTextEl.textContent = this.item.errorMessage || '生图失败';

        this.stateBoxEl.appendChild(icon);
        this.stateBoxEl.appendChild(this.errorTextEl);

        if (this.onRetryCallback) {
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'da-btn da-btn--secondary da-btn--sm';
            retryBtn.style.padding = '2px 8px';
            retryBtn.style.fontSize = '10px';
            retryBtn.textContent = '↺ 重试';

            retryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onRetryCallback?.(this.item);
            });

            this.stateBoxEl.appendChild(retryBtn);
        }

        this.element.appendChild(this.stateBoxEl);
    }

    private renderDeletedState(): void {
        this.stateBoxEl = document.createElement('div');
        this.stateBoxEl.className = 'da-media-card__state-box';

        const text = document.createElement('div');
        text.className = 'da-media-card__state-text';
        text.textContent = '已删除';

        this.stateBoxEl.appendChild(text);
        this.element.appendChild(this.stateBoxEl);
    }
}
