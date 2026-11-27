/**
 * 悬浮球快捷面板 - 提示词注入管理页 (`prompts`)。
 */

import type { VNode } from 'preact';
import type { ActivationTriggerMode, PromptChannelPresetData } from '@types';
import { PROMPT_CHANNELS } from '../../state/prompts-state';
import {
    SwitchControl,
    SelectControl,
    SegmentedControlView,
} from '../../framework';
import { QuickSection, QuickFormRow, type QuickPanelSubViewProps } from './quick-shared';

export interface QuickPromptsTabProps extends QuickPanelSubViewProps {
    readonly onPositionChange: () => void;
}

export function QuickPromptsTab(props: QuickPromptsTabProps): VNode {
    const { state, settings: s, onPositionChange } = props;
    const inj = s.promptInjection || {
        story: { enabled: true, activePresetId: '' },
        vocab: { enabled: false, activePresetId: '' },
        character: { enabled: false, activePresetId: '' },
        material: { enabled: false, activePresetId: '', hideWhenEmpty: true },
    };
    const expandedMap = state.expandedPromptChannels.value;

    return (
        <div className="da-fqp-tab-content" data-tab="prompts">
            <QuickSection title="提示词通道启用">
                {PROMPT_CHANNELS.map((ch) => {
                    const chCfg = inj[ch.id];
                    const isEnabled = Boolean(chCfg?.enabled);
                    const categoryKey = ch.category as
                        | 'prompt_story'
                        | 'prompt_vocab'
                        | 'prompt_character'
                        | 'prompt_material';
                    const list =
                        (s.presets?.[categoryKey] as
                            | Array<{
                                  id: string;
                                  name: string;
                                  data: PromptChannelPresetData;
                              }>
                            | undefined) || [];
                    const rawActiveId = chCfg?.activePresetId || '';
                    const activeId = list.some((p) => p.id === rawActiveId)
                        ? rawActiveId
                        : (list[0]?.id ?? '');

                    return (
                        <div key={ch.id} className="da-fqp-channel-row">
                            <div className="da-fqp-channel-row__left">
                                <span
                                    className={`da-channel-status-dot ${
                                        isEnabled ? 'dot--green' : 'dot--gray'
                                    }`}
                                />
                                <span className="da-fqp-row__label">{ch.label}</span>
                            </div>
                            <div className="da-fqp-channel-row__right">
                                <div className="da-fqp-channel-select">
                                    <SelectControl
                                        value={activeId}
                                        disabled={list.length === 0}
                                        options={
                                            list.length === 0
                                                ? [{ label: '暂无预设', value: '' }]
                                                : list.map((p) => ({
                                                      label: p.name,
                                                      value: p.id,
                                                  }))
                                        }
                                        onChange={(val) =>
                                            state.updatePromptChannel(ch.id, {
                                                activePresetId: val,
                                            })
                                        }
                                    />
                                </div>
                                <SwitchControl
                                    value={isEnabled}
                                    onChange={(val) =>
                                        state.updatePromptChannel(ch.id, { enabled: val })
                                    }
                                />
                            </div>
                        </div>
                    );
                })}

                <QuickFormRow label="无有效素材时，跳过素材注入">
                    <SwitchControl
                        value={inj.material?.hideWhenEmpty !== false}
                        onChange={(val) =>
                            state.updatePromptChannel('material', { hideWhenEmpty: val })
                        }
                    />
                </QuickFormRow>
            </QuickSection>

            <QuickSection title="通道词条控制" hint="点击通道栏展开或折叠">
                {PROMPT_CHANNELS.map((ch) => {
                    const categoryKey = ch.category as
                        | 'prompt_story'
                        | 'prompt_vocab'
                        | 'prompt_character'
                        | 'prompt_material';
                    const list =
                        (s.presets?.[categoryKey] as
                            | Array<{
                                  id: string;
                                  name: string;
                                  data: PromptChannelPresetData;
                              }>
                            | undefined) || [];
                    const rawActiveId = inj[ch.id]?.activePresetId || '';
                    const activePreset =
                        list.find((p) => p.id === rawActiveId) || list[0];
                    const entries = activePreset?.data?.entries || [];
                    const isExpanded = Boolean(expandedMap[ch.id]);
                    const enabledCount = entries.filter((e) => e.enabled !== false).length;

                    return (
                        <div
                            key={ch.id}
                            className={`da-fqp-collapse${isExpanded ? ' is-open' : ''}`}
                        >
                            <button
                                type="button"
                                className="da-fqp-collapse__header"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    state.togglePromptChannelExpanded(ch.id);
                                    onPositionChange();
                                }}
                            >
                                <span className="da-fqp-collapse__title">
                                    {ch.label} · {activePreset?.name || '未选择'}
                                </span>
                                <span className="da-fqp-collapse__meta">
                                    {enabledCount}/{entries.length}{' '}
                                    {isExpanded ? '▾' : '▸'}
                                </span>
                            </button>
                            {isExpanded && (
                                <div className="da-fqp-collapse__body">
                                    {entries.length === 0 ? (
                                        <div className="da-fqp-empty">当前预设暂无词条</div>
                                    ) : (
                                        entries.map((entry) => (
                                            <div
                                                key={entry.id}
                                                className="da-fqp-item-row"
                                            >
                                                <div className="da-fqp-item-row__left">
                                                    <SwitchControl
                                                        value={entry.enabled !== false}
                                                        onChange={(val) =>
                                                            activePreset &&
                                                            state.updatePromptChannelEntry(
                                                                categoryKey,
                                                                activePreset.id,
                                                                entry.id,
                                                                { enabled: val }
                                                            )
                                                        }
                                                    />
                                                    <span
                                                        className="da-fqp-item-row__name"
                                                        title={entry.name}
                                                    >
                                                        {entry.name}
                                                    </span>
                                                </div>
                                                <div className="da-fqp-item-row__right">
                                                    <SegmentedControlView
                                                        value={
                                                            entry.triggerMode || 'always'
                                                        }
                                                        options={[
                                                            {
                                                                label: '常驻',
                                                                value: 'always',
                                                            },
                                                            {
                                                                label: '关键词',
                                                                value: 'keyword',
                                                            },
                                                        ]}
                                                        onChange={(val) =>
                                                            activePreset &&
                                                            state.updatePromptChannelEntry(
                                                                categoryKey,
                                                                activePreset.id,
                                                                entry.id,
                                                                {
                                                                    triggerMode:
                                                                        val as ActivationTriggerMode,
                                                                }
                                                            )
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </QuickSection>
        </div>
    );
}
