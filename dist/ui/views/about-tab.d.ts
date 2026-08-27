/**
 * @module ui/views/about-tab
 * @description 关于与使用帮助面板视图 (AboutTab)
 */
import { IDisposable } from '../../core/foundation/disposable';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
/**
 * 构建并渲染关于与版本信息面板
 *
 * @param store 全局设置响应式 Store 实例
 * @returns 包含生命周期清理能力的关于面板 DOM 根节点
 */
export declare function createAboutTabView(store?: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable;
//# sourceMappingURL=about-tab.d.ts.map