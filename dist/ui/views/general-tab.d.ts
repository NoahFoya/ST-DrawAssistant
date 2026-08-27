/**
 * @module ui/views/general-tab
 * @description 常规主要设置面板视图 (主要设置 Tab) - 声明式 Schema 架构重构版
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDisposable } from '../../core/foundation/disposable';
import { IExtensionRegistry } from '../../core/registry/extension-registry';
/**
 * 构建并渲染通用主要设置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @param _extensionRegistry 扩展注册中心
 * @returns 包含生命周期清理能力的设置面板 DOM 根节点
 */
export declare function createGeneralTabView(store: ObservableStore<DrawAssistantSettings>, _extensionRegistry?: IExtensionRegistry): HTMLElement & IDisposable;
//# sourceMappingURL=general-tab.d.ts.map