/**
 * 功能页面选项卡主视图模块入口。
 *
 * @remarks
 * 统一导出已装配完整原子控件与业务逻辑的 10 大设置与资产选项卡视图，
 * 包括通用配置、四大生图后端引擎、历史画廊、浮动按钮、主题外观、运行日志及关于面板。
 */

export type { SettingsView } from '../types';
export * from './general-tab';
export * from './comfyui-tab';
export * from './sdwebui-tab';
export * from './novelai-tab';
export * from './openai-tab';
export * from './logs-stats-tab';
export * from './about-tab';
export * from './theme-tab';
export * from './fab-tab';
export * from './gallery-tab';
export * from './provider-tab-template';
export * from './registry';
