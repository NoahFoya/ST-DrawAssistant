/**
 * 生图服务选项卡通用视图模型 (ProviderTabViewModel)。
 *
 * @remarks
 * 统一封装 ComfyUI、SD-WebUI、NovelAI、OpenAI 四大生图服务视图的数据状态与交互逻辑：
 * 1. 组合 PresetController<DrawingPresetData> 管理当前提供商的生图预设；
 * 2. 独立维护服务通信配置 (serverUrl / apiKey / serviceId)，支持连通性检测与服务端模型/VAE/采样器拉取；
 * 3. 响应式派生主模型、VAE、提示词预设、ComfyUI 工作流预设的下拉选项，自动对缺失引用打上失效标记；
 * 4. 统一处理内嵌提示词预设管理器与工作流管理器的增删改查联动。
 */

import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import type {
    DrawingPresetData,
    PresetItem,
    PromptPresetData,
    ProviderAssetCache,
    ProviderHealthResult,
    ProviderStoredConfig,
    ProviderType,
    WorkflowPresetData,
} from '@types';
import type { Disposable } from '../types';
import type { SelectOption, SelectOptGroup } from '../components/select';
import type { AssetFetchResult, ConnectionCardData } from '../composite/connection-card';
import type { PresetActionType } from '../composite/preset-toolbar';
import type { PromptCardData, PromptCardPresetItem } from '../composite/prompt-preset-card';
import type { WorkflowCardData, WorkflowCardPresetItem } from '../composite/workflow-card';
import { PresetController } from './preset-controller';
import { settingsStore } from '../../store/settings-store';
import { providerRegistry } from '../../provider/registry';
import { eventBus } from '../../util/event-bus';
import { matchAssetText } from '../../util/asset-matcher';
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
    /** 初始内置模型选项（如 NovelAI / OpenAI 预置模型列表） */
    defaultModels?: SelectOption[];
    /**
     * 模型下拉严格以资产为准：不合并 defaultModels，没有任何资产时显示空状态。
     * 适用于模型来源明确（固定表或服务端返回）、不应混入预置项的提供商。
     */
    strictModelAssets?: boolean;
    /** 严格模式下无任何模型资产时的下拉空状态文案 */
    emptyModelsLabel?: string;
    /** 模型标识的下拉显示名格式化，缺省原样显示标识 */
    formatModelLabel?: (modelId: string) => string;
    /** 按服务商固定的模型表（键为 serviceId）。命中的服务商不依赖服务端枚举，直接以该表为模型资产 */
    staticModelsByService?: Record<string, readonly string[]>;
    /**
     * 启用按服务商独立保存的连接信息与资产缓存。
     * fixedUrls 声明地址由服务商固定的服务商（键为 serviceId，值为固定地址）。
     */
    serviceProfiles?: { fixedUrls?: Record<string, string> };
    /** 每次视图激活都静默同步服务端资产并比对差异，默认仅在本地缓存为空时同步 */
    alwaysSyncOnActivate?: boolean;
    /** 初始内置 VAE 选项 */
    defaultVaes?: SelectOption[];
    /** 初始内置采样器选项 */
    defaultSamplers?: SelectOption[];
    /** 初始内置调度器选项 */
    defaultSchedulers?: SelectOption[];
    /** 是否校验 ComfyUI 工作流绑定 ID（txt2imgWorkflowId / img2imgWorkflowId） */
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

/** 空资产缓存基准对象，用于清空或重置资产 */
const EMPTY_ASSET_CACHE: ProviderAssetCache = Object.freeze({
    checkpoints: [],
    unets: [],
    vaes: [],
    clips: [],
    loras: [],
    samplers: [],
    schedulers: [],
});

/** 补全资产缓存字段，确保数组不为 undefined */
function completeAssetCache(cache?: ProviderAssetCache): ProviderAssetCache {
    return {
        checkpoints: cache?.checkpoints ? [...cache.checkpoints] : [],
        unets: cache?.unets ? [...cache.unets] : [],
        vaes: cache?.vaes ? [...cache.vaes] : [],
        clips: cache?.clips ? [...cache.clips] : [],
        loras: cache?.loras ? [...cache.loras] : [],
        samplers: cache?.samplers ? [...cache.samplers] : [],
        schedulers: cache?.schedulers ? [...cache.schedulers] : [],
        serverSignature: cache?.serverSignature,
        updatedAt: cache?.updatedAt,
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
    /** 图生图工作流下拉选项（含不启用项与失效项提示） */
    public readonly img2imgWorkflowOptions: ReadonlySignal<SelectOption[]>;
    /** 局部重绘预设下拉选项（含未绑定项与失效项提示） */
    public readonly inpaintPresetOptions: ReadonlySignal<SelectOption[]>;

    /** 供内嵌 PromptPresetCard 消费的条目列表 */
    public readonly promptCardPresets: ReadonlySignal<PromptCardPresetItem[]>;
    /** 供内嵌 WorkflowCard 消费的条目列表 */
    public readonly workflowCardPresets: ReadonlySignal<WorkflowCardPresetItem[]>;

    private unlistenSettings: (() => void) | null = null;
    /** 第三方地址变更后延迟触发资产同步的计时器 */
    private urlSyncTimer: ReturnType<typeof setTimeout> | null = null;

    /** 是否按服务商独立保存连接信息与资产缓存 */
    public get hasServiceProfiles(): boolean {
        return Boolean(this.options.serviceProfiles);
    }

    public constructor(options: ProviderTabViewModelOptions) {
        this.provider = options.provider;
        this.options = options;

        const providerCfg = this.readProviderStoreConfig();
        this.connectionData = signal<ConnectionCardData>({
            serverUrl: providerCfg.serverUrl !== undefined ? providerCfg.serverUrl : options.defaultServerUrl,
            apiKey: providerCfg.apiKey || '',
            activePresetId: providerCfg.serviceId || options.defaultServiceId,
        });

        // 优先从本地持久化资产缓存秒开渲染，避免白屏与等待
        const cache = providerCfg.assetCache;
        const cachedCheckpoints = cache?.checkpoints || [];
        const cachedUnets = cache?.unets || [];
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

        // 固定模型表的服务商不依赖本地缓存
        this.seedStaticModels();

        // 提示词预设按当前生图引擎物理隔离载入
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
            promptMessageForNew: options.promptMessageForNew ?? '请输入新生图预设名称:',
            defaultNewName: options.defaultNewName ?? '新建预设',
            promptMessageForSaveAs: '请输入另存生图预设的新名称:',
            promptMessageForRename: '请输入生图预设的新名称:',
            defaultTemplate: () => {
                const list = settingsStore.getPresets<DrawingPresetData>('drawing', this.provider);
                return list[0]?.data ? structuredClone(list[0].data) : ({} as DrawingPresetData);
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

            // 严格以资产为准：只展示固定表或服务端返回的模型，不混入预置项
            if (this.options.strictModelAssets) {
                const formatLabel = this.options.formatModelLabel ?? ((id: string) => id);
                const assets = hasFetched ? fetched : [];
                const strictOptions: SelectOption[] = assets.map((m) => ({
                    label: formatLabel(m),
                    value: m,
                }));
                if (currentModel && !assets.includes(currentModel)) {
                    strictOptions.unshift({ label: currentModel, value: currentModel });
                }
                return strictOptions.length > 0
                    ? strictOptions
                    : [{ label: this.options.emptyModelsLabel ?? '未获取到模型', value: '' }];
            }

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

        // 3. 派生提示词预设下拉选项
        this.promptPresetOptions = computed(() => {
            const prompts = this.promptPresets.value;
            const boundId = this.presetController.draftConfig.value.promptPresetId || '';
            const opts: SelectOption[] = [
                {
                    label: '未选择提示词预设',
                    value: '',
                },
                ...prompts.map((p) => ({
                    label: p.name || '未命名提示词预设',
                    value: p.id,
                })),
            ];
            if (boundId && !prompts.some((p) => p.id === boundId)) {
                opts.splice(1, 0, {
                    label: `${boundId} (已失效)`,
                    value: boundId,
                });
            }
            return opts;
        });

        // 4. 派生文生图工作流下拉选项
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

        // 5. 派生图生图工作流下拉选项
        this.img2imgWorkflowOptions = computed(() => {
            const workflows = this.workflowPresets.value;
            const boundId = this.presetController.draftConfig.value.img2imgWorkflowId || '';
            const opts: SelectOption[] = [
                { label: '未启用图生图工作流', value: '' },
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

        // 5.5 派生局部重绘预设下拉选项
        this.inpaintPresetOptions = computed(() => {
            const workflows = this.workflowPresets.value;
            const boundId = this.presetController.draftConfig.value.inpaintPresetId || '';
            const opts: SelectOption[] = [
                { label: '未绑定局部重绘预设', value: '' },
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

        // 6. 派生 PromptPresetCard 条目列表
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
                    })),
                },
            }))
        );

        // 7. 派生 WorkflowCard 条目列表
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

        // 4. 校验提示词预设绑定
        const prompts = this.promptPresets.value;
        if (draft.promptPresetId && !prompts.some((p) => p.id === draft.promptPresetId)) {
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
                draft.img2imgWorkflowId &&
                !workflows.some((w) => w.id === draft.img2imgWorkflowId)
            ) {
                invalid.add('img2imgWorkflowId');
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

        const urlChanged = this.hasServiceProfiles && data.serverUrl !== prevUrl;
        if (urlChanged) {
            patch.assetCache = EMPTY_ASSET_CACHE;
        }
        settingsStore.setProviderConfig(this.provider, patch);

        if (urlChanged) {
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
     * 3. 重置内存中的资产信号，并在目标服务商依赖服务端枚举时触发静默同步。
     */
    public switchService(nextId: string): void {
        const prevId = this.connectionData.value.activePresetId || this.options.defaultServiceId;
        if (!this.hasServiceProfiles || !prevId || nextId === prevId) {
            return;
        }

        const cfg = this.readProviderStoreConfig();
        const next = cfg.serviceProfiles?.[nextId];
        const fixedUrl = this.options.serviceProfiles?.fixedUrls?.[nextId];
        const nextUrl = fixedUrl ?? next?.serverUrl ?? '';
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
        this.loadAssetSignals(next?.assetCache);
        this.scheduleAssetSync(0);
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

    /** 当前服务商的固定模型表；当前服务商依赖服务端枚举时返回 undefined */
    private getStaticModels(): readonly string[] | undefined {
        const serviceId = this.connectionData.value.activePresetId || this.options.defaultServiceId;
        return serviceId ? this.options.staticModelsByService?.[serviceId] : undefined;
    }

    /** 当前服务商有固定模型表时，以其作为模型资产 */
    private seedStaticModels(): void {
        const staticModels = this.getStaticModels();
        if (staticModels) {
            this.categorizedModels.value = null;
            this.serverModels.value = [...staticModels];
            this.hasFetchedModels.value = true;
        }
    }

    /** 以指定缓存重置内存中的全部资产信号；缓存为空时回到未拉取状态 */
    private loadAssetSignals(cache: ProviderAssetCache | undefined): void {
        const checkpoints = cache?.checkpoints ?? [];
        const unets = cache?.unets ?? [];
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

        this.seedStaticModels();
    }

    /**
     * 执行提供商连通性健康检测。
     */
    public async testPing(): Promise<ProviderHealthResult> {
        const provider = providerRegistry.getProvider(this.provider);
        if (!provider?.checkHealth) {
            throw new Error(`未注册 ${this.provider} 服务提供方`);
        }
        const res = await provider.checkHealth();
        if (this.provider === 'openai' && res.status !== 'ok') {
            throw new Error(res.message || '连接失败');
        }
        return res;
    }

    /**
     * 从服务端拉取模型、VAE、LoRA 与采样器列表，持久化至本地资产缓存并合并到响应式信号中。
     *
     * @param silent 是否以静默模式运行（静默模式下仅在资产发生增删变动或当前预设资产失效时提示用户）
     * @param options 可选调用控制参数，如已完成连通性校验时可跳过前置健康检查
     */
    public async refreshServerAssets(
        silent = false,
        options?: { skipHealthCheck?: boolean }
    ): Promise<AssetFetchResult> {
        const provider = providerRegistry.getProvider(this.provider);

        if (!provider) {
            throw new Error(`未注册 ${this.provider} 服务提供方`);
        }

        // 0. 前置连通性快速检查，离线时立即退出，避免产生冗余请求
        if (!options?.skipHealthCheck && typeof provider.checkHealth === 'function') {
            const health = await provider.checkHealth();
            if (health.status !== 'ok') {
                const errMsg = health.message || '服务未启动或无法连接';
                if (!silent) {
                    Toast.show(`获取模型列表失败: ${errMsg}`, { level: 'error' });
                }
                throw new Error(errMsg);
            }
        }

        // 若为显式手动刷新且提供方支持清除缓存，重置内存缓存以拉取最新数据
        if (!silent && typeof provider.clearAssetCache === 'function') {
            provider.clearAssetCache();
        }

        const prevCfg = this.readProviderStoreConfig();
        const prevCache = prevCfg.assetCache;
        const prevCheckpoints = prevCache?.checkpoints || [];
        const prevLoras = prevCache?.loras || [];

        let totalCount = 0;

        // 1. 拉取主模型列表 (优先检查分类获取接口)
        if (typeof provider.fetchCategorizedModels === 'function') {
            const cat = await provider.fetchCategorizedModels();
            if (cat && (cat.checkpoints?.length > 0 || cat.unets?.length > 0)) {
                this.categorizedModels.value = cat;
                const all = [...(cat.checkpoints || []), ...(cat.unets || [])];
                this.serverModels.value = all;
                this.hasFetchedModels.value = true;
                totalCount += all.length;
            }
        } else if (typeof provider.fetchModels === 'function') {
            const models = await provider.fetchModels();
            if (Array.isArray(models) && models.length > 0) {
                totalCount += models.length;
                this.serverModels.value = models;
                this.hasFetchedModels.value = true;
            } else if (Array.isArray(models)) {
                this.serverModels.value = [];
                this.categorizedModels.value = null;
                this.hasFetchedModels.value = true;
            }
        }

        // 2. 拉取外置 VAE 列表
        if (typeof provider.fetchVaes === 'function') {
            const vaes = await provider.fetchVaes();
            if (Array.isArray(vaes) && vaes.length > 0) {
                totalCount += vaes.length;
                this.serverVaes.value = vaes;
                this.hasFetchedVaes.value = true;
            }
        }

        // 3. 拉取 CLIP 编码器列表
        if (typeof provider.fetchClips === 'function') {
            const clips = await provider.fetchClips();
            if (Array.isArray(clips) && clips.length > 0) {
                totalCount += clips.length;
                this.serverClips.value = clips;
                this.hasFetchedClips.value = true;
            }
        }

        // 4. 拉取采样器列表 (如 SD-WebUI, ComfyUI)
        if (typeof provider.fetchSamplers === 'function') {
            const samplers = await provider.fetchSamplers();
            if (Array.isArray(samplers) && samplers.length > 0) {
                totalCount += samplers.length;
                this.samplerOptions.value = samplers.map((s) => ({ label: s, value: s }));
            }
        }

        // 5. 拉取调度器列表 (如 ComfyUI)
        if (typeof (provider as { fetchSchedulers?: () => Promise<string[]> }).fetchSchedulers === 'function') {
            const schedulers = await (provider as { fetchSchedulers: () => Promise<string[]> }).fetchSchedulers();
            if (Array.isArray(schedulers) && schedulers.length > 0) {
                totalCount += schedulers.length;
                this.schedulerOptions.value = schedulers.map((s) => ({ label: s, value: s }));
            }
        }

        // 6. 拉取 LoRA 模型列表 (如 SD-WebUI, ComfyUI)
        if (typeof provider.fetchLoras === 'function') {
            const loras = await provider.fetchLoras();
            if (Array.isArray(loras) && loras.length > 0) {
                totalCount += loras.length;
                this.serverLoras.value = loras;
                this.hasFetchedLoras.value = true;
            }
        }

        // 7. 持久化本地资产缓存至 SettingsStore
        const newCheckpoints = this.categorizedModels.value?.checkpoints ?? this.serverModels.value;
        const newLoras = this.serverLoras.value;
        const updatedCache: ProviderAssetCache = {
            checkpoints: newCheckpoints,
            unets: this.categorizedModels.value?.unets,
            vaes: this.serverVaes.value,
            clips: this.serverClips.value,
            loras: newLoras,
            samplers: this.samplerOptions.value.map((o) => o.value),
            schedulers: this.schedulerOptions.value.map((o) => o.value),
            updatedAt: Date.now(),
        };
        settingsStore.setProviderConfig(this.provider, { assetCache: updatedCache });

        // 8. 比对资产差异
        const addedModels = newCheckpoints.filter((m) => !prevCheckpoints.includes(m));
        const removedModels = prevCheckpoints.filter((m) => !newCheckpoints.includes(m));
        const addedLoras = newLoras.filter((l) => !prevLoras.includes(l));
        const removedLoras = prevLoras.filter((l) => !newLoras.includes(l));
        const hasDiff =
            addedModels.length > 0 ||
            removedModels.length > 0 ||
            addedLoras.length > 0 ||
            removedLoras.length > 0;

        // 9. 差异变动与预设可用性通知反馈（统一 3 秒轻量悬浮提示）
        const diffParts: string[] = [];
        if (addedModels.length > 0) diffParts.push(`+${addedModels.length} 模型`);
        if (removedModels.length > 0) diffParts.push(`-${removedModels.length} 模型`);
        if (addedLoras.length > 0) diffParts.push(`+${addedLoras.length} LoRA`);
        if (removedLoras.length > 0) diffParts.push(`-${removedLoras.length} LoRA`);
        const diffText = diffParts.length > 0 ? ` (${diffParts.join(', ')})` : '';

        const invalidKeys = this.computeInvalidBindings(this.presetController.draftConfig.value);
        if (invalidKeys.size > 0) {
            Toast.show(`模型资产已同步${diffText}，警告: 当前预设缺少部分可用模型`, {
                level: 'warning',
                duration: 3000,
            });
        } else if (hasDiff) {
            Toast.show(`模型资产已同步${diffText}，当前预设资产正常`, {
                level: 'success',
                duration: 3000,
            });
        } else if (!silent) {
            Toast.show('模型资产已是最新，当前预设资产正常', {
                level: 'info',
                duration: 3000,
            });
        }

        return {
            count: totalCount,
            message:
                totalCount > 0
                    ? `已成功同步 ${totalCount} 项服务端模型`
                    : '未发现可用模型或服务端不支持查询',
        };
    }

    /**
     * 刷新当前提供商专属提示词与全局工作流预设池信号。
     */
    public refreshAssetPools(): void {
        this.promptPresets.value = settingsStore.getPresets<PromptPresetData>('prompts', this.provider);
        this.workflowPresets.value = settingsStore.getPresets<WorkflowPresetData>('workflows');
    }

    /**
     * 响应内嵌 PromptPresetCard 的操作动作。
     */
    public async handlePromptAssetAction(
        action: PresetActionType,
        pId: string,
        data?: PromptCardData
    ): Promise<void> {
        if (action === 'select') {
            this.presetController.updateDraft('promptPresetId', pId);
        } else if (action === 'save' && data) {
            const pr = settingsStore.getPreset<PromptPresetData>('prompts', pId, this.provider);
            if (pr) {
                pr.data = {
                    ...pr.data,
                    positivePrefix: data.positivePrefix,
                    positiveSuffix: data.positiveSuffix,
                    negativePrompt: data.negativePrompt,
                    loraSyntaxMode: data.loraSyntaxMode || (this.provider === 'comfyui' ? 'weilin' : 'standard'),
                    loras: (data.loras || [])
                        .filter((l) => Boolean(l.modelName?.trim()))
                        .map((l) => ({
                            modelName: l.modelName.trim(),
                            modelWeight: l.modelWeight,
                            clipWeight: l.clipWeight,
                            triggerWeight: l.triggerWeight,
                            enabled: l.enabled,
                        })),
                };
                settingsStore.savePreset('prompts', pr, this.provider);
                Toast.show(`提示词预设 "${pr.name}" 已保存`, { level: 'success' });
            }
        } else if (action === 'new') {
            const list = settingsStore.getPresets<PromptPresetData>('prompts', this.provider);
            const existingNames = new Set(list.map((p) => p.name));
            const newName = await ConfirmDialog.prompt({
                title: '新建提示词预设',
                message: '请输入新提示词预设名称:',
                defaultValue: '新建提示词预设',
                placeholder: '请输入提示词预设名称',
                validator: (val) => {
                    if (existingNames.has(val)) {
                        return '预设名称已存在，请换一个名称';
                    }
                    return null;
                },
            });
            if (!newName || !newName.trim()) return;

            const newId = `prompt_${Date.now()}`;
            const newPr: PresetItem<PromptPresetData> = {
                id: newId,
                name: newName.trim(),
                data: {
                    positivePrefix: '',
                    positiveSuffix: '',
                    negativePrompt: '',
                    loraSyntaxMode: this.provider === 'comfyui' ? 'weilin' : 'standard',
                    loras: [],
                },
                updatedAt: Date.now(),
            };
            settingsStore.savePreset('prompts', newPr, this.provider);
            this.presetController.updateDraft('promptPresetId', newId);
            Toast.show(`已新建提示词预设: ${newPr.name}`, { level: 'success' });
        } else if (action === 'saveAs') {
            const curPr = settingsStore.getPreset<PromptPresetData>('prompts', pId, this.provider);
            const defaultCloneName = curPr ? `${curPr.name} (副本)` : '提示词预设 (副本)';
            const list = settingsStore.getPresets<PromptPresetData>('prompts', this.provider);
            const existingNames = new Set(list.map((p) => p.name));

            const targetName = await ConfirmDialog.prompt({
                title: '另存为新提示词预设',
                message: '请输入另存提示词预设的新名称:',
                defaultValue: defaultCloneName,
                placeholder: '请输入提示词预设名称',
                validator: (val) => {
                    if (existingNames.has(val)) {
                        return '预设名称已存在，请换一个名称';
                    }
                    return null;
                },
            });
            if (!targetName || !targetName.trim()) return;

            const newId = `prompt_${Date.now()}`;
            const clonedPr: PresetItem<PromptPresetData> = {
                id: newId,
                name: targetName.trim(),
                data: {
                    positivePrefix: data?.positivePrefix || '',
                    positiveSuffix: data?.positiveSuffix || '',
                    negativePrompt: data?.negativePrompt || '',
                    loraSyntaxMode: data?.loraSyntaxMode || (this.provider === 'comfyui' ? 'weilin' : 'standard'),
                    loras: (data?.loras || [])
                        .filter((l) => Boolean(l.modelName?.trim()))
                        .map((l) => ({
                            modelName: l.modelName.trim(),
                            modelWeight: l.modelWeight,
                            clipWeight: l.clipWeight,
                            triggerWeight: l.triggerWeight,
                            enabled: l.enabled,
                        })),
                },
                updatedAt: Date.now(),
            };
            settingsStore.savePreset('prompts', clonedPr, this.provider);
            this.presetController.updateDraft('promptPresetId', newId);
            Toast.show(`已另存提示词预设: ${clonedPr.name}`, { level: 'success' });
        } else if (action === 'rename') {
            const curPr = settingsStore.getPreset<PromptPresetData>('prompts', pId, this.provider);
            if (!curPr) return;

            const list = settingsStore.getPresets<PromptPresetData>('prompts', this.provider);
            const otherNames = new Set(list.filter((p) => p.id !== pId).map((p) => p.name));
            const newName = await ConfirmDialog.prompt({
                title: '重命名提示词预设',
                message: '请输入提示词预设新名称:',
                defaultValue: curPr.name,
                placeholder: '请输入提示词预设新名称',
                validator: (val) => {
                    if (val === curPr.name) {
                        return '新名称不能与当前名称相同';
                    }
                    if (otherNames.has(val)) {
                        return '预设名称已存在，请换一个名称';
                    }
                    return null;
                },
            });
            if (!newName || !newName.trim() || newName.trim() === curPr.name) return;

            curPr.name = newName.trim();
            curPr.updatedAt = Date.now();
            settingsStore.savePreset('prompts', curPr, this.provider);
            Toast.show(`已重命名提示词预设为 "${curPr.name}"`, { level: 'success' });
        } else if (action === 'export') {
            const curPr = settingsStore.getPreset<PromptPresetData>('prompts', pId, this.provider);
            if (!curPr) return;
            const safeName = (curPr.name || curPr.id).replace(/\s+/g, '_');
            const blob = new Blob([JSON.stringify(curPr, null, 2)], {
                type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `prompt_preset_${safeName}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } else if (action === 'delete') {
            const list = settingsStore.getPresets<PromptPresetData>('prompts', this.provider);
            if (list.length <= 1) {
                Toast.show('至少保留一套提示词预设，无法删除', { level: 'warning' });
                return;
            }
            settingsStore.deletePreset('prompts', pId, this.provider);
            const remaining = settingsStore.getPresets<PromptPresetData>('prompts', this.provider);
            if (remaining.length > 0) {
                this.presetController.updateDraft('promptPresetId', remaining[0].id);
            }
            Toast.show('提示词预设已删除', { level: 'info' });
        } else if (action === 'reset') {
            Toast.show('已放弃未保存修改', { level: 'info' });
        }
        this.refreshAssetPools();
    }

    /**
     * 解析并导入外部提示词预设 JSON 文件。
     */
    public handlePromptImportFile(file: File): void {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const parsed = JSON.parse(reader.result as string);
                if (!parsed || typeof parsed !== 'object' || !parsed.data) {
                    throw new Error('预设文件格式错误：未包含有效的 data 配置项');
                }
                const list = settingsStore.getPresets<PromptPresetData>('prompts', this.provider);
                const existingNames = new Set(list.map((p) => p.name));
                const baseName = parsed.name || '导入的提示词预设';

                let finalName = baseName;
                if (existingNames.has(baseName)) {
                    const negotiated = await ConfirmDialog.prompt({
                        title: '导入预设名称冲突',
                        message: `已存在同名预设「${baseName}」，请为导入预设指定一个新名称:`,
                        defaultValue: `${baseName} (导入)`,
                        placeholder: '请输入唯一的预设名称',
                        validator: (val) => {
                            if (existingNames.has(val)) {
                                return '预设名称已存在，请换一个名称';
                            }
                            return null;
                        },
                    });
                    if (!negotiated || !negotiated.trim()) return;
                    finalName = negotiated.trim();
                }

                const newId = `prompt_${Date.now()}`;
                const importedItem: PresetItem<PromptPresetData> = {
                    id: newId,
                    name: finalName,
                    data: parsed.data as PromptPresetData,
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset('prompts', importedItem, this.provider);
                this.presetController.updateDraft('promptPresetId', newId);
                this.refreshAssetPools();
                Toast.show(`已成功导入提示词预设: ${importedItem.name}`, { level: 'success' });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                Toast.show(`导入提示词预设失败: ${msg}`, { level: 'error' });
            }
        };
        reader.onerror = () => {
            Toast.show('读取预设文件失败', { level: 'error' });
        };
        reader.readAsText(file);
    }

    /**
     * 响应内嵌 WorkflowCard 的操作动作。
     */
    public async handleWorkflowAssetAction(
        action: PresetActionType,
        wfId: string,
        data?: WorkflowCardData
    ): Promise<void> {
        if (action === 'select') {
            this.presetController.updateDraft('txt2imgWorkflowId', wfId);
        } else if (action === 'save' && data?.json) {
            try {
                const parsed = JSON.parse(data.json);
                const wf = settingsStore.getPreset<WorkflowPresetData>('workflows', wfId);
                if (wf) {
                    wf.data = { ...wf.data, workflow: parsed };
                    settingsStore.savePreset('workflows', wf);
                    Toast.show(`工作流 "${wf.name}" 已保存`, { level: 'success' });
                }
            } catch {
                Toast.show('工作流保存失败：JSON 语法错误', { level: 'error' });
            }
        } else if (action === 'new') {
            const list = settingsStore.getPresets<WorkflowPresetData>('workflows');
            const existingNames = new Set(list.map((p) => p.name));
            const newName = await ConfirmDialog.prompt({
                title: '新建工作流预设',
                message: '请输入新工作流预设名称:',
                defaultValue: '新建工作流预设',
                placeholder: '请输入工作流预设名称',
                validator: (val) => {
                    if (existingNames.has(val)) {
                        return '预设名称已存在，请换一个名称';
                    }
                    return null;
                },
            });
            if (!newName || !newName.trim()) return;

            const newId = `workflow_${Date.now()}`;
            const newWf: PresetItem<WorkflowPresetData> = {
                id: newId,
                name: newName.trim(),
                data: {
                    workflow: {},
                },
                updatedAt: Date.now(),
            };
            settingsStore.savePreset('workflows', newWf);
            this.presetController.updateDraft('txt2imgWorkflowId', newId);
            Toast.show(`已新建工作流预设: ${newWf.name}`, { level: 'success' });
        } else if (action === 'saveAs') {
            const curWf = settingsStore.getPreset<WorkflowPresetData>('workflows', wfId);
            const defaultCloneName = curWf ? `${curWf.name} (副本)` : '工作流预设 (副本)';
            const list = settingsStore.getPresets<WorkflowPresetData>('workflows');
            const existingNames = new Set(list.map((p) => p.name));

            const targetName = await ConfirmDialog.prompt({
                title: '另存为新工作流预设',
                message: '请输入另存工作流预设的新名称:',
                defaultValue: defaultCloneName,
                placeholder: '请输入工作流预设名称',
                validator: (val) => {
                    if (existingNames.has(val)) {
                        return '预设名称已存在，请换一个名称';
                    }
                    return null;
                },
            });
            if (!targetName || !targetName.trim()) return;

            let parsedData: Record<string, unknown> = {};
            try {
                if (data?.json) parsedData = JSON.parse(data.json);
            } catch {
                parsedData = {};
            }

            const newId = `workflow_${Date.now()}`;
            const clonedWf: PresetItem<WorkflowPresetData> = {
                id: newId,
                name: targetName.trim(),
                data: {
                    workflow: parsedData,
                },
                updatedAt: Date.now(),
            };
            settingsStore.savePreset('workflows', clonedWf);
            this.presetController.updateDraft('txt2imgWorkflowId', newId);
            Toast.show(`已另存工作流预设: ${clonedWf.name}`, { level: 'success' });
        } else if (action === 'rename') {
            const curWf = settingsStore.getPreset<WorkflowPresetData>('workflows', wfId);
            if (!curWf) return;

            const list = settingsStore.getPresets<WorkflowPresetData>('workflows');
            const otherNames = new Set(list.filter((p) => p.id !== wfId).map((p) => p.name));
            const newName = await ConfirmDialog.prompt({
                title: '重命名工作流预设',
                message: '请输入工作流预设新名称:',
                defaultValue: curWf.name,
                placeholder: '请输入工作流预设新名称',
                validator: (val) => {
                    if (val === curWf.name) {
                        return '新名称不能与当前名称相同';
                    }
                    if (otherNames.has(val)) {
                        return '预设名称已存在，请换一个名称';
                    }
                    return null;
                },
            });
            if (!newName || !newName.trim() || newName.trim() === curWf.name) return;

            curWf.name = newName.trim();
            curWf.updatedAt = Date.now();
            settingsStore.savePreset('workflows', curWf);
            Toast.show(`已重命名工作流预设为 "${curWf.name}"`, { level: 'success' });
        } else if (action === 'export') {
            const curWf = settingsStore.getPreset<WorkflowPresetData>('workflows', wfId);
            if (!curWf) return;
            const safeName = (curWf.name || curWf.id).replace(/\s+/g, '_');
            const blob = new Blob([JSON.stringify(curWf, null, 2)], {
                type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `workflow_preset_${safeName}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } else if (action === 'delete') {
            const list = settingsStore.getPresets<WorkflowPresetData>('workflows');
            if (list.length <= 1) {
                Toast.show('至少保留一套工作流预设，无法删除', { level: 'warning' });
                return;
            }
            settingsStore.deletePreset('workflows', wfId);
            const remaining = settingsStore.getPresets<WorkflowPresetData>('workflows');
            if (remaining.length > 0) {
                this.presetController.updateDraft('txt2imgWorkflowId', remaining[0].id);
            }
            Toast.show('工作流预设已删除', { level: 'info' });
        } else if (action === 'reset') {
            Toast.show('已放弃未保存修改', { level: 'info' });
        }
        this.refreshAssetPools();
    }

    /**
     * 解析并导入外部工作流预设 JSON 文件。
     */
    public handleWorkflowImportFile(file: File): void {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const parsed = JSON.parse(reader.result as string);
                if (!parsed || typeof parsed !== 'object' || !parsed.data) {
                    throw new Error('预设文件格式错误：未包含有效的 data 配置项');
                }
                const list = settingsStore.getPresets<WorkflowPresetData>('workflows');
                const existingNames = new Set(list.map((p) => p.name));
                const baseName = parsed.name || '导入的工作流预设';

                let finalName = baseName;
                if (existingNames.has(baseName)) {
                    const negotiated = await ConfirmDialog.prompt({
                        title: '导入预设名称冲突',
                        message: `已存在同名预设「${baseName}」，请为导入预设指定一个新名称:`,
                        defaultValue: `${baseName} (导入)`,
                        placeholder: '请输入唯一的预设名称',
                        validator: (val) => {
                            if (existingNames.has(val)) {
                                return '预设名称已存在，请换一个名称';
                            }
                            return null;
                        },
                    });
                    if (!negotiated || !negotiated.trim()) return;
                    finalName = negotiated.trim();
                }

                const newId = `workflow_${Date.now()}`;
                const importedItem: PresetItem<WorkflowPresetData> = {
                    id: newId,
                    name: finalName,
                    data: parsed.data as WorkflowPresetData,
                    updatedAt: Date.now(),
                };
                settingsStore.savePreset('workflows', importedItem);
                this.presetController.updateDraft('txt2imgWorkflowId', newId);
                this.refreshAssetPools();
                Toast.show(`已成功导入工作流预设: ${importedItem.name}`, { level: 'success' });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                Toast.show(`导入工作流预设失败: ${msg}`, { level: 'error' });
            }
        };
        reader.onerror = () => {
            Toast.show('读取预设文件失败', { level: 'error' });
        };
        reader.readAsText(file);
    }

    private isSyncingAssets = false;

    /**
     * 切入视图时执行后台轻量检测并在满足条件时静默同步。
     */
    private async runBackgroundAssetSync(): Promise<void> {
        if (this.isSyncingAssets) return;
        // 固定模型表服务商无需也不应发起网络资产拉取
        if (this.getStaticModels()) return;

        const provider = providerRegistry.getProvider(this.provider);
        if (!provider) return;

        // 仅对具备健康检测与模型查询能力的本地或兼容后端执行
        if (
            typeof provider.checkHealth !== 'function' ||
            (typeof provider.fetchModels !== 'function' &&
                typeof provider.fetchCategorizedModels !== 'function')
        ) {
            return;
        }

        try {
            this.isSyncingAssets = true;
            const health = await provider.checkHealth();
            if (health.status !== 'ok') {
                return;
            }

            const cfg = this.readProviderStoreConfig();
            const cache = cfg.assetCache;
            const needsInitialFetch =
                !cache || !cache.updatedAt || !cache.checkpoints || cache.checkpoints.length === 0;
            const signatureChanged = Boolean(
                cache?.serverSignature && health.message && cache.serverSignature !== health.message
            );

            if (this.options.alwaysSyncOnActivate || needsInitialFetch || signatureChanged) {
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
        const cfg = this.readProviderStoreConfig();
        this.connectionData.value = {
            serverUrl: cfg.serverUrl !== undefined ? cfg.serverUrl : this.options.defaultServerUrl,
            apiKey: cfg.apiKey || '',
            activePresetId: cfg.serviceId || this.options.defaultServiceId,
        };
        this.refreshAssetPools();
        this.presetController.applyActivePreset(cfg.activeDrawingPresetId || '');
        // 选项卡切换时严格遵循单次缓存原则：仅读取本地持久化资产渲染下拉列表，不发起网络请求

        if (!this.unlistenSettings) {
            this.unlistenSettings = eventBus.on('settings:updated', (payload) => {
                const freshCfg = this.readProviderStoreConfig();
                this.connectionData.value = {
                    serverUrl: freshCfg.serverUrl !== undefined ? freshCfg.serverUrl : this.options.defaultServerUrl,
                    apiKey: freshCfg.apiKey || '',
                    activePresetId: freshCfg.serviceId || this.options.defaultServiceId,
                };

                const freshActiveId = freshCfg.activeDrawingPresetId;
                if (freshActiveId && freshActiveId !== this.presetController.activePresetId.value) {
                    this.presetController.applyActivePreset(freshActiveId, { persist: false });
                }

                if (!payload || payload.key === 'prompts' || payload.key === 'workflows') {
                    this.refreshAssetPools();
                }
            });
        }
    }

    /**
     * 视图切出时解绑事件监听。
     */
    public deactivate(): void {
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
    }

    /**
     * 释放视图模型资源。
     */
    public dispose(): void {
        this.deactivate();
    }
}
