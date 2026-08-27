import { loadSettings } from '../../settings/manager';
import { escapeHtml } from '../../utils/html';

export interface FieldRowOptions {
    label: string;
    description?: string;
    helpTooltip?: string;
    control: HTMLElement | HTMLElement[];
    className?: string;
    isBlock?: boolean;
}

let activeTooltipBubble: HTMLElement | null = null;

/**
 * @module ui/components/field-row
 * @description 单行通用设置表单组件 (FieldRow)
 *
 * 职责：
 * - 统一配置表单行的 Label、Help Tooltip 与控件布局风格
 */

/**
 * 隐藏当前页面所有已弹出的浮动帮助气泡
 */
export function hideAllFieldTooltips(): void {
    if (activeTooltipBubble) {
        activeTooltipBubble.remove();
        activeTooltipBubble = null;
    }
}

/**
 * 创建符合设计系统规范且带有主题浮动帮助气泡的 FieldRow 节点
 * 气泡挂到 document.body 使用 fixed 定位，避免被卡片 overflow 截断
 */
export function createFieldRow(options: FieldRowOptions): HTMLElement {
    const rowEl = document.createElement('div');
    const blockClass = options.isBlock ? 'da-field-row--block' : '';
    rowEl.className = `da-field-row ${blockClass} ${options.className ?? ''}`.trim();

    // 1. 左侧标签与描述区
    const labelContainer = document.createElement('div');
    labelContainer.className = 'da-field-label';

    const labelHeader = document.createElement('div');
    labelHeader.style.display = 'flex';
    labelHeader.style.alignItems = 'center';
    labelHeader.style.gap = '6px';

    const labelText = document.createElement('span');
    labelText.className = 'da-label-text';
    labelText.textContent = options.label;
    labelHeader.appendChild(labelText);

    // 检查 showHelp 开关
    const settings = loadSettings();
    const showHelp = settings.showHelp ?? true;

    if (options.helpTooltip && showHelp) {
        const helpBtn = document.createElement('button');
        helpBtn.className = 'da-help-btn';
        helpBtn.title = '点击查看字段详细说明';
        helpBtn.innerHTML = '?';
        helpBtn.style.width = '17px';
        helpBtn.style.height = '17px';
        helpBtn.style.borderRadius = '50%';
        helpBtn.style.background = 'rgba(var(--da-accent-rgb, 0, 242, 254), 0.15)';
        helpBtn.style.border = '1px solid var(--da-accent-color, #00f2fe)';
        helpBtn.style.cursor = 'pointer';
        helpBtn.style.padding = '0';
        helpBtn.style.fontSize = '0.7rem';
        helpBtn.style.fontWeight = '700';
        helpBtn.style.color = 'var(--da-accent-color, #00f2fe)';
        helpBtn.style.display = 'inline-flex';
        helpBtn.style.alignItems = 'center';
        helpBtn.style.justifyContent = 'center';
        helpBtn.style.transition = 'all 0.18s ease';
        helpBtn.style.flexShrink = '0';

        // ─── 气泡挂到 document.body，使用 fixed 定位（避免被 overflow:hidden 卡片截断）
        let bubbleEl: HTMLElement | null = null;

        const createBubble = (): HTMLElement => {
            if (bubbleEl) return bubbleEl;
            bubbleEl = document.createElement('div');
            bubbleEl.className = 'da-field-help-bubble';
            bubbleEl.innerHTML = `
                <div style="font-weight:600; color:var(--da-accent-color, #00f2fe); margin-bottom:4px; font-size:0.88em;">说明</div>
                <div>${escapeHtml(options.helpTooltip!)}</div>
            `;
            return bubbleEl;
        };

        const positionBubble = (bubble: HTMLElement): void => {
            const rect = helpBtn.getBoundingClientRect();
            const bubbleRect = bubble.getBoundingClientRect();
            const gap = 10;
            const bubbleW = bubbleRect.width || 240;
            const bubbleH = bubbleRect.height || 80;

            let left = rect.right + gap;
            let top = rect.top + rect.height / 2 - bubbleH / 2;

            // 若右侧空间不足，改为左侧弹出
            if (left + bubbleW > window.innerWidth - 8) {
                left = rect.left - bubbleW - gap;
            }

            // 垂直边界修正
            if (top < 8) top = 8;
            if (top + bubbleH > window.innerHeight - 8) {
                top = window.innerHeight - bubbleH - 8;
            }

            bubble.style.left = `${left}px`;
            bubble.style.top = `${top}px`;
        };

        const showBubble = (): void => {
            hideAllFieldTooltips();
            helpBtn.style.opacity = '1';
            helpBtn.style.transform = 'scale(1.15)';
            const bubble = createBubble();
            // 先将气泡临时隐藏挂载，rAF 内用 getBoundingClientRect() 获取真实尺寸后再定位显示
            bubble.style.visibility = 'hidden';
            document.body.appendChild(bubble);
            activeTooltipBubble = bubble;
            requestAnimationFrame(() => {
                positionBubble(bubble);
                bubble.style.visibility = '';  // 定位完成后再显示，避免闪烁
            });
        };

        const hideBubble = (): void => {
            helpBtn.style.opacity = '0.8';
            helpBtn.style.transform = 'scale(1)';
            if (activeTooltipBubble) {
                activeTooltipBubble.remove();
                activeTooltipBubble = null;
            }
            bubbleEl = null;
        };

        helpBtn.addEventListener('mouseenter', () => showBubble());
        helpBtn.addEventListener('mouseleave', () => hideBubble());
        helpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeTooltipBubble) {
                hideBubble();
            } else {
                showBubble();
            }
        });

        labelHeader.appendChild(helpBtn);
    }

    labelContainer.appendChild(labelHeader);

    if (options.description) {
        const descText = document.createElement('span');
        descText.className = 'da-label-desc';
        descText.textContent = options.description;
        labelContainer.appendChild(descText);
    }

    // 2. 右侧控件区
    const controlContainer = document.createElement('div');
    controlContainer.className = 'da-field-control';

    if (Array.isArray(options.control)) {
        options.control.forEach(ctrl => controlContainer.appendChild(ctrl));
    } else {
        controlContainer.appendChild(options.control);
    }

    rowEl.appendChild(labelContainer);
    rowEl.appendChild(controlContainer);

    return rowEl;
}
