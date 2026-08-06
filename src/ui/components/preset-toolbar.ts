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
export function renderPresetToolbar<T = Record<string, unknown>>(
    options: PresetToolbarOptions<T>
): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'da-preset-toolbar';
    toolbar.style.display = 'flex';
    toolbar.style.gap = '8px';
    toolbar.style.alignItems = 'center';
    toolbar.style.flexWrap = 'wrap';
    toolbar.style.width = '100%';

    // 1. 方案选择下拉框
    const select = document.createElement('select');
    select.className = 'da-select';
    select.style.flex = '1';
    select.style.minWidth = '160px';

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

    // 辅助创建仅图标按钮 (标准矢量图标 + Tooltip)
    const createIconButton = (
        iconHtml: string,
        titleText: string,
        onClick: () => void,
        isDisabled = false,
        isDanger = false
    ) => {
        const btn = document.createElement('button');
        btn.className = `da-icon-btn ${isDanger ? 'danger' : ''}`;
        btn.title = titleText;
        btn.innerHTML = iconHtml;
        if (isDanger) {
            btn.style.color = '#ef4444';
            btn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        }
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

    // 1. ➕ 新建
    const newBtn = createIconButton('<i class="fa-solid fa-plus"></i>', '新建预设方案', options.onNew);
    toolbar.appendChild(newBtn);

    // 2. 💾 保存
    const saveBtn = createIconButton('<i class="fa-solid fa-save"></i>', '保存当前方案', options.onSave, !hasSelection);
    toolbar.appendChild(saveBtn);

    // 3. 📄➔ 另存为
    const saveAsHandler = options.onSaveAs || options.onNew;
    const saveAsBtn = createIconButton('<i class="fa-solid fa-file-export"></i>', '另存为新方案', saveAsHandler, !hasSelection);
    toolbar.appendChild(saveAsBtn);

    // 4. ✏️ 重命名
    const renameBtn = createIconButton('<i class="fa-solid fa-pen"></i>', '重命名当前方案', options.onRename, !hasSelection);
    toolbar.appendChild(renameBtn);

    // 5. 📤 导出 JSON
    const exportBtn = createIconButton('<i class="fa-solid fa-upload"></i>', '导出方案 JSON', options.onExport, !hasSelection);
    toolbar.appendChild(exportBtn);

    // 6. 📥 导入 JSON
    const importBtn = createIconButton('<i class="fa-solid fa-download"></i>', '导入方案 JSON', () => hiddenFileInput.click());
    toolbar.appendChild(importBtn);

    // 7. ↺ 恢复默认 (若配置 onReset，或者隐藏)
    if (options.onReset) {
        const resetBtn = createIconButton('<i class="fa-solid fa-rotate-left"></i>', '恢复默认预设', options.onReset, !hasSelection);
        toolbar.appendChild(resetBtn);
    }

    // 8. 🗑️ 删除
    const deleteBtn = createIconButton('<i class="fa-solid fa-trash"></i>', '删除当前方案', options.onDelete, !hasSelection, true);
    toolbar.appendChild(deleteBtn);

    return toolbar;
}
