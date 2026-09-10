/**
 * 预设方案管理工具栏组件 (Preset Toolbar Control)
 * 提供预设下拉切换、新增、重命名、覆盖保存与删除交互
 */

import { FeedbackService } from '../feedback/feedback';
import { PresetStore } from '../../state/preset-store';
import { PresetItem } from '../../types';

export type { PresetItem };

const SVG_ICONS = {
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    save: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>',
    copy: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    rename: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
    import: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>',
    export: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    reset: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>',
    delete: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'
};

/**
 * 预设方案工具栏回调与配置接口
 */
export interface PresetToolbarOptions {
    profiles?: PresetItem[];
    currentId?: string;
    isDraftDirty?: boolean;
    isInvalid?: boolean;
    invalidReason?: string;
    onSelect?: (id: string) => void;
    onNew?: () => void;
    onSave?: () => void;
    onCopy?: () => void;
    onRename?: () => void;
    onImport?: (content: string, fileName: string) => void;
    onExport?: () => void;
    onReset?: () => void;
    onDelete?: () => void;
}

export type PresetToolbarElement = HTMLDivElement & {
    selectEl: HTMLSelectElement;
    getCurrentData?: () => unknown;
    refreshPresets?: (presets: PresetItem[], activeId: string, isDirty?: boolean, isInvalid?: boolean, invalidReason?: string) => void;
    setDirty?: (isDirty: boolean) => void;
    isDirty?: () => boolean;
    setError?: (isInvalid: boolean, tooltip?: string) => void;
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
    draftBadge.className = 'da-badge da-badge--dirty';
    draftBadge.style.display = options.isDraftDirty ? 'inline-flex' : 'none';
    draftBadge.textContent = '已修改';
    leftPart.appendChild(draftBadge);

    const invalidBadge = document.createElement('span');
    invalidBadge.className = 'da-badge da-badge--invalid';
    invalidBadge.style.display = options.isInvalid ? 'inline-flex' : 'none';
    invalidBadge.textContent = '失效';
    leftPart.appendChild(invalidBadge);

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

    const selectionDependentBtns: HTMLButtonElement[] = [];

    const createIconButton = (
        svgHtml: string,
        titleText: string,
        onClick: () => void,
        requiresSelection = false,
        isDanger = false,
        extraClass = ''
    ) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `da-icon-btn ${isDanger ? 'da-icon-btn--danger' : ''} ${extraClass}`.trim();
        btn.title = titleText;
        btn.setAttribute('aria-label', titleText);
        btn.innerHTML = svgHtml;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!btn.disabled) onClick();
        });

        if (requiresSelection) {
            selectionDependentBtns.push(btn);
        }
        return btn;
    };

    const updateActionButtonsState = () => {
        const hasSelection = Boolean(select.value);
        selectionDependentBtns.forEach((btn) => {
            btn.disabled = !hasSelection;
        });
    };

    select.addEventListener('change', () => {
        options.onSelect?.(select.value);
        updateActionButtonsState();
    });

    // 方案操作按钮组
    const newBtn = createIconButton(SVG_ICONS.plus, '新建预设方案', () => options.onNew?.(), false, false, 'da-preset-btn--new');

    const saveBtn = createIconButton(
        SVG_ICONS.save,
        options.isDraftDirty ? '当前方案有未保存的修改 (点击保存)' : '保存当前方案',
        () => options.onSave?.(),
        true,
        false,
        'da-preset-btn--save'
    );
    if (options.isDraftDirty) saveBtn.classList.add('is-dirty');

    const copyBtn = createIconButton(
        SVG_ICONS.copy,
        '另存为 / 复制当前方案',
        () => options.onCopy?.(),
        true,
        false,
        'da-preset-btn--copy'
    );

    const renameBtn = createIconButton(
        SVG_ICONS.rename,
        '重命名方案',
        () => options.onRename?.(),
        true,
        false,
        'da-preset-btn--rename'
    );

    const importBtn = createIconButton(
        SVG_ICONS.import,
        '导入 JSON 预设文件',
        () => hiddenFileInput.click(),
        false,
        false,
        'da-preset-btn--import'
    );

    const exportBtn = createIconButton(
        SVG_ICONS.export,
        '导出方案为 JSON 文件',
        () => options.onExport?.(),
        true,
        false,
        'da-preset-btn--export'
    );

    const resetBtn = createIconButton(
        SVG_ICONS.reset,
        '放弃未保存修改 / 还原方案快照',
        () => options.onReset?.(),
        true,
        false,
        'da-preset-btn--reset'
    );

    const deleteBtn = createIconButton(
        SVG_ICONS.delete,
        '删除当前方案',
        () => options.onDelete?.(),
        true,
        true,
        'da-preset-btn--delete'
    );

    rightPart.appendChild(newBtn);
    rightPart.appendChild(saveBtn);
    rightPart.appendChild(copyBtn);
    rightPart.appendChild(renameBtn);
    rightPart.appendChild(importBtn);
    rightPart.appendChild(exportBtn);
    rightPart.appendChild(resetBtn);
    rightPart.appendChild(deleteBtn);

    container.appendChild(leftPart);
    container.appendChild(rightPart);

    const setSelectDirty = (isDirty: boolean) => {
        select.classList.toggle('is-dirty', isDirty);
        draftBadge.style.display = isDirty ? 'inline-flex' : 'none';
        saveBtn.classList.toggle('is-dirty', isDirty);
        saveBtn.title = isDirty ? '当前方案有未保存的修改 (点击保存)' : '保存当前方案';
    };

    const setSelectError = (isInvalid: boolean, tooltip?: string) => {
        select.classList.toggle('is-invalid', isInvalid);
        select.classList.toggle('da-select-error', isInvalid);
        invalidBadge.style.display = isInvalid ? 'inline-flex' : 'none';
        if (tooltip) {
            invalidBadge.title = tooltip;
            select.title = isInvalid ? tooltip : '切换预设方案';
        } else {
            select.title = '切换预设方案';
        }
    };

    if (options.isDraftDirty) {
        setSelectDirty(true);
    }
    if (options.isInvalid) {
        setSelectError(true, options.invalidReason);
    }

    updateActionButtonsState();

    container.selectEl = select;
    container.refreshPresets = (presets: PresetItem[], activeId: string, isDirty = false, isInvalid = false, invalidReason?: string) => {
        renderSelectOptions(presets, activeId);
        setSelectDirty(isDirty);
        setSelectError(isInvalid, invalidReason);
        updateActionButtonsState();
    };

    container.setDirty = (isDirty: boolean) => {
        setSelectDirty(isDirty);
    };

    container.setError = (isInvalid: boolean, tooltip?: string) => {
        setSelectError(isInvalid, tooltip);
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
    onResetOverride?: () => void;
    onCopyOverride?: () => void;
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
                if (!canProceed) {
                    toolbar.selectEl.value = currentId;
                    return;
                }
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
            FeedbackService.toastSuccess(`方案已保存`);
        },
        onCopy: async () => {
            if (options.onCopyOverride) {
                options.onCopyOverride();
                return;
            }
            if (!currentId) {
                FeedbackService.toastWarn('未选择任何方案，无法复制');
                return;
            }
            const current = adapter.getProfiles().find((p) => p.id === currentId);
            if (!current) return;

            const copyName = await FeedbackService.prompt({
                title: `另存为 / 复制${adapter.label}方案`,
                message: `请输入新方案名称：`,
                defaultValue: `${current.name} (副本)`,
                confirmText: '确认复制'
            });
            if (!copyName || !copyName.trim()) return;

            const trimmed = copyName.trim();
            const existing = adapter.getProfiles().find((p) => p.name === trimmed);
            if (existing) {
                FeedbackService.toastWarn(`已存在同名方案【${trimmed}】，请换一个名称`);
                return;
            }

            const currentData = options.getCurrentData ? options.getCurrentData() : (((current.data || {}) as unknown) as T);
            const newId = await adapter.createProfile(trimmed, currentData);
            currentId = newId;
            if (options.applyData) {
                options.applyData(newId);
            }
            if (options.onRefresh) {
                options.onRefresh();
            }
            isDraftDirty = false;
            toolbar.refreshPresets?.(adapter.getProfiles(), currentId, isDraftDirty);
            FeedbackService.toastSuccess(`成功复制方案【${trimmed}】`);
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

            if (options.onResetOverride) {
                options.onResetOverride();
            } else if (currentId && options.applyData) {
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

    const origSetDirty = toolbar.setDirty;
    toolbar.setDirty = (dirty: boolean) => {
        isDraftDirty = dirty;
        origSetDirty?.(dirty);
    };
    toolbar.isDirty = () => isDraftDirty;

    toolbar.getCurrentData = options.getCurrentData;
    return toolbar;
}

/**
 * 针对统一预设存储 (PresetStore) 的通用方案适配器构建选项
 */
export interface PresetStoreAdapterOptions<T> {
    category: string;
    subCategory?: string;
    label: string;
    getPresets: () => PresetItem<T>[];
    getActiveId: () => string;
    onPresetsChange: (presets: PresetItem<T>[], activeId: string) => void;
    onApply?: (preset: PresetItem<T>) => void | Promise<void>;
    generateId?: (name: string) => string;
}

/** 兼容旧命名类型 */
export type FilePresetAdapterOptions<T> = PresetStoreAdapterOptions<T>;

/**
 * 创建面向统一预设存储 (PresetStore) 的通用方案适配器
 */
export function createPresetStoreAdapter<T>(options: PresetStoreAdapterOptions<T>): PresetToolbarAdapter<T> {
    const { category, subCategory, label, getPresets, getActiveId, onPresetsChange, onApply, generateId } = options;

    return {
        label,
        getProfiles: () => getPresets(),
        getInitialId: () => getActiveId(),
        createProfile: async (name: string, data: T) => {
            const rawId = generateId ? generateId(name) : `${subCategory || category}_${Date.now()}`;
            const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
            const ok = await PresetStore.save(category, { id, name, data }, subCategory);
            if (!ok) {
                FeedbackService.toastError(`新建${label}方案失败：无法写入本地存储`);
                throw new Error(`新建方案失败: 本地存储写入异常`);
            }
            FeedbackService.toastSuccess(`方案已保存: ${name}`);
            const list = [...getPresets(), { id, name, data }];
            onPresetsChange(list, id);
            return id;
        },
        saveProfile: async (id: string, data: T) => {
            const list = getPresets();
            const idx = list.findIndex((p) => p.id === id);
            const name = idx >= 0 ? list[idx].name : id;
            const ok = await PresetStore.save(category, { id, name, data }, subCategory);
            if (!ok) {
                FeedbackService.toastError(`保存${label}方案失败：无法更新本地存储`);
                return;
            }
            FeedbackService.toastSuccess(`方案已成功保存: ${name}`);
            if (idx >= 0) {
                const next = [...list];
                next[idx] = { ...next[idx], data };
                onPresetsChange(next, id);
            } else {
                onPresetsChange([...list, { id, name, data }], id);
            }
        },
        renameProfile: async (id: string, newName: string) => {
            const list = getPresets();
            const idx = list.findIndex((p) => p.id === id);
            if (idx >= 0) {
                const data = list[idx].data as T;
                const ok = await PresetStore.save(category, { id, name: newName, data }, subCategory);
                if (!ok) {
                    FeedbackService.toastError(`重命名${label}方案失败：无法写入本地存储`);
                    return;
                }
                FeedbackService.toastSuccess(`方案已重命名为: ${newName}`);
                const next = [...list];
                next[idx] = { ...next[idx], name: newName };
                onPresetsChange(next, id);
            }
        },
        deleteProfile: async (id: string) => {
            const ok = await PresetStore.delete(category, id, subCategory);
            if (!ok) {
                FeedbackService.toastError(`删除${label}方案失败：无法删除本地预设`);
                throw new Error(`删除方案失败: 本地操作异常`);
            }
            FeedbackService.toastInfo(`方案已删除`);
            const list = getPresets().filter((p) => p.id !== id);
            const nextActiveId = list[0]?.id || '';
            onPresetsChange(list, nextActiveId);
            if (list[0] && onApply) {
                await onApply(list[0]);
            }
            return nextActiveId;
        },
        exportProfile: async (_id: string, data: T) => {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${label}_方案.json`;
            a.click();
            URL.revokeObjectURL(url);
        },
        importProfile: async (content: string, fileName: string) => {
            const parsed = JSON.parse(content);
            const name = fileName.replace(/\.json$/i, '');
            const rawId = `${subCategory || category}_${Date.now()}`;
            const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
            const ok = await PresetStore.save(category, { id, name, data: parsed }, subCategory);
            if (!ok) {
                FeedbackService.toastError(`导入${label}方案失败：无法写入本地存储`);
                throw new Error(`导入方案失败: 本地写入异常`);
            }
            FeedbackService.toastSuccess(`已成功导入方案: ${name}`);
            const list = [...getPresets(), { id, name, data: parsed }];
            onPresetsChange(list, id);
            return id;
        },
        onSelect: async (id: string) => {
            const profile = getPresets().find((p) => p.id === id);
            if (profile && onApply) {
                await onApply(profile);
            }
            onPresetsChange(getPresets(), id);
        }
    };
}

