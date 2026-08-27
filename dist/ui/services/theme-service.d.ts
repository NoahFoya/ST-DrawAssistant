/**
 * @module ui/services/theme-service
 * @description 外观主题服务 (动态管理与注入全局 --da-* 设计变量)
 */
import { IDisposable } from '../../core/foundation/disposable';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings, ThemeData } from '../../core/state/store-types';
export type { ThemeData };
export interface IThemeService extends IDisposable {
    applyTheme(themeData?: Partial<ThemeData>, targetNode?: HTMLElement): void;
    getCurrentTheme(): ThemeData;
    setThemePreset(presetId: string): void;
}
/**
 * 系统安全防呆兜底主题 (当未配置任何主题或配置损坏时生效)
 */
export declare const FALLBACK_SAFE_THEME: ThemeData;
export declare class ThemeService implements IThemeService {
    private readonly _store;
    private _subPreset?;
    private _subCustom?;
    private _isDisposed;
    constructor(store: ObservableStore<DrawAssistantSettings>);
    private initThemeListener;
    getCurrentTheme(): ThemeData;
    setThemePreset(presetId: string): void;
    applyTheme(themeData?: Partial<ThemeData>, targetNode?: HTMLElement): void;
    dispose(): void;
}
//# sourceMappingURL=theme-service.d.ts.map