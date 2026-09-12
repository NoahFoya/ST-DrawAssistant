/**
 * 基础原子组件通用接口与类型声明
 * 遵循 tool-ui 规范，统一各组件的操作句柄 (Handle) 与基础参数。
 */

/** 组件通用操作句柄 */
export interface IControlHandle<T> {
    /** 根 DOM 元素 */
    readonly element: HTMLElement;
    /** 获取当前组件的值 */
    getValue(): T;
    /** 设置组件的值 */
    setValue(val: T): void;
    /** 设置控件启用/禁用状态 */
    setDisabled(disabled: boolean): void;
    /** 设置控件未保存修改状态 (呈现琥珀色微光 .is-dirty) */
    setDirty?(isDirty: boolean): void;
    /** 设置控件校验错误状态 (呈现红框告警 .is-invalid 与错误提示) */
    setError?(hasError: boolean, message?: string): void;
    /** 释放组件绑定的事件监听器与资源 */
    dispose?(): void;
}

/** 基础控件通用构造配置 */
export interface BaseControlOptions {
    id?: string;
    name?: string;
    className?: string;
    ariaLabel?: string;
    disabled?: boolean;
}

/** 下拉选择框条目模型 */
export interface SelectOptionItem {
    label: string;
    value: string;
    disabled?: boolean;
    group?: string;
}

/** 按钮语义化视觉变体 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/** 按钮尺寸规范 */
export type ButtonSize = 'normal' | 'sm';

/** 反馈提示语义化类型 */
export type FeedbackVariant = 'success' | 'warn' | 'error' | 'info' | 'muted';
