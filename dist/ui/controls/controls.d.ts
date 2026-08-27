import { FieldRowOptions } from './field-row';
export type { FieldRowOptions };
export * from './field-row';
/** 下拉选项字典条目结构 */
export interface SelectOptionItem {
    label: string;
    value: string | number;
}
/** Switch 开关表单行配置项 */
export interface ToggleRowOptions {
    label: string;
    description?: string;
    value: boolean;
    helpTooltip?: string;
    headerAction?: HTMLElement;
    onChange: (checked: boolean) => void;
}
export interface ToggleControlHandle extends HTMLElement {
    readonly inputElement: HTMLInputElement;
    getValue: () => boolean;
    setValue: (val: boolean) => void;
    setDisabled: (disabled: boolean) => void;
}
/** 下拉选择表单行配置项 */
export interface SelectRowOptions {
    label: string;
    description?: string;
    value: string | number;
    options: Array<SelectOptionItem | string>;
    helpTooltip?: string;
    headerAction?: HTMLElement;
    fixedWidth?: boolean;
    onChange: (value: string) => void;
}
export interface SelectControlHandle extends HTMLElement {
    readonly inputElement: HTMLSelectElement;
    getValue: () => string;
    setValue: (val: string | number) => void;
    setOptions: (opts: Array<SelectOptionItem | string>, preserveValue?: boolean) => void;
    setDisabled: (disabled: boolean) => void;
    setError: (hasError: boolean, tooltip?: string) => void;
}
/** 数值步进输入表单行配置项 */
export interface NumberRowOptions {
    label: string;
    value?: number;
    defaultValue?: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    helpTooltip?: string;
    description?: string;
    fixedWidth?: boolean;
    headerAction?: HTMLElement;
    onChange?: (val: number) => void;
}
export interface NumberControlHandle extends HTMLElement {
    readonly inputElement: HTMLInputElement;
    getValue: () => number;
    setValue: (val: number) => void;
    setDisabled: (disabled: boolean) => void;
}
/** 文本输入表单行配置项 */
export interface InputRowOptions {
    label: string;
    value?: string | number | boolean;
    defaultValue?: string | number | boolean;
    type?: 'text' | 'number' | 'password' | 'textarea' | string;
    rows?: number;
    placeholder?: string;
    helpTooltip?: string;
    description?: string;
    fixedWidth?: boolean;
    headerAction?: HTMLElement;
    isBlock?: boolean;
    onChange?: (val: string) => void;
}
export interface InputControlHandle extends HTMLElement {
    readonly inputElement: HTMLInputElement | HTMLTextAreaElement;
    getValue: () => string;
    setValue: (val: string | number) => void;
    setDisabled: (disabled: boolean) => void;
}
/** 滑块联动表单行配置项 */
export interface SliderRowOptions {
    label: string;
    description?: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    helpTooltip?: string;
    headerAction?: HTMLElement;
    onChange: (value: number) => void;
}
export interface SliderControlHandle extends HTMLElement {
    readonly sliderElement: HTMLInputElement;
    readonly numberInputElement: HTMLInputElement;
    getValue: () => number;
    setValue: (val: number) => void;
    setDisabled: (disabled: boolean) => void;
}
/** 调色盘表单行配置项 */
export interface ColorPickerRowOptions {
    label: string;
    value?: string;
    defaultValue?: string;
    helpTooltip?: string;
    description?: string;
    headerAction?: HTMLElement;
    onChange?: (hexColor: string) => void;
}
export interface ColorPickerControlHandle extends HTMLElement {
    readonly colorInputElement: HTMLInputElement;
    readonly hexInputElement: HTMLInputElement;
    getValue: () => string;
    setValue: (hexColor: string) => void;
    setDisabled: (disabled: boolean) => void;
}
export interface SectionCardOptions {
    title: string;
    description?: string;
    collapsible?: boolean;
    defaultOpen?: boolean;
    headerExtra?: HTMLElement;
    renderBody: (body: HTMLElement) => void;
}
export interface CollapsibleSectionOptions {
    summaryText: string;
    defaultOpen?: boolean;
    renderBody: (body: HTMLElement) => void;
}
export declare function createToggleRow(options: ToggleRowOptions): ToggleControlHandle;
export declare function createSelectRow(options: SelectRowOptions): SelectControlHandle;
export declare function createNumberRow(options: NumberRowOptions): NumberControlHandle;
export declare function createInputRow(options: InputRowOptions): InputControlHandle;
export declare function createSliderRow(options: SliderRowOptions): SliderControlHandle;
export declare function createColorPickerRow(options: ColorPickerRowOptions): ColorPickerControlHandle;
export declare function createSectionCard(options: SectionCardOptions): HTMLElement;
export declare function createCollapsibleSection(options: CollapsibleSectionOptions): HTMLElement;
/**
 * 现代化设置面板 UI 部件统一工厂类 (ControlFactory)
 */
export declare class ControlFactory {
    static createSectionCard(options: SectionCardOptions): HTMLElement;
    createSectionCard(options: SectionCardOptions): HTMLElement;
    static createCard(titleOrOptions: string | SectionCardOptions, renderBodyOrDesc?: ((body: HTMLElement) => void) | string, descOrExtra?: string | HTMLElement | ((body: HTMLElement) => void), extra?: HTMLElement): HTMLElement;
    createCard(titleOrOptions: string | SectionCardOptions, renderBodyOrDesc?: ((body: HTMLElement) => void) | string, descOrExtra?: string | HTMLElement | ((body: HTMLElement) => void), extra?: HTMLElement): HTMLElement;
    static createCollapsible(options: CollapsibleSectionOptions): HTMLElement;
    createCollapsible(options: CollapsibleSectionOptions): HTMLElement;
    static createToggle(options: ToggleRowOptions): ToggleControlHandle;
    createToggle(options: ToggleRowOptions): ToggleControlHandle;
    static createSelect(options: SelectRowOptions): SelectControlHandle;
    createSelect(options: SelectRowOptions): SelectControlHandle;
    static createNumber(options: NumberRowOptions): NumberControlHandle;
    createNumber(options: NumberRowOptions): NumberControlHandle;
    static createInput(options: InputRowOptions): InputControlHandle;
    createInput(options: InputRowOptions): InputControlHandle;
    static createSlider(options: SliderRowOptions): SliderControlHandle;
    createSlider(options: SliderRowOptions): SliderControlHandle;
    static createColorPicker(options: ColorPickerRowOptions): ColorPickerControlHandle;
    createColorPicker(options: ColorPickerRowOptions): ColorPickerControlHandle;
}
import { LoraItem } from '../../core/state/store-types';
export type { LoraItem };
export interface ConnectionCardOptions {
    title: string;
    description: string;
    url?: string;
    currentUrl?: string;
    defaultUrl?: string;
    placeholder?: string;
    onUrlChange: (newUrl: string) => void;
    onTest: (url: string, btn: HTMLButtonElement) => Promise<void>;
}
export declare function createConnectionCard(options: ConnectionCardOptions): HTMLElement;
export interface LoraManagerElement extends HTMLElement {
    getLoras: () => LoraItem[];
    setLoras: (loras: LoraItem[]) => void;
    update?: (loras: LoraItem[], cachedLoras?: string[]) => void;
}
export interface LoraManagerOptions {
    loras: LoraItem[];
    cachedLoras: string[];
    showExtraWeights?: boolean;
    onChange: (loras: LoraItem[]) => void;
}
export declare function createLoraManagerControl(options: LoraManagerOptions): LoraManagerElement;
//# sourceMappingURL=controls.d.ts.map