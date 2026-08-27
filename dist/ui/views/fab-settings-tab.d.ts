/**
 * @module ui/views/fab-settings-tab
 * @description 悬浮快捷球 (FAB) 配置面板视图 (FABSettingsTab) - 声明式 Schema 架构重构版
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDisposable } from '../../core/foundation/disposable';
export declare const FAB_TAB_PRESET_ICONS: Record<string, {
    name: string;
    emoji: string;
}>;
/**
 * 构建并渲染悬浮快捷球配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的悬浮球配置面板 DOM 根节点
 */
export declare function createFABSettingsTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable;
//# sourceMappingURL=fab-settings-tab.d.ts.map