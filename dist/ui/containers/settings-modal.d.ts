/**
 * @module ui/containers/settings-modal
 * @description 主设置弹窗控制器 (SettingsModal - 包含导航侧边栏、视图插槽调度、顶部工具栏与底部状态栏)
 */
import { IUIRegistry } from '../../core/registry/ui-registry';
import { IModalService } from '../services/modal-service';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IDisposable } from '../../core/foundation/disposable';
/**
 * 设置面板初始化参数选项
 */
export interface SettingsModalOptions {
    /** UI 贡献点注册中心 */
    uiRegistry: IUIRegistry;
    /** 全局模态框服务 */
    modalService: IModalService;
    /** 全局响应式状态配置中心 */
    store: ObservableStore<DrawAssistantSettings>;
    /** 插件当前版本号 */
    version?: string;
}
export declare class SettingsModal implements IDisposable {
    private readonly _uiRegistry;
    private readonly _modalService;
    private readonly _store;
    private readonly _version;
    private readonly _disposables;
    private _modalHandle?;
    private _activeTabId;
    private _currentTabDisposable?;
    private _heartbeatTimer;
    private _memoryTimer;
    private _isDisposed;
    constructor(options: SettingsModalOptions);
    open(initialTabId?: string): void;
    private renderHeaderBar;
    private renderFooterBar;
    private startTelemetry;
    private stopTelemetry;
    switchTab(tabId: string, container: HTMLElement): void;
    close(): void;
    dispose(): void;
}
//# sourceMappingURL=settings-modal.d.ts.map