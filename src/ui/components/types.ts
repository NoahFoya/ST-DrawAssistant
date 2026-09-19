/**
 * ST-DrawAssistant UI 原子控件基础类型定义。
 *
 * @remarks
 * 声明所有表单原子控件必须遵循的通用接口，包括元素获取、数值存取、
 * 禁用状态切换与资源销毁生命周期规范。
 */

/** 通用 UI 视图组件基础接口定义 */
export interface UIComponent {
    /** 组件根 DOM 节点 */
    readonly element: HTMLElement;
    /** 释放组件占用的 DOM 监听器与引用 */
    dispose(): void;
}

/** 控件数据设值配置选项 */
export interface SetValueOptions {
    /** 是否静默更新，不触发 change 回调 */
    silent?: boolean;
    /** 是否显式触发 change 回调 */
    triggerChange?: boolean;
}

/**
 * 表单输入控件操作句柄接口。
 *
 * @remarks
 * 规定输入控件的基础数据存取、可用性控制与脏状态响应接口。
 */
export interface IControlHandle<T = unknown> extends UIComponent {
    /** 获取当前控件数据值 */
    getValue(): T;
    /**
     * 设置当前控件数据值
     * @param value 目标数据值
     * @param options 设值配置选项
     */
    setValue(value: T, options?: SetValueOptions): void;
    /**
     * 设置控件可用性
     * @param disabled 是否禁用
     */
    setDisabled(disabled: boolean): void;
    /**
     * 设置脏状态指示 (针对方案管理器)
     * @param isDirty 是否标记为脏状态
     */
    setDirty?(isDirty: boolean): void;
}

/** 表单组件操作句柄类型别名 */
export type BaseComponent<T = unknown> = IControlHandle<T>;

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
export interface ButtonComponent extends UIComponent {
    readonly element: HTMLButtonElement;
    setText(text: string): void;
    setLoading(loading: boolean): void;
    setDisabled(disabled: boolean): void;
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
    control: UIComponent | HTMLElement;
    slotWidth?: FormSlotWidth;
    layout?: 'horizontal' | 'stacked';
    disabled?: boolean;
    className?: string;
}

/** 表单行组件操作接口 */
export interface FormFieldComponent extends UIComponent {
    readonly element: HTMLDivElement;
    readonly control: UIComponent | HTMLElement;
    getValue(): unknown;
    setValue(value: unknown, options?: SetValueOptions): void;
    setDisabled(disabled: boolean): void;
    setVisible(visible: boolean): void;
}
