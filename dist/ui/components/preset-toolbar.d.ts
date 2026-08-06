/**
 * @module ui/components/preset-toolbar
 * @description 统一预设方案下拉选择与管理工具栏通用组件 (PresetToolbar)
 *
 * 职责：
 *   - 全插件 100% 标准化工具栏布局与 Icon 序列 (8 图标 FontAwesome)
 *   - ➕ 新建 · 💾 保存 · 📄➔ 另存为 · ✏️ 重命名 · 📤 导出 JSON · 📥 导入 JSON · ↺ 恢复默认 · 🗑️ 删除
 */
import type { PresetProfileItem } from '../../settings/types';
export interface PresetToolbarOptions<T = Record<string, unknown>> {
    /** 默认方案备用显示名称 */
    defaultName?: string;
    /** 用户保存的预设方案列表 */
    profiles: PresetProfileItem<T>[];
    /** 当前选中的方案 ID */
    currentId: string;
    /** 下拉框切换回调 */
    onSelect: (id: string) => void;
    /** ➕ 新建方案回调 */
    onNew: () => void;
    /** 💾 保存方案回调 */
    onSave: () => void;
    /** 📄➔ 另存为新方案回调 (可选) */
    onSaveAs?: () => void;
    /** ✏️ 重命名方案回调 */
    onRename: () => void;
    /** 📤 导出方案回调 */
    onExport: () => void;
    /** 📥 导入方案回调 */
    onImport: (content: string, fileName: string) => void;
    /** ↺ 恢复默认预设回调 (可选) */
    onReset?: () => void;
    /** 🗑️ 删除方案回调 */
    onDelete: () => void;
}
/**
 * 渲染全插件统一样式的 Preset Toolbar 容器 (8 个标准 Icon 按钮)
 */
export declare function renderPresetToolbar<T = Record<string, unknown>>(options: PresetToolbarOptions<T>): HTMLElement;
//# sourceMappingURL=preset-toolbar.d.ts.map