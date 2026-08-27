/**
 * @module ui/tabs/theme-tab
 * @description 样式主题 Tab 组件 (Theme Settings Tab)
 *
 * 职责：
 * - 主题方案管理：切换方案、新建、保存修改、重命名、JSON 导入/导出与方案删除
 * - 调色盘与全屏实时响应：核心 CSS 变量（HEX/透明度/圆角/模糊度）与衍生色双向同步注入
 * - 草稿状态管理：调色盘修改实时驱动 DOM 显示但暂存为草稿，提示未保存状态，需手动保存生效
 * - 全局未保存拦截：注册至 unsavedStateManager，实现切 Tab 与关面板三按键 Modal 守护
 * - 控件同步维护：切换主题方案时自动同步调色盘 UI 控件状态并刷新实时效果预览条
 * - 全景主题覆盖：联动主面板、蓝图编辑器与各类浮层 Modal 样式
 */
import type { ThemeData } from '../../settings/types';
/**
 * 渲染主题设置 Tab 内容节点
 */
export declare function renderThemeTab(): HTMLElement;
/**
 * 获取指定主题 ID 对应的完整配置方案数据
 *
 * 级联顺延规则：
 * 1. 查找指定 themeId 对应的主题；
 * 2. 若未找到，打印 WARN 警告并自动顺延使用已注册主题列表中的首个可用主题；
 * 3. 兜底返回静态预设 DEFAULT_THEME_PROFILES 数组首项。
 */
export declare function getActiveScheme(themeId?: string): ThemeData & {
    id?: string;
    name?: string;
};
/**
 * 将指定主题方案中的基础与衍生 CSS 变量组实时注入关键 DOM 节点
 * （作用于根节点 document.documentElement 及挂载在 body 下的独立 Modal / 蓝图浮层）
 *
 * @param scheme 可选的目标主题配置
 * @param singleNode 可选的单个指定 DOM 节点（如动态创建的 Modal backdrop）
 */
export declare function applySchemeCSSVariables(scheme?: ThemeData & {
    id?: string;
    name?: string;
}, singleNode?: HTMLElement): void;
/**
 * 方便函数：向单独动态创建的 Node 节点同步注入当前系统主题变量
 */
export declare function applyCurrentThemeToNode(node: HTMLElement): void;
/**
 * 全盘应用插件独立主题（载入持久化配置并刷新 CSS 变量）
 */
export declare function applyPluginTheme(themeId: string): void;
//# sourceMappingURL=theme-tab.d.ts.map