/**
 * 悬浮球快捷设置面板 (FabQuickPanel)。
 *
 * @remarks
 * 采用与主设置窗口一致的规整表单行（左标题 + 右控件：开关 / 下拉框 / 分段选择器 / 步进数值框），
 * 顶部划分为 4 个分页标签页，对应主设置的四大功能模块：
 * 1. 「插件设置」：基础配置、交互与触发、图片显示、存储设置；
 * 2. 「服务设置」：自动跟随当前激活的生图服务，展示生图参数预设、提示词预设及该服务下的模型、工作流、画幅比例与采样控制；
 * 3. 「提示词」：四大通道的预设下拉框与启用开关、无有效素材跳过注入开关，以及可折叠/展开的各通道当前预设词条启停与［常驻｜关键词］切换；
 * 4. 「素材管理」：素材启用预设下拉框、角色卡联动开关与关联角色卡下拉框、角色与通用服装启用列表（启停与［关键词｜常驻］切换）、档案解析与变量宏格式预设及解析开关。
 */

import { render, type ComponentChildren, type VNode } from 'preact';
import { signal } from '@preact/signals';
import type {
    ActivationTriggerMode,
    CharacterPresetData,
    DrawingPresetData,
    ImageDisplayMode,
    ImageStorageQuality,
    MaterialActivationPresetData,
    MaterialExtractionPresetData,
    MaterialFormatPresetData,
    MaterialLibraryConfig,
    OutfitPresetData,
    PromptChannelId,
    PromptChannelPresetData,
    PromptInjectionConfig,
    PromptPresetData,
    ProviderStoredConfig,
    ProviderType,
    ThinkingDisplayMode,
    TransportMode,
    WorkflowPresetData,
} from '@types';
import { EXTENSION_VERSION, PROMPT_POLLING_PRESET_ID } from '../../config/constants';
import { settingsStore, type DrawAssistantSettings } from '../../store/settings-store';
import { promptInjector } from '../../pipeline/prompt-injector';
import { hostRegexService } from '../../pipeline/host-regex-service';
import { DEFAULT_EXTRACTION_CONFIG } from '../../pipeline/archive-extractor';
import {
    matchesOutfitId,
    normalizeCharacterData,
    normalizeOutfitData,
} from '../../pipeline/material-definitions';
import {
    NOVELAI_CUSTOM_SERVICE_ID,
    NOVELAI_IMAGE_HOST,
    NOVELAI_OFFICIAL_SERVICE_ID,
    OFFICIAL_NOVELAI_MODELS,
    formatNovelAIModelLabel,
    resolveNovelAIModelFamily,
    OPENAI_MODEL_OPTIONS,
    isSiliconFlowService,
    resolveOpenAIModelCapabilities,
    GEMINI_API_BASE,
    GEMINI_ASPECT_RATIO_OPTIONS,
    GEMINI_CUSTOM_SERVICE_ID,
    GEMINI_MODEL_OPTIONS,
    GEMINI_OFFICIAL_SERVICE_ID,
    buildGeminiImageSizeOptions,
    resolveGeminiModelCapabilities,
    GROK_API_BASE,
    GROK_ASPECT_RATIO_OPTIONS,
    GROK_CUSTOM_SERVICE_ID,
    GROK_MODEL_OPTIONS,
    GROK_OFFICIAL_SERVICE_ID,
    GROK_RESOLUTIONS,
    resolveGrokModelCapabilities,
    DEFAULT_ASPECT_RATIOS,
    OPENAI_ASPECT_RATIOS,
    GPT_IMAGE_ASPECT_RATIOS,
} from '../../domain';
import {
    SwitchControl,
    SelectControl,
    SearchableSelectControl,
    SegmentedControlView,
    NumberInputControl,
} from '../framework';
import type { SelectOption } from '../components/select';
import {
    applyPrimaryBoundCardSelection,
    getHostCharacterCards,
    parseBoundCardNamesInput,
    splitBoundCardNames,
} from '../views/materials/material-types';
import { renderIcon } from '../components/icons';
import { overlayStack } from '../framework/overlay-stack';
import { computeAnchoredPosition, getViewportRect, viewportService } from '../layout/viewport';
import { eventBus } from '../../util/event-bus';
import { detectHostRuntime, TRANSPORT_MODE_OPTIONS } from '../../util/http-client';
import { TauriRelayNotice } from '../components';
import type { Disposable } from '../types';

export type QuickPanelTabId = 'general' | 'provider' | 'prompts' | 'materials';

export interface FabQuickPanelOptions {
    /** 锚定的悬浮球 DOM 元素 */
    readonly anchorElement: HTMLElement;
    /** 点击「主设置」按钮触发打开主设置弹窗回调 */
    readonly onOpenMainSettings?: () => void;
}

const PROVIDER_SELECT_OPTIONS: ReadonlyArray<SelectOption> = [
    { label: 'ComfyUI', value: 'comfyui' },
    { label: 'SD-WebUI / Forge', value: 'sdwebui' },
    { label: 'NovelAI', value: 'novelai' },
    { label: 'OpenAI 兼容', value: 'openai' },
    { label: 'Google Gemini', value: 'gemini' },
    { label: 'xAI Grok', value: 'grok' },
];

const COMFY_DEFAULT_SAMPLERS: ReadonlyArray<SelectOption> = [
    { label: 'euler', value: 'euler' },
    { label: 'euler_ancestral', value: 'euler_ancestral' },
    { label: 'dpmpp_2m', value: 'dpmpp_2m' },
    { label: 'dpmpp_2m_sde', value: 'dpmpp_2m_sde' },
    { label: 'dpmpp_sde', value: 'dpmpp_sde' },
    { label: 'uni_pc', value: 'uni_pc' },
    { label: 'ddim', value: 'ddim' },
];

const COMFY_DEFAULT_SCHEDULERS: ReadonlyArray<SelectOption> = [
    { label: 'normal', value: 'normal' },
    { label: 'karras', value: 'karras' },
    { label: 'exponential', value: 'exponential' },
    { label: 'sgm_uniform', value: 'sgm_uniform' },
    { label: 'simple', value: 'simple' },
    { label: 'ddim_uniform', value: 'ddim_uniform' },
    { label: 'beta', value: 'beta' },
];

const SDWEBUI_DEFAULT_SAMPLERS: ReadonlyArray<SelectOption> = [
    { label: 'DPM++ 2M Karras', value: 'DPM++ 2M Karras' },
    { label: 'DPM++ SDE Karras', value: 'DPM++ SDE Karras' },
    { label: 'DPM++ 2S a Karras', value: 'DPM++ 2S a Karras' },
    { label: 'Euler a', value: 'Euler a' },
    { label: 'Euler', value: 'Euler' },
    { label: 'DDIM', value: 'DDIM' },
    { label: 'UniPC', value: 'UniPC' },
];

const SDWEBUI_DEFAULT_SCHEDULERS: ReadonlyArray<SelectOption> = [
    { label: 'Automatic', value: 'Automatic' },
    { label: 'Karras', value: 'Karras' },
    { label: 'Exponential', value: 'Exponential' },
    { label: 'Polyexponential', value: 'Polyexponential' },
    { label: 'SGM Uniform', value: 'SGM Uniform' },
];

const HIRES_UPSCALER_OPTIONS: ReadonlyArray<SelectOption> = [
    { label: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
    { label: 'R-ESRGAN 4x+', value: 'R-ESRGAN 4x+' },
    { label: 'Latent', value: 'Latent' },
    { label: 'Latent (antialiased)', value: 'Latent (antialiased)' },
    { label: 'Latent (bicubic)', value: 'Latent (bicubic)' },
    { label: '4x-UltraSharp', value: '4x-UltraSharp' },
    { label: 'ESRGAN_4x', value: 'ESRGAN_4x' },
];

const NOVELAI_SAMPLER_OPTIONS: ReadonlyArray<SelectOption> = [
    { label: 'k_euler_ancestral', value: 'k_euler_ancestral' },
    { label: 'k_euler', value: 'k_euler' },
    { label: 'k_dpmpp_2s_ancestral', value: 'k_dpmpp_2s_ancestral' },
    { label: 'k_dpmpp_2m', value: 'k_dpmpp_2m' },
    { label: 'k_dpmpp_sde', value: 'k_dpmpp_sde' },
    { label: 'ddim', value: 'ddim' },
];

const NOVELAI_SCHEDULER_OPTIONS: ReadonlyArray<SelectOption> = [
    { label: 'karras (推荐)', value: 'karras' },
    { label: 'native', value: 'native' },
    { label: 'exponential', value: 'exponential' },
    { label: 'polyexponential', value: 'polyexponential' },
];

const SMEA_MODE_OPTIONS: ReadonlyArray<SelectOption> = [
    { label: 'SMEA + DYN (动态增强)', value: 'smea_dyn' },
    { label: 'SMEA (采样增强)', value: 'smea' },
    { label: '关闭', value: 'none' },
];

const PROMPT_CHANNEL_META: ReadonlyArray<{
    id: PromptChannelId;
    category: 'prompt_story' | 'prompt_vocab' | 'prompt_character' | 'prompt_material';
    label: string;
}> = [
    { id: 'story', category: 'prompt_story', label: '故事插画' },
    { id: 'vocab', category: 'prompt_vocab', label: '词汇指导' },
    { id: 'character', category: 'prompt_character', label: '素材创作' },
    { id: 'material', category: 'prompt_material', label: '素材注入' },
];

/** 构建确保包含当前已选值的下拉选项列表 */
function buildSelectOptionsWithCurrent(
    baseOptions: ReadonlyArray<SelectOption>,
    currentVal: string | undefined,
    emptyPlaceholder?: string
): SelectOption[] {
    const list: SelectOption[] = [];
    if (emptyPlaceholder !== undefined) {
        list.push({ label: emptyPlaceholder, value: '' });
    }
    const seen = new Set<string>(list.map((o) => o.value));
    for (const opt of baseOptions) {
        if (!seen.has(opt.value)) {
            seen.add(opt.value);
            list.push({ label: opt.label, value: opt.value });
        }
    }
    const trimmed = (currentVal || '').trim();
    if (trimmed && !seen.has(trimmed)) {
        list.unshift({ label: trimmed, value: trimmed });
    }
    return list;
}

interface QuickSectionProps {
    readonly title: string;
    readonly hint?: string;
    readonly children: ComponentChildren;
}

function QuickSection(props: QuickSectionProps): VNode {
    return (
        <div className="da-fqp-section">
            <div className="da-fqp-section__header">
                <span className="da-fqp-section__title">{props.title}</span>
                {props.hint && <span className="da-fqp-section__hint">{props.hint}</span>}
            </div>
            <div className="da-fqp-section__rows">{props.children}</div>
        </div>
    );
}

interface QuickFormRowProps {
    readonly label: string;
    readonly disabled?: boolean;
    readonly children: ComponentChildren;
}

function QuickFormRow(props: QuickFormRowProps): VNode {
    return (
        <div className={`da-fqp-row${props.disabled ? ' is-disabled' : ''}`}>
            <span className="da-fqp-row__label" title={props.label}>
                {props.label}
            </span>
            <div className="da-fqp-row__control">{props.children}</div>
        </div>
    );
}

export class FabQuickPanel implements Disposable {
    public readonly element: HTMLElement;

    private readonly options: FabQuickPanelOptions;
    private readonly activeTab = signal<QuickPanelTabId>('general');
    private readonly settingsSignal = signal<DrawAssistantSettings>(settingsStore.getSettings());
    private readonly expandedPromptChannels = signal<Record<PromptChannelId, boolean>>({
        story: true,
        vocab: false,
        character: false,
        material: false,
    });
    private readonly rawBoundCardsDraft = signal<{ presetId: string; text: string } | null>(null);

    private isOpenState = false;
    private unlistenSettings: (() => void) | null = null;
    private unbindViewport: (() => void) | null = null;
    private unbindEscape: (() => void) | null = null;

    private readonly onDocumentPointerDownBound: (e: PointerEvent) => void;

    public constructor(options: FabQuickPanelOptions) {
        this.options = options;
        this.element =
            typeof document !== 'undefined'
                ? document.createElement('div')
                : ({} as HTMLElement);

        if (this.element.classList) {
            this.element.className = 'da-fab-quick-panel st-da-root da-hidden';
            this.element.setAttribute('role', 'dialog');
            this.element.setAttribute('aria-label', 'ST-DrawAssistant 快捷设置面板');
        }

        this.onDocumentPointerDownBound = this.onDocumentPointerDown.bind(this);

        this.unlistenSettings = eventBus.on('settings:updated', () => {
            this.settingsSignal.value = settingsStore.getSettings();
            if (this.isOpenState) {
                this.positionPanel();
            }
        });

        this.unbindViewport = viewportService.subscribe(() => {
            if (this.isOpenState) {
                this.positionPanel();
            }
        });

        this.unbindEscape = overlayStack.registerEscapeGuard(() => {
            if (!this.isOpenState) {
                return false;
            }
            this.close();
            return true;
        });

        this.mountPreact();
    }

    public isOpen(): boolean {
        return this.isOpenState;
    }

    public open(): void {
        if (this.isOpenState || typeof document === 'undefined') {
            return;
        }
        this.settingsSignal.value = settingsStore.getSettings();
        this.isOpenState = true;

        if (!this.element.parentElement && document.body) {
            document.body.appendChild(this.element);
        }

        this.element.classList.remove('da-hidden');
        this.mountPreact();
        this.positionPanel();

        document.addEventListener('pointerdown', this.onDocumentPointerDownBound, true);
    }

    public close(): void {
        if (!this.isOpenState) {
            return;
        }
        this.isOpenState = false;
        this.element.classList?.add('da-hidden');
        if (typeof document !== 'undefined') {
            document.removeEventListener('pointerdown', this.onDocumentPointerDownBound, true);
        }
    }

    public toggle(): void {
        if (this.isOpenState) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * 基于悬浮球当前矩形与可视视口动态计算面板停靠位置。
     */
    public positionPanel(): void {
        if (!this.isOpenState || typeof window === 'undefined') {
            return;
        }
        const anchorRect = this.options.anchorElement.getBoundingClientRect?.();
        if (!anchorRect) {
            return;
        }

        const vp = getViewportRect();
        const panelWidth = Math.min(392, Math.max(280, vp.width - 20));
        const measuredHeight = this.element.offsetHeight || 440;
        const anchorCenterX = anchorRect.left + anchorRect.width / 2;
        const isRightHalf = anchorCenterX >= vp.left + vp.width / 2;
        const anchorCenterY = anchorRect.top + anchorRect.height / 2;
        const isBottomHalf = anchorCenterY >= vp.top + vp.height / 2;

        const pos = computeAnchoredPosition({
            anchorRect,
            floatingWidth: panelWidth,
            floatingHeight: Math.min(measuredHeight, 500),
            preferredPlacement: isBottomHalf ? 'top' : 'bottom',
            align: isRightHalf ? 'end' : 'start',
            gap: 10,
            margin: 10,
            viewport: vp,
        });

        this.element.style.width = `${Math.min(panelWidth, pos.maxWidth)}px`;
        this.element.style.maxHeight = `${Math.min(500, Math.max(240, pos.maxHeight))}px`;
        this.element.style.left = `${pos.left}px`;
        this.element.style.top = `${pos.top}px`;
    }

    private onDocumentPointerDown(e: PointerEvent): void {
        if (!this.isOpenState) return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (
            this.element.contains(target) ||
            this.options.anchorElement.contains(target) ||
            target.closest?.('[data-da-floating-popover="true"]')
        ) {
            return;
        }
        this.close();
    }

    private updateActiveDrawingPresetData(
        provider: ProviderType,
        activePresetId: string,
        patch: Partial<DrawingPresetData>
    ): void {
        const preset = settingsStore.getPreset<DrawingPresetData>(
            'drawing',
            activePresetId,
            provider
        );
        if (!preset) return;
        settingsStore.savePreset<DrawingPresetData>(
            'drawing',
            {
                ...preset,
                data: {
                    ...preset.data,
                    ...patch,
                },
                updatedAt: Date.now(),
            },
            provider
        );
    }

    // 1. 插件设置 Tab (基础配置、交互与触发、图片显示与存储设置)
    private renderGeneralTab(s: DrawAssistantSettings): VNode {
        const enabled = s.enabled !== false;
        const activeProvider = (s.activeProvider || 'comfyui') as ProviderType;
        const transport = (s.transport || 'direct') as TransportMode;
        const cancelOnChatChange = s.cancelOnChatChange ?? true;
        const cancelOnSwipe = s.cancelOnSwipe ?? true;
        const autoGenerate = Boolean(s.autoGenerate);
        const hideButtonOnDone = Boolean(s.ui?.floorButton?.hideOnDone);
        const imageActionPanelEnabled = s.ui?.imageActionPanel?.enabled ?? true;
        const lightboxEnabled = s.ui?.lightbox?.enabled ?? true;
        const cleanPrompt = s.cleanPrompt ?? true;
        const cleanPromptPunctuation = s.cleanPromptPunctuation ?? true;
        const normalizeChinesePunctuation = Boolean(s.normalizeChinesePunctuation);
        const thinkingMode: ThinkingDisplayMode = s.thinkingDisplayMode || 'show';
        const cleanHistoryThinking = Boolean(s.cleanHistoryThinking);
        const cleanHistoryMarkup = Boolean(s.cleanHistoryMarkup);

        const img = s.ui?.imageDisplay;
        const align = (img?.align || 'center') as 'center' | 'flex-start' | 'flex-end';
        const objectFit = (img?.objectFit || 'contain') as 'contain' | 'cover' | 'none';
        const rounded = img?.rounded ?? true;
        const displayMode: ImageDisplayMode = img?.displayMode || 'normal';
        const hostRuntime = detectHostRuntime();
        const showTauriRelayNotice = transport === 'relay' && !hostRuntime.supportsRelayProxy;

        const imageQuality = (s.imageQuality || 'original') as ImageStorageQuality;
        const saveToServer = Boolean(s.saveToServer);

        const updateImageDisplay = (patch: Partial<DrawAssistantSettings['ui']['imageDisplay']>) => {
            const curUi = settingsStore.get('ui');
            settingsStore.set('ui', {
                ...curUi,
                imageDisplay: {
                    ...curUi.imageDisplay,
                    ...patch,
                },
            });
        };

        return (
            <div className="da-fqp-tab-content" data-tab="general">
                <QuickSection title="基础配置">
                    <QuickFormRow label="启用插件">
                        <SwitchControl
                            value={enabled}
                            onChange={(val) => {
                                settingsStore.set('enabled', val);
                                void promptInjector.scheduleSyncToHost();
                            }}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="生图服务" disabled={!enabled}>
                        <SelectControl
                            value={activeProvider}
                            disabled={!enabled}
                            options={[...PROVIDER_SELECT_OPTIONS]}
                            onChange={(val) => settingsStore.set('activeProvider', val as ProviderType)}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="连接方式" disabled={!enabled}>
                        <SegmentedControlView
                            value={transport}
                            disabled={!enabled}
                            options={[...TRANSPORT_MODE_OPTIONS]}
                            onChange={(val) => settingsStore.set('transport', val as TransportMode)}
                        />
                    </QuickFormRow>
                    {showTauriRelayNotice && (
                        <TauriRelayNotice
                            compact
                            disabled={!enabled}
                            onSwitchToDirect={() => settingsStore.set('transport', 'direct')}
                        />
                    )}
                    <QuickFormRow label="切换聊天时取消任务" disabled={!enabled}>
                        <SwitchControl
                            value={cancelOnChatChange}
                            disabled={!enabled}
                            onChange={(val) => settingsStore.set('cancelOnChatChange', val)}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="重 roll 时取消旧分支任务" disabled={!enabled}>
                        <SwitchControl
                            value={cancelOnSwipe}
                            disabled={!enabled}
                            onChange={(val) => settingsStore.set('cancelOnSwipe', val)}
                        />
                    </QuickFormRow>
                </QuickSection>

                <QuickSection title="交互与触发">
                    <QuickFormRow label="AI 回复后自动出图" disabled={!enabled}>
                        <SwitchControl
                            value={autoGenerate}
                            disabled={!enabled}
                            onChange={(val) => settingsStore.set('autoGenerate', val)}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="出图后隐藏按钮" disabled={!enabled}>
                        <SwitchControl
                            value={hideButtonOnDone}
                            disabled={!enabled}
                            onChange={(val) => {
                                const curUi = settingsStore.get('ui');
                                settingsStore.set('ui', {
                                    ...curUi,
                                    floorButton: { ...curUi.floorButton, hideOnDone: val },
                                });
                            }}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="图片编辑面板" disabled={!enabled}>
                        <SwitchControl
                            value={imageActionPanelEnabled}
                            disabled={!enabled}
                            onChange={(val) => {
                                const curUi = settingsStore.get('ui');
                                settingsStore.set('ui', {
                                    ...curUi,
                                    imageActionPanel: { ...curUi.imageActionPanel, enabled: val },
                                });
                            }}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="点击查看大图" disabled={!enabled}>
                        <SwitchControl
                            value={lightboxEnabled}
                            disabled={!enabled}
                            onChange={(val) => {
                                const curUi = settingsStore.get('ui');
                                settingsStore.set('ui', {
                                    ...curUi,
                                    lightbox: { ...curUi.lightbox, enabled: val },
                                });
                            }}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="提示词 Tags 自动去重" disabled={!enabled}>
                        <SwitchControl
                            value={cleanPrompt}
                            disabled={!enabled}
                            onChange={(val) => settingsStore.set('cleanPrompt', val)}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="标点与空行自动整理" disabled={!enabled}>
                        <SwitchControl
                            value={cleanPromptPunctuation}
                            disabled={!enabled}
                            onChange={(val) => settingsStore.set('cleanPromptPunctuation', val)}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="中文标点转英文逗号" disabled={!enabled}>
                        <SwitchControl
                            value={normalizeChinesePunctuation}
                            disabled={!enabled}
                            onChange={(val) => settingsStore.set('normalizeChinesePunctuation', val)}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="绘图与设计思考">
                        <SegmentedControlView
                            value={thinkingMode}
                            options={[
                                { label: '显示', value: 'show' },
                                { label: '折叠', value: 'collapse' },
                                { label: '隐藏', value: 'hide' },
                            ]}
                            onChange={(val) => {
                                settingsStore.set('thinkingDisplayMode', val as ThinkingDisplayMode);
                                hostRegexService.syncToHost({ reloadChatOnDisplayChange: true });
                            }}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="清理历史绘图与设计思考">
                        <SwitchControl
                            value={cleanHistoryThinking}
                            onChange={(val) => {
                                settingsStore.set('cleanHistoryThinking', val);
                                hostRegexService.syncToHost();
                            }}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="清理历史生图与档案标记">
                        <SwitchControl
                            value={cleanHistoryMarkup}
                            onChange={(val) => {
                                settingsStore.set('cleanHistoryMarkup', val);
                                hostRegexService.syncToHost();
                            }}
                        />
                    </QuickFormRow>
                </QuickSection>

                <QuickSection title="图片显示">
                    <QuickFormRow label="对齐方式" disabled={!enabled}>
                        <SegmentedControlView
                            value={align}
                            disabled={!enabled}
                            options={[
                                { label: '靠左', value: 'flex-start' },
                                { label: '居中', value: 'center' },
                                { label: '靠右', value: 'flex-end' },
                            ]}
                            onChange={(val) =>
                                updateImageDisplay({ align: val as 'center' | 'flex-start' | 'flex-end' })
                            }
                        />
                    </QuickFormRow>
                    <QuickFormRow label="缩放模式" disabled={!enabled}>
                        <SegmentedControlView
                            value={objectFit}
                            disabled={!enabled}
                            options={[
                                { label: '完整', value: 'contain' },
                                { label: '裁剪', value: 'cover' },
                                { label: '原始', value: 'none' },
                            ]}
                            onChange={(val) =>
                                updateImageDisplay({ objectFit: val as 'contain' | 'cover' | 'none' })
                            }
                        />
                    </QuickFormRow>
                    <QuickFormRow label="圆角显示" disabled={!enabled}>
                        <SwitchControl
                            value={rounded}
                            disabled={!enabled}
                            onChange={(val) => updateImageDisplay({ rounded: val })}
                        />
                    </QuickFormRow>
                    <QuickFormRow label="显示模式" disabled={!enabled}>
                        <SegmentedControlView
                            value={displayMode}
                            disabled={!enabled}
                            options={[
                                { label: '正常', value: 'normal' },
                                { label: '模糊', value: 'blur' },
                                { label: '折叠', value: 'collapse' },
                            ]}
                            onChange={(val) =>
                                updateImageDisplay({ displayMode: val as ImageDisplayMode })
                            }
                        />
                    </QuickFormRow>
                </QuickSection>

                <QuickSection title="存储设置">
                    <QuickFormRow label="图片存储格式" disabled={!enabled}>
                        <SelectControl
                            value={imageQuality}
                            disabled={!enabled}
                            options={[
                                { label: '原始格式 (无损)', value: 'original' },
                                { label: 'WebP 高质量 (90%)', value: 'webp-high' },
                                { label: 'WebP 均衡压缩 (80%)', value: 'webp-medium' },
                            ]}
                            onChange={(val) =>
                                settingsStore.set('imageQuality', val as ImageStorageQuality)
                            }
                        />
                    </QuickFormRow>
                    <QuickFormRow label="同步转存至酒馆" disabled={!enabled}>
                        <SwitchControl
                            value={saveToServer}
                            disabled={!enabled}
                            onChange={(val) => settingsStore.set('saveToServer', val)}
                        />
                    </QuickFormRow>
                </QuickSection>
            </div>
        );
    }

    // 2. 服务设置 Tab (同步当前激活服务的预设、模型、工作流、画幅比例与采样控制)
    private renderProviderTab(s: DrawAssistantSettings): VNode {
        const provider = (s.activeProvider || 'comfyui') as ProviderType;
        const providerLabel =
            PROVIDER_SELECT_OPTIONS.find((p) => p.value === provider)?.label || provider;
        const providerCfg = settingsStore.getProviderConfig<ProviderStoredConfig>(provider) || {};
        const assetCache = providerCfg.assetCache;

        const drawingPresets = settingsStore.getPresets<DrawingPresetData>('drawing', provider);
        const promptPresets = settingsStore.getPresets<PromptPresetData>('prompts', provider);
        const workflowPresets = settingsStore.getPresets<WorkflowPresetData>('workflows');

        const activeDrawingPreset =
            drawingPresets.find((d) => d.id === providerCfg.activeDrawingPresetId) ||
            drawingPresets[0];
        const activeDrawingId = activeDrawingPreset?.id || '';
        const drawingData: DrawingPresetData = activeDrawingPreset?.data || {};
        const activePromptId = drawingData.promptPresetId || '';

        const promptSelectOptions: SelectOption[] = [
            { label: '-- 未选择 --', value: '' },
            { label: '使用轮询', value: PROMPT_POLLING_PRESET_ID },
            ...promptPresets.map((pp) => ({ label: pp.name, value: pp.id })),
        ];

        const effectiveModelId =
            (drawingData.customModel || '').trim() || (drawingData.baseModel || '').trim();

        const cachedModels: SelectOption[] = [
            ...(assetCache?.checkpoints || []),
            ...(assetCache?.unets || []),
        ].map((m) => ({ label: m, value: m }));

        const cachedClips: SelectOption[] = (assetCache?.clips || []).map((c) => ({
            label: c,
            value: c,
        }));

        const cachedVaes: SelectOption[] = (assetCache?.vaes || []).map((v) => ({
            label: v,
            value: v,
        }));

        const cachedSamplers: SelectOption[] = (assetCache?.samplers || []).map((sp) => ({
            label: sp,
            value: sp,
        }));

        const cachedSchedulers: SelectOption[] = (assetCache?.schedulers || []).map((sc) => ({
            label: sc,
            value: sc,
        }));

        return (
            <div className="da-fqp-tab-content" data-tab="provider">
                <QuickSection title="预设与模型" hint={`当前服务: ${providerLabel}`}>
                    <QuickFormRow label="生图参数预设">
                        <SelectControl
                            value={activeDrawingId}
                            disabled={drawingPresets.length === 0}
                            options={
                                drawingPresets.length === 0
                                    ? [{ label: '暂无可用预设', value: '' }]
                                    : drawingPresets.map((dp) => ({ label: dp.name, value: dp.id }))
                            }
                            onChange={(val) =>
                                settingsStore.setProviderConfig(provider, {
                                    activeDrawingPresetId: val,
                                })
                            }
                        />
                    </QuickFormRow>

                    {activeDrawingPreset && (
                        <QuickFormRow label="提示词预设">
                            <SelectControl
                                value={activePromptId}
                                options={buildSelectOptionsWithCurrent(
                                    promptSelectOptions,
                                    activePromptId
                                )}
                                onChange={(val) =>
                                    this.updateActiveDrawingPresetData(provider, activeDrawingId, {
                                        promptPresetId: val,
                                    })
                                }
                            />
                        </QuickFormRow>
                    )}

                    {activeDrawingPreset && provider === 'comfyui' && (
                        <>
                            <QuickFormRow label="文生图工作流">
                                <SelectControl
                                    value={drawingData.txt2imgWorkflowId || ''}
                                    options={buildSelectOptionsWithCurrent(
                                        workflowPresets.map((w) => ({
                                            label: w.name,
                                            value: w.id,
                                        })),
                                        drawingData.txt2imgWorkflowId,
                                        '-- 未选择 --'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { txt2imgWorkflowId: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="局部重绘工作流">
                                <SelectControl
                                    value={drawingData.inpaintPresetId || ''}
                                    options={buildSelectOptionsWithCurrent(
                                        workflowPresets.map((w) => ({
                                            label: w.name,
                                            value: w.id,
                                        })),
                                        drawingData.inpaintPresetId,
                                        '-- 未选择 --'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { inpaintPresetId: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="主模型">
                                <SelectControl
                                    value={drawingData.baseModel || ''}
                                    options={buildSelectOptionsWithCurrent(
                                        cachedModels,
                                        drawingData.baseModel,
                                        '-- 未选择 --'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { baseModel: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="CLIP 模型">
                                <SelectControl
                                    value={drawingData.clipName || ''}
                                    options={buildSelectOptionsWithCurrent(
                                        cachedClips,
                                        drawingData.clipName,
                                        '-- 使用模型内置 --'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { clipName: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="VAE 模型">
                                <SelectControl
                                    value={drawingData.vaeName || ''}
                                    options={buildSelectOptionsWithCurrent(
                                        cachedVaes,
                                        drawingData.vaeName,
                                        '-- 使用模型内置 --'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { vaeName: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                        </>
                    )}

                    {activeDrawingPreset && provider === 'sdwebui' && (
                        <>
                            <QuickFormRow label="主模型">
                                <SelectControl
                                    value={drawingData.baseModel || ''}
                                    options={buildSelectOptionsWithCurrent(
                                        cachedModels,
                                        drawingData.baseModel,
                                        '-- 未选择 --'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { baseModel: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="VAE 模型">
                                <SelectControl
                                    value={drawingData.vaeName || 'automatic'}
                                    options={buildSelectOptionsWithCurrent(
                                        [
                                            { label: '自动匹配 (automatic)', value: 'automatic' },
                                            { label: '不使用外置 VAE (None)', value: 'None' },
                                            ...cachedVaes,
                                        ],
                                        drawingData.vaeName || 'automatic'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { vaeName: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                        </>
                    )}

                    {activeDrawingPreset && provider === 'novelai' && (
                        <>
                            <QuickFormRow label="服务商">
                                <SelectControl
                                    value={providerCfg.serviceId || NOVELAI_OFFICIAL_SERVICE_ID}
                                    options={[
                                        { label: 'NovelAI 官方', value: NOVELAI_OFFICIAL_SERVICE_ID },
                                        { label: '自定义服务', value: NOVELAI_CUSTOM_SERVICE_ID },
                                    ]}
                                    onChange={(val) =>
                                        settingsStore.setProviderConfig(provider, {
                                            serviceId: val,
                                            ...(val === NOVELAI_OFFICIAL_SERVICE_ID
                                                ? { serverUrl: NOVELAI_IMAGE_HOST }
                                                : {}),
                                        })
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="生图模型">
                                <SelectControl
                                    value={drawingData.baseModel || 'nai-diffusion-4-5-full'}
                                    options={buildSelectOptionsWithCurrent(
                                        OFFICIAL_NOVELAI_MODELS.map((id) => ({
                                            label: formatNovelAIModelLabel(id),
                                            value: id,
                                        })),
                                        drawingData.baseModel || 'nai-diffusion-4-5-full'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { baseModel: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="权重语法自动转换">
                                <SwitchControl
                                    value={drawingData.convertSyntax !== false}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { convertSyntax: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                        </>
                    )}

                    {activeDrawingPreset && provider === 'openai' && (
                        <>
                            <QuickFormRow label="服务商">
                                <SelectControl
                                    value={providerCfg.serviceId || 'openai-official'}
                                    options={[
                                        { label: 'OpenAI 官方', value: 'openai-official' },
                                        { label: 'SiliconFlow 硅基流动', value: 'siliconflow' },
                                        { label: '自定义服务', value: 'custom' },
                                    ]}
                                    onChange={(val) =>
                                        settingsStore.setProviderConfig(provider, {
                                            serviceId: val,
                                        })
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="生图模型">
                                <SelectControl
                                    value={drawingData.baseModel || 'gpt-image-1'}
                                    options={buildSelectOptionsWithCurrent(
                                        [...cachedModels, ...OPENAI_MODEL_OPTIONS],
                                        drawingData.baseModel || 'gpt-image-1'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { baseModel: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                        </>
                    )}

                    {activeDrawingPreset && provider === 'gemini' && (
                        <>
                            <QuickFormRow label="服务商">
                                <SelectControl
                                    value={providerCfg.serviceId || GEMINI_OFFICIAL_SERVICE_ID}
                                    options={[
                                        { label: 'Google Gemini 官方', value: GEMINI_OFFICIAL_SERVICE_ID },
                                        { label: '自定义中转 / 代理', value: GEMINI_CUSTOM_SERVICE_ID },
                                    ]}
                                    onChange={(val) =>
                                        settingsStore.setProviderConfig(provider, {
                                            serviceId: val,
                                            ...(val === GEMINI_OFFICIAL_SERVICE_ID
                                                ? { serverUrl: GEMINI_API_BASE }
                                                : {}),
                                        })
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="生图模型">
                                <SelectControl
                                    value={drawingData.baseModel || 'gemini-2.5-flash-image'}
                                    options={buildSelectOptionsWithCurrent(
                                        [...cachedModels, ...GEMINI_MODEL_OPTIONS],
                                        drawingData.baseModel || 'gemini-2.5-flash-image'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { baseModel: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                        </>
                    )}

                    {activeDrawingPreset && provider === 'grok' && (
                        <>
                            <QuickFormRow label="服务商">
                                <SelectControl
                                    value={providerCfg.serviceId || GROK_OFFICIAL_SERVICE_ID}
                                    options={[
                                        { label: 'xAI Grok 官方', value: GROK_OFFICIAL_SERVICE_ID },
                                        { label: '自定义中转 / 代理', value: GROK_CUSTOM_SERVICE_ID },
                                    ]}
                                    onChange={(val) =>
                                        settingsStore.setProviderConfig(provider, {
                                            serviceId: val,
                                            ...(val === GROK_OFFICIAL_SERVICE_ID
                                                ? { serverUrl: GROK_API_BASE }
                                                : {}),
                                        })
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="生图模型">
                                <SelectControl
                                    value={drawingData.baseModel || 'grok-imagine-image'}
                                    options={buildSelectOptionsWithCurrent(
                                        [...cachedModels, ...GROK_MODEL_OPTIONS],
                                        drawingData.baseModel || 'grok-imagine-image'
                                    )}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { baseModel: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                        </>
                    )}
                </QuickSection>

                {activeDrawingPreset &&
                    (provider === 'comfyui' ||
                        provider === 'sdwebui' ||
                        provider === 'novelai') &&
                    (() => {
                        const width = Number(drawingData.width || 832);
                        const height = Number(drawingData.height || 1216);
                        const matchedRatio =
                            DEFAULT_ASPECT_RATIOS.find(
                                (p) => p.width === width && p.height === height
                            )?.id || 'custom';
                        const ratioOptions: SelectOption[] = [
                            ...DEFAULT_ASPECT_RATIOS.map((p) => ({
                                value: p.id,
                                label: `${p.label} (${p.width}×${p.height})`,
                            })),
                            ...(matchedRatio === 'custom'
                                ? [{ value: 'custom', label: `自定义 (${width}×${height})` }]
                                : []),
                        ];
                        return (
                            <>
                                <QuickSection title="分辨率与画幅">
                                    <QuickFormRow label="画幅比例">
                                        <SelectControl
                                            value={matchedRatio}
                                            options={ratioOptions}
                                            onChange={(val) => {
                                                const preset = DEFAULT_ASPECT_RATIOS.find(
                                                    (p) => p.id === val
                                                );
                                                if (!preset) return;
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { width: preset.width, height: preset.height }
                                                );
                                            }}
                                        />
                                    </QuickFormRow>
                                </QuickSection>
                                <QuickSection title="采样与步数">
                                    <QuickFormRow label="采样算法">
                                        <SelectControl
                                            value={drawingData.samplerName || ''}
                                            options={buildSelectOptionsWithCurrent(
                                                cachedSamplers.length > 0
                                                    ? cachedSamplers
                                                    : provider === 'comfyui'
                                                      ? COMFY_DEFAULT_SAMPLERS
                                                      : provider === 'sdwebui'
                                                        ? SDWEBUI_DEFAULT_SAMPLERS
                                                        : NOVELAI_SAMPLER_OPTIONS,
                                                drawingData.samplerName
                                            )}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { samplerName: val }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                    <QuickFormRow label="调度器">
                                        <SelectControl
                                            value={drawingData.scheduler || ''}
                                            options={buildSelectOptionsWithCurrent(
                                                cachedSchedulers.length > 0
                                                    ? cachedSchedulers
                                                    : provider === 'comfyui'
                                                      ? COMFY_DEFAULT_SCHEDULERS
                                                      : provider === 'sdwebui'
                                                        ? SDWEBUI_DEFAULT_SCHEDULERS
                                                        : NOVELAI_SCHEDULER_OPTIONS,
                                                drawingData.scheduler
                                            )}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { scheduler: val }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                    <QuickFormRow label="采样步数">
                                        <NumberInputControl
                                            value={Number(drawingData.steps ?? 28)}
                                            min={1}
                                            max={provider === 'novelai' ? 50 : 100}
                                            step={1}
                                            precision={0}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { steps: Math.round(val) }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                    <QuickFormRow label="引导系数 (CFG)">
                                        <NumberInputControl
                                            value={Number(
                                                drawingData.cfgScale ??
                                                    (provider === 'novelai'
                                                        ? 5
                                                        : provider === 'sdwebui'
                                                          ? 5.5
                                                          : 6)
                                            )}
                                            min={0}
                                            max={provider === 'novelai' ? 10 : 20}
                                            step={0.5}
                                            precision={1}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { cfgScale: val }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                    {provider === 'sdwebui' && (
                                        <QuickFormRow label="CLIP 跳过层数">
                                            <NumberInputControl
                                                value={Number(drawingData.clipSkip ?? 2)}
                                                min={1}
                                                max={4}
                                                step={1}
                                                precision={0}
                                                unit=" 层"
                                                onChange={(val) =>
                                                    this.updateActiveDrawingPresetData(
                                                        provider,
                                                        activeDrawingId,
                                                        { clipSkip: Math.round(val) }
                                                    )
                                                }
                                            />
                                        </QuickFormRow>
                                    )}
                                    {provider === 'novelai' && (
                                        <QuickFormRow label="CFG 重缩放">
                                            <NumberInputControl
                                                value={Number(drawingData.cfgRescale ?? 0)}
                                                min={0}
                                                max={1}
                                                step={0.02}
                                                precision={2}
                                                onChange={(val) =>
                                                    this.updateActiveDrawingPresetData(
                                                        provider,
                                                        activeDrawingId,
                                                        { cfgRescale: val }
                                                    )
                                                }
                                            />
                                        </QuickFormRow>
                                    )}
                                </QuickSection>
                            </>
                        );
                    })()}

                {activeDrawingPreset && provider === 'sdwebui' && (
                    <QuickSection title="高清修复 (Hires. fix)">
                        <QuickFormRow label="启用高清修复">
                            <SwitchControl
                                value={Boolean(drawingData.enableHires)}
                                onChange={(val) =>
                                    this.updateActiveDrawingPresetData(provider, activeDrawingId, {
                                        enableHires: val,
                                    })
                                }
                            />
                        </QuickFormRow>
                        <QuickFormRow
                            label="放大算法 (Upscaler)"
                            disabled={!drawingData.enableHires}
                        >
                            <SelectControl
                                value={drawingData.hiresUpscaler || 'R-ESRGAN 4x+ Anime6B'}
                                disabled={!drawingData.enableHires}
                                options={buildSelectOptionsWithCurrent(
                                    HIRES_UPSCALER_OPTIONS,
                                    drawingData.hiresUpscaler || 'R-ESRGAN 4x+ Anime6B'
                                )}
                                onChange={(val) =>
                                    this.updateActiveDrawingPresetData(provider, activeDrawingId, {
                                        hiresUpscaler: val,
                                    })
                                }
                            />
                        </QuickFormRow>
                        <QuickFormRow label="放大倍率" disabled={!drawingData.enableHires}>
                            <NumberInputControl
                                value={Number(drawingData.hiresScale ?? 1.5)}
                                min={1.0}
                                max={4.0}
                                step={0.05}
                                precision={2}
                                unit="x"
                                disabled={!drawingData.enableHires}
                                onChange={(val) =>
                                    this.updateActiveDrawingPresetData(provider, activeDrawingId, {
                                        hiresScale: val,
                                    })
                                }
                            />
                        </QuickFormRow>
                        <QuickFormRow label="高清修复步数" disabled={!drawingData.enableHires}>
                            <NumberInputControl
                                value={Number(drawingData.hiresSteps ?? 15)}
                                min={0}
                                max={50}
                                step={1}
                                precision={0}
                                unit=" 步"
                                disabled={!drawingData.enableHires}
                                onChange={(val) =>
                                    this.updateActiveDrawingPresetData(provider, activeDrawingId, {
                                        hiresSteps: Math.round(val),
                                    })
                                }
                            />
                        </QuickFormRow>
                        <QuickFormRow label="重绘幅度" disabled={!drawingData.enableHires}>
                            <NumberInputControl
                                value={Number(drawingData.hiresDenoise ?? 0.45)}
                                min={0.0}
                                max={1.0}
                                step={0.01}
                                precision={2}
                                disabled={!drawingData.enableHires}
                                onChange={(val) =>
                                    this.updateActiveDrawingPresetData(provider, activeDrawingId, {
                                        hiresDenoise: val,
                                    })
                                }
                            />
                        </QuickFormRow>
                    </QuickSection>
                )}

                {activeDrawingPreset &&
                    provider === 'novelai' &&
                    resolveNovelAIModelFamily(
                        effectiveModelId || 'nai-diffusion-4-5-full'
                    ) === 'v3' && (
                        <QuickSection title="V3 采样增强">
                            <QuickFormRow label="SMEA 采样增强">
                                <SelectControl
                                    value={drawingData.smeaMode || 'smea_dyn'}
                                    options={[...SMEA_MODE_OPTIONS]}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { smeaMode: val as DrawingPresetData['smeaMode'] }
                                        )
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="焦黑抑制 (Decrisper)">
                                <SwitchControl
                                    value={Boolean(drawingData.decrisper)}
                                    onChange={(val) =>
                                        this.updateActiveDrawingPresetData(
                                            provider,
                                            activeDrawingId,
                                            { decrisper: val }
                                        )
                                    }
                                />
                            </QuickFormRow>
                        </QuickSection>
                    )}

                {activeDrawingPreset &&
                    provider === 'openai' &&
                    (() => {
                        const caps = resolveOpenAIModelCapabilities(
                            effectiveModelId || 'gpt-image-1'
                        );
                        const isSiliconFlow = isSiliconFlowService(
                            providerCfg.serviceId,
                            providerCfg.serverUrl
                        );
                        const supportsAutoSize = caps.supportsAutoSize && !isSiliconFlow;
                        const openaiRatios =
                            caps.family === 'gpt-image'
                                ? GPT_IMAGE_ASPECT_RATIOS
                                : caps.family === 'dall-e-3'
                                  ? OPENAI_ASPECT_RATIOS
                                  : DEFAULT_ASPECT_RATIOS;
                        const width = Number(drawingData.width || 1024);
                        const height = Number(
                            drawingData.height || (caps.family === 'gpt-image' ? 1536 : 1024)
                        );
                        const isAutoSize =
                            supportsAutoSize &&
                            String(drawingData.aspectRatio || '').toLowerCase() === 'auto';
                        const matchedOpenAIRatio = isAutoSize
                            ? 'auto'
                            : openaiRatios.find((p) => p.width === width && p.height === height)
                                  ?.id || 'custom';
                        const openaiRatioOptions: SelectOption[] = [
                            ...(supportsAutoSize
                                ? [{ value: 'auto', label: '自动 (由模型决定)' }]
                                : []),
                            ...openaiRatios.map((p) => ({
                                value: p.id,
                                label: p.label.includes('(')
                                    ? p.label
                                    : `${p.label} (${p.width}×${p.height})`,
                            })),
                            ...(matchedOpenAIRatio === 'custom'
                                ? [{ value: 'custom', label: `自定义 (${width}×${height})` }]
                                : []),
                        ];
                        return (
                            <QuickSection title="画面参数">
                                <QuickFormRow label="画幅比例">
                                    <SelectControl
                                        value={matchedOpenAIRatio}
                                        options={openaiRatioOptions}
                                        onChange={(val) => {
                                            if (val === 'auto' && supportsAutoSize) {
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { aspectRatio: 'auto' }
                                                );
                                                return;
                                            }
                                            const preset = openaiRatios.find((p) => p.id === val);
                                            if (!preset) return;
                                            this.updateActiveDrawingPresetData(
                                                provider,
                                                activeDrawingId,
                                                {
                                                    aspectRatio: undefined,
                                                    width: preset.width,
                                                    height: preset.height,
                                                }
                                            );
                                        }}
                                    />
                                </QuickFormRow>
                                {caps.supportsQuality && caps.qualityOptions.length > 0 && (
                                    <QuickFormRow label="生成画质 (Quality)">
                                        <SelectControl
                                            value={
                                                drawingData.quality || caps.qualityOptions[0]
                                            }
                                            options={caps.qualityOptions.map((q) => ({
                                                label: q,
                                                value: q,
                                            }))}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { quality: val }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                )}
                                {caps.supportsStyle && (
                                    <QuickFormRow label="画面风格 (Style)">
                                        <SelectControl
                                            value={drawingData.style || 'vivid'}
                                            options={[
                                                { label: 'vivid (生动)', value: 'vivid' },
                                                { label: 'natural (写实)', value: 'natural' },
                                            ]}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { style: val }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                )}
                                {caps.supportsBackground && (
                                    <QuickFormRow label="背景模式 (Background)">
                                        <SelectControl
                                            value={drawingData.background || 'auto'}
                                            options={[
                                                { label: 'auto (自动)', value: 'auto' },
                                                {
                                                    label: 'transparent (透明背景)',
                                                    value: 'transparent',
                                                },
                                                { label: 'opaque (不透明)', value: 'opaque' },
                                            ]}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { background: val }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                )}
                                {caps.supportsOutputFormat && (
                                    <QuickFormRow label="输出格式 (Output Format)">
                                        <SegmentedControlView
                                            value={drawingData.outputFormat || 'png'}
                                            options={[
                                                { label: 'png', value: 'png' },
                                                { label: 'jpeg', value: 'jpeg' },
                                                { label: 'webp', value: 'webp' },
                                            ]}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { outputFormat: val }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                )}
                            </QuickSection>
                        );
                    })()}

                {activeDrawingPreset &&
                    provider === 'gemini' &&
                    (() => {
                        const caps = resolveGeminiModelCapabilities(
                            effectiveModelId || 'gemini-2.5-flash-image'
                        );
                        const fullSizeOptions = buildGeminiImageSizeOptions(caps);
                        const curSize = String(drawingData.imageSize || '');
                        const resolvedSize =
                            curSize.toLowerCase() === 'auto'
                                ? 'auto'
                                : caps.allowsDefaultEmptyImageSize
                                  ? caps.supportedImageSizes.includes(curSize)
                                      ? curSize
                                      : 'auto'
                                  : caps.supportedImageSizes.includes(curSize)
                                    ? curSize
                                    : caps.supportedImageSizes.includes('1K')
                                      ? '1K'
                                      : (caps.supportedImageSizes[0] ?? '1K');

                        return (
                            <QuickSection title="画面参数">
                                <QuickFormRow label="画幅比例">
                                    <SelectControl
                                        value={drawingData.aspectRatio || '1:1'}
                                        options={GEMINI_ASPECT_RATIO_OPTIONS}
                                        onChange={(val) =>
                                            this.updateActiveDrawingPresetData(
                                                provider,
                                                activeDrawingId,
                                                { aspectRatio: val }
                                            )
                                        }
                                    />
                                </QuickFormRow>
                                {caps.supportsImageSize && fullSizeOptions.length > 0 && (
                                    <QuickFormRow label="分辨率档位">
                                        <SegmentedControlView
                                            value={resolvedSize}
                                            options={fullSizeOptions}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { imageSize: val }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                )}
                            </QuickSection>
                        );
                    })()}

                {activeDrawingPreset &&
                    provider === 'grok' &&
                    (() => {
                        const caps = resolveGrokModelCapabilities(
                            effectiveModelId || 'grok-imagine-image'
                        );
                        if (!caps.supportsAspectRatio && !caps.supportsResolution) {
                            return null;
                        }
                        return (
                            <QuickSection title="画面参数">
                                {caps.supportsAspectRatio && (
                                    <QuickFormRow label="画幅比例">
                                        <SelectControl
                                            value={drawingData.aspectRatio || '1:1'}
                                            options={GROK_ASPECT_RATIO_OPTIONS}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { aspectRatio: val }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                )}
                                {caps.supportsResolution && (
                                    <QuickFormRow label="分辨率档位">
                                        <SegmentedControlView
                                            value={drawingData.resolution || '1k'}
                                            options={GROK_RESOLUTIONS.map((res) => ({
                                                label: res.toUpperCase(),
                                                value: res,
                                            }))}
                                            onChange={(val) =>
                                                this.updateActiveDrawingPresetData(
                                                    provider,
                                                    activeDrawingId,
                                                    { resolution: val }
                                                )
                                            }
                                        />
                                    </QuickFormRow>
                                )}
                            </QuickSection>
                        );
                    })()}
            </div>
        );
    }

    // 3. 提示词注入 Tab (四大通道预设与开关 + 可折叠的各通道词条启停与触发模式切换)
    private renderPromptsTab(s: DrawAssistantSettings): VNode {
        const inj = s.promptInjection || {
            story: { enabled: true, activePresetId: '' },
            vocab: { enabled: false, activePresetId: '' },
            character: { enabled: false, activePresetId: '' },
            material: { enabled: false, activePresetId: '', hideWhenEmpty: true },
        };
        const expandedMap = this.expandedPromptChannels.value;

        const updateChannel = (
            channelId: PromptChannelId,
            patch: Partial<{ enabled: boolean; activePresetId: string; hideWhenEmpty: boolean }>
        ) => {
            const cur = settingsStore.get('promptInjection');
            const next: PromptInjectionConfig = {
                ...cur,
                [channelId]: {
                    ...(cur?.[channelId] || { enabled: false, activePresetId: '' }),
                    ...patch,
                },
            };
            settingsStore.set('promptInjection', next);
            void promptInjector.scheduleSyncToHost();
        };

        const updateChannelEntry = (
            category: 'prompt_story' | 'prompt_vocab' | 'prompt_character' | 'prompt_material',
            presetId: string,
            entryId: string,
            patch: Partial<{ enabled: boolean; triggerMode: ActivationTriggerMode }>
        ) => {
            const preset = settingsStore.getPreset<PromptChannelPresetData>(category, presetId);
            if (!preset || !Array.isArray(preset.data?.entries)) return;
            const nextEntries = preset.data.entries.map((entry) =>
                entry.id === entryId ? { ...entry, ...patch } : entry
            );
            settingsStore.savePreset<PromptChannelPresetData>(category, {
                ...preset,
                data: {
                    ...preset.data,
                    entries: nextEntries,
                },
                updatedAt: Date.now(),
            });
            void promptInjector.scheduleSyncToHost();
        };

        return (
            <div className="da-fqp-tab-content" data-tab="prompts">
                <QuickSection title="提示词通道启用">
                    {PROMPT_CHANNEL_META.map((ch) => {
                        const chCfg = inj[ch.id];
                        const isEnabled = Boolean(chCfg?.enabled);
                        const list =
                            (s.presets?.[ch.category] as
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
                                                updateChannel(ch.id, { activePresetId: val })
                                            }
                                        />
                                    </div>
                                    <SwitchControl
                                        value={isEnabled}
                                        onChange={(val) =>
                                            updateChannel(ch.id, { enabled: val })
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
                                updateChannel('material', { hideWhenEmpty: val })
                            }
                        />
                    </QuickFormRow>
                </QuickSection>

                <QuickSection title="通道词条控制" hint="点击通道栏展开或折叠">
                    {PROMPT_CHANNEL_META.map((ch) => {
                        const list =
                            (s.presets?.[ch.category] as
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
                                        this.expandedPromptChannels.value = {
                                            ...expandedMap,
                                            [ch.id]: !isExpanded,
                                        };
                                        this.positionPanel();
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
                                                                updateChannelEntry(
                                                                    ch.category,
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
                                                                updateChannelEntry(
                                                                    ch.category,
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

    // 4. 素材管理 Tab (启用设置、角色/通用服装启用列表、档案解析与格式预设)
    private renderMaterialsTab(s: DrawAssistantSettings): VNode {
        const matCfg = s.materialConfig;
        const actPresets =
            (s.presets?.material_activations as
                | Array<{ id: string; name: string; data: MaterialActivationPresetData }>
                | undefined) || [];
        const extPresets =
            (s.presets?.material_extractions as
                | Array<{ id: string; name: string; data: MaterialExtractionPresetData }>
                | undefined) || [];
        const fmtPresets =
            (s.presets?.material_formats as
                | Array<{ id: string; name: string; data: MaterialFormatPresetData }>
                | undefined) || [];
        const characters =
            (s.presets?.characters as
                | Array<{ id: string; name: string; data: CharacterPresetData }>
                | undefined) || [];
        const outfits =
            (s.presets?.outfits as
                | Array<{ id: string; name: string; data: OutfitPresetData }>
                | undefined) || [];

        const activeActPreset =
            actPresets.find((p) => p.id === matCfg?.activeActivationPresetId) ||
            actPresets[0];
        const activeActId = activeActPreset?.id || '';
        const actData: MaterialActivationPresetData = activeActPreset?.data || {
            characterRules: {},
            outfitRules: {},
        };

        const activeExtPreset =
            extPresets.find((p) => p.id === matCfg?.activeExtractionPresetId) ||
            extPresets[0];
        const activeExtId = activeExtPreset?.id || '';
        const extData = {
            ...DEFAULT_EXTRACTION_CONFIG,
            ...(activeExtPreset?.data || {}),
        };

        const activeFmtPreset =
            fmtPresets.find((p) => p.id === matCfg?.activeFormatPresetId) ||
            fmtPresets[0];
        const activeFmtId = activeFmtPreset?.id || '';

        const hostCards = getHostCharacterCards();
        const {
            primaryCard: primaryBoundCard,
            extraCards: extraBoundCards,
            allCards: rawBoundCards,
        } = splitBoundCardNames(actData.boundCardNames);

        // 过滤已绑定至角色的专属服装，通用服装启用列表仅展示独立通用服装
        const allBoundOutfitIds: string[] = [];
        for (const c of characters) {
            const boundIds = c.data?.boundOutfitIds || [];
            for (const b of boundIds) {
                if (b && b.trim()) {
                    allBoundOutfitIds.push(b.trim());
                }
            }
        }
        const universalOutfits = outfits.filter((o) => !matchesOutfitId(allBoundOutfitIds, o.id));

        const updateMaterialConfig = (patch: Partial<MaterialLibraryConfig>) => {
            const cur = settingsStore.get('materialConfig');
            settingsStore.set('materialConfig', {
                ...cur,
                ...patch,
            });
            void promptInjector.scheduleSyncToHost();
        };

        const updateActiveActivationData = (patch: Partial<MaterialActivationPresetData>) => {
            if (!activeActPreset) return;
            settingsStore.savePreset<MaterialActivationPresetData>('material_activations', {
                ...activeActPreset,
                data: {
                    ...actData,
                    ...patch,
                },
                updatedAt: Date.now(),
            });
            void promptInjector.scheduleSyncToHost();
        };

        const updateActivationRule = (
            ruleGroup: 'characterRules' | 'outfitRules',
            presetId: string,
            patch: { enabled?: boolean; triggerMode?: ActivationTriggerMode }
        ) => {
            const currentRules =
                (ruleGroup === 'characterRules'
                    ? actData.characterRules
                    : actData.outfitRules) || {};
            const prev = currentRules[presetId];
            const nextMode = patch.triggerMode ?? prev?.triggerMode ?? 'keyword';
            const nextEnabled =
                patch.enabled !== undefined
                    ? patch.enabled
                    : patch.triggerMode === 'always'
                      ? true
                      : Boolean(prev?.enabled);

            updateActiveActivationData({
                [ruleGroup]: {
                    ...currentRules,
                    [presetId]: {
                        ...(prev || {}),
                        enabled: nextEnabled,
                        triggerMode: nextMode,
                    },
                },
            });
        };

        const updateActiveExtractionData = (patch: Partial<MaterialExtractionPresetData>) => {
            if (!activeExtPreset) return;
            settingsStore.savePreset<MaterialExtractionPresetData>('material_extractions', {
                ...activeExtPreset,
                data: {
                    ...activeExtPreset.data,
                    ...patch,
                },
                updatedAt: Date.now(),
            });
            hostRegexService.syncToHost();
        };

        return (
            <div className="da-fqp-tab-content" data-tab="materials">
                <QuickSection title="启用设置与角色卡联动">
                    <QuickFormRow label="素材启用预设">
                        <SelectControl
                            value={activeActId}
                            disabled={actPresets.length === 0}
                            options={
                                actPresets.length === 0
                                    ? [{ label: '暂无启用预设', value: '' }]
                                    : actPresets.map((ap) => ({
                                          label: ap.name,
                                          value: ap.id,
                                      }))
                            }
                            onChange={(val) =>
                                updateMaterialConfig({ activeActivationPresetId: val })
                            }
                        />
                    </QuickFormRow>
                    <QuickFormRow label="随角色卡自动切换预设">
                        <SwitchControl
                            value={Boolean(matCfg?.autoSwitchByCard)}
                            onChange={(val) =>
                                updateMaterialConfig({ autoSwitchByCard: val })
                            }
                        />
                    </QuickFormRow>
                    {activeActPreset && (
                        <>
                            <QuickFormRow label="关联酒馆角色卡">
                                {hostCards.length === 0 ? (
                                    <input
                                        type="text"
                                        className="da-input"
                                        placeholder="输入角色卡名（逗号分隔多个）"
                                        value={
                                            this.rawBoundCardsDraft.value?.presetId === activeActId
                                                ? this.rawBoundCardsDraft.value.text
                                                : rawBoundCards.join(', ')
                                        }
                                        onInput={(e) => {
                                            const nextRaw = (e.currentTarget as HTMLInputElement).value;
                                            this.rawBoundCardsDraft.value = {
                                                presetId: activeActId,
                                                text: nextRaw,
                                            };
                                            updateActiveActivationData({
                                                boundCardNames: parseBoundCardNamesInput(nextRaw),
                                            });
                                        }}
                                        onBlur={() => {
                                            this.rawBoundCardsDraft.value = null;
                                        }}
                                    />
                                ) : (
                                    <SearchableSelectControl
                                        value={primaryBoundCard}
                                        options={buildSelectOptionsWithCurrent(
                                            hostCards.map((hc) => ({
                                                label: hc.name,
                                                value: hc.name,
                                            })),
                                            primaryBoundCard
                                        )}
                                        emptyLabel="-- 未关联角色卡 --"
                                        placeholder="-- 未关联角色卡 --"
                                        searchPlaceholder="搜索酒馆角色卡..."
                                        emptyResultText="无匹配角色卡"
                                        allowCustomValue={true}
                                        customValueLabel={(q) => `使用自定义「${q}」`}
                                        onChange={(val) =>
                                            updateActiveActivationData({
                                                boundCardNames: applyPrimaryBoundCardSelection(
                                                    val,
                                                    extraBoundCards
                                                ),
                                            })
                                        }
                                    />
                                )}
                            </QuickFormRow>
                            {hostCards.length > 0 && extraBoundCards.length > 0 && (
                                <div className="da-fqp-subhint">
                                    另已关联 {extraBoundCards.length} 张：{extraBoundCards.join('、')}
                                    （清空当前选择将一并解绑）
                                </div>
                            )}
                        </>
                    )}
                    {activeActPreset && (
                        <QuickFormRow label="角色触发时附带绑定服装">
                            <SwitchControl
                                value={actData.includeBoundOutfits !== false}
                                onChange={(val) =>
                                    updateActiveActivationData({
                                        includeBoundOutfits: val,
                                    })
                                }
                            />
                        </QuickFormRow>
                    )}
                </QuickSection>

                <QuickSection title={`角色启用列表 (${characters.length})`}>
                    {characters.length === 0 ? (
                        <div className="da-fqp-empty">暂无角色预设</div>
                    ) : (
                        characters.map((c) => {
                            const data = normalizeCharacterData(c.data);
                            const displayName = data.name || c.name;
                            const rule = actData.characterRules?.[c.id];
                            return (
                                <div key={c.id} className="da-fqp-item-row">
                                    <div className="da-fqp-item-row__left">
                                        <SwitchControl
                                            value={Boolean(rule?.enabled)}
                                            onChange={(val) =>
                                                updateActivationRule(
                                                    'characterRules',
                                                    c.id,
                                                    { enabled: val }
                                                )
                                            }
                                        />
                                        <span
                                            className="da-fqp-item-row__name"
                                            title={displayName}
                                        >
                                            {displayName}
                                        </span>
                                    </div>
                                    <div className="da-fqp-item-row__right">
                                        <SegmentedControlView
                                            value={rule?.triggerMode || 'keyword'}
                                            options={[
                                                { label: '关键词', value: 'keyword' },
                                                { label: '常驻', value: 'always' },
                                            ]}
                                            onChange={(val) =>
                                                updateActivationRule(
                                                    'characterRules',
                                                    c.id,
                                                    {
                                                        triggerMode:
                                                            val as ActivationTriggerMode,
                                                    }
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            );
                        })
                    )}
                </QuickSection>

                <QuickSection title={`通用服装启用列表 (${universalOutfits.length})`}>
                    {universalOutfits.length === 0 ? (
                        <div className="da-fqp-empty">暂无独立通用服装</div>
                    ) : (
                        universalOutfits.map((o) => {
                            const data = normalizeOutfitData(o.data);
                            const displayName = data.name || o.name;
                            const rule = actData.outfitRules?.[o.id];
                            return (
                                <div key={o.id} className="da-fqp-item-row">
                                    <div className="da-fqp-item-row__left">
                                        <SwitchControl
                                            value={Boolean(rule?.enabled)}
                                            onChange={(val) =>
                                                updateActivationRule('outfitRules', o.id, {
                                                    enabled: val,
                                                })
                                            }
                                        />
                                        <span
                                            className="da-fqp-item-row__name"
                                            title={displayName}
                                        >
                                            {displayName}
                                        </span>
                                    </div>
                                    <div className="da-fqp-item-row__right">
                                        <SegmentedControlView
                                            value={rule?.triggerMode || 'keyword'}
                                            options={[
                                                { label: '关键词', value: 'keyword' },
                                                { label: '常驻', value: 'always' },
                                            ]}
                                            onChange={(val) =>
                                                updateActivationRule('outfitRules', o.id, {
                                                    triggerMode:
                                                        val as ActivationTriggerMode,
                                                })
                                            }
                                        />
                                    </div>
                                </div>
                            );
                        })
                    )}
                </QuickSection>

                <QuickSection title="楼层解析与格式预设">
                    <QuickFormRow label="档案解析预设">
                        <SelectControl
                            value={activeExtId}
                            disabled={extPresets.length === 0}
                            options={
                                extPresets.length === 0
                                    ? [{ label: '暂无解析预设', value: '' }]
                                    : extPresets.map((ep) => ({
                                          label: ep.name,
                                          value: ep.id,
                                      }))
                            }
                            onChange={(val) =>
                                updateMaterialConfig({ activeExtractionPresetId: val })
                            }
                        />
                    </QuickFormRow>
                    {activeExtPreset && (
                        <>
                            <QuickFormRow label="启用楼层档案提取">
                                <SwitchControl
                                    value={extData.enabled !== false}
                                    onChange={(val) =>
                                        updateActiveExtractionData({ enabled: val })
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="AI 回复后自动检测并弹窗确认">
                                <SwitchControl
                                    value={extData.autoDetect !== false}
                                    onChange={(val) =>
                                        updateActiveExtractionData({ autoDetect: val })
                                    }
                                />
                            </QuickFormRow>
                            <QuickFormRow label="折叠楼层原始文本">
                                <SwitchControl
                                    value={extData.collapseInFloor !== false}
                                    onChange={(val) =>
                                        updateActiveExtractionData({
                                            collapseInFloor: val,
                                        })
                                    }
                                />
                            </QuickFormRow>
                        </>
                    )}
                    <QuickFormRow label="变量与宏格式预设">
                        <SelectControl
                            value={activeFmtId}
                            disabled={fmtPresets.length === 0}
                            options={
                                fmtPresets.length === 0
                                    ? [{ label: '暂无格式预设', value: '' }]
                                    : fmtPresets.map((fp) => ({
                                          label: fp.name,
                                          value: fp.id,
                                      }))
                            }
                            onChange={(val) =>
                                updateMaterialConfig({ activeFormatPresetId: val })
                            }
                        />
                    </QuickFormRow>
                </QuickSection>
            </div>
        );
    }

    private renderPanel(): VNode {
        const PanelRoot = (): VNode => {
            const s = this.settingsSignal.value;
            const tab = this.activeTab.value;

            return (
                <div className="da-fqp-shell">
                    {/* 1. 顶栏 Header */}
                    <div className="da-fqp-header">
                        <div className="da-fqp-header__left">
                            <span className="da-fqp-title">ST-DrawAssistant</span>
                            <span className="da-fqp-version">v{EXTENSION_VERSION}</span>
                        </div>
                        <div className="da-fqp-header__right">
                            <button
                                type="button"
                                className="da-fqp-header-btn"
                                title="打开主设置窗口 (或双击悬浮球)"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    this.close();
                                    this.options.onOpenMainSettings?.();
                                }}
                            >
                                主设置
                            </button>
                            <button
                                type="button"
                                className="da-fqp-close-btn"
                                title="关闭快捷面板 (Esc)"
                                aria-label="关闭快捷面板"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    this.close();
                                }}
                                dangerouslySetInnerHTML={{ __html: renderIcon('close', 14) }}
                            />
                        </div>
                    </div>

                    {/* 2. 四栏分页标签栏 */}
                    <div className="da-fqp-tabs" role="tablist">
                        {(
                            [
                                { id: 'general', label: '插件设置' },
                                { id: 'provider', label: '服务设置' },
                                { id: 'prompts', label: '提示词' },
                                { id: 'materials', label: '素材管理' },
                            ] as const
                        ).map((item) => {
                            const isActive = tab === item.id;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    data-tab={item.id}
                                    className={`da-fqp-tab${isActive ? ' is-active' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        this.activeTab.value = item.id;
                                        this.positionPanel();
                                    }}
                                >
                                    {item.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* 3. 内容滚动区 */}
                    <div className="da-fqp-body">
                        {tab === 'general' && this.renderGeneralTab(s)}
                        {tab === 'provider' && this.renderProviderTab(s)}
                        {tab === 'prompts' && this.renderPromptsTab(s)}
                        {tab === 'materials' && this.renderMaterialsTab(s)}
                    </div>
                </div>
            );
        };

        return <PanelRoot />;
    }

    private mountPreact(): void {
        if (!this.element || typeof document === 'undefined') {
            return;
        }
        render(this.renderPanel(), this.element);
    }

    public dispose(): void {
        this.close();
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
        if (this.unbindViewport) {
            this.unbindViewport();
            this.unbindViewport = null;
        }
        if (this.unbindEscape) {
            this.unbindEscape();
            this.unbindEscape = null;
        }
        if (this.element && typeof document !== 'undefined') {
            render(null, this.element);
            this.element.remove();
        }
    }
}
