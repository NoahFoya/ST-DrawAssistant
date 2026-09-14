/**
 * 预设方案管理工具栏 (PresetToolbar)
 * 包含方案切换下拉框与 8 键标准图标操作族 (新建、保存、另存为、重命名、导入、导出、重置、删除)。
 * 当方案处于未保存状态时直接触发悬浮提示，不依赖额外角标元素。
 */

import type { PresetActionType, SelectOptionItem } from '@types';
import { createSelect, SelectHandle } from '../components/select';
import { createIconButton, IconButtonHandle } from '../components/button';

export interface PresetToolbarItem {
    id: string;
    name: string;
    isBuiltin?: boolean;
}

export interface PresetToolbarOptions {
    presets: PresetToolbarItem[];
    activePresetId: string;
    onAction: (action: PresetActionType, presetId: string) => void;
    onImportFile?: (file: File) => void;
    className?: string;
}

export interface PresetToolbarHandle {
    readonly element: HTMLElement;
    readonly selectWrapper: HTMLElement;
    readonly newButton: IconButtonHandle;
    readonly saveButton: IconButtonHandle;
    readonly saveAsButton: IconButtonHandle;
    readonly renameButton: IconButtonHandle;
    readonly importButton: IconButtonHandle;
    readonly exportButton: IconButtonHandle;
    readonly resetButton: IconButtonHandle;
    readonly deleteButton: IconButtonHandle;
    setPresets(presets: PresetToolbarItem[], activeId?: string): void;
    setActivePreset(presetId: string): void;
    getActivePresetId(): string;
    setDirty(isDirty: boolean, hint?: string): void;
    isDirty(): boolean;
    dispose(): void;
}

export function createPresetToolbar(options: PresetToolbarOptions): PresetToolbarHandle {
    const toolbar = document.createElement('div');
    toolbar.className = 'da-preset-toolbar';
    if (options.className) toolbar.classList.add(options.className);

    let currentPresets = [...options.presets];
    let activeId = options.activePresetId;
    let isCurrentlyDirty = false;

    // 1. 左侧预设下拉选择区 (下拉选择框包装器，未保存时悬浮提示)
    const leftSlot = document.createElement('div');
    leftSlot.className = 'da-preset-toolbar-left';

    const selectWrapper = document.createElement('div');
    selectWrapper.className = 'da-preset-select-wrapper';

    const buildSelectOptions = (items: PresetToolbarItem[]): SelectOptionItem[] =>
        items.map((p) => ({
            label: p.name,
            value: p.id
        }));

    let selectComp: SelectHandle;
    selectComp = createSelect({
        options: buildSelectOptions(currentPresets),
        value: activeId,
        onChange: (newId) => {
            if (isCurrentlyDirty) {
                let shouldContinue = true;
                if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
                    shouldContinue = window.confirm('当前方案存在未保存的修改，切换将放弃未保存的修改。是否确定继续切换？');
                }
                if (!shouldContinue) {
                    selectComp.setValue(activeId);
                    return;
                }
            }
            activeId = newId;
            options.onAction('select', newId);
        }
    });

    selectWrapper.appendChild(selectComp.element);
    leftSlot.appendChild(selectWrapper);
    toolbar.appendChild(leftSlot);

    // 2. 右侧 8 键标准图标操作族
    const rightSlot = document.createElement('div');
    rightSlot.className = 'da-preset-toolbar-right';

    // #1 新建方案
    const newBtn: IconButtonHandle = createIconButton({
        icon: 'plus',
        title: '新建预设',
        onClick: () => options.onAction('new', activeId)
    });

    // #2 覆盖保存方案 (挂载 da-preset-btn--save 并在标脏时激活琥珀色呼吸脉冲)
    const saveBtn: IconButtonHandle = createIconButton({
        icon: 'check',
        className: 'da-preset-btn--save',
        title: '保存预设修改',
        onClick: () => options.onAction('save', activeId)
    });

    // #3 另存为 / 复制新方案
    const saveAsBtn: IconButtonHandle = createIconButton({
        icon: 'copy',
        title: '另存为新预设',
        onClick: () => options.onAction('saveAs', activeId)
    });

    // #4 重命名方案
    const renameBtn: IconButtonHandle = createIconButton({
        icon: 'edit',
        title: '重命名当前预设',
        onClick: () => options.onAction('rename', activeId)
    });

    // #5 导入预设文件 (隐藏原生文件 input)
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';

    const onFileChange = () => {
        const file = fileInput.files?.[0];
        if (file) {
            if (options.onImportFile) {
                options.onImportFile(file);
            } else {
                options.onAction('import', activeId);
            }
            fileInput.value = '';
        }
    };
    fileInput.addEventListener('change', onFileChange);

    const importBtn: IconButtonHandle = createIconButton({
        icon: 'download',
        title: '导入预设文件',
        onClick: () => fileInput.click()
    });

    // #6 导出当前方案
    const exportBtn: IconButtonHandle = createIconButton({
        icon: 'external',
        title: '导出当前预设',
        onClick: () => options.onAction('export', activeId)
    });

    // #7 撤销草稿 (重置为初始基准，仅在脏态时激活)
    const resetBtn: IconButtonHandle = createIconButton({
        icon: 'refresh',
        title: '重置修改 (放弃草稿并恢复为当前方案初始值)',
        disabled: true,
        onClick: () => options.onAction('reset', activeId)
    });

    // #8 删除方案 (全量方案平等支持，二次确认防误触)
    const deleteBtn: IconButtonHandle = createIconButton({
        icon: 'trash',
        variant: 'danger',
        title: '删除当前预设',
        onClick: () => {
            const current = currentPresets.find((p) => p.id === activeId);
            if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
                const confirmed = window.confirm(`确定要删除预设「${current?.name || activeId}」吗？此操作无法撤销。`);
                if (!confirmed) return;
            }
            options.onAction('delete', activeId);
        }
    });

    rightSlot.appendChild(newBtn.element);
    rightSlot.appendChild(saveBtn.element);
    rightSlot.appendChild(saveAsBtn.element);
    rightSlot.appendChild(renameBtn.element);
    rightSlot.appendChild(importBtn.element);
    rightSlot.appendChild(exportBtn.element);
    rightSlot.appendChild(resetBtn.element);
    rightSlot.appendChild(deleteBtn.element);
    rightSlot.appendChild(fileInput);

    toolbar.appendChild(rightSlot);

    return {
        element: toolbar,
        selectWrapper,
        newButton: newBtn,
        saveButton: saveBtn,
        saveAsButton: saveAsBtn,
        renameButton: renameBtn,
        importButton: importBtn,
        exportButton: exportBtn,
        resetButton: resetBtn,
        deleteButton: deleteBtn,
        setPresets(presets: PresetToolbarItem[], newActiveId?: string): void {
            currentPresets = [...presets];
            if (newActiveId) {
                activeId = newActiveId;
            } else if (!currentPresets.some((p) => p.id === activeId)) {
                activeId = currentPresets[0]?.id || '';
            }

            selectComp.setOptions(buildSelectOptions(currentPresets), activeId);
        },
        setActivePreset(presetId: string): void {
            activeId = presetId;
            selectComp.setValue(presetId);
        },
        getActivePresetId(): string {
            return activeId;
        },
        setDirty(isDirty: boolean, hint?: string): void {
            isCurrentlyDirty = isDirty;
            saveBtn.setDirty(isDirty);
            resetBtn.setDisabled(!isDirty);
            selectWrapper.classList.toggle('is-dirty', isDirty);
            const tip = hint || '当前方案存在未保存的修改';
            if (isDirty) {
                selectWrapper.title = tip;
                selectComp.element.title = tip;
            } else {
                selectWrapper.title = '';
                selectComp.element.title = '';
            }
            selectComp.setDirty?.(isDirty);
        },
        isDirty(): boolean {
            return isCurrentlyDirty;
        },
        dispose(): void {
            selectComp.dispose?.();
            newBtn.dispose();
            saveBtn.dispose();
            saveAsBtn.dispose();
            renameBtn.dispose();
            importBtn.dispose();
            exportBtn.dispose();
            resetBtn.dispose();
            deleteBtn.dispose();
            fileInput.removeEventListener('change', onFileChange);
            fileInput.remove();
            toolbar.remove();
        }
    };
}
