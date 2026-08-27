/**
 * @module ui/controls/form-renderer
 * @description 声明式表单渲染引擎 (FormRenderer)
 * 将表单配置从命令式的 DOM 创建解耦为纯数据 Schema 结构，自动衔接 FormBinder 实现数据与视图双向响应。
 * 支持 fromStore/toStore 值映射转换，以及 keyPath 嵌套对象路径绑定。
 */
import { ObservableStore } from '../../core/state/store';
import { IDisposable } from '../../core/foundation/disposable';
import { FormBinder } from '../foundation/form-binder';
import { SelectOptionItem } from './controls';
export type FormFieldType = 'toggle' | 'select' | 'input' | 'number' | 'slider' | 'color' | 'custom' | 'component';
export interface FormRowSchema<TState extends object> {
    /** 绑定的 Store 属性键（与 keyPath 互斥） */
    key?: keyof TState;
    /** 表单项类型 */
    type: FormFieldType;
    /** 主标签名称 */
    label: string;
    /** 帮助说明气泡提示文本 */
    helpTooltip?: string;
    /** 下拉框选项列表 (type === 'select') */
    options?: SelectOptionItem[];
    /** 数值范围最小值 (type === 'number' | 'slider') */
    min?: number;
    /** 数值范围最大值 (type === 'number' | 'slider') */
    max?: number;
    /** 步长 */
    step?: number;
    /** 单位徽标 (如 'px', '%', 's') */
    unit?: string;
    /** 占位提示符 */
    placeholder?: string;
    /** 是否固定 180px 宽度 */
    fixedWidth?: boolean;
    /** 自定义输入控件装配器 (type === 'custom') */
    renderCustom?: (container: HTMLElement, binder: FormBinder<TState>) => HTMLElement;
    /** 动态显隐条件谓词 */
    visibleWhen?: (state: TState) => boolean;
    /** 额外自定义变更钩子（在值写入 Store 之后触发） */
    onChangeHook?: (val: any, state: TState) => void;
    /**
     * Store → UI 值映射函数（读取时转换）
     *
     * 用于 Store 中存储的单位与 UI 显示单位不一致的场景。
     * 示例：`(v) => Math.round(v / 1000)`（ms → 秒）
     * 仅在 `key` 或 `keyPath` 存在时生效。
     */
    fromStore?: (storeValue: any) => any;
    /**
     * UI → Store 值映射函数（写入时转换）
     *
     * 用于将 UI 控件值转换回 Store 存储格式。
     * 示例：`(v) => v * 1000`（秒 → ms）
     * 仅在 `key` 或 `keyPath` 存在时生效。
     */
    toStore?: (uiValue: any) => any;
    /**
     * 嵌套对象路径绑定，格式 `['imageDisplay', 'align'] as const`
     *
     * 与 `key` 互斥，不可同时使用。
     * 写入时做浅合并：`store.set(keyPath[0], { ...existing, [keyPath[1]]: val })`
     * 订阅时监听 `keyPath[0]` 的整体变更，从中提取 `keyPath[1]` 字段同步 UI。
     */
    keyPath?: readonly [keyof TState, string];
}
export interface SectionCardSchema<TState extends object> {
    /** 卡片标题 */
    title: string;
    /** 卡片概述描述 */
    description?: string;
    /** 是否可折叠 */
    collapsible?: boolean;
    /** 默认是否展开 */
    defaultOpen?: boolean;
    /** 标题栏右侧自定义动作组件 */
    headerExtra?: (binder: FormBinder<TState>) => HTMLElement;
    /** 卡片内部包含的表单行列表 */
    rows: FormRowSchema<TState>[];
}
/**
 * 声明式表单渲染引擎
 *
 * @description 通过 Schema 声明驱动 UI 渲染，内置 fromStore/toStore/keyPath 支持，
 * 消除视图层中手动 DOM 绕路。
 */
export declare class FormRenderer<TState extends object> implements IDisposable {
    private readonly _store;
    private readonly _binder;
    private readonly _disposables;
    constructor(store: ObservableStore<TState>);
    get binder(): FormBinder<TState>;
    /**
     * 根据卡片 Schema 渲染标准 SectionCard
     *
     * @param schema 卡片配置描述对象
     * @returns 渲染完成的卡片 DOM 节点
     */
    renderCard(schema: SectionCardSchema<TState>): HTMLElement;
    /**
     * 根据单行 Schema 渲染标准 FormRow
     *
     * @param schema 表单行配置描述对象
     * @returns 渲染完成的行 DOM 节点
     */
    renderRow(schema: FormRowSchema<TState>): HTMLElement;
    /**
     * 销毁渲染器持有的所有响应式订阅与绑定
     */
    dispose(): void;
    /**
     * 从 Store 读取初始值，支持 key / keyPath 两种模式，并应用 fromStore 转换。
     *
     * @param schema 表单行 Schema
     * @param state 当前 Store 快照
     * @returns 经 fromStore 转换后的 UI 显示值
     */
    private _readVal;
    /**
     * 将 UI 控件值写入 Store，支持 key / keyPath 两种模式，并应用 toStore 转换。
     * 写入后若存在 onChangeHook，则随即触发。
     *
     * @param schema 表单行 Schema
     * @param uiValue UI 控件输出的原始值
     */
    private _writeVal;
    /**
     * 订阅 Store 中对应 key/keyPath 的变更，将新值同步到 UI 回调。
     * 无 key/keyPath 时（纯触发型）不订阅，避免空订阅。
     *
     * @param schema 表单行 Schema
     * @param updateUI UI 更新回调，接收经 fromStore 转换后的值
     */
    private _subscribeToStore;
}
//# sourceMappingURL=form-renderer.d.ts.map