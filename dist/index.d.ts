/**
 * @module index
 * @description ST-DrawAssistant 插件引导与生命周期装配入口 (Bootstrap)
 */
import { KernelContext } from './core';
export * from './core';
export { createGeneralTabView, createComfyUITabView, createSDWebUITabView, createThemeTabView, createDiagnosticsTabView, createGalleryTabView, createFABSettingsTabView, createAboutTabView } from './ui';
export * from './domain';
export * from './extensions/character-manager';
export type { ThemeData } from './core';
/**
 * 获取当前全局核心上下文实例
 *
 * @returns 当前全局激活的核心上下文实例，未初始化时为 null
 */
export declare function getKernelContext(): KernelContext | null;
/**
 * 插件顶层装配与全局启动入口 (Bootstrap)
 *
 * 执行步骤：
 * 1. 实例化核心全局上下文与强类型事件总线；
 * 2. 阻塞等待 SillyTavern 宿主环境沙箱就绪；
 * 3. 阻塞等待 IndexedDB 本地存储层初始化完成；
 * 4. 注册 ComfyUI 与 SD-WebUI 生图后端驱动；
 * 5. 初始化提示词流水线与任务调度状态机；
 * 6. 注册 8 大核心自带基础设置视图与生命周期管理；
 * 7. 装配角色与服装管理器扩展插件 (CharacterManagerExtension)；
 * 8. 初始化楼层生图按钮扫描与右下角 FAB 悬浮快捷球。
 *
 * @returns 装配完成的核心上下文实例
 */
export declare function bootstrap(): Promise<KernelContext>;
//# sourceMappingURL=index.d.ts.map