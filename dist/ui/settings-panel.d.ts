/**
 * @module ui/settings-panel
 * @description 设置面板 UI 控制器与主模态框调度器
 *
 * 职责：
 * - 渲染带有顶栏、左侧 Tab 导航栏、右侧内容栏、底栏的主模态框
 * - 结合 FAB 悬浮球及顶栏 macOS 风格红点按钮控制显隐
 * - 管理 9 大 Tab 的动态切换与激活 (接入 ThemeTab 和 FABSettingsTab)
 */
export type TabId = 'general' | 'comfyui' | 'sd-webui' | 'gallery' | 'character' | 'vocabulary' | 'theme' | 'fab-settings' | 'about' | 'diagnostics';
interface TabItem {
    id: TabId;
    label: string;
    icon: string;
}
/**
 * 根据当前选择的生图引擎及设置动态生成侧边栏 Tab 列表
 */
export declare function getActiveTabItems(): TabItem[];
/**
 * 初始化并挂载主面板模态框
 */
export declare function renderSettingsPanel(): Promise<void>;
/** 绑定 SillyTavern 原生扩展设置菜单模板中的控件事件 */
export declare function bindNativeSettingsTemplateEvents(): void;
/** 控制主模态框显示/隐藏 */
export declare function setMainModalVisible(visible: boolean): void;
/** 动态刷新侧边栏 Tab 列表 */
export declare function refreshSidebarTabs(): void;
/** 导出函数：一键同步重建顶栏 #da-quick-theme-select 选项并保持选中状态 */
export declare function refreshHeaderThemeSelect(): void;
export {};
//# sourceMappingURL=settings-panel.d.ts.map