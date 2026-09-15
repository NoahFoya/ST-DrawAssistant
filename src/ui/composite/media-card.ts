/**
 * 画廊正方形媒体卡片组件 (MediaCard)
 *
 * 功能：
 * 1. 提供 1:1 正方形等比缩略图与懒加载渲染；
 * 2. 支持多选复选框、收藏徽章展示与交互；
 * 3. 悬停展开操作浮层，支持原图预览、提示词复用、收藏切换与删除。
 *
 * Tips：
 * 1. 样式对齐 gallery.css 规范，卡片激活与选中时提供边框高亮；
 * 2. 内部事件精准冒泡拦截，点击复选框或快捷按钮不触发卡片全局预览。
 */

import type { MediaCardItemModel } from '@types';
import { createIconButton, IconButtonHandle } from '../components/button';

export interface MediaCardOptions {
    item: MediaCardItemModel;
    selectable?: boolean;
    selected?: boolean;
    onSelect?: (selected: boolean, item: MediaCardItemModel) => void;
    onPreview?: (item: MediaCardItemModel) => void;
    onReusePrompt?: (prompt: string, negativePrompt?: string) => void;
    onToggleFavorite?: (fav: boolean, item: MediaCardItemModel) => void;
    onDelete?: (item: MediaCardItemModel) => void;
    className?: string;
}

export interface MediaCardHandle {
    readonly element: HTMLElement;
    setSelected(selected: boolean): void;
    isSelected(): boolean;
    setFavorite(fav: boolean): void;
    getItem(): MediaCardItemModel;
    dispose(): void;
}

export function createMediaCard(options: MediaCardOptions): MediaCardHandle {
    const card = document.createElement('div');
    card.className = 'da-media-card';
    if (options.className) card.classList.add(options.className);

    let isSelected = options.selected ?? false;
    let isFavorite = options.item.isFavorite ?? false;

    if (isSelected) card.classList.add('is-selected');

    // 1. 缩略图片 (支持原生 loading="lazy")
    const img = document.createElement('img');
    img.className = 'da-media-card__thumb';
    img.src = options.item.url;
    img.alt = options.item.prompt ? options.item.prompt.slice(0, 50) : '生成图片';
    img.loading = 'lazy';
    card.appendChild(img);

    // 2. 多选复选框
    let checkbox: HTMLInputElement | null = null;
    if (options.selectable) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'da-media-card__checkbox';
        checkbox.checked = isSelected;

        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        checkbox.addEventListener('change', () => {
            isSelected = checkbox!.checked;
            card.classList.toggle('is-selected', isSelected);
            options.onSelect?.(isSelected, options.item);
        });

        card.appendChild(checkbox);
    }

    // 3. 收藏星标小圆点/徽标
    const favBadge = document.createElement('span');
    favBadge.className = 'da-media-card__fav-badge';
    favBadge.textContent = '★';
    favBadge.style.display = isFavorite ? 'flex' : 'none';
    card.appendChild(favBadge);

    // 4. 悬停半透明操作浮层
    const overlay = document.createElement('div');
    overlay.className = 'da-media-card__overlay';

    const buttons: IconButtonHandle[] = [];

    // 预览大图按钮
    if (options.onPreview) {
        const previewBtn = createIconButton({
            icon: 'eye',
            title: '查看大图与元数据',
            onClick: (e) => {
                e.stopPropagation();
                options.onPreview?.(options.item);
            }
        });
        buttons.push(previewBtn);
        overlay.appendChild(previewBtn.element);
    }

    // 复用提示词按钮
    if (options.onReusePrompt) {
        const reuseBtn = createIconButton({
            icon: 'copy',
            title: '一键复用正反向提示词',
            onClick: (e) => {
                e.stopPropagation();
                options.onReusePrompt?.(options.item.prompt, options.item.negativePrompt);
            }
        });
        buttons.push(reuseBtn);
        overlay.appendChild(reuseBtn.element);
    }

    // 收藏/取消收藏按钮
    if (options.onToggleFavorite) {
        const favBtn = createIconButton({
            icon: 'star',
            title: isFavorite ? '取消收藏' : '加入收藏',
            onClick: (e) => {
                e.stopPropagation();
                isFavorite = !isFavorite;
                favBadge.style.display = isFavorite ? 'flex' : 'none';
                favBtn.setTitle?.(isFavorite ? '取消收藏' : '加入收藏');
                options.onToggleFavorite?.(isFavorite, options.item);
            }
        });
        buttons.push(favBtn);
        overlay.appendChild(favBtn.element);
    }

    // 删除按钮
    if (options.onDelete) {
        const delBtn = createIconButton({
            icon: 'trash',
            variant: 'danger',
            title: '删除图片',
            onClick: (e) => {
                e.stopPropagation();
                options.onDelete?.(options.item);
            }
        });
        buttons.push(delBtn);
        overlay.appendChild(delBtn.element);
    }

    card.appendChild(overlay);

    // 单击卡片主体默认行为
    const onCardClick = () => {
        if (options.selectable && checkbox) {
            isSelected = !isSelected;
            checkbox.checked = isSelected;
            card.classList.toggle('is-selected', isSelected);
            options.onSelect?.(isSelected, options.item);
        } else if (options.onPreview) {
            options.onPreview(options.item);
        }
    };
    card.addEventListener('click', onCardClick);

    return {
        element: card,
        setSelected(selected: boolean): void {
            isSelected = selected;
            card.classList.toggle('is-selected', isSelected);
            if (checkbox) checkbox.checked = isSelected;
        },
        isSelected(): boolean {
            return isSelected;
        },
        setFavorite(fav: boolean): void {
            isFavorite = fav;
            favBadge.style.display = isFavorite ? 'flex' : 'none';
        },
        getItem(): MediaCardItemModel {
            return { ...options.item, isFavorite };
        },
        dispose(): void {
            card.removeEventListener('click', onCardClick);
            buttons.forEach((b) => b.dispose());
            card.remove();
        }
    };
}
