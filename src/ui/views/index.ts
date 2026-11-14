/**
 * 功能页面选项卡主视图模块入口。
 *
 * @remarks
 * 统一导出主设置模态窗中装配的各功能选项卡视图，
 * 包括通用配置、四大生图后端引擎、提示词、素材库、本地词库、本地图库、主题外观、悬浮球、运行日志及关于面板。
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
export * from './materials-tab';
export * from './materials/material-types';
export * from './prompts-tab';
export * from './lexicon-tab';
export * from './gallery-tab';
export * from './fab-tab';
export * from './provider-tab-layout';
export * from './registry';
