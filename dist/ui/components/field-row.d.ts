export interface FieldRowOptions {
    label: string;
    description?: string;
    helpTooltip?: string;
    control: HTMLElement | HTMLElement[];
    className?: string;
    isBlock?: boolean;
}
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
export declare function hideAllFieldTooltips(): void;
/**
 * 创建符合设计系统规范且带有主题浮动帮助气泡的 FieldRow 节点
 * 气泡挂到 document.body 使用 fixed 定位，避免被卡片 overflow 截断
 */
export declare function createFieldRow(options: FieldRowOptions): HTMLElement;
//# sourceMappingURL=field-row.d.ts.map