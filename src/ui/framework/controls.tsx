/**
 * Preact 声明式基础控件库 (Controls)。
 *
 * @remarks
 * 将设计系统中的卡片、表单行、开关、下拉框、滑块、数值步进器、文本框、分段选择器与按钮
 * 封装为无状态/受控 Preact 函数组件，保持 .da-* 样式类名与原生交互事件一致。
 */

import type { ComponentChildren } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import type { FormFieldControlWidth } from '../components/form-field';
import type { SelectOption, SelectOptGroup } from '../components/select';
import type { SegmentedControlOption } from '../components/segmented-control';
import type { ButtonVariant, ButtonSize } from '../components/button';
import type { BadgeVariant } from '../components/badge';

// 1. 通用卡片容器组件 (CardView)

export interface CardViewProps {
    title: string;
    subtitle?: string;
    dirty?: boolean;
    className?: string;
    badges?: ComponentChildren;
    actions?: ComponentChildren;
    children?: ComponentChildren;
}

export function CardView(props: CardViewProps) {
    const rootClasses = [
        'da-card',
        props.dirty ? 'is-dirty' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={rootClasses}>
            <div className="da-card__header">
                <div className="da-card__header-left">
                    <div className="da-card__title-group">
                        <h3 className="da-card__title">{props.title}</h3>
                        <p
                            className="da-card__subtitle"
                            style={{ display: props.subtitle ? '' : 'none' }}
                        >
                            {props.subtitle || ''}
                        </p>
                    </div>
                </div>
                <div className="da-card__header-right">
                    <div className="da-card__badges">{props.badges}</div>
                    <div
                        className="da-card__actions"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {props.actions}
                    </div>
                </div>
            </div>
            <div className="da-card__body">{props.children}</div>
        </div>
    );
}

// 2. 标准表单行组件 (FormFieldView)

export interface FormFieldViewProps {
    label: string;
    required?: boolean;
    tooltip?: string;
    width?: FormFieldControlWidth;
    dirty?: boolean;
    invalid?: boolean;
    hidden?: boolean;
    className?: string;
    children?: ComponentChildren;
}

export function FormFieldView(props: FormFieldViewProps) {
    const width = props.width ?? 'auto';
    const rowClasses = [
        'da-form-row',
        props.dirty ? 'da-form-row--dirty is-dirty' : '',
        props.invalid ? 'is-invalid' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    const controlClasses = [
        'da-form-row__control',
        width !== 'auto' ? `da-slot--${width}` : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            className={rowClasses}
            style={props.hidden ? { display: 'none' } : undefined}
        >
            <div className="da-field-label-group">
                {props.required && <span className="da-field-required">*</span>}
                <label className="da-field-label">{props.label}</label>
                {props.tooltip && (
                    <span
                        className="da-help-icon"
                        title={props.tooltip}
                        data-tooltip={props.tooltip}
                    >
                        ?
                    </span>
                )}
            </div>
            <span
                className="da-field-dirty-dot"
                title="此项配置已修改但尚未保存"
                style={{ display: props.dirty ? 'inline-block' : 'none' }}
            />
            <div className={controlClasses}>{props.children}</div>
        </div>
    );
}

// 3. 拨动开关组件 (SwitchControl)

export interface SwitchControlProps {
    value: boolean;
    label?: string;
    disabled?: boolean;
    dirty?: boolean;
    className?: string;
    onChange?: (checked: boolean) => void;
}

export function SwitchControl(props: SwitchControlProps) {
    const checked = Boolean(props.value);
    const classes = [
        'da-switch',
        props.disabled ? 'da-switch--disabled' : '',
        props.dirty ? 'da-switch--dirty is-dirty' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <label className={classes}>
            <input
                type="checkbox"
                className="da-switch__input"
                checked={checked}
                disabled={props.disabled}
                onChange={(e) => {
                    if (!props.disabled) {
                        props.onChange?.((e.currentTarget as HTMLInputElement).checked);
                    }
                }}
            />
            <span className="da-switch__track">
                <span className="da-switch__thumb" />
            </span>
            {props.label && <span className="da-switch__label">{props.label}</span>}
        </label>
    );
}

// 4. 下拉选择框组件 (SelectControl)

export interface SelectControlProps {
    value: string;
    options: Array<SelectOption | SelectOptGroup>;
    placeholder?: string;
    disabled?: boolean;
    dirty?: boolean;
    invalid?: boolean;
    className?: string;
    onChange?: (value: string) => void;
}

export function SelectControl(props: SelectControlProps) {
    const selectRef = useRef<HTMLSelectElement>(null);
    const val = props.value ?? '';

    // 确保选项动态更新后原生 select 的选中值与受控 value 保持一致
    useEffect(() => {
        if (selectRef.current && selectRef.current.value !== val) {
            selectRef.current.value = val;
        }
    }, [val, props.options]);

    const wrapperClasses = [
        'da-select-wrapper',
        props.disabled ? 'da-select-wrapper--disabled' : '',
        props.dirty ? 'da-select-wrapper--dirty is-dirty' : '',
        props.invalid ? 'is-invalid' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    const selectClasses = ['da-select', props.invalid ? 'is-invalid' : '']
        .filter(Boolean)
        .join(' ');

    return (
        <div className={wrapperClasses}>
            <select
                ref={selectRef}
                className={selectClasses}
                value={val}
                disabled={props.disabled}
                onChange={(e) => {
                    props.onChange?.((e.currentTarget as HTMLSelectElement).value);
                }}
            >
                {props.placeholder && (
                    <option value="" disabled selected={!val}>
                        {props.placeholder}
                    </option>
                )}
                {props.options.map((item, idx) => {
                    if ('options' in item) {
                        return (
                            <optgroup key={`group_${idx}_${item.label}`} label={item.label}>
                                {item.options.map((sub) => (
                                    <option
                                        key={sub.value}
                                        value={sub.value}
                                        disabled={sub.disabled}
                                        selected={sub.value === val}
                                    >
                                        {sub.label}
                                    </option>
                                ))}
                            </optgroup>
                        );
                    }
                    return (
                        <option
                            key={`${item.value}_${idx}`}
                            value={item.value}
                            disabled={item.disabled}
                            selected={item.value === val}
                        >
                            {item.label}
                        </option>
                    );
                })}
            </select>
            <span
                className="da-select__arrow"
                dangerouslySetInnerHTML={{
                    __html: `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 3.75L5 6.25L7.5 3.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
                }}
            />
        </div>
    );
}

// 5. 连续范围滑块组件 (SliderControl)

export interface SliderControlProps {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    defaultValue?: number;
    showValue?: boolean;
    unit?: string;
    precision?: number;
    disabled?: boolean;
    dirty?: boolean;
    className?: string;
    onChange?: (value: number) => void;
}

function inferStepPrecision(step: number): number {
    const str = String(step);
    const dotIndex = str.indexOf('.');
    return dotIndex === -1 ? 0 : str.length - dotIndex - 1;
}

function clampSliderValue(val: number, min: number, max: number, precision: number): number {
    if (Number.isNaN(val)) return min;
    const clamped = Math.min(max, Math.max(min, val));
    return Number(clamped.toFixed(precision));
}

export function SliderControl(props: SliderControlProps) {
    const min = props.min ?? 0;
    const max = props.max ?? 100;
    const step = props.step ?? 1;
    const precision = props.precision ?? inferStepPrecision(step);
    const unit = props.unit ?? '';
    const showValue = props.showValue ?? true;

    const raw = props.value ?? props.defaultValue ?? min;
    const currentValue = clampSliderValue(raw, min, max, precision);
    const displayStr = `${currentValue.toFixed(precision)}${unit}`;

    const wrapperClasses = [
        'da-slider-wrapper',
        props.disabled ? 'da-slider-wrapper--disabled' : '',
        props.dirty ? 'da-slider-wrapper--dirty is-dirty' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    const handleInput = (e: Event) => {
        const parsed = parseFloat((e.currentTarget as HTMLInputElement).value);
        const nextVal = clampSliderValue(parsed, min, max, precision);
        props.onChange?.(nextVal);
    };

    const handleDblClick = () => {
        if (props.defaultValue !== undefined && !props.disabled) {
            const resetVal = clampSliderValue(props.defaultValue, min, max, precision);
            props.onChange?.(resetVal);
        }
    };

    return (
        <div className={wrapperClasses}>
            <input
                type="range"
                className="da-slider"
                min={String(min)}
                max={String(max)}
                step={String(step)}
                value={String(currentValue)}
                disabled={props.disabled}
                onInput={handleInput}
                onChange={handleInput}
                onDblClick={handleDblClick}
            />
            {showValue && <span className="da-slider__value">{displayStr}</span>}
        </div>
    );
}

// 6. 数值步进微调组件 (NumberInputControl)

export interface NumberInputControlProps {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    precision?: number;
    unit?: string;
    disabled?: boolean;
    dirty?: boolean;
    className?: string;
    onChange?: (value: number) => void;
}

export function NumberInputControl(props: NumberInputControlProps) {
    const step = props.step ?? 1;
    const precision = props.precision ?? inferStepPrecision(step);
    const min = props.min;
    const max = props.max;

    const clampNum = (v: number): number => {
        if (Number.isNaN(v)) return min ?? 0;
        let res = v;
        if (min !== undefined) res = Math.max(min, res);
        if (max !== undefined) res = Math.min(max, res);
        return Number(res.toFixed(precision));
    };

    const currentValue = clampNum(props.value ?? min ?? 0);

    const wrapperClasses = [
        'da-number-input',
        props.disabled ? 'da-number-input--disabled' : '',
        props.dirty ? 'da-number-input--dirty is-dirty' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    const minusDisabled = Boolean(props.disabled || (min !== undefined && currentValue <= min));
    const plusDisabled = Boolean(props.disabled || (max !== undefined && currentValue >= max));

    return (
        <div className={wrapperClasses}>
            <button
                type="button"
                className="da-number-input__btn da-number-input__btn--minus"
                disabled={minusDisabled}
                onClick={() => {
                    if (!minusDisabled) {
                        props.onChange?.(clampNum(currentValue - step));
                    }
                }}
                dangerouslySetInnerHTML={{
                    __html: `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
                }}
            />
            <input
                type="number"
                className="da-input da-number-input__field"
                min={min !== undefined ? String(min) : undefined}
                max={max !== undefined ? String(max) : undefined}
                step={String(step)}
                value={currentValue.toFixed(precision)}
                disabled={props.disabled}
                onInput={(e) => {
                    const parsed = parseFloat((e.currentTarget as HTMLInputElement).value);
                    if (!Number.isNaN(parsed)) {
                        props.onChange?.(clampNum(parsed));
                    }
                }}
                onChange={(e) => {
                    const parsed = parseFloat((e.currentTarget as HTMLInputElement).value);
                    if (!Number.isNaN(parsed)) {
                        props.onChange?.(clampNum(parsed));
                    }
                }}
                onBlur={(e) => {
                    const inputEl = e.currentTarget as HTMLInputElement;
                    const parsed = parseFloat(inputEl.value);
                    const clamped = clampNum(parsed);
                    inputEl.value = clamped.toFixed(precision);
                    if (clamped !== currentValue) {
                        props.onChange?.(clamped);
                    }
                }}
            />
            <button
                type="button"
                className="da-number-input__btn da-number-input__btn--plus"
                disabled={plusDisabled}
                onClick={() => {
                    if (!plusDisabled) {
                        props.onChange?.(clampNum(currentValue + step));
                    }
                }}
                dangerouslySetInnerHTML={{
                    __html: `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 2V8M2 5H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
                }}
            />
            {props.unit && <span className="da-number-input__unit">{props.unit}</span>}
        </div>
    );
}

// 7. 单行文本输入组件 (TextInputControl)

export interface TextInputControlProps {
    value: string;
    placeholder?: string;
    type?: 'text' | 'password' | 'url';
    readonly?: boolean;
    disabled?: boolean;
    clearable?: boolean;
    debounceMs?: number;
    prefixIcon?: string;
    dirty?: boolean;
    invalid?: boolean;
    className?: string;
    onChange?: (value: string) => void;
}

export function TextInputControl(props: TextInputControlProps) {
    const val = props.value ?? '';
    const debounceMs = props.debounceMs ?? 0;
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (inputRef.current && inputRef.current.value !== val) {
            inputRef.current.value = val;
        }
    }, [val]);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const triggerChange = (nextVal: string) => {
        if (debounceMs > 0) {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                props.onChange?.(nextVal);
            }, debounceMs);
        } else {
            props.onChange?.(nextVal);
        }
    };

    const wrapperClasses = [
        'da-input-wrapper',
        props.disabled ? 'da-input-wrapper--disabled' : '',
        props.dirty ? 'da-input-wrapper--dirty is-dirty' : '',
        props.invalid ? 'is-invalid' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={wrapperClasses}>
            {props.prefixIcon && (
                <span
                    className="da-input__prefix"
                    dangerouslySetInnerHTML={{ __html: props.prefixIcon }}
                />
            )}
            <input
                ref={inputRef}
                type="text"
                className={`da-input${props.invalid ? ' is-invalid' : ''}`}
                value={val}
                placeholder={props.placeholder}
                readOnly={props.readonly}
                disabled={props.disabled}
                onInput={(e) => {
                    triggerChange((e.currentTarget as HTMLInputElement).value);
                }}
                onChange={(e) => {
                    if (debounceMs === 0) {
                        props.onChange?.((e.currentTarget as HTMLInputElement).value);
                    }
                }}
            />
            {props.clearable && (
                <span
                    className="da-input__clear"
                    style={{ display: val.length > 0 && !props.disabled && !props.readonly ? '' : 'none' }}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!props.disabled && !props.readonly) {
                            if (inputRef.current) inputRef.current.value = '';
                            props.onChange?.('');
                        }
                    }}
                    dangerouslySetInnerHTML={{
                        __html: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
                    }}
                />
            )}
        </div>
    );
}

// 8. 多行文本域组件 (TextareaControl)

export interface TextareaControlProps {
    value: string;
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
    dirty?: boolean;
    invalid?: boolean;
    monospace?: boolean;
    className?: string;
    onChange?: (value: string) => void;
    onBlur?: (value: string) => void;
}

export function TextareaControl(props: TextareaControlProps) {
    const classes = [
        'da-textarea',
        props.dirty ? 'is-dirty' : '',
        props.invalid ? 'is-invalid' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <textarea
            className={classes}
            rows={props.rows ?? 3}
            value={props.value ?? ''}
            placeholder={props.placeholder}
            disabled={props.disabled}
            style={
                props.monospace
                    ? { width: '100%', fontFamily: 'var(--da-font-mono, monospace)', fontSize: '12px' }
                    : { width: '100%' }
            }
            onInput={(e) => {
                props.onChange?.((e.currentTarget as HTMLTextAreaElement).value);
            }}
            onBlur={(e) => {
                props.onBlur?.((e.currentTarget as HTMLTextAreaElement).value);
            }}
        />
    );
}

// 9. 分段选择器组件 (SegmentedControlView)

export interface SegmentedControlViewProps {
    value: string;
    options: SegmentedControlOption[];
    disabled?: boolean;
    dirty?: boolean;
    className?: string;
    onChange?: (value: string) => void;
}

export function SegmentedControlView(props: SegmentedControlViewProps) {
    const currentVal = props.value ?? props.options[0]?.value ?? '';
    const classes = [
        'da-segmented',
        props.disabled ? 'is-disabled' : '',
        props.dirty ? 'is-dirty' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={classes} role="radiogroup">
            {props.options.map((opt) => {
                const isChecked = opt.value === currentVal;
                const isItemDisabled = Boolean(props.disabled || opt.disabled);
                const itemClasses = [
                    'da-segmented__item',
                    isChecked ? 'is-active' : '',
                    isItemDisabled ? 'is-disabled' : '',
                ]
                    .filter(Boolean)
                    .join(' ');

                return (
                    <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        data-value={opt.value}
                        aria-checked={isChecked ? 'true' : 'false'}
                        disabled={isItemDisabled}
                        className={itemClasses}
                        onClick={() => {
                            if (!isItemDisabled && opt.value !== currentVal) {
                                props.onChange?.(opt.value);
                            }
                        }}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

// 10. 通用按钮组件 (ButtonControl)

export interface ButtonControlProps {
    label?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: string;
    iconPosition?: 'left' | 'right';
    disabled?: boolean;
    loading?: boolean;
    loadingText?: string;
    tooltip?: string;
    className?: string;
    onClick?: (event: MouseEvent) => void | Promise<void>;
}

export function ButtonControl(props: ButtonControlProps) {
    const [asyncLoading, setAsyncLoading] = useState(false);
    const isLoading = Boolean(props.loading || asyncLoading);
    const isDisabled = Boolean(props.disabled || isLoading);
    const variant = props.variant ?? 'secondary';
    const size = props.size ?? 'md';

    const classes = [
        'da-btn',
        `da-btn--${variant}`,
        `da-btn--${size}`,
        isLoading ? 'da-btn--loading' : '',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    const displayLabel = isLoading && props.loadingText ? props.loadingText : (props.label ?? '');

    const handleClick = async (e: MouseEvent) => {
        if (isDisabled) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (!props.onClick) return;
        const res = props.onClick(e);
        if (res instanceof Promise) {
            setAsyncLoading(true);
            try {
                await res;
            } finally {
                setAsyncLoading(false);
            }
        }
    };

    const iconNode = (
        <span
            className="da-btn__icon"
            style={{ display: props.icon && !isLoading ? '' : 'none' }}
            dangerouslySetInnerHTML={props.icon ? { __html: props.icon } : undefined}
        />
    );

    const labelNode = (
        <span
            className="da-btn__label"
            style={{ display: displayLabel ? '' : 'none' }}
        >
            {displayLabel}
        </span>
    );

    return (
        <button
            type="button"
            className={classes}
            title={props.tooltip}
            disabled={isDisabled}
            onClick={handleClick}
        >
            <span
                className="da-btn__spinner"
                style={{ display: isLoading ? '' : 'none' }}
            />
            {props.iconPosition === 'right' ? (
                <>
                    {labelNode}
                    {iconNode}
                </>
            ) : (
                <>
                    {iconNode}
                    {labelNode}
                </>
            )}
        </button>
    );
}

// 11. 状态徽标组件 (BadgeView)

export interface BadgeViewProps {
    text: string;
    variant?: BadgeVariant;
    dot?: boolean;
    visible?: boolean;
    className?: string;
}

export function BadgeView(props: BadgeViewProps) {
    const variant = props.variant ?? 'neutral';
    const visible = props.visible ?? true;
    const classes = ['da-badge', `da-badge--${variant}`, props.className || '']
        .filter(Boolean)
        .join(' ');

    return (
        <span className={classes} style={{ display: visible ? '' : 'none' }}>
            {props.dot && <span className="da-badge__dot" />}
            <span className="da-badge__text">{props.text}</span>
        </span>
    );
}
