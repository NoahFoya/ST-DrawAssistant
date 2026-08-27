/**
 * @module ui/foundation/theme-service
 * @description 外观主题服务 (单一事实来源，负责动态计算并注入全局 --da-* CSS 设计变量)
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
/** 系统备用主题 (直接引用全局默认主题常量) */
export declare const FALLBACK_SAFE_THEME: ThemeData;
/**
 * 将十六进制色值解析为 [R, G, B] 数字数组
 */
export declare function hexToRgbArr(hexStr: string): [number, number, number];
/**
 * 将十六进制色值解析为 R, G, B 字符串 (如 "0, 242, 254")
 */
export declare function hexToRgb(hexStr: string): string;
/**
 * 将 [R, G, B] 数字数组转换为十六进制 HEX 颜色字符串
 */
export declare function rgbArrToHex([r, g, b]: [number, number, number]): string;
/**
 * 线性插值两个 HEX 颜色
 * @param t 插值系数 (t > 1 表示延伸外插)
 */
export declare function lerpHex(from: string, to: string, t: number): string;
/**
 * HEX 转 HSL [0-360, 0-1, 0-1]
 */
export declare function hexToHsl(hex: string): [number, number, number];
/**
 * HSL 转 HEX
 */
export declare function hslToHex(h: number, s: number, l: number): string;
/**
 * 动态派生强调色的高光/悬停发光色 (基于 HSL 亮度微调)
 */
export declare function deriveAccentHover(accentHex: string): string;
/**
 * 全局统一外观主题服务
 */
export declare class ThemeService implements IThemeService {
    private readonly _store;
    private _subPreset?;
    private _subCustom?;
    private _isDisposed;
    constructor(store: ObservableStore<DrawAssistantSettings>);
    private initThemeListener;
    getCurrentTheme(): ThemeData;
    setThemePreset(presetId: string): void;
    /**
     * 静态纯函数：向指定 DOM 或全局节点注入全量主题变量及衍生变量
     */
    static applyThemeVariables(theme: ThemeData, targetNode?: HTMLElement): void;
    applyTheme(themeData?: Partial<ThemeData>, targetNode?: HTMLElement): void;
    static applyCurrentThemeToNode(targetNode: HTMLElement): void;
    dispose(): void;
}
//# sourceMappingURL=theme-service.d.ts.map