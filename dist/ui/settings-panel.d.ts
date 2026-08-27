/**
 * @module ui/settings-panel
 * @description 设置面板 UI 控制器与主模态框调度器
 *
 * 职责：
 * - 渲染带有顶栏、左侧 Tab 导航栏、右侧内容栏、底栏的主模态框
 * - 结合 FAB 悬浮球及顶栏 macOS 风格红点按钮控制显隐
 * - 管理 10 大 Tab 的动态切换与激活 (general / comfyui / sd-webui / gallery / character / vocabulary / theme / fab-settings / about / diagnostics)
 * - 内聚实现 FooterBar 底栏状态栏 (包含 10s 服务器连通性心跳探针与 3s JS Heap 内存开销监测)
 */
export type TabId = 'general' | 'comfyui' | 'sd-webui' | 'gallery' | 'character' | 'vocabulary' | 'theme' | 'fab-settings' | 'about' | 'diagnostics';
interface TabItem {
    id: TabId;
    label: string;
    icon: string;
}
/**
 * 根据当前选择的生图引擎及设置动态生成侧边栏 Tab 列表
 *
 * @returns 包含已激活 Tab 项清单的数组
 */
export declare function getActiveTabItems(): TabItem[];
/**
 * 停止底部状态栏轮询（在主面板隐藏/销毁时调用）
 */
export declare function stopTelemetry(): void;
/**
 * 渲染并挂载主组件设置模态框 (包含顶栏、侧边栏 Tab 导航、中央内容区与底部状态栏)
 *
 * @returns 主模态框 DOM 节点
 */
export declare function renderSettingsPanel(): HTMLElement;
/** 绑定 SillyTavern 原生扩展设置菜单模板中的控件事件 */
export declare function bindNativeSettingsTemplateEvents(): void;
/**
 * 带未保存检测拦截的优雅切换 Tab
 *
 * @param tabId 目标 Tab 标识符
 */
export declare function safeSwitchTab(tabId: TabId): Promise<void>;
/**
 * 带未保存检测拦截的优雅关闭面板
 */
export declare function safeClosePanel(): Promise<void>;
/**
 * 控制主模态框显示/隐藏
 *
 * @param visible 是否可见
 */
export declare function setMainModalVisible(visible: boolean): void;
/** 动态刷新侧边栏 Tab 列表 */
export declare function refreshSidebarTabs(): void;
/** 导出函数：一键同步重建顶栏 #da-quick-theme-select 选项并保持选中状态 */
export declare function refreshHeaderThemeSelect(): void;
/**
 * 刷新独立置顶悬浮未保存提示栏 (Floating Viewport Banner)
 */
export declare function updateFloatingUnsavedBanner(): void;
export {};
//# sourceMappingURL=settings-panel.d.ts.map