/**
 * @module index
 * @description ST-DrawAssistant 插件引导与生命周期装配入口 (Bootstrap)
 */
import { KernelContext } from './core';
export * from './core';
export { createGeneralTabView, createComfyUITabView, createSDWebUITabView, createOpenAITabView, createNovelAITabView, createThemeTabView, createDiagnosticsTabView, createGalleryTabView, createFABSettingsTabView, createAboutTabView } from './ui';
/**
 * 获取当前全局核心内核上下文单例 (若插件未初始化完成则返回 null)
 *
 * @returns 核心上下文实例或 null
 */
export declare function getKernelContext(): KernelContext | null;
/**
 * 插件全局引导装配入口函数 (Bootstrap)
 *
 * 执行全链路系统装配流程：
 * 1. 创建核心上下文环境与响应式配置 Store；
 * 2. 初始化核心基础组件 (I18n, Logger, EventBus, Storage, PresetRegistry)；
 * 3. 注册四大核心生图引擎驱动 (ComfyUI / SD-WebUI / NovelAI / OpenAI)；
 * 4. 注册内置功能扩展 (角色预设、负向词库、提示词模板、Inpaint 局部重绘)；
 * 5. 初始化交互容器 (FloorButton, FAB 悬浮球, SettingsModal 设置弹窗)；
 * 6. 注册内置视图面板 (TabSlotDescriptor 格式)；
 *
 * @returns 初始化装配完成的 KernelContext 实例
 */
export declare function bootstrap(): Promise<KernelContext>;
//# sourceMappingURL=index.d.ts.map