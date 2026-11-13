/**
 * 提示词预设启用设置与实时注入预览面板 (PromptsPreviewPanel)。
 *
 * @remarks
 * 1. 顶部卡片：四大提示词通道集中启用设置与预设切换，附带命中统计徽标；
 * 2. 核心卡片：发送给 AI 的注入段落（按注入时序排列，清晰标明来源，支持一键复制）；
 * 3. 底部卡片：素材启用列表渲染检视（折叠抽屉，按需展开排查）。
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import type { PromptChannelId, PresetCategory, PromptInjectionConfig } from '@types';
import { CardView, BadgeView, ButtonControl, SwitchControl, SelectControl } from '../framework';
import { computePromptInjections } from '../../pipeline/prompt-injector';
import { settingsStore, type DrawAssistantSettings } from '../../store/settings-store';
import { Toast } from '../feedback/toast';

export interface PromptsPreviewPanelProps {
    readonly injectionConfig?: PromptInjectionConfig;
    readonly getSettingsSnapshot?: () => DrawAssistantSettings;
    readonly onToggleChannel?: (channelId: PromptChannelId, enabled: boolean) => void;
    readonly onSelectChannelPreset?: (channelId: PromptChannelId, presetId: string) => void;
}

export function PromptsPreviewPanel(props: PromptsPreviewPanelProps): VNode {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [isMaterialInspectOpen, setIsMaterialInspectOpen] = useState(false);

    // 获取当前配置快照（优先读取草稿快照，缺省读取 settingsStore）
    const settings = props.getSettingsSnapshot
        ? props.getSettingsSnapshot()
        : settingsStore.getSettings();

    // 计算实际提示词注入结果（直接基于真实会话上下文计算，无需模拟输入）
    const computed = computePromptInjections({
        settings,
        ignoreChannelEnabled: false,
    });

    const injectionConfig =
        props.injectionConfig ||
        settings.promptInjection || {
            story: { enabled: true, activePresetId: '' },
            character: { enabled: false, activePresetId: '' },
            vocab: { enabled: false, activePresetId: '' },
            material: { enabled: false, activePresetId: '' },
        };

    const handleCopyText = async (key: string, text: string) => {
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                setCopiedKey(key);
                setTimeout(() => setCopiedKey(null), 2000);
                Toast.show('已复制注入段落文本至剪贴板', { level: 'success' });
            }
        } catch {
            Toast.show('复制失败，请手动在文本框中选中复制', { level: 'warning' });
        }
    };

    const handleCopyAll = async () => {
        const fullText = computed.buckets.map((b) => b.content).join('\n\n');
        if (!fullText) {
            Toast.show('当前无有效注入段落可复制', { level: 'info' });
            return;
        }
        await handleCopyText('all', fullText);
    };

    const getChannelPresets = (category: PresetCategory) => {
        return (settings.presets[category] || []) as Array<{ id: string; name: string }>;
    };

    const channelDefinitions: Array<{
        id: PromptChannelId;
        label: string;
        category: PresetCategory;
        desc: string;
    }> = [
        {
            id: 'story',
            label: '故事插画',
            category: 'prompt_story',
            desc: '默认开启的主通道。四个提示词通道底层共享相同的条目触发、深度与变量插槽机制，拆分为多个分类仅便于整理与独立开关；若你已挂载外部绘画世界书，可直接关闭本通道或自由修改内置预设内容。',
        },
        {
            id: 'vocab',
            label: '词汇指导',
            category: 'prompt_vocab',
            desc: '默认关闭的分类通道，适合存放画风词表、标签参考规范或按关键词触发的词条集合；内置预设可参照自定义修改，也可与其他通道条目合并整理。',
        },
        {
            id: 'character',
            label: '素材创作',
            category: 'prompt_character',
            desc: '默认关闭的分类通道，适合存放用于辅助 AI 梳理人物与服装设定的创作提示词，配合「素材库 → 解析设置」中的起止标记规则进行档案识别与收录。',
        },
        {
            id: 'material',
            label: '素材注入',
            category: 'prompt_material',
            desc: '默认关闭的分类通道，适合挂载 {{角色启用列表}}、{{服装启用列表}}、{{角色可用宏列表}} 与 {{服装可用宏列表}} 等动态变量插槽，将已激活的素材规则注入上下文（也可按习惯写进其他开启的通道中）。',
        },
    ];

    return (
        <div className="da-prompts-preview-panel">
            {/* 最上方卡片：4 通道统一启用设置 */}
            <CardView
                title="提示词预设启用"
                actions={
                    <div className="da-preview-summary-badges">
                        <BadgeView
                            text={`注入: ${computed.buckets.length} 段落`}
                            variant="primary"
                        />
                        <BadgeView
                            text={`命中: ${computed.matchedEntries.length} 条词条`}
                            variant="success"
                        />
                    </div>
                }
            >
                <div className="da-channel-enable-list">
                    {channelDefinitions.map((c) => {
                        const channelCfg = injectionConfig[c.id];
                        const isEnabled = Boolean(channelCfg?.enabled);
                        const presets = getChannelPresets(c.category);
                        const currentActiveId =
                            channelCfg?.activePresetId || presets[0]?.id || '';

                        return (
                            <div
                                key={c.id}
                                className={`da-channel-form-row ${
                                    isEnabled ? 'is-enabled' : 'is-inactive'
                                }`}
                            >
                                <div className="da-channel-info-group">
                                    <span
                                        className={`da-channel-status-dot ${
                                            isEnabled ? 'dot--green' : 'dot--gray'
                                        }`}
                                    />
                                    <span className="da-channel-title">
                                        {c.label}
                                    </span>
                                    <span
                                        className="da-help-icon"
                                        data-tooltip={c.desc}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={c.desc}
                                    >
                                        ?
                                    </span>
                                </div>

                                <div className="da-channel-controls">
                                    <div className="da-channel-preset-select-wrap">
                                        <SelectControl
                                            className="da-channel-preset-select"
                                            value={currentActiveId}
                                            disabled={presets.length <= 1}
                                            options={presets.map((p) => ({
                                                label: p.name,
                                                value: p.id,
                                            }))}
                                            onChange={(newId) => {
                                                props.onSelectChannelPreset?.(
                                                    c.id,
                                                    newId
                                                );
                                            }}
                                        />
                                    </div>

                                    <div className="da-channel-enable-toggle">
                                        <SwitchControl
                                            value={isEnabled}
                                            onChange={(checked) => {
                                                props.onToggleChannel?.(
                                                    c.id,
                                                    checked
                                                );
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </CardView>

            {/* 核心卡片：发送给 AI 的注入段落 */}
            <CardView
                className="da-card--padded"
                title={`注入段落预览 (${computed.buckets.length})`}
                actions={
                    <ButtonControl
                        label={copiedKey === 'all' ? '✔ 已复制全部' : '📋 复制全部段落'}
                        variant="secondary"
                        size="sm"
                        disabled={computed.buckets.length === 0}
                        onClick={handleCopyAll}
                    />
                }
            >
                {computed.buckets.length === 0 ? (
                    <div className="da-empty-hint">
                        当前暂无有效注入段落（预设已停用或未命中关键词）。
                    </div>
                ) : (
                    <div className="da-injection-paragraphs-list">
                        {computed.buckets.map((bucket) => {
                            const posText =
                                bucket.position === 1
                                    ? `聊天深度 @D: ${bucket.depth}`
                                    : bucket.position === 2
                                      ? '角色定义前 (↑ Char)'
                                      : '角色定义后 (↓ Char)';
                            const roleText =
                                bucket.role === 1
                                    ? '用户 [👤]'
                                    : bucket.role === 2
                                      ? 'AI [🤖]'
                                      : '系统 [⚙]';

                            return (
                                <div key={bucket.key} className="da-timeline-block-wrapper">
                                    <div className="da-paragraph-block">
                                        <div className="da-paragraph-block__header">
                                            <div className="da-paragraph-block__tags">
                                                <span className="da-paragraph-badge da-paragraph-badge--pos">
                                                    {posText}
                                                </span>
                                                <span className="da-paragraph-badge da-paragraph-badge--role">
                                                    {roleText}
                                                </span>
                                                <span
                                                    className="da-paragraph-desc"
                                                    title={bucket.entries.map((e) => e.entryName).join(' · ')}
                                                >
                                                    ({bucket.entries.length} 条条目)
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                className="da-btn da-btn--secondary da-btn--sm"
                                                title="复制此段落"
                                                onClick={() =>
                                                    handleCopyText(bucket.key, bucket.content)
                                                }
                                            >
                                                {copiedKey === bucket.key ? '✔' : '📋'}
                                            </button>
                                        </div>
                                        <pre className="da-paragraph-code">{bucket.content}</pre>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardView>

            {/* 底部次要卡片：素材启用列表渲染检视（默认折叠抽屉） */}
            <div className="da-card da-material-inspect-accordion">
                <div
                    className="da-material-inspect-accordion__header"
                    onClick={() => setIsMaterialInspectOpen(!isMaterialInspectOpen)}
                >
                    <div className="da-material-inspect-accordion__title">
                        <span>{isMaterialInspectOpen ? '▾' : '▸'}</span>
                        <strong>素材变量渲染检视</strong>
                        <span className="da-material-inspect-accordion__hint">
                            (点击{isMaterialInspectOpen ? '收起' : '展开'}查看角色与服装替换文本)
                        </span>
                    </div>
                </div>

                {isMaterialInspectOpen && (
                    <div className="da-material-inspect-accordion__content">
                        <div className="da-material-inspect-grid">
                            <div className="da-material-inspect-col">
                                <div className="da-subsection-header">
                                    <span className="da-subsection-title">
                                        角色启用列表 (命中{' '}
                                        {
                                            computed.materialLists.matchedCharacterNames
                                                .length
                                        }{' '}
                                        个)
                                    </span>
                                </div>
                                <pre className="da-material-inspect-pre">
                                    {computed.materialLists.charactersText ||
                                        '(当前未命中任何角色素材)'}
                                </pre>
                            </div>

                            <div className="da-material-inspect-col">
                                <div className="da-subsection-header">
                                    <span
                                        className="da-subsection-title"
                                        title="通用服装启用列表：列举任意角色均可启用的通用服装；专属服装已在对应角色中绑定展开"
                                    >
                                        服装启用列表 (通用服装，命中{' '}
                                        {
                                            computed.materialLists.matchedOutfitNames
                                                .length
                                        }{' '}
                                        套)
                                    </span>
                                </div>
                                <pre className="da-material-inspect-pre">
                                    {computed.materialLists.outfitsText ||
                                        '(当前未命中任何服装素材)'}
                                </pre>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
