/**
 * 提示词选项卡视图 (PromptsTabView)。
 *
 * @remarks
 * 组织四大提示词注入通道与启用设置面板：
 * 1. 故事插画 (`story`)：场景捕捉、视觉推演与标签组装规范条目；
 * 2. 词汇指导 (`vocab`)：常驻基础词汇与条件触发标签条目；
 * 3. 素材创作 (`character`)：角色设定扩写与服装/档案排版规范条目；
 * 4. 素材注入 (`material`)：承载外部 <image_database> 容器并引用素材启用列表变量；
 * 5. 启用设置 (`preview`)：统一管理四大通道启用开关与激活预设，并提供实时分桶注入预览。
 */

import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import type {
    PromptChannelId,
    PromptInjectionEntry,
    PromptChannelPresetData,
    PromptInjectionConfig,
    PresetCategory,
    PresetItem,
} from '@types';
import {
    PreactSettingsView,
    CardView,
    SegmentedControlView,
    PresetToolbarView,
} from '../framework';
import type { PresetActionType } from '../composite';
import { PromptEntriesManager } from '../composite/prompt-entries-manager';
import {
    PromptsPreviewPanel,
    PROMPT_CHANNELS,
    type PromptChannelMeta,
} from './prompts-preview-panel';
import { PresetController } from '../viewmodels';
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
import { evaluatePresetDataDirty } from './materials/material-types';

export type PromptsSubTabId = PromptChannelId | 'preview';

function createDefaultEntryForChannel(
    channelId: PromptChannelId,
    index: number
): PromptInjectionEntry {
    const meta = PROMPT_CHANNELS.find((c) => c.id === channelId) || PROMPT_CHANNELS[0];

    // 素材注入通道新建空白预设时，优先与官方静态预设保持同源模板
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
        scanDepth: 2,
        position: 1,
        depth: meta.defaultDepth,
        role: 0,
        order: meta.defaultOrder + index,
        ...(channelId === 'material' ? { skipWhenEmpty: true } : {}),
        content,
    };
}

export class PromptsTabView extends PreactSettingsView {
    public readonly id = 'prompts';
    public readonly title = '提示词';

    public readonly subTab = signal<PromptsSubTabId>('story');
    public readonly promptInjectionSignal = signal<PromptInjectionConfig>(
        settingsStore.get('promptInjection')
    );

    public readonly controllers: Record<
        PromptChannelId,
        PresetController<PromptChannelPresetData>
    >;

    private unlistenSettings: (() => void) | null = null;

    public constructor() {
        super('da-tab-pane da-view-prompts');

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
            if (
                !data.key ||
                data.key === 'promptInjection' ||
                data.keys?.includes('promptInjection')
            ) {
                this.promptInjectionSignal.value = settingsStore.get('promptInjection');
            }
        });

        this.mountPreact();
    }

    public override activate(): void {
        for (const meta of PROMPT_CHANNELS) {
            if (!this.controllers[meta.id].isDirty.value) {
                this.controllers[meta.id].reloadFromStore();
            }
        }
        this.promptInjectionSignal.value = settingsStore.get('promptInjection');
        super.activate();
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

    public override dispose(): void {
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
        super.dispose();
    }

    private toggleChannelEnabled(channelId: PromptChannelId, enabled: boolean): void {
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

    /**
     * 处理预设工具栏动作，拦截 export 以提供「酒馆原生世界书 JSON / 插件预设 JSON」双格式选择。
     */
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

    /**
     * 导入解析后的 JSON 对象（自动嗅探插件预设 JSON 与酒馆原生世界书 JSON）。
     */
    public async importParsedJsonForChannel(
        channelId: PromptChannelId,
        raw: unknown
    ): Promise<void> {
        const meta = PROMPT_CHANNELS.find((c) => c.id === channelId) || PROMPT_CHANNELS[0];
        const controller = this.controllers[channelId];
        const format = detectPromptImportFormat(raw);

        if (format === 'invalid') {
            Toast.show('导入失败：未识别为有效的插件提示词预设或酒馆原生世界书 JSON', {
                level: 'error',
            });
            return;
        }

        if (format === 'plugin-preset') {
            const normalized = normalizePluginPromptChannelPreset(
                raw as Record<string, unknown>,
                `导入${meta.label}预设`
            );
            if (!normalized) {
                Toast.show('导入失败：预设缺少 entries 数组', { level: 'error' });
                return;
            }
            await this.saveNewImportedPreset(
                channelId,
                normalized.name,
                normalized.data.entries
            );
            return;
        }

        // 酒馆原生世界书 JSON：解析全部条目（含分隔线）并打开勾选导入面板
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

                    const updatedPreset: PresetItem<PromptChannelPresetData> = {
                        ...controller.currentPreset.value,
                        data: { entries: structuredClone(mergedEntries) },
                        updatedAt: Date.now(),
                    };
                    settingsStore.savePreset(meta.category, updatedPreset);
                    controller.reloadFromStore();
                    void promptInjector.scheduleSyncToHost();
                    Toast.show(
                        `已向预设「${updatedPreset.name}」追加 ${appended.length} 条世界书条目`,
                        { level: 'success' }
                    );
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
        const meta = PROMPT_CHANNELS.find((c) => c.id === channelId) || PROMPT_CHANNELS[0];
        const controller = this.controllers[channelId];
        const list = controller.fetchPresetsList();
        const existingNames = new Set(list.map((p) => p.name));

        let finalName = (proposedName || '').trim() || `导入${meta.label}预设`;
        if (existingNames.has(finalName)) {
            const negotiated = await ConfirmDialog.prompt({
                title: '导入预设名称冲突',
                message: `已存在同名预设「${finalName}」，请指定新名称:`,
                defaultValue: `${finalName} (导入)`,
                placeholder: '请输入唯一的预设名称',
                validator: (val) =>
                    existingNames.has(val) ? '预设名称已存在，请换一个名称' : null,
            });
            if (!negotiated || !negotiated.trim()) {
                return;
            }
            finalName = negotiated.trim();
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

    private handleImportFile(channelId: PromptChannelId, file: File): void {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result || ''));
                void this.importParsedJsonForChannel(channelId, parsed);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                Toast.show(`解析 JSON 文件失败: ${message}`, { level: 'error' });
            }
        };
        reader.onerror = () => {
            Toast.show('读取导入文件失败', { level: 'error' });
        };
        reader.readAsText(file);
    }

    private updateChannelEntries(
        channelId: PromptChannelId,
        nextEntries: PromptInjectionEntry[]
    ): void {
        const controller = this.controllers[channelId];
        controller.updateDraft('entries', nextEntries);
    }

    /**
     * 构建融合当前四个子页未保存草稿的临时配置快照，使实时预览即时响应编辑。
     */
    public buildPreviewSettingsSnapshot(): DrawAssistantSettings {
        const base = settingsStore.getSettings();
        const mergeCategory = (
            channelId: PromptChannelId,
            category: PresetCategory
        ): PresetItem<PromptChannelPresetData>[] => {
            const list = (base.presets[category] ||
                []) as PresetItem<PromptChannelPresetData>[];
            const ctrl = this.controllers[channelId];
            const activeId = ctrl.activePresetId.value;
            const draft = ctrl.draftConfig.value;
            if (!activeId || !draft) return list;
            return list.map((p) =>
                p.id === activeId ? { ...p, data: draft } : p
            );
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

    private renderChannelPanel(meta: PromptChannelMeta): VNode {
        const controller = this.controllers[meta.id];
        const entries: PromptInjectionEntry[] = Array.isArray(
            controller.draftConfig.value?.entries
        )
            ? controller.draftConfig.value.entries
            : [];
        const isChannelEnabled = Boolean(this.promptInjectionSignal.value?.[meta.id]?.enabled);

        return (
            <div className="da-prompts-channel-workspace">
                {!isChannelEnabled && (
                    <div className="da-channel-disabled-banner">
                        <span>
                            当前「{meta.label}」通道未开启注入（可在「启用设置」或此处直接开启）
                        </span>
                        <button
                            type="button"
                            className="da-btn da-btn--sm da-btn--secondary"
                            onClick={() => this.toggleChannelEnabled(meta.id, true)}
                        >
                            立即开启
                        </button>
                    </div>
                )}
                <div className="da-prompts-preset-bar">
                    <PresetToolbarView
                        presets={controller.toolbarItems.value}
                        activePresetId={controller.activePresetId.value}
                        dirty={controller.isDirty.value}
                        onAction={(action, id) =>
                            this.handleToolbarAction(meta.id, action, id)
                        }
                        onImportFile={(file) => this.handleImportFile(meta.id, file)}
                    />
                </div>
                <CardView className="da-prompt-channel-card">
                    <PromptEntriesManager
                        key={meta.id}
                        entries={entries}
                        channelId={meta.id}
                        onChange={(next) => this.updateChannelEntries(meta.id, next)}
                    />
                </CardView>
            </div>
        );
    }

    protected renderContent(): VNode {
        const currentTab = this.subTab.value;

        return (
            <div className="da-prompts-view-container">
                {/* 顶部大号 5 子页 TabPage 切换 */}
                <div className="da-subtab-nav-bar">
                    <SegmentedControlView
                        size="lg"
                        value={currentTab}
                        options={[
                            ...PROMPT_CHANNELS.map((c) => ({ label: c.label, value: c.id })),
                            { label: '启用设置', value: 'preview' },
                        ]}
                        onChange={(val) => {
                            this.subTab.value = val as PromptsSubTabId;
                        }}
                    />
                </div>

                {currentTab === 'preview' ? (
                    <PromptsPreviewPanel
                        injectionConfig={this.promptInjectionSignal.value}
                        getSettingsSnapshot={() => this.buildPreviewSettingsSnapshot()}
                        onToggleChannel={(channelId, enabled) => {
                            this.toggleChannelEnabled(channelId, enabled);
                        }}
                        onSelectChannelPreset={(channelId, presetId) =>
                            this.controllers[channelId].handleAction('select', presetId)
                        }
                    />
                ) : (
                    this.renderChannelPanel(
                        PROMPT_CHANNELS.find((c) => c.id === currentTab) || PROMPT_CHANNELS[0]
                    )
                )}
            </div>
        );
    }
}
