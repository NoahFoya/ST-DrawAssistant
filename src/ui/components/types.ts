/**
 * ST-DrawAssistant UI 原子控件基础类型定义。
 *
 * @remarks
 * 声明所有表单原子控件必须遵循的通用接口，包括元素获取、数值存取、
 * 禁用状态切换与资源销毁生命周期规范。
 */

/** 通用基础组件接口规范 */
export interface BaseComponent<T = unknown> {
    /** 组件根 DOM 节点 */
    readonly element: HTMLElement;
    /** 获取当前控件数据值 */
    getValue(): T;
    /**
     * 设置当前控件数据值
     * @param value 目标数据值
     * @param triggerChange 是否触发 change 回调 (默认 false)
     */
    setValue(value: T, triggerChange?: boolean): void;
    /**
     * 设置控件可用性
     * @param disabled 是否禁用
     */
    setDisabled(disabled: boolean): void;
    /** 释放组件占用的 DOM 监听器与引用 */
    dispose(): void;
}

/** 按钮变体类型 */
export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'danger' | 'success';

/** 按钮尺寸规范 */
export type ButtonSize = 'default' | 'sm';

/** 按钮创建配置选项 */
export interface ButtonOptions {
    text?: string;
    title?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    iconSvg?: string;
    disabled?: boolean;
    className?: string;
    onClick?: (event: MouseEvent) => void;
}

/** 按钮组件扩展接口 */
export interface ButtonComponent extends BaseComponent<void> {
    readonly element: HTMLButtonElement;
    setText(text: string): void;
    setLoading(loading: boolean): void;
}

/** 文本输入框变体尺寸与排版形式 */
export type TextInputVariant = 'default' | 'short' | 'center' | 'number' | 'num-short' | 'full';

/** 单行文本输入框配置选项 */
export interface TextInputOptions {
    type?: 'text' | 'password' | 'number';
    value?: string | number;
    placeholder?: string;
    variant?: TextInputVariant;
    readOnly?: boolean;
    disabled?: boolean;
    min?: number;
    max?: number;
    step?: number;
    maxLength?: number;
    className?: string;
    onChange?: (value: string) => void;
    onInput?: (value: string) => void;
}

/** 文本输入框组件扩展接口 */
export interface TextInputComponent extends BaseComponent<string> {
    readonly element: HTMLInputElement;
    markDirty(dirty: boolean): void;
    markInvalid(invalid: boolean, message?: string): void;
}

/** 多行文本域配置选项 */
export interface TextareaOptions {
    value?: string;
    placeholder?: string;
    rows?: number;
    readOnly?: boolean;
    disabled?: boolean;
    className?: string;
    onChange?: (value: string) => void;
    onInput?: (value: string) => void;
}

/** 多行文本域组件扩展接口 */
export interface TextareaComponent extends BaseComponent<string> {
    readonly element: HTMLTextAreaElement;
    markDirty(dirty: boolean): void;
    markInvalid(invalid: boolean, message?: string): void;
}

/** 单个选项描述 */
export interface SelectOptionItem<T extends string = string> {
    label: string;
    value: T;
    disabled?: boolean;
}

/** 选项分组描述 */
export interface SelectOptionGroup<T extends string = string> {
    groupLabel: string;
    options: SelectOptionItem<T>[];
}

/** 下拉选择器配置选项 */
export interface SelectOptions<T extends string = string> {
    value?: T;
    options: (SelectOptionItem<T> | SelectOptionGroup<T>)[];
    size?: 'default' | 'sm';
    disabled?: boolean;
    className?: string;
    onChange?: (value: T) => void;
}

/** 下拉选择器组件扩展接口 */
export interface SelectComponent<T extends string = string> extends BaseComponent<T> {
    readonly element: HTMLSelectElement;
    updateOptions(options: (SelectOptionItem<T> | SelectOptionGroup<T>)[]): void;
    markDirty(dirty: boolean): void;
    markInvalid(invalid: boolean, message?: string): void;
}

/** 开关切换配置选项 */
export interface ToggleOptions {
    checked?: boolean;
    disabled?: boolean;
    className?: string;
    onChange?: (checked: boolean) => void;
}

/** 开关切换组件扩展接口 */
export interface ToggleComponent extends BaseComponent<boolean> {
    readonly element: HTMLLabelElement;
    readonly inputElement: HTMLInputElement;
    markDirty(dirty: boolean): void;
}

/** 数值滑块配置选项 */
export interface SliderOptions {
    min: number;
    max: number;
    step?: number;
    value?: number;
    showInput?: boolean;
    disabled?: boolean;
    className?: string;
    onChange?: (value: number) => void;
    onInput?: (value: number) => void;
}

/** 数值滑块组件扩展接口 */
export interface SliderComponent extends BaseComponent<number> {
    readonly element: HTMLDivElement;
    readonly rangeElement: HTMLInputElement;
    readonly numberInputElement?: HTMLInputElement;
    markDirty(dirty: boolean): void;
}

/** 颜色选择器配置选项 */
export interface ColorPickerOptions {
    value?: string;
    disabled?: boolean;
    className?: string;
    onChange?: (hex: string) => void;
}

/** 颜色选择器组件扩展接口 */
export interface ColorPickerComponent extends BaseComponent<string> {
    readonly element: HTMLDivElement;
    readonly nativeInput: HTMLInputElement;
    readonly hexInput: HTMLInputElement;
    markDirty(dirty: boolean): void;
    markInvalid(invalid: boolean, message?: string): void;
}

/** 表单插槽宽度限制阶梯 */
export type FormSlotWidth = '80' | '120' | '240' | 'toggle' | 'full';

/** 表单行组件配置选项 */
export interface FormFieldOptions {
    label: string;
    description?: string;
    tooltip?: string;
    control: BaseComponent | HTMLElement;
    slotWidth?: FormSlotWidth;
    layout?: 'horizontal' | 'stacked';
    disabled?: boolean;
    className?: string;
}

/** 表单行组件扩展接口 */
export interface FormFieldComponent extends BaseComponent<unknown> {
    readonly element: HTMLDivElement;
    readonly control: BaseComponent | HTMLElement;
    setVisible(visible: boolean): void;
}
