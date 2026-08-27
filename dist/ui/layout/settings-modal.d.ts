/**
 * @module ui/layout/settings-modal
 * @description 主设置弹窗控制器 (SettingsModal)
 */
import { IUIRegistry } from '../../core/registry/ui-registry';
import { IModalService } from '../feedback/modal-service';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import type { IDriverRegistry } from '../../core/registry/driver-registry';
import { IDisposable } from '../../core/foundation/disposable';
export interface SettingsModalOptions {
    uiRegistry: IUIRegistry;
    modalService: IModalService;
    store: ObservableStore<DrawAssistantSettings>;
    drivers?: IDriverRegistry;
    version?: string;
}
export declare class SettingsModal implements IDisposable {
    private readonly _uiRegistry;
    private readonly _modalService;
    private readonly _store;
    private readonly _drivers?;
    private readonly _version;
    private readonly _disposables;
    private _modalHandle?;
    private _activeTabId;
    private _sidebarEl?;
    private _currentTabDisposable?;
    private _isDisposed;
    constructor(options: SettingsModalOptions);
    open(initialTabId?: string): void;
    private renderHeaderBar;
    private renderFooterBar;
    switchTab(tabId: string, container: HTMLElement): Promise<boolean>;
    close(): Promise<boolean>;
    dispose(): void;
}
//# sourceMappingURL=settings-modal.d.ts.map