/**
 * @module ui/components/preset-toolbar
 * @description 通用预设方案管理工具栏与适配器体系 (PresetToolbar & PresetToolbarAdapter)
 */

import { FeedbackService } from '../feedback-service';

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
export function renderPresetToolbar(options: PresetToolbarOptions): PresetToolbarElement {
    const container = document.createElement('div') as PresetToolbarElement;
    container.className = 'da-preset-toolbar';

    const leftPart = document.createElement('div');
    leftPart.className = 'da-preset-toolbar-left';

    const select = document.createElement('select');
    select.className = 'da-select';
    select.style.flex = '1';
    select.style.minWidth = '160px';

    const populateSelect = (presetList: PresetItem[], activeId: string) => {
        select.innerHTML = '';
        if (presetList.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(无可选预设方案)';
            select.appendChild(opt);
        } else {
            presetList.forEach((p) => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (p.id === activeId) opt.selected = true;
                select.appendChild(opt);
            });
        }
    };

    const activeId = options.currentId || '';
    const initialProfiles = options.profiles || [];
    populateSelect(initialProfiles, activeId);

    let currentSelectedVal = select.value || activeId;
    select.addEventListener('change', () => {
        const newVal = select.value;
        if (newVal === currentSelectedVal) return;
        currentSelectedVal = newVal;
        if (options.onSelect && newVal) {
            options.onSelect(newVal);
        }
        updateActionButtonsState();
    });

    leftPart.appendChild(select);

    const draftBadge = document.createElement('span');
    draftBadge.className = 'da-badge dirty';
    draftBadge.style.display = options.isDraftDirty ? 'inline-flex' : 'none';
    draftBadge.textContent = '已修改';
    leftPart.appendChild(draftBadge);

    container.appendChild(leftPart);

    const rightPart = document.createElement('div');
    rightPart.className = 'da-preset-toolbar-actions';

    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = '.json';
    hiddenFileInput.style.display = 'none';

    hiddenFileInput.addEventListener('change', () => {
        const file = hiddenFileInput.files?.[0];
        if (!file || !options.onImport) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const content = (ev.target?.result as string) || '';
            options.onImport!(content, file.name);
        };
        reader.readAsText(file, 'UTF-8');
        hiddenFileInput.value = '';
    });
    rightPart.appendChild(hiddenFileInput);

    const selectionDependentBtns: Array<{ btn: HTMLButtonElement; isDanger?: boolean }> = [];

    const createIconButton = (
        iconHtml: string,
        titleText: string,
        onClick: () => void,
        requiresSelection = false,
        isDanger = false
    ) => {
        const btn = document.createElement('button');
        btn.className = `da-icon-btn ${isDanger ? 'danger' : ''}`;
        btn.title = titleText;
        btn.innerHTML = iconHtml;

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

    // 1. ➕ 新建方案
    if (options.onNew) {
        rightPart.appendChild(createIconButton('➕', '新建预设方案', options.onNew));
    }

    // 2. 💾 保存方案
    if (options.onSave) {
        rightPart.appendChild(createIconButton('💾', '覆盖保存当前方案', options.onSave, true));
    }

    // 3. ✏️ 重命名方案
    if (options.onRename) {
        rightPart.appendChild(createIconButton('✏️', '重命名方案', options.onRename, true));
    }

    // 4. 📤 导出方案 (JSON)
    if (options.onExport) {
        rightPart.appendChild(createIconButton('📤', '导出为 JSON', options.onExport, true));
    }

    // 5. 📥 导入方案 (JSON)
    if (options.onImport) {
        rightPart.appendChild(
            createIconButton('📥', '导入 JSON 预设', () => {
                hiddenFileInput.click();
            })
        );
    }

    // 6. 🔄 重置为默认预设
    if (options.onReset) {
        rightPart.appendChild(createIconButton('🔄', '重置为初始配置', options.onReset));
    }

    // 7. 🗑️ 删除方案
    if (options.onDelete) {
        rightPart.appendChild(createIconButton('🗑️', '删除此方案', options.onDelete, true, true));
    }

    container.appendChild(rightPart);
    updateActionButtonsState();

    container.refreshPresets = (presets: PresetItem[], activeId: string, isDirty = false) => {
        populateSelect(presets, activeId);
        draftBadge.style.display = isDirty ? 'inline-flex' : 'none';
        updateActionButtonsState();
    };

    return container;
}

export interface BoundPresetToolbarOptions<T = unknown> {
    adapter: PresetToolbarAdapter<T>;
    getCurrentData: () => T;
    applyData: (id: string) => void;
    onRefresh: () => void;
}

export function bindPresetToolbar<T>(options: BoundPresetToolbarOptions<T>): PresetToolbarElement {
    const { adapter, getCurrentData, applyData, onRefresh } = options;

    const initialProfiles = adapter.getProfiles();
    const initialId = adapter.getInitialId();

    const toolbar = renderPresetToolbar({
        profiles: initialProfiles,
        currentId: initialId,
        onSelect: async (id) => {
            if (adapter.onSelect) await adapter.onSelect(id);
            applyData(id);
            onRefresh();
        },
        onNew: async () => {
            const name = await FeedbackService.prompt({
                title: `新建【${adapter.label}】方案`,
                message: '请输入新方案名称：',
                defaultValue: `新${adapter.label}方案`
            });
            if (!name) return;
            const curData = getCurrentData();
            const newId = await adapter.createProfile(name, curData);
            applyData(newId);
            onRefresh();
            FeedbackService.toast(`已成功创建方案【${name}】`);
        },
        onSave: async () => {
            const curId = adapter.getInitialId();
            if (!curId) return;
            const curData = getCurrentData();
            await adapter.saveProfile(curId, curData);
            FeedbackService.toast(`已成功保存当前【${adapter.label}】方案`);
            onRefresh();
        },
        onRename: async () => {
            const curId = adapter.getInitialId();
            if (!curId) return;
            const currentProfile = adapter.getProfiles().find((p) => p.id === curId);
            const newName = await FeedbackService.prompt({
                title: `重命名【${adapter.label}】方案`,
                message: '请输入新的方案名称：',
                defaultValue: currentProfile?.name || ''
            });
            if (!newName || newName === currentProfile?.name) return;
            await adapter.renameProfile(curId, newName);
            onRefresh();
            FeedbackService.toast(`方案已重命名为【${newName}】`);
        },
        onExport: () => {
            const curId = adapter.getInitialId();
            const profile = adapter.getProfiles().find((p) => p.id === curId);
            if (!profile) return;
            const jsonStr = JSON.stringify(profile, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${profile.name || 'preset'}.json`;
            a.click();
            URL.revokeObjectURL(url);
            FeedbackService.toast(`已成功导出方案【${profile.name}】`);
        },
        onImport: async (content, fileName) => {
            try {
                const parsed = JSON.parse(content);
                const name = parsed.name || fileName.replace(/\.json$/i, '');
                const data = parsed.data || parsed;
                const newId = await adapter.createProfile(name, data);
                applyData(newId);
                onRefresh();
                FeedbackService.toast(`已成功导入预设【${name}】`);
            } catch (err: any) {
                FeedbackService.toast(`导入失败: ${err.message || 'JSON 格式解析错误'}`, true);
            }
        },
        onReset: async () => {
            const confirmed = await FeedbackService.confirm({
                title: '重置预设方案',
                message: `确定要将【${adapter.label}】重置为默认初始配置吗？自定义方案将丢失！`,
                confirmText: '确认重置',
                isDangerous: true
            });
            if (confirmed) {
                await adapter.resetToDefault();
                onRefresh();
                FeedbackService.toast(`已将【${adapter.label}】重置为默认配置`);
            }
        },
        onDelete: async () => {
            const curId = adapter.getInitialId();
            if (!curId) return;
            const confirmed = await FeedbackService.confirm({
                title: '删除方案',
                message: `确定要彻底删除当前选中的【${adapter.label}】预设方案吗？`,
                confirmText: '确认删除',
                isDangerous: true
            });
            if (confirmed) {
                const nextId = await adapter.deleteProfile(curId);
                applyData(nextId);
                onRefresh();
                FeedbackService.toast(`已成功删除方案`);
            }
        }
    });

    toolbar.getCurrentData = getCurrentData;
    return toolbar;
}

