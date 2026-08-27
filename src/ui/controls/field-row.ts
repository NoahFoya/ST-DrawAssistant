/**
 * @module ui/controls/field-row
 * @description 基础表单行纯净布局容器与防遮挡帮助说明气泡
 */

import { OverlayHost } from '../foundation/overlay-host';

/**
 * 基础表单行布局配置项
 */
export interface FieldRowOptions {
    /** 表单项主标题 */
    label: string;
    /** 右侧承载的核心输入控件或组件 DOM 节点 */
    control: HTMLElement;
    /** 表单项次要说明文本 (建议仅用于极少大多行卡片) */
    description?: string;
    /** 详细帮助说明气泡文本 (提供时自动渲染 ❓ 按钮) */
    helpTooltip?: string;
    /** 标题栏右侧自定义动作插槽 (如【🔄 刷新】或【⚙️ 配置】按钮) */
    headerAction?: HTMLElement;
    /** 是否采用块级垂直排布布局 (默认 false 为经典左右两栏) */
    isBlock?: boolean;
    /** 自定义附加 CSS 类名 */
    className?: string;
}

/**
 * 创建标准的设置项表单行布局容器
 *
 * @param options 表单行布局与控件配置
 * @returns 标准的表单行 DOM 容器节点 (.da-field-row)
 */
export function createFieldRow(options: FieldRowOptions): HTMLElement {
    const isTextarea = options.control?.tagName === 'TEXTAREA' || options.control?.querySelector('textarea') !== null;
    const isBlock = options.isBlock ?? isTextarea;
    const row = document.createElement('div');
    const blockClass = isBlock ? 'da-field-row--block' : '';
    row.className = `da-field-row ${blockClass} ${options.className ?? ''}`.trim();

    // 1. 左侧说明与标题区
    const labelContainer = document.createElement('div');
    labelContainer.className = 'da-field-label';

    const labelHeader = document.createElement('div');
    labelHeader.className = options.headerAction
        ? 'da-field-label-header da-field-label-header--with-action'
        : 'da-field-label-header';

    const labelLeftGroup = document.createElement('div');
    labelLeftGroup.className = 'da-field-label-left';

    const labelText = document.createElement('span');
    labelText.className = 'da-label-text';
    labelText.textContent = options.label;
    labelLeftGroup.appendChild(labelText);

    // ❓ 详细说明帮助气泡逻辑 (委托给 OverlayHost 统一管理防遮挡与生命周期)
    if (options.helpTooltip) {
        const helpBtn = document.createElement('button');
        helpBtn.className = 'da-help-btn';
        helpBtn.title = '点击查看详细说明';
        helpBtn.textContent = '?';

        helpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            OverlayHost.getInstance().showHelpBubble(helpBtn, options.helpTooltip!);
        });

        labelLeftGroup.appendChild(helpBtn);
    }

    labelHeader.appendChild(labelLeftGroup);
    if (options.headerAction) {
        labelHeader.appendChild(options.headerAction);
    }
    labelContainer.appendChild(labelHeader);

    if (options.description) {
        const descEl = document.createElement('div');
        descEl.className = 'da-field-desc';
        descEl.textContent = options.description;
        labelContainer.appendChild(descEl);
    }

    row.appendChild(labelContainer);

    // 2. 右侧控件承载区
    const controlWrapper = document.createElement('div');
    controlWrapper.className = 'da-field-control';
    controlWrapper.appendChild(options.control);
    row.appendChild(controlWrapper);

    return row;
}
