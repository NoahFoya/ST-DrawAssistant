/**
 * @module ui/components/preset-toolbar
 * @description 预设方案下拉选择与预设管理工具栏组件 (PresetToolbar)
 *
 * 职责：
 *   - ✏️ 重命名方案
 *   - 📥 导入方案 JSON
 *   - 📤 导出方案 JSON
 *   - 🗑️ 删除方案 (所有预设均可自主编辑删除)
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
    /** ✏️ 重命名方案回调 */
    onRename: () => void;
    /** 📥 导入方案回调 */
    onImport: (content: string, fileName: string) => void;
    /** 📤 导出方案回调 */
    onExport: () => void;
    /** 🗑️ 删除方案回调 */
    onDelete: () => void;
}
/**
 * 渲染响应式 Preset Toolbar 容器
 */
export declare function renderPresetToolbar<T = Record<string, unknown>>(options: PresetToolbarOptions<T>): HTMLElement;
//# sourceMappingURL=preset-toolbar.d.ts.map