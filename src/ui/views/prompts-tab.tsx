/**
 * 提示词选项卡视图 (PromptsTabView)。
 *
 * @remarks
 * 组织四大提示词注入通道与启用设置面板：
 * 1. 故事插画 (`story`)：场景捕捉、视觉推演与标签组装规范条目；
 * 2. 素材创作 (`character`)：角色设定扩写与服装/档案排版规范条目；
 * 3. 词汇指导 (`vocab`)：常驻基础词汇与条件触发标签条目；
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
import { PromptsPreviewPanel } from './prompts-preview-panel';
import { PresetController } from '../viewmodels';
import { settingsStore, type DrawAssistantSettings } from '../../store/settings-store';
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

interface ChannelMeta {
    readonly id: PromptChannelId;
    readonly category: PresetCategory;
    readonly label: string;
    readonly defaultDepth: number;
    readonly defaultOrder: number;
}

const PROMPT_CHANNELS: readonly ChannelMeta[] = [
    {
        id: 'story',
        category: 'prompt_story',
        label: '故事插画',
        defaultDepth: 0,
        defaultOrder: 10,
    },
    {
        id: 'vocab',
        category: 'prompt_vocab',
        label: '词汇指导',
        defaultDepth: 7,
        defaultOrder: 200,
    },
    {
        id: 'character',
        category: 'prompt_character',
        label: '素材创作',
        defaultDepth: 0,
        defaultOrder: 20,
    },
    {
        id: 'material',
        category: 'prompt_material',
        label: '素材注入',
        defaultDepth: 0,
        defaultOrder: 1,
    },
];

function createDefaultEntryForChannel(
    channelId: PromptChannelId,
    index: number
): PromptInjectionEntry {
    const meta = PROMPT_CHANNELS.find((c) => c.id === channelId) || PROMPT_CHANNELS[0];
    let entryName = `${meta.label}条目 #${index + 1}`;
    let content = '';

    if (channelId === 'material') {
        if (index === 0) {
            entryName = '核心|生图素材库';
            content =
                '<image_database>\n  <character_database>\n    {{角色启用列表}}\n  </character_database>\n\n  <outfit_database>\n    {{服装启用列表}}\n  </outfit_database>\n</image_database>';
        } else {
            entryName = '核心|生图宏指令';
            content =
                '<drawing_macro_instruction>\n在生成 <image> 提示词时，为保持人物与服装的外观一致性，若画面涉及上方 <image_database> 中已登记的人物或服装，必须使用生图宏代替手写外观标签。\n\n执行以下指令：\n\n一、宏优先与部位补充\n1. 优先调用宏：在组织画面时，优先选用下方可用宏列表中的宏（如 $角色名-景别$, $服装名-景别$），确保角色与服装比例协调且特征统一；\n2. 部位变量仅作补充：固定部位变量（如 -features、-hands、-underwear）仅在需要突出特殊生物特征、局部特写或衣物破损褪下时作为后缀追加（格式：$名称-宏-部位$），禁止在常规构图中全手写部位变量替代宏。\n\n二、依据实际着装事实独立调用\n角色宏专注身体外貌，服装宏专注衣着穿戴，两者相互独立，严格根据剧情中人物的实际着装状态分别调用：\n1. 正常穿着：依据当前镜头景别，角色与服装各自选用对应景别的宏（如 $爱丽丝-cowboy$, $学院制服-cowboy$）；\n2. 半裸或战损：角色宏选用对应景别，服装宏根据实际穿戴在身的衣物选用（例如上身微敞仅剩内衣，调用 $角色名-upper$, $服装名-underwear$）；\n3. 纯全裸或沐浴：画面人物处于完全裸体状态时，仅调用角色宏（如 $角色名-full-intimate$ 或配合手写 nude），切勿调用任何服装宏。\n\n三、可用生图宏清单\n1. 角色可用宏：\n{{角色可用宏列表}}\n2. 服装可用宏：\n{{服装可用宏列表}}\n\n四、固定部位变量速查（仅作后缀补充）\n- 角色部位（13项）：appearance(体态肤色), hair(发型发色), face(五官瞳色), features(生物特征), accessories(随身配饰), chest(胸部特征), upper_body(肩颈上躯), waist(腰腹), hips(臀胯), hands(双手), legs(双腿), feet(双足), privates(生殖性征)\n- 服装部位（9项）：style(整体风格), headwear(头饰), top(上装), bottom(裙裤), handwear(手套腕饰), socks(袜类), shoes(鞋靴), accessories(服饰配件), underwear(贴身内衣裤)\n\n五、标准宏调用响应范例\n\n范例一（单人日常中景：角色与服装同景别常规穿戴）：\n爱丽丝穿着精致的学院制服迎面走来，身后的白色羽翼轻快舒展，双手端着书本躬身行礼。\n<image>image###1girl, solo, $爱丽丝-cowboy-features$, $学院制服-cowboy$, holding_book, bowing, gentle_smile, looking_at_viewer, cowboy_shot, indoor, hallway, warm_lighting###</image>\n\n范例二（单人室内半身：解衣状态，服装宏仅调用贴身内衣）：\n深夜卧室中，爱丽丝解开了制服上衣扣子，文胸肩带滑落，脸颊泛红地轻咬下唇看向你。\n<image>image###1girl, solo, $爱丽丝-upper$, $学院制服-underwear$, clothes_unbuttoned, off_shoulder, bare_shoulders, blush, biting_lip, parted_lips, looking_at_viewer, upper_body, night, bedroom, dim_lighting###</image>\n\n范例三（单人纯全裸浴室特写：仅调用角色宏，绝不调用服装宏）：\n温泉雾气弥漫中，爱丽丝坐在池边轻抚长发，肌肤泛着温热的水汽。\n<image>image###1girl, solo, $爱丽丝-full-intimate$, nude, sitting, touching_hair, gentle_smile, looking_at_viewer, wet_skin, water_drops, steam, onsen, soft_lighting###</image>\n</drawing_macro_instruction>';
        }
    }

    return {
        id: `${channelId}_entry_${Date.now().toString(36)}_${index}`,
        name: entryName,
        enabled: true,
        triggerMode: 'always',
        keywords: '',
        scanDepth: 5,
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
            meta: ChannelMeta
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
            this.controllers[meta.id].reloadFromStore();
        }
        this.promptInjectionSignal.value = settingsStore.get('promptInjection');
        super.activate();
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
    ): Promise<void> {
        const controller = this.controllers[channelId];
        if (action === 'export') {
            const cur = controller.currentPreset.value;
            if (!cur) return;
            const entries = controller.draftConfig.value?.entries || cur.data?.entries || [];
            openPromptExportFormatModal({
                preset: cur,
                entries,
                filenamePrefix: `st-draw-${channelId}-`,
                onExported: onExportedCallback,
            });
            return;
        }
        await controller.handleAction(action, targetId);
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

        const newId = `${meta.category}_${Date.now().toString(36)}`;
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

    private renderChannelPanel(meta: ChannelMeta): VNode {
        const controller = this.controllers[meta.id];
        const entries: PromptInjectionEntry[] = Array.isArray(
            controller.draftConfig.value?.entries
        )
            ? controller.draftConfig.value.entries
            : [];

        return (
            <div className="da-prompts-channel-workspace">
                <div className="da-prompts-preset-bar">
                    <PresetToolbarView
                        presets={controller.toolbarItems.value}
                        activePresetId={controller.activePresetId.value}
                        dirty={controller.isDirty.value}
                        onAction={(action, id) =>
                            void this.handleToolbarAction(meta.id, action, id)
                        }
                        onImportFile={(file) => this.handleImportFile(meta.id, file)}
                    />
                </div>
                <CardView className="da-prompt-channel-card">
                    <PromptEntriesManager
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
                            { label: '故事插画', value: 'story' },
                            { label: '词汇指导', value: 'vocab' },
                            { label: '素材创作', value: 'character' },
                            { label: '素材注入', value: 'material' },
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
                        onSelectChannelPreset={(channelId, presetId) => {
                            const controller = this.controllers[channelId];
                            controller.applyActivePreset(presetId);
                        }}
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
