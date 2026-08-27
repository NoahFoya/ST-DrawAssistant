/**
 * @module ui/image-renderer
 * @description 图像 DOM 渲染与交互组件 (ImageRenderer)
 */

import { DrawAssistantSettings, ImageDisplayConfig } from '../core/state/store-types';
import { FeedbackService } from './feedback-service';

/**
 * 图像操作菜单交互回调接口
 */
export interface ImageActionCallbacks {
    /** 图像提示词文本 */
    promptText?: string;
    /** 触发局部重绘回调 */
    onInpaint?: () => void;
    /** 触发删除图像回调 */
    onDelete?: () => void;
}

/**
 * 将生成的图像 Blob 渲染到楼层消息插槽中，并绑定悬浮工具栏与大图预览
 *
 * @param containerSlot 目标图像挂载容器 DOM
 * @param blob 图像二进制数据
 * @param settings 全局配置项快照
 * @param callbacks 图像交互操作回调
 * @returns 渲染生成的 HTMLImageElement 实例
 */
export function renderImageToMessage(
    containerSlot: HTMLElement,
    blob: Blob,
    settings: DrawAssistantSettings,
    callbacks?: ImageActionCallbacks
): HTMLImageElement {
    containerSlot.innerHTML = '';
    const display: ImageDisplayConfig = settings.imageDisplay || {
        align: 'left',
        objectFit: 'contain',
        maxHeight: 0,
        maxWidthPct: 100,
        rounded: true
    };

    containerSlot.style.display = 'flex';
    containerSlot.style.width = '100%';
    if (display.align === 'center') {
        containerSlot.style.justifyContent = 'center';
    } else if (display.align === 'right') {
        containerSlot.style.justifyContent = 'flex-end';
    } else {
        containerSlot.style.justifyContent = 'flex-start';
    }

    const img = document.createElement('img');
    img.className = 'da-generated-img';
    img.style.objectFit = display.objectFit || 'contain';
    img.style.maxWidth = `${display.maxWidthPct || 100}%`;
    img.style.maxHeight = display.maxHeight && display.maxHeight > 0 ? `${display.maxHeight}px` : 'none';
    img.style.borderRadius = display.rounded ? '8px' : '0px';
    img.style.cursor = 'pointer';
    img.style.boxShadow = 'var(--da-shadow-sm)';

    const url = URL.createObjectURL(blob);
    img.src = url;

    // 单击打开全屏大图 Lightbox
    img.addEventListener('click', (e) => {
        e.stopPropagation();
        FeedbackService.lightbox(url);
    });

    // 右键 / 长按弹出操作菜单
    img.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const menu = document.createElement('div');
        menu.className = 'da-action-menu';
        menu.style.position = 'fixed';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.style.zIndex = '100150';
        menu.style.background = 'var(--da-bg-secondary)';
        menu.style.border = '1px solid var(--da-border-color)';
        menu.style.borderRadius = 'var(--da-radius-small, 8px)';
        menu.style.boxShadow = 'var(--da-shadow-md)';
        menu.style.padding = '6px';
        menu.style.display = 'flex';
        menu.style.flexDirection = 'column';
        menu.style.gap = '4px';

        const createMenuItem = (label: string, icon: string, action: () => void, isDanger = false) => {
            const item = document.createElement('button');
            item.className = `da-btn ${isDanger ? 'danger' : 'secondary'}`;
            item.style.justifyContent = 'flex-start';
            item.style.fontSize = '0.85em';
            item.style.padding = '6px 12px';
            item.innerHTML = `${icon} ${label}`;
            item.onclick = (ev) => {
                ev.stopPropagation();
                menu.remove();
                action();
            };
            return item;
        };

        menu.appendChild(createMenuItem('查看大图', '🔍', () => FeedbackService.lightbox(url)));

        if (callbacks?.onInpaint) {
            menu.appendChild(createMenuItem('局部重绘', '🎨', callbacks.onInpaint));
        }

        menu.appendChild(
            createMenuItem('下载原图', '💾', () => {
                const a = document.createElement('a');
                a.href = url;
                a.download = `ST_Draw_${Date.now()}.png`;
                a.click();
            })
        );

        if (callbacks?.onDelete) {
            menu.appendChild(createMenuItem('删除此图', '🗑️', callbacks.onDelete, true));
        }

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);

        document.body.appendChild(menu);
    });

    containerSlot.appendChild(img);
    return img;
}
