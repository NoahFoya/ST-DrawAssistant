/**
 * @module ui/components/preset-toolbar
 * @description 通用预设方案管理工具栏与适配器体系 (PresetToolbar & PresetToolbarAdapter)
 */
export interface PresetItem<T = unknown> {
    id: string;
    name: string;
    data?: T;
}
export interface PresetToolbarOptions {
    profiles?: PresetItem[];
    currentId?: string;
    isDraftDirty?: boolean;
    onSelect?: (id: string) => void;
    onNew?: () => void;
    onSave?: () => void;
    onRename?: () => void;
    onExport?: () => void;
    onImport?: (content: string, fileName: string) => void;
    onReset?: () => void;
    onDelete?: () => void;
}
export type PresetToolbarElement = HTMLDivElement & {
    getCurrentData?: () => unknown;
    refreshPresets?: (presets: PresetItem[], activeId: string, isDirty?: boolean) => void;
};
/**
 * 预设方案操作适配器接口
 */
export interface PresetToolbarAdapter<T = unknown> {
    /** 工具栏业务名称标签 (如 "角色预设", "服装预设") */
    label: string;
    /** 获取方案列表 */
    getProfiles: () => PresetItem<T>[];
    /** 获取初始激活的方案 ID */
    getInitialId: () => string;
    /** 创建新方案并返回其 ID */
    createProfile: (name: string, data: T) => string | Promise<string>;
    /** 保存更新指定方案 */
    saveProfile: (id: string, data: T) => void | Promise<void>;
    /** 重命名指定方案 */
    renameProfile: (id: string, newName: string) => void | Promise<void>;
    /** 删除指定方案并返回切换后的下一个有效方案 ID */
    deleteProfile: (id: string) => string | Promise<string>;
    /** 重置恢复为默认预设方案 */
    resetToDefault: () => void | Promise<void>;
    /** 选中切换方案时的回调 */
    onSelect?: (id: string) => Promise<void> | void;
}
/**
 * 渲染通用预设方案工具栏 DOM 节点
 *
 * @param options 工具栏配置选项与操作回调
 * @returns 预设工具栏 DOM 根节点
 */
export declare function renderPresetToolbar(options: PresetToolbarOptions): PresetToolbarElement;
export interface BoundPresetToolbarOptions<T = unknown> {
    adapter: PresetToolbarAdapter<T>;
    getCurrentData: () => T;
    applyData: (id: string) => void;
    onRefresh: () => void;
}
export declare function bindPresetToolbar<T>(options: BoundPresetToolbarOptions<T>): PresetToolbarElement;
//# sourceMappingURL=preset-toolbar.d.ts.map