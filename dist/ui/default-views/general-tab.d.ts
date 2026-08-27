/**
 * @module ui/default-views/general-tab
 * @description 通用常规设置面板视图 (包含运行模式、生图服务选择、默认参数、占位符规则与本地存储管理)
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDisposable } from '../../core/foundation/disposable';
/**
 * 构建并渲染通用常规设置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的设置面板 DOM 根节点
 */
export declare function createGeneralTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable;
//# sourceMappingURL=general-tab.d.ts.map