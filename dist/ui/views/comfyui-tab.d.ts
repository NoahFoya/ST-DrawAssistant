/**
 * @module ui/views/comfyui-tab
 * @description ComfyUI 专属配置面板视图 (包含服务器连接、模型/采样器选择、工作流管理与注入节点映射)
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDisposable } from '../../core/foundation/disposable';
/**
 * 构建并渲染 ComfyUI 后端引擎配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的 ComfyUI 配置面板 DOM 根节点
 */
export declare function createComfyUITabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable;
//# sourceMappingURL=comfyui-tab.d.ts.map