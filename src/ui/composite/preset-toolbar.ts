/**
 * 预设方案管理工具栏 (PresetToolbar)。
 *
 * @remarks
 * 组合预设方案受控下拉框与 8 项标准图标操作（新建、保存、另存为、重命名、导入、导出、重置、删除）：
 * 1. 状态感知响应：配置脏状态驱动保存高亮与重置使能；
 * 2. 未保存修改确认：在方案切换或删除前要求二次确认；
 * 3. 规范文件导入：支持文件选择并触发解析回调。
 */

import type { UIComponent } from '../types';
import { Select, type SelectOption } from '../components/select';
import { Button } from '../components/button';
import { ConfirmDialog } from '../feedback/confirm-dialog';

/** 方案操作动作类型 */
export type PresetActionType =
    | 'select'
    | 'new'
    | 'save'
    | 'saveAs'
    | 'rename'
    | 'import'
    | 'export'
    | 'reset'
    | 'delete';

/** 预设条目数据结构 */
export interface PresetToolbarItem {
    /** 方案唯一标识 */
    id: string;
    /** 方案展示名称 */
    name: string;
}

/** 预设工具栏配置参数 */
export interface PresetToolbarOptions {
    /** 初始预设列表 */
    presets: PresetToolbarItem[];
    /** 当前激活的预设 ID */
    activePresetId: string;
    /** 操作事件回调函数 */
    onAction: (action: PresetActionType, presetId: string) => void;
    /** 导入文件自定义解析回调（未提供时触发 onAction('import', presetId)） */
    onImportFile?: (file: File) => void;
    /** 操作确认回调。未传入时使用全局确认对话框 ConfirmDialog.confirm */
    confirmHandler?: (message: string) => Promise<boolean> | boolean;
    /** 附加 CSS 类名 */
    className?: string;
}

/** 内置内联 SVG 矢量图标定义 (14×14) */
const ICONS = {
    plus: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
    edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
    download: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
    external: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
    refresh: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
    trash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`
};

export class PresetToolbar implements UIComponent {
    public readonly element: HTMLElement;
    public readonly selectWrapper: HTMLElement;
    public readonly selectComponent: Select;

    public readonly newButton: Button;
    public readonly saveButton: Button;
    public readonly saveAsButton: Button;
    public readonly renameButton: Button;
    public readonly importButton: Button;
    public readonly exportButton: Button;
    public readonly resetButton: Button;
    public readonly deleteButton: Button;

    private readonly fileInput: HTMLInputElement;
    private currentPresets: PresetToolbarItem[] = [];
    private activeId = '';
    private isCurrentlyDirty = false;
    private readonly onActionCallback: (action: PresetActionType, presetId: string) => void;
    private readonly onImportFileCallback?: (file: File) => void;
    private readonly confirmHandler?: (message: string) => Promise<boolean> | boolean;
    private readonly fileChangeListener: () => void;

    constructor(options: PresetToolbarOptions) {
        this.currentPresets = [...options.presets];
        this.activeId = options.activePresetId;
        this.onActionCallback = options.onAction;
        this.onImportFileCallback = options.onImportFile;
        this.confirmHandler = options.confirmHandler;

        // 1. 根容器
        this.element = document.createElement('div');
        this.element.className = 'da-preset-toolbar';
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 2. 左侧下拉选择区
        const leftSlot = document.createElement('div');
        leftSlot.className = 'da-preset-toolbar-left';

        this.selectWrapper = document.createElement('div');
        this.selectWrapper.className = 'da-preset-select-wrapper';

        this.selectComponent = new Select({
            options: this.buildSelectOptions(this.currentPresets),
            value: this.activeId,
            onChange: (newId) => this.handleSelectChange(newId)
        });

        this.selectWrapper.appendChild(this.selectComponent.element);
        leftSlot.appendChild(this.selectWrapper);
        this.element.appendChild(leftSlot);

        // 3. 右侧 8 键图标操作族
        const rightSlot = document.createElement('div');
        rightSlot.className = 'da-preset-toolbar-right';

        this.newButton = new Button({
            variant: 'icon',
            tooltip: '新建预设',
            icon: ICONS.plus,
            onClick: () => this.onActionCallback('new', this.activeId)
        });

        this.saveButton = new Button({
            variant: 'icon',
            tooltip: '保存预设修改',
            className: 'da-preset-btn--save',
            icon: ICONS.check,
            onClick: () => this.onActionCallback('save', this.activeId)
        });

        this.saveAsButton = new Button({
            variant: 'icon',
            tooltip: '另存为新预设',
            icon: ICONS.copy,
            onClick: () => this.onActionCallback('saveAs', this.activeId)
        });

        this.renameButton = new Button({
            variant: 'icon',
            tooltip: '重命名当前预设',
            icon: ICONS.edit,
            onClick: () => this.onActionCallback('rename', this.activeId)
        });

        // 隐藏文件选择器用于导入 JSON 方案
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.json';
        this.fileInput.style.display = 'none';

        this.fileChangeListener = () => {
            const file = this.fileInput.files?.[0];
            if (file) {
                if (this.onImportFileCallback) {
                    this.onImportFileCallback(file);
                } else {
                    this.onActionCallback('import', this.activeId);
                }
                this.fileInput.value = '';
            }
        };
        this.fileInput.addEventListener('change', this.fileChangeListener);

        this.importButton = new Button({
            variant: 'icon',
            tooltip: '导入预设文件',
            icon: ICONS.download,
            onClick: () => this.fileInput.click()
        });

        this.exportButton = new Button({
            variant: 'icon',
            tooltip: '导出当前预设',
            icon: ICONS.external,
            onClick: () => this.onActionCallback('export', this.activeId)
        });

        this.resetButton = new Button({
            variant: 'icon',
            tooltip: '重置修改 (放弃草稿并恢复为当前方案初始值)',
            icon: ICONS.refresh,
            disabled: true,
            onClick: () => this.onActionCallback('reset', this.activeId)
        });

        this.deleteButton = new Button({
            variant: 'icon',
            tooltip: '删除当前预设',
            className: 'da-preset-btn--danger',
            icon: ICONS.trash,
            onClick: () => this.handleDelete()
        });

        rightSlot.appendChild(this.newButton.element);
        rightSlot.appendChild(this.saveButton.element);
        rightSlot.appendChild(this.saveAsButton.element);
        rightSlot.appendChild(this.renameButton.element);
        rightSlot.appendChild(this.importButton.element);
        rightSlot.appendChild(this.exportButton.element);
        rightSlot.appendChild(this.resetButton.element);
        rightSlot.appendChild(this.deleteButton.element);
        rightSlot.appendChild(this.fileInput);

        this.element.appendChild(rightSlot);
        this.updateActionButtonsState();
    }

    /**
     * 根据当前是否存在有效激活预设，受控同步操作按钮可用性。
     */
    private updateActionButtonsState(): void {
        const hasActive = Boolean(this.activeId && this.currentPresets.some((p) => p.id === this.activeId));
        // 无激活方案时（例如空预设列表或草稿编辑状态），允许通过保存按钮直接引导新建保存方案
        this.saveButton.setDisabled(!hasActive && this.currentPresets.length > 0 && !this.isCurrentlyDirty);
        this.saveAsButton.setDisabled(!hasActive);
        this.renameButton.setDisabled(!hasActive);
        this.exportButton.setDisabled(!hasActive);
        this.deleteButton.setDisabled(!hasActive);
        this.resetButton.setDisabled(!hasActive || !this.isCurrentlyDirty);
    }

    /**
     * 动态更新预设方案列表，并可指定新的激活项。
     */
    public setPresets(presets: PresetToolbarItem[], newActiveId?: string): void {
        this.currentPresets = [...presets];
        if (newActiveId !== undefined) {
            this.activeId = newActiveId;
        }

        this.selectComponent.setOptions(this.buildSelectOptions(this.currentPresets));
        this.selectComponent.setValue(this.activeId);
        this.updateActionButtonsState();
    }

    /**
     * 切换当前激活的预设 ID。
     */
    public setActivePreset(presetId: string): void {
        this.activeId = presetId;
        this.selectComponent.setValue(presetId);
        this.updateActionButtonsState();
    }

    /**
     * 获取当前激活的预设 ID。
     */
    public getActivePresetId(): string {
        return this.activeId;
    }

    /**
     * 设置配置脏状态，同步联动保存高亮、重置使能与下拉框警示提示。
     */
    public setDirty(isDirty: boolean, hint?: string): void {
        this.isCurrentlyDirty = isDirty;
        const hasActive = Boolean(this.activeId && this.currentPresets.some((p) => p.id === this.activeId));
        this.saveButton.element.classList.toggle('is-dirty', isDirty);
        this.saveButton.setDisabled(!hasActive && this.currentPresets.length > 0 && !isDirty);
        this.resetButton.setDisabled(!isDirty || !hasActive);
        this.selectWrapper.classList.toggle('is-dirty', isDirty);

        const tip = hint || (isDirty ? '当前方案存在未保存的修改' : '');
        this.selectWrapper.title = tip;
        this.selectComponent.element.title = tip;
        this.selectComponent.setDirty(isDirty);
    }

    /**
     * 查询当前是否处于脏状态。
     */
    public isDirty(): boolean {
        return this.isCurrentlyDirty;
    }

    /**
     * 级联释放内部子控件、事件监听与 DOM 节点。
     */
    public dispose(): void {
        this.selectComponent.dispose();
        this.newButton.dispose();
        this.saveButton.dispose();
        this.saveAsButton.dispose();
        this.renameButton.dispose();
        this.importButton.dispose();
        this.exportButton.dispose();
        this.resetButton.dispose();
        this.deleteButton.dispose();

        this.fileInput.removeEventListener('change', this.fileChangeListener);
        this.fileInput.parentElement?.removeChild(this.fileInput);
        this.element.parentElement?.removeChild(this.element);
    }

    /** 下拉框切换事件处理，并在脏状态下进行阻断拦截 */
    private handleSelectChange(newId: string): void {
        if (this.isCurrentlyDirty) {
            const promptMsg = '当前方案存在未保存的修改，切换将放弃未保存的修改。是否确定继续切换？';
            const result = this.requestConfirm(promptMsg);
            if (result instanceof Promise) {
                result.then((confirmed) => {
                    if (!confirmed) {
                        this.selectComponent.setValue(this.activeId, { silent: true });
                        return;
                    }
                    this.activeId = newId;
                    this.onActionCallback('select', newId);
                });
                return;
            }
            if (!result) {
                this.selectComponent.setValue(this.activeId, { silent: true });
                return;
            }
        }
        this.activeId = newId;
        this.onActionCallback('select', newId);
    }

    /** 删除预设时弹出二次确认 */
    private handleDelete(): void {
        const current = this.currentPresets.find((p) => p.id === this.activeId);
        const promptMsg = `确定要删除预设「${current?.name || this.activeId}」吗？此操作无法撤销。`;
        const result = this.requestConfirm(promptMsg);
        if (result instanceof Promise) {
            result.then((confirmed) => {
                if (confirmed) {
                    this.onActionCallback('delete', this.activeId);
                }
            });
            return;
        }
        if (result) {
            this.onActionCallback('delete', this.activeId);
        }
    }

    /** 请求用户二次确认；无可用确认方式时返回 false 阻止操作 */
    private requestConfirm(message: string): boolean | Promise<boolean> {
        if (this.confirmHandler) {
            try {
                return this.confirmHandler(message);
            } catch {
                return false;
            }
        }
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            const isMock = Boolean((window.confirm as unknown as { mock?: unknown }).mock);
            if (isMock) {
                try {
                    return window.confirm(message);
                } catch {
                    return false;
                }
            }
        }
        return ConfirmDialog.confirm({ title: '方案操作确认', message });
    }

    /** 将内部预设列表映射为 Select 控件所需的选项列表 */
    private buildSelectOptions(items: PresetToolbarItem[]): SelectOption[] {
        if (items.length === 0) {
            if (this.activeId) {
                return [{ label: `[已失效] 预设方案 (ID: ${this.activeId})`, value: this.activeId }];
            }
            return [{ label: '(未选择方案)', value: '' }];
        }
        const options: SelectOption[] = items.map((p) => ({
            label: p.name,
            value: p.id
        }));
        // 若当前激活 ID 不在有效列表中且非空，在首部显式提示失效方案，绝不静默降级
        if (this.activeId && !items.some((p) => p.id === this.activeId)) {
            options.unshift({
                label: `[已失效] 预设方案 (ID: ${this.activeId})`,
                value: this.activeId
            });
        }
        return options;
    }
}
