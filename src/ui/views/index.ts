/**
 * 设置面板视图统一导出入口 (src/ui/views/index.ts)
 *
 * 功能：
 * 1. 导出通用基础、外观主题与快捷悬浮球设置面板；
 * 2. 导出 ComfyUI、SD-WebUI、NovelAI 与 OpenAI 四大生图引擎专属配置面板；
 * 3. 导出历史画廊、运行日志统计与版本关于选项卡。
 *
 * Tips：
 * 1. 统一遵循 renderXxxTab 渲染工厂接口，挂载至主模态窗外壳。
 */

export * from './general-tab';
export * from './theme-tab';
export * from './fab-settings-tab';
export * from './comfyui-tab';
export * from './sdwebui-tab';
export * from './novelai-tab';
export * from './openai-tab';
export * from './gallery-tab';
export * from './logs-and-stats-tab';
export * from './about-tab';
