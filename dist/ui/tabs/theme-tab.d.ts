/**
 * @module ui/tabs/theme-tab
 * @description 样式主题 Tab 组件 (Theme Settings Tab)
 *
 * 职责：
 * - 主题方案管理：切换、新建、保存、重命名、JSON 导入/导出与物理删除
 * - 调色盘与 Live 实时预览：支持 7 大核心 CSS 变量 HEX/RGB 变量双同步
 * - 顶栏下拉框联动：Theme Token 改动即时注入 DOM 并刷动顶栏 #da-quick-theme-select 状态
 */
import type { CustomThemeScheme } from '../../settings/types';
/**
 * 渲染主题设置 Tab 内容节点
 */
export declare function renderThemeTab(): HTMLElement;
/**
 * 获取指定主题 ID 对应的完整配置方案数据
 */
export declare function getActiveScheme(themeId?: string): CustomThemeScheme;
/**
 * 全盘应用插件独立主题 Token (包含 --da-accent-rgb 变量与顶栏下拉菜单 rebuild)
 */
export declare function applyPluginTheme(themeId: string): void;
//# sourceMappingURL=theme-tab.d.ts.map