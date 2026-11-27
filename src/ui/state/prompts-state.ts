/**
 * 提示词注入管理无 DOM 状态模型 (PromptsState)。
 */

import { signal } from '@preact/signals';
import type {
    PresetItem,
    PresetCategory,
    PromptChannelId,
    PromptChannelPresetData,
    PromptInjectionEntry,
    PromptInjectionConfig,
} from '@types';
import type { Disposable } from '../types';
import type { PresetActionType } from '../composite';
import {
    AppValidationError,
    normalizePresetNameKey,
    parsePresetBatchJson,
    stripJsonExtension,
    collectKeywordRegexErrors,
} from '../../domain';
import { readFileAsText } from '../../util/browser-io';
import { presetTransferService } from '../../pipeline/preset-transfer-service';
import {
    PresetController,
    resolveUniquePresetName,
    evaluatePresetDataDirty,
} from './preset-controller';
import { settingsStore, type DrawAssistantSettings } from '../../store/settings-store';
import { getCachedOfficialPresets } from '../../store/static-preset-loader';
import { eventBus } from '../../util/event-bus';
import { promptInjector } from '../../pipeline/prompt-injector';
import {
    detectPromptImportFormat,
    normalizePluginPromptChannelPreset,
    parseStWorldbookEntries,
} from '../../pipeline/worldbook-converter';
import {
    openWorldbookImportModal,
    openPromptExportFormatModal,
    type PromptExportFormat,
} from '../modal/worldbook-import-modal';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { Toast } from '../feedback/toast';
import { reportRuntimeError } from '../feedback/error-feedback';

export interface PromptChannelMeta {
    readonly id: PromptChannelId;
    readonly category: PresetCategory;
    readonly label: string;
    readonly defaultDepth: number;
    readonly defaultOrder: number;
    readonly desc: string;
}

export const PROMPT_CHANNELS: readonly PromptChannelMeta[] = [
    {
        id: 'story',
        category: 'prompt_story',
        label: '故事插画',
        defaultDepth: 0,
        defaultOrder: 10,
        desc: '默认开启的主通道，告诉 AI 什么时候出图、怎么写画面提示词；如果你已经挂载外部绘画世界书，可关闭本通道避免规则冲突。',
    },
    {
        id: 'vocab',
        category: 'prompt_vocab',
        label: '词汇指导',
        defaultDepth: 7,
        defaultOrder: 200,
        desc: '默认关闭的参考词表通道，会在距最新消息第 7 轮（@D=7）补充常用画风与构图词表供 AI 选用；它发给 AI 看，和「词库」里的本地打字联想相互独立。',
    },
    {
        id: 'character',
        category: 'prompt_character',
        label: '素材创作',
        defaultDepth: 0,
        defaultOrder: 20,
        desc: '默认关闭的建档指南通道，引导 AI 按「素材管理 → 解析设置」的标签格式生成角色与服装档案，方便直接收录进素材库。',
    },
    {
        id: 'material',
        category: 'prompt_material',
        label: '素材注入',
        defaultDepth: 0,
        defaultOrder: 30,
        desc: '默认关闭的素材发送通道，通过 {{角色启用列表}}、{{服装启用列表}} 等变量，把当前启用的角色和服装设定发给 AI 参考。',
    },
];

export type PromptsSubTabId = PromptChannelId | 'preview';

function createDefaultEntryForChannel(
    channelId: PromptChannelId,
    index: number
): PromptInjectionEntry {
    const meta = PROMPT_CHANNELS.find((c) => c.id === channelId) || PROMPT_CHANNELS[0];

    if (channelId === 'material') {
        const officialEntry =
            getCachedOfficialPresets()?.prompt_material?.[0]?.data?.entries?.[index];
        if (officialEntry) {
            return {
                ...structuredClone(officialEntry),
                id: `${channelId}_entry_${Date.now().toString(36)}_${index}`,
            };
        }
    }

    const entryName =
        channelId === 'material' && index === 0
            ? '核心|绘画素材库'
            : `${meta.label}条目 #${index + 1}`;
    const content =
        channelId === 'material' && index === 0
            ? '<image_database>\n  <character_database>\n    {{角色启用列表}}\n  </character_database>\n\n  <outfit_database>\n    {{服装启用列表}}\n  </outfit_database>\n</image_database>'
            : '';

    return {
        id: `${channelId}_entry_${Date.now().toString(36)}_${index}`,
        name: entryName,
        enabled: true,
        triggerMode: 'always',
        keywords: '',
        matchWholeWords: true,
        scanDepth: channelId === 'vocab' ? 4 : 2,
        position: 1,
        depth: meta.defaultDepth,
        role: 0,
        order: meta.defaultOrder + index,
        content,
    };
}

export class PromptsState implements Disposable {
    public readonly subTab = signal<PromptsSubTabId>('story');
    public readonly promptInjectionSignal = signal<PromptInjectionConfig>(
        settingsStore.get('promptInjection')
    );
    public readonly previewVersionSignal = signal<number>(0);

    public readonly controllers: Record<
        PromptChannelId,
        PresetController<PromptChannelPresetData>
    >;

    private unlistenSettings: (() => void) | null = null;
    private disposed = false;

    public constructor() {
        const buildController = (
            meta: PromptChannelMeta
        ): PresetController<PromptChannelPresetData> =>
            new PresetController<PromptChannelPresetData>({
                category: meta.category,
                idPrefix: `${meta.category}_`,
                promptMessageForNew: `请输入新「${meta.label}」预设名称:`,
                defaultNewName: `新建${meta.label}预设`,
                promptMessageForSaveAs: `请输入「${meta.label}」另存预设名称:`,
                promptMessageForRename: `请输入新的「${meta.label}」预设名称:`,
                defaultImportName: `导入${meta.label}预设`,
                exportFilenamePrefix: `st-draw-${meta.id}-`,
                minRemainingOnDelete: 1,
                showToast: true,
                defaultTemplate: () => ({
                    entries: [createDefaultEntryForChannel(meta.id, 0)],
                }),
                getActiveId: () =>
                    settingsStore.get('promptInjection')?.[meta.id]?.activePresetId || '',
                setActiveId: (id) => {
                    const cur = settingsStore.get('promptInjection');
                    const next: PromptInjectionConfig = {
                        ...cur,
                        [meta.id]: {
                            ...(cur?.[meta.id] || { enabled: false }),
                            activePresetId: id,
                        },
                    };
                    settingsStore.set('promptInjection', next);
                    this.promptInjectionSignal.value = next;
                },
                evaluateDirtyFields: evaluatePresetDataDirty,
                canPerformAction: (action, draft) => {
                    if (action !== 'save' && action !== 'saveAs') {
                        return { allowed: true };
                    }
                    const draftEntries = Array.isArray(draft?.entries) ? draft.entries : [];
                    for (const entry of draftEntries) {
                        if (!entry || entry.triggerMode === 'always') continue;
                        const mainErr = collectKeywordRegexErrors(entry.keywords, {
                            allowPipe: false,
                        })[0];
                        if (mainErr) {
                            return {
                                allowed: false,
                                message: `请先修正条目「${entry.name || '未命名'}」主关键词中的无效正则：${mainErr}`,
                            };
                        }
                        const secErr = collectKeywordRegexErrors(entry.secondaryKeywords, {
                            allowPipe: false,
                        })[0];
                        if (secErr) {
                            return {
                                allowed: false,
                                message: `请先修正条目「${entry.name || '未命名'}」次要关键词中的无效正则：${secErr}`,
                            };
                        }
                    }
                    return { allowed: true };
                },
                onPresetApplied: () => {
                    void promptInjector.scheduleSyncToHost();
                },
            });

        const channelMap = new Map(PROMPT_CHANNELS.map((m) => [m.id, m]));
        this.controllers = {
            story: buildController(channelMap.get('story')!),
            vocab: buildController(channelMap.get('vocab')!),
            character: buildController(channelMap.get('character')!),
            material: buildController(channelMap.get('material')!),
        };

        this.unlistenSettings = eventBus.on('settings:updated', (data) => {
            if (this.disposed) return;
            const matchedPromptCategory = PROMPT_CHANNELS.find(
                (meta) => data.key === `presets.${meta.category}`
            );
            if (
                !data.key ||
                data.isReset ||
                data.key === 'promptInjection' ||
                data.key === 'materialConfig' ||
                data.key === 'presets.characters' ||
                data.key === 'presets.outfits' ||
                data.key === 'presets.material_activations' ||
                data.key === 'presets.material_extractions' ||
                data.key === 'presets.material_formats' ||
                Boolean(matchedPromptCategory) ||
                data.keys?.includes('promptInjection') ||
                data.keys?.includes('materialConfig') ||
                data.keys?.includes('presets')
            ) {
                if (
                    data.isReset ||
                    data.key === 'promptInjection' ||
                    data.keys?.includes('presets') ||
                    data.keys?.includes('promptInjection')
                ) {
                    for (const meta of PROMPT_CHANNELS) {
                        if (!this.controllers[meta.id].isDirty.value) {
                            this.controllers[meta.id].reloadFromStore();
                        }
                    }
                } else if (matchedPromptCategory) {
                    const ctrl = this.controllers[matchedPromptCategory.id];
                    if (!ctrl.isDirty.value) {
                        ctrl.reloadFromStore();
                    } else {
                        ctrl.refreshPresets();
                    }
                }
                this.promptInjectionSignal.value = settingsStore.get('promptInjection');
                this.previewVersionSignal.value += 1;
            }
        });
    }

    public activate(): void {
        if (this.disposed) return;
        for (const meta of PROMPT_CHANNELS) {
            if (!this.controllers[meta.id].isDirty.value) {
                this.controllers[meta.id].reloadFromStore();
            }
        }
        this.promptInjectionSignal.value = settingsStore.get('promptInjection');
        this.previewVersionSignal.value += 1;
    }

    public hasUnsavedChanges(): boolean {
        return PROMPT_CHANNELS.some((meta) => this.controllers[meta.id].isDirty.value);
    }

    public async saveUnsavedChanges(): Promise<boolean> {
        for (const meta of PROMPT_CHANNELS) {
            const ctrl = this.controllers[meta.id];
            if (ctrl.isDirty.value) {
                const ok = await ctrl.handleAction('save');
                if (!ok) return false;
            }
        }
        void promptInjector.scheduleSyncToHost();
        return true;
    }

    public discardUnsavedChanges(): void {
        for (const meta of PROMPT_CHANNELS) {
            this.controllers[meta.id].discardDraft();
        }
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const meta of PROMPT_CHANNELS) {
            this.controllers[meta.id].dispose();
        }
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
    }

    public toggleChannelEnabled(channelId: PromptChannelId, enabled: boolean): void {
        const cur = settingsStore.get('promptInjection');
        const next: PromptInjectionConfig = {
            ...cur,
            [channelId]: {
                ...(cur?.[channelId] || { activePresetId: '' }),
                enabled,
            },
        };
        settingsStore.set('promptInjection', next);
        this.promptInjectionSignal.value = next;
        void promptInjector.scheduleSyncToHost();
    }

    public toggleMaterialHideWhenEmpty(hideWhenEmpty: boolean): void {
        const cur = settingsStore.get('promptInjection');
        const next: PromptInjectionConfig = {
            ...cur,
            material: {
                ...(cur?.material || { enabled: false, activePresetId: '' }),
                hideWhenEmpty,
            },
        };
        settingsStore.set('promptInjection', next);
        this.promptInjectionSignal.value = next;
        void promptInjector.scheduleSyncToHost();
    }

    public async handleToolbarAction(
        channelId: PromptChannelId,
        action: PresetActionType,
        targetId: string,
        onExportedCallback?: (
            format: PromptExportFormat,
            payload: Record<string, unknown>,
            filename: string
        ) => void
    ): Promise<boolean> {
        const controller = this.controllers[channelId];
        if (action === 'export') {
            const cur = controller.currentPreset.value;
            if (!cur) return false;
            const entries = controller.draftConfig.value?.entries || cur.data?.entries || [];
            openPromptExportFormatModal({
                preset: cur,
                entries,
                filenamePrefix: `st-draw-${channelId}-`,
                onExported: onExportedCallback,
            });
            return true;
        }
        return await controller.handleAction(action, targetId);
    }

    public async importParsedJsonForChannel(
        channelId: PromptChannelId,
        raw: unknown,
        fallbackFileName?: string
    ): Promise<void> {
        if (this.disposed) return;
        const meta = PROMPT_CHANNELS.find((c) => c.id === channelId) || PROMPT_CHANNELS[0];
        const controller = this.controllers[channelId];
        const format = detectPromptImportFormat(raw);

        if (format === 'invalid') {
            reportRuntimeError(
                '[PromptsState] 导入提示词预设失败：未识别的 JSON 格式',
                '导入失败：未识别为有效的插件提示词预设或酒馆原生世界书 JSON，请前往「日志与统计」查看详情',
                undefined,
                'warn'
            );
            return;
        }

        if (format === 'plugin-preset') {
            const fallbackName = stripJsonExtension(fallbackFileName) || `导入${meta.label}预设`;
            const normalized = normalizePluginPromptChannelPreset(
                raw as Record<string, unknown>,
                fallbackName
            );
            if (!normalized) {
                reportRuntimeError(
                    '[PromptsState] 导入提示词预设失败：预设缺少 entries 数组',
                    '导入失败：预设缺少 entries 数组，请前往「日志与统计」查看详情',
                    fallbackName,
                    'warn'
                );
                return;
            }
            await this.saveNewImportedPreset(
                channelId,
                normalized.name,
                normalized.data.entries
            );
            return;
        }

        const parsedBook = parseStWorldbookEntries(
            raw as Record<string, unknown>,
            `${channelId}_wb_`
        );
        if (parsedBook.entries.length === 0) {
            Toast.show('该酒馆世界书不包含可导入的条目', { level: 'warning' });
            return;
        }

        openWorldbookImportModal({
            parsed: parsedBook,
            hasActivePreset: Boolean(controller.currentPreset.value),
            activePresetName: controller.currentPreset.value?.name || '',
            onConfirm: async (res) => {
                if (res.mode === 'append_current' && controller.currentPreset.value) {
                    const currentEntries = controller.draftConfig.value?.entries || [];
                    const existingIds = new Set(currentEntries.map((e) => e.id));
                    const appended = res.selectedEntries.map((entry, idx) => {
                        let nextId = entry.id;
                        if (existingIds.has(nextId)) {
                            nextId = `${entry.id}_${Date.now().toString(36)}_${idx}`;
                        }
                        existingIds.add(nextId);
                        return { ...entry, id: nextId };
                    });
                    const mergedEntries = [...currentEntries, ...appended];
                    controller.updateDraft('entries', mergedEntries);

                    const saved = await controller.handleAction('save');
                    if (saved) {
                        Toast.show(
                            `已向预设「${controller.currentPreset.value?.name || ''}」追加 ${appended.length} 条世界书条目`,
                            { level: 'success' }
                        );
                    }
                } else {
                    await this.saveNewImportedPreset(
                        channelId,
                        res.presetName,
                        res.selectedEntries
                    );
                }
            },
        });
    }

    private async saveNewImportedPreset(
        channelId: PromptChannelId,
        proposedName: string,
        entries: PromptInjectionEntry[]
    ): Promise<void> {
        if (this.disposed) return;
        const meta = PROMPT_CHANNELS.find((c) => c.id === channelId) || PROMPT_CHANNELS[0];
        const controller = this.controllers[channelId];

        if (controller.isDirty.value) {
            const confirmed = await ConfirmDialog.confirm({
                title: '导入预设确认',
                message: `当前「${meta.label}」预设存在未保存的修改，导入并切换新预设将放弃当前未保存修改。是否确定继续导入？`,
            });
            if (!confirmed || this.disposed) return;
        }

        const list = controller.fetchPresetsList();
        const existingNames = new Set(list.map((p) => normalizePresetNameKey(p.name)));
        const fallbackName = `导入${meta.label}预设`;

        const finalName = await resolveUniquePresetName(proposedName, existingNames, fallbackName);
        if (!finalName || this.disposed) {
            return;
        }

        const existingIds = new Set(list.map((p) => p.id));
        let newId = `${meta.category}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        while (existingIds.has(newId)) {
            newId = `${meta.category}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        }
        const newPreset: PresetItem<PromptChannelPresetData> = {
            id: newId,
            name: finalName,
            data: { entries: structuredClone(entries) },
            updatedAt: Date.now(),
        };
        settingsStore.savePreset(meta.category, newPreset);
        controller.applyActivePreset(newId);
        void promptInjector.scheduleSyncToHost();
        Toast.show(`已成功导入预设: ${finalName}（共 ${entries.length} 条条目）`, {
            level: 'success',
        });
    }

    public async handleImportFiles(channelId: PromptChannelId, files: File[]): Promise<void> {
        if (this.disposed || files.length === 0) return;
        const meta = PROMPT_CHANNELS.find((c) => c.id === channelId) || PROMPT_CHANNELS[0];
        const controller = this.controllers[channelId];

        if (files.length === 1) {
            try {
                const rawText = await readFileAsText(files[0]);
                if (this.disposed) return;
                const parsed: unknown = JSON.parse(rawText);
                const isBundle =
                    Array.isArray(parsed) ||
                    (Boolean(parsed) &&
                        typeof parsed === 'object' &&
                        Array.isArray((parsed as Record<string, unknown>).presets));
                if (!isBundle) {
                    await this.importParsedJsonForChannel(channelId, parsed, files[0].name);
                    return;
                }
            } catch (err: unknown) {
                reportRuntimeError(
                    '[PromptsState] 解析 JSON 文件失败:',
                    '解析 JSON 文件失败，请检查文件格式或在日志查看详情',
                    err
                );
                return;
            }
        }

        const existingNames = new Set(
            controller.fetchPresetsList().map((p) => normalizePresetNameKey(p.name))
        );
        const fallbackName = `导入${meta.label}预设`;

        const result = await presetTransferService.importFiles<PromptChannelPresetData>({
            files,
            existingNames,
            fallbackName,
            logTag: '[PromptsState]',
            isDisposed: () => this.disposed,
            isDirty: () => controller.isDirty.value,
            confirmOverwrite: () =>
                ConfirmDialog.confirm({
                    title: '导入预设确认',
                    message: `当前「${meta.label}」预设存在未保存的修改，导入并切换新预设将放弃当前未保存修改。是否确定继续导入？`,
                }),
            parseFile: (rawText, file) => {
                const { candidates, skippedErrors } = parsePresetBatchJson(rawText, file.name);
                const valid: Array<{ name: string; data: PromptChannelPresetData }> = [];
                const channelErrors: AppValidationError[] = [...skippedErrors];
                for (const candidate of candidates) {
                    const normalized = normalizePluginPromptChannelPreset(
                        { name: candidate.name, data: candidate.data },
                        candidate.name
                    );
                    if (!normalized) {
                        channelErrors.push(new AppValidationError('预设缺少 entries 数组'));
                        continue;
                    }
                    valid.push({ name: normalized.name, data: normalized.data });
                }
                return { candidates: valid, skippedErrors: channelErrors };
            },
            commitItem: (candidate, finalName) => {
                const newId = `${channelId}_${Date.now()}_${Math.random()
                    .toString(36)
                    .slice(2, 6)}`;
                settingsStore.savePreset(meta.category, {
                    id: newId,
                    name: finalName,
                    data: { entries: structuredClone(candidate.data.entries) },
                    updatedAt: Date.now(),
                });
                return { id: newId, name: finalName };
            },
        });

        if (result.aborted) return;

        if (result.lastImportedId) {
            controller.applyActivePreset(result.lastImportedId);
            void promptInjector.scheduleSyncToHost();
        }
        Toast.show(result.summaryMessage, { level: result.toastLevel });
    }

    public updateChannelEntries(
        channelId: PromptChannelId,
        nextEntries: PromptInjectionEntry[]
    ): void {
        this.controllers[channelId].updateDraft('entries', nextEntries);
    }

    public buildPreviewSettingsSnapshot(): DrawAssistantSettings {
        const base = settingsStore.getSettings();
        const mergeCategory = (
            channelId: PromptChannelId,
            category: PresetCategory
        ): PresetItem<PromptChannelPresetData>[] => {
            const list = (base.presets[category] || []) as PresetItem<PromptChannelPresetData>[];
            const ctrl = this.controllers[channelId];
            const activeId = ctrl.activePresetId.value;
            const draft = ctrl.draftConfig.value;
            if (!activeId || !draft) return list;
            return list.map((p) => (p.id === activeId ? { ...p, data: draft } : p));
        };

        return {
            ...base,
            presets: {
                ...base.presets,
                prompt_story: mergeCategory('story', 'prompt_story'),
                prompt_character: mergeCategory('character', 'prompt_character'),
                prompt_vocab: mergeCategory('vocab', 'prompt_vocab'),
                prompt_material: mergeCategory('material', 'prompt_material'),
            },
        };
    }
}
