/**
 * @module core/registry/ui-registry
 * @description UI 插槽与贡献点注册中心 (Tab 页、楼层操作按钮与悬浮球动作)
 */

import { IDisposable, toDisposable } from '../foundation/disposable';
import { Logger } from '../diagnostics/logger';
import { HostMessageEvent } from '../foundation/host-bridge';

/** Tab 页面插槽描述符 */
export interface TabSlotDescriptor {
    readonly id: string;
    readonly title: string;
    readonly icon?: string;
    readonly order?: number;
    readonly isBuiltIn?: boolean;
    render(container: HTMLElement): IDisposable | void;
}

/** 楼层操作按钮描述符 */
export interface FloorButtonSlotDescriptor {
    readonly id: string;
    readonly label: string;
    readonly icon?: string;
    shouldRender?(message: HostMessageEvent): boolean;
    onClick(message: HostMessageEvent): void;
}

/** 全局悬浮球动作描述符 */
export interface FabActionDescriptor {
    readonly id: string;
    readonly title: string;
    readonly icon: string;
    readonly onClick: () => void;
}

export interface IUIRegistry extends IDisposable {
    registerTab(tab: TabSlotDescriptor): IDisposable;
    getTabs(): TabSlotDescriptor[];
    getTab(id: string): TabSlotDescriptor | undefined;

    registerFloorButton(button: FloorButtonSlotDescriptor): IDisposable;
    getFloorButtons(): FloorButtonSlotDescriptor[];

    registerFabAction(action: FabActionDescriptor): IDisposable;
    getFabActions(): FabActionDescriptor[];
}

export class UIRegistry implements IUIRegistry {
    private readonly _tabs = new Map<string, TabSlotDescriptor>();
    private readonly _floorButtons = new Map<string, FloorButtonSlotDescriptor>();
    private readonly _fabActions = new Map<string, FabActionDescriptor>();
    private readonly _logger = new Logger('UIRegistry');
    private _isDisposed = false;

    public registerTab(tab: TabSlotDescriptor): IDisposable {
        if (this._tabs.has(tab.id)) {
            this._logger.warn(`Tab [${tab.id}] 已存在，覆盖注册`);
        }
        this._tabs.set(tab.id, tab);
        this._logger.info(`注册 Tab 插槽: ${tab.title} [${tab.id}]`);

        return toDisposable(() => {
            this._tabs.delete(tab.id);
        });
    }

    public getTabs(): TabSlotDescriptor[] {
        return Array.from(this._tabs.values()).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
    }

    public getTab(id: string): TabSlotDescriptor | undefined {
        return this._tabs.get(id);
    }

    public registerFloorButton(button: FloorButtonSlotDescriptor): IDisposable {
        this._floorButtons.set(button.id, button);
        return toDisposable(() => {
            this._floorButtons.delete(button.id);
        });
    }

    public getFloorButtons(): FloorButtonSlotDescriptor[] {
        return Array.from(this._floorButtons.values());
    }

    public registerFabAction(action: FabActionDescriptor): IDisposable {
        this._fabActions.set(action.id, action);
        return toDisposable(() => {
            this._fabActions.delete(action.id);
        });
    }

    public getFabActions(): FabActionDescriptor[] {
        return Array.from(this._fabActions.values());
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._tabs.clear();
        this._floorButtons.clear();
        this._fabActions.clear();
    }
}
