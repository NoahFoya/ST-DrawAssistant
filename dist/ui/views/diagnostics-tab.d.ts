/**
 * @module ui/views/diagnostics-tab
 * @description 运行诊断与实时日志面板视图 (DiagnosticsTab)
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDisposable } from '../../core/foundation/disposable';
/**
 * 渲染生图成功率与平均耗时统计卡片组件 (Diagnostics 内置看板)
 */
export declare function renderStatisticsCard(): HTMLElement;
/**
 * 构建并渲染运行诊断与实时日志面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的诊断日志面板 DOM 根节点
 */
export declare function createDiagnosticsTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable;
//# sourceMappingURL=diagnostics-tab.d.ts.map