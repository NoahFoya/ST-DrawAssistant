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
export function renderPresetToolbar<T = Record<string, unknown>>(
    options: PresetToolbarOptions<T>
): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'da-preset-toolbar';


    // 1. 方案选择下拉框
    const select = document.createElement('select');
    select.className = 'da-select';
    select.style.flex = '1';
    select.style.minWidth = '140px';

    if (options.profiles.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = `(无可选预设方案)`;
        select.appendChild(opt);
    } else {
        options.profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        });
    }

    select.value = options.currentId || (options.profiles[0]?.id ?? '');
    select.addEventListener('change', () => {
        if (select.value) {
            options.onSelect(select.value);
        }
    });

    toolbar.appendChild(select);

    // 隐秘文件选择器
    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = '.json';
    hiddenFileInput.style.display = 'none';
    hiddenFileInput.addEventListener('change', () => {
        const file = hiddenFileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            options.onImport(reader.result as string, file.name);
            hiddenFileInput.value = '';
        };
        reader.readAsText(file);
    });
    toolbar.appendChild(hiddenFileInput);

    // 辅助创建仅图标按钮
    const createIconButton = (
        icon: string,
        titleText: string,
        onClick: () => void,
        isDisabled = false,
        isDanger = false
    ) => {
        const btn = document.createElement('button');
        btn.className = `da-icon-btn ${isDanger ? 'danger' : ''}`;
        btn.title = titleText;
        btn.innerHTML = `<span style="font-size: 1em; line-height: 1;">${icon}</span>`;
        if (isDisabled) {
            btn.disabled = true;
            btn.style.opacity = '0.35';
            btn.style.cursor = 'not-allowed';
        }
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isDisabled) onClick();
        });
        return btn;
    };

    const hasSelection = Boolean(select.value);

    // ➕ 新建
    const newBtn = createIconButton('➕', '新建预设方案', options.onNew);
    // 💾 保存
    const saveBtn = createIconButton('💾', '保存当前方案', options.onSave, !hasSelection);
    // ✏️ 重命名
    const renameBtn = createIconButton('✏️', '重命名当前方案', options.onRename, !hasSelection);
    // 📥 导入 JSON
    const importBtn = createIconButton('📥', '导入方案 JSON', () => hiddenFileInput.click());
    // 📤 导出 JSON
    const exportBtn = createIconButton('📤', '导出方案 JSON', options.onExport, !hasSelection);
    // 🗑️ 删除
    const deleteBtn = createIconButton('🗑️', '删除当前方案', options.onDelete, !hasSelection, true);

    toolbar.appendChild(newBtn);
    toolbar.appendChild(saveBtn);
    toolbar.appendChild(renameBtn);
    toolbar.appendChild(importBtn);
    toolbar.appendChild(exportBtn);
    toolbar.appendChild(deleteBtn);

    return toolbar;
}
