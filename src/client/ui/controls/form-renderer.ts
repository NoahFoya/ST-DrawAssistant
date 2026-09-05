/**
 * @module ui/controls/form-renderer
 * @description 表单配置渲染器 (FormRenderer)
 *
 * 职责：
 * 解析表单配置结构 (FormRowSchema / SectionCardSchema)，完成表单项的构建与数据绑定：
 * 1. 使用布局容器构建卡片与行列结构；
 * 2. 填充字段标签与输入控件；
 * 3. 绑定 Store 状态数据，处理动态显示/禁用与生命周期释放。
 */

import { IDisposable, DisposableStore } from '../../core';
import { FormBinder } from '../foundation/form-binder';
import {
    createRow,
    createCol,
    createCard,
    createFieldLabel,
    createCardHeader
} from '../layout/container-factory';
import {
    createToggle,
    createSelect,
    createTextInput,
    createNumberInput,
    createTextarea,
    createColorPicker,
    createSlider,
    createSegmentedControl,
    IControlHandle,
    SelectOptionItem,
    SegmentedItem
} from './input-controls';

export type FormFieldType = 'toggle' | 'select' | 'input' | 'textarea' | 'number' | 'color' | 'slider' | 'segmented' | 'custom' | 'component';

export interface FormRowSchema<TState extends object> {
    /** 绑定的 Store 属性键（与 keyPath 互斥） */
    key?: keyof TState;
    /** 表单项类型 */
    type: FormFieldType;
    /** 主标签名称 */
    label: string;
    /** 次要详细描述文本 */
    description?: string;
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
    /** 单位徽标 (如 'px', '%', 's', '°') */
    unit?: string;
    /** 占位提示符 */
    placeholder?: string;
    /** 分段控制器选项列表 (type === 'segmented') */
    segmentedItems?: SegmentedItem[];
    /** 是否采用块级上下垂直排布 (全宽展示如图标选择网格、多选标签组等复合控件) */
    isBlock?: boolean;
    /** 自定义输入控件渲染函数 (type === 'custom') */
    renderCustom?: (container: HTMLElement, binder: FormBinder<TState>) => HTMLElement;
    /** 动态显隐条件谓词 */
    visibleWhen?: (state: TState) => boolean;
    /** 动态禁用条件谓词 (如随模型切换或高级开关动态启用/置灰) */
    disabledWhen?: (state: TState) => boolean;
    /** 额外自定义变更钩子（在值写入 Store 之后触发） */
    onChangeHook?: (val: any, state: TState) => void;

    /** Store → UI 值映射函数（读取时转换） */
    fromStore?: (storeValue: any) => any;
    /** UI → Store 值映射函数（写入时转换） */
    toStore?: (uiValue: any) => any;

    /** 控件 DOM/Handle 渲染完成回调 */
    onCreated?: (handle: any) => void;

    /** 嵌套对象路径绑定，格式 `['imageDisplay', 'align'] as const` */
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

export interface IFormStore<TState extends object> {
    getState(): TState;
    get<K extends keyof TState>(key: K): TState[K];
    set<K extends keyof TState>(key: K, val: TState[K]): void;
    subscribe(fn: (state: TState) => void): IDisposable;
    subscribeKey<K extends keyof TState>(key: K, fn: (newVal: TState[K], oldVal: TState[K]) => void): IDisposable;
}

/**
 * 声明式表单渲染引擎
 */
export class FormRenderer<TState extends object> implements IDisposable {
    private readonly _store: IFormStore<TState>;
    private readonly _binder: FormBinder<TState>;
    private readonly _disposables = new DisposableStore();
    /** 控件 Handle 注册表：key → IControlHandle，供外部通过 getHandle() 查询 */
    private readonly _handles = new Map<keyof TState | string, any>();

    constructor(store: IFormStore<TState>) {
        this._store = store;
        this._binder = new FormBinder<TState>(store);
        this._disposables.add(this._binder);
    }

    public get binder(): FormBinder<TState> {
        return this._binder;
    }

    /**
     * 获取指定 key 对应的输入控件 Handle
     */
    public getHandle<T = IControlHandle<any>>(key: keyof TState | string): T | undefined {
        return this._handles.get(key) as T | undefined;
    }

    /**
     * 根据卡片 Schema 渲染标准卡片
     */
    public renderCard(schema: SectionCardSchema<TState>): HTMLElement {
        const card = createCard({ hoverable: true });
        const headerContent = createCardHeader({
            title: schema.title,
            description: schema.description,
            action: schema.headerExtra ? schema.headerExtra(this._binder) : undefined
        });
        card.header.appendChild(headerContent);

        schema.rows.forEach((rowSchema) => {
            const rowEl = this.renderRow(rowSchema);
            card.body.appendChild(rowEl);
        });

        // 可折叠卡片：header 点击切换 body 展开/折叠
        if (schema.collapsible) {
            const isInitiallyOpen = schema.defaultOpen !== false;
            card.header.classList.add('da-card__header--collapsible');
            card.root.classList.toggle('da-card--collapsed', !isInitiallyOpen);
            if (!isInitiallyOpen) {
                card.body.style.display = 'none';
            }
            card.header.addEventListener('click', () => {
                const isCollapsed = card.root.classList.toggle('da-card--collapsed');
                card.body.style.display = isCollapsed ? 'none' : '';
            });
        }

        return card.root;
    }

    /**
     * 根据单行 Schema 渲染标准表单行
     * 表单装配：1. 容器空间划分 ➔ 2. 字段标签与输入控件填充 ➔ 3. 数据流绑定
     */
    public renderRow(schema: FormRowSchema<TState>): HTMLElement {
        const currentState = this._store.getState();

        // 1. 垂直堆叠全宽行 (Textarea 或 isBlock 块级字段)
        if (schema.type === 'textarea' || schema.isBlock) {
            const col = createCol(2, { gap: '6px' });
            col.root.classList.add('da-row--divided');

            const fieldLabel = createFieldLabel({
                title: schema.label,
                description: schema.description,
                helpTooltip: schema.helpTooltip
            });
            col.slots[0].appendChild(fieldLabel);

            if (schema.type === 'textarea') {
                const rawValue = this._readVal(schema, currentState);
                const initialValue = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';

                const textarea = createTextarea({
                    value: initialValue,
                    placeholder: schema.placeholder,
                    onChange: (value) => {
                        this._writeVal(schema, value);
                    }
                });

                this._subscribeToStore(schema, (value) => textarea.setValue(String(value ?? '')));
                this._disposables.add(textarea);
                col.slots[1].appendChild(textarea);
                const handleKey = schema.key || (schema.keyPath?.length ? schema.keyPath.join('.') : undefined);
                if (handleKey) this._handles.set(handleKey, textarea);
                schema.onCreated?.(textarea);
            } else if (schema.type === 'custom' && schema.renderCustom) {
                const customElement = schema.renderCustom(col.slots[1], this._binder);
                if (customElement && customElement !== col.slots[1] && !col.slots[1].contains(customElement)) {
                    col.slots[1].appendChild(customElement);
                }
            }

            this._setupReactivity(col.root, schema);
            return col.root;
        }

        // 2. 单插槽全宽组件行 (无标题标签的大型控件，如 PresetToolbar / LoraManager)
        if ((schema.type === 'component' || schema.type === 'custom') && !schema.label) {
            const row = createRow(['full'], {
                align: 'center',
                divided: true
            });
            const controlSlot = row.slots[0];
            if (schema.renderCustom) {
                const customEl = schema.renderCustom(controlSlot, this._binder);
                if (customEl && customEl !== controlSlot && !controlSlot.contains(customEl)) {
                    controlSlot.appendChild(customEl);
                }
            }
            this._setupReactivity(row.root, schema);
            return row.root;
        }

        // 3. 水平双栏标准行 (左侧标题描述向左对齐，右侧控件靠右紧贴对齐，统一垂直居中)
        const row = createRow(['left', 'right'], {
            align: 'center',
            divided: true
        });

        const fieldLabel = createFieldLabel({
            title: schema.label,
            description: schema.description,
            helpTooltip: schema.helpTooltip
        });
        row.slots[0].appendChild(fieldLabel);

        // 4. 实例化具体输入控件并挂载到右侧操作区 (slots[1])
        const controlSlot = row.slots[1];

        switch (schema.type) {
            case 'toggle': {
                const rawValue = this._readVal(schema, currentState);
                const initialValue = Boolean(rawValue ?? false);

                const toggle = createToggle({
                    value: initialValue,
                    onChange: (checked) => {
                        this._writeVal(schema, checked);
                    }
                });

                this._subscribeToStore(schema, (value) => {
                    toggle.setValue(Boolean(value));
                });
                this._disposables.add(toggle);
                controlSlot.appendChild(toggle);
                const handleKey = schema.key || (schema.keyPath?.length ? schema.keyPath.join('.') : undefined);
                if (handleKey) this._handles.set(handleKey, toggle);
                schema.onCreated?.(toggle);
                break;
            }

            case 'select': {
                const rawValue = this._readVal(schema, currentState);
                const initialValue = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';

                const select = createSelect({
                    value: initialValue,
                    options: schema.options || [],
                    onChange: (value) => {
                        this._writeVal(schema, value);
                    }
                });

                this._subscribeToStore(schema, (value) => select.setValue(String(value ?? '')));
                this._disposables.add(select);
                controlSlot.appendChild(select);
                const handleKey = schema.key || (schema.keyPath?.length ? schema.keyPath.join('.') : undefined);
                if (handleKey) this._handles.set(handleKey, select);
                schema.onCreated?.(select);
                break;
            }

            case 'input': {
                const rawValue = this._readVal(schema, currentState);
                const initialValue = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';

                const input = createTextInput({
                    value: initialValue,
                    placeholder: schema.placeholder,
                    onChange: (value) => {
                        this._writeVal(schema, value);
                    }
                });

                this._subscribeToStore(schema, (value) => input.setValue(String(value ?? '')));
                this._disposables.add(input);
                controlSlot.appendChild(input);
                const handleKey = schema.key || (schema.keyPath?.length ? schema.keyPath.join('.') : undefined);
                if (handleKey) this._handles.set(handleKey, input);
                schema.onCreated?.(input);
                break;
            }

            case 'number': {
                const rawValue = this._readVal(schema, currentState);
                const initialValue = typeof rawValue === 'number' ? rawValue : (schema.min ?? 0);

                const numberComp = createNumberInput({
                    value: initialValue,
                    min: schema.min,
                    max: schema.max,
                    step: schema.step,
                    unit: schema.unit,
                    onChange: (val) => {
                        this._writeVal(schema, val);
                    }
                });

                this._subscribeToStore(schema, (value) => numberComp.setValue(Number(value ?? 0)));
                this._disposables.add(numberComp);
                controlSlot.appendChild(numberComp);
                const handleKey = schema.key || (schema.keyPath?.length ? schema.keyPath.join('.') : undefined);
                if (handleKey) this._handles.set(handleKey, numberComp);
                schema.onCreated?.(numberComp);
                break;
            }

            case 'color': {
                const rawValue = this._readVal(schema, currentState);
                const initialValue = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';

                const colorPicker = createColorPicker({
                    value: initialValue,
                    onChange: (hexColor) => {
                        this._writeVal(schema, hexColor);
                    }
                });

                this._subscribeToStore(schema, (value) => colorPicker.setValue(String(value ?? '')));
                this._disposables.add(colorPicker);
                controlSlot.appendChild(colorPicker);
                const handleKey = schema.key || (schema.keyPath?.length ? schema.keyPath.join('.') : undefined);
                if (handleKey) this._handles.set(handleKey, colorPicker);
                schema.onCreated?.(colorPicker);
                break;
            }

            case 'slider': {
                const rawValue = this._readVal(schema, currentState);
                const initialValue = typeof rawValue === 'number' ? rawValue : (schema.min ?? 0);

                const slider = createSlider({
                    value: initialValue,
                    min: schema.min ?? 0,
                    max: schema.max ?? 100,
                    step: schema.step ?? 1,
                    unit: schema.unit,
                    onChange: (val) => {
                        this._writeVal(schema, val);
                    }
                });

                this._subscribeToStore(schema, (value) => slider.setValue(Number(value ?? 0)));
                this._disposables.add(slider);
                controlSlot.appendChild(slider);
                const handleKey = schema.key || (schema.keyPath?.length ? schema.keyPath.join('.') : undefined);
                if (handleKey) this._handles.set(handleKey, slider);
                schema.onCreated?.(slider);
                break;
            }

            case 'segmented': {
                const rawValue = this._readVal(schema, currentState);
                const initialValue = rawValue !== undefined && rawValue !== null ? String(rawValue) : (schema.segmentedItems?.[0]?.value ?? '');

                const segmented = createSegmentedControl({
                    value: initialValue,
                    items: schema.segmentedItems || [],
                    onChange: (val) => {
                        this._writeVal(schema, val);
                    }
                });

                this._subscribeToStore(schema, (value) => segmented.setValue(String(value ?? '')));
                this._disposables.add(segmented);
                controlSlot.appendChild(segmented);
                const handleKey = schema.key || (schema.keyPath?.length ? schema.keyPath.join('.') : undefined);
                if (handleKey) this._handles.set(handleKey, segmented);
                schema.onCreated?.(segmented);
                break;
            }

            case 'component':
            case 'custom':
            default: {
                if (schema.renderCustom) {
                    const customEl = schema.renderCustom(controlSlot, this._binder);
                    if (customEl && customEl !== controlSlot && !controlSlot.contains(customEl)) {
                        controlSlot.appendChild(customEl);
                    }
                }
                break;
            }
        }

        this._setupReactivity(row.root, schema);
        return row.root;
    }

    private _setupReactivity(el: HTMLElement, schema: FormRowSchema<TState>): void {
        // 响应式显隐
        if (schema.visibleWhen) {
            const updateVisibility = (state: TState) => {
                const isVisible = schema.visibleWhen!(state);
                el.style.display = isVisible ? '' : 'none';
            };

            updateVisibility(this._store.getState());
            const sub = this._store.subscribe((state) => updateVisibility(state));
            this._disposables.add(sub);
        }

        // 响应式禁用
        if (schema.disabledWhen) {
            const updateDisabled = (state: TState) => {
                const isDisabled = Boolean(schema.disabledWhen!(state));
                el.classList.toggle('is-disabled', isDisabled);
                el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
                    'input, select, textarea, button'
                ).forEach((input) => {
                    input.disabled = isDisabled;
                });
            };

            updateDisabled(this._store.getState());
            const sub = this._store.subscribe((state) => updateDisabled(state));
            this._disposables.add(sub);
        }
    }

    private _readVal(schema: FormRowSchema<TState>, state: TState): any {
        let raw: any;
        if (schema.keyPath) {
            const [parentKey, fieldKey] = schema.keyPath;
            raw = (state[parentKey] as Record<string, any> | undefined)?.[fieldKey];
        } else if (schema.key) {
            raw = state[schema.key];
        }
        return schema.fromStore ? schema.fromStore(raw) : raw;
    }

    private _writeVal(schema: FormRowSchema<TState>, uiValue: any): void {
        const storeVal = schema.toStore ? schema.toStore(uiValue) : uiValue;

        if (schema.keyPath) {
            const [parentKey, fieldKey] = schema.keyPath;
            const existing = this._store.get(parentKey) as Record<string, any> | undefined;
            this._store.set(parentKey, { ...(existing ?? {}), [fieldKey]: storeVal } as any);
        } else if (schema.key) {
            this._store.set(schema.key, storeVal);
        }
        if (schema.onChangeHook) {
            schema.onChangeHook(storeVal, this._store.getState());
        }
    }

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

    public dispose(): void {
        this._handles.forEach((handle) => {
            if (handle && typeof handle.dispose === 'function') {
                handle.dispose();
            }
        });
        this._handles.clear();
        this._disposables.dispose();
    }
}
