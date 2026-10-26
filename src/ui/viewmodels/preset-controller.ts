/**
 * 通用预设方案状态控制器 (PresetController)。
 *
 * @remarks
 * 封装预设方案的查询、切换、新建、保存、另存为、重命名、导入、导出与删除逻辑。
 * 基于 @preact/signals 维护当前方案快照、未保存草稿、修改字段集与失效字段集。
 */

import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import type { PresetCategory, PresetItem, ProviderType } from '@types';
import type { PresetActionType, PresetToolbarItem } from '../composite/preset-toolbar';
import { settingsStore } from '../../store/settings-store';
import { Toast } from '../feedback/toast';

export interface PresetControllerOptions<TData extends Record<string, any>> {
    /** 预设所属分类 */
    category: PresetCategory;
    /** 若为 drawing 分类，需指定归属的提供商类型 */
    provider?: ProviderType;
    /** 新建或克隆方案时的 ID 前缀，默认 `${provider || category}_preset_` */
    idPrefix?: string;
    /** 新建方案弹窗的提示语，默认 "请输入新方案名称:" */
    promptMessageForNew?: string;
    /** 新建方案弹窗的默认名称，默认 "新建方案" */
    defaultNewName?: string;
    /** 重命名弹窗的提示语，默认 "请输入预设方案新名称:" */
    promptMessageForRename?: string;
    /**
     * 另存为时是否弹窗询问名称。
     * 若提供提示语（如 "请输入新外观方案名称:"），则调用 window.prompt 询问并默认填入 `${sourceName} (副本)`；
     * 若未提供，则直接以 `${sourceName} (副本)` 静默克隆。
     */
    promptMessageForSaveAs?: string;
    /** 导入方案缺省名称，默认 "导入方案" */
    defaultImportName?: string;
    /** 导出文件名前缀 */
    exportFilenamePrefix?: string;
    /** 删除时要求至少保留的方案数量（如主题要求至少保留 1 套，绘图方案允许删空为 0） */
    minRemainingOnDelete?: number;
    /** 删除受阻时的提示消息 */
    minRemainingWarning?: string;
    /** 自定义获取预设列表函数（如从独立服务或动态源提供预设方案列表） */
    getPresetsOverride?: () => PresetItem<TData>[];
    /** 读取当前持久化激活方案 ID 的函数 */
    getActiveId: () => string;
    /** 将激活方案 ID 写回持久化存储的函数 */
    setActiveId: (id: string) => void;
    /** 新建方案前的必填项校验，返回缺失字段名称列表 */
    validateRequired?: (draft: TData) => string[];
    /** 执行新建、保存、另存为操作前的额外前置校验 */
    canPerformAction?: (action: PresetActionType, draft: TData) => { allowed: boolean; message?: string };
    /** 自定义脏字段集计算函数；未提供时默认按字段浅比较 */
    evaluateDirtyFields?: (draft: TData, baseline: TData) => Set<string>;
    /** 自定义失效字段集计算函数（如检查绑定的工作流或提示词 ID 是否存在） */
    evaluateInvalidFields?: (draft: TData) => Set<string>;
    /** 方案切换、重置或保存完成后的回调 */
    onPresetApplied?: (preset: PresetItem<TData> | null, draft: TData) => void;
    /** 草稿字段发生修改时的回调 */
    onDraftChanged?: (draft: TData) => void;
    /** 是否在保存、新建、重命名、删除、重置时弹出 Toast 提示 */
    showToast?: boolean;
}

export class PresetController<TData extends Record<string, any>> {
    private readonly options: PresetControllerOptions<TData>;
    private readonly idPrefix: string;

    /** 当前分类下的预设方案列表 */
    public readonly presets: Signal<PresetItem<TData>[]>;
    /** 当前激活的方案 ID */
    public readonly activePresetId: Signal<string>;
    /** 当前激活的方案完整对象（无方案时为 null） */
    public readonly currentPreset: Signal<PresetItem<TData> | null>;
    /** 激活方案的持久化基准快照 */
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

        // 初始化加载当前激活方案
        const initialId = this.options.getActiveId();
        this.applyActivePreset(initialId, { persist: false, silent: true });
    }

    /**
     * 默认的逐字段浅比对脏状态计算。
     */
    public static defaultEvaluateDirty<T extends Record<string, any>>(
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
     * 查询最新预设方案列表。
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
     * 激活并应用指定的预设方案。
     */
    public applyActivePreset(
        presetId: string,
        options?: { persist?: boolean; silent?: boolean }
    ): void {
        const list = this.fetchPresetsList();
        this.presets.value = list;

        const target = list.find((p) => p.id === presetId) ?? null;

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
            // 目标方案不存在或已失效：保留失效 ID 用于界面显式提示，绝不静默降级为首个方案
            this.currentPreset.value = null;
            this.activePresetId.value = presetId || '';
            this.baselineSnapshot.value = {} as TData;
            this.extraInvalidFields.value = new Set();
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
     * 统一响应 PresetToolbar 的 8 项操作动作。
     */
    public handleAction(action: PresetActionType, targetId?: string): void {
        if (this.options.canPerformAction) {
            const check = this.options.canPerformAction(action, this.draftConfig.value);
            if (!check.allowed) {
                if (check.message) {
                    Toast.show(check.message, { level: 'error' });
                }
                return;
            }
        }

        switch (action) {
            case 'select': {
                if (targetId !== undefined) {
                    this.applyActivePreset(targetId);
                    if (this.options.showToast && this.currentPreset.value) {
                        Toast.show(`已切换方案: ${this.currentPreset.value.name}`, { level: 'info' });
                    }
                }
                break;
            }

            case 'new': {
                if (this.options.validateRequired) {
                    const missing = this.options.validateRequired(this.draftConfig.value);
                    if (missing.length > 0) {
                        Toast.show(
                            `无法创建方案，以下必填项尚未配置：${missing.join('、')}`,
                            { level: 'warning', duration: 3500 }
                        );
                        return;
                    }
                }

                const promptMsg = this.options.promptMessageForNew ?? '请输入新方案名称:';
                const defaultName = this.options.defaultNewName ?? '新建方案';
                const newName =
                    typeof window !== 'undefined' && typeof window.prompt === 'function'
                        ? window.prompt(promptMsg, defaultName)
                        : defaultName;
                if (!newName || !newName.trim()) return;

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
                    Toast.show(`已新建方案: ${newPreset.name}`, { level: 'success' });
                }
                break;
            }

            case 'save': {
                const cur = this.currentPreset.value;
                if (!cur) {
                    // 当无激活方案时自动触发新建方案命名保存流程，防止草稿丢失
                    this.handleAction('new');
                    return;
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
                break;
            }

            case 'saveAs': {
                const cur = this.currentPreset.value;
                if (!cur) return;

                const defaultCloneName = `${cur.name || '预设方案'} (副本)`;
                let targetName = defaultCloneName;

                if (this.options.promptMessageForSaveAs) {
                    const prompted =
                        typeof window !== 'undefined' && typeof window.prompt === 'function'
                            ? window.prompt(this.options.promptMessageForSaveAs, defaultCloneName)
                            : defaultCloneName;
                    if (!prompted || !prompted.trim()) return;
                    targetName = prompted.trim();
                }

                const newId = this.generateUniqueId();
                const cloned: PresetItem<TData> = {
                    id: newId,
                    name: targetName,
                    data: structuredClone(this.draftConfig.value),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset(this.options.category, cloned, this.options.provider);
                this.applyActivePreset(newId);
                if (this.options.showToast) {
                    Toast.show(`已另存方案: ${targetName}`, { level: 'success' });
                }
                break;
            }

            case 'rename': {
                const cur = this.currentPreset.value;
                if (!cur) return;

                const promptMsg = this.options.promptMessageForRename ?? '请输入预设方案新名称:';
                const newName =
                    typeof window !== 'undefined' && typeof window.prompt === 'function'
                        ? window.prompt(promptMsg, cur.name)
                        : cur.name;
                if (!newName || !newName.trim() || newName.trim() === cur.name) return;

                const updated: PresetItem<TData> = {
                    ...cur,
                    name: newName.trim(),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset(this.options.category, updated, this.options.provider);
                this.currentPreset.value = updated;
                this.refreshPresets();
                if (this.options.showToast) {
                    Toast.show('已重命名方案', { level: 'success' });
                }
                break;
            }

            case 'export': {
                const cur = this.currentPreset.value;
                if (!cur) return;

                const prefix =
                    this.options.exportFilenamePrefix ??
                    `${this.options.provider || this.options.category}_preset_`;
                const safeName = (cur.name || cur.id).replace(/\s+/g, '_');
                const blob = new Blob([JSON.stringify(cur, null, 2)], {
                    type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${prefix}${safeName}.json`;
                a.click();
                URL.revokeObjectURL(url);
                break;
            }

            case 'reset': {
                this.draftConfig.value = structuredClone(this.baselineSnapshot.value);
                this.extraInvalidFields.value = new Set();
                this.options.onDraftChanged?.(this.draftConfig.value);
                this.options.onPresetApplied?.(this.currentPreset.value, this.draftConfig.value);
                if (this.options.showToast) {
                    Toast.show('已放弃未保存修改', { level: 'info' });
                }
                break;
            }

            case 'delete': {
                const cur = this.currentPreset.value;
                if (!cur) return;

                const minRemaining = this.options.minRemainingOnDelete ?? 0;
                const currentList = this.fetchPresetsList();
                if (currentList.length <= minRemaining) {
                    Toast.show(
                        this.options.minRemainingWarning ?? '至少保留一套基准方案，无法删除',
                        { level: 'warning' }
                    );
                    return;
                }

                settingsStore.deletePreset(this.options.category, cur.id, this.options.provider);
                const remaining = this.fetchPresetsList();
                if (remaining.length > 0) {
                    this.applyActivePreset(remaining[0].id);
                } else {
                    // 方案池删空：保留当前控件草稿值，置空激活方案 ID
                    this.presets.value = [];
                    this.currentPreset.value = null;
                    this.activePresetId.value = '';
                    this.baselineSnapshot.value = structuredClone(this.draftConfig.value);
                    this.options.setActiveId('');
                }
                if (this.options.showToast) {
                    Toast.show('已删除指定方案', { level: 'info' });
                }
                break;
            }
        }
    }

    /**
     * 解析并导入外部 JSON 预设文件。
     */
    public handleImportFile(file: File): void {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string);
                if (!parsed || typeof parsed !== 'object' || !parsed.data) {
                    throw new Error('预设文件格式错误：未包含有效的 data 配置项');
                }
                const newId = this.generateUniqueId();
                const baseName =
                    parsed.name ||
                    this.options.defaultImportName ||
                    `导入的 ${this.options.provider || this.options.category} 方案`;
                const importedItem: PresetItem<TData> = {
                    id: newId,
                    name: `${baseName} (导入)`,
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
                    Toast.show(`已成功导入方案: ${importedItem.name}`, { level: 'success' });
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                Toast.show(`导入方案解析失败: ${message}`, { level: 'error' });
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
