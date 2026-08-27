/**
 * @module ui/presets/preset-manager
 * @description 预设方案管理工具栏、下拉切换与 CRUD 交互中枢 (Presets Domain)
 */
/** 预设方案下拉选项条目结构 */
export interface PresetItem<T = unknown> {
    id: string;
    name: string;
    data?: T;
}
/**
 * 预设方案工具栏回调与配置接口
 */
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
 * 统一预设方案操作适配器接口
 */
export interface PresetToolbarAdapter<T = unknown> {
    label: string;
    getProfiles: () => PresetItem<T>[];
    getInitialId: () => string;
    createProfile: (name: string, data: T) => string | Promise<string>;
    saveProfile: (id: string, data: T) => void | Promise<void>;
    renameProfile: (id: string, newName: string) => void | Promise<void>;
    deleteProfile: (id: string) => string | Promise<string>;
    resetToDefault: () => void | Promise<void>;
    exportProfile?: (id: string, data: T) => void;
    importProfile?: (content: string, fileName: string) => string | null | Promise<string | null>;
    onSelect?: (id: string) => Promise<void> | void;
    canDelete?: (id: string) => {
        allowed: boolean;
        reason?: string;
    };
}
/**
 * 渲染通用的预设方案下拉选择与操作工具栏
 */
export declare function renderPresetToolbar(options: PresetToolbarOptions): PresetToolbarElement;
export interface BoundPresetToolbarOptions<T = unknown> {
    adapter: PresetToolbarAdapter<T>;
    getCurrentData?: () => T;
    applyData?: (id: string) => void;
    onRefresh?: () => void;
    onBeforeSelect?: (id: string) => Promise<boolean>;
    onSaveOverride?: () => void;
    onApplied?: (profile: PresetItem<T>) => void;
}
/**
 * 绑定并运行通用的预设方案工具栏
 */
export declare function bindPresetToolbar<T = unknown>(options: BoundPresetToolbarOptions<T>): PresetToolbarElement;
//# sourceMappingURL=preset-manager.d.ts.map