/**
 * @module ui/views/novelai-tab
 * @description NovelAI 生图后端配置面板视图 (NovelAI Tab) - 声明式 Schema 架构重构版
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import type { IDriverRegistry } from '../../core/registry/driver-registry';
import { IDisposable } from '../../core/foundation/disposable';
/**
 * 构建并渲染 NovelAI 后端配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @param drivers 生图驱动注册中心抽象
 * @returns 包含生命周期清理能力的 NovelAI 配置面板 DOM 根节点
 */
export declare function createNovelAITabView(store: ObservableStore<DrawAssistantSettings>, drivers?: IDriverRegistry): HTMLElement & IDisposable;
//# sourceMappingURL=novelai-tab.d.ts.map