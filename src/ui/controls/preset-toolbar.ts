/**
 * @module ui/controls/preset-toolbar
 * @description 预设方案管理工具栏、下拉切换与 CRUD 交互组件 (Preset Toolbar Control)
 */

import {
    RegistryCategory,
    PresetCategoryMap,
    PRESET_SCHEMA_BINDINGS
} from '../../core';
import type { ProfileService } from '../../domain';
import { FeedbackService } from '../feedback/feedback';

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
    exportProfile?: (id: string, data: T) => void;
    importProfile?: (content: string, fileName: string) => string | null | Promise<string | null>;
    onSelect?: (id: string) => Promise<void> | void;
}

/**
 * 渲染通用的预设方案下拉选择与操作工具栏
 */
export function renderPresetToolbar(options: PresetToolbarOptions): PresetToolbarElement {
    const container = document.createElement('div') as PresetToolbarElement;
    container.className = 'da-preset-toolbar';

    const leftPart = document.createElement('div');
    leftPart.className = 'da-preset-toolbar-left';

    const select = document.createElement('select');
    select.className = 'da-select da-preset-select';
    select.title = '切换预设方案';

    const renderSelectOptions = (profiles: PresetItem[] = [], currentId = '') => {
        select.innerHTML = '';
        if (profiles.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(无可选预设方案)';
            select.appendChild(opt);
        } else {
            profiles.forEach((p) => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (p.id === currentId) opt.selected = true;
                select.appendChild(opt);
            });
        }
    };

    renderSelectOptions(options.profiles, options.currentId);

    leftPart.appendChild(select);

    const draftBadge = document.createElement('span');
    draftBadge.className = 'da-badge dirty';
    draftBadge.style.display = options.isDraftDirty ? 'inline-flex' : 'none';
    draftBadge.textContent = '已修改';
    leftPart.appendChild(draftBadge);

    const rightPart = document.createElement('div');
    rightPart.className = 'da-preset-toolbar-right';

    // 用于导入 JSON 预设文件的隐藏 input 节点
    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = '.json';
    hiddenFileInput.style.display = 'none';
    hiddenFileInput.addEventListener('change', () => {
        const file = hiddenFileInput.files?.[0];
        if (!file || !options.onImport) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = (e.target?.result as string) || '';
            options.onImport!(content, file.name);
        };
        reader.readAsText(file, 'UTF-8');
        hiddenFileInput.value = '';
    });
    rightPart.appendChild(hiddenFileInput);

    const selectionDependentBtns: Array<{ btn: HTMLButtonElement; isDanger?: boolean }> = [];

    const createIconButton = (
        iconClass: string,
        titleText: string,
        onClick: () => void,
        requiresSelection = false,
        isDanger = false
    ) => {
        const btn = document.createElement('button');
        btn.className = `da-icon-btn ${isDanger ? 'da-icon-btn--danger' : ''}`.trim();
        btn.title = titleText;
        btn.innerHTML = `<i class="${iconClass}"></i>`;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!btn.disabled) onClick();
        });

        if (requiresSelection) {
            selectionDependentBtns.push({ btn, isDanger });
        }
        return btn;
    };

    const updateActionButtonsState = () => {
        const hasSelection = Boolean(select.value);
        selectionDependentBtns.forEach(({ btn, isDanger }) => {
            btn.disabled = !hasSelection;
            btn.style.opacity = hasSelection ? '1' : '0.4';
            btn.style.cursor = hasSelection ? 'pointer' : 'not-allowed';
            if (isDanger) {
                btn.style.pointerEvents = hasSelection ? 'auto' : 'none';
            }
        });
    };

    select.addEventListener('change', () => {
        options.onSelect?.(select.value);
        updateActionButtonsState();
    });

    // 1. 新建方案
    const newBtn = createIconButton('fa-solid fa-plus', '新建预设方案', () => options.onNew?.());

    // 2. 保存方案
    const saveBtn = createIconButton(
        'fa-solid fa-floppy-disk',
        options.isDraftDirty ? '当前方案有未保存的修改' : '保存当前方案',
        () => options.onSave?.(),
        true
    );
    if (options.isDraftDirty) saveBtn.classList.add('is-dirty');

    // 3. 重命名方案
    const renameBtn = createIconButton('fa-solid fa-pen-to-square', '重命名方案', () => options.onRename?.(), true);

    // 4. 导出方案
    const exportBtn = createIconButton('fa-solid fa-download', '导出方案为 JSON 文件', () => options.onExport?.(), true);

    // 5. 导入方案
    const importBtn = createIconButton('fa-solid fa-upload', '导入 JSON 预设文件', () => hiddenFileInput.click());

    // 6. 还原方案快照 (放弃未保存修改)
    const resetBtn = createIconButton(
        'fa-solid fa-rotate-left',
        '放弃未保存修改 / 还原方案快照',
        () => options.onReset?.(),
        true
    );

    // 7. 删除方案
    const deleteBtn = createIconButton('fa-solid fa-trash', '删除当前方案', () => options.onDelete?.(), true, true);

    rightPart.appendChild(newBtn);
    rightPart.appendChild(saveBtn);
    rightPart.appendChild(renameBtn);
    rightPart.appendChild(exportBtn);
    rightPart.appendChild(importBtn);
    rightPart.appendChild(resetBtn);
    rightPart.appendChild(deleteBtn);

    container.appendChild(leftPart);
    container.appendChild(rightPart);

    updateActionButtonsState();

    container.refreshPresets = (presets: PresetItem[], activeId: string, isDirty = false) => {
        renderSelectOptions(presets, activeId);
        draftBadge.style.display = isDirty ? 'inline-flex' : 'none';
        saveBtn.classList.toggle('is-dirty', isDirty);
        saveBtn.title = isDirty ? '当前方案有未保存的修改' : '保存当前方案';
        updateActionButtonsState();
    };

    return container;
}

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
export function bindPresetToolbar<T = unknown>(options: BoundPresetToolbarOptions<T>): PresetToolbarElement {
    const { adapter } = options;

    let profiles = adapter.getProfiles();
    let currentId = adapter.getInitialId() || profiles[0]?.id || '';
    let isDraftDirty = false;

    const toolbar = renderPresetToolbar({
        profiles,
        currentId,
        isDraftDirty,
        onSelect: async (id: string) => {
            if (options.onBeforeSelect) {
                const canProceed = await options.onBeforeSelect(id);
                if (!canProceed) return;
            }
            currentId = id;
            if (options.applyData) {
                options.applyData(id);
            }
            if (options.onRefresh) {
                options.onRefresh();
            }
            isDraftDirty = false;
            toolbar.refreshPresets?.(adapter.getProfiles(), currentId, isDraftDirty);
        },
        onNew: async () => {
            const name = await FeedbackService.prompt({
                title: `新建${adapter.label}方案`,
                message: `请输入新${adapter.label}方案名称：`,
                placeholder: '例如: 我的专属方案',
                confirmText: '创建方案'
            });
            if (!name || !name.trim()) return;

            const trimmedName = name.trim();
            const existing = adapter.getProfiles().find((p) => p.name === trimmedName);
            if (existing) {
                FeedbackService.toastWarn(`已存在同名方案【${trimmedName}】，请使用其他名称`);
                return;
            }

            const currentData = options.getCurrentData ? options.getCurrentData() : ({} as T);
            const newId = await adapter.createProfile(trimmedName, currentData);
            currentId = newId;
            if (options.applyData) {
                options.applyData(newId);
            }
            if (options.onRefresh) {
                options.onRefresh();
            }
            isDraftDirty = false;
            toolbar.refreshPresets?.(adapter.getProfiles(), currentId, isDraftDirty);
            FeedbackService.toastSuccess(`成功创建方案【${trimmedName}】`);
        },
        onSave: async () => {
            if (options.onSaveOverride) {
                options.onSaveOverride();
                isDraftDirty = false;
                toolbar.refreshPresets?.(adapter.getProfiles(), currentId, isDraftDirty);
                FeedbackService.toastSuccess(`方案已保存`);
                return;
            }
            if (!currentId) {
                FeedbackService.toastWarn('未选择任何方案，无法保存');
                return;
            }
            const currentData = options.getCurrentData ? options.getCurrentData() : ({} as T);
            await adapter.saveProfile(currentId, currentData);
            isDraftDirty = false;
            toolbar.refreshPresets?.(adapter.getProfiles(), currentId, isDraftDirty);
            FeedbackService.toastSuccess(`方案已成功保存`);
        },
        onRename: async () => {
            if (!currentId) return;
            const current = adapter.getProfiles().find((p) => p.id === currentId);
            const newName = await FeedbackService.prompt({
                title: `重命名${adapter.label}方案`,
                message: `请输入新的方案名称：`,
                defaultValue: current?.name || '',
                confirmText: '确认重命名'
            });
            if (!newName || !newName.trim()) return;

            const trimmed = newName.trim();
            if (trimmed === current?.name) return;

            const existing = adapter.getProfiles().find((p) => p.name === trimmed && p.id !== currentId);
            if (existing) {
                FeedbackService.toastWarn(`已存在同名方案【${trimmed}】，请换一个名称`);
                return;
            }

            await adapter.renameProfile(currentId, trimmed);
            toolbar.refreshPresets?.(adapter.getProfiles(), currentId, isDraftDirty);
            FeedbackService.toastSuccess(`方案已重命名为【${trimmed}】`);
        },
        onExport: () => {
            if (!currentId) return;
            const current = adapter.getProfiles().find((p) => p.id === currentId);
            if (!current) return;

            if (adapter.exportProfile) {
                const data = (current.data || (options.getCurrentData ? options.getCurrentData() : {})) as T;
                adapter.exportProfile(currentId, data);
            } else {
                const data = current.data || (options.getCurrentData ? options.getCurrentData() : {});
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${current.name || 'preset'}.json`;
                a.click();
                URL.revokeObjectURL(url);
                FeedbackService.toastSuccess(`已导出方案文件: ${current.name}.json`);
            }
        },
        onImport: async (content: string, fileName: string) => {
            try {
                if (adapter.importProfile) {
                    const importedId = await adapter.importProfile(content, fileName);
                    if (importedId) {
                        currentId = importedId;
                        if (options.applyData) {
                            options.applyData(importedId);
                        }
                        if (options.onRefresh) {
                            options.onRefresh();
                        }
                        isDraftDirty = false;
                        toolbar.refreshPresets?.(adapter.getProfiles(), currentId, isDraftDirty);
                        FeedbackService.toastSuccess(`成功导入方案: ${fileName}`);
                    }
                } else {
                    const parsed = JSON.parse(content);
                    const name = fileName.replace(/\.json$/i, '');
                    const newId = await adapter.createProfile(name, parsed);
                    currentId = newId;
                    if (options.applyData) {
                        options.applyData(newId);
                    }
                    if (options.onRefresh) {
                        options.onRefresh();
                    }
                    isDraftDirty = false;
                    toolbar.refreshPresets?.(adapter.getProfiles(), currentId, isDraftDirty);
                    FeedbackService.toastSuccess(`成功导入方案【${name}】`);
                }
            } catch (err: any) {
                FeedbackService.toastError(`导入方案失败: ${err?.message || err}`);
            }
        },
        onReset: async () => {
            const currentProfile = adapter.getProfiles().find((p) => p.id === currentId);
            const confirmed = await FeedbackService.confirm({
                title: `放弃未保存修改`,
                message: `确定要放弃方案【${currentProfile?.name || '当前方案'}】的未保存修改并还原快照吗？`,
                confirmText: '确认还原'
            });
            if (!confirmed) return;

            if (currentId && options.applyData) {
                options.applyData(currentId);
            }
            if (options.onRefresh) {
                options.onRefresh();
            }
            isDraftDirty = false;
            toolbar.refreshPresets?.(adapter.getProfiles(), currentId, isDraftDirty);
            FeedbackService.toastSuccess(`已还原方案【${currentProfile?.name || '当前方案'}】已保存数据`);
        },
        onDelete: async () => {
            const current = adapter.getProfiles().find((p) => p.id === currentId);
            const confirmed = await FeedbackService.confirm({
                title: `删除${adapter.label}方案`,
                message: `确定要删除方案【${current?.name || currentId}】吗？此操作不可恢复。`,
                isDangerous: true
            });
            if (!confirmed) return;

            const nextId = await adapter.deleteProfile(currentId);
            currentId = nextId || '';
            if (nextId && options.applyData) {
                options.applyData(nextId);
            }
            if (options.onRefresh) {
                options.onRefresh();
            }
            isDraftDirty = false;
            toolbar.refreshPresets?.(adapter.getProfiles(), currentId, isDraftDirty);
            FeedbackService.toastSuccess(`已成功删除方案【${current?.name || currentId}】`);
        }
    });

    toolbar.getCurrentData = options.getCurrentData;
    return toolbar;
}

/**
 * 预设方案工具栏适配器工厂方法
 * 负责连接领域层 ProfileService 与表现层 PresetToolbar 控件
 */
export function createPresetToolbarAdapter<K extends RegistryCategory>(
    profileService: ProfileService,
    category: K,
    options?: {
        onSelect?: (id: string) => void;
        onSave?: (id: string, data: PresetCategoryMap[K]['dataType']) => void;
    }
): PresetToolbarAdapter<PresetCategoryMap[K]['dataType']> {
    const def = PRESET_SCHEMA_BINDINGS[category];

    return {
        label: def.label,
        getProfiles: () => {
            const list = profileService.getEffectiveList(category);
            return list.map((item) => ({
                id: item.id,
                name: item.name,
                data: item.data
            })) as PresetItem<PresetCategoryMap[K]['dataType']>[];
        },
        getInitialId: () => profileService.getActiveId(category),
        createProfile: (name: string, data: PresetCategoryMap[K]['dataType']) => {
            return profileService.createProfile(category, name, data);
        },
        saveProfile: (id: string, data: PresetCategoryMap[K]['dataType']) => {
            profileService.saveProfile(category, id, data);
            if (options?.onSave) {
                options.onSave(id, data);
            }
        },
        renameProfile: (id: string, newName: string) => {
            profileService.renameProfile(category, id, newName);
        },
        deleteProfile: (id: string) => {
            return profileService.deleteProfile(category, id);
        },
        exportProfile: (id: string, data: PresetCategoryMap[K]['dataType']) => {
            profileService.exportProfile(category, id, data);
        },
        importProfile: (content: string, fileName: string) => {
            return profileService.importProfile(category, content, fileName);
        },
        onSelect: (id: string) => {
            profileService.applyProfile(category, id);
            if (options?.onSelect) {
                options.onSelect(id);
            }
        }
    };
}

