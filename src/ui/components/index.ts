/**
 * 基础控件库聚合导出。
 *
 * @remarks
 * 包含通用卡片容器 (Card) 与仍供复合组件直接挂载的命令式基础控件：
 * - 容器：Card
 * - 按钮：Button
 * - 表单输入：NumberInput, Select, Switch, SegmentedControl
 * - 反馈与布局：Badge
 */

export * from './card';
export * from './button';
export * from './number-input';
export * from './select';
export * from './switch';
export * from './segmented-control';
export * from './badge';
export * from './icons';
export * from './transport-notice';

export type {
    Disposable,
    UIComponent,
    SetValueOptions,
    ControlChangeCallback,
    ControlHandle,
    FormFieldControlWidth,
} from '../types';
