/**
 * UI 模块核心基础接口与类型定义。
 *
 * @remarks
 * 为 UI 系统确立统一生命周期管理、原子受控控件交互与页面选项卡装配基础规范。
 */

/**
 * 统一生命周期资源释放接口。
 */
export interface Disposable {
    /**
     * 释放组件持有的 DOM 监听、计时器或临时 Object URL 等外部资源。
     */
    dispose(): void;
}

/**
 * 通用 UI 视图组件基础接口定义。
 */
export interface UIComponent extends Disposable {
    /** 组件根 DOM 节点 */
    readonly element: HTMLElement;
}

/**
 * 控件数据设值配置选项。
 */
export interface SetValueOptions {
    /** 是否静默更新，不触发 change 回调 */
    silent?: boolean;
    /** 是否显式触发 change 回调 */
    triggerChange?: boolean;
}

/**
 * 控件值变更回调函数签名。
 */
export type ControlChangeCallback<T> = (value: T) => void;

/**
 * 纯受控原子控件通用操作句柄接口。
 *
 * @typeParam T 控件受控读写的数据类型。
 */
export interface IControlHandle<T = unknown> extends UIComponent {
    /** 获取当前输入或选中的值 */
    getValue(): T;

    /**
     * 设置控件值。
     * @param value 目标值
     * @param options 设值配置选项或是否触发已注册回调的布尔值
     */
    setValue(value: T, options?: boolean | SetValueOptions): void;

    /**
     * 设置禁用状态。
     * @param disabled 是否禁用控件交互
     */
    setDisabled(disabled: boolean): void;

    /**
     * 设置脏状态指示标记。
     * @param isDirty 是否标记为脏状态
     */
    setDirty?(isDirty: boolean): void;

    /**
     * 注册值变更监听回调。
     * @param callback 值变更时的回调函数
     */
    onChange?(callback: ControlChangeCallback<T>): void;
}

/**
 * 主设置面板选项卡视图接口。
 */
export interface SettingsView extends Disposable {
    /** 选项卡唯一标识 */
    readonly id: string;

    /** 选项卡显示名称 */
    readonly title: string;

    /** 视图根 DOM 元素 */
    readonly element: HTMLElement;

    /**
     * 选项卡激活时触发。
     * 用于从持久化配置拉取最新数据填充控件，并建立表单基准快照。
     */
    activate(): void;

    /**
     * 离开选项卡时触发。
     * 用于保存草稿、解除局部监听或释放临时展示资源。
     */
    deactivate(): void;
}
