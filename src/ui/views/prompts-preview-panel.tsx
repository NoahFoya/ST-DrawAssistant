/**
 * 提示词预设启用设置与实时注入预览面板 (PromptsPreviewPanel)。
 *
 * @remarks
 * 1. 顶部卡片：四大提示词通道集中启用设置与预设切换，附带命中统计徽标；
 * 2. 核心卡片：发送给 AI 的注入段落（按注入时序排列，清晰标明来源，支持一键复制）；
 * 3. 底部卡片：素材启用列表渲染检视（折叠抽屉，按需展开排查）。
 */

import { type VNode } from 'preact';
import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import type { PromptChannelId, PresetCategory, PromptInjectionConfig } from '@types';
import { CardView, BadgeView, ButtonControl, SwitchControl, SelectControl } from '../framework';
import { computePromptInjections } from '../../pipeline/prompt-injector';
import { settingsStore, type DrawAssistantSettings } from '../../store/settings-store';
import { Toast } from '../feedback/toast';

import {
    PROMPT_CHANNELS,
    type PromptChannelMeta,
} from '../state/prompts-state';

export { PROMPT_CHANNELS, type PromptChannelMeta };

const CHANNEL_LABEL_MAP: Record<PromptChannelId, string> = Object.fromEntries(
    PROMPT_CHANNELS.map((c) => [c.id, c.label])
) as Record<PromptChannelId, string>;

const POSITION_LABEL_MAP: Record<number, string> = {
    2: '角色定义前 (↑ Char)',
    0: '角色定义后 (↓ Char)',
};

const ROLE_LABEL_MAP: Record<number, string> = {
    0: '系统',
    1: '用户',
    2: 'AI',
};

function handleActivationKeyDown(e: KeyboardEvent, onTrigger: () => void): void {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onTrigger();
    }
}

export interface PromptsPreviewPanelProps {
    readonly injectionConfig?: PromptInjectionConfig;
    readonly previewVersion?: number;
    readonly getSettingsSnapshot?: () => DrawAssistantSettings;
    readonly onToggleChannel?: (channelId: PromptChannelId, enabled: boolean) => void;
    readonly onToggleMaterialHideWhenEmpty?: (hideWhenEmpty: boolean) => void;
    readonly onSelectChannelPreset?: (
        channelId: PromptChannelId,
        presetId: string
    ) => boolean | void | Promise<boolean | void>;
}

export function PromptsPreviewPanel(props: PromptsPreviewPanelProps): VNode {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [isMaterialInspectOpen, setIsMaterialInspectOpen] = useState(false);
    const [collapsedBuckets, setCollapsedBuckets] = useState<Record<string, boolean>>({});
    const [expandedEntryKeys, setExpandedEntryKeys] = useState<Record<string, boolean>>({});
    const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (copyTimerRef.current) {
                clearTimeout(copyTimerRef.current);
                copyTimerRef.current = null;
            }
        };
    }, []);

    // 获取当前配置快照（优先读取草稿快照，缺省读取 settingsStore）
    const settings = props.getSettingsSnapshot
        ? props.getSettingsSnapshot()
        : settingsStore.getSettings();

    // 计算实际提示词注入结果（本地折叠/复制交互不重复触发重算）
    const computed = useMemo(
        () =>
            computePromptInjections({
                settings,
                ignoreChannelEnabled: false,
            }),
        [props.injectionConfig, props.getSettingsSnapshot, props.previewVersion]
    );

    // 及时裁剪已不存在的桶/词条折叠状态，防止切预设后状态残留
    useEffect(() => {
        const validBucketKeys = new Set(computed.buckets.map((b) => b.key));
        const validEntryKeys = new Set<string>();
        for (const b of computed.buckets) {
            for (const entry of b.entries) {
                validEntryKeys.add(`${entry.channelId}:${b.key}:${entry.entryId}`);
            }
        }

        setCollapsedBuckets((prev) => {
            const keys = Object.keys(prev);
            if (keys.every((k) => validBucketKeys.has(k))) return prev;
            const next: Record<string, boolean> = {};
            for (const k of keys) {
                if (validBucketKeys.has(k)) next[k] = prev[k];
            }
            return next;
        });

        setExpandedEntryKeys((prev) => {
            const keys = Object.keys(prev);
            if (keys.every((k) => validEntryKeys.has(k))) return prev;
            const next: Record<string, boolean> = {};
            for (const k of keys) {
                if (validEntryKeys.has(k)) next[k] = prev[k];
            }
            return next;
        });
    }, [computed]);

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
                if (copyTimerRef.current) {
                    clearTimeout(copyTimerRef.current);
                }
                copyTimerRef.current = setTimeout(() => {
                    copyTimerRef.current = null;
                    setCopiedKey(null);
                }, 2000);
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

    return (
        <div className="da-prompts-preview-panel">
            {/* 最上方卡片：4 通道统一启用设置 */}
            <CardView
                title="提示词启用设置"
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
                    {PROMPT_CHANNELS.map((c) => {
                        const channelCfg = injectionConfig[c.id];
                        const isEnabled = Boolean(channelCfg?.enabled);
                        const presets = getChannelPresets(c.category);
                        const rawActiveId = (channelCfg?.activePresetId || '').trim();
                        const hasMatched = Boolean(
                            rawActiveId && presets.some((p) => p.id === rawActiveId)
                        );
                        const isDanglingId = Boolean(rawActiveId && !hasMatched);
                        const currentActiveId =
                            presets.length === 0
                                ? rawActiveId
                                : hasMatched
                                  ? rawActiveId
                                  : isDanglingId
                                    ? rawActiveId
                                    : presets[0].id;
                        const selectOptions =
                            presets.length === 0
                                ? [
                                      {
                                          label: rawActiveId || '暂无可用预设',
                                          value: rawActiveId,
                                      },
                                  ]
                                : [
                                      ...(isDanglingId
                                          ? [
                                                {
                                                    label: rawActiveId,
                                                    value: rawActiveId,
                                                },
                                            ]
                                          : []),
                                      ...presets.map((p) => ({
                                          label: p.name,
                                          value: p.id,
                                      })),
                                  ];

                        return (
                            <div
                                key={c.id}
                                className={`da-channel-item-wrap ${
                                    isEnabled ? 'is-enabled' : 'is-inactive'
                                }`}
                            >
                                <div
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
                                                disabled={presets.length === 0}
                                                invalid={isDanglingId}
                                                tooltip={
                                                    isDanglingId
                                                        ? `关联的通道预设不存在或已失效 (ID: ${rawActiveId})，请重新选择预设`
                                                        : undefined
                                                }
                                                options={selectOptions}
                                                onChange={(newId) =>
                                                    props.onSelectChannelPreset?.(c.id, newId)
                                                }
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

                                {c.id === 'material' && (
                                    <div className="da-channel-suboption-row">
                                        <div className="da-channel-suboption-info">
                                            <span className="da-channel-suboption-text">
                                                无有效素材时，跳过素材注入
                                            </span>
                                            <span
                                                className="da-help-icon"
                                                data-tooltip="开启后，若当前上下文未命中任何有效角色或服装档案，将整体跳过「素材注入」通道，避免向模型注入空列表或无关宏指令。"
                                                role="button"
                                                tabIndex={0}
                                                aria-label="无有效素材时，跳过素材注入说明"
                                            >
                                                ?
                                            </span>
                                        </div>
                                        <div className="da-channel-enable-toggle">
                                            <SwitchControl
                                                value={channelCfg?.hideWhenEmpty !== false}
                                                onChange={(checked) =>
                                                    props.onToggleMaterialHideWhenEmpty?.(checked)
                                                }
                                            />
                                        </div>
                                    </div>
                                )}
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
                    <div className="da-preview-actions-group">
                        {computed.buckets.length > 0 && (
                            <ButtonControl
                                label={
                                    computed.buckets.every((b) => Boolean(collapsedBuckets[b.key]))
                                        ? '展开全部深度'
                                        : '折叠全部深度'
                                }
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                    const allCollapsed = computed.buckets.every((b) =>
                                        Boolean(collapsedBuckets[b.key])
                                    );
                                    const next: Record<string, boolean> = {};
                                    if (!allCollapsed) {
                                        for (const b of computed.buckets) {
                                            next[b.key] = true;
                                        }
                                    }
                                    setCollapsedBuckets(next);
                                }}
                            />
                        )}
                        <ButtonControl
                            label={copiedKey === 'all' ? '已复制全部' : '复制全部段落'}
                            variant="secondary"
                            size="sm"
                            disabled={computed.buckets.length === 0}
                            onClick={handleCopyAll}
                        />
                    </div>
                }
            >
                {computed.buckets.length === 0 ? (
                    <div className="da-empty-hint">
                        当前暂无有效注入段落（预设已停用或未命中关键词）。
                    </div>
                ) : (
                    <div className="da-injection-paragraphs-list">
                        {computed.buckets.map((bucket) => {
                            const isCollapsed = Boolean(collapsedBuckets[bucket.key]);
                            const posText =
                                bucket.position === 1
                                    ? `聊天深度 @D: ${bucket.depth}`
                                    : POSITION_LABEL_MAP[bucket.position] || '角色定义后 (↓ Char)';
                            const roleText = ROLE_LABEL_MAP[bucket.role] || ROLE_LABEL_MAP[0];
                            const toggleBucket = () =>
                                setCollapsedBuckets((prev) => ({
                                    ...prev,
                                    [bucket.key]: !prev[bucket.key],
                                }));

                            return (
                                <div key={bucket.key} className="da-timeline-block-wrapper">
                                    <div className="da-paragraph-block">
                                        <div
                                            className="da-paragraph-block__header da-paragraph-block__header--clickable"
                                            role="button"
                                            tabIndex={0}
                                            aria-expanded={!isCollapsed}
                                            onClick={toggleBucket}
                                            onKeyDown={(e) =>
                                                handleActivationKeyDown(
                                                    e as unknown as KeyboardEvent,
                                                    toggleBucket
                                                )
                                            }
                                        >
                                            <div className="da-paragraph-block__tags">
                                                <span
                                                    className="da-paragraph-caret"
                                                    aria-hidden="true"
                                                >
                                                    {isCollapsed ? '▸' : '▾'}
                                                </span>
                                                <span className="da-paragraph-badge da-paragraph-badge--pos">
                                                    {posText}
                                                </span>
                                                <span className="da-paragraph-badge da-paragraph-badge--role">
                                                    {roleText}
                                                </span>
                                                <span
                                                    className="da-paragraph-desc"
                                                    title={bucket.entries
                                                        .map((e) => e.entryName)
                                                        .join(' · ')}
                                                >
                                                    ({bucket.entries.length} 条条目)
                                                </span>
                                            </div>
                                            <ButtonControl
                                                size="sm"
                                                variant="secondary"
                                                label={copiedKey === bucket.key ? '已复制' : '复制'}
                                                tooltip="复制此段落"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleCopyText(bucket.key, bucket.content);
                                                }}
                                            />
                                        </div>

                                        {!isCollapsed && (
                                            <>
                                                <div className="da-paragraph-triggered-list">
                                                    {bucket.entries.map((entry) => {
                                                        const entryKey = `${entry.channelId}:${bucket.key}:${entry.entryId}`;
                                                        const isEntryOpen = Boolean(
                                                            expandedEntryKeys[entryKey]
                                                        );
                                                        const isKeywordMode =
                                                            entry.triggerMode === 'keyword';
                                                        const kwText =
                                                            entry.matchedKeywords &&
                                                            entry.matchedKeywords.length > 0
                                                                ? entry.matchedKeywords.join('、')
                                                                : '关键词命中';
                                                        const toggleEntry = () =>
                                                            setExpandedEntryKeys((prev) => ({
                                                                ...prev,
                                                                [entryKey]: !prev[entryKey],
                                                            }));

                                                        return (
                                                            <div
                                                                key={entryKey}
                                                                className="da-triggered-entry-item"
                                                            >
                                                                <div
                                                                    className="da-triggered-entry-row"
                                                                    role="button"
                                                                    tabIndex={0}
                                                                    aria-expanded={isEntryOpen}
                                                                    onClick={toggleEntry}
                                                                    onKeyDown={(e) =>
                                                                        handleActivationKeyDown(
                                                                            e as unknown as KeyboardEvent,
                                                                            toggleEntry
                                                                        )
                                                                    }
                                                                >
                                                                    <span className="da-triggered-entry-caret">
                                                                        {isEntryOpen ? '▾' : '▸'}
                                                                    </span>
                                                                    <span className="da-triggered-channel-tag">
                                                                        {
                                                                            CHANNEL_LABEL_MAP[
                                                                                entry.channelId
                                                                            ]
                                                                        }
                                                                    </span>
                                                                    <span className="da-triggered-entry-name">
                                                                        {entry.entryName}
                                                                    </span>
                                                                    <span
                                                                        className={`da-trigger-reason-badge ${
                                                                            isKeywordMode
                                                                                ? 'da-trigger-reason-badge--kw'
                                                                                : 'da-trigger-reason-badge--always'
                                                                        }`}
                                                                        title={
                                                                            isKeywordMode
                                                                                ? `命中关键词: ${kwText}`
                                                                                : '常驻条目（每轮必注入）'
                                                                        }
                                                                    >
                                                                        {isKeywordMode
                                                                            ? `关键词: ${kwText}`
                                                                            : '常驻'}
                                                                    </span>
                                                                    <span className="da-triggered-entry-order">
                                                                        #{entry.order}
                                                                    </span>
                                                                </div>
                                                                {isEntryOpen && (
                                                                    <pre className="da-triggered-entry-pre">
                                                                        {entry.renderedContent}
                                                                    </pre>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <pre className="da-paragraph-code">
                                                    {bucket.content}
                                                </pre>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardView>

            {/* 底部次要卡片：素材启用列表渲染检视（默认折叠抽屉） */}
            <CardView className="da-material-inspect-accordion">
                <div
                    className="da-material-inspect-accordion__header"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isMaterialInspectOpen}
                    onClick={() => setIsMaterialInspectOpen(!isMaterialInspectOpen)}
                    onKeyDown={(e) =>
                        handleActivationKeyDown(e as unknown as KeyboardEvent, () =>
                            setIsMaterialInspectOpen(!isMaterialInspectOpen)
                        )
                    }
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
            </CardView>
        </div>
    );
}
