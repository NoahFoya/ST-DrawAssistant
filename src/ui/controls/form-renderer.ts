/**
 * @module ui/controls/form-renderer
 * @description 声明式表单渲染引擎 (FormRenderer)
 * 将表单配置从命令式的 DOM 创建解耦为纯数据 Schema 结构，自动衔接 FormBinder 实现数据与视图双向响应。
 * 支持 fromStore/toStore 值映射转换，以及 keyPath 嵌套对象路径绑定。
 */

import { ObservableStore } from '../../core/state/store';
import { IDisposable, DisposableStore } from '../../core/foundation/disposable';
import { FormBinder } from '../foundation/form-binder';
import {
    createFieldRow,
    createToggleRow,
    createSelectRow,
    createInputRow,
    createNumberRow,
    createSliderRow,
    createColorPickerRow,
    createSectionCard,
    SelectOptionItem
} from './controls';

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
export class FormRenderer<TState extends object> implements IDisposable {
    private readonly _store: ObservableStore<TState>;
    private readonly _binder: FormBinder<TState>;
    private readonly _disposables = new DisposableStore();

    constructor(store: ObservableStore<TState>) {
        this._store = store;
        this._binder = new FormBinder<TState>(store);
        this._disposables.add(this._binder);
    }

    public get binder(): FormBinder<TState> {
        return this._binder;
    }

    /**
     * 根据卡片 Schema 渲染标准 SectionCard
     *
     * @param schema 卡片配置描述对象
     * @returns 渲染完成的卡片 DOM 节点
     */
    public renderCard(schema: SectionCardSchema<TState>): HTMLElement {
        const card = createSectionCard({
            title: schema.title,
            description: schema.description,
            headerExtra: schema.headerExtra ? schema.headerExtra(this._binder) : undefined,
            renderBody: (body) => {
                schema.rows.forEach((rowSchema) => {
                    const rowEl = this.renderRow(rowSchema);
                    body.appendChild(rowEl);
                });
            }
        });

        return card;
    }

    /**
     * 根据单行 Schema 渲染标准 FormRow
     *
     * @param schema 表单行配置描述对象
     * @returns 渲染完成的行 DOM 节点
     */
    public renderRow(schema: FormRowSchema<TState>): HTMLElement {
        let rowEl: HTMLElement;
        const curState = this._store.getState();

        switch (schema.type) {
            case 'toggle': {
                const rawVal = this._readVal(schema, curState);
                const initialVal = Boolean(rawVal ?? false);

                const toggleHandle = createToggleRow({
                    label: schema.label,
                    helpTooltip: schema.helpTooltip,
                    value: initialVal,
                    onChange: (val) => {
                        this._writeVal(schema, val);
                    }
                });

                this._subscribeToStore(schema, (v) => {
                    const checkbox = toggleHandle.querySelector('input[type="checkbox"]') as HTMLInputElement;
                    if (checkbox && checkbox.checked !== Boolean(v)) {
                        checkbox.checked = Boolean(v);
                    }
                });

                rowEl = toggleHandle;
                break;
            }

            case 'select': {
                const rawVal = this._readVal(schema, curState);
                const initialVal = rawVal !== undefined && rawVal !== null ? String(rawVal) : '';

                const selectHandle = createSelectRow({
                    label: schema.label,
                    helpTooltip: schema.helpTooltip,
                    value: initialVal,
                    options: schema.options || [],
                    onChange: (val) => {
                        this._writeVal(schema, val);
                    }
                });

                this._subscribeToStore(schema, (v) => selectHandle.setValue(String(v ?? '')));

                rowEl = selectHandle;
                break;
            }

            case 'input': {
                const rawVal = this._readVal(schema, curState);
                const initialVal = rawVal !== undefined && rawVal !== null ? String(rawVal) : '';

                const inputHandle = createInputRow({
                    label: schema.label,
                    helpTooltip: schema.helpTooltip,
                    value: initialVal,
                    placeholder: schema.placeholder,
                    fixedWidth: schema.fixedWidth,
                    onChange: (val) => {
                        this._writeVal(schema, val);
                    }
                });

                this._subscribeToStore(schema, (v) => inputHandle.setValue(String(v ?? '')));

                rowEl = inputHandle;
                break;
            }

            case 'number': {
                const rawVal = this._readVal(schema, curState);
                const initialVal = rawVal !== undefined ? Number(rawVal) : (schema.min ?? 0);

                const numHandle = createNumberRow({
                    label: schema.label,
                    helpTooltip: schema.helpTooltip,
                    value: initialVal,
                    min: schema.min ?? 0,
                    max: schema.max ?? 10000,
                    step: schema.step ?? 1,
                    unit: schema.unit,
                    onChange: (val) => {
                        this._writeVal(schema, val);
                    }
                });

                this._subscribeToStore(schema, (v) => numHandle.setValue(Number(v ?? 0)));

                rowEl = numHandle;
                break;
            }

            case 'slider': {
                const rawVal = this._readVal(schema, curState);
                const initialVal = rawVal !== undefined ? Number(rawVal) : (schema.min ?? 0);

                const sliderHandle = createSliderRow({
                    label: schema.label,
                    helpTooltip: schema.helpTooltip,
                    value: initialVal,
                    min: schema.min ?? 0,
                    max: schema.max ?? 100,
                    step: schema.step ?? 1,
                    unit: schema.unit,
                    onChange: (val) => {
                        this._writeVal(schema, val);
                    }
                });

                this._subscribeToStore(schema, (v) => sliderHandle.setValue(Number(v ?? 0)));

                rowEl = sliderHandle;
                break;
            }

            case 'color': {
                const rawVal = this._readVal(schema, curState);
                const initialVal = rawVal !== undefined ? String(rawVal) : '#00f2fe';

                const colorHandle = createColorPickerRow({
                    label: schema.label,
                    helpTooltip: schema.helpTooltip,
                    value: initialVal,
                    onChange: (val) => {
                        this._writeVal(schema, val);
                    }
                });

                this._subscribeToStore(schema, (v) => colorHandle.setValue(String(v ?? '#00f2fe')));

                rowEl = colorHandle;
                break;
            }

            case 'component': {
                const container = document.createElement('div');
                rowEl = schema.renderCustom ? schema.renderCustom(container, this._binder) : container;
                break;
            }

            case 'custom':
            default: {
                const container = document.createElement('div');
                const customEl = schema.renderCustom ? schema.renderCustom(container, this._binder) : container;
                rowEl = createFieldRow({
                    label: schema.label,
                    helpTooltip: schema.helpTooltip,
                    control: customEl
                });
                break;
            }
        }

        // 响应式条件显隐订阅（display 切换为合法动态内联样式）
        if (schema.visibleWhen) {
            const updateVisibility = (state: TState) => {
                const isVisible = schema.visibleWhen!(state);
                rowEl.style.display = isVisible ? '' : 'none';
            };

            updateVisibility(this._store.getState());
            const sub = this._store.subscribe((state) => updateVisibility(state));
            this._disposables.add(sub);
        }

        return rowEl;
    }

    /**
     * 销毁渲染器持有的所有响应式订阅与绑定
     */
    public dispose(): void {
        this._disposables.dispose();
    }

    // ── 私有辅助方法 ─────────────────────────────────────────────────────

    /**
     * 从 Store 读取初始值，支持 key / keyPath 两种模式，并应用 fromStore 转换。
     *
     * @param schema 表单行 Schema
     * @param state 当前 Store 快照
     * @returns 经 fromStore 转换后的 UI 显示值
     */
    private _readVal(schema: FormRowSchema<TState>, state: Readonly<TState>): any {
        let raw: any;
        if (schema.keyPath) {
            raw = (state[schema.keyPath[0]] as any)?.[schema.keyPath[1]];
        } else if (schema.key) {
            raw = state[schema.key];
        }
        return schema.fromStore ? schema.fromStore(raw) : raw;
    }

    /**
     * 将 UI 控件值写入 Store，支持 key / keyPath 两种模式，并应用 toStore 转换。
     * 写入后若存在 onChangeHook，则随即触发。
     *
     * @param schema 表单行 Schema
     * @param uiValue UI 控件输出的原始值
     */
    private _writeVal(schema: FormRowSchema<TState>, uiValue: any): void {
        const storeVal = schema.toStore ? schema.toStore(uiValue) : uiValue;

        if (schema.keyPath) {
            const [parentKey, fieldKey] = schema.keyPath;
            const existing = this._store.get(parentKey) as Record<string, any> | undefined;
            this._store.set(parentKey, { ...(existing ?? {}), [fieldKey]: storeVal } as any);
        } else if (schema.key) {
            this._store.set(schema.key, storeVal);
        }
        // key/keyPath 均未声明时：仅触发 onChangeHook（纯触发型控件，如分辨率预设下拉）
        if (schema.onChangeHook) {
            schema.onChangeHook(storeVal, this._store.getState());
        }
    }

    /**
     * 订阅 Store 中对应 key/keyPath 的变更，将新值同步到 UI 回调。
     * 无 key/keyPath 时（纯触发型）不订阅，避免空订阅。
     *
     * @param schema 表单行 Schema
     * @param updateUI UI 更新回调，接收经 fromStore 转换后的值
     */
    private _subscribeToStore(schema: FormRowSchema<TState>, updateUI: (displayVal: any) => void): void {
        if (schema.keyPath) {
            const [parentKey] = schema.keyPath;
            const sub = this._store.subscribeKey(parentKey, (newParent) => {
                const raw = (newParent as any)?.[schema.keyPath![1]];
                updateUI(schema.fromStore ? schema.fromStore(raw) : raw);
            });
            this._disposables.add(sub);
        } else if (schema.key) {
            const sub = this._store.subscribeKey(schema.key, (newVal) => {
                updateUI(schema.fromStore ? schema.fromStore(newVal) : newVal);
            });
            this._disposables.add(sub);
        }
    }
}
