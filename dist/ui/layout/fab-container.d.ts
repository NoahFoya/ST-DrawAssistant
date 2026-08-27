/**
 * @module ui/layout/fab-container
 * @description 屏幕悬浮快捷动作按钮控制器 (FABContainer)
 */
import { IDisposable } from '../../core/foundation/disposable';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { SettingsModal } from './settings-modal';
export interface FabPresetIcon {
    name: string;
    svg: string;
}
export declare const FAB_PRESET_ICONS: Record<string, FabPresetIcon>;
export declare const FAB_CLOSE_ICON_SVG = "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg>";
export declare function getPresetSvg(key?: string): string;
export interface FABContainerOptions {
    store: ObservableStore<DrawAssistantSettings>;
    settingsModal: SettingsModal;
}
export declare class FABContainer implements IDisposable {
    private readonly _store;
    private readonly _settingsModal;
    private _fabElement?;
    private readonly _disposables;
    private _isDisposed;
    private _justDragged;
    constructor(options: FABContainerOptions);
    private init;
    private renderFAB;
    private applyStyles;
    private restorePosition;
    private enableDrag;
    private clampToViewport;
    dispose(): void;
}
//# sourceMappingURL=fab-container.d.ts.map