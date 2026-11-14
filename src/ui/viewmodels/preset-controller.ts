/**
 * 通用预设状态控制器 (PresetController)。
 *
 * @remarks
 * 封装预设的查询、切换、新建、保存、另存为、重命名、导入、导出与删除逻辑。
 * 基于 @preact/signals 维护当前预设快照、未保存草稿、修改字段集与失效字段集。
 */

import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import type { PresetCategory, PresetItem, ProviderType } from '@types';
import type { PresetActionType, PresetToolbarItem } from '../composite/preset-toolbar';
import { settingsStore } from '../../store/settings-store';
import { Toast } from '../feedback/toast';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { downloadJsonFile } from '../../util/download';

export interface PresetControllerOptions<TData extends Record<string, unknown>> {
    /** 预设所属分类 */
    category: PresetCategory;
    /** 若为 drawing 分类，需指定归属的提供商类型 */
    provider?: ProviderType;
    /** 新建或克隆预设时的 ID 前缀，默认 `${provider || category}_preset_` */
    idPrefix?: string;
    /** 新建预设弹窗的提示语，默认 "请输入新预设名称:" */
    promptMessageForNew?: string;
    /** 新建预设弹窗的默认名称，默认 "新建预设" */
    defaultNewName?: string;
    /** 重命名弹窗的提示语，默认 "请输入预设新名称:" */
    promptMessageForRename?: string;
    /**
     * 另存为预设弹窗提示语。
     * 若未提供，默认使用 "请输入另存预设的新名称:"，并通过 ConfirmDialog.prompt 交互输入。
     */
    promptMessageForSaveAs?: string;
    /** 导入预设缺省名称，默认 "导入预设" */
    defaultImportName?: string;
    /** 导出文件名前缀 */
    exportFilenamePrefix?: string;
    /** 新建预设时的干净初始默认模板生成函数。未提供时使用首个基准预设的数据克隆或空对象 */
    defaultTemplate?: () => TData;
    /** 删除时要求至少保留的预设数量（如主题要求至少保留 1 套，生图预设允许删空为 0） */
    minRemainingOnDelete?: number;
    /** 删除受阻时的提示消息 */
    minRemainingWarning?: string;
    /** 自定义获取预设列表函数（如从独立服务或动态源提供预设列表） */
    getPresetsOverride?: () => PresetItem<TData>[];
    /** 读取当前持久化激活预设 ID 的函数 */
    getActiveId: () => string;
    /** 将激活预设 ID 写回持久化存储的函数 */
    setActiveId: (id: string) => void;
    /** 保存或另存为预设前的必填项校验，返回缺失字段名称列表 */
    validateRequired?: (draft: TData) => string[];
    /** 执行新建、保存、另存为操作前的额外前置校验 */
    canPerformAction?: (action: PresetActionType, draft: TData) => { allowed: boolean; message?: string };
    /** 自定义脏字段集计算函数；未提供时默认按字段浅比较 */
    evaluateDirtyFields?: (draft: TData, baseline: TData) => Set<string>;
    /** 自定义失效字段集计算函数（如检查绑定的工作流或提示词 ID 是否存在） */
    evaluateInvalidFields?: (draft: TData) => Set<string>;
    /** 预设切换、重置或保存完成后的回调 */
    onPresetApplied?: (preset: PresetItem<TData> | null, draft: TData) => void;
    /** 草稿字段发生修改时的回调 */
    onDraftChanged?: (draft: TData) => void;
    /** 是否在保存、新建、重命名、删除、重置时弹出 Toast 提示 */
    showToast?: boolean;
}

export class PresetController<TData extends Record<string, unknown>> {
    private readonly options: PresetControllerOptions<TData>;
    private readonly idPrefix: string;

    /** 当前分类下的预设列表 */
    public readonly presets: Signal<PresetItem<TData>[]>;
    /** 当前激活的预设 ID */
    public readonly activePresetId: Signal<string>;
    /** 当前激活的预设完整对象（无预设时为 null） */
    public readonly currentPreset: Signal<PresetItem<TData> | null>;
    /** 激活预设的持久化基准快照 */
    public readonly baselineSnapshot: Signal<TData>;
    /** 表单当前正在编辑的未保存草稿 */
    public readonly draftConfig: Signal<TData>;
    /** 外部手动标记的附加失效字段集（如输入框内尚未写入草稿的非法 JSON） */
    public readonly extraInvalidFields: Signal<Set<string>>;

    /** 供 PresetToolbar 直接消费的轻量条目列表 */
    public readonly toolbarItems: ReadonlySignal<PresetToolbarItem[]>;
    /** 自动派生的已修改字段集合 */
    public readonly dirtyFields: ReadonlySignal<Set<string>>;
    /** 当前是否存在未保存修改 */
    public readonly isDirty: ReadonlySignal<boolean>;
    /** 自动派生的失效字段集合 */
    public readonly invalidFields: ReadonlySignal<Set<string>>;

    public constructor(options: PresetControllerOptions<TData>) {
        this.options = options;
        this.idPrefix =
            options.idPrefix ?? `${options.provider || options.category}_preset_`;

        this.presets = signal<PresetItem<TData>[]>([]);
        this.activePresetId = signal<string>('');
        this.currentPreset = signal<PresetItem<TData> | null>(null);
        this.baselineSnapshot = signal<TData>({} as TData);
        this.draftConfig = signal<TData>({} as TData);
        this.extraInvalidFields = signal<Set<string>>(new Set());

        this.toolbarItems = computed(() =>
            this.presets.value.map((p) => ({ id: p.id, name: p.name }))
        );

        this.dirtyFields = computed(() => {
            const draft = this.draftConfig.value;
            const base = this.baselineSnapshot.value;
            if (this.options.evaluateDirtyFields) {
                return this.options.evaluateDirtyFields(draft, base);
            }
            return PresetController.defaultEvaluateDirty(draft, base);
        });

        this.isDirty = computed(() => this.dirtyFields.value.size > 0);

        this.invalidFields = computed(() => {
            const result = this.options.evaluateInvalidFields
                ? new Set(this.options.evaluateInvalidFields(this.draftConfig.value))
                : new Set<string>();
            for (const f of this.extraInvalidFields.value) {
                result.add(f);
            }
            return result;
        });

        // 初始化加载当前激活预设
        const initialId = this.options.getActiveId();
        this.applyActivePreset(initialId, { persist: false, silent: true });
    }

    /**
     * 默认的逐字段浅比对脏状态计算。
     */
    public static defaultEvaluateDirty<T extends Record<string, unknown>>(
        draft: T,
        baseline: T
    ): Set<string> {
        const dirty = new Set<string>();
        const allKeys = new Set([...Object.keys(draft || {}), ...Object.keys(baseline || {})]);
        for (const key of allKeys) {
            const curVal = draft?.[key];
            const baseVal = baseline?.[key];
            if (curVal === baseVal) continue;
            if ((curVal === undefined || curVal === '') && (baseVal === undefined || baseVal === '')) {
                continue;
            }
            if (
                typeof curVal === 'object' &&
                curVal !== null &&
                typeof baseVal === 'object' &&
                baseVal !== null
            ) {
                if (JSON.stringify(curVal) !== JSON.stringify(baseVal)) {
                    dirty.add(key);
                }
            } else if (curVal !== baseVal) {
                dirty.add(key);
            }
        }
        return dirty;
    }

    /**
     * 查询最新预设列表。
     */
    public fetchPresetsList(): PresetItem<TData>[] {
        if (this.options.getPresetsOverride) {
            return this.options.getPresetsOverride();
        }
        return settingsStore.getPresets<TData>(this.options.category, this.options.provider);
    }

    /**
     * 刷新预设列表信号（当外部新增或修改了预设池时调用）。
     */
    public refreshPresets(): void {
        this.presets.value = this.fetchPresetsList();
    }

    /**
     * 从存储层重新加载预设列表并同步当前激活预设快照。
     */
    public reloadFromStore(): void {
        const targetId = this.options.getActiveId() || this.activePresetId.value;
        this.applyActivePreset(targetId, { persist: false, silent: true });
    }

    /**
     * 激活并应用指定的预设。
     */
    public applyActivePreset(
        presetId: string,
        options?: { persist?: boolean; silent?: boolean }
    ): void {
        const list = this.fetchPresetsList();
        this.presets.value = list;

        const target = list.find((p) => p.id === presetId) ?? (list.length > 0 ? list[0] : null);

        if (target) {
            this.currentPreset.value = target;
            this.activePresetId.value = target.id;
            this.baselineSnapshot.value = structuredClone(target.data || ({} as TData));
            this.draftConfig.value = structuredClone(target.data || ({} as TData));
            this.extraInvalidFields.value = new Set();

            const currentStoredId = this.options.getActiveId();
            if (options?.persist !== false && target.id !== currentStoredId) {
                this.options.setActiveId(target.id);
            }
        } else {
            // 整个预设池已清空：置空激活预设，草稿保留当前值
            this.currentPreset.value = null;
            this.activePresetId.value = '';
            this.baselineSnapshot.value = {} as TData;
            this.extraInvalidFields.value = new Set();
            this.options.setActiveId('');
        }

        if (!options?.silent) {
            this.options.onPresetApplied?.(this.currentPreset.value, this.draftConfig.value);
        }
    }

    /**
     * 更新草稿中的单个字段并触发响应式脏状态重算。
     */
    public updateDraft<K extends keyof TData>(key: K, value: TData[K]): void {
        this.draftConfig.value = {
            ...this.draftConfig.value,
            [key]: value,
        };
        this.options.onDraftChanged?.(this.draftConfig.value);
    }

    /**
     * 批量合并更新草稿中的多个字段。
     */
    public patchDraft(patch: Partial<TData>): void {
        this.draftConfig.value = {
            ...this.draftConfig.value,
            ...patch,
        };
        this.options.onDraftChanged?.(this.draftConfig.value);
    }

    /**
     * 手动标记或解除某个字段的校验失效状态。
     */
    public setFieldInvalid(key: string, invalid: boolean): void {
        const next = new Set(this.extraInvalidFields.value);
        if (invalid) {
            next.add(key);
        } else {
            next.delete(key);
        }
        this.extraInvalidFields.value = next;
    }

    /**
     * 统一响应 PresetToolbar 的预设切换与 8 项工具栏操作动作。
     */
    public async handleAction(
        action: PresetActionType,
        targetId?: string
    ): Promise<boolean> {
        if (this.options.canPerformAction) {
            const check = this.options.canPerformAction(action, this.draftConfig.value);
            if (!check.allowed) {
                if (check.message) {
                    Toast.show(check.message, { level: 'error' });
                }
                return false;
            }
        }

        switch (action) {
            case 'select': {
                if (targetId !== undefined) {
                    if (
                        targetId !== this.activePresetId.value &&
                        this.isDirty.value
                    ) {
                        const confirmed = await ConfirmDialog.confirm({
                            title: '切换预设确认',
                            message:
                                '当前预设存在未保存的修改，切换将放弃未保存的修改。是否确定继续切换？',
                        });
                        if (!confirmed) {
                            return false;
                        }
                    }
                    this.applyActivePreset(targetId);
                    if (this.options.showToast && this.currentPreset.value) {
                        Toast.show(`已切换预设: ${this.currentPreset.value.name}`, { level: 'info' });
                    }
                }
                return true;
            }

            case 'new': {
                // 若当前预设存在未保存修改，拦截二次确认防止误触放弃草稿
                if (this.isDirty.value) {
                    const confirmed = await ConfirmDialog.confirm({
                        title: '新建预设确认',
                        message: '当前预设存在未保存的修改，新建将放弃未保存的修改。是否确定继续新建？',
                    });
                    if (!confirmed) return false;
                }

                const list = this.fetchPresetsList();
                const existingNames = new Set(list.map((p) => p.name));
                const promptMsg = this.options.promptMessageForNew ?? '请输入新预设名称:';
                const defaultName = this.options.defaultNewName ?? '新建预设';

                const newName = await ConfirmDialog.prompt({
                    title: '新建预设',
                    message: promptMsg,
                    defaultValue: defaultName,
                    placeholder: '请输入预设名称',
                    validator: (val) => {
                        if (existingNames.has(val)) {
                            return '预设名称已存在，请换一个名称';
                        }
                        return null;
                    },
                });
                if (!newName || !newName.trim()) return false;

                const newId = this.generateUniqueId();
                const initialData = this.options.defaultTemplate
                    ? this.options.defaultTemplate()
                    : (list[0]?.data ? structuredClone(list[0].data) : ({} as TData));

                const newPreset: PresetItem<TData> = {
                    id: newId,
                    name: newName.trim(),
                    data: structuredClone(initialData),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset(this.options.category, newPreset, this.options.provider);
                this.applyActivePreset(newId);
                if (this.options.showToast) {
                    Toast.show(`已新建预设: ${newPreset.name}`, { level: 'success' });
                }
                return true;
            }

            case 'save': {
                if (this.options.validateRequired) {
                    const missing = this.options.validateRequired(this.draftConfig.value);
                    if (missing.length > 0) {
                        Toast.show(`请先填写必填项：${missing.join('、')}`, { level: 'warning' });
                        return false;
                    }
                }
                const cur = this.currentPreset.value;
                if (!cur) {
                    // 当无激活预设时，弹窗询问新预设名称并将当前草稿直接保存为新预设，不丢失用户参数
                    const list = this.fetchPresetsList();
                    const existingNames = new Set(list.map((p) => p.name));
                    const newName = await ConfirmDialog.prompt({
                        title: '保存预设',
                        message: this.options.promptMessageForNew ?? '请输入预设名称:',
                        defaultValue: this.options.defaultNewName ?? '新建预设',
                        placeholder: '请输入预设名称',
                        validator: (val) => {
                            if (existingNames.has(val)) {
                                return '预设名称已存在，请换一个名称';
                            }
                            return null;
                        },
                    });
                    if (!newName || !newName.trim()) return false;

                    const newId = this.generateUniqueId();
                    const newPreset: PresetItem<TData> = {
                        id: newId,
                        name: newName.trim(),
                        data: structuredClone(this.draftConfig.value),
                        updatedAt: Date.now(),
                    };
                    settingsStore.savePreset(this.options.category, newPreset, this.options.provider);
                    this.applyActivePreset(newId);
                    if (this.options.showToast) {
                        Toast.show(`已新建并保存预设: ${newPreset.name}`, { level: 'success' });
                    }
                    return true;
                }

                const toSave: PresetItem<TData> = {
                    ...cur,
                    data: structuredClone(this.draftConfig.value),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset(this.options.category, toSave, this.options.provider);
                this.currentPreset.value = toSave;
                this.baselineSnapshot.value = structuredClone(this.draftConfig.value);
                this.refreshPresets();
                this.options.onPresetApplied?.(toSave, this.draftConfig.value);
                if (this.options.showToast) {
                    Toast.show('已成功保存修改', { level: 'success' });
                }
                return true;
            }

            case 'saveAs': {
                if (this.options.validateRequired) {
                    const missing = this.options.validateRequired(this.draftConfig.value);
                    if (missing.length > 0) {
                        Toast.show(`请先填写必填项：${missing.join('、')}`, { level: 'warning' });
                        return false;
                    }
                }
                const cur = this.currentPreset.value;
                if (!cur) return false;

                const defaultCloneName = `${cur.name || '预设'} (副本)`;
                const list = this.fetchPresetsList();
                const existingNames = new Set(list.map((p) => p.name));
                const promptMsg = this.options.promptMessageForSaveAs ?? '请输入另存预设的新名称:';

                const targetName = await ConfirmDialog.prompt({
                    title: '另存为新预设',
                    message: promptMsg,
                    defaultValue: defaultCloneName,
                    placeholder: '请输入预设名称',
                    validator: (val) => {
                        if (existingNames.has(val)) {
                            return '预设名称已存在，请换一个名称';
                        }
                        return null;
                    },
                });
                if (!targetName || !targetName.trim()) return false;

                const newId = this.generateUniqueId();
                const cloned: PresetItem<TData> = {
                    id: newId,
                    name: targetName.trim(),
                    data: structuredClone(this.draftConfig.value),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset(this.options.category, cloned, this.options.provider);
                this.applyActivePreset(newId);
                if (this.options.showToast) {
                    Toast.show(`已另存预设: ${targetName.trim()}`, { level: 'success' });
                }
                break;
            }

            case 'rename': {
                const cur = this.currentPreset.value;
                if (!cur) return false;

                const list = this.fetchPresetsList();
                const otherNames = new Set(list.filter((p) => p.id !== cur.id).map((p) => p.name));
                const promptMsg = this.options.promptMessageForRename ?? '请输入预设新名称:';

                const newName = await ConfirmDialog.prompt({
                    title: '重命名预设',
                    message: promptMsg,
                    defaultValue: cur.name,
                    placeholder: '请输入预设新名称',
                    validator: (val) => {
                        if (val === cur.name) {
                            return '新名称不能与当前名称相同';
                        }
                        if (otherNames.has(val)) {
                            return '预设名称已存在，请换一个名称';
                        }
                        return null;
                    },
                });
                if (!newName || !newName.trim() || newName.trim() === cur.name) return false;

                const updated: PresetItem<TData> = {
                    ...cur,
                    name: newName.trim(),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset(this.options.category, updated, this.options.provider);
                this.currentPreset.value = updated;
                this.refreshPresets();
                if (this.options.showToast) {
                    Toast.show('已重命名预设', { level: 'success' });
                }
                break;
            }

            case 'export': {
                const cur = this.currentPreset.value;
                if (!cur) return false;

                const prefix =
                    this.options.exportFilenamePrefix ??
                    `${this.options.provider || this.options.category}_preset_`;
                const safeName = (cur.name || cur.id).replace(/\s+/g, '_');
                downloadJsonFile(`${prefix}${safeName}.json`, cur);
                break;
            }

            case 'reset': {
                if (this.isDirty.value) {
                    const confirmed = await ConfirmDialog.confirm({
                        title: '重置修改确认',
                        message: '确定要放弃当前未保存的修改并恢复为激活预设初始值吗？',
                    });
                    if (!confirmed) return false;
                }
                this.discardDraft();
                if (this.options.showToast) {
                    Toast.show('已放弃未保存修改', { level: 'info' });
                }
                break;
            }

            case 'delete': {
                const targetIdToDelete = targetId ?? this.currentPreset.value?.id;
                if (!targetIdToDelete) return false;

                const minRemaining = this.options.minRemainingOnDelete ?? 0;
                const currentList = this.fetchPresetsList();
                if (currentList.length <= minRemaining) {
                    Toast.show(
                        this.options.minRemainingWarning ?? '至少保留一套基准预设，无法删除',
                        { level: 'warning' }
                    );
                    return false;
                }

                const targetItem = currentList.find((p) => p.id === targetIdToDelete);
                const confirmed = await ConfirmDialog.confirm({
                    title: '删除预设确认',
                    message: `确定要删除预设「${targetItem?.name || targetIdToDelete}」吗？此操作无法撤销。`,
                    isDanger: true,
                    confirmText: '删除',
                });
                if (!confirmed) return false;

                const isDeletingActive = this.currentPreset.value?.id === targetIdToDelete;
                settingsStore.deletePreset(this.options.category, targetIdToDelete, this.options.provider);
                const remaining = this.fetchPresetsList();

                if (isDeletingActive) {
                    if (remaining.length > 0) {
                        this.applyActivePreset(remaining[0].id);
                    } else {
                        // 预设池删空：保留当前控件草稿值，置空激活预设 ID
                        this.presets.value = [];
                        this.currentPreset.value = null;
                        this.activePresetId.value = '';
                        this.baselineSnapshot.value = structuredClone(this.draftConfig.value);
                        this.options.setActiveId('');
                    }
                } else {
                    this.presets.value = remaining;
                }

                if (this.options.showToast) {
                    Toast.show('已删除指定预设', { level: 'info' });
                }
                break;
            }
        }
        return true;
    }

    /**
     * 静默放弃当前未保存草稿，恢复为激活预设基线快照。
     */
    public discardDraft(): void {
        this.draftConfig.value = structuredClone(this.baselineSnapshot.value);
        this.extraInvalidFields.value = new Set();
        this.options.onDraftChanged?.(this.draftConfig.value);
        this.options.onPresetApplied?.(this.currentPreset.value, this.draftConfig.value);
    }

    /**
     * 解析并导入外部 JSON 预设文件。
     */
    public handleImportFile(file: File): void {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const parsed = JSON.parse(reader.result as string);
                if (!parsed || typeof parsed !== 'object' || !parsed.data) {
                    throw new Error('预设文件格式错误：未包含有效的 data 配置项');
                }
                const list = this.fetchPresetsList();
                const existingNames = new Set(list.map((p) => p.name));
                const baseName =
                    parsed.name ||
                    this.options.defaultImportName ||
                    `导入的 ${this.options.provider || this.options.category} 预设`;

                let finalName = baseName;
                if (existingNames.has(baseName)) {
                    const negotiated = await ConfirmDialog.prompt({
                        title: '导入预设名称冲突',
                        message: `已存在同名预设「${baseName}」，请为导入预设指定一个新名称:`,
                        defaultValue: `${baseName} (导入)`,
                        placeholder: '请输入唯一的预设名称',
                        validator: (val) => {
                            if (existingNames.has(val)) {
                                return '预设名称已存在，请换一个名称';
                            }
                            return null;
                        },
                    });
                    if (!negotiated || !negotiated.trim()) return;
                    finalName = negotiated.trim();
                }

                const newId = this.generateUniqueId();
                const importedItem: PresetItem<TData> = {
                    id: newId,
                    name: finalName,
                    data: parsed.data as TData,
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset(
                    this.options.category,
                    importedItem,
                    this.options.provider
                );
                this.applyActivePreset(newId);
                if (this.options.showToast) {
                    Toast.show(`已成功导入预设: ${importedItem.name}`, { level: 'success' });
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                Toast.show(`导入预设解析失败: ${message}`, { level: 'error' });
            }
        };
        reader.onerror = () => {
            Toast.show('读取预设文件失败', { level: 'error' });
        };
        reader.readAsText(file);
    }

    private generateUniqueId(): string {
        const existingIds = new Set(this.fetchPresetsList().map((p) => p.id));
        let candidate = `${this.idPrefix}${Date.now()}`;
        let seq = 1;
        while (existingIds.has(candidate)) {
            candidate = `${this.idPrefix}${Date.now()}_${seq++}`;
        }
        return candidate;
    }
}
