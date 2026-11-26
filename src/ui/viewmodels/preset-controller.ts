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
import { normalizePresetNameKey, settingsStore } from '../../store/settings-store';
import { logger } from '../../util/logger';
import { Toast } from '../feedback/toast';
import { reportRuntimeError } from '../feedback/error-feedback';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { downloadJsonFile } from '../../util/browser-io';
import {
    buildPresetBundlePayload,
    formatBatchImportSummary,
    parsePresetBatchJson,
    readFileAsText,
    resolveBatchImportToastError,
    resolveBatchUniquePresetName,
} from './preset-batch-io';

const FORBIDDEN_IMPORT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 剥离文件名末尾 `.json` 扩展名作为导入预设的默认名称 */
export function stripJsonExtension(fileName?: string): string {
    return typeof fileName === 'string' ? fileName.replace(/\.json$/i, '').trim() : '';
}

/** 递归剔除 `__proto__` / `constructor` / `prototype` 等危险原型键，防止导入外部 JSON 时引入原型污染属性 */
export function sanitizeImportedObject<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeImportedObject(item)) as unknown as T;
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
        if (FORBIDDEN_IMPORT_KEYS.has(key)) continue;
        result[key] = sanitizeImportedObject((value as Record<string, unknown>)[key]);
    }
    return result as T;
}

/** 按预设分类校验导入 `data` 对象的结构特征，防止跨分类误导入 */
export function validatePresetPayloadForCategory(
    category: PresetCategory,
    data: Record<string, unknown>
): string | null {
    const isPlainObj = (v: unknown): v is Record<string, unknown> =>
        Boolean(v && typeof v === 'object' && !Array.isArray(v));

    if (category === 'themes') {
        if (typeof data.accent !== 'string' || !data.accent.trim()) {
            return '主题预设格式错误：缺少有效的 accent 主强调色字段';
        }
        return null;
    }
    if (category === 'prompts') {
        if (
            'workflow' in data ||
            Array.isArray(data.entries) ||
            'parts' in data ||
            'characterRules' in data ||
            'characterTemplate' in data ||
            'charStartTag' in data ||
            ('accent' in data && 'bgPrimary' in data)
        ) {
            return '导入文件属于其他类别预设，与当前「提示词预设」不兼容';
        }
        if (data.loras !== undefined && !Array.isArray(data.loras)) {
            return '提示词预设格式错误：loras 字段必须为数组';
        }
        return null;
    }
    if (category === 'characters' || category === 'outfits') {
        if (
            'workflow' in data ||
            Array.isArray(data.entries) ||
            'characterRules' in data ||
            'characterTemplate' in data ||
            'charStartTag' in data ||
            ('accent' in data && 'bgPrimary' in data) ||
            (data.parts !== undefined && !isPlainObj(data.parts))
        ) {
            return `导入文件与当前「${category === 'characters' ? '角色' : '服装'}档案」预设格式不兼容`;
        }
        return null;
    }
    if (category === 'material_activations') {
        if (
            (data.characterRules !== undefined && !isPlainObj(data.characterRules)) ||
            (data.outfitRules !== undefined && !isPlainObj(data.outfitRules)) ||
            (!('characterRules' in data) && !('outfitRules' in data))
        ) {
            return '素材启用预设格式错误：缺少有效的 characterRules / outfitRules 规则字典';
        }
        return null;
    }
    if (category === 'material_extractions') {
        if (
            !('charStartTag' in data) &&
            !('outfitStartTag' in data) &&
            !('enabled' in data)
        ) {
            return '解析设置预设格式错误：未包含有效的档案提取规则字段';
        }
        return null;
    }
    if (category === 'material_formats') {
        if (!('characterTemplate' in data) && !('outfitTemplate' in data)) {
            return '变量与宏预设格式错误：缺少有效的渲染模板字段';
        }
        return null;
    }
    if (category === 'drawing') {
        if (
            'workflow' in data ||
            Array.isArray(data.entries) ||
            'parts' in data ||
            'characterRules' in data ||
            'characterTemplate' in data ||
            'charStartTag' in data ||
            ('accent' in data && 'bgPrimary' in data)
        ) {
            return '导入文件属于其他类别预设，与当前「生图参数预设」不兼容';
        }
    }
    return null;
}

/** 统一校验并在同名冲突时通过弹窗协商唯一预设名称 */
export async function resolveUniquePresetName(
    proposedName: string,
    existingNormalizedNames: ReadonlySet<string>,
    fallbackName: string
): Promise<string | null> {
    const cleanBase = proposedName.trim() || fallbackName;
    if (!existingNormalizedNames.has(normalizePresetNameKey(cleanBase))) {
        return cleanBase;
    }
    const negotiated = await ConfirmDialog.prompt({
        title: '导入预设名称冲突',
        message: `已存在同名预设「${cleanBase}」，请为导入预设指定一个新名称:`,
        defaultValue: `${cleanBase} (导入)`,
        placeholder: '请输入唯一的预设名称',
        validator: (val) => {
            const trimmed = val.trim();
            if (!trimmed) {
                return '预设名称不能为空';
            }
            if (existingNormalizedNames.has(normalizePresetNameKey(trimmed))) {
                return '预设名称已存在，请换一个名称';
            }
            return null;
        },
    });
    if (!negotiated || !negotiated.trim()) {
        return null;
    }
    return negotiated.trim();
}

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
    /** 删除时要求至少保留的预设数量（如主题要求至少保留 1 套，生图参数预设允许删空为 0） */
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
    private isDisposed = false;

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
     * 规范化深比较两个值（忽略对象键顺序，将 undefined 属性视作缺失）。
     */
    public static isCanonicalEqual(a: unknown, b: unknown): boolean {
        if (Object.is(a, b)) return true;
        if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
            return false;
        }
        if (Array.isArray(a) || Array.isArray(b)) {
            if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!PresetController.isCanonicalEqual(a[i], b[i])) return false;
            }
            return true;
        }
        const objA = a as Record<string, unknown>;
        const objB = b as Record<string, unknown>;
        const keysA = Object.keys(objA).filter((k) => objA[k] !== undefined);
        const keysB = Object.keys(objB).filter((k) => objB[k] !== undefined);
        if (keysA.length !== keysB.length) return false;
        for (const k of keysA) {
            if (!Object.prototype.hasOwnProperty.call(objB, k)) return false;
            if (!PresetController.isCanonicalEqual(objA[k], objB[k])) return false;
        }
        return true;
    }

    /**
     * 默认的逐字段规范化脏状态计算（键序无关，顶层将 undefined 与空串视作等价）。
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
            if (!PresetController.isCanonicalEqual(curVal, baseVal)) {
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
            if (options?.persist !== false && this.options.getActiveId() !== '') {
                this.options.setActiveId('');
            }
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
     * 统一响应 PresetToolbar 的预设切换与工具栏操作动作。
     */
    public async handleAction(
        action: PresetActionType,
        targetId?: string
    ): Promise<boolean> {
        try {
            return await this.executeAction(action, targetId);
        } catch (err: unknown) {
            reportRuntimeError(
                '[PresetController] 预设操作异常:',
                '预设操作失败，请前往「日志与统计」查看详情',
                err
            );
            return false;
        }
    }

    private isMaterialArchiveCategory(): boolean {
        return this.options.category === 'characters' || this.options.category === 'outfits';
    }

    private syncMaterialInnerName(data: TData, nextName: string): TData {
        if (!this.isMaterialArchiveCategory() || !data || typeof data !== 'object') {
            return data;
        }
        return {
            ...data,
            name: nextName,
        };
    }

    private async executeAction(
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

            case 'new':
            case 'saveAs': {
                if (this.options.validateRequired) {
                    const missing = this.options.validateRequired(this.draftConfig.value);
                    if (missing.length > 0) {
                        Toast.show(`请先填写必填项：${missing.join('、')}`, { level: 'warning' });
                        return false;
                    }
                }
                const cur = this.currentPreset.value;
                const list = this.fetchPresetsList();
                const existingNames = new Set(list.map((p) => normalizePresetNameKey(p.name)));
                const defaultName = cur
                    ? `${cur.name || '预设'} (副本)`
                    : (this.options.defaultNewName ?? '新建预设');
                const promptMsg = cur
                    ? (this.options.promptMessageForSaveAs ?? '请输入新预设名称:')
                    : (this.options.promptMessageForNew ?? '请输入新预设名称:');

                const targetName = await ConfirmDialog.prompt({
                    title: '新建 / 另存为预设',
                    message: promptMsg,
                    defaultValue: defaultName,
                    placeholder: '请输入预设名称',
                    validator: (val) => {
                        const trimmed = val.trim();
                        if (!trimmed) {
                            return '预设名称不能为空';
                        }
                        if (existingNames.has(normalizePresetNameKey(trimmed))) {
                            return '预设名称已存在，请换一个名称';
                        }
                        return null;
                    },
                });
                if (!targetName || !targetName.trim()) return false;

                const cleanTargetName = targetName.trim();
                const newId = this.generateUniqueId();
                const baseData =
                    cur || this.isDirty.value
                        ? structuredClone(this.draftConfig.value)
                        : this.options.defaultTemplate
                          ? this.options.defaultTemplate()
                          : structuredClone(this.draftConfig.value);

                const created: PresetItem<TData> = {
                    id: newId,
                    name: cleanTargetName,
                    data: this.syncMaterialInnerName(baseData, cleanTargetName),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset(this.options.category, created, this.options.provider);
                this.applyActivePreset(newId);
                if (this.options.showToast) {
                    Toast.show(`已创建预设: ${cleanTargetName}`, { level: 'success' });
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
                    const existingNames = new Set(list.map((p) => normalizePresetNameKey(p.name)));
                    const newName = await ConfirmDialog.prompt({
                        title: '保存预设',
                        message: this.options.promptMessageForNew ?? '请输入预设名称:',
                        defaultValue: this.options.defaultNewName ?? '新建预设',
                        placeholder: '请输入预设名称',
                        validator: (val) => {
                            const trimmed = val.trim();
                            if (!trimmed) {
                                return '预设名称不能为空';
                            }
                            if (existingNames.has(normalizePresetNameKey(trimmed))) {
                                return '预设名称已存在，请换一个名称';
                            }
                            return null;
                        },
                    });
                    if (!newName || !newName.trim()) return false;

                    const cleanNewName = newName.trim();
                    const newId = this.generateUniqueId();
                    const newPreset: PresetItem<TData> = {
                        id: newId,
                        name: cleanNewName,
                        data: this.syncMaterialInnerName(
                            structuredClone(this.draftConfig.value),
                            cleanNewName
                        ),
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
                const persisted = this.fetchPresetsList().find((p) => p.id === cur.id) ?? toSave;
                this.currentPreset.value = persisted;
                this.baselineSnapshot.value = structuredClone(this.draftConfig.value);
                this.refreshPresets();
                this.options.onPresetApplied?.(persisted, this.draftConfig.value);
                if (this.options.showToast) {
                    Toast.show('已成功保存修改', { level: 'success' });
                }
                return true;
            }

            case 'rename': {
                const cur = this.currentPreset.value;
                if (!cur) return false;

                const list = this.fetchPresetsList();
                const otherNames = new Set(
                    list.filter((p) => p.id !== cur.id).map((p) => normalizePresetNameKey(p.name))
                );
                const promptMsg = this.options.promptMessageForRename ?? '请输入预设新名称:';

                const newName = await ConfirmDialog.prompt({
                    title: '重命名预设',
                    message: promptMsg,
                    defaultValue: cur.name,
                    placeholder: '请输入预设新名称',
                    validator: (val) => {
                        const trimmed = val.trim();
                        if (!trimmed) {
                            return '预设名称不能为空';
                        }
                        if (trimmed === cur.name) {
                            return '新名称不能与当前名称相同';
                        }
                        if (otherNames.has(normalizePresetNameKey(trimmed))) {
                            return '预设名称已存在，请换一个名称';
                        }
                        return null;
                    },
                });
                if (!newName || !newName.trim() || newName.trim() === cur.name) return false;

                const cleanNewName = newName.trim();
                const updated: PresetItem<TData> = {
                    ...cur,
                    name: cleanNewName,
                    data: this.syncMaterialInnerName(cur.data, cleanNewName),
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset(this.options.category, updated, this.options.provider);
                const persisted = this.fetchPresetsList().find((p) => p.id === cur.id) ?? updated;
                this.currentPreset.value = persisted;
                if (this.isMaterialArchiveCategory()) {
                    this.baselineSnapshot.value = this.syncMaterialInnerName(
                        this.baselineSnapshot.value,
                        cleanNewName
                    );
                    this.draftConfig.value = this.syncMaterialInnerName(
                        this.draftConfig.value,
                        cleanNewName
                    );
                }
                this.refreshPresets();
                if (this.options.showToast) {
                    Toast.show('已重命名预设', { level: 'success' });
                }
                break;
            }

            case 'export': {
                const cur = this.currentPreset.value;
                if (!cur) return false;

                const draft = this.draftConfig.value;
                const exportData =
                    draft && typeof draft === 'object' && !Array.isArray(draft)
                        ? this.syncMaterialInnerName(structuredClone(draft), cur.name)
                        : cur.data;
                const exportPayload: PresetItem<TData> = {
                    ...cur,
                    data: exportData,
                    updatedAt: Date.now(),
                };
                const prefix =
                    this.options.exportFilenamePrefix ??
                    `${this.options.provider || this.options.category}_preset_`;
                const safeName = (cur.name || cur.id).replace(/\s+/g, '_');
                downloadJsonFile(`${prefix}${safeName}.json`, exportPayload);
                break;
            }

            case 'exportAll': {
                const list = this.fetchPresetsList();
                if (list.length === 0) {
                    Toast.show('当前分类下没有可导出的预设', { level: 'warning' });
                    return false;
                }
                const bundle = buildPresetBundlePayload(
                    this.options.category,
                    list,
                    this.options.provider
                );
                const prefix =
                    this.options.exportFilenamePrefix ??
                    `${this.options.provider || this.options.category}_preset_`;
                downloadJsonFile(`${prefix}all_${list.length}.json`, bundle);
                if (this.options.showToast) {
                    Toast.show(`已批量导出 ${list.length} 项预设`, { level: 'success' });
                }
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
                        // 预设池删空：保留当前控件草稿值，置空激活预设 ID 并通知视图同步
                        this.presets.value = [];
                        this.currentPreset.value = null;
                        this.activePresetId.value = '';
                        this.baselineSnapshot.value = structuredClone(this.draftConfig.value);
                        this.options.setActiveId('');
                        this.options.onPresetApplied?.(null, this.draftConfig.value);
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

    /** 标记控制器已释放，阻断在途异步导入回调写回状态 */
    public dispose(): void {
        this.isDisposed = true;
    }

    /**
     * 批量解析并导入一个或多个外部 JSON 预设文件（支持单预设及合集数组格式）。
     */
    public async handleImportFiles(files: File[]): Promise<void> {
        if (this.isDisposed || files.length === 0) return;

        const list = this.fetchPresetsList();
        const existingNames = new Set(list.map((p) => normalizePresetNameKey(p.name)));
        const fallbackName =
            this.options.defaultImportName ||
            `导入的 ${this.options.provider || this.options.category} 预设`;

        const validCandidates: Array<{ name: string; data: Record<string, unknown> }> = [];
        let failedCount = 0;
        let firstError: string | undefined;

        for (const file of files) {
            try {
                const rawText = await readFileAsText(file);
                if (this.isDisposed) return;
                const { candidates, skippedErrors } = parsePresetBatchJson(rawText, file.name);
                if (skippedErrors.length > 0) {
                    failedCount += skippedErrors.length;
                    logger.warn(`[PresetController] 批量导入跳过无效文件 (${file.name}):`, skippedErrors[0]);
                    firstError ??= resolveBatchImportToastError(skippedErrors[0]);
                }
                for (const candidate of candidates) {
                    const validationError = validatePresetPayloadForCategory(
                        this.options.category,
                        candidate.data
                    );
                    if (validationError) {
                        failedCount += 1;
                        logger.warn(
                            `[PresetController] 批量导入预设校验失败 (${file.name} / ${candidate.name}):`,
                            validationError
                        );
                        firstError ??= resolveBatchImportToastError(validationError);
                        continue;
                    }
                    validCandidates.push(candidate);
                }
            } catch (err: unknown) {
                failedCount += 1;
                logger.warn(`[PresetController] 批量导入文件读取/解析失败 (${file.name}):`, err);
                firstError ??= resolveBatchImportToastError(err);
            }
        }

        if (validCandidates.length === 0) {
            Toast.show(formatBatchImportSummary(0, failedCount, firstError), { level: 'error' });
            return;
        }

        if (this.isDirty.value) {
            const confirmed = await ConfirmDialog.confirm({
                title: '导入预设确认',
                message:
                    '当前预设存在未保存的修改，导入并切换新预设将放弃当前未保存修改。是否确定继续导入？',
            });
            if (!confirmed || this.isDisposed) return;
        }

        const isSingleInteractive = validCandidates.length === 1 && files.length === 1;
        let lastImportedId = '';
        let lastImportedName = '';
        let importedCount = 0;

        for (const candidate of validCandidates) {
            let finalName: string | null = null;
            if (isSingleInteractive) {
                finalName = await resolveUniquePresetName(
                    candidate.name,
                    existingNames,
                    fallbackName
                );
                if (!finalName || this.isDisposed) return;
            } else {
                finalName = resolveBatchUniquePresetName(
                    candidate.name,
                    existingNames,
                    fallbackName
                );
            }

            const newId = this.generateUniqueId();
            const importedItem: PresetItem<TData> = {
                id: newId,
                name: finalName,
                data: this.syncMaterialInnerName(candidate.data as TData, finalName),
                updatedAt: Date.now(),
            };
            settingsStore.savePreset(this.options.category, importedItem, this.options.provider);
            lastImportedId = newId;
            lastImportedName = finalName;
            importedCount += 1;
        }

        if (lastImportedId) {
            this.applyActivePreset(lastImportedId);
        }

        if (importedCount === 1 && failedCount === 0) {
            if (this.options.showToast) {
                Toast.show(`已成功导入预设: ${lastImportedName}`, { level: 'success' });
            }
        } else {
            Toast.show(formatBatchImportSummary(importedCount, failedCount, firstError), {
                level: failedCount > 0 ? 'warning' : 'success',
            });
        }
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
