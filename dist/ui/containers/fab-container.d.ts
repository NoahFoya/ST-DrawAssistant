/**
 * @module ui/containers/fab-container
 * @description 屏幕右下角悬浮快捷按钮控制器 (FABContainer - 支持拖拽、显隐联动与一键呼出设置面板)
 */
import { IDisposable } from '../../core/foundation/disposable';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { SettingsModal } from './settings-modal';
/**
 * 悬浮快捷球初始化参数选项
 */
export interface FABContainerOptions {
    /** 全局响应式状态配置中心 */
    store: ObservableStore<DrawAssistantSettings>;
    /** 主设置面板控制器实例 */
    settingsModal: SettingsModal;
}
export declare class FABContainer implements IDisposable {
    private readonly _store;
    private readonly _settingsModal;
    private _fabElement?;
    private _sub?;
    private _isDisposed;
    constructor(options: FABContainerOptions);
    private init;
    private renderFAB;
    dispose(): void;
}
//# sourceMappingURL=fab-container.d.ts.map