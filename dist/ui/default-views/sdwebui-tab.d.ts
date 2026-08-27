/**
 * @module ui/default-views/sdwebui-tab
 * @description Stable Diffusion WebUI (AUTOMATIC1111) 引擎配置面板视图 (包含服务连通性、采样参数与高清修复设置)
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDisposable } from '../../core/foundation/disposable';
/**
 * 构建并渲染 SD-WebUI 后端引擎配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的 SD-WebUI 配置面板 DOM 根节点
 */
export declare function createSdWebUITabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable;
export declare const createSDWebUITabView: typeof createSdWebUITabView;
//# sourceMappingURL=sdwebui-tab.d.ts.map