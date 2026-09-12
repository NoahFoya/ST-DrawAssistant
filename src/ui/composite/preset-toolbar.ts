/**
 * 预设方案管理工具栏 (PresetToolbar)
 * 包含方案切换下拉框、新建、保存 (脏状态金色呼吸光)、另存为、导入、导出与删除等高频操作。
 */

import { PresetActionType } from './types';
import { createSelect, SelectHandle } from '../components/select';
import { createIconButton, IconButtonHandle } from '../components/button';
import { SelectOptionItem } from '../components/types';
import { Toast } from '../components/feedback';

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
    setPresets(presets: PresetToolbarItem[], activeId?: string): void;
    setActivePreset(presetId: string): void;
    setDirty(isDirty: boolean): void;
    dispose(): void;
}

export function createPresetToolbar(options: PresetToolbarOptions): PresetToolbarHandle {
    const toolbar = document.createElement('div');
    toolbar.className = 'da-preset-toolbar';
    if (options.className) toolbar.classList.add(options.className);

    let currentPresets = [...options.presets];
    let activeId = options.activePresetId;

    // 1. 左侧预设下拉选择区
    const leftSlot = document.createElement('div');
    leftSlot.className = 'da-preset-toolbar-left';

    const selectOptions: SelectOptionItem[] = currentPresets.map((p) => ({
        label: p.isBuiltin ? `${p.name} (内置)` : p.name,
        value: p.id
    }));

    let selectComp: SelectHandle;
    selectComp = createSelect({
        options: selectOptions,
        value: activeId,
        onChange: (newId) => {
            activeId = newId;
            options.onAction('select', newId);
        }
    });

    leftSlot.appendChild(selectComp.element);
    toolbar.appendChild(leftSlot);

    // 2. 右侧操作按钮组
    const rightSlot = document.createElement('div');
    rightSlot.className = 'da-preset-toolbar-right';

    // 新建
    const newBtn: IconButtonHandle = createIconButton({
        icon: 'plus',
        title: '新建预设',
        onClick: () => options.onAction('new', activeId)
    });
    // 保存
    const saveBtn: IconButtonHandle = createIconButton({
        icon: 'check',
        title: '保存预设修改',
        onClick: () => options.onAction('save', activeId)
    });
    // 另存为
    const saveAsBtn: IconButtonHandle = createIconButton({
        icon: 'copy',
        title: '另存为新预设',
        onClick: () => options.onAction('saveAs', activeId)
    });
    // 导入 (隐藏文件 input 触发)
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
        icon: 'refresh',
        title: '导入预设文件',
        onClick: () => fileInput.click()
    });

    // 导出
    const exportBtn: IconButtonHandle = createIconButton({
        icon: 'external',
        title: '导出当前预设',
        onClick: () => options.onAction('export', activeId)
    });

    // 删除
    const deleteBtn: IconButtonHandle = createIconButton({
        icon: 'trash',
        variant: 'danger',
        title: '删除当前预设',
        onClick: () => {
            const current = currentPresets.find((p) => p.id === activeId);
            if (current?.isBuiltin) {
                Toast.warn('内置预设不可删除');
                return;
            }
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
    rightSlot.appendChild(importBtn.element);
    rightSlot.appendChild(exportBtn.element);
    rightSlot.appendChild(deleteBtn.element);
    rightSlot.appendChild(fileInput);

    toolbar.appendChild(rightSlot);

    return {
        element: toolbar,
        setPresets(presets: PresetToolbarItem[], newActiveId?: string): void {
            currentPresets = [...presets];
            if (newActiveId) {
                activeId = newActiveId;
            } else if (!currentPresets.some((p) => p.id === activeId)) {
                activeId = currentPresets[0]?.id || '';
            }

            const items: SelectOptionItem[] = currentPresets.map((p) => ({
                label: p.isBuiltin ? `${p.name} (内置)` : p.name,
                value: p.id
            }));
            selectComp.setOptions(items, activeId);
        },
        setActivePreset(presetId: string): void {
            activeId = presetId;
            selectComp.setValue(presetId);
        },
        setDirty(isDirty: boolean): void {
            saveBtn.setDirty(isDirty);
            selectComp.setDirty?.(isDirty);
        },
        dispose(): void {
            selectComp.dispose?.();
            newBtn.dispose();
            saveBtn.dispose();
            saveAsBtn.dispose();
            importBtn.dispose();
            exportBtn.dispose();
            deleteBtn.dispose();
            fileInput.removeEventListener('change', onFileChange);
            fileInput.remove();
            toolbar.remove();
        }
    };
}
