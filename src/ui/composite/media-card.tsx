/**
 * 本地图库媒体卡片组件 (MediaCard)。
 *
 * @remarks
 * 基于 Preact JSX 呈现本地图库单张图像卡片与生成状态：
 * 1. 状态展示：generating（生成中耗时提示）、ready（图片展示）、failed（失败提示与重试按钮）；
 * 2. 图像加载容错：监听 onError 事件，先回调上层恢复处理器，失败时切换为失败重试状态；
 * 3. 交互响应：支持多选模式勾选、点击预览、查看元信息、收藏、复制/下载与拖拽分享。
 */

import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { imageStorage } from '../../store/image-storage';
import { attachImageDragFile, copyImageBlobToClipboard } from '../../util/browser-io';
import { renderIcon } from '../components/icons';
import { Toast } from '../feedback/toast';

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

/** 媒体卡片组件属性 */
export interface MediaCardProps {
    /** 关联的媒体数据项 */
    item: MediaCardItemData;
    /** 是否启用批量选择模式，默认 false */
    selectable?: boolean;
    /** 是否处于选中状态，默认 false */
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
    /** 图像加载异常时的自动恢复回调，返回 true 表示已调度替代地址 */
    onImageError?: (item: MediaCardItemData) => Promise<boolean> | boolean;
    /** 删除媒体卡片回调 */
    onDelete?: (item: MediaCardItemData) => void;
    /** 附加 CSS 类名 */
    className?: string;
}

async function resolveMediaItemBlob(item: MediaCardItemData): Promise<Blob | null> {
    if (item.id) {
        const stored = await imageStorage.getImageBlob(item.id);
        if (stored && stored.size > 0) return stored;
    }
    if (item.url) {
        const res = await fetch(item.url);
        if (res.ok) return await res.blob();
    }
    return null;
}

export function MediaCard(props: MediaCardProps): VNode {
    const [selectedState, setSelectedState] = useState(Boolean(props.selected));
    const [favOverride, setFavOverride] = useState<boolean | null>(null);
    const [failedOverride, setFailedOverride] = useState<string | null>(null);

    const imgRef = useRef<HTMLImageElement | null>(null);
    const mountedRef = useRef(true);
    const prevSelectedRef = useRef(props.selected);
    const prevFavKeyRef = useRef(`${props.item.id}:${props.item.isFavorite}`);
    const prevStatusKeyRef = useRef(`${props.item.id}:${props.item.status}:${props.item.url}`);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (prevSelectedRef.current !== props.selected) {
            prevSelectedRef.current = props.selected;
            setSelectedState(Boolean(props.selected));
        }
    }, [props.selected]);

    useEffect(() => {
        const nextFavKey = `${props.item.id}:${props.item.isFavorite}`;
        if (prevFavKeyRef.current !== nextFavKey) {
            prevFavKeyRef.current = nextFavKey;
            setFavOverride(null);
        }
    }, [props.item.id, props.item.isFavorite]);

    useEffect(() => {
        const nextStatusKey = `${props.item.id}:${props.item.status}:${props.item.url}`;
        if (prevStatusKeyRef.current !== nextStatusKey) {
            prevStatusKeyRef.current = nextStatusKey;
            setFailedOverride(null);
        }
    }, [props.item.id, props.item.status, props.item.url]);

    const effectiveStatus: MediaCardStatus = failedOverride !== null ? 'failed' : props.item.status;
    const effectiveFav = favOverride !== null ? favOverride : Boolean(props.item.isFavorite);
    const effectiveItem: MediaCardItemData = {
        ...props.item,
        status: effectiveStatus,
        isFavorite: effectiveFav,
        ...(failedOverride !== null ? { errorMessage: failedOverride } : {}),
    };

    useEffect(() => {
        const imgEl = imgRef.current;
        if (effectiveStatus !== 'ready' || !props.item.url || !imgEl) {
            return;
        }
        return attachImageDragFile(
            imgEl,
            () => resolveMediaItemBlob(effectiveItem),
            `st_draw_${props.item.id.slice(0, 8)}`
        );
    }, [effectiveStatus, props.item.id, props.item.url]);

    const isSelectable = Boolean(props.selectable);
    const rootClass = [
        'da-media-card',
        `da-media-card--${effectiveStatus}`,
        isSelectable ? 'is-selectable' : '',
        selectedState ? 'is-selected' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    const handleCardClick = () => {
        if (isSelectable) {
            const next = !selectedState;
            setSelectedState(next);
            props.onSelect?.(next, effectiveItem);
        } else if (effectiveStatus === 'ready') {
            props.onPreview?.(effectiveItem);
        }
    };

    const handleImageError = () => {
        if (props.onImageError) {
            void Promise.resolve(props.onImageError(effectiveItem)).then((recovered) => {
                if (mountedRef.current && !recovered) {
                    setFailedOverride('图像资源无法载入');
                }
            });
            return;
        }
        setFailedOverride('图像资源无法载入');
    };

    return (
        <div
            className={rootClass}
            data-id={props.item.id}
            onClick={handleCardClick}
        >
            <div className="da-media-card__overlay">
                <button
                    type="button"
                    className={`da-media-card__action-btn da-media-card__action-btn--fav${effectiveFav ? ' is-active' : ''}`}
                    title={effectiveFav ? '取消收藏' : '加入收藏'}
                    dangerouslySetInnerHTML={{
                        __html: renderIcon(effectiveFav ? 'starFilled' : 'star', 14),
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        const nextFav = !effectiveFav;
                        setFavOverride(nextFav);
                        props.onToggleFavorite?.(nextFav, {
                            ...effectiveItem,
                            isFavorite: nextFav,
                        });
                    }}
                />
                {props.onInfo && (
                    <button
                        type="button"
                        className="da-media-card__action-btn da-media-card__action-btn--info"
                        title="查看生成元信息"
                        dangerouslySetInnerHTML={{ __html: renderIcon('info', 14) }}
                        onClick={(e) => {
                            e.stopPropagation();
                            props.onInfo?.(effectiveItem);
                        }}
                    />
                )}
                <button
                    type="button"
                    className="da-media-card__action-btn da-media-card__action-btn--copy"
                    title="复制图片"
                    dangerouslySetInnerHTML={{ __html: renderIcon('copy', 14) }}
                    onClick={async (e) => {
                        e.stopPropagation();
                        const blob = await resolveMediaItemBlob(effectiveItem);
                        if (!blob) {
                            Toast.error('获取图片数据失败');
                            return;
                        }
                        const ok = await copyImageBlobToClipboard(blob);
                        if (ok) {
                            Toast.success('已复制图片到剪贴板');
                        } else {
                            Toast.error('当前浏览器不支持复制图片，请使用右键或下载');
                        }
                    }}
                />
                <button
                    type="button"
                    className="da-media-card__action-btn da-media-card__action-btn--download"
                    title="下载图片"
                    dangerouslySetInnerHTML={{ __html: renderIcon('download', 14) }}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!props.item.url) return;
                        const a = document.createElement('a');
                        a.href = props.item.url;
                        a.download = `st_draw_${props.item.id.slice(0, 8)}_${Date.now()}.png`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                    }}
                />
            </div>

            {effectiveStatus === 'ready' && props.item.url && (
                <img
                    ref={imgRef}
                    className="da-media-card__thumb"
                    src={props.item.url}
                    alt="生成图片"
                    loading="lazy"
                    onError={handleImageError}
                />
            )}

            {effectiveStatus === 'generating' && (
                <div className="da-media-card__state-box">
                    <div className="da-spinner da-spinner--sm" />
                    <div className="da-media-card__state-text">
                        {props.item.durationSec !== undefined && props.item.durationSec > 0
                            ? `生成中 (${props.item.durationSec.toFixed(0)}s)...`
                            : '生成中...'}
                    </div>
                </div>
            )}

            {effectiveStatus === 'failed' && (
                <div className="da-media-card__state-box">
                    <div dangerouslySetInnerHTML={{ __html: renderIcon('warning', 22) }} />
                    <div className="da-media-card__state-text">
                        {effectiveItem.errorMessage || '生图失败'}
                    </div>
                    {(props.onRetry || props.onDelete) && (
                        <div className="da-media-card__error-actions">
                            {props.onRetry && (
                                <button
                                    type="button"
                                    className="da-btn da-btn--secondary da-btn--sm da-media-card__error-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        props.onRetry?.(effectiveItem);
                                    }}
                                >
                                    重试
                                </button>
                            )}
                            {props.onDelete && (
                                <button
                                    type="button"
                                    className="da-btn da-btn--danger da-btn--sm da-media-card__error-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        props.onDelete?.(effectiveItem);
                                    }}
                                >
                                    删除
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
