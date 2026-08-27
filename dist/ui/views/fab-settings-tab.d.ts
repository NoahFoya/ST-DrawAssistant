/**
 * @module ui/views/fab-settings-tab
 * @description 悬浮球 (FAB) 专属配置面板视图 (包含显示开关、透明度滑块、预设/自定义图标选择与位置重置)
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
/**
 * 构建并渲染悬浮快捷球配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 悬浮球配置面板 DOM 根节点
 */
export declare function createFABSettingsTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement;
//# sourceMappingURL=fab-settings-tab.d.ts.map