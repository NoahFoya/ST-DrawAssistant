/**
 * @module ui/views/theme-tab
 * @description 外观主题定制面板视图 (包含预设主题管理、自定义调色板配置与 CSS 变量实时预览)
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
/**
 * 构建并渲染外观主题定制面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 主题定制面板 DOM 根节点
 */
export declare function createThemeTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement;
//# sourceMappingURL=theme-tab.d.ts.map