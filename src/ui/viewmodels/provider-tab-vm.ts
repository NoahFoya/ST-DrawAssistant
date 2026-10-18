/**
 * 绘图服务选项卡通用视图模型 (ProviderTabViewModel)。
 *
 * @remarks
 * 统一封装 ComfyUI、SD-WebUI、NovelAI、OpenAI 四大生图服务视图的数据状态与交互逻辑：
 * 1. 组合 PresetController<DrawingPresetData> 管理当前提供商的绘图参数方案；
 * 2. 独立维护服务通信配置 (serverUrl / apiKey / serviceId)，支持连通性探测与服务端模型/VAE/采样器拉取；
 * 3. 响应式派生主模型、VAE、提示词预设方案、ComfyUI 工作流方案的下拉选项，自动对缺失引用打上失效标记；
 * 4. 统一处理内嵌提示词预设管理器与工作流管理器的增删改查联动。
 */

import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import type {
    DrawingPresetData,
    PresetItem,
    PromptPresetData,
    ProviderHealthResult,
    ProviderType,
    WorkflowPresetData,
} from '@types';
import type { Disposable } from '../types';
import type { SelectOption, SelectOptGroup } from '../components/select';
import type { AssetFetchResult, ConnectionCardData } from '../composite/connection-card';
import type { PresetActionType } from '../composite/preset-toolbar';
import type { PromptCardData, PromptCardPresetItem } from '../composite/prompt-preset-manager';
import type { WorkflowCardData, WorkflowCardPresetItem } from '../composite/workflow-card';
import { PresetController } from './preset-controller';
import { settingsStore } from '../../store/settings-store';
import { providerRegistry } from '../../provider/registry';
import { eventBus } from '../../util/event-bus';
import { Toast } from '../feedback/toast';

export interface ProviderTabViewModelOptions {
    /** 提供商类型标识 */
    provider: ProviderType;
    /** 默认服务端地址 */
    defaultServerUrl: string;
    /** 默认服务商模板 ID（如 openai-official） */
    defaultServiceId?: string;
    /** 新建方案弹窗提示语 */
    promptMessageForNew?: string;
    /** 新建方案默认名称 */
    defaultNewName?: string;
    /** 新建方案 ID 前缀 */
    idPrefix?: string;
    /** 初始内置模型选项（如 NovelAI / OpenAI 预置模型列表） */
    defaultModels?: SelectOption[];
    /** 初始内置 VAE 选项 */
    defaultVaes?: SelectOption[];
    /** 初始内置采样器选项 */
    defaultSamplers?: SelectOption[];
    /** 初始内置调度器选项 */
    defaultSchedulers?: SelectOption[];
    /** 是否校验 ComfyUI 工作流绑定 ID（txt2imgWorkflowId / img2imgWorkflowId） */
    checkWorkflowBindings?: boolean;
    /** 新建方案前的必填项校验 */
    validateRequired?: (draft: DrawingPresetData) => string[];
    /** 方案动作前置拦截校验（如 OpenAI 自定义 JSON 语法检查） */
    canPerformAction?: (
        action: PresetActionType,
        draft: DrawingPresetData
    ) => { allowed: boolean; message?: string };
    /** 自定义脏字段集计算函数 */
    evaluateDirtyFields?: (draft: DrawingPresetData, baseline: DrawingPresetData) => Set<string>;
    /** 方案应用或切换回调 */
    onPresetApplied?: (preset: PresetItem<DrawingPresetData> | null, draft: DrawingPresetData) => void;
    /** 草稿数据变更回调 */
    onDraftChanged?: (draft: DrawingPresetData) => void;
}

export class ProviderTabViewModel implements Disposable {
    public readonly provider: ProviderType;
    private readonly options: ProviderTabViewModelOptions;

    /** 绘画参数方案状态控制器 */
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

    /** 全局提示词预设方案列表信号 */
    public readonly promptPresets: Signal<PresetItem<PromptPresetData>[]>;
    /** 全局工作流预设方案列表信号 */
    public readonly workflowPresets: Signal<PresetItem<WorkflowPresetData>[]>;

    /** 合并当前方案值与服务端列表后的主模型下拉选项 (支持 optgroup 分组) */
    public readonly effectiveModelOptions: ReadonlySignal<Array<SelectOption | SelectOptGroup>>;
    /** 合并当前方案值与服务端列表后的外置 VAE 下拉选项 */
    public readonly effectiveVaeOptions: ReadonlySignal<SelectOption[]>;
    /** 派生的 CLIP 编码器下拉选项 */
    public readonly effectiveClipOptions: ReadonlySignal<SelectOption[]>;
    /** 关联提示词预设方案下拉选项（自动追加失效项提示） */
    public readonly promptPresetOptions: ReadonlySignal<SelectOption[]>;
    /** 文生图工作流下拉选项（自动追加失效项提示） */
    public readonly txt2imgWorkflowOptions: ReadonlySignal<SelectOption[]>;
    /** 图生图工作流下拉选项（含不启用项与失效项提示） */
    public readonly img2imgWorkflowOptions: ReadonlySignal<SelectOption[]>;

    /** 供内嵌 PromptPresetManager 消费的条目列表 */
    public readonly promptCardPresets: ReadonlySignal<PromptCardPresetItem[]>;
    /** 供内嵌 WorkflowCard 消费的条目列表 */
    public readonly workflowCardPresets: ReadonlySignal<WorkflowCardPresetItem[]>;

    private unlistenSettings: (() => void) | null = null;

    public constructor(options: ProviderTabViewModelOptions) {
        this.provider = options.provider;
        this.options = options;

        const providerCfg = this.readProviderStoreConfig();
        this.connectionData = signal<ConnectionCardData>({
            serverUrl: providerCfg.serverUrl || options.defaultServerUrl,
            apiKey: providerCfg.apiKey || '',
            activePresetId: providerCfg.serviceId || options.defaultServiceId,
        });

        this.categorizedModels = signal<{ checkpoints: string[]; unets: string[] } | null>(null);
        this.serverModels = signal<string[]>([]);
        this.hasFetchedModels = signal<boolean>(false);
        this.serverVaes = signal<string[]>([]);
        this.hasFetchedVaes = signal<boolean>(false);
        this.serverClips = signal<string[]>([]);
        this.hasFetchedClips = signal<boolean>(false);
        this.serverLoras = signal<string[]>([]);
        this.hasFetchedLoras = signal<boolean>(false);
        this.samplerOptions = signal<SelectOption[]>(options.defaultSamplers ?? []);
        this.schedulerOptions = signal<SelectOption[]>(options.defaultSchedulers ?? []);

        this.promptPresets = signal<PresetItem<PromptPresetData>[]>(
            settingsStore.getPresets<PromptPresetData>('prompts')
        );
        this.workflowPresets = signal<PresetItem<WorkflowPresetData>[]>(
            settingsStore.getPresets<WorkflowPresetData>('workflows')
        );

        this.presetController = new PresetController<DrawingPresetData>({
            category: 'drawing',
            provider: this.provider,
            idPrefix: options.idPrefix ?? `${this.provider}_preset_`,
            promptMessageForNew: options.promptMessageForNew ?? '请输入新绘图方案名称:',
            defaultNewName: options.defaultNewName ?? '新建方案',
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
        });

        // 1. 派生主模型下拉选项 (支持类别分组)
        this.effectiveModelOptions = computed(() => {
            const currentModel = (this.presetController.draftConfig.value.baseModel as string) || '';
            const cat = this.categorizedModels.value;
            const fetched = this.serverModels.value;
            const hasFetched = this.hasFetchedModels.value;
            const defaults = this.options.defaultModels ?? [];

            // 若具有分类探测数据（如 ComfyUI），按照 Checkpoint 与 UNet / 扩散模型分组展示
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
                        label: `${currentModel} (未在服务端检测到)`,
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
                        { label: `${currentModel} (未在服务端检测到)`, value: currentModel },
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
                : [{ label: '(未选择主模型)', value: '' }];
        });

        // 2. 派生外置 VAE 下拉选项
        this.effectiveVaeOptions = computed(() => {
            const currentVae =
                (this.presetController.draftConfig.value.vaeName as string) || '';
            const fetched = this.serverVaes.value;
            const hasFetched = this.hasFetchedVaes.value;
            const isComfy = this.provider === 'comfyui';

            const defaultLabel = isComfy ? '(使用模型内置)' : '自动匹配 (automatic)';
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
                        label: `${currentVae} (未在服务端检测到)`,
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

            const opts: SelectOption[] = [{ label: '(使用模型内置)', value: '' }];
            if (hasFetched && fetched.length > 0) {
                opts.push(...fetched.map((c) => ({ label: c, value: c })));
            }

            if (currentClip && !opts.some((o) => o.value === currentClip)) {
                opts.push({ label: `${currentClip} (未在服务端检测到)`, value: currentClip });
            }
            return opts;
        });

        // 3. 派生提示词预设下拉选项
        this.promptPresetOptions = computed(() => {
            const prompts = this.promptPresets.value;
            const boundId = this.presetController.draftConfig.value.promptPresetId || '';
            const opts: SelectOption[] = prompts.map((p) => ({
                label: p.name || '未命名提示词预设',
                value: p.id,
            }));
            if (boundId && !prompts.some((p) => p.id === boundId)) {
                opts.unshift({
                    label: `[已失效] 未知提示词方案 (${boundId})`,
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
                    label: `[已失效] 未知工作流 (${boundId})`,
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
                { label: '(不启用图生图工作流)', value: '' },
                ...workflows.map((w) => ({
                    label: w.name,
                    value: w.id,
                })),
            ];
            if (boundId && !workflows.some((w) => w.id === boundId)) {
                opts.unshift({
                    label: `[已失效] 未知工作流 (${boundId})`,
                    value: boundId,
                });
            }
            return opts;
        });

        // 6. 派生 PromptPresetManager 条目列表
        this.promptCardPresets = computed(() =>
            this.promptPresets.value.map((p) => ({
                id: p.id,
                name: p.name,
                data: {
                    positivePrefix: p.data?.positivePrefix || '',
                    positiveSuffix: p.data?.positiveSuffix || '',
                    negativePrompt: p.data?.negativePrompt || '',
                    loras: (p.data?.loras || []).map((l, idx) => ({
                        id: `lora_${p.id}_${idx}`,
                        enabled: true,
                        modelName: l.name || '',
                        modelWeight: l.weight ?? 0.8,
                        clipWeight: l.weight ?? 0.8,
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
    private readProviderStoreConfig(): {
        serverUrl?: string;
        apiKey?: string;
        serviceId?: string;
        activeDrawingPresetId?: string;
    } {
        return (
            settingsStore.getProviderConfig<{
                serverUrl?: string;
                apiKey?: string;
                serviceId?: string;
                activeDrawingPresetId?: string;
            }>(this.provider) || {}
        );
    }

    /**
     * 计算当前方案绑定的外键引用（提示词预设 ID、工作流预设 ID）是否失效。
     */
    private computeInvalidBindings(draft: DrawingPresetData): Set<string> {
        const invalid = new Set<string>();
        const prompts = this.promptPresets.value;
        if (draft.promptPresetId && !prompts.some((p) => p.id === draft.promptPresetId)) {
            invalid.add('promptPresetId');
        }

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
     */
    public updateConnection(data: ConnectionCardData): void {
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
        settingsStore.setProviderConfig(this.provider, patch);
    }

    /**
     * 执行提供商连通性健康探测。
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
     * 从服务端拉取模型、VAE 与采样器列表并合并到响应式信号中。
     */
    public async refreshServerAssets(): Promise<AssetFetchResult> {
        const provider = providerRegistry.getProvider(this.provider);

        if (!provider) {
            throw new Error(`未注册 ${this.provider} 服务提供方`);
        }

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

        // 4. 拉取采样器列表 (如 SD-WebUI)
        if (typeof provider.fetchSamplers === 'function') {
            const samplers = await provider.fetchSamplers();
            if (Array.isArray(samplers) && samplers.length > 0) {
                totalCount += samplers.length;
                this.samplerOptions.value = samplers.map((s) => ({ label: s, value: s }));
            }
        }

        // 5. 拉取 LoRA 模型列表 (如 SD-WebUI, ComfyUI)
        if (typeof provider.fetchLoras === 'function') {
            const loras = await provider.fetchLoras();
            if (Array.isArray(loras) && loras.length > 0) {
                totalCount += loras.length;
                this.serverLoras.value = loras;
                this.hasFetchedLoras.value = true;
            }
        }

        return {
            count: totalCount,
            message:
                totalCount > 0
                    ? `已成功同步 ${totalCount} 项服务端模型资产`
                    : '未发现可用模型或服务端不支持查询',
        };
    }

    /**
     * 刷新全局提示词与工作流方案池信号。
     */
    public refreshAssetPools(): void {
        this.promptPresets.value = settingsStore.getPresets<PromptPresetData>('prompts');
        this.workflowPresets.value = settingsStore.getPresets<WorkflowPresetData>('workflows');
    }

    /**
     * 响应内嵌 PromptPresetManager 的操作动作。
     */
    public handlePromptAssetAction(
        action: PresetActionType,
        pId: string,
        data?: PromptCardData
    ): void {
        if (action === 'save' && data) {
            const pr = settingsStore.getPreset<PromptPresetData>('prompts', pId);
            if (pr) {
                pr.data = {
                    ...pr.data,
                    positivePrefix: data.positivePrefix,
                    positiveSuffix: data.positiveSuffix,
                    negativePrompt: data.negativePrompt,
                    loras: (data.loras || [])
                        .filter((l) => l.enabled && l.modelName)
                        .map((l) => ({
                            name: l.modelName,
                            weight: l.modelWeight,
                        })),
                };
                settingsStore.savePreset('prompts', pr);
            }
        }
        this.refreshAssetPools();
    }

    /**
     * 响应内嵌 WorkflowCard 的操作动作。
     */
    public handleWorkflowAssetAction(
        action: PresetActionType,
        wfId: string,
        data?: WorkflowCardData
    ): void {
        if (action === 'save' && data?.json) {
            try {
                const parsed = JSON.parse(data.json);
                const wf = settingsStore.getPreset<WorkflowPresetData>('workflows', wfId);
                if (wf) {
                    wf.data = { ...wf.data, workflow: parsed };
                    settingsStore.savePreset('workflows', wf);
                }
            } catch {
                Toast.show('工作流保存失败：JSON 语法错误', { level: 'error' });
            }
        }
        this.refreshAssetPools();
    }

    /**
     * 视图激活时同步外部存储并建立事件监听。
     */
    public activate(): void {
        const cfg = this.readProviderStoreConfig();
        this.connectionData.value = {
            serverUrl: cfg.serverUrl || this.options.defaultServerUrl,
            apiKey: cfg.apiKey || '',
            activePresetId: cfg.serviceId || this.options.defaultServiceId,
        };
        this.refreshAssetPools();
        this.presetController.applyActivePreset(cfg.activeDrawingPresetId || '');

        if (!this.unlistenSettings) {
            this.unlistenSettings = eventBus.on('settings:updated', (payload) => {
                const freshCfg = this.readProviderStoreConfig();
                this.connectionData.value = {
                    serverUrl: freshCfg.serverUrl || this.options.defaultServerUrl,
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
