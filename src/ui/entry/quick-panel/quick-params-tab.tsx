/**
 * 悬浮球快捷面板 - 服务参数与模型配置页 (`provider`)。
 */

import type { VNode } from 'preact';
import type {
    DrawingPresetData,
    PromptPresetData,
    ProviderStoredConfig,
    ProviderType,
    WorkflowPresetData,
} from '@types';
import { PROMPT_POLLING_PRESET_ID } from '../../../config/constants';
import { settingsStore } from '../../../store/settings-store';
import {
    PROVIDER_SELECT_OPTIONS,
    COMFY_DEFAULT_SAMPLERS,
    COMFY_DEFAULT_SCHEDULERS,
    SDWEBUI_DEFAULT_SAMPLERS,
    SDWEBUI_DEFAULT_SCHEDULERS,
    HIRES_UPSCALER_OPTIONS,
    NOVELAI_SAMPLER_OPTIONS,
    NOVELAI_SCHEDULER_OPTIONS,
    NOVELAI_SMEA_MODE_OPTIONS,
    OFFICIAL_NOVELAI_MODELS,
    formatNovelAIModelLabel,
    resolveNovelAIModelFamily,
    OPENAI_MODEL_OPTIONS,
    isSiliconFlowService,
    resolveOpenAIModelCapabilities,
    GEMINI_ASPECT_RATIO_OPTIONS,
    GEMINI_MODEL_OPTIONS,
    buildGeminiImageSizeOptions,
    resolveGeminiModelCapabilities,
    GROK_ASPECT_RATIO_OPTIONS,
    GROK_MODEL_OPTIONS,
    GROK_RESOLUTIONS,
    resolveGrokModelCapabilities,
    DEFAULT_ASPECT_RATIOS,
    OPENAI_ASPECT_RATIOS,
    GPT_IMAGE_ASPECT_RATIOS,
    getProviderServiceProfileRules,
    getProviderServiceProfiles,
} from '../../../domain';
import {
    SwitchControl,
    SelectControl,
    SegmentedControlView,
    NumberInputControl,
} from '../../framework';
import type { SelectOption } from '../../components/select';
import { buildSelectOptionsWithCurrent } from '../../state/quick-panel-state';
import { QuickSection, QuickFormRow, type QuickPanelSubViewProps } from './quick-shared';

export function QuickProviderTab(props: QuickPanelSubViewProps): VNode {
    const { state, settings: s } = props;
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

    const serviceProfiles = getProviderServiceProfiles(provider);
    const defaultServiceId = getProviderServiceProfileRules(provider)?.defaultServiceId || '';

    const renderServiceProfileRow = (): VNode | null => {
        if (serviceProfiles.length === 0) {
            return null;
        }
        return (
            <QuickFormRow label="服务商">
                <SelectControl
                    value={providerCfg.serviceId || defaultServiceId}
                    options={serviceProfiles.map((p) => ({ label: p.label, value: p.id }))}
                    onChange={(val) => state.switchProviderService(provider, val)}
                />
            </QuickFormRow>
        );
    };

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
                            state.setProviderConfig(provider, {
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
                                state.updateActiveDrawingPresetData(provider, activeDrawingId, {
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
                                    state.updateActiveDrawingPresetData(
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
                                    state.updateActiveDrawingPresetData(
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
                                    state.updateActiveDrawingPresetData(
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
                                    state.updateActiveDrawingPresetData(
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
                                    state.updateActiveDrawingPresetData(
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
                                    state.updateActiveDrawingPresetData(
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
                                    state.updateActiveDrawingPresetData(
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
                        {renderServiceProfileRow()}
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
                                    state.updateActiveDrawingPresetData(
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
                                    state.updateActiveDrawingPresetData(
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
                        {renderServiceProfileRow()}
                        <QuickFormRow label="生图模型">
                            <SelectControl
                                value={drawingData.baseModel || 'gpt-image-1'}
                                options={buildSelectOptionsWithCurrent(
                                    [...cachedModels, ...OPENAI_MODEL_OPTIONS],
                                    drawingData.baseModel || 'gpt-image-1'
                                )}
                                onChange={(val) =>
                                    state.updateActiveDrawingPresetData(
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
                        {renderServiceProfileRow()}
                        <QuickFormRow label="生图模型">
                            <SelectControl
                                value={drawingData.baseModel || 'gemini-2.5-flash-image'}
                                options={buildSelectOptionsWithCurrent(
                                    [...cachedModels, ...GEMINI_MODEL_OPTIONS],
                                    drawingData.baseModel || 'gemini-2.5-flash-image'
                                )}
                                onChange={(val) =>
                                    state.updateActiveDrawingPresetData(
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
                        {renderServiceProfileRow()}
                        <QuickFormRow label="生图模型">
                            <SelectControl
                                value={drawingData.baseModel || 'grok-imagine-image'}
                                options={buildSelectOptionsWithCurrent(
                                    [...cachedModels, ...GROK_MODEL_OPTIONS],
                                    drawingData.baseModel || 'grok-imagine-image'
                                )}
                                onChange={(val) =>
                                    state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                                state.updateActiveDrawingPresetData(
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
                                                state.updateActiveDrawingPresetData(
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
                                state.updateActiveDrawingPresetData(provider, activeDrawingId, {
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
                                state.updateActiveDrawingPresetData(provider, activeDrawingId, {
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
                                state.updateActiveDrawingPresetData(provider, activeDrawingId, {
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
                                state.updateActiveDrawingPresetData(provider, activeDrawingId, {
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
                                state.updateActiveDrawingPresetData(provider, activeDrawingId, {
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
                                options={[...NOVELAI_SMEA_MODE_OPTIONS]}
                                onChange={(val) =>
                                    state.updateActiveDrawingPresetData(
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
                                    state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
                                                provider,
                                                activeDrawingId,
                                                { aspectRatio: 'auto' }
                                            );
                                            return;
                                        }
                                        const preset = openaiRatios.find((p) => p.id === val);
                                        if (!preset) return;
                                        state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                        state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
                                            state.updateActiveDrawingPresetData(
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
