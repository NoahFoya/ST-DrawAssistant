/**
 * @module ui/components/controls
 * @description 扩展统一基础 UI 控件与渲染部件库 (Consolidated Controls)
 *
 * 核心职责：
 * - 表单行基础控件 (createFieldRow)
 * - 样式与类名 100% 对齐 styles/main.css (.da-section-card, .da-section-header, .da-section-desc, .da-toggle, .da-slider, .da-help-btn)
 * - 控件构建工厂 (ControlFactory 与 IControlFactory)
 */
export interface FormItemOptions<T> {
    label: string;
    description?: string;
    value: T;
    onChange: (newValue: T) => void;
    disabled?: boolean;
    helpTooltip?: string;
}
export interface FieldRowOptions {
    label: string;
    description?: string;
    helpTooltip?: string;
    headerAction?: HTMLElement | HTMLElement[];
    isBlock?: boolean;
    type?: 'text' | 'number' | 'password' | 'checkbox' | 'select' | 'textarea' | 'range' | string;
    value?: string | number | boolean;
    placeholder?: string;
    options?: Array<{
        label: string;
        value: string | number;
    }>;
    min?: number;
    max?: number;
    step?: number;
    control?: HTMLElement | HTMLElement[];
    className?: string;
    onChange?: (value: any) => void;
    [key: string]: any;
}
export type FieldRowResult = HTMLDivElement & {
    element: HTMLElement;
    input: HTMLElement;
    setValue: (val: string | number | boolean) => void;
};
/**
 * 创建标准的设置项表单行节点
 */
export declare function createFieldRow(options: FieldRowOptions): HTMLElement;
export interface IControlFactory {
    createSwitch(options: FormItemOptions<boolean>): HTMLElement;
    createToggle(options: FormItemOptions<boolean>): HTMLElement;
    createSlider(options: FormItemOptions<number> & {
        min: number;
        max: number;
        step: number;
    }): HTMLElement;
    createSelect<V extends string>(options: FormItemOptions<V> & {
        items: Array<{
            value: V;
            label: string;
        }>;
    }): HTMLElement;
    createInput(options: FormItemOptions<string> & {
        placeholder?: string;
        type?: string;
    }): HTMLElement;
    createCard(title: string, contentBuilder: (body: HTMLElement) => void, desc?: string): HTMLElement;
}
/**
 * 标准原子控件工厂实现
 */
export declare class ControlFactory implements IControlFactory {
    createSwitch(options: FormItemOptions<boolean>): HTMLElement;
    createToggle(options: FormItemOptions<boolean>): HTMLElement;
    createSlider(options: FormItemOptions<number> & {
        min: number;
        max: number;
        step: number;
    }): HTMLElement;
    createSelect<V extends string>(options: FormItemOptions<V> & {
        items: Array<{
            value: V;
            label: string;
        }>;
    }): HTMLElement;
    createInput(options: FormItemOptions<string> & {
        placeholder?: string;
        type?: string;
    }): HTMLElement;
    createCard(title: string, contentBuilder: (body: HTMLElement) => void, desc?: string): HTMLElement;
}
/**
 * 渲染 IndexedDB 存储容量与配额占比指示条
 */
export declare function renderStorageBar(): HTMLElement;
export declare const defaultControlFactory: ControlFactory;
export * from './preset-toolbar';
//# sourceMappingURL=controls.d.ts.map