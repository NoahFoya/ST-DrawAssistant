/**
 * @module ui/views/theme-tab
 * @description 外观主题定制面板视图 (ThemeTab) - 规范化 controls 架构版
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDisposable } from '../../core/foundation/disposable';
/**
 * 构建并渲染外观主题定制面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的主题定制面板 DOM 根节点
 */
export declare function createThemeTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable;
//# sourceMappingURL=theme-tab.d.ts.map