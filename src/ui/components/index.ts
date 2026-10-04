/**
 * 基础原子控件库聚合导出。
 *
 * @remarks
 * 包含通用卡片容器 (Card) 与 9 大纯受控表单原子控件：
 * - 容器：Card
 * - 按钮：Button
 * - 表单输入：TextInput, NumberInput, Select, Switch, Checkbox, Slider
 * - 反馈与布局：Badge, FormField
 */

export * from './card';
export * from './button';
export * from './text-input';
export * from './number-input';
export * from './select';
export * from './switch';
export * from './checkbox';
export * from './slider';
export * from './badge';
export * from './form-field';

export type {
    Disposable,
    UIComponent,
    SetValueOptions,
    ControlChangeCallback,
    IControlHandle,
} from '../types';
