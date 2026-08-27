/**
 * @module ui/controls/field-row
 * @description 基础表单行纯净布局容器与防遮挡帮助说明气泡
 */
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
export declare function createFieldRow(options: FieldRowOptions): HTMLElement;
//# sourceMappingURL=field-row.d.ts.map