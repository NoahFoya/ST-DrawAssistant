/**
 * 提示词管理选项卡视图 (PromptsTab)。
 *
 * @remarks
 * 纯声明式 Preact JSX 视图，提示词四通道状态管理、导入导出与预览快照均托管于 `PromptsState`。
 */

import type { VNode } from 'preact';
import type { PromptInjectionEntry } from '@types';
import {
    createPreactSettingsView,
    CardView,
    SegmentedControlView,
    ButtonControl,
    type StatefulSettingsView,
} from '../framework';
import { PresetToolbar, PromptEntriesManager } from '../composite';
import { PromptsPreviewPanel } from './prompts-preview-panel';
import {
    PromptsState,
    PROMPT_CHANNELS,
    type PromptChannelMeta,
    type PromptsSubTabId,
} from '../state/prompts-state';

export type { PromptsSubTabId };

function ChannelWorkspace(props: {
    state: PromptsState;
    meta: PromptChannelMeta;
}): VNode {
    const { state, meta } = props;
    const controller = state.controllers[meta.id];
    const entries: PromptInjectionEntry[] = Array.isArray(controller.draftConfig.value?.entries)
        ? controller.draftConfig.value.entries
        : [];
    const isChannelEnabled = Boolean(state.promptInjectionSignal.value?.[meta.id]?.enabled);

    return (
        <div className="da-prompts-channel-workspace">
            {!isChannelEnabled && (
                <div className="da-channel-disabled-banner">
                    <span>
                        当前「{meta.label}」通道未开启注入（可在「启用设置」或此处直接开启）
                    </span>
                    <ButtonControl
                        label="立即开启"
                        variant="secondary"
                        size="sm"
                        onClick={() => state.toggleChannelEnabled(meta.id, true)}
                    />
                </div>
            )}
            <div className="da-prompts-preset-bar">
                <PresetToolbar
                    presets={controller.toolbarItems.value}
                    activePresetId={controller.activePresetId.value}
                    dirty={controller.isDirty.value}
                    onAction={(action, id) => state.handleToolbarAction(meta.id, action, id)}
                    onImportFiles={(files) => void state.handleImportFiles(meta.id, files)}
                />
            </div>
            <CardView className="da-prompt-channel-card">
                <PromptEntriesManager
                    key={meta.id}
                    entries={entries}
                    channelId={meta.id}
                    onChange={(next) => state.updateChannelEntries(meta.id, next)}
                />
            </CardView>
        </div>
    );
}

export function PromptsTab(props: { state: PromptsState }): VNode {
    const { state } = props;
    const currentTab = state.subTab.value;

    return (
        <div className="da-prompts-view-container">
            <div className="da-subtab-nav-bar">
                <SegmentedControlView
                    size="lg"
                    value={currentTab}
                    options={[
                        ...PROMPT_CHANNELS.map((c) => ({ label: c.label, value: c.id })),
                        { label: '启用设置', value: 'preview' },
                    ]}
                    onChange={(val) => {
                        state.subTab.value = val as PromptsSubTabId;
                    }}
                />
            </div>

            {currentTab === 'preview' ? (
                <PromptsPreviewPanel
                    injectionConfig={state.promptInjectionSignal.value}
                    previewVersion={state.previewVersionSignal.value}
                    getSettingsSnapshot={() => state.buildPreviewSettingsSnapshot()}
                    onToggleChannel={(channelId, enabled) => {
                        state.toggleChannelEnabled(channelId, enabled);
                    }}
                    onToggleMaterialHideWhenEmpty={(hideWhenEmpty) => {
                        state.toggleMaterialHideWhenEmpty(hideWhenEmpty);
                    }}
                    onSelectChannelPreset={(channelId, presetId) =>
                        state.controllers[channelId].handleAction('select', presetId)
                    }
                />
            ) : (
                <ChannelWorkspace
                    state={state}
                    meta={PROMPT_CHANNELS.find((c) => c.id === currentTab) || PROMPT_CHANNELS[0]}
                />
            )}
        </div>
    );
}

export function createPromptsTabView(): StatefulSettingsView<PromptsState> {
    const state = new PromptsState();
    return createPreactSettingsView<PromptsState>({
        id: 'prompts',
        title: '提示词',
        className: 'da-tab-pane da-view-prompts',
        state,
        render: () => <PromptsTab state={state} />,
        onActivate: () => state.activate(),
        onDispose: () => state.dispose(),
        hasUnsavedChanges: () => state.hasUnsavedChanges(),
        saveUnsavedChanges: () => state.saveUnsavedChanges(),
        discardUnsavedChanges: () => state.discardUnsavedChanges(),
    });
}
