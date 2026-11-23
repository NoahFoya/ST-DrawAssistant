/**
 * 生图服务选项卡通用视图模型 (ProviderTabViewModel)。
 *
 * @remarks
 * 统一封装 ComfyUI、SD-WebUI、NovelAI、OpenAI 兼容、Google Gemini 与 xAI Grok 各生图服务视图的数据状态与交互逻辑：
 * 1. 组合 PresetController<DrawingPresetData> 管理当前服务商的生图参数预设；
 * 2. 独立维护服务通信配置 (serverUrl / apiKey / serviceId)，支持连通性检测与服务端模型/VAE/采样器拉取；
 * 3. 响应式派生主模型、VAE、提示词预设、ComfyUI 工作流预设的下拉选项，自动对缺失引用打上失效标记；
 * 4. 统一处理内嵌提示词预设管理器与工作流管理器的增删改查联动。
 */

import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import type {
    DrawingPresetData,
    PresetItem,
    PromptPollingPoolItem,
    PromptPresetData,
    ProviderAssetCache,
    ProviderHealthResult,
    ProviderStoredConfig,
    ProviderType,
    WorkflowPresetData,
} from '@types';
import { PROMPT_POLLING_PRESET_ID } from '../../config/constants';
import { resolvePromptPollingCandidates } from '../../pipeline/prompt-pipeline';
import type { Disposable } from '../types';
import {
    buildPresetBundlePayload,
    formatBatchImportSummary,
    parsePresetBatchJson,
    readFileAsText,
    resolveBatchUniquePresetName,
} from './preset-batch-io';
import type { SelectOption, SelectOptGroup } from '../components/select';
import type { AssetFetchResult, ConnectionCardData } from '../composite/connection-card';
import type { PresetActionType } from '../composite/preset-toolbar';
import type { PromptPresetCard, PromptCardData, PromptCardPresetItem } from '../composite/prompt-preset-card';
import {
    parseComfyWorkflowInput,
    type WorkflowCard,
    type WorkflowCardData,
    type WorkflowCardPresetItem,
} from '../composite/workflow-card';
import {
    PresetController,
    resolveUniquePresetName,
    sanitizeImportedObject,
    stripJsonExtension,
    validatePresetPayloadForCategory,
} from './preset-controller';
import { normalizePresetNameKey, settingsStore } from '../../store/settings-store';
import { AssetSyncCoordinator } from '../../pipeline/asset-sync-coordinator';
import { providerRegistry } from '../../provider/registry';
import { hasProviderAssetSync } from '../../provider/base-provider';
import { eventBus } from '../../util/event-bus';
import { matchAssetText } from '../../util/asset-matcher';
import { downloadJsonFile } from '../../util/browser-io';
import { Toast } from '../feedback/toast';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { logger } from '../../util/logger';

export interface ProviderTabViewModelOptions {
    /** 提供商类型标识 */
    provider: ProviderType;
    /** 默认服务端地址 */
    defaultServerUrl: string;
    /** 默认服务商模板 ID（如 openai-official） */
    defaultServiceId?: string;
    /** 新建预设弹窗提示语 */
    promptMessageForNew?: string;
    /** 新建预设默认名称 */
    defaultNewName?: string;
    /** 新建预设 ID 前缀 */
    idPrefix?: string;
    /** 初始内置模型选项（如 NovelAI / OpenAI / Gemini / Grok 预置模型列表） */
    defaultModels?: SelectOption[];
    /** 当前预设列表为空时，新建预设所使用的初始干净草稿模板 */
    defaultDraftTemplate?: () => DrawingPresetData;
    /**
     * 启用按服务商独立保存的连接信息与资产缓存。
     * - fixedUrls: 地址由服务商固定的服务商（键为 serviceId，值为固定地址）
     * - defaultUrls: 目标服务商尚未保存自定义地址时预填的默认地址
     */
    serviceProfiles?: {
        fixedUrls?: Record<string, string>;
        defaultUrls?: Record<string, string>;
    };
    /** 初始内置 VAE 选项 */
    defaultVaes?: SelectOption[];
    /** 初始内置采样器选项 */
    defaultSamplers?: SelectOption[];
    /** 初始内置调度器选项 */
    defaultSchedulers?: SelectOption[];
    /** 是否校验 ComfyUI 工作流绑定 ID（txt2imgWorkflowId / inpaintPresetId） */
    checkWorkflowBindings?: boolean;
    /** 新建预设前的必填项校验 */
    validateRequired?: (draft: DrawingPresetData) => string[];
    /** 预设动作前置拦截校验（如 OpenAI 自定义 JSON 语法检查） */
    canPerformAction?: (
        action: PresetActionType,
        draft: DrawingPresetData
    ) => { allowed: boolean; message?: string };
    /** 自定义脏字段集计算函数 */
    evaluateDirtyFields?: (draft: DrawingPresetData, baseline: DrawingPresetData) => Set<string>;
    /** 预设应用或切换回调 */
    onPresetApplied?: (preset: PresetItem<DrawingPresetData> | null, draft: DrawingPresetData) => void;
    /** 草稿数据变更回调 */
    onDraftChanged?: (draft: DrawingPresetData) => void;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
    return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

/** 空资产缓存基准对象，用于清空或重置资产（显式将 updatedAt 设为 0，使 deepMerge 覆盖前一次同步时间戳） */
const EMPTY_ASSET_CACHE: ProviderAssetCache = Object.freeze({
    checkpoints: [],
    unets: [],
    vaes: [],
    clips: [],
    loras: [],
    samplers: [],
    schedulers: [],
    updatedAt: 0,
});

/** 补全资产缓存字段，确保数组不为 undefined 且时间戳显式归零 */
function completeAssetCache(cache?: ProviderAssetCache): ProviderAssetCache {
    return {
        checkpoints: cache?.checkpoints ? [...cache.checkpoints] : [],
        unets: cache?.unets ? [...cache.unets] : [],
        vaes: cache?.vaes ? [...cache.vaes] : [],
        clips: cache?.clips ? [...cache.clips] : [],
        loras: cache?.loras ? [...cache.loras] : [],
        samplers: cache?.samplers ? [...cache.samplers] : [],
        schedulers: cache?.schedulers ? [...cache.schedulers] : [],
        updatedAt: cache?.updatedAt ?? 0,
    };
}

export class ProviderTabViewModel implements Disposable {
    public readonly provider: ProviderType;
    private readonly options: ProviderTabViewModelOptions;

    /** 绘画参数预设状态控制器 */
    public readonly presetController: PresetController<DrawingPresetData>;

    /** 服务连接配置状态 */
    public readonly connectionData: Signal<ConnectionCardData>;

    /** 服务端分类模型映射 (如 Checkpoint 与 UNet) */
    public readonly categorizedModels: Signal<{ checkpoints: string[]; unets: string[] } | null>;
    /** 服务端拉取或预置的模型列表 */
    public readonly serverModels: Signal<string[]>;
    /** 是否已从服务端拉取过模型 */
    public readonly hasFetchedModels: Signal<boolean>;
    /** 服务端拉取的 VAE 列表 */
    public readonly serverVaes: Signal<string[]>;
    /** 是否已从服务端拉取过 VAE */
    public readonly hasFetchedVaes: Signal<boolean>;
    /** 服务端拉取的 CLIP 列表 */
    public readonly serverClips: Signal<string[]>;
    /** 是否已从服务端拉取过 CLIP */
    public readonly hasFetchedClips: Signal<boolean>;
    /** 服务端拉取的 LoRA 列表 */
    public readonly serverLoras: Signal<string[]>;
    /** 是否已从服务端拉取过 LoRA */
    public readonly hasFetchedLoras: Signal<boolean>;
    /** 当前可用采样器选项列表 */
    public readonly samplerOptions: Signal<SelectOption[]>;
    /** 当前可用调度器选项列表 */
    public readonly schedulerOptions: Signal<SelectOption[]>;

    /** 全局提示词预设列表信号 */
    public readonly promptPresets: Signal<PresetItem<PromptPresetData>[]>;
    /** 全局工作流预设列表信号 */
    public readonly workflowPresets: Signal<PresetItem<WorkflowPresetData>[]>;

    /** 合并当前预设值与服务端列表后的主模型下拉选项 (支持 optgroup 分组) */
    public readonly effectiveModelOptions: ReadonlySignal<Array<SelectOption | SelectOptGroup>>;
    /** 合并当前预设值与服务端列表后的外置 VAE 下拉选项 */
    public readonly effectiveVaeOptions: ReadonlySignal<SelectOption[]>;
    /** 派生的 CLIP 编码器下拉选项 */
    public readonly effectiveClipOptions: ReadonlySignal<SelectOption[]>;
    /** 关联提示词预设下拉选项（自动追加失效项提示） */
    public readonly promptPresetOptions: ReadonlySignal<SelectOption[]>;
    /** 文生图工作流下拉选项（自动追加失效项提示） */
    public readonly txt2imgWorkflowOptions: ReadonlySignal<SelectOption[]>;
    /** 局部重绘预设下拉选项（含未绑定项与失效项提示） */
    public readonly inpaintPresetOptions: ReadonlySignal<SelectOption[]>;

    /** 供内嵌 PromptPresetCard 消费的条目列表 */
    public readonly promptCardPresets: ReadonlySignal<PromptCardPresetItem[]>;
    /** 供内嵌 WorkflowCard 消费的条目列表 */
    public readonly workflowCardPresets: ReadonlySignal<WorkflowCardPresetItem[]>;

    private unlistenSettings: (() => void) | null = null;
    /** 第三方地址变更后延迟触发资产同步的计时器 */
    private urlSyncTimer: ReturnType<typeof setTimeout> | null = null;
    /** 资产同步请求序号，用于丢弃过期的异步响应 */
    private assetSyncGen = 0;
    /** 当前在途的资产同步中止控制器 */
    private activeAssetSyncAbort: AbortController | null = null;
    /** 内嵌子预设卡片实例引用，用于跨选项卡脏状态汇聚与保存 */
    private promptCardRef: PromptPresetCard | null = null;
    private workflowCardRef: WorkflowCard | null = null;
    private isDisposed = false;

    /** 注册内嵌提示词预设卡片实例 */
    public registerPromptCard(card: PromptPresetCard | null): void {
        this.promptCardRef = card;
    }

    /** 注册内嵌工作流预设卡片实例 */
    public registerWorkflowCard(card: WorkflowCard | null): void {
        this.workflowCardRef = card;
    }

    /** 查询主预设及内嵌提示词/工作流卡片是否存在未保存草稿 */
    public hasUnsavedChanges(): boolean {
        return (
            this.presetController.isDirty.value ||
            Boolean(this.promptCardRef?.isDirty()) ||
            Boolean(this.workflowCardRef?.isDirty())
        );
    }

    /** 依次保存主预设与内嵌提示词/工作流卡片的未保存修改 */
    public async saveUnsavedChanges(): Promise<boolean> {
        if (this.workflowCardRef?.isDirty()) {
            const ok = await this.workflowCardRef.saveDraft();
            if (!ok) return false;
        }
        if (this.promptCardRef?.isDirty()) {
            const ok = await this.promptCardRef.saveDraft();
            if (!ok) return false;
        }
        if (this.presetController.isDirty.value) {
            return await this.presetController.handleAction('save');
        }
        return true;
    }

    /** 放弃主预设及内嵌卡片全部未保存草稿 */
    public discardUnsavedChanges(): void {
        this.workflowCardRef?.discardDraft();
        this.promptCardRef?.discardDraft();
        this.presetController.discardDraft();
    }

    /** 是否按服务商独立保存连接信息与资产缓存 */
    public get hasServiceProfiles(): boolean {
        return Boolean(this.options.serviceProfiles);
    }

    /** 当前提供方是否支持从服务端拉取模型/LoRA/采样器等资产 */
    public get supportsAssetSync(): boolean {
        return hasProviderAssetSync(providerRegistry.getProvider(this.provider));
    }

    public constructor(options: ProviderTabViewModelOptions) {
        this.provider = options.provider;
        this.options = options;

        const providerCfg = this.readProviderStoreConfig();
        this.connectionData = signal<ConnectionCardData>(this.buildConnectionData(providerCfg));

        // 优先使用本地持久化资产缓存初始化下拉选项
        const cache = providerCfg.assetCache;
        const cachedCheckpoints = !this.supportsAssetSync ? [] : cache?.checkpoints || [];
        const cachedUnets = !this.supportsAssetSync ? [] : cache?.unets || [];
        if (cachedCheckpoints.length > 0 || cachedUnets.length > 0) {
            this.categorizedModels = signal<{ checkpoints: string[]; unets: string[] } | null>({
                checkpoints: cachedCheckpoints,
                unets: cachedUnets,
            });
            this.serverModels = signal<string[]>([...cachedCheckpoints, ...cachedUnets]);
            this.hasFetchedModels = signal<boolean>(true);
        } else {
            this.categorizedModels = signal<{ checkpoints: string[]; unets: string[] } | null>(null);
            this.serverModels = signal<string[]>([]);
            this.hasFetchedModels = signal<boolean>(false);
        }

        const cachedVaes = cache?.vaes || [];
        this.serverVaes = signal<string[]>(cachedVaes);
        this.hasFetchedVaes = signal<boolean>(cachedVaes.length > 0);

        const cachedClips = cache?.clips || [];
        this.serverClips = signal<string[]>(cachedClips);
        this.hasFetchedClips = signal<boolean>(cachedClips.length > 0);

        const cachedLoras = cache?.loras || [];
        this.serverLoras = signal<string[]>(cachedLoras);
        this.hasFetchedLoras = signal<boolean>(cachedLoras.length > 0);

        const cachedSamplers = cache?.samplers;
        this.samplerOptions = signal<SelectOption[]>(
            cachedSamplers?.length
                ? cachedSamplers.map((s) => ({ label: s, value: s }))
                : options.defaultSamplers ?? []
        );

        const cachedSchedulers = cache?.schedulers;
        this.schedulerOptions = signal<SelectOption[]>(
            cachedSchedulers?.length
                ? cachedSchedulers.map((s) => ({ label: s, value: s }))
                : options.defaultSchedulers ?? []
        );

        // 按当前生图服务加载对应的提示词预设列表
        this.promptPresets = signal<PresetItem<PromptPresetData>[]>(
            settingsStore.getPresets<PromptPresetData>('prompts', this.provider)
        );
        this.workflowPresets = signal<PresetItem<WorkflowPresetData>[]>(
            settingsStore.getPresets<WorkflowPresetData>('workflows')
        );

        this.presetController = new PresetController<DrawingPresetData>({
            category: 'drawing',
            provider: this.provider,
            idPrefix: options.idPrefix ?? `${this.provider}_preset_`,
            promptMessageForNew: options.promptMessageForNew ?? '请输入新生图参数预设名称:',
            defaultNewName: options.defaultNewName ?? '新建预设',
            promptMessageForSaveAs: '请输入另存生图参数预设的新名称:',
            promptMessageForRename: '请输入生图参数预设的新名称:',
            defaultTemplate: () => {
                const list = settingsStore.getPresets<DrawingPresetData>('drawing', this.provider);
                if (list[0]?.data) {
                    return structuredClone(list[0].data);
                }
                return options.defaultDraftTemplate
                    ? options.defaultDraftTemplate()
                    : ({} as DrawingPresetData);
            },
            exportFilenamePrefix: `${this.provider}_preset_`,
            getActiveId: () => this.readProviderStoreConfig().activeDrawingPresetId || '',
            setActiveId: (id) => {
                settingsStore.setProviderConfig(this.provider, {
                    activeDrawingPresetId: id,
                });
            },
            onPresetApplied: options.onPresetApplied,
            onDraftChanged: options.onDraftChanged,
            validateRequired: options.validateRequired,
            canPerformAction: options.canPerformAction,
            evaluateDirtyFields: options.evaluateDirtyFields,
            evaluateInvalidFields: (draft) => this.computeInvalidBindings(draft),
            showToast: true,
        });

        // 1. 派生主模型下拉选项 (支持类别分组)
        this.effectiveModelOptions = computed(() => {
            const currentModel = (this.presetController.draftConfig.value.baseModel as string) || '';
            const cat = this.categorizedModels.value;
            const fetched = this.serverModels.value;
            const hasFetched = this.hasFetchedModels.value;
            const defaults = this.options.defaultModels ?? [];

            // 若返回分类模型数据（如 ComfyUI），按照 Checkpoint 与 UNet / 扩散模型分组展示
            if (hasFetched && cat && (cat.checkpoints.length > 0 || cat.unets.length > 0)) {
                const groups: Array<SelectOption | SelectOptGroup> = [];
                if (cat.checkpoints.length > 0) {
                    groups.push({
                        label: 'Checkpoint (完整模型)',
                        options: cat.checkpoints.map((m) => ({ label: m, value: m })),
                    });
                }
                if (cat.unets.length > 0) {
                    groups.push({
                        label: 'UNet / 扩散模型',
                        options: cat.unets.map((m) => ({ label: m, value: m })),
                    });
                }
                const allKnown = [...cat.checkpoints, ...cat.unets];
                if (currentModel && !allKnown.includes(currentModel)) {
                    groups.unshift({
                        label: currentModel,
                        value: currentModel,
                    });
                }
                return groups;
            }

            // 扁平模型列表常规展示
            if (hasFetched && fetched.length > 0) {
                const baseList: SelectOption[] =
                    defaults.length > 0
                        ? [
                              ...defaults,
                              ...fetched
                                  .filter((m) => !defaults.some((d) => d.value === m))
                                  .map((m) => ({ label: m, value: m })),
                          ]
                        : fetched.map((m) => ({ label: m, value: m }));

                if (currentModel && !baseList.some((o) => o.value === currentModel)) {
                    return [
                        { label: currentModel, value: currentModel },
                        ...baseList,
                    ];
                }
                return baseList;
            }

            if (defaults.length > 0) {
                if (currentModel && !defaults.some((o) => o.value === currentModel)) {
                    return [{ label: currentModel, value: currentModel }, ...defaults];
                }
                return defaults;
            }

            return currentModel
                ? [{ label: currentModel, value: currentModel }]
                : [{ label: '未选择主模型', value: '' }];
        });

        // 2. 派生外置 VAE 下拉选项
        this.effectiveVaeOptions = computed(() => {
            const currentVae =
                (this.presetController.draftConfig.value.vaeName as string) || '';
            const fetched = this.serverVaes.value;
            const hasFetched = this.hasFetchedVaes.value;
            const isComfy = this.provider === 'comfyui';

            const defaultLabel = isComfy ? '使用模型内置' : '自动匹配 (automatic)';
            const defaultValue = isComfy ? '' : 'automatic';

            const baseOpts: SelectOption[] = [
                { label: defaultLabel, value: defaultValue },
            ];
            if (!isComfy) {
                baseOpts.push({ label: '不使用外置 VAE (None)', value: 'None' });
            }

            if (hasFetched && fetched.length > 0) {
                const opts: SelectOption[] = [
                    ...baseOpts,
                    ...fetched.map((v) => ({ label: v, value: v })),
                ];
                if (currentVae && currentVae !== defaultValue && !fetched.includes(currentVae)) {
                    opts.splice(1, 0, {
                        label: currentVae,
                        value: currentVae,
                    });
                }
                return opts;
            }

            if (this.options.defaultVaes) {
                baseOpts.push(...this.options.defaultVaes.filter((o) => o.value !== defaultValue));
            }

            if (currentVae && !baseOpts.some((o) => o.value === currentVae)) {
                baseOpts.push({ label: currentVae, value: currentVae });
            }
            return baseOpts;
        });

        // 3. 派生 CLIP 编码器下拉选项
        this.effectiveClipOptions = computed(() => {
            const currentClip =
                (this.presetController.draftConfig.value.clipName as string) || '';
            const fetched = this.serverClips.value;
            const hasFetched = this.hasFetchedClips.value;

            const opts: SelectOption[] = [{ label: '使用模型内置', value: '' }];
            if (hasFetched && fetched.length > 0) {
                opts.push(...fetched.map((c) => ({ label: c, value: c })));
            }

            if (currentClip && !opts.some((o) => o.value === currentClip)) {
                opts.push({ label: currentClip, value: currentClip });
            }
            return opts;
        });

        // 4. 派生提示词预设下拉选项
        this.promptPresetOptions = computed(() => {
            const prompts = this.promptPresets.value;
            const boundId = this.presetController.draftConfig.value.promptPresetId || '';
            const opts: SelectOption[] = [
                {
                    label: '未选择提示词预设',
                    value: '',
                },
                {
                    label: '使用轮询 (随机抽取提示词预设)',
                    value: PROMPT_POLLING_PRESET_ID,
                },
                ...prompts.map((p) => ({
                    label: p.name || '未命名提示词预设',
                    value: p.id,
                })),
            ];
            if (
                boundId &&
                boundId !== PROMPT_POLLING_PRESET_ID &&
                !prompts.some((p) => p.id === boundId)
            ) {
                opts.splice(2, 0, {
                    label: boundId,
                    value: boundId,
                });
            }
            return opts;
        });

        // 5. 派生文生图工作流下拉选项
        this.txt2imgWorkflowOptions = computed(() => {
            const workflows = this.workflowPresets.value;
            const boundId = this.presetController.draftConfig.value.txt2imgWorkflowId || '';
            const opts: SelectOption[] = workflows.map((w) => ({
                label: w.name,
                value: w.id,
            }));
            if (boundId && !workflows.some((w) => w.id === boundId)) {
                opts.unshift({
                    label: boundId,
                    value: boundId,
                });
            }
            return opts;
        });

        // 6. 派生局部重绘工作流下拉选项
        this.inpaintPresetOptions = computed(() => {
            const workflows = this.workflowPresets.value;
            const boundId = this.presetController.draftConfig.value.inpaintPresetId || '';
            const opts: SelectOption[] = [
                { label: '未选择局部重绘工作流', value: '' },
                ...workflows.map((w) => ({
                    label: w.name,
                    value: w.id,
                })),
            ];
            if (boundId && !workflows.some((w) => w.id === boundId)) {
                opts.unshift({
                    label: boundId,
                    value: boundId,
                });
            }
            return opts;
        });

        // 7. 派生 PromptPresetCard 条目列表
        this.promptCardPresets = computed(() =>
            this.promptPresets.value.map((p) => ({
                id: p.id,
                name: p.name,
                data: {
                    positivePrefix: p.data?.positivePrefix || '',
                    positiveSuffix: p.data?.positiveSuffix || '',
                    negativePrompt: p.data?.negativePrompt || '',
                    loraSyntaxMode: p.data?.loraSyntaxMode || 'standard',
                    loras: (p.data?.loras || []).map((l, idx) => ({
                        id: `lora_${p.id}_${idx}`,
                        enabled: l.enabled !== false,
                        modelName: l.modelName || '',
                        modelWeight: l.modelWeight ?? 0.8,
                        clipWeight: l.clipWeight ?? l.modelWeight ?? 0.8,
                        triggerWeight: l.triggerWeight ?? 1.0,
                        triggerMode: l.triggerMode === 'keyword' ? 'keyword' : 'always',
                        keywords: l.keywords ?? '',
                    })),
                },
            }))
        );

        // 8. 派生 WorkflowCard 条目列表
        this.workflowCardPresets = computed(() =>
            this.workflowPresets.value.map((w) => ({
                id: w.id,
                name: w.name,
                data: {
                    json: w.data?.workflow ? JSON.stringify(w.data.workflow, null, 2) : '{}',
                },
            }))
        );
    }

    /**
     * 读取当前提供商在 SettingsStore 中的持久化配置。
     */
    private readProviderStoreConfig(): ProviderStoredConfig {
        return settingsStore.getProviderConfig<ProviderStoredConfig>(this.provider) || {};
    }

    /**
     * 根据持久化的提供商配置构建前端连接卡片数据。
     */
    private buildConnectionData(cfg: ProviderStoredConfig): ConnectionCardData {
        return {
            serverUrl: cfg.serverUrl !== undefined ? cfg.serverUrl : this.options.defaultServerUrl,
            apiKey: cfg.apiKey || '',
            activePresetId: cfg.serviceId || this.options.defaultServiceId,
        };
    }

    /**
     * 计算当前预设绑定的资产模型、提示词预设 ID、工作流预设 ID 是否失效。
     */
    private computeInvalidBindings(draft: DrawingPresetData): Set<string> {
        const invalid = new Set<string>();

        // 1. 校验主模型（填写了自定义模型标识时生图以自定义标识为准，不再校验下拉所选模型）
        const currentModel = (draft.baseModel as string) || '';
        const hasCustomModel = Boolean(((draft.customModel as string) || '').trim());
        const fetchedModels = this.serverModels.value;
        const hasFetchedModels = this.hasFetchedModels.value;
        if (
            currentModel &&
            !hasCustomModel &&
            hasFetchedModels &&
            fetchedModels.length > 0 &&
            !matchAssetText(currentModel, fetchedModels)
        ) {
            invalid.add('baseModel');
        }

        // 2. 校验外置 VAE
        const currentVae = (draft.vaeName as string) || '';
        const fetchedVaes = this.serverVaes.value;
        const hasFetchedVaes = this.hasFetchedVaes.value;
        const defaultVae = this.provider === 'comfyui' ? '' : 'automatic';
        if (
            currentVae &&
            currentVae !== defaultVae &&
            currentVae !== 'None' &&
            currentVae !== 'none' &&
            hasFetchedVaes &&
            fetchedVaes.length > 0 &&
            !matchAssetText(currentVae, fetchedVaes)
        ) {
            invalid.add('vaeName');
        }

        // 3. 校验 CLIP 编码器
        const currentClip = (draft.clipName as string) || '';
        const fetchedClips = this.serverClips.value;
        const hasFetchedClips = this.hasFetchedClips.value;
        if (
            currentClip &&
            hasFetchedClips &&
            fetchedClips.length > 0 &&
            !matchAssetText(currentClip, fetchedClips)
        ) {
            invalid.add('clipName');
        }

        // 4. 校验提示词预设绑定（'__polling__' 模式下校验显式池是否至少有一项有效启用条目）
        const prompts = this.promptPresets.value;
        if (draft.promptPresetId === PROMPT_POLLING_PRESET_ID) {
            const pollingInfo = resolvePromptPollingCandidates(
                settingsStore,
                this.provider,
                draft
            );
            if (pollingInfo.hasExplicitPool && pollingInfo.candidates.length === 0) {
                invalid.add('promptPresetId');
            }
        } else if (draft.promptPresetId && !prompts.some((p) => p.id === draft.promptPresetId)) {
            invalid.add('promptPresetId');
        }

        // 5. 校验工作流绑定
        if (this.options.checkWorkflowBindings) {
            const workflows = this.workflowPresets.value;
            if (
                draft.txt2imgWorkflowId &&
                !workflows.some((w) => w.id === draft.txt2imgWorkflowId)
            ) {
                invalid.add('txt2imgWorkflowId');
            }
            if (
                draft.inpaintPresetId &&
                !workflows.some((w) => w.id === draft.inpaintPresetId)
            ) {
                invalid.add('inpaintPresetId');
            }
        }
        return invalid;
    }

    /**
     * 更新服务连接参数并即时写回 SettingsStore。
     *
     * @remarks
     * 按服务商独立保存配置的提供商，地址变更后原服务端资产缓存已不适用：立即清空缓存与模型列表，
     * 并在输入停顿后重新同步。
     */
    public updateConnection(data: ConnectionCardData): void {
        const prevUrl = this.connectionData.value.serverUrl;
        this.connectionData.value = { ...data };
        const patch: Record<string, unknown> = {
            serverUrl: data.serverUrl,
        };
        if (data.apiKey !== undefined) {
            patch.apiKey = data.apiKey;
        }
        if (data.activePresetId !== undefined) {
            patch.serviceId = data.activePresetId;
        }

        const urlChanged = data.serverUrl !== prevUrl;
        if (urlChanged && this.supportsAssetSync) {
            this.cancelInFlightAssetSync();
            patch.assetCache = EMPTY_ASSET_CACHE;
        }
        settingsStore.setProviderConfig(this.provider, patch);

        if (urlChanged && this.supportsAssetSync) {
            this.loadAssetSignals(undefined);
            this.scheduleAssetSync();
        }
    }

    /**
     * 切换服务商。
     *
     * @remarks
     * 1. 把当前服务商的地址、密钥与资产缓存暂存到 serviceProfiles；
     * 2. 载入目标服务商此前保存的连接信息与缓存（地址固定的服务商使用固定地址）；
     * 3. 支持服务端资产同步的提供方，重置内存资产信号并在有变化时触发静默同步。
     */
    public switchService(nextId: string): void {
        const prevId = this.connectionData.value.activePresetId || this.options.defaultServiceId;
        if (!this.hasServiceProfiles || !prevId || nextId === prevId) {
            return;
        }
        this.cancelInFlightAssetSync();

        const cfg = this.readProviderStoreConfig();
        const next = cfg.serviceProfiles?.[nextId];
        const fixedUrl = this.options.serviceProfiles?.fixedUrls?.[nextId];
        const defaultUrl = this.options.serviceProfiles?.defaultUrls?.[nextId];
        const nextUrl = fixedUrl ?? (next?.serverUrl || defaultUrl) ?? '';
        const nextApiKey = next?.apiKey ?? '';

        settingsStore.setProviderConfig(this.provider, {
            serviceId: nextId,
            serverUrl: nextUrl,
            apiKey: nextApiKey,
            assetCache: completeAssetCache(next?.assetCache),
            serviceProfiles: {
                [prevId]: {
                    serverUrl: cfg.serverUrl ?? '',
                    apiKey: cfg.apiKey ?? '',
                    assetCache: completeAssetCache(cfg.assetCache),
                },
            },
        });

        this.connectionData.value = {
            serverUrl: nextUrl,
            apiKey: nextApiKey,
            activePresetId: nextId,
        };
        if (this.supportsAssetSync) {
            this.loadAssetSignals(next?.assetCache);
            this.scheduleAssetSync(0);
        }
    }

    /** 延迟触发一次后台资产同步，合并短时间内的连续触发 */
    private scheduleAssetSync(delayMs = 800): void {
        if (this.urlSyncTimer) {
            clearTimeout(this.urlSyncTimer);
        }
        this.urlSyncTimer = setTimeout(() => {
            this.urlSyncTimer = null;
            void this.runBackgroundAssetSync();
        }, delayMs);
    }

    /** 以指定缓存重置内存中的全部资产信号；缓存为空时回到未拉取状态 */
    private loadAssetSignals(cache: ProviderAssetCache | undefined): void {
        const checkpoints = !this.supportsAssetSync ? [] : cache?.checkpoints ?? [];
        const unets = !this.supportsAssetSync ? [] : cache?.unets ?? [];
        const hasModels = checkpoints.length > 0 || unets.length > 0;
        this.categorizedModels.value = hasModels ? { checkpoints, unets } : null;
        this.serverModels.value = [...checkpoints, ...unets];
        this.hasFetchedModels.value = hasModels;

        this.serverVaes.value = cache?.vaes ?? [];
        this.hasFetchedVaes.value = this.serverVaes.value.length > 0;
        this.serverClips.value = cache?.clips ?? [];
        this.hasFetchedClips.value = this.serverClips.value.length > 0;
        this.serverLoras.value = cache?.loras ?? [];
        this.hasFetchedLoras.value = this.serverLoras.value.length > 0;

        this.samplerOptions.value = cache?.samplers?.length
            ? cache.samplers.map((s) => ({ label: s, value: s }))
            : this.options.defaultSamplers ?? [];
        this.schedulerOptions.value = cache?.schedulers?.length
            ? cache.schedulers.map((s) => ({ label: s, value: s }))
            : this.options.defaultSchedulers ?? [];
    }

    /**
     * 执行提供商连通性健康检测（统一返回 ProviderHealthResult）。
     */
    public async testPing(signal?: AbortSignal): Promise<ProviderHealthResult> {
        const provider = providerRegistry.getProvider(this.provider);
        if (!provider?.checkHealth) {
            throw new Error(`未注册 ${this.provider} 服务提供方`);
        }
        return await provider.checkHealth(signal);
    }

    /**
     * 从服务端拉取模型、VAE、LoRA 与采样器列表，持久化至本地资产缓存并合并到响应式信号中。
     *
     * @param silent 是否以静默模式运行（静默模式下仅在资产发生增删变动或当前预设资产失效时提示用户）
     * @param options 可选调用控制参数，如已完成连通性校验时可跳过前置健康检查与传入中止信号
     */
    public async refreshServerAssets(
        silent = false,
        options?: { skipHealthCheck?: boolean; signal?: AbortSignal }
    ): Promise<AssetFetchResult> {
        const provider = providerRegistry.getProvider(this.provider);

        if (!provider) {
            throw new Error(`未注册 ${this.provider} 服务提供方`);
        }

        if (!hasProviderAssetSync(provider)) {
            return {
                count: 0,
                message: '当前服务不支持模型列表拉取',
            };
        }

        const externalSignal = options?.signal;
        if (externalSignal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        this.cancelInFlightAssetSync();
        const reqGen = this.assetSyncGen;
        const localAbort = new AbortController();
        this.activeAssetSyncAbort = localAbort;
        const onExternalAbort = () => localAbort.abort();
        externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

        try {
            const syncRes = await AssetSyncCoordinator.syncProviderAssets(this.provider, {
                isManual: !silent,
                silentIfNoChange: silent,
                skipHealthCheck: options?.skipHealthCheck,
                signal: localAbort.signal,
                throwOnError: true,
            });

            if (!syncRes || this.isDisposed || reqGen !== this.assetSyncGen) {
                return { count: 0, message: '请求已过期' };
            }

            const updatedCache = this.readProviderStoreConfig().assetCache;
            this.loadAssetSignals(updatedCache);

            if (typeof provider.fetchCategorizedModels === 'function' || typeof provider.fetchModels === 'function') {
                this.hasFetchedModels.value = true;
            }
            if (typeof provider.fetchVaes === 'function') {
                this.hasFetchedVaes.value = true;
            }
            if (typeof provider.fetchClips === 'function') {
                this.hasFetchedClips.value = true;
            }
            if (typeof provider.fetchLoras === 'function') {
                this.hasFetchedLoras.value = true;
            }
            if (typeof provider.fetchSamplers === 'function') {
                this.samplerOptions.value = (updatedCache?.samplers || []).map((s) => ({
                    label: s,
                    value: s,
                }));
            }
            const schedProvider = provider as { fetchSchedulers?: (sig?: AbortSignal) => Promise<string[]> };
            if (typeof schedProvider.fetchSchedulers === 'function') {
                this.schedulerOptions.value = (updatedCache?.schedulers || []).map((s) => ({
                    label: s,
                    value: s,
                }));
            }

            return {
                count: syncRes.totalCount,
                message: syncRes.message,
            };
        } catch (err: unknown) {
            if (externalSignal?.aborted) {
                throw err instanceof DOMException && err.name === 'AbortError'
                    ? err
                    : new DOMException('Aborted', 'AbortError');
            }
            if (this.isDisposed || reqGen !== this.assetSyncGen) {
                return { count: 0, message: '请求已过期' };
            }
            throw err;
        } finally {
            externalSignal?.removeEventListener('abort', onExternalAbort);
            if (this.activeAssetSyncAbort === localAbort) {
                this.activeAssetSyncAbort = null;
            }
        }
    }

    /**
     * 更新当前生图参数预设草稿的提示词轮询候选池配置。
     */
    public updatePromptPollingPool(pool: PromptPollingPoolItem[]): void {
        this.presetController.updateDraft(
            'promptPollingPool',
            pool.map((item) => ({ ...item }))
        );
    }

    /**
     * 刷新当前提供商专属提示词与全局工作流预设池信号。
     */
    public refreshAssetPools(): void {
        this.promptPresets.value = settingsStore.getPresets<PromptPresetData>('prompts', this.provider);
        this.workflowPresets.value = settingsStore.getPresets<WorkflowPresetData>('workflows');
    }

    private generateAssetUniqueId(
        category: 'prompts' | 'workflows',
        idPrefix: string,
        providerScope?: string
    ): string {
        const existingIds = new Set(
            settingsStore.getPresets(category, providerScope).map((p) => p.id)
        );
        const now = Date.now();
        let candidate = `${idPrefix}${now}`;
        let seq = 1;
        while (existingIds.has(candidate)) {
            candidate = `${idPrefix}${now}_${seq++}`;
        }
        return candidate;
    }

    /** 内部统一辅助：处理内嵌提示词预设与工作流预设的增删改查及导出 */
    private async runAssetPresetAction<TData>(cfg: {
        category: 'prompts' | 'workflows';
        providerScope?: string;
        draftField: 'promptPresetId' | 'txt2imgWorkflowId';
        idPrefix: string;
        label: string;
        filePrefix: string;
        buildSaveData: (existing: TData) => TData | null;
        buildExportData?: (existing: TData) => TData | null;
        buildNewData: () => TData;
        buildCloneData: () => TData | null;
    }, action: PresetActionType, id: string): Promise<boolean> {
        const { category, providerScope, draftField, idPrefix, label, filePrefix } = cfg;

        if (action === 'select') {
            this.presetController.updateDraft(draftField, id);
        } else if (action === 'save') {
            const cur = settingsStore.getPreset<TData>(category, id, providerScope);
            if (!cur) return false;
            const nextData = cfg.buildSaveData(cur.data);
            if (nextData === null) return false;
            const updated: PresetItem<TData> = {
                ...cur,
                data: nextData,
                updatedAt: Date.now(),
            };
            settingsStore.savePreset(category, updated, providerScope);
            Toast.show(`${label} "${updated.name}" 已保存`, { level: 'success' });
        } else if (action === 'new' || action === 'saveAs') {
            const list = settingsStore.getPresets<TData>(category, providerScope);
            const existingNames = new Set(list.map((p) => normalizePresetNameKey(p.name)));
            const cur = id ? settingsStore.getPreset<TData>(category, id, providerScope) : undefined;
            const defaultName = cur ? `${cur.name} (副本)` : `新建${label}`;

            const newName = await ConfirmDialog.prompt({
                title: `新建 / 另存为${label}`,
                message: `请输入新${label}名称:`,
                defaultValue: defaultName,
                placeholder: `请输入${label}名称`,
                validator: (val) => {
                    const trimmed = val.trim();
                    if (!trimmed) return '预设名称不能为空';
                    return existingNames.has(normalizePresetNameKey(trimmed))
                        ? '预设名称已存在，请换一个名称'
                        : null;
                },
            });
            if (!newName || !newName.trim()) return false;

            const resolvedData = cur ? cfg.buildCloneData() : cfg.buildNewData();
            if (resolvedData === null) return false;

            const newId = this.generateAssetUniqueId(category, idPrefix, providerScope);
            const item: PresetItem<TData> = {
                id: newId,
                name: newName.trim(),
                data: resolvedData,
                updatedAt: Date.now(),
            };
            settingsStore.savePreset(category, item, providerScope);
            this.presetController.updateDraft(draftField, newId);
            Toast.show(`已创建${label}: ${item.name}`, { level: 'success' });
        } else if (action === 'rename') {
            const cur = settingsStore.getPreset<TData>(category, id, providerScope);
            if (!cur) return false;

            const list = settingsStore.getPresets<TData>(category, providerScope);
            const otherNames = new Set(
                list.filter((p) => p.id !== id).map((p) => normalizePresetNameKey(p.name))
            );
            const newName = await ConfirmDialog.prompt({
                title: `重命名${label}`,
                message: `请输入${label}新名称:`,
                defaultValue: cur.name,
                placeholder: `请输入${label}新名称`,
                validator: (val) => {
                    const trimmed = val.trim();
                    if (!trimmed) return '预设名称不能为空';
                    if (trimmed === cur.name) return '新名称不能与当前名称相同';
                    if (otherNames.has(normalizePresetNameKey(trimmed))) return '预设名称已存在，请换一个名称';
                    return null;
                },
            });
            if (!newName || !newName.trim() || newName.trim() === cur.name) return false;

            const updated: PresetItem<TData> = {
                ...cur,
                name: newName.trim(),
                updatedAt: Date.now(),
            };
            settingsStore.savePreset(category, updated, providerScope);
            Toast.show(`已重命名${label}为 "${updated.name}"`, { level: 'success' });
        } else if (action === 'export') {
            const cur = settingsStore.getPreset<TData>(category, id, providerScope);
            if (!cur) return false;
            const exportData = cfg.buildExportData ? cfg.buildExportData(cur.data) : cur.data;
            if (exportData === null) return false;
            const exportPayload: PresetItem<TData> = {
                ...cur,
                data: exportData,
                updatedAt: Date.now(),
            };
            const safeName = (cur.name || cur.id).replace(/\s+/g, '_');
            downloadJsonFile(`${filePrefix}${safeName}.json`, exportPayload);
        } else if (action === 'exportAll') {
            const list = settingsStore.getPresets<TData>(category, providerScope);
            if (list.length === 0) {
                Toast.show(`当前没有可导出的${label}`, { level: 'warning' });
                return false;
            }
            const bundle = buildPresetBundlePayload(
                category,
                list,
                providerScope as ProviderType | undefined
            );
            downloadJsonFile(`${filePrefix}all_${list.length}.json`, bundle);
            Toast.show(`已批量导出 ${list.length} 项${label}`, { level: 'success' });
        } else if (action === 'delete') {
            const list = settingsStore.getPresets<TData>(category, providerScope);
            if (list.length <= 1) {
                Toast.show(`至少保留一套${label}，无法删除`, { level: 'warning' });
                return false;
            }
            const targetItem = list.find((p) => p.id === id);
            const confirmed = await ConfirmDialog.confirm({
                title: `删除${label}确认`,
                message: `确定要删除${label}「${targetItem?.name || id}」吗？此操作无法撤销。`,
                isDanger: true,
                confirmText: '删除',
            });
            if (!confirmed) return false;
            settingsStore.deletePreset(category, id, providerScope);
            const remaining = settingsStore.getPresets<TData>(category, providerScope);
            if (!this.presetController.isDirty.value) {
                this.presetController.reloadFromStore();
            } else {
                const draft = this.presetController.draftConfig.value;
                const patch: Partial<DrawingPresetData> = {};
                if (category === 'prompts') {
                    if (draft.promptPresetId === id) {
                        patch.promptPresetId = remaining[0]?.id || '';
                    }
                    if (
                        Array.isArray(draft.promptPollingPool) &&
                        draft.promptPollingPool.some((item) => item?.presetId === id)
                    ) {
                        patch.promptPollingPool = draft.promptPollingPool.filter(
                            (item) => item?.presetId !== id
                        );
                    }
                } else if (category === 'workflows') {
                    if (draft.txt2imgWorkflowId === id) {
                        patch.txt2imgWorkflowId = '';
                    }
                    if (draft.inpaintPresetId === id) {
                        patch.inpaintPresetId = '';
                    }
                }
                if (Object.keys(patch).length > 0) {
                    this.presetController.patchDraft(patch);
                }
            }
            Toast.show(`${label}已删除`, { level: 'info' });
        } else if (action === 'reset') {
            Toast.show('已放弃未保存修改', { level: 'info' });
        }
        this.refreshAssetPools();
        return true;
    }

    /** 内部统一辅助：批量读取并导入外部提示词预设或工作流预设 JSON 文件 */
    private async runAssetPresetImportFiles<TData>(
        files: File[],
        cfg: {
            category: 'prompts' | 'workflows';
            providerScope?: string;
            draftField: 'promptPresetId' | 'txt2imgWorkflowId';
            idPrefix: string;
            label: string;
            parseFile: (rawText: string, file: File) => Array<{ name: string; data: TData }>;
        }
    ): Promise<void> {
        if (this.isDisposed || files.length === 0) return;

        const list = settingsStore.getPresets<TData>(cfg.category, cfg.providerScope);
        const existingNames = new Set(list.map((p) => normalizePresetNameKey(p.name)));
        const fallbackName = `导入的${cfg.label}`;

        const validCandidates: Array<{ name: string; data: TData }> = [];
        let failedCount = 0;
        let firstError: string | undefined;

        for (const file of files) {
            try {
                const rawText = await readFileAsText(file);
                if (this.isDisposed) return;
                const items = cfg.parseFile(rawText, file);
                if (items.length === 0) {
                    failedCount += 1;
                    firstError ??= `${file.name} 未包含有效预设`;
                    continue;
                }
                validCandidates.push(...items);
            } catch (err: unknown) {
                failedCount += 1;
                firstError ??= err instanceof Error ? err.message : String(err);
            }
        }

        if (validCandidates.length === 0) {
            Toast.show(formatBatchImportSummary(0, failedCount, firstError), { level: 'error' });
            return;
        }

        const targetCard =
            cfg.draftField === 'txt2imgWorkflowId'
                ? this.workflowCardRef
                : this.promptCardRef;
        if (targetCard?.isDirty()) {
            const confirmed = await ConfirmDialog.confirm({
                title: `导入${cfg.label}确认`,
                message: `当前${cfg.label}存在未保存的修改，导入并切换新预设将放弃当前未保存修改。是否确定继续导入？`,
            });
            if (!confirmed || this.isDisposed) return;
        }

        const isSingleInteractive = validCandidates.length === 1 && files.length === 1;
        let lastImportedId = '';
        let lastImportedName = '';
        let importedCount = 0;

        for (const candidate of validCandidates) {
            let finalName: string | null = null;
            if (isSingleInteractive) {
                finalName = await resolveUniquePresetName(
                    candidate.name,
                    existingNames,
                    fallbackName
                );
                if (!finalName || this.isDisposed) return;
            } else {
                finalName = resolveBatchUniquePresetName(
                    candidate.name,
                    existingNames,
                    fallbackName
                );
            }

            const newId = this.generateAssetUniqueId(
                cfg.category,
                cfg.idPrefix,
                cfg.providerScope
            );
            const importedItem: PresetItem<TData> = {
                id: newId,
                name: finalName,
                data: sanitizeImportedObject(candidate.data),
                updatedAt: Date.now(),
            };
            settingsStore.savePreset(cfg.category, importedItem, cfg.providerScope);
            lastImportedId = newId;
            lastImportedName = finalName;
            importedCount += 1;
        }

        if (lastImportedId) {
            this.presetController.updateDraft(cfg.draftField, lastImportedId);
        }
        this.refreshAssetPools();

        if (importedCount === 1 && failedCount === 0) {
            Toast.show(`已成功导入${cfg.label}: ${lastImportedName}`, { level: 'success' });
        } else {
            Toast.show(formatBatchImportSummary(importedCount, failedCount, firstError), {
                level: failedCount > 0 ? 'warning' : 'success',
            });
        }
    }

    /**
     * 响应内嵌 PromptPresetCard 的操作动作。
     */
    public async handlePromptAssetAction(
        action: PresetActionType,
        pId: string,
        data?: PromptCardData
    ): Promise<boolean> {
        const effectiveData = data ?? this.promptCardRef?.getValue();
        if (action === 'save' && !effectiveData) {
            return false;
        }
        const buildPromptData = (src?: PromptCardData, existing?: PromptPresetData): PromptPresetData => ({
            ...existing,
            positivePrefix: src?.positivePrefix || '',
            positiveSuffix: src?.positiveSuffix || '',
            negativePrompt: src?.negativePrompt || '',
            loraSyntaxMode: src?.loraSyntaxMode || (this.provider === 'comfyui' ? 'weilin' : 'standard'),
            loras: (src?.loras || [])
                .filter((l) => Boolean(l.modelName?.trim()))
                .map((l) => ({
                    modelName: l.modelName.trim(),
                    modelWeight: l.modelWeight,
                    clipWeight: l.clipWeight,
                    triggerWeight: l.triggerWeight,
                    enabled: l.enabled,
                    triggerMode: l.triggerMode === 'keyword' ? 'keyword' : 'always',
                    keywords: l.keywords ?? '',
                })),
        });

        return await this.runAssetPresetAction<PromptPresetData>(
            {
                category: 'prompts',
                providerScope: this.provider,
                draftField: 'promptPresetId',
                idPrefix: 'prompt_',
                label: '提示词预设',
                filePrefix: 'prompt_preset_',
                buildSaveData: (existing) => buildPromptData(effectiveData, existing),
                buildExportData: (existing) =>
                    effectiveData ? buildPromptData(effectiveData, existing) : existing,
                buildNewData: () => ({
                    positivePrefix: '',
                    positiveSuffix: '',
                    negativePrompt: '',
                    loraSyntaxMode: this.provider === 'comfyui' ? 'weilin' : 'standard',
                    loras: [],
                }),
                buildCloneData: () => buildPromptData(effectiveData),
            },
            action,
            pId
        );
    }

    /**
     * 批量解析并导入外部提示词预设 JSON 文件（支持多选及合集 JSON）。
     */
    public async handlePromptImportFiles(files: File[]): Promise<void> {
        await this.runAssetPresetImportFiles<PromptPresetData>(files, {
            category: 'prompts',
            providerScope: this.provider,
            draftField: 'promptPresetId',
            idPrefix: 'prompt_',
            label: '提示词预设',
            parseFile: (rawText, f) => {
                const { candidates, skippedErrors } = parsePresetBatchJson(rawText, f.name);
                const results: Array<{ name: string; data: PromptPresetData }> = [];
                for (const candidate of candidates) {
                    const errMsg = validatePresetPayloadForCategory('prompts', candidate.data);
                    if (errMsg) {
                        if (candidates.length === 1) {
                            throw new Error(errMsg);
                        }
                        continue;
                    }
                    results.push({
                        name: candidate.name,
                        data: candidate.data as PromptPresetData,
                    });
                }
                if (results.length === 0 && skippedErrors.length > 0) {
                    throw new Error(skippedErrors[0]);
                }
                return results;
            },
        });
    }

    /**
     * 响应内嵌 WorkflowCard 的操作动作。
     */
    public async handleWorkflowAssetAction(
        action: PresetActionType,
        wfId: string,
        data?: WorkflowCardData
    ): Promise<boolean> {
        const effectiveData = data ?? this.workflowCardRef?.getValue();
        if (action === 'save' && effectiveData?.json === undefined) {
            return false;
        }
        const ok = await this.runAssetPresetAction<WorkflowPresetData>(
            {
                category: 'workflows',
                draftField: 'txt2imgWorkflowId',
                idPrefix: 'workflow_',
                label: '工作流预设',
                filePrefix: 'workflow_preset_',
                buildSaveData: (existing) => {
                    const res = parseComfyWorkflowInput(effectiveData!.json);
                    if (!res.ok) {
                        Toast.show(`工作流保存失败：${res.error}`, { level: 'error' });
                        return null;
                    }
                    return { ...existing, workflow: res.workflow };
                },
                buildExportData: (existing) => {
                    if (effectiveData?.json === undefined) return existing;
                    const res = parseComfyWorkflowInput(effectiveData.json);
                    if (!res.ok) {
                        Toast.show(`工作流导出失败：${res.error}`, { level: 'error' });
                        return null;
                    }
                    return { ...existing, workflow: res.workflow };
                },
                buildNewData: () => ({ workflow: {} }),
                buildCloneData: () => {
                    if (!effectiveData?.json) return { workflow: {} };
                    const res = parseComfyWorkflowInput(effectiveData.json);
                    if (!res.ok) {
                        Toast.show(`工作流另存失败：${res.error}`, { level: 'error' });
                        return null;
                    }
                    return { workflow: res.workflow };
                },
            },
            action,
            wfId
        );
        if (
            ok &&
            data?.json !== undefined &&
            (action === 'save' || action === 'saveAs') &&
            this.workflowCardRef
        ) {
            this.workflowCardRef.setBaseline({ json: data.json });
        }
        return ok;
    }

    /**
     * 批量解析并导入外部工作流预设 JSON 文件（支持插件预设 JSON、合集 JSON 与 ComfyUI 原生 Save (API Format) JSON）。
     */
    public async handleWorkflowImportFiles(files: File[]): Promise<void> {
        await this.runAssetPresetImportFiles<WorkflowPresetData>(files, {
            category: 'workflows',
            draftField: 'txt2imgWorkflowId',
            idPrefix: 'workflow_',
            label: '工作流预设',
            parseFile: (rawText, f) => {
                const parsed: unknown = JSON.parse(rawText);
                const rawList: unknown[] | null = Array.isArray(parsed)
                    ? parsed
                    : isPlainRecord(parsed) && Array.isArray(parsed.presets)
                      ? parsed.presets
                      : null;

                if (rawList) {
                    const results: Array<{ name: string; data: WorkflowPresetData }> = [];
                    rawList.forEach((entry, idx) => {
                        const res = parseComfyWorkflowInput(entry, { requireNodes: true });
                        if (res.ok) {
                            results.push({
                                name:
                                    res.extractedName ||
                                    `${stripJsonExtension(f.name) || '导入的工作流'} (${idx + 1})`,
                                data: {
                                    ...(res.extraData || {}),
                                    workflow: res.workflow,
                                },
                            });
                        }
                    });
                    if (results.length === 0) {
                        throw new Error('合集文件中未包含有效的工作流预设');
                    }
                    return results;
                }

                const res = parseComfyWorkflowInput(parsed, { requireNodes: true });
                if (!res.ok) {
                    throw new Error(res.error);
                }
                const resolvedName =
                    res.extractedName || stripJsonExtension(f.name) || '导入的工作流预设';
                return [
                    {
                        name: resolvedName,
                        data: {
                            ...(res.extraData || {}),
                            workflow: res.workflow,
                        },
                    },
                ];
            },
        });
    }

    private isSyncingAssets = false;

    /**
     * 服务地址或服务商切换后执行后台轻量检测并在满足条件时静默同步。
     */
    private async runBackgroundAssetSync(): Promise<void> {
        if (this.isSyncingAssets || this.isDisposed) return;

        const provider = providerRegistry.getProvider(this.provider);
        if (!provider || typeof provider.checkHealth !== 'function' || !hasProviderAssetSync(provider)) {
            return;
        }

        const syncGen = this.assetSyncGen;
        try {
            this.isSyncingAssets = true;
            const health = await provider.checkHealth();
            if (this.isDisposed || syncGen !== this.assetSyncGen || health.status !== 'ok') {
                return;
            }

            const cfg = this.readProviderStoreConfig();
            const cache = cfg.assetCache;
            const hasModels =
                Boolean(cache?.checkpoints?.length) || Boolean(cache?.unets?.length);
            const needsInitialFetch = !cache || !cache.updatedAt || !hasModels;

            if (needsInitialFetch && !this.isDisposed && syncGen === this.assetSyncGen) {
                await this.refreshServerAssets(true, { skipHealthCheck: true });
            }
        } catch (err) {
            logger.debug(`[${this.provider}] 后台资产同步捕获异常 (已忽略):`, err);
        } finally {
            this.isSyncingAssets = false;
        }
    }

    /**
     * 视图激活时同步外部存储并建立事件监听。
     */
    public activate(): void {
        if (this.isDisposed) return;
        const cfg = this.readProviderStoreConfig();
        this.connectionData.value = this.buildConnectionData(cfg);
        this.refreshAssetPools();
        if (!this.presetController.isDirty.value) {
            this.presetController.applyActivePreset(cfg.activeDrawingPresetId || '', {
                persist: false,
                silent: true,
            });
        }
        // 选项卡激活时仅读取本地缓存刷新下拉列表，不触发网络请求

        if (!this.unlistenSettings) {
            this.unlistenSettings = eventBus.on('settings:updated', (payload) => {
                const freshCfg = this.readProviderStoreConfig();
                this.connectionData.value = this.buildConnectionData(freshCfg);

                const freshActiveId = freshCfg.activeDrawingPresetId || '';
                if (
                    !this.presetController.isDirty.value &&
                    freshActiveId !== this.presetController.activePresetId.value
                ) {
                    this.presetController.applyActivePreset(freshActiveId, { persist: false });
                }

                if (
                    !payload ||
                    payload.isReset ||
                    payload.key === 'presets.prompts' ||
                    payload.key === 'presets.workflows' ||
                    payload.key === 'presets.drawing' ||
                    payload.key === 'prompts' ||
                    payload.key === 'workflows' ||
                    payload.keys?.includes('presets')
                ) {
                    this.refreshAssetPools();
                    if (
                        !this.presetController.isDirty.value &&
                        (payload?.isReset ||
                            payload?.key === 'presets.drawing' ||
                            payload?.keys?.includes('presets'))
                    ) {
                        this.presetController.reloadFromStore();
                    }
                }
            });
        }
    }

    /** 递增同步请求序号并中止当前在途资产请求 */
    private cancelInFlightAssetSync(): void {
        this.assetSyncGen += 1;
        if (this.activeAssetSyncAbort) {
            this.activeAssetSyncAbort.abort();
            this.activeAssetSyncAbort = null;
        }
    }

    /**
     * 视图切出时解绑事件监听。
     */
    public deactivate(): void {
        this.cancelInFlightAssetSync();
        if (this.urlSyncTimer) {
            clearTimeout(this.urlSyncTimer);
            this.urlSyncTimer = null;
        }
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
    }

    /**
     * 释放视图模型资源。
     */
    public dispose(): void {
        this.isDisposed = true;
        this.presetController.dispose();
        this.deactivate();
    }
}
