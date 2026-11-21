/**
 * 素材库选项卡视图 (MaterialsTabView)。
 *
 * @remarks
 * 基于顶部分段导航划分为五个子面板：
 * 1. 角色管理：预设工具栏、基本属性卡片（含居中参考图与基础字段）、绘画标签卡片（含头部 Token 统计条与 16 项部位全宽文本域）、服装绑定列表；
 * 2. 服装管理：预设工具栏、基本属性卡片（含居中参考图与基础字段）、绘画标签卡片（含头部 Token 统计条与 10 项服饰部位全宽文本域）；
 * 3. 启用设置：独立启用预设工具栏、酒馆角色卡自动联动开关、角色启用规则列表、通用服装启用规则列表；
 * 4. 解析设置：楼层档案提取配置、起止标记与档案提取测试；
 * 5. 变量与宏管理：单行格式展现模板设计、一体化生图宏规则维护、独立实时渲染效果预览。
 */

import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import type {
    CharacterPresetData,
    OutfitPresetData,
    MaterialLibraryConfig,
    MaterialActivationPresetData,
    MaterialExtractionPresetData,
    MaterialFormatPresetData,
    MaterialMacroRule,
} from '@types';
import { PreactSettingsView, SegmentedControlView } from '../framework';
import type { PresetActionType } from '../composite';
import {
    PresetController,
    resolveUniquePresetName,
    sanitizeImportedObject,
    stripJsonExtension,
    validatePresetPayloadForCategory,
} from '../viewmodels';
import {
    buildPresetBundlePayload,
    formatBatchImportSummary,
    parsePresetBatchJson,
    readFileAsText,
    resolveBatchUniquePresetName,
} from '../viewmodels/preset-batch-io';
import { bindDelegatedTagAutocomplete } from '../composite/tag-autocomplete';
import type { Disposable } from '../types';
import { settingsStore, normalizePresetNameKey } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { downloadJsonFile } from '../../util/browser-io';
import {
    materialImageStorage,
    EMBEDDED_AVATAR_FIELD,
} from '../../store/material-image-storage';
import {
    DEFAULT_MATERIAL_EXTRACTION_CONFIG,
    DEFAULT_MATERIAL_FORMAT_DATA,
    createEmptyCharacterData,
    createEmptyOutfitData,
    normalizeCharacterData,
    normalizeOutfitData,
    validateMacroKey,
    resolveOutfitIdsFromRefs,
} from '../../pipeline/material-definitions';
import { promptInjector } from '../../pipeline/prompt-injector';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { Toast } from '../feedback/toast';

import {
    type MaterialsSubTab,
    CHAR_PART_GROUPS,
    OUTFIT_PART_GROUPS,
    DEFAULT_SANDBOX_SAMPLE,
    createEmptyActivationTemplate,
    evaluatePresetDataDirty,
} from './materials/material-types';
import { CharacterPanel } from './materials/character-panel';
import { OutfitPanel } from './materials/outfit-panel';
import { ActivationPanel } from './materials/activation-panel';
import { ExtractionPanel } from './materials/extraction-panel';
import { FormatPanel } from './materials/format-panel';

export {
    type MaterialsSubTab,
    CHAR_PART_GROUPS,
    OUTFIT_PART_GROUPS,
    DEFAULT_SANDBOX_SAMPLE,
    createEmptyActivationTemplate,
    evaluatePresetDataDirty,
};

export class MaterialsTabView extends PreactSettingsView {
    public readonly id = 'materials';
    public readonly title = '素材库';

    public readonly subTab = signal<MaterialsSubTab>('characters');
    public readonly charController: PresetController<CharacterPresetData>;
    public readonly outfitController: PresetController<OutfitPresetData>;
    public readonly activationController: PresetController<MaterialActivationPresetData>;
    public readonly extractionController: PresetController<MaterialExtractionPresetData>;
    public readonly formatController: PresetController<MaterialFormatPresetData>;
    public readonly materialConfigSignal = signal<MaterialLibraryConfig>(
        settingsStore.get('materialConfig')
    );
    public readonly sandboxText = signal<string>(DEFAULT_SANDBOX_SAMPLE);

    public readonly charGroupExpanded = signal<Record<string, boolean>>({
        head_appearance: true,
        upper_body: false,
        lower_body: false,
    });
    public readonly outfitGroupExpanded = signal<Record<string, boolean>>({
        main_clothing: true,
        inner_footwear_acc: false,
    });
    public readonly expandedMacroRuleIds = signal<Record<string, boolean>>({});
    public readonly activeMacroRuleKind = signal<'character' | 'outfit'>('character');
    public readonly activeTemplateKind = signal<'character' | 'outfit' | 'macro'>('character');
    public readonly isVariablesDrawerOpen = signal<boolean>(false);
    public readonly selectedOutfitToBind = signal<string>('');
    public readonly avatarUrlsSignal = signal<Record<string, string>>({});

    private isDisposedView = false;
    private readonly avatarObjectUrls = new Map<string, string>();
    private readonly pendingAvatarLoads = new Set<string>();
    private unlistenSettings: (() => void) | null = null;
    private autocompleteDelegation: Disposable | null = null;

    public constructor() {
        super('da-tab-pane da-view-materials');

        this.charController = new PresetController<CharacterPresetData>({
            category: 'characters',
            idPrefix: 'char_',
            promptMessageForNew: '请输入新角色名称:',
            defaultNewName: '新角色',
            promptMessageForSaveAs: '请输入角色另存名称:',
            promptMessageForRename: '请输入新的角色名称:',
            defaultImportName: '导入角色',
            exportFilenamePrefix: 'st-draw-character-',
            minRemainingOnDelete: 0,
            showToast: true,
            defaultTemplate: () => createEmptyCharacterData(''),
            getActiveId: () =>
                settingsStore.get('materialConfig')?.activeCharacterPresetId || '',
            setActiveId: (id) => {
                const cur = settingsStore.get('materialConfig');
                settingsStore.set('materialConfig', {
                    ...cur,
                    activeCharacterPresetId: id,
                });
            },
            evaluateDirtyFields: evaluatePresetDataDirty,
            onPresetApplied: () => {
                this.syncVisibleAvatars();
                void promptInjector.scheduleSyncToHost();
            },
        });

        this.outfitController = new PresetController<OutfitPresetData>({
            category: 'outfits',
            idPrefix: 'outfit_',
            promptMessageForNew: '请输入新服装名称:',
            defaultNewName: '新服装',
            promptMessageForSaveAs: '请输入服装另存名称:',
            promptMessageForRename: '请输入新的服装名称:',
            defaultImportName: '导入服装',
            exportFilenamePrefix: 'st-draw-outfit-',
            minRemainingOnDelete: 0,
            showToast: true,
            defaultTemplate: () => createEmptyOutfitData(''),
            getActiveId: () =>
                settingsStore.get('materialConfig')?.activeOutfitPresetId || '',
            setActiveId: (id) => {
                const cur = settingsStore.get('materialConfig');
                settingsStore.set('materialConfig', {
                    ...cur,
                    activeOutfitPresetId: id,
                });
            },
            evaluateDirtyFields: evaluatePresetDataDirty,
            onPresetApplied: () => {
                this.syncVisibleAvatars();
                void promptInjector.scheduleSyncToHost();
            },
        });

        this.activationController = new PresetController<MaterialActivationPresetData>({
            category: 'material_activations',
            idPrefix: 'mat_act_',
            promptMessageForNew: '请输入新启用预设名称:',
            defaultNewName: '新素材启用预设',
            promptMessageForSaveAs: '请输入启用预设另存名称:',
            promptMessageForRename: '请输入新启用预设名称:',
            defaultImportName: '导入素材启用预设',
            exportFilenamePrefix: 'st-draw-material-activation-',
            minRemainingOnDelete: 1,
            showToast: true,
            defaultTemplate: createEmptyActivationTemplate,
            getActiveId: () =>
                settingsStore.get('materialConfig')?.activeActivationPresetId || '',
            setActiveId: (id) => {
                const cur = settingsStore.get('materialConfig');
                const next: MaterialLibraryConfig = {
                    ...cur,
                    activeActivationPresetId: id,
                };
                settingsStore.set('materialConfig', next);
                this.materialConfigSignal.value = next;
            },
            evaluateDirtyFields: evaluatePresetDataDirty,
            onPresetApplied: () => {
                this.materialConfigSignal.value = { ...settingsStore.get('materialConfig') };
                void promptInjector.scheduleSyncToHost();
            },
        });

        this.extractionController = new PresetController<MaterialExtractionPresetData>({
            category: 'material_extractions',
            idPrefix: 'ext_',
            promptMessageForNew: '请输入新解析预设名称:',
            defaultNewName: '新解析预设',
            promptMessageForSaveAs: '请输入解析预设另存名称:',
            promptMessageForRename: '请输入新的解析预设名称:',
            defaultImportName: '导入解析预设',
            exportFilenamePrefix: 'st-draw-extraction-',
            minRemainingOnDelete: 1,
            showToast: true,
            defaultTemplate: () => structuredClone(DEFAULT_MATERIAL_EXTRACTION_CONFIG),
            getActiveId: () =>
                settingsStore.get('materialConfig')?.activeExtractionPresetId ||
                'material_extraction_default',
            setActiveId: (id) => {
                const cur = settingsStore.get('materialConfig');
                const next: MaterialLibraryConfig = {
                    ...cur,
                    activeExtractionPresetId: id,
                };
                settingsStore.set('materialConfig', next);
                this.materialConfigSignal.value = next;
            },
            evaluateDirtyFields: evaluatePresetDataDirty,
            onPresetApplied: () => {
                const cur = settingsStore.get('materialConfig');
                const active = this.extractionController.currentPreset.value;
                if (active && cur.activeExtractionPresetId !== active.id) {
                    const next: MaterialLibraryConfig = {
                        ...cur,
                        activeExtractionPresetId: active.id,
                    };
                    settingsStore.set('materialConfig', next);
                    this.materialConfigSignal.value = next;
                }
            },
        });

        this.formatController = new PresetController<MaterialFormatPresetData>({
            category: 'material_formats',
            idPrefix: 'fmt_',
            promptMessageForNew: '请输入新变量与宏预设名称:',
            defaultNewName: '新变量与宏预设',
            promptMessageForSaveAs: '请输入变量与宏预设另存名称:',
            promptMessageForRename: '请输入新变量与宏预设名称:',
            defaultImportName: '导入变量与宏预设',
            exportFilenamePrefix: 'st-draw-format-macro-',
            minRemainingOnDelete: 1,
            showToast: true,
            defaultTemplate: () => ({
                characterTemplate: DEFAULT_MATERIAL_FORMAT_DATA.characterTemplate,
                outfitTemplate: DEFAULT_MATERIAL_FORMAT_DATA.outfitTemplate,
                macroTemplate: DEFAULT_MATERIAL_FORMAT_DATA.macroTemplate,
                characterMacros: [],
                outfitMacros: [],
            }),
            getActiveId: () =>
                settingsStore.get('materialConfig')?.activeFormatPresetId ||
                'material_format_default',
            setActiveId: (id) => {
                const cur = settingsStore.get('materialConfig');
                const next: MaterialLibraryConfig = {
                    ...cur,
                    activeFormatPresetId: id,
                };
                settingsStore.set('materialConfig', next);
                this.materialConfigSignal.value = next;
                void promptInjector.scheduleSyncToHost();
            },
            canPerformAction: (action, draft) => {
                if (action === 'save' || action === 'saveAs') {
                    const allRules = [
                        ...(draft.characterMacros || []),
                        ...(draft.outfitMacros || []),
                    ];
                    const emptyRule = allRules.find((r) => !r.name || !r.name.trim());
                    if (emptyRule) {
                        return {
                            allowed: false,
                            message: '存在未输入调用名的宏指令，无法保存预设。请填写调用名或删除该条目',
                        };
                    }
                    for (const r of (draft.characterMacros || [])) {
                        const val = validateMacroKey(r.name, r.id, draft.characterMacros || [], true);
                        if (!val.valid) {
                            return {
                                allowed: false,
                                message: `角色宏「${r.name || '空'}」校验失败: ${val.error || '非法命名'}`,
                            };
                        }
                    }
                    for (const r of (draft.outfitMacros || [])) {
                        const val = validateMacroKey(r.name, r.id, draft.outfitMacros || [], false);
                        if (!val.valid) {
                            return {
                                allowed: false,
                                message: `服装宏「${r.name || '空'}」校验失败: ${val.error || '非法命名'}`,
                            };
                        }
                    }
                }
                return { allowed: true };
            },
            evaluateDirtyFields: evaluatePresetDataDirty,
            onPresetApplied: () => {
                const cur = settingsStore.get('materialConfig');
                const active = this.formatController.currentPreset.value;
                if (active && cur.activeFormatPresetId !== active.id) {
                    const next: MaterialLibraryConfig = {
                        ...cur,
                        activeFormatPresetId: active.id,
                    };
                    settingsStore.set('materialConfig', next);
                    this.materialConfigSignal.value = next;
                }
                void promptInjector.scheduleSyncToHost();
            },
        });

        this.unlistenSettings = eventBus.on('settings:updated', (data) => {
            if (
                !data.key ||
                data.isReset ||
                data.key === 'materialConfig' ||
                data.keys?.includes('materialConfig')
            ) {
                this.materialConfigSignal.value = settingsStore.get('materialConfig');
            }
            if (!data.key || data.isReset || data.keys?.includes('presets')) {
                for (const ctrl of [
                    this.charController,
                    this.outfitController,
                    this.activationController,
                    this.extractionController,
                    this.formatController,
                ]) {
                    if (!ctrl.isDirty.value) {
                        ctrl.reloadFromStore();
                    }
                }
                this.syncVisibleAvatars();
            } else if (data.key) {
                const ctrlMap: Record<string, typeof this.charController | typeof this.outfitController | typeof this.activationController | typeof this.extractionController | typeof this.formatController> = {
                    'presets.characters': this.charController,
                    'presets.outfits': this.outfitController,
                    'presets.material_activations': this.activationController,
                    'presets.material_extractions': this.extractionController,
                    'presets.material_formats': this.formatController,
                };
                const targetCtrl = ctrlMap[data.key];
                if (targetCtrl) {
                    if (!targetCtrl.isDirty.value) {
                        targetCtrl.reloadFromStore();
                    } else {
                        targetCtrl.refreshPresets();
                    }
                    if (data.key === 'presets.characters' || data.key === 'presets.outfits') {
                        this.syncVisibleAvatars();
                    }
                }
            }
        });

        this.autocompleteDelegation = bindDelegatedTagAutocomplete(
            this.element,
            '.da-material-tag-textarea, .da-material-tag-input',
            { mode: 'lexicon-only' }
        );

        this.syncVisibleAvatars();
        this.mountPreact();
    }

    public override activate(): void {
        if (!this.charController.isDirty.value) {
            this.charController.reloadFromStore();
        }
        if (!this.outfitController.isDirty.value) {
            this.outfitController.reloadFromStore();
        }
        if (!this.activationController.isDirty.value) {
            this.activationController.reloadFromStore();
        }
        if (!this.extractionController.isDirty.value) {
            this.extractionController.reloadFromStore();
        }
        if (!this.formatController.isDirty.value) {
            this.formatController.reloadFromStore();
        }
        this.materialConfigSignal.value = settingsStore.get('materialConfig');
        this.syncVisibleAvatars();
        super.activate();
    }

    public hasUnsavedChanges(): boolean {
        return (
            this.charController.isDirty.value ||
            this.outfitController.isDirty.value ||
            this.activationController.isDirty.value ||
            this.extractionController.isDirty.value ||
            this.formatController.isDirty.value
        );
    }

    public async saveUnsavedChanges(): Promise<boolean> {
        const controllers = [
            this.charController,
            this.outfitController,
            this.activationController,
            this.extractionController,
            this.formatController,
        ];
        for (const ctrl of controllers) {
            if (ctrl.isDirty.value) {
                let ok = true;
                if (ctrl === this.charController) {
                    ok = await this.handleMaterialToolbarAction('character', 'save');
                } else if (ctrl === this.outfitController) {
                    ok = await this.handleMaterialToolbarAction('outfit', 'save');
                } else {
                    ok = await ctrl.handleAction('save');
                }
                if (!ok) return false;
            }
        }
        this.materialConfigSignal.value = { ...settingsStore.get('materialConfig') };
        void promptInjector.scheduleSyncToHost();
        return true;
    }

    public discardUnsavedChanges(): void {
        const unsavedCharAvatar = this.charController.draftConfig.value?.avatarId || '';
        const baseCharAvatar = this.charController.baselineSnapshot.value?.avatarId || '';
        this.charController.discardDraft();
        if (unsavedCharAvatar && unsavedCharAvatar !== baseCharAvatar) {
            this.releaseAvatarIfUnused(unsavedCharAvatar);
        }

        const unsavedOutfitAvatar = this.outfitController.draftConfig.value?.avatarId || '';
        const baseOutfitAvatar = this.outfitController.baselineSnapshot.value?.avatarId || '';
        this.outfitController.discardDraft();
        if (unsavedOutfitAvatar && unsavedOutfitAvatar !== baseOutfitAvatar) {
            this.releaseAvatarIfUnused(unsavedOutfitAvatar);
        }

        this.activationController.discardDraft();
        this.extractionController.discardDraft();
        this.formatController.discardDraft();
    }

    public override dispose(): void {
        this.isDisposedView = true;
        this.charController.dispose();
        this.outfitController.dispose();
        this.activationController.dispose();
        this.extractionController.dispose();
        this.formatController.dispose();
        if (this.autocompleteDelegation) {
            this.autocompleteDelegation.dispose();
            this.autocompleteDelegation = null;
        }
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
        for (const url of this.avatarObjectUrls.values()) {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // 忽略解绑异常
            }
        }
        this.avatarObjectUrls.clear();
        this.pendingAvatarLoads.clear();
        this.avatarUrlsSignal.value = {};
        super.dispose();
    }

    /**
     * 按需加载当前角色与服装列表中的本地参考图并生成 Object URL。
     */
    private syncVisibleAvatars(): void {
        if (this.isDisposedView) return;
        const ids = new Set<string>();
        const charDraftAvatar = this.charController.draftConfig.value?.avatarId;
        const outfitDraftAvatar = this.outfitController.draftConfig.value?.avatarId;
        if (charDraftAvatar) ids.add(charDraftAvatar);
        if (outfitDraftAvatar) ids.add(outfitDraftAvatar);

        for (const c of this.charController.presets.value) {
            if (c.data?.avatarId) ids.add(c.data.avatarId);
        }
        for (const o of this.outfitController.presets.value) {
            if (o.data?.avatarId) ids.add(o.data.avatarId);
        }

        for (const id of ids) {
            this.ensureAvatarLoaded(id);
        }
    }

    private hasAvatarReference(cleanId: string): boolean {
        const inCharPresets = settingsStore
            .getPresets<CharacterPresetData>('characters')
            .some((p) => p.data?.avatarId === cleanId);
        const inOutfitPresets = settingsStore
            .getPresets<OutfitPresetData>('outfits')
            .some((p) => p.data?.avatarId === cleanId);
        const inDrafts =
            this.charController.draftConfig.value?.avatarId === cleanId ||
            this.outfitController.draftConfig.value?.avatarId === cleanId;
        return inCharPresets || inOutfitPresets || inDrafts;
    }

    public ensureAvatarLoaded(avatarId: string): void {
        const cleanId = (avatarId || '').trim();
        if (
            !cleanId ||
            this.isDisposedView ||
            this.avatarObjectUrls.has(cleanId) ||
            this.pendingAvatarLoads.has(cleanId)
        ) {
            return;
        }
        this.pendingAvatarLoads.add(cleanId);
        void materialImageStorage
            .getAvatarBlob(cleanId)
            .then((blob) => {
                if (
                    this.isDisposedView ||
                    !blob ||
                    !this.hasAvatarReference(cleanId) ||
                    typeof URL === 'undefined' ||
                    typeof URL.createObjectURL !== 'function'
                ) {
                    return;
                }
                if (this.avatarObjectUrls.has(cleanId)) {
                    return;
                }
                const objUrl = URL.createObjectURL(blob);
                this.avatarObjectUrls.set(cleanId, objUrl);
                this.avatarUrlsSignal.value = {
                    ...this.avatarUrlsSignal.value,
                    [cleanId]: objUrl,
                };
            })
            .catch(() => undefined)
            .finally(() => {
                this.pendingAvatarLoads.delete(cleanId);
            });
    }

    /**
     * 若指定 avatarId 未被任何已保存预设或当前草稿引用，则释放 Object URL 并从 IndexedDB 清理。
     */
    private releaseAvatarIfUnused(avatarId: string): void {
        const cleanId = (avatarId || '').trim();
        if (!cleanId) return;

        if (this.hasAvatarReference(cleanId)) {
            return;
        }

        const existingUrl = this.avatarObjectUrls.get(cleanId);
        if (existingUrl) {
            try {
                URL.revokeObjectURL(existingUrl);
            } catch {
                // 忽略异常
            }
            this.avatarObjectUrls.delete(cleanId);
            const nextMap = { ...this.avatarUrlsSignal.value };
            delete nextMap[cleanId];
            this.avatarUrlsSignal.value = nextMap;
        }
        void materialImageStorage.deleteAvatar(cleanId);
    }

    /**
     * 为当前正在编辑的角色或服装草稿上传并绑定参考图。
     */
    public async uploadAvatar(kind: 'character' | 'outfit', file: File): Promise<string> {
        const ctrl = kind === 'character' ? this.charController : this.outfitController;
        const previousDraftAvatar = ctrl.draftConfig.value?.avatarId || '';
        const baselineAvatar = ctrl.baselineSnapshot.value?.avatarId || '';

        const newAvatarId = await materialImageStorage.saveAvatar(file);
        ctrl.updateDraft('avatarId', newAvatarId);
        this.ensureAvatarLoaded(newAvatarId);

        if (previousDraftAvatar && previousDraftAvatar !== baselineAvatar) {
            this.releaseAvatarIfUnused(previousDraftAvatar);
        }
        return newAvatarId;
    }

    /**
     * 移除当前正在编辑草稿中的参考图。
     */
    public removeDraftAvatar(kind: 'character' | 'outfit'): void {
        const ctrl = kind === 'character' ? this.charController : this.outfitController;
        const previousDraftAvatar = ctrl.draftConfig.value?.avatarId || '';
        const baselineAvatar = ctrl.baselineSnapshot.value?.avatarId || '';

        ctrl.updateDraft('avatarId', '');
        if (previousDraftAvatar && previousDraftAvatar !== baselineAvatar) {
            this.releaseAvatarIfUnused(previousDraftAvatar);
        }
    }

    private generateUniqueMaterialId(kind: 'character' | 'outfit'): string {
        const category = kind === 'character' ? 'characters' : 'outfits';
        const prefix = kind === 'character' ? 'char_' : 'outfit_';
        const existingIds = new Set(settingsStore.getPresets(category).map((p) => p.id));
        const stamp = Date.now().toString(36);
        let candidate = `${prefix}${stamp}`;
        let seq = 1;
        while (existingIds.has(candidate)) {
            candidate = `${prefix}${stamp}_${seq++}`;
        }
        return candidate;
    }

    /**
     * 当角色/服装增删时同步启用控制器快照：未编辑时整表重载，正在编辑草稿时仅做增量 ID 增删以保留未保存修改。
     */
    private syncActivationRuleSnapshot(
        kind: 'character' | 'outfit',
        materialId: string,
        mode: 'add' | 'remove'
    ): void {
        if (!materialId || !this.activationController) return;
        if (!this.activationController.isDirty.value) {
            this.activationController.reloadFromStore();
            return;
        }
        const ruleGroup = kind === 'character' ? 'characterRules' : 'outfitRules';
        const patchRulesMap = (
            snap: MaterialActivationPresetData
        ): MaterialActivationPresetData => {
            const nextMap = { ...(snap[ruleGroup] || {}) };
            if (mode === 'add') {
                if (!nextMap[materialId]) {
                    nextMap[materialId] = { enabled: true, triggerMode: 'keyword' };
                }
            } else {
                delete nextMap[materialId];
            }
            return { ...snap, [ruleGroup]: nextMap };
        };
        this.activationController.baselineSnapshot.value = patchRulesMap(
            this.activationController.baselineSnapshot.value
        );
        this.activationController.draftConfig.value = patchRulesMap(
            this.activationController.draftConfig.value
        );
    }

    /**
     * 处理角色/服装/启用预设工具栏动作（保持预设名与 data.name 一致，并支持连图导出与孤立图片回收）。
     */
    public async handleMaterialToolbarAction(
        kind: 'character' | 'outfit' | 'activation',
        action: PresetActionType,
        targetId?: string,
        onExportPayload?: (payload: Record<string, unknown>, filename: string) => void
    ): Promise<boolean> {
        if (kind === 'activation') {
            const ok = await this.activationController.handleAction(action, targetId);
            this.materialConfigSignal.value = { ...settingsStore.get('materialConfig') };
            void promptInjector.scheduleSyncToHost();
            return ok;
        }

        const ctrl = kind === 'character' ? this.charController : this.outfitController;

        if (action === 'export') {
            const cur = ctrl.currentPreset.value;
            if (!cur) return false;
            const exportItem = structuredClone(cur) as unknown as Record<string, unknown>;
            const exportData = structuredClone(ctrl.draftConfig.value) as unknown as Record<
                string,
                unknown
            >;
            const avatarId = typeof exportData.avatarId === 'string' ? exportData.avatarId : '';
            if (avatarId) {
                const dataUrl = await materialImageStorage.exportAvatarAsDataUrl(avatarId);
                if (dataUrl) {
                    exportData[EMBEDDED_AVATAR_FIELD] = dataUrl;
                }
            }
            exportItem.data = exportData;
            const prefix =
                kind === 'character' ? 'st-draw-character-' : 'st-draw-outfit-';
            const safeName = (cur.name || cur.id).replace(/\s+/g, '_');
            const filename = `${prefix}${safeName}.json`;

            onExportPayload?.(exportItem, filename);

            downloadJsonFile(filename, exportItem);
            return true;
        }

        if (action === 'exportAll') {
            const list = ctrl.fetchPresetsList();
            if (list.length === 0) {
                Toast.show(`当前没有可导出的${kind === 'character' ? '角色' : '服装'}预设`, {
                    level: 'warning',
                });
                return false;
            }
            const exportedPresets = await Promise.all(
                list.map(async (item) => {
                    const data = structuredClone(item.data) as unknown as Record<string, unknown>;
                    const avatarId = typeof data.avatarId === 'string' ? data.avatarId : '';
                    if (avatarId) {
                        const dataUrl = await materialImageStorage.exportAvatarAsDataUrl(avatarId);
                        if (dataUrl) {
                            data[EMBEDDED_AVATAR_FIELD] = dataUrl;
                        }
                    }
                    return {
                        ...item,
                        data,
                    };
                })
            );
            const category = kind === 'character' ? 'characters' : 'outfits';
            const bundle = buildPresetBundlePayload(category, exportedPresets);
            const prefix = kind === 'character' ? 'st-draw-character-' : 'st-draw-outfit-';
            downloadJsonFile(`${prefix}all_${list.length}.json`, bundle);
            Toast.show(`已批量导出 ${list.length} 项预设`, { level: 'success' });
            return true;
        }

        if (action === 'saveAs') {
            const cur = ctrl.currentPreset.value;
            const list = ctrl.fetchPresetsList();
            const existingNames = new Set(list.map((p) => normalizePresetNameKey(p.name)));
            const targetName = await ConfirmDialog.prompt({
                title: '新建 / 另存为预设',
                message:
                    kind === 'character'
                        ? '请输入角色名称:'
                        : '请输入服装名称:',
                defaultValue: cur
                    ? `${cur.name || '档案'} (副本)`
                    : kind === 'character'
                      ? '新角色档案'
                      : '新服装档案',
                placeholder: '请输入唯一的预设名称',
                validator: (val) =>
                    existingNames.has(normalizePresetNameKey(val))
                        ? '预设名称已存在，请换一个名称'
                        : null,
            });
            if (!targetName || !targetName.trim()) return false;

            const cleanName = targetName.trim();
            const clonedData = structuredClone(ctrl.draftConfig.value);
            clonedData.name = cleanName;

            if (clonedData.avatarId) {
                const blob = await materialImageStorage.getAvatarBlob(clonedData.avatarId);
                if (blob) {
                    clonedData.avatarId = await materialImageStorage.saveAvatar(blob);
                } else {
                    clonedData.avatarId = '';
                }
            }

            try {
                const newId = this.generateUniqueMaterialId(kind);
                if (kind === 'character') {
                    const charData = clonedData as CharacterPresetData;
                    settingsStore.savePreset('characters', {
                        id: newId,
                        name: cleanName,
                        description: charData.description,
                        data: charData,
                        updatedAt: Date.now(),
                    });
                } else {
                    const outfitData = clonedData as OutfitPresetData;
                    settingsStore.savePreset('outfits', {
                        id: newId,
                        name: cleanName,
                        description: outfitData.description,
                        data: outfitData,
                        updatedAt: Date.now(),
                    });
                }
                ctrl.applyActivePreset(newId);
                this.syncActivationRuleSnapshot(kind, newId, 'add');
                Toast.show(`已另存预设: ${cleanName}`, { level: 'success' });
                return true;
            } catch (err: unknown) {
                Toast.show(err instanceof Error ? err.message : '另存预设失败', { level: 'error' });
                return false;
            }
        }

        if (action === 'save') {
            const oldBaselineAvatar = ctrl.baselineSnapshot.value?.avatarId || '';
            const prevCurrentPreset = ctrl.currentPreset.value;
            const trimmedDraftName = (ctrl.draftConfig.value?.name || '').trim();
            if (!trimmedDraftName) {
                Toast.show(
                    kind === 'character' ? '角色名称不能为空' : '服装名称不能为空',
                    { level: 'warning' }
                );
                return false;
            }
            const activeId = targetId || ctrl.activePresetId.value;
            const duplicate = ctrl
                .fetchPresetsList()
                .some(
                    (p) =>
                        p.id !== activeId &&
                        normalizePresetNameKey(p.name) === normalizePresetNameKey(trimmedDraftName)
                );
            if (duplicate) {
                Toast.show('预设名称已存在，请修改名称后再保存', { level: 'warning' });
                return false;
            }
            if (prevCurrentPreset) {
                ctrl.currentPreset.value = {
                    ...prevCurrentPreset,
                    name: trimmedDraftName,
                };
            }
            const ok = await ctrl.handleAction('save', targetId);
            if (!ok) {
                ctrl.currentPreset.value = prevCurrentPreset;
                return false;
            }
            const currentAvatar = ctrl.baselineSnapshot.value?.avatarId || '';
            if (oldBaselineAvatar && oldBaselineAvatar !== currentAvatar) {
                this.releaseAvatarIfUnused(oldBaselineAvatar);
            }
            return true;
        }

        if (action === 'new') {
            const unsavedAvatar = ctrl.draftConfig.value?.avatarId || '';
            const baseAvatar = ctrl.baselineSnapshot.value?.avatarId || '';
            const ok = await ctrl.handleAction('new', targetId);
            if (!ok) return false;
            if (unsavedAvatar && unsavedAvatar !== baseAvatar) {
                this.releaseAvatarIfUnused(unsavedAvatar);
            }
            ctrl.reloadFromStore();
            const created = ctrl.currentPreset.value;
            if (created) {
                this.syncActivationRuleSnapshot(kind, created.id, 'add');
            }
            return true;
        }

        if (action === 'rename') {
            const wasDirty = ctrl.isDirty.value;
            const ok = await ctrl.handleAction('rename', targetId);
            if (!ok) return false;
            const renamed = ctrl.currentPreset.value;
            if (renamed) {
                if (wasDirty) {
                    ctrl.baselineSnapshot.value = {
                        ...ctrl.baselineSnapshot.value,
                        name: renamed.name,
                    };
                    ctrl.draftConfig.value = {
                        ...ctrl.draftConfig.value,
                        name: renamed.name,
                    };
                } else {
                    ctrl.reloadFromStore();
                }
            }
            return true;
        }

        if (action === 'select') {
            const unsavedAvatar = ctrl.draftConfig.value?.avatarId || '';
            const baseAvatar = ctrl.baselineSnapshot.value?.avatarId || '';
            const ok = await ctrl.handleAction('select', targetId);
            if (!ok) return false;
            if (unsavedAvatar && unsavedAvatar !== baseAvatar) {
                this.releaseAvatarIfUnused(unsavedAvatar);
            }
            this.syncVisibleAvatars();
            return true;
        }

        if (action === 'reset') {
            const unsavedAvatar = ctrl.draftConfig.value?.avatarId || '';
            const baseAvatar = ctrl.baselineSnapshot.value?.avatarId || '';
            const ok = await ctrl.handleAction('reset', targetId);
            if (!ok) return false;
            if (unsavedAvatar && unsavedAvatar !== baseAvatar) {
                this.releaseAvatarIfUnused(unsavedAvatar);
            }
            return true;
        }

        if (action === 'delete') {
            const cur = ctrl.currentPreset.value;
            const targetPreset = targetId
                ? ctrl.fetchPresetsList().find((p) => p.id === targetId) ?? cur
                : cur;
            const deletedId = targetPreset?.id || '';
            const deletedAvatar = targetPreset?.data?.avatarId || '';
            const ok = await ctrl.handleAction('delete', targetId);
            if (!ok) return false;
            if (deletedAvatar) {
                this.releaseAvatarIfUnused(deletedAvatar);
            }
            if (deletedId) {
                this.syncActivationRuleSnapshot(kind, deletedId, 'remove');
            }
            void promptInjector.scheduleSyncToHost();
            return true;
        }

        return await ctrl.handleAction(action, targetId);
    }

    /**
     * 导入单个角色或服装 JSON 文本（自动解包内嵌参考图至 IndexedDB 并剥离出配置对象）。
     */
    public async importMaterialJson(
        kind: 'character' | 'outfit',
        rawJsonText: string,
        fallbackFileName?: string
    ): Promise<void> {
        if (this.isDisposedView) return;
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(rawJsonText) as Record<string, unknown>;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`文件内容非有效 JSON 格式: ${message}`);
        }
        if (
            !parsed ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed) ||
            !parsed.data ||
            typeof parsed.data !== 'object' ||
            Array.isArray(parsed.data)
        ) {
            throw new Error('预设文件格式错误：缺少有效的 data 对象');
        }

        const rawData = sanitizeImportedObject(parsed.data as Record<string, unknown>);
        const validationError = validatePresetPayloadForCategory(
            kind === 'character' ? 'characters' : 'outfits',
            rawData
        );
        if (validationError) {
            throw new Error(validationError);
        }

        const embeddedDataUrl =
            typeof rawData[EMBEDDED_AVATAR_FIELD] === 'string'
                ? (rawData[EMBEDDED_AVATAR_FIELD] as string)
                : '';

        const ctrl = kind === 'character' ? this.charController : this.outfitController;
        if (ctrl.isDirty.value) {
            const confirmed = await ConfirmDialog.confirm({
                title: '导入预设确认',
                message:
                    '当前档案存在未保存的修改，导入并切换新档案将放弃当前未保存修改。是否确定继续导入？',
            });
            if (!confirmed || this.isDisposedView) return;
        }

        const list = ctrl.fetchPresetsList();
        const existingNames = new Set(list.map((p) => normalizePresetNameKey(p.name)));
        const cleanFileBase = stripJsonExtension(fallbackFileName);
        const fallbackName = kind === 'character' ? '导入角色' : '导入服装';
        const baseName =
            (typeof parsed.name === 'string' && parsed.name.trim()) ||
            (typeof rawData.name === 'string' && rawData.name.trim()) ||
            cleanFileBase ||
            fallbackName;

        const finalName = await resolveUniquePresetName(
            baseName,
            existingNames,
            fallbackName
        );
        if (!finalName || this.isDisposedView) return;

        let resolvedAvatarId = '';
        if (embeddedDataUrl.startsWith('data:image/')) {
            resolvedAvatarId =
                (await materialImageStorage.importAvatarFromDataUrl(embeddedDataUrl)) ?? '';
            if (this.isDisposedView) {
                if (resolvedAvatarId) {
                    void materialImageStorage.deleteAvatar(resolvedAvatarId);
                }
                return;
            }
        }

        const unsavedDraftAvatar = ctrl.draftConfig.value?.avatarId || '';
        const baseDraftAvatar = ctrl.baselineSnapshot.value?.avatarId || '';
        const newId = this.generateUniqueMaterialId(kind);
        try {
            if (kind === 'character') {
                const baseCharData = normalizeCharacterData({
                    ...rawData,
                    name: finalName,
                    avatarId: resolvedAvatarId,
                });
                const existingOutfits = settingsStore.getPresets<OutfitPresetData>('outfits');
                const charData: CharacterPresetData = {
                    ...baseCharData,
                    boundOutfitIds: resolveOutfitIdsFromRefs(
                        baseCharData.boundOutfitIds,
                        existingOutfits
                    ),
                };
                settingsStore.savePreset('characters', {
                    id: newId,
                    name: finalName,
                    description: charData.description,
                    data: charData,
                    updatedAt: Date.now(),
                });
                this.charController.applyActivePreset(newId);
            } else {
                const outfitData = normalizeOutfitData({
                    ...rawData,
                    name: finalName,
                    avatarId: resolvedAvatarId,
                });
                settingsStore.savePreset('outfits', {
                    id: newId,
                    name: finalName,
                    description: outfitData.description,
                    data: outfitData,
                    updatedAt: Date.now(),
                });
                this.outfitController.applyActivePreset(newId);
            }
        } catch (err: unknown) {
            if (resolvedAvatarId) {
                void materialImageStorage.deleteAvatar(resolvedAvatarId);
            }
            Toast.show(err instanceof Error ? err.message : '导入预设保存失败', {
                level: 'error',
            });
            return;
        }

        if (unsavedDraftAvatar && unsavedDraftAvatar !== baseDraftAvatar) {
            this.releaseAvatarIfUnused(unsavedDraftAvatar);
        }
        if (resolvedAvatarId) {
            this.ensureAvatarLoaded(resolvedAvatarId);
        }
        this.syncActivationRuleSnapshot(kind, newId, 'add');
        void promptInjector.scheduleSyncToHost();
        Toast.show(`已成功导入预设: ${finalName}`, { level: 'success' });
    }

    private async handleMaterialImportFiles(
        kind: 'character' | 'outfit' | 'activation',
        files: File[]
    ): Promise<void> {
        if (this.isDisposedView || files.length === 0) return;

        if (kind === 'activation') {
            await this.activationController.handleImportFiles(files);
            this.materialConfigSignal.value = { ...settingsStore.get('materialConfig') };
            void promptInjector.scheduleSyncToHost();
            return;
        }

        if (files.length === 1) {
            try {
                const rawText = await readFileAsText(files[0]);
                if (this.isDisposedView) return;
                const parsed: unknown = JSON.parse(rawText);
                const isBundle =
                    Array.isArray(parsed) ||
                    (Boolean(parsed) &&
                        typeof parsed === 'object' &&
                        Array.isArray((parsed as Record<string, unknown>).presets));
                if (!isBundle) {
                    await this.importMaterialJson(kind, rawText, files[0].name);
                    return;
                }
            } catch (err: unknown) {
                if (this.isDisposedView) return;
                const message = err instanceof Error ? err.message : String(err);
                Toast.show(`导入解析失败: ${message}`, { level: 'error' });
                return;
            }
        }

        const ctrl = kind === 'character' ? this.charController : this.outfitController;
        if (ctrl.isDirty.value) {
            const confirmed = await ConfirmDialog.confirm({
                title: '导入预设确认',
                message:
                    '当前档案存在未保存的修改，导入并切换新档案将放弃当前未保存修改。是否确定继续导入？',
            });
            if (!confirmed || this.isDisposedView) return;
        }

        const existingNames = new Set(
            ctrl.fetchPresetsList().map((p) => normalizePresetNameKey(p.name))
        );
        const fallbackName = kind === 'character' ? '导入角色' : '导入服装';
        let importedCount = 0;
        let failedCount = 0;
        let firstError: string | undefined;
        let lastNewId = '';
        let lastAvatarId = '';

        for (const file of files) {
            try {
                const rawText = await readFileAsText(file);
                if (this.isDisposedView) return;
                const { candidates, skippedErrors } = parsePresetBatchJson(rawText, file.name);
                if (skippedErrors.length > 0) {
                    failedCount += skippedErrors.length;
                    firstError ??= skippedErrors[0];
                }
                for (const candidate of candidates) {
                    const rawData = candidate.data;
                    const errMsg = validatePresetPayloadForCategory(
                        kind === 'character' ? 'characters' : 'outfits',
                        rawData
                    );
                    if (errMsg) {
                        failedCount += 1;
                        firstError ??= errMsg;
                        continue;
                    }
                    const embeddedAvatar =
                        typeof rawData[EMBEDDED_AVATAR_FIELD] === 'string'
                            ? rawData[EMBEDDED_AVATAR_FIELD]
                            : '';
                    delete rawData[EMBEDDED_AVATAR_FIELD];

                    const finalName = resolveBatchUniquePresetName(
                        candidate.name ||
                            (typeof rawData.name === 'string' ? rawData.name : '') ||
                            fallbackName,
                        existingNames,
                        fallbackName
                    );

                    let resolvedAvatarId = '';
                    if (embeddedAvatar) {
                        try {
                            resolvedAvatarId =
                                (await materialImageStorage.importAvatarFromDataUrl(
                                    embeddedAvatar
                                )) || '';
                        } catch {
                            resolvedAvatarId = '';
                        }
                    }

                    const newId = this.generateUniqueMaterialId(kind);
                    if (kind === 'character') {
                        const normalized = normalizeCharacterData(rawData);
                        normalized.name = finalName;
                        normalized.avatarId = resolvedAvatarId;
                        settingsStore.savePreset('characters', {
                            id: newId,
                            name: finalName,
                            description: normalized.description,
                            data: normalized,
                            updatedAt: Date.now(),
                        });
                    } else {
                        const normalized = normalizeOutfitData(rawData);
                        normalized.name = finalName;
                        normalized.avatarId = resolvedAvatarId;
                        settingsStore.savePreset('outfits', {
                            id: newId,
                            name: finalName,
                            description: normalized.description,
                            data: normalized,
                            updatedAt: Date.now(),
                        });
                    }
                    this.syncActivationRuleSnapshot(kind, newId, 'add');
                    lastNewId = newId;
                    lastAvatarId = resolvedAvatarId;
                    importedCount += 1;
                }
            } catch (err: unknown) {
                failedCount += 1;
                firstError ??= err instanceof Error ? err.message : String(err);
            }
        }

        if (lastNewId) {
            ctrl.applyActivePreset(lastNewId);
            if (lastAvatarId) {
                this.ensureAvatarLoaded(lastAvatarId);
            }
            void promptInjector.scheduleSyncToHost();
        }
        Toast.show(formatBatchImportSummary(importedCount, failedCount, firstError), {
            level: importedCount === 0 ? 'error' : failedCount > 0 ? 'warning' : 'success',
        });
    }

    public updateMacroRules(
        kind: 'character' | 'outfit',
        rules: MaterialMacroRule[]
    ): void {
        this.formatController.patchDraft({
            [kind === 'character' ? 'characterMacros' : 'outfitMacros']: rules,
        });
    }

    protected renderContent(): VNode {
        const currentTab = this.subTab.value;

        return (
            <div className="da-materials-view-container">
                <div className="da-subtab-nav-bar">
                    <SegmentedControlView
                        size="lg"
                        value={currentTab}
                        options={[
                            { label: '角色管理', value: 'characters' },
                            { label: '服装管理', value: 'outfits' },
                            { label: '启用设置', value: 'activation' },
                            { label: '解析设置', value: 'extraction' },
                            { label: '变量与宏管理', value: 'format' },
                        ]}
                        onChange={(val) => {
                            this.subTab.value = val as MaterialsSubTab;
                        }}
                    />
                </div>

                {currentTab === 'characters' && (
                    <CharacterPanel
                        charController={this.charController}
                        outfitController={this.outfitController}
                        avatarUrlsSignal={this.avatarUrlsSignal}
                        charGroupExpanded={this.charGroupExpanded}
                        selectedOutfitToBind={this.selectedOutfitToBind}
                        onAction={(action, id) =>
                            this.handleMaterialToolbarAction('character', action, id)
                        }
                        onImportFiles={(files) =>
                            void this.handleMaterialImportFiles('character', files)
                        }
                        onUploadAvatar={(file) => this.uploadAvatar('character', file)}
                        onRemoveAvatar={() => this.removeDraftAvatar('character')}
                        onEnsureAvatarLoaded={(avatarId) =>
                            this.ensureAvatarLoaded(avatarId)
                        }
                    />
                )}
                {currentTab === 'outfits' && (
                    <OutfitPanel
                        outfitController={this.outfitController}
                        avatarUrlsSignal={this.avatarUrlsSignal}
                        outfitGroupExpanded={this.outfitGroupExpanded}
                        onAction={(action, id) =>
                            this.handleMaterialToolbarAction('outfit', action, id)
                        }
                        onImportFiles={(files) =>
                            void this.handleMaterialImportFiles('outfit', files)
                        }
                        onUploadAvatar={(file) => this.uploadAvatar('outfit', file)}
                        onRemoveAvatar={() => this.removeDraftAvatar('outfit')}
                        onEnsureAvatarLoaded={(avatarId) =>
                            this.ensureAvatarLoaded(avatarId)
                        }
                    />
                )}
                {currentTab === 'activation' && (
                    <ActivationPanel
                        charController={this.charController}
                        outfitController={this.outfitController}
                        activationController={this.activationController}
                        materialConfigSignal={this.materialConfigSignal}
                        onAction={(action, id) =>
                            this.handleMaterialToolbarAction('activation', action, id)
                        }
                        onImportFiles={(files) =>
                            void this.handleMaterialImportFiles('activation', files)
                        }
                    />
                )}
                {currentTab === 'extraction' && (
                    <ExtractionPanel
                        extractionController={this.extractionController}
                        charController={this.charController}
                        outfitController={this.outfitController}
                        sandboxText={this.sandboxText}
                        onArchivesApplied={() => {
                            if (!this.activationController.isDirty.value) {
                                this.activationController.reloadFromStore();
                            }
                            this.syncVisibleAvatars();
                            void promptInjector.scheduleSyncToHost();
                        }}
                    />
                )}
                {currentTab === 'format' && (
                    <FormatPanel
                        formatController={this.formatController}
                        activeMacroRuleKind={this.activeMacroRuleKind}
                        activeTemplateKind={this.activeTemplateKind}
                        isVariablesDrawerOpen={this.isVariablesDrawerOpen}
                        expandedMacroRuleIds={this.expandedMacroRuleIds}
                    />
                )}
            </div>
        );
    }
}
