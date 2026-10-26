/**
 * 声明式配置驱动表单与卡片渲染引擎 (SchemaForm)。
 *
 * @remarks
 * 通过结构化 Schema 定义卡片与表单字段，自动完成：
 * 1. 模型属性值读取与默认值回退；
 * 2. 视图与存储层数值转换 (transform.toView / fromView)；
 * 3. 字段级脏状态 (.is-dirty) 与失效状态 (.is-invalid) 自动高亮；
 * 4. 级联条件显隐 (visibleWhen) 与条件禁用 (disabledWhen) 自动计算。
 */

import type { ComponentChildren } from 'preact';
import type { FormFieldControlWidth } from '../components/form-field';
import type { SelectOption, SelectOptGroup } from '../components/select';
import type { SegmentedControlOption } from '../components/segmented-control';
import {
    CardView,
    FormFieldView,
    SwitchControl,
    SelectControl,
    SliderControl,
    NumberInputControl,
    TextInputControl,
    TextareaControl,
    SegmentedControlView,
} from './controls';

/** 支持的声明式字段控件类型 */
export type SchemaFieldType =
    | 'switch'
    | 'select'
    | 'slider'
    | 'number'
    | 'text'
    | 'textarea'
    | 'segmented'
    | 'divider'
    | 'custom';

/** 自定义字段渲染上下文 */
export interface FieldRenderContext<TModel extends Record<string, any>> {
    model: TModel;
    value: any;
    isDirty: boolean;
    isInvalid: boolean;
    disabled: boolean;
    updateField: <K extends keyof TModel>(key: K, value: TModel[K]) => void;
    updateFields: (partial: Partial<TModel>) => void;
}

/** 单个表单项的声明式 Schema 配置 */
export interface FieldSchema<TModel extends Record<string, any> = Record<string, any>> {
    /** 字段唯一键名（对应 model 属性名，或用于 divider / custom 的唯一标识） */
    key: Extract<keyof TModel, string> | string;
    /** 字段控件类型 */
    type: SchemaFieldType;
    /** 表单行左侧标签文本（type 为 divider 或整行 custom 时可省略） */
    label?: string;
    /** 是否显示必填星号 */
    required?: boolean;
    /** 帮助提示说明 (Tooltip) */
    tooltip?: string;
    /** 右侧控件容器宽度规格 */
    width?: FormFieldControlWidth;
    /** 缺省默认值 */
    defaultValue?: any;
    /** 附加在 FormFieldView 上的类名 */
    fieldClassName?: string;
    /** 是否不使用标准 FormFieldRow 包装而直接把自定义内容渲染到 Card body 中 */
    bare?: boolean;

    // 控件专属配置项
    options?:
        | Array<SelectOption | SelectOptGroup | SegmentedControlOption>
        | ((model: TModel) => Array<SelectOption | SelectOptGroup | SegmentedControlOption>);
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number;
    precision?: number;
    unit?: string;
    rows?: number;
    clearable?: boolean;
    debounceMs?: number;
    switchLabel?: string;

    /** 存储值与视图控件值之间的双向转换器 */
    transform?: {
        toView: (rawVal: any, model: TModel) => any;
        fromView: (viewVal: any, model: TModel) => any;
    };

    /** 动态显隐条件：返回 false 时隐藏该字段 */
    visibleWhen?: (model: TModel) => boolean;

    /** 动态禁用条件：返回 true 时禁用该字段控件 */
    disabledWhen?: (model: TModel) => boolean;

    /** 自定义脏状态判定（默认直接查询 dirtyFields.has(key)） */
    isDirtyWhen?: (dirtyFields: ReadonlySet<string>, model: TModel) => boolean;

    /** 自定义失效状态判定（默认直接查询 invalidFields.has(key)） */
    isInvalidWhen?: (invalidFields: ReadonlySet<string>, model: TModel) => boolean;

    /** 值变更后的附加副作用回调 */
    onAfterChange?: (value: any, model: TModel) => void;

    /** 当 type === 'custom' 时的自定义渲染函数 */
    renderCustom?: (ctx: FieldRenderContext<TModel>) => ComponentChildren;
}

/** 声明式卡片配置 Schema */
export interface CardSchema<TModel extends Record<string, any> = Record<string, any>> {
    /** 卡片唯一标识 */
    id?: string;
    /** 卡片主标题 */
    title: string;
    /** 卡片副标题 */
    subtitle?: string;
    /** 卡片整体动态显隐条件 */
    visibleWhen?: (model: TModel) => boolean;
    /** 卡片级自定义脏状态判定（例如整张卡片边框变黄 .is-dirty） */
    cardDirtyKeys?: string[];
    /** 头部徽标插槽 */
    renderBadges?: (model: TModel) => ComponentChildren;
    /** 头部操作区插槽 */
    renderActions?: (model: TModel) => ComponentChildren;
    /** 卡片内的字段列表 */
    fields: FieldSchema<TModel>[];
}

export interface SchemaFieldRendererProps<TModel extends Record<string, any> = any> {
    schema: FieldSchema<TModel>;
    model: TModel;
    dirty?: boolean;
    invalid?: boolean;
    dirtyFields?: ReadonlySet<string>;
    invalidFields?: ReadonlySet<string>;
    onChange?: (value: any) => void;
    onFieldChange?: (key: any, value: any) => void;
    onChangeFields?: (partial: Partial<TModel>) => void;
}

/**
 * 渲染单个声明式字段。
 */
export function SchemaFieldRenderer<TModel extends Record<string, any> = any>(
    props: SchemaFieldRendererProps<TModel>
) {
    const {
        schema,
        model,
        dirty,
        invalid,
        dirtyFields,
        invalidFields,
        onChange,
        onFieldChange,
        onChangeFields,
    } = props;

    const emitFieldChange = (key: string, value: any) => {
        if (onChange) {
            onChange(value);
        }
        if (onFieldChange) {
            onFieldChange(key, value);
        }
    };

    // 1. 分割线类型
    if (schema.type === 'divider') {
        const isVisible = schema.visibleWhen ? schema.visibleWhen(model) : true;
        if (!isVisible) return null;
        return <div className="da-settings-divider" />;
    }

    // 2. 计算状态
    const isVisible = schema.visibleWhen ? schema.visibleWhen(model) : true;
    const isDisabled = schema.disabledWhen ? schema.disabledWhen(model) : false;

    const isDirty =
        dirty !== undefined
            ? dirty
            : schema.isDirtyWhen
              ? schema.isDirtyWhen(dirtyFields ?? new Set(), model)
              : Boolean(dirtyFields?.has(schema.key));

    const isInvalid =
        invalid !== undefined
            ? invalid
            : schema.isInvalidWhen
              ? schema.isInvalidWhen(invalidFields ?? new Set(), model)
              : Boolean(invalidFields?.has(schema.key));

    const rawValue = model[schema.key] !== undefined ? model[schema.key] : schema.defaultValue;
    const viewValue = schema.transform ? schema.transform.toView(rawValue, model) : rawValue;

    const handleValueChange = (nextViewVal: any) => {
        const nextStoreVal = schema.transform
            ? schema.transform.fromView(nextViewVal, model)
            : nextViewVal;
        emitFieldChange(schema.key, nextStoreVal);
        schema.onAfterChange?.(nextStoreVal, model);
    };

    const resolvedOptions =
        typeof schema.options === 'function' ? schema.options(model) : (schema.options ?? []);

    // 3. 构建内部控件
    let controlNode: ComponentChildren = null;

    switch (schema.type) {
        case 'switch':
            controlNode = (
                <SwitchControl
                    value={Boolean(viewValue)}
                    label={schema.switchLabel}
                    disabled={isDisabled}
                    dirty={isDirty}
                    onChange={handleValueChange}
                />
            );
            break;

        case 'select':
            controlNode = (
                <SelectControl
                    value={String(viewValue ?? '')}
                    options={resolvedOptions as Array<SelectOption | SelectOptGroup>}
                    placeholder={schema.placeholder}
                    disabled={isDisabled}
                    dirty={isDirty}
                    invalid={isInvalid}
                    onChange={handleValueChange}
                />
            );
            break;

        case 'slider':
            controlNode = (
                <SliderControl
                    value={Number(viewValue ?? schema.defaultValue ?? schema.min ?? 0)}
                    min={schema.min}
                    max={schema.max}
                    step={schema.step}
                    defaultValue={schema.defaultValue}
                    precision={schema.precision}
                    unit={schema.unit}
                    disabled={isDisabled}
                    dirty={isDirty}
                    onChange={handleValueChange}
                />
            );
            break;

        case 'number':
            controlNode = (
                <NumberInputControl
                    value={Number(viewValue ?? schema.defaultValue ?? schema.min ?? 0)}
                    min={schema.min}
                    max={schema.max}
                    step={schema.step}
                    precision={schema.precision}
                    unit={schema.unit}
                    disabled={isDisabled}
                    dirty={isDirty}
                    onChange={handleValueChange}
                />
            );
            break;

        case 'text':
            controlNode = (
                <TextInputControl
                    value={String(viewValue ?? '')}
                    placeholder={schema.placeholder}
                    clearable={schema.clearable}
                    debounceMs={schema.debounceMs}
                    disabled={isDisabled}
                    dirty={isDirty}
                    invalid={isInvalid}
                    onChange={handleValueChange}
                />
            );
            break;

        case 'textarea':
            controlNode = (
                <TextareaControl
                    value={String(viewValue ?? '')}
                    placeholder={schema.placeholder}
                    rows={schema.rows}
                    disabled={isDisabled}
                    dirty={isDirty}
                    invalid={isInvalid}
                    onChange={handleValueChange}
                />
            );
            break;

        case 'segmented':
            controlNode = (
                <SegmentedControlView
                    value={String(viewValue ?? '')}
                    options={resolvedOptions as SegmentedControlOption[]}
                    disabled={isDisabled}
                    dirty={isDirty}
                    onChange={handleValueChange}
                />
            );
            break;

        case 'custom':
            if (schema.renderCustom) {
                controlNode = schema.renderCustom({
                    model,
                    value: viewValue,
                    isDirty,
                    isInvalid,
                    disabled: isDisabled,
                    updateField: (k, v) => emitFieldChange(String(k), v),
                    updateFields: (partial) => {
                        if (onChangeFields) {
                            onChangeFields(partial);
                        } else {
                            for (const [k, v] of Object.entries(partial)) {
                                emitFieldChange(k, v);
                            }
                        }
                    },
                });
            }
            break;
    }

    // 4. 若为 bare 模式（如直接嵌入 DimensionPicker / SamplerCard 等整块内容），不包裹 FormFieldView
    if (schema.bare) {
        if (!isVisible) return null;
        return <>{controlNode}</>;
    }

    return (
        <FormFieldView
            label={schema.label ?? schema.key}
            required={schema.required}
            tooltip={schema.tooltip}
            width={schema.width}
            dirty={isDirty}
            invalid={isInvalid}
            hidden={!isVisible}
            className={schema.fieldClassName}
        >
            {controlNode}
        </FormFieldView>
    );
}

export interface SchemaCardProps<TModel extends Record<string, any> = any> {
    schema: CardSchema<TModel>;
    model: TModel;
    dirtyFields?: ReadonlySet<string>;
    invalidFields?: ReadonlySet<string>;
    onFieldChange?: (key: any, value: any) => void;
    onChangeFields?: (partial: Partial<TModel>) => void;
    children?: ComponentChildren;
}

/**
 * 渲染声明式配置卡片 (<SchemaCard>)。
 */
export function SchemaCard<TModel extends Record<string, any> = any>(
    props: SchemaCardProps<TModel>
) {
    const {
        schema,
        model,
        dirtyFields,
        invalidFields,
        onFieldChange,
        onChangeFields,
        children,
    } = props;

    if (schema.visibleWhen && !schema.visibleWhen(model)) {
        return null;
    }

    const isCardDirty = Boolean(
        schema.cardDirtyKeys &&
            dirtyFields &&
            schema.cardDirtyKeys.some((k) => dirtyFields.has(k))
    );

    return (
        <CardView
            title={schema.title}
            subtitle={schema.subtitle}
            dirty={isCardDirty}
            badges={schema.renderBadges?.(model)}
            actions={schema.renderActions?.(model)}
        >
            {schema.fields.map((field) => (
                <SchemaFieldRenderer
                    key={field.key}
                    schema={field}
                    model={model}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    onFieldChange={onFieldChange}
                    onChangeFields={onChangeFields}
                />
            ))}
            {children}
        </CardView>
    );
}

export interface SchemaFieldsViewProps<TModel extends Record<string, any> = any> {
    fields: FieldSchema<TModel>[];
    model: TModel;
    dirtyFields?: ReadonlySet<string>;
    invalidFields?: ReadonlySet<string>;
    onFieldChange?: (key: any, value: any) => void;
    onChangeFields?: (partial: Partial<TModel>) => void;
}

/**
 * 批量渲染一组声明式表单字段（无需 CardView 外壳）。
 */
export function SchemaFieldsView<TModel extends Record<string, any> = any>(
    props: SchemaFieldsViewProps<TModel>
) {
    const {
        fields,
        model,
        dirtyFields,
        invalidFields,
        onFieldChange,
        onChangeFields,
    } = props;

    return (
        <>
            {fields.map((field) => (
                <SchemaFieldRenderer
                    key={field.key}
                    schema={field}
                    model={model}
                    dirtyFields={dirtyFields}
                    invalidFields={invalidFields}
                    onFieldChange={onFieldChange}
                    onChangeFields={onChangeFields}
                />
            ))}
        </>
    );
}

export interface SchemaFormProps<TModel extends Record<string, any> = any> {
    cards: CardSchema<TModel>[];
    model: TModel;
    dirtyFields?: ReadonlySet<string>;
    invalidFields?: ReadonlySet<string>;
    onFieldChange?: (key: any, value: any) => void;
    onChangeFields?: (partial: Partial<TModel>) => void;
}

/**
 * 批量渲染多张声明式配置卡片 (<SchemaForm>)。
 */
export function SchemaForm<TModel extends Record<string, any> = any>(
    props: SchemaFormProps<TModel>
) {
    return (
        <>
            {props.cards.map((card, idx) => (
                <SchemaCard
                    key={card.id || `${card.title}_${idx}`}
                    schema={card}
                    model={props.model}
                    dirtyFields={props.dirtyFields}
                    invalidFields={props.invalidFields}
                    onFieldChange={props.onFieldChange}
                    onChangeFields={props.onChangeFields}
                />
            ))}
        </>
    );
}
