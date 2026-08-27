/**
 * @module ui/fab
 * @description FAB (Floating Action Button) 快捷悬浮球组件
 *
 * 职责：
 * - 页面悬浮球挂载与视口边界守护
 * - 自动记忆最后拖拽位置 (Position Persistence)，防止超出视口
 * - 拖拽/放开即时保存配置，支持样式与图标动态实时更新
 * - 订阅 DA_EVENTS.SETTINGS_CHANGED 实现设置变更后样式自动同步（响应式）
 */
export interface FabPresetIcon {
    name: string;
    svg: string;
}
export declare const FAB_PRESET_ICONS: Record<string, FabPresetIcon>;
/** 悬浮面板展开状态下的简洁关闭 SVG Icon */
export declare const FAB_CLOSE_ICON_SVG = "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg>";
/** 安全获取预设 SVG 字符串 */
export declare function getPresetSvg(key?: string): string;
/**
 * 初始化并挂载 FAB 悬浮球
 */
export declare function initFAB(onToggleClick?: (open: boolean) => void): HTMLElement;
/**
 * 从最新配置同步刷新悬浮球的渲染外观 (供悬浮窗设置 Tab 实时更新)
 * 涵盖：显隐状态、不透明度材质与 Icon Emoji
 */
export declare function applyFABStylesFromSettings(): void;
/**
 * 将悬浮球重置定位到屏幕右下角默认位置，并即时保存
 */
export declare function resetFABPosition(): void;
/**
 * 切换主模态面板的展开/关闭状态，并联动更新悬浮球按键图标
 *
 * @param forceState 强制指定展开状态 (true 展开, false 收起)
 */
export declare function toggleFABPanelState(forceState?: boolean): void;
//# sourceMappingURL=fab.d.ts.map