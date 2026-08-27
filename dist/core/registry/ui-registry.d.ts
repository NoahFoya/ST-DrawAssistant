/**
 * @module core/registry/ui-registry
 * @description UI 插槽与贡献点注册中心 (TabSlotDescriptor, FloorButtonSlotDescriptor, IUIRegistry)
 */
import { IDisposable } from '../foundation/disposable';
import { HostMessageEvent } from '../foundation/host-bridge';
export interface TabSlotDescriptor {
    readonly id: string;
    readonly title: string;
    readonly icon?: string;
    readonly order?: number;
    readonly isBuiltIn?: boolean;
    render(container: HTMLElement): IDisposable | void;
}
export interface FloorButtonSlotDescriptor {
    readonly id: string;
    readonly label: string;
    readonly icon?: string;
    shouldRender?(message: HostMessageEvent): boolean;
    onClick(message: HostMessageEvent): void;
}
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
export declare class UIRegistry implements IUIRegistry {
    private readonly _tabs;
    private readonly _floorButtons;
    private readonly _fabActions;
    private readonly _logger;
    private _isDisposed;
    registerTab(tab: TabSlotDescriptor): IDisposable;
    getTabs(): TabSlotDescriptor[];
    getTab(id: string): TabSlotDescriptor | undefined;
    registerFloorButton(button: FloorButtonSlotDescriptor): IDisposable;
    getFloorButtons(): FloorButtonSlotDescriptor[];
    registerFabAction(action: FabActionDescriptor): IDisposable;
    getFabActions(): FabActionDescriptor[];
    dispose(): void;
}
//# sourceMappingURL=ui-registry.d.ts.map