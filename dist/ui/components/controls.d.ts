/**
 * @module ui/components/controls
 * @description 扩展统一基础 UI 控件与渲染部件库 (Consolidated Controls)
 *
 * 职责：
 * - BLOCK 1: 表单行基础控件 (createFieldRow)
 * - BLOCK 2: 预设方案操作工具栏 (renderPresetToolbar)
 * - BLOCK 3: 设置面板主底栏 (renderFooterBar)
 * - BLOCK 4: 存储容量指示条 (renderStorageBar)
 * - BLOCK 5: 历史生成统计卡片 (renderStatisticsCard)
 * - BLOCK 6: 图像操作栏控件 (openImageActionPanel)
 */
import { type ProfileCategory } from '../../settings/manager';
export interface FieldRowOptions {
    label: string;
    description?: string;
    helpTooltip?: string;
    headerAction?: any;
    isBlock?: boolean;
    type?: 'text' | 'number' | 'password' | 'checkbox' | 'select' | 'textarea' | 'range' | string;
    value?: string | number | boolean;
    placeholder?: string;
    options?: Array<{
        label: string;
        value: string | number;
    }>;
    min?: number;
    max?: number;
    step?: number;
    control?: any;
    onChange?: (value: any) => void;
    [key: string]: any;
}
export type FieldRowResult = HTMLDivElement & {
    element: HTMLElement;
    input: HTMLElement;
    setValue: (val: string | number | boolean) => void;
};
/**
 * 创建标准的设置项表单行节点
 *
 * @param options 表单行类型、标签与回调配置
 * @returns 包含 DOM 根节点、Input 节点与 setValue 方法的复合 Element
 */
export declare function createFieldRow(options: FieldRowOptions): HTMLElement;
/** 预设方案下拉选项条目结构 */
export interface PresetItem {
    id: string;
    name: string;
    isSystemPreset?: boolean;
    data?: any;
}
/**
 * 预设方案工具栏配置接口
 */
export interface PresetToolbarOptions {
    /** 预设方案列表 */
    profiles?: PresetItem[];
    /** 当前选中的预设 ID */
    currentId?: string;
    /** 草稿未保存标记 (Dirty Badge) */
    isDraftDirty?: boolean;
    /** 下拉框选中预设回调 */
    onSelect?: (id: string) => void;
    /** ➕ 新建预设方案回调 */
    onNew?: () => void;
    /** 💾 保存预设方案回调 */
    onSave?: () => void;
    /** ✏️ 重命名预设方案回调 */
    onRename?: () => void;
    /** 📤 导出预设方案回调 */
    onExport?: () => void;
    /** 📥 导入预设方案回调 */
    onImport?: (content: string, fileName: string) => void;
    /** 🔄 重置内置预设方案回调 */
    onReset?: () => void;
    /** 🗑️ 删除预设方案回调 */
    onDelete?: () => void;
}
/**
 * 预设工具栏 DOM 节点，附带控制句柄
 */
export type PresetToolbarElement = HTMLDivElement & {
    /** 获取当前组件表单数据 (由 bindPresetToolbar 绑定注入) */
    getCurrentData?: () => unknown;
    /** 动态刷新预设下拉列表与操作按钮状态 */
    refreshPresets?: (presets: PresetItem[], activeId: string, isDirty?: boolean) => void;
};
/**
 * 渲染纯化后的预设方案下拉选择与操作工具栏组件
 *
 * @param options 预设列表及增删改查导出回调配置
 * @returns 包含工具栏 DOM 根节点与 refreshPresets 刷新方法的 PresetToolbarElement
 */
export declare function renderPresetToolbar(options: PresetToolbarOptions): PresetToolbarElement;
/**
 * 预设方案直接控件绑定配置选项
 */
export interface BoundPresetToolbarOptions {
    /** 预设方案类别标识 */
    category: ProfileCategory;
    /** 获取当前表单内待保存数据的闭包 */
    getCurrentData: () => unknown;
    /** 切换选中预设后的 UI 刷新回调 */
    applyData: (id: string) => void;
    /** CRUD 操作完成后的 Tab 重建/刷新回调 */
    onRefresh: () => void;
    /**
     * 切换选中预设前置拦截回调（支持异步拦截，返回 false 可阻止切换）
     */
    onBeforeSelect?: (id: string) => Promise<boolean>;
    /**
     * 覆盖默认保存行为的自定义扩展回调
     */
    onSaveOverride?: () => void;
}
/**
 * 预设方案直接控件绑定函数
 */
export declare function bindPresetToolbar(options: BoundPresetToolbarOptions): PresetToolbarElement;
/**
 * 渲染主设置面板的底栏组件
 *
 * @returns 底栏 DOM 根节点
 */
export declare function renderFooterBar(): HTMLElement;
export declare function refreshFooterStatus(): void;
/**
 * 渲染 IndexedDB 存储空间与配额占比指示条组件
 *
 * @returns 指示条 DOM 节点
 */
export declare function renderStorageBar(_options?: any): HTMLElement;
export interface StatisticsData {
    totalGenerations: number;
    successfulGenerations: number;
    failedGenerations: number;
    averageTimeMs: number;
    totalTimeMs: number;
}
/**
 * 渲染生图成功率与平均耗时统计卡片组件
 *
 * @param stats 统计数据对象
 * @returns 统计卡片 DOM 节点
 */
export declare function renderStatisticsCard(stats?: Partial<StatisticsData> | any): HTMLElement;
export interface ImageActionCallbacks {
    imageSrc?: string;
    mimeType?: string;
    promptText?: string;
    negativePrompt?: string;
    messageIndex?: number;
    buttonIndex?: number;
    uuid?: string;
    onConfirm?: (newPrompt: string, newNegativePrompt?: string) => void;
    onLightbox?: () => void;
    onRegen?: () => void;
    onRegenerate?: () => void;
    onInpaint?: () => void;
    onDownload?: () => void;
    onDelete?: () => void;
    onInfo?: () => void;
    [key: string]: any;
}
/**
 * 图像操作栏 控件 (ImageActionPanel Control)
 *
 * 当用户长按 (pointerdown >= 500ms) 或右键单击生图元素时触发唤出。
 * 托管 Tag 锁定/编辑与复制，以及 [🖌️ 局部重绘]、[ℹ️ 元数据]、[💾 下载]、[🗑️ 删除]、[🚀 重新生成] 动作按钮。
 */
export declare function openImageActionPanel(_e: MouseEvent | PointerEvent, callbacks: ImageActionCallbacks): void;
//# sourceMappingURL=controls.d.ts.map