/**
 * 本地图库媒体卡片组件 (MediaCard)。
 *
 * @remarks
 * 负责呈现本地图库单张图像卡片与生成状态：
 * 1. 状态展示：generating（生成中耗时提示）、ready（图片展示）、failed（失败提示与重试按钮）；
 * 2. 局部更新：根据状态、URL 与收藏状态的变更更新对应 DOM，避免整卡重绘；
 * 3. 图像加载容错：监听 onerror 事件，图片载入失败时切换为失败状态；
 * 4. 交互响应：支持多选模式下的勾选、常规模式下的预览大图，以及查看信息、收藏、重试和删除操作。
 */

import type { UIComponent } from '../types';
import { renderIcon } from '../components/icons';

/** 媒体条目生命周期状态 */
export type MediaCardStatus = 'generating' | 'ready' | 'failed';

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
    /** 点击卡片查看生成信息回调 */
    onInfo?: (item: MediaCardItemData) => void;
    /** 切换标星收藏回调 */
    onToggleFavorite?: (favorite: boolean, item: MediaCardItemData) => void;
    /** 失败卡片点击重试回调 */
    onRetry?: (item: MediaCardItemData) => void;
    /** 图像加载异常时的自动恢复回调，由上层视图模型控制恢复次数并返回是否已调度替代地址 */
    onImageError?: (item: MediaCardItemData) => Promise<boolean> | boolean;
    /** 删除媒体卡片回调 */
    onDelete?: (item: MediaCardItemData) => void;
    /** 附加 CSS 类名 */
    className?: string;
}

/**
 * 本地图库媒体卡片实现类。
 */
export class MediaCard implements UIComponent {
    public readonly element: HTMLElement;

    private item: MediaCardItemData;
    private isSelectable: boolean;
    private isSelectedState: boolean;

    private favBtnEl?: HTMLButtonElement;
    private downloadBtnEl?: HTMLButtonElement;
    private imgEl?: HTMLImageElement;
    private stateBoxEl?: HTMLElement;
    private durationTextEl?: HTMLElement;
    private errorTextEl?: HTMLElement;

    private readonly cardClickHandler: () => void;
    private readonly onSelectCallback?: (selected: boolean, item: MediaCardItemData) => void;
    private readonly onPreviewCallback?: (item: MediaCardItemData) => void;
    private readonly onInfoCallback?: (item: MediaCardItemData) => void;
    private readonly onToggleFavoriteCallback?: (favorite: boolean, item: MediaCardItemData) => void;
    private readonly onRetryCallback?: (item: MediaCardItemData) => void;
    private readonly onImageErrorCallback?: (item: MediaCardItemData) => Promise<boolean> | boolean;
    private readonly onDeleteCallback?: (item: MediaCardItemData) => void;

    public constructor(options: MediaCardOptions) {
        this.item = { ...options.item };
        this.isSelectable = options.selectable ?? false;
        this.isSelectedState = options.selected ?? false;

        this.onSelectCallback = options.onSelect;
        this.onPreviewCallback = options.onPreview;
        this.onInfoCallback = options.onInfo;
        this.onToggleFavoriteCallback = options.onToggleFavorite;
        this.onRetryCallback = options.onRetry;
        this.onImageErrorCallback = options.onImageError;
        this.onDeleteCallback = options.onDelete;

        // 1. 创建卡片根容器
        this.element = document.createElement('div');
        this.element.className = 'da-media-card';
        this.element.setAttribute('data-id', this.item.id);
        if (options.className) {
            this.element.classList.add(...options.className.trim().split(/\s+/).filter(Boolean));
        }
        if (this.isSelectedState) {
            this.element.classList.add('is-selected');
        }
        if (this.isSelectable) {
            this.element.classList.add('is-selectable');
        }

        // 2. 组装右上角统一悬浮操作栏（收藏、元信息、下载图片）
        this.buildOverlay();

        // 4. 渲染主体状态内容
        this.renderStateContent();

        // 5. 绑定卡片单击行为
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
     * 局部更新卡片属性。
     *
     * @remarks
     * 状态变化时重新渲染主体；仅更新 URL 时直接修改 img.src；
     * 收藏状态变化时仅切换星标样式。
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
            const isFav = Boolean(this.item.isFavorite);
            this.favBtnEl.innerHTML = renderIcon(isFav ? 'starFilled' : 'star', 14);
            this.favBtnEl.classList.toggle('is-active', isFav);
            this.favBtnEl.title = isFav ? '取消收藏' : '加入收藏';
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
        this.element.classList.toggle('is-selectable', selectable);
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

    // 私有辅助方法

    private buildOverlay(): void {
        const overlay = document.createElement('div');
        overlay.className = 'da-media-card__overlay';

        // 1. 收藏按钮 (星标矢量图标)
        this.favBtnEl = document.createElement('button');
        this.favBtnEl.type = 'button';
        const isFav = Boolean(this.item.isFavorite);
        this.favBtnEl.className = `da-media-card__action-btn da-media-card__action-btn--fav${isFav ? ' is-active' : ''}`;
        this.favBtnEl.title = isFav ? '取消收藏' : '加入收藏';
        this.favBtnEl.innerHTML = renderIcon(isFav ? 'starFilled' : 'star', 14);
        this.favBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const nextFav = !this.item.isFavorite;
            this.update({ isFavorite: nextFav });
            this.onToggleFavoriteCallback?.(nextFav, this.item);
        });
        overlay.appendChild(this.favBtnEl);

        // 2. 元信息按钮 (! 矢量图标)
        if (this.onInfoCallback) {
            const infoBtn = document.createElement('button');
            infoBtn.type = 'button';
            infoBtn.className = 'da-media-card__action-btn da-media-card__action-btn--info';
            infoBtn.title = '查看生成元信息';
            infoBtn.innerHTML = renderIcon('info', 14);
            infoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onInfoCallback?.(this.item);
            });
            overlay.appendChild(infoBtn);
        }

        // 3. 下载图片按钮 (下箭头矢量图标)
        this.downloadBtnEl = document.createElement('button');
        this.downloadBtnEl.type = 'button';
        this.downloadBtnEl.className = 'da-media-card__action-btn da-media-card__action-btn--download';
        this.downloadBtnEl.title = '下载图片';
        this.downloadBtnEl.innerHTML = renderIcon('download', 14);
        this.downloadBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!this.item.url) {
                return;
            }
            const a = document.createElement('a');
            a.href = this.item.url;
            a.download = `st_draw_${this.item.id.slice(0, 8)}_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
        overlay.appendChild(this.downloadBtnEl);

        this.element.appendChild(overlay);
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
            'da-media-card--failed'
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
        }
    }

    private renderReadyState(): void {
        if (!this.item.url) return;

        this.imgEl = document.createElement('img');
        this.imgEl.className = 'da-media-card__thumb';
        this.imgEl.src = this.item.url;
        this.imgEl.alt = '生成图片';
        this.imgEl.loading = 'lazy';

        // 图像加载异常时委托上层视图模型尝试恢复，未恢复则切换为失败重试状态
        this.imgEl.addEventListener('error', () => {
            if (this.onImageErrorCallback) {
                void Promise.resolve(this.onImageErrorCallback(this.item)).then((recovered) => {
                    if (!recovered) {
                        this.update({
                            status: 'failed',
                            errorMessage: '图像资源无法载入',
                        });
                    }
                });
                return;
            }
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
        icon.innerHTML = renderIcon('warning', 22);

        this.errorTextEl = document.createElement('div');
        this.errorTextEl.className = 'da-media-card__state-text';
        this.errorTextEl.textContent = this.item.errorMessage || '生图失败';

        this.stateBoxEl.appendChild(icon);
        this.stateBoxEl.appendChild(this.errorTextEl);

        if (this.onRetryCallback || this.onDeleteCallback) {
            const actionRow = document.createElement('div');
            actionRow.className = 'da-media-card__error-actions';

            if (this.onRetryCallback) {
                const retryBtn = document.createElement('button');
                retryBtn.type = 'button';
                retryBtn.className = 'da-btn da-btn--secondary da-btn--sm da-media-card__error-btn';
                retryBtn.textContent = '重试';

                retryBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.onRetryCallback?.(this.item);
                });

                actionRow.appendChild(retryBtn);
            }

            if (this.onDeleteCallback) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'da-btn da-btn--danger da-btn--sm da-media-card__error-btn';
                delBtn.textContent = '删除';

                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.onDeleteCallback?.(this.item);
                });

                actionRow.appendChild(delBtn);
            }

            this.stateBoxEl.appendChild(actionRow);
        }

        this.element.appendChild(this.stateBoxEl);
    }
}
