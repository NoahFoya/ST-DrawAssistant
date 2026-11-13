/**
 * 素材库选项卡视图 (MaterialsTabView)。
 *
 * @remarks
 * 基于顶部分段导航划分为五个子面板：
 * 1. 角色管理：预设工具栏、居中紧凑参考图、基础信息卡片、Token 统计条、体貌特征与 13 细分生理部位全宽文本域、服装绑定列表；
 * 2. 服装管理：预设工具栏、居中紧凑参考图、基础信息卡片、Token 统计条、服饰风格与 9 细分服饰部位全宽文本域；
 * 3. 启用设置：独立启用预设工具栏、酒馆角色卡自动联动开关、角色启用规则列表、通用服装启用规则列表；
 * 4. 解析设置：楼层档案提取配置、起止标记与提取测试沙盒；
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
import { PresetController } from '../viewmodels';
import { bindDelegatedTagAutocomplete } from '../composite/tag-autocomplete';
import type { Disposable } from '../types';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import {
    materialImageStorage,
    EMBEDDED_AVATAR_FIELD,
} from '../../store/material-image-storage';
import {
    createEmptyCharacterData,
    createEmptyOutfitData,
    normalizeCharacterData,
    normalizeOutfitData,
    validateMacroKey,
} from '../../pipeline/material-definitions';
import { DEFAULT_EXTRACTION_CONFIG } from '../../pipeline/archive-extractor';
import {
    DEFAULT_FORMAT_TEMPLATES,
    promptInjector,
} from '../../pipeline/prompt-injector';
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
        physique_features: false,
        face_head: false,
        torso_body: false,
        limbs_details: false,
        reproductive: false,
    });
    public readonly outfitGroupExpanded = signal<Record<string, boolean>>({
        style_head: false,
        main_wear: false,
        limbs_shoes: false,
        accessories: false,
        underwear: false,
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
                this.activationController?.reloadFromStore();
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
                this.activationController?.reloadFromStore();
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
            defaultTemplate: () => ({ ...DEFAULT_EXTRACTION_CONFIG }),
            getActiveId: () =>
                settingsStore.get('materialConfig')?.activeExtractionPresetId || 'ext_default',
            setActiveId: (id) => {
                const cur = settingsStore.get('materialConfig');
                const preset = settingsStore.getPreset<MaterialExtractionPresetData>('material_extractions', id);
                const next: MaterialLibraryConfig = {
                    ...cur,
                    activeExtractionPresetId: id,
                    extraction: preset?.data ? { ...preset.data } : cur.extraction,
                };
                settingsStore.set('materialConfig', next);
                this.materialConfigSignal.value = next;
            },
            evaluateDirtyFields: evaluatePresetDataDirty,
            onPresetApplied: () => {
                const cur = settingsStore.get('materialConfig');
                const active = this.extractionController.currentPreset.value;
                if (active?.data) {
                    const next: MaterialLibraryConfig = {
                        ...cur,
                        activeExtractionPresetId: active.id,
                        extraction: { ...active.data },
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
                characterTemplate: DEFAULT_FORMAT_TEMPLATES.characterTemplate,
                outfitTemplate: DEFAULT_FORMAT_TEMPLATES.outfitTemplate,
                macroTemplate: DEFAULT_FORMAT_TEMPLATES.macroTemplate || '- {{macro}}: {{description}}',
                characterMacros: [],
                outfitMacros: [],
            }),
            getActiveId: () =>
                settingsStore.get('materialConfig')?.activeFormatPresetId || 'fmt_default',
            setActiveId: (id) => {
                const cur = settingsStore.get('materialConfig');
                const preset = settingsStore.getPreset<MaterialFormatPresetData>('material_formats', id);
                const next: MaterialLibraryConfig = {
                    ...cur,
                    activeFormatPresetId: id,
                    format: preset?.data
                        ? {
                              characterTemplate: preset.data.characterTemplate,
                              outfitTemplate: preset.data.outfitTemplate,
                              macroTemplate: preset.data.macroTemplate,
                          }
                        : cur.format,
                    characterMacros: preset?.data?.characterMacros || cur.characterMacros,
                    outfitMacros: preset?.data?.outfitMacros || cur.outfitMacros,
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
                if (active?.data) {
                    const next: MaterialLibraryConfig = {
                        ...cur,
                        activeFormatPresetId: active.id,
                        format: {
                            characterTemplate: active.data.characterTemplate,
                            outfitTemplate: active.data.outfitTemplate,
                            macroTemplate: active.data.macroTemplate,
                        },
                        characterMacros: (active.data.characterMacros || []).filter(
                            (r) => Boolean(r.name && r.name.trim())
                        ),
                        outfitMacros: (active.data.outfitMacros || []).filter(
                            (r) => Boolean(r.name && r.name.trim())
                        ),
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
                data.key === 'materialConfig' ||
                data.keys?.includes('materialConfig')
            ) {
                this.materialConfigSignal.value = settingsStore.get('materialConfig');
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
        this.charController.reloadFromStore();
        this.outfitController.reloadFromStore();
        this.activationController.reloadFromStore();
        this.extractionController.reloadFromStore();
        this.formatController.reloadFromStore();
        this.materialConfigSignal.value = settingsStore.get('materialConfig');
        this.syncVisibleAvatars();
        super.activate();
    }

    public override dispose(): void {
        this.isDisposedView = true;
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

        const inCharPresets = settingsStore
            .getPresets<CharacterPresetData>('characters')
            .some((p) => p.data?.avatarId === cleanId);
        const inOutfitPresets = settingsStore
            .getPresets<OutfitPresetData>('outfits')
            .some((p) => p.data?.avatarId === cleanId);
        const inDrafts =
            this.charController.draftConfig.value?.avatarId === cleanId ||
            this.outfitController.draftConfig.value?.avatarId === cleanId;

        if (inCharPresets || inOutfitPresets || inDrafts) {
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

    /**
     * 处理角色/服装/启用预设工具栏动作（保持预设名与 data.name 一致，并支持连图导出与孤立图片回收）。
     */
    public async handleMaterialToolbarAction(
        kind: 'character' | 'outfit' | 'activation',
        action: PresetActionType,
        targetId?: string,
        onExportPayload?: (payload: Record<string, unknown>, filename: string) => void
    ): Promise<void> {
        if (kind === 'activation') {
            await this.activationController.handleAction(action, targetId);
            this.materialConfigSignal.value = { ...settingsStore.get('materialConfig') };
            void promptInjector.scheduleSyncToHost();
            return;
        }

        const category = kind === 'character' ? 'characters' : 'outfits';
        const ctrl = kind === 'character' ? this.charController : this.outfitController;

        if (action === 'export') {
            const cur = ctrl.currentPreset.value;
            if (!cur) return;
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

            const blob = new Blob([JSON.stringify(exportItem, null, 2)], {
                type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            return;
        }

        if (action === 'saveAs') {
            const cur = ctrl.currentPreset.value;
            if (!cur) return;
            const list = ctrl.fetchPresetsList();
            const existingNames = new Set(list.map((p) => p.name));
            const targetName = await ConfirmDialog.prompt({
                title: '另存为新预设',
                message:
                    kind === 'character'
                        ? '请输入角色另存名称:'
                        : '请输入服装另存名称:',
                defaultValue: `${cur.name || '档案'} (副本)`,
                placeholder: '请输入唯一的预设名称',
                validator: (val) =>
                    existingNames.has(val) ? '预设名称已存在，请换一个名称' : null,
            });
            if (!targetName || !targetName.trim()) return;

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

            const newId = `${kind === 'character' ? 'char_' : 'outfit_'}${Date.now().toString(36)}`;
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
            Toast.show(`已另存预设: ${cleanName}`, { level: 'success' });
            return;
        }

        if (action === 'save') {
            const oldBaselineAvatar = ctrl.baselineSnapshot.value?.avatarId || '';
            const trimmedDraftName = (ctrl.draftConfig.value?.name || '').trim();
            if (ctrl.currentPreset.value && trimmedDraftName) {
                ctrl.currentPreset.value = {
                    ...ctrl.currentPreset.value,
                    name: trimmedDraftName,
                };
            }
            await ctrl.handleAction('save', targetId);
            const currentAvatar = ctrl.baselineSnapshot.value?.avatarId || '';
            if (oldBaselineAvatar && oldBaselineAvatar !== currentAvatar) {
                this.releaseAvatarIfUnused(oldBaselineAvatar);
            }
            return;
        }

        if (action === 'new') {
            const unsavedAvatar = ctrl.draftConfig.value?.avatarId || '';
            const baseAvatar = ctrl.baselineSnapshot.value?.avatarId || '';
            await ctrl.handleAction('new', targetId);
            if (unsavedAvatar && unsavedAvatar !== baseAvatar) {
                this.releaseAvatarIfUnused(unsavedAvatar);
            }
            const created = ctrl.currentPreset.value;
            if (created && !created.data?.name) {
                const syncedData = {
                    ...created.data,
                    name: created.name,
                };
                if (kind === 'character') {
                    settingsStore.savePreset(category, {
                        ...created,
                        data: normalizeCharacterData(syncedData as CharacterPresetData),
                    });
                } else {
                    settingsStore.savePreset(category, {
                        ...created,
                        data: normalizeOutfitData(syncedData as OutfitPresetData),
                    });
                }
                ctrl.reloadFromStore();
            }
            return;
        }

        if (action === 'rename') {
            await ctrl.handleAction('rename', targetId);
            const renamed = ctrl.currentPreset.value;
            if (renamed && renamed.data?.name !== renamed.name) {
                if (kind === 'character') {
                    settingsStore.savePreset('characters', {
                        ...renamed,
                        data: { ...(renamed.data as CharacterPresetData), name: renamed.name },
                    });
                } else {
                    settingsStore.savePreset('outfits', {
                        ...renamed,
                        data: { ...(renamed.data as OutfitPresetData), name: renamed.name },
                    });
                }
                ctrl.reloadFromStore();
            }
            return;
        }

        if (action === 'reset') {
            const unsavedAvatar = ctrl.draftConfig.value?.avatarId || '';
            const baseAvatar = ctrl.baselineSnapshot.value?.avatarId || '';
            await ctrl.handleAction('reset', targetId);
            if (unsavedAvatar && unsavedAvatar !== baseAvatar) {
                this.releaseAvatarIfUnused(unsavedAvatar);
            }
            return;
        }

        if (action === 'delete') {
            const cur = ctrl.currentPreset.value;
            const targetPreset = targetId
                ? ctrl.fetchPresetsList().find((p) => p.id === targetId) ?? cur
                : cur;
            const deletedAvatar = targetPreset?.data?.avatarId || '';
            await ctrl.handleAction('delete', targetId);
            if (deletedAvatar) {
                this.releaseAvatarIfUnused(deletedAvatar);
            }
            this.activationController.reloadFromStore();
            void promptInjector.scheduleSyncToHost();
            return;
        }

        await ctrl.handleAction(action, targetId);
    }

    /**
     * 导入单个角色或服装 JSON 文本（自动解包内嵌参考图至 IndexedDB 并剥离出配置对象）。
     */
    public async importMaterialJson(
        kind: 'character' | 'outfit',
        rawJsonText: string
    ): Promise<void> {
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(rawJsonText) as Record<string, unknown>;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`文件内容非有效 JSON 格式: ${message}`);
        }
        if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
            throw new Error('预设文件格式错误：缺少有效的 data 对象');
        }

        const rawData = parsed.data as Record<string, unknown>;
        const embeddedDataUrl =
            typeof rawData[EMBEDDED_AVATAR_FIELD] === 'string'
                ? (rawData[EMBEDDED_AVATAR_FIELD] as string)
                : '';

        const ctrl = kind === 'character' ? this.charController : this.outfitController;
        const list = ctrl.fetchPresetsList();
        const existingNames = new Set(list.map((p) => p.name));
        const baseName =
            (typeof parsed.name === 'string' && parsed.name.trim()) ||
            (typeof rawData.name === 'string' && rawData.name.trim()) ||
            (kind === 'character' ? '导入角色' : '导入服装');

        let finalName = baseName;
        if (existingNames.has(baseName)) {
            const negotiated = await ConfirmDialog.prompt({
                title: '导入预设名称冲突',
                message: `已存在同名预设「${baseName}」，请指定一个新名称:`,
                defaultValue: `${baseName} (导入)`,
                placeholder: '请输入唯一的预设名称',
                validator: (val) =>
                    existingNames.has(val) ? '预设名称已存在，请换一个名称' : null,
            });
            if (!negotiated || !negotiated.trim()) return;
            finalName = negotiated.trim();
        }

        let resolvedAvatarId = '';
        if (embeddedDataUrl.startsWith('data:image/')) {
            resolvedAvatarId =
                (await materialImageStorage.importAvatarFromDataUrl(embeddedDataUrl)) ?? '';
        }

        const newId = `${kind === 'character' ? 'char_' : 'outfit_'}${Date.now().toString(36)}`;
        if (kind === 'character') {
            const charData = normalizeCharacterData({
                ...rawData,
                name: finalName,
                avatarId: resolvedAvatarId,
            });
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

        if (resolvedAvatarId) {
            this.ensureAvatarLoaded(resolvedAvatarId);
        }
        this.activationController.reloadFromStore();
        void promptInjector.scheduleSyncToHost();
        Toast.show(`已成功导入预设: ${finalName}`, { level: 'success' });
    }

    private handleMaterialImportFile(kind: 'character' | 'outfit' | 'activation', file: File): void {
        if (kind === 'activation') {
            this.activationController.handleImportFile(file);
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            void this.importMaterialJson(kind, String(reader.result || '')).catch(
                (err: unknown) => {
                    const message = err instanceof Error ? err.message : String(err);
                    Toast.show(`导入解析失败: ${message}`, { level: 'error' });
                }
            );
        };
        reader.onerror = () => {
            Toast.show('读取导入文件失败', { level: 'error' });
        };
        reader.readAsText(file);
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
                        onImportFile={(file) =>
                            this.handleMaterialImportFile('character', file)
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
                        onImportFile={(file) =>
                            this.handleMaterialImportFile('outfit', file)
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
                        onImportFile={(file) =>
                            this.handleMaterialImportFile('activation', file)
                        }
                    />
                )}
                {currentTab === 'extraction' && (
                    <ExtractionPanel
                        extractionController={this.extractionController}
                        charController={this.charController}
                        outfitController={this.outfitController}
                        sandboxText={this.sandboxText}
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
