/**
 * @module core/registry/ui-registry
 * @description UI 插槽与贡献点注册中心 (Tab 页、楼层操作按钮与悬浮球动作)
 */
import { IDisposable } from '../foundation/disposable';
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