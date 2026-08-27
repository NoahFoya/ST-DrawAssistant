/**
 * @module ui/index
 * @description UI 交互与设计系统层统一聚合导出入口
 */

// 1. 基础设施域 (Foundation Domain)
export * from './foundation';

// 2. 表单控件域 (Controls Domain)
export * from './controls';

// 3. 核心交互与反馈域 (Feedback Domain)
export * from './feedback';

// 4. 预设与工作流管理域 (Presets Domain)
export * from './presets';

// 5. 媒体与画廊域 (Media Domain)
export * from './media';

// 6. 宿主布局骨架域 (Layout Domain)
export * from './layout';

// 7. 各 Tab 装配视图 (Views)
export * from './views/general-tab';
export * from './views/comfyui-tab';
export * from './views/sdwebui-tab';
export * from './views/openai-tab';
export * from './views/novelai-tab';
export * from './views/theme-tab';
export * from './views/diagnostics-tab';
export * from './views/gallery-tab';
export * from './views/fab-settings-tab';
export * from './views/about-tab';
