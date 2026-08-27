/**
 * @module ui/views/comfyui-tab
 * @description ComfyUI 生图后端配置面板视图 (ComfyUI Tab) - 声明式 Schema 架构重构版
 */

import { ObservableStore } from '../../core/state/store';
import {
    DrawAssistantSettings,
    ModelProfileData,
    PromptProfileData
} from '../../core/state/store-types';
import {
    FormRenderer,
    SectionCardSchema,
    createCollapsibleSection,
    createConnectionCard,
    createLoraManagerControl,
    SelectOptionItem
} from '../controls';
import {
    createWorkflowPresetCard,
    bindPresetToolbar
} from '../presets';
import { FeedbackService } from '../feedback/feedback';
import type { IDriverRegistry } from '../../core/registry/driver-registry';
import { IDisposable } from '../../core/foundation/disposable';
import { DEFAULT_COMFYUI_URL, COMFYUI_SIZE_PRESETS } from '../../core/constants';
import {
    fetchComfyUIModels,
    fetchComfyUIPrompts,
    fetchComfyUITxt2ImgWorkflows,
    fetchComfyUIInpaintWorkflows
} from '../../core/config/config-loader';

/**
 * 构建并渲染 ComfyUI 后端引擎配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @param drivers 生图驱动注册中心抽象
 * @returns 包含生命周期清理能力的 ComfyUI 配置面板 DOM 根节点
 */
export function createComfyUITabView(
    store: ObservableStore<DrawAssistantSettings>,
    drivers?: IDriverRegistry
): HTMLElement & IDisposable {
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-comfyui-tab';

    /**
     * 界面状态分层设计：
     * 1. draftStore (内存草稿)：用于承载下方 C3/C4 参数输入框与滑块。
     *    用户在界面微调宽高、步数、CFG 或切换方案时，仅在内存中更新草稿，绝不触发写盘；
     * 2. store (持久化中心)：用于记录当前选中的方案 ID 与已保存的方案列表。
     *    只有当用户明确点击工具栏的「保存方案」时，才将草稿数据存入方案列表并持久化落盘；
     * 3. 双渲染器：rendererDraft 绑定草稿，rendererMain 绑定持久化配置。
     */
    const draftStore = new ObservableStore<DrawAssistantSettings>({ ...store.getState() });
    const rendererDraft = new FormRenderer<DrawAssistantSettings>(draftStore);
    const rendererMain = new FormRenderer<DrawAssistantSettings>(store);

    /**
     * 将模型方案数据批量应用到草稿 Store（单次 update 避免多次 listener 触发）
     */
    const applyModelProfileData = (d: ModelProfileData): void => {
        const patch: Partial<DrawAssistantSettings> = {};
        if (d.ckptName) patch.ckptName = d.ckptName;
        if (d.clipName) patch.clipName = d.clipName;
        if (d.vaeName) patch.vaeName = d.vaeName;
        if (d.width) patch.width = d.width;
        if (d.height) patch.height = d.height;
        if (d.steps) patch.steps = d.steps;
        if (d.cfgScale) patch.cfgScale = d.cfgScale;
        if (d.samplerName) patch.samplerName = d.samplerName;
        if (d.scheduler) patch.scheduler = d.scheduler;
        if (d.checkpointPositivePrefix !== undefined) patch.checkpointPositivePrefix = d.checkpointPositivePrefix;
        if (d.checkpointNegativePrefix !== undefined) patch.checkpointNegativePrefix = d.checkpointNegativePrefix;
        if (d.inpaintDenoise !== undefined) patch.inpaintDenoise = d.inpaintDenoise;
        if (d.inpaintMaskBlur !== undefined) patch.inpaintMaskBlur = d.inpaintMaskBlur;
        if (d.inpaintGrowMask !== undefined) patch.inpaintGrowMask = d.inpaintGrowMask;
        draftStore.update(patch);
    };

    /**
     * 将提示词方案数据批量应用到草稿 Store（单次 update 避免多次 listener 触发）
     */
    const applyPromptProfileData = (d: PromptProfileData): void => {
        const patch: Partial<DrawAssistantSettings> = {};
        if (d.promptPrefix !== undefined) patch.promptPrefix = d.promptPrefix;
        if (d.negativePrefix !== undefined) patch.negativePrefix = d.negativePrefix;
        if (d.promptSuffix !== undefined) patch.promptSuffix = d.promptSuffix;
        if (d.loras) patch.loras = d.loras;
        draftStore.update(patch);
    };

    // ── C1: API 服务连接卡片 ───────────────────────────────────────────────
    const cardC1 = createConnectionCard({
        title: 'API 服务连接',
        description: '配置 ComfyUI HTTP 服务根地址，测试连通性并自动拉取后端全量模型与 LoRA 列表',
        url: store.get('serverUrl') || DEFAULT_COMFYUI_URL,
        placeholder: 'http://127.0.0.1:8188',
        onUrlChange: (newUrl) => store.set('serverUrl', newUrl),
        onTest: async (url, btn) => {
            btn.disabled = true;
            btn.textContent = '连接中...';
            try {
                store.set('serverUrl', url);
                const driver = drivers?.get('comfyui');
                if (!driver) {
                    FeedbackService.toastError('🔴 驱动未就绪: ComfyUI 驱动未注册');
                    return;
                }

                const result = driver.checkConnection
                    ? await driver.checkConnection()
                    : { connected: await driver.ping(), latencyMs: 0 };

                if (result.connected) {
                    const syncResult = driver.syncAssets ? await driver.syncAssets(store) : { updatedCount: 0, summary: '', details: {} };
                    FeedbackService.toastSuccess(
                        `🟢 ComfyUI 连接成功 (延迟 ${result.latencyMs ?? 0}ms)\n${syncResult.summary}`
                    );
                } else {
                    FeedbackService.toastError('🔴 ComfyUI 连接失败: 无法访问后端服务');
                }
            } catch (err: any) {
                FeedbackService.toastError(`🔴 连接异常: ${err?.message || err}`);
            } finally {
                if (btn && btn.isConnected) {
                    btn.disabled = false;
                    btn.textContent = '测试连接';
                }
            }
        }
    });
    container.appendChild(cardC1);

    // ── C2: 局部方案快捷切换卡片 ─────────────────────────────────────────────
    const getModelProfiles = (): SelectOptionItem[] => [
        { label: '(未关联/自定义)', value: '' },
        ...(store.get('comfyModelProfiles') || []).map((p) => ({ label: p.name, value: p.id }))
    ];

    const getPromptProfiles = (): SelectOptionItem[] => [
        { label: '(未关联/自定义)', value: '' },
        ...(store.get('comfyPromptProfiles') || []).map((p) => ({ label: p.name, value: p.id }))
    ];

    const getTxt2ImgWorkflows = (): SelectOptionItem[] => [
        { label: '(未关联/自定义)', value: '' },
        ...(store.get('comfyTxt2ImgWorkflows') || []).map((p) => ({ label: p.name, value: p.id }))
    ];

    const getInpaintWorkflows = (): SelectOptionItem[] => [
        { label: '(未关联/自定义)', value: '' },
        ...(store.get('comfyInpaintWorkflows') || []).map((p) => ({ label: p.name, value: p.id }))
    ];

    const cardC2Schema: SectionCardSchema<DrawAssistantSettings> = {
        title: '局部方案快捷切换',
        description: '在 ComfyUI 面板顶部直接快速切换并装载模型参数、提示词、文生图及局部重绘方案',
        rows: [
            {
                key: 'comfyModelProfileId',
                type: 'select',
                label: '模型参数方案',
                helpTooltip: '快捷切换底模、CLIP、VAE 解码器、分辨率及采样步数预设。',
                options: getModelProfiles(),
                onChangeHook: (id) => {
                    if (id) {
                        const profile = (store.get('comfyModelProfiles') || []).find((p) => p.id === id);
                        if (profile?.data) applyModelProfileData(profile.data);
                    }
                }
            },
            {
                key: 'comfyPromptProfileId',
                type: 'select',
                label: '提示词方案',
                helpTooltip: '快捷切换全局正向提示词前缀/后缀、负向词与绑定的 LoRA 方案。',
                options: getPromptProfiles(),
                onChangeHook: (id) => {
                    if (id) {
                        const profile = (store.get('comfyPromptProfiles') || []).find((p) => p.id === id);
                        if (profile?.data) applyPromptProfileData(profile.data);
                    }
                }
            },
            {
                key: 'comfyTxt2ImgWorkflowId',
                type: 'select',
                label: '文生图工作流方案',
                helpTooltip: '快捷切换标准 API 格式文生图 Workflow JSON 预设。',
                options: getTxt2ImgWorkflows(),
                onChangeHook: (id) => {
                    if (id) {
                        const wf = (store.get('comfyTxt2ImgWorkflows') || []).find((p) => p.id === id);
                        if (wf?.data?.json) store.set('workflowJson', wf.data.json);
                    }
                }
            },
            {
                key: 'comfyInpaintWorkflowId',
                type: 'select',
                label: '局部重绘工作流方案',
                helpTooltip: '快捷切换 Mask 掩码抠图与局部重绘 API Format Workflow JSON 预设。',
                options: getInpaintWorkflows(),
                onChangeHook: (id) => {
                    if (id) {
                        const wf = (store.get('comfyInpaintWorkflows') || []).find((p) => p.id === id);
                        if (wf?.data?.json) store.set('inpaintWorkflowJson', wf.data.json);
                    }
                }
            }
        ]
    };
    container.appendChild(rendererMain.renderCard(cardC2Schema));

    // ── C3: 底模与采样参数配置卡片 ───────────────────────────────────────────
    const getCachedModels = (): SelectOptionItem[] => [
        { label: '未选择', value: '' },
        ...(store.get('cachedModels') || []).map((m) => ({ label: m, value: m }))
    ];
    const getCachedClips = (): SelectOptionItem[] => [
        { label: '未选择 (使用底模自带)', value: '' },
        ...(store.get('cachedClips') || []).map((c) => ({ label: c, value: c }))
    ];
    const getCachedVaes = (): SelectOptionItem[] => [
        { label: '未选择 (使用底模自带)', value: '' },
        ...(store.get('cachedVaes') || []).map((v) => ({ label: v, value: v }))
    ];
    const getCachedSamplers = (): SelectOptionItem[] =>
        (store.get('cachedSamplers') || ['euler_ancestral', 'euler', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc']).map((s) => ({ label: s, value: s }));
    const getCachedSchedulers = (): SelectOptionItem[] =>
        (store.get('cachedSchedulers') || ['normal', 'karras', 'exponential', 'sgm_uniform']).map((s) => ({ label: s, value: s }));

    const toolbarC3 = bindPresetToolbar({
        adapter: {
            label: '模型参数',
            getProfiles: () => (store.get('comfyModelProfiles') || []).map((p) => ({ id: p.id, name: p.name, data: p.data })),
            getInitialId: () => store.get('comfyModelProfileId') || '',
            createProfile: (name, data: ModelProfileData) => {
                const id = `model_${Date.now()}`;
                const current = store.get('comfyModelProfiles') || [];
                store.set('comfyModelProfiles', [...current, { id, name, data }]);
                store.set('comfyModelProfileId', id);
                return id;
            },
            saveProfile: (id, data: ModelProfileData) => {
                const current = store.get('comfyModelProfiles') || [];
                store.set('comfyModelProfiles', current.map((p) => (p.id === id ? { ...p, data } : p)));
            },
            renameProfile: (id, newName) => {
                const current = store.get('comfyModelProfiles') || [];
                store.set('comfyModelProfiles', current.map((p) => (p.id === id ? { ...p, name: newName } : p)));
            },
            deleteProfile: (id) => {
                const current = store.get('comfyModelProfiles') || [];
                store.set('comfyModelProfiles', current.filter((p) => p.id !== id));
                store.set('comfyModelProfileId', '');
                return '';
            },
            resetToDefault: async () => {
                try {
                    const defaults = await fetchComfyUIModels();
                    store.set('comfyModelProfiles', defaults);
                    store.set('comfyModelProfileId', defaults[0]?.id || '');
                } catch {
                    store.set('comfyModelProfiles', []);
                    store.set('comfyModelProfileId', '');
                }
            }
        },
        getCurrentData: () => ({
            ckptName: draftStore.get('ckptName'),
            clipName: draftStore.get('clipName'),
            vaeName: draftStore.get('vaeName'),
            width: draftStore.get('width'),
            height: draftStore.get('height'),
            steps: draftStore.get('steps'),
            cfgScale: draftStore.get('cfgScale'),
            samplerName: draftStore.get('samplerName'),
            scheduler: draftStore.get('scheduler'),
            checkpointPositivePrefix: draftStore.get('checkpointPositivePrefix'),
            checkpointNegativePrefix: draftStore.get('checkpointNegativePrefix'),
            inpaintDenoise: draftStore.get('inpaintDenoise'),
            inpaintMaskBlur: draftStore.get('inpaintMaskBlur'),
            inpaintGrowMask: draftStore.get('inpaintGrowMask')
        }),
        applyData: (id) => {
            const profile = (store.get('comfyModelProfiles') || []).find((p) => p.id === id);
            if (profile?.data) applyModelProfileData(profile.data);
        },
        onRefresh: () => {}
    });


    const cardC3Schema: SectionCardSchema<DrawAssistantSettings> = {
        title: '底模与采样参数配置',
        description: '配置主模型 (Checkpoint)、CLIP 编码器、VAE、采样步数及分辨率尺寸',
        rows: [
            {
                type: 'component',
                label: '模型参数方案管理',
                renderCustom: () => toolbarC3
            },
            {
                key: 'ckptName',
                type: 'select',
                label: '主模型 (Checkpoint)',
                helpTooltip: '从 ComfyUI 后端包含 CheckpointLoaderSimple, UNETLoader 等合并的所有可用模型。',
                options: getCachedModels()
            },
            {
                key: 'clipName',
                type: 'select',
                label: 'CLIP 文本编码器',
                helpTooltip: '指定独立 CLIP 文本编码器模型。若当前工作流已内置编码器或无需覆盖，留空未选择即可。',
                options: getCachedClips()
            },
            {
                key: 'vaeName',
                type: 'select',
                label: 'VAE 图像解码器',
                helpTooltip: '指定独立 VAE 解码器模型。若已包含于底模中或无需覆盖，留空未选择即可。',
                options: getCachedVaes()
            },
            {
                key: 'samplerName',
                type: 'select',
                label: '采样算法 (Sampler)',
                helpTooltip: '生图采样器算法（如 euler, euler_ancestral, dpmpp_2m 等）。',
                options: getCachedSamplers()
            },
            {
                key: 'scheduler',
                type: 'select',
                label: '调度器 (Scheduler)',
                helpTooltip: '采样时间步调度器（如 normal, karras, exponential, sgm_uniform 等）。',
                options: getCachedSchedulers()
            },
            {
                type: 'select',
                label: '分辨率尺寸预设',
                helpTooltip: '快捷选用推荐生成宽高比例，选择后自动同步至下方宽高输入框。',
                options: [...COMFYUI_SIZE_PRESETS],
                onChangeHook: (val: string) => {
                    if (val !== 'custom') {
                        const [w, h] = val.split('x').map((n) => parseInt(n, 10));
                        if (w && h) draftStore.update({ width: w, height: h });
                    }
                }
            },
            {
                key: 'width',
                type: 'number',
                label: '生成宽度 (Width, px)',
                helpTooltip: '生成图像的物理像素宽度。',
                min: 64,
                max: 4096,
                step: 64,
                unit: 'px'
            },
            {
                key: 'height',
                type: 'number',
                label: '生成高度 (Height, px)',
                helpTooltip: '生成图像的物理像素高度。',
                min: 64,
                max: 4096,
                step: 64,
                unit: 'px'
            },
            {
                key: 'steps',
                type: 'number',
                label: '采样步数 (Steps)',
                helpTooltip: '生成图像迭代采样步数。',
                min: 1,
                max: 150,
                step: 1,
                unit: '步'
            },
            {
                key: 'cfgScale',
                type: 'number',
                label: '提示词引导系数 (CFG Scale)',
                helpTooltip: 'CFG 文本引导权重（推荐 5.0 ~ 8.0）。',
                min: 1.0,
                max: 30.0,
                step: 0.5
            },
            {
                key: 'checkpointPositivePrefix',
                type: 'input',
                label: '模型专用正向提示词',
                helpTooltip: '绑定在此模型参数预设中的固有正向画风起手词（自动拼接在正向最前）。',
                placeholder: 'masterpiece, best quality, anime style...'
            },
            {
                key: 'checkpointNegativePrefix',
                type: 'input',
                label: '模型专用负向提示词',
                helpTooltip: '绑定在此模型参数预设中的固有避坑负向词（自动拼接在负向最前）。',
                placeholder: 'lowres, bad anatomy, worst quality...'
            },
            {
                type: 'component',
                label: '局部重绘与图生图参数',
                renderCustom: () => {
                    return createCollapsibleSection({
                        summaryText: '局部重绘与图生图参数',
                        defaultOpen: false,
                        renderBody: (inpaintBody) => {
                            inpaintBody.appendChild(
                                rendererDraft.renderRow({
                                    key: 'inpaintDenoise',
                                    type: 'number',
                                    label: '重绘重噪幅度',
                                    helpTooltip: '局部重绘/图生图的重噪强度（0.05 ~ 1.0，推荐 0.6 ~ 0.85）。',
                                    min: 0.05,
                                    max: 1.0,
                                    step: 0.05
                                })
                            );
                            inpaintBody.appendChild(
                                rendererDraft.renderRow({
                                    key: 'inpaintMaskBlur',
                                    type: 'number',
                                    label: '蒙版羽化半径',
                                    helpTooltip: '局部重绘边缘模糊过渡像素 (0 ~ 64 px，推荐 4 ~ 12 px)。',
                                    min: 0,
                                    max: 64,
                                    step: 1,
                                    unit: 'px'
                                })
                            );
                            inpaintBody.appendChild(
                                rendererDraft.renderRow({
                                    key: 'inpaintGrowMask',
                                    type: 'number',
                                    label: '蒙版外扩像素',
                                    helpTooltip: '涂抹掩码向外自动扩展的外扩像素 (0 ~ 64 px，推荐 4 ~ 8 px)。',
                                    min: 0,
                                    max: 64,
                                    step: 1,
                                    unit: 'px'
                                })
                            );
                        }
                    });
                }
            }
        ]
    };
    container.appendChild(rendererDraft.renderCard(cardC3Schema));

    // ── C4: 提示词模板与 LoRA 增强卡片 ──────────────────────────────────────
    const toolbarC4 = bindPresetToolbar({
        adapter: {
            label: '提示词',
            getProfiles: () => (store.get('comfyPromptProfiles') || []).map((p) => ({ id: p.id, name: p.name, data: p.data })),
            getInitialId: () => store.get('comfyPromptProfileId') || '',
            createProfile: (name, data: PromptProfileData) => {
                const id = `prompt_${Date.now()}`;
                const current = store.get('comfyPromptProfiles') || [];
                store.set('comfyPromptProfiles', [...current, { id, name, data }]);
                store.set('comfyPromptProfileId', id);
                return id;
            },
            saveProfile: (id, data: PromptProfileData) => {
                const current = store.get('comfyPromptProfiles') || [];
                store.set('comfyPromptProfiles', current.map((p) => (p.id === id ? { ...p, data } : p)));
            },
            renameProfile: (id, newName) => {
                const current = store.get('comfyPromptProfiles') || [];
                store.set('comfyPromptProfiles', current.map((p) => (p.id === id ? { ...p, name: newName } : p)));
            },
            deleteProfile: (id) => {
                const current = store.get('comfyPromptProfiles') || [];
                store.set('comfyPromptProfiles', current.filter((p) => p.id !== id));
                store.set('comfyPromptProfileId', '');
                return '';
            },
            resetToDefault: async () => {
                try {
                    const defaults = await fetchComfyUIPrompts();
                    store.set('comfyPromptProfiles', defaults);
                    store.set('comfyPromptProfileId', defaults[0]?.id || '');
                } catch {
                    store.set('comfyPromptProfiles', []);
                    store.set('comfyPromptProfileId', '');
                }
            }
        },
        getCurrentData: () => ({
            promptPrefix: draftStore.get('promptPrefix'),
            negativePrefix: draftStore.get('negativePrefix'),
            promptSuffix: draftStore.get('promptSuffix'),
            loras: draftStore.get('loras')
        }),
        applyData: (id) => {
            const profile = (store.get('comfyPromptProfiles') || []).find((p) => p.id === id);
            if (profile?.data) applyPromptProfileData(profile.data);
        },
        onRefresh: () => {}
    });


    const cardC4Schema: SectionCardSchema<DrawAssistantSettings> = {
        title: '提示词模板与 LoRA 增强',
        description: '维护正向前缀词、正向后缀词、负向词及 LoRA 动态选择与权重追加列表',
        rows: [
            {
                type: 'component',
                label: '提示词方案管理',
                renderCustom: () => toolbarC4
            },
            {
                key: 'promptPrefix',
                type: 'input',
                label: '全局正向提示词前缀',
                helpTooltip: '自动拼接在 AI 楼层正向提示词的最前端。例如质量词、画风起手词等。',
                placeholder: 'masterpiece, best quality, highly detailed...'
            },
            {
                key: 'promptSuffix',
                type: 'input',
                label: '全局正向提示词后缀',
                helpTooltip: '自动拼接在 AI 楼层正向提示词的末尾。',
                placeholder: 'vibrant lighting, 8k resolution...'
            },
            {
                key: 'negativePrefix',
                type: 'input',
                label: '全局负向提示词',
                helpTooltip: '全局排除的不期望特征或画质瑕疵词。',
                placeholder: 'lowres, bad anatomy, worst quality, text, error...'
            },
            {
                type: 'component',
                label: '追加 LoRA 模型预设 (WeiLin)',
                renderCustom: () => {
                    return createCollapsibleSection({
                        summaryText: '追加 LoRA 模型预设 (WeiLin)',
                        defaultOpen: false,
                        renderBody: (loraBody) => {
                            const loraManager = createLoraManagerControl({
                                loras: draftStore.get('loras') || store.get('loras') || [],
                                cachedLoras: store.get('cachedLoras') || [],
                                showExtraWeights: true,
                                onChange: (newLoras) => {
                                    draftStore.set('loras', newLoras);
                                }
                            });
                            loraBody.appendChild(loraManager);
                        }
                    });
                }
            }
        ]
    };
    container.appendChild(rendererDraft.renderCard(cardC4Schema));

    // ── C5: 文生图工作流预设卡片 ─────────────────────────────────────────────
    const cardC5Workflow = createWorkflowPresetCard({
        title: '文生图工作流预设',
        description: '维护标准文本生成图像 API Format Workflow JSON，支持通过蓝图可视化编辑器绑定变量',
        label: '文生图工作流',
        blueprintMode: 'txt2img',
        fieldLabel: '文生图 API 工作流 JSON',
        helpTooltip: 'ComfyUI 开启 Dev Mode 导出的 API 格式文生图工作流 JSON。可点击右侧按钮打开可视化蓝图。',
        placeholder: '请输入 API 格式文生图 Workflow JSON，或使用上方工具栏导入与选择工作流...',
        getProfiles: () => store.get('comfyTxt2ImgWorkflows') || [],
        getCurrentProfileId: () => store.get('comfyTxt2ImgWorkflowId') || '',
        getCurrentJson: () => store.get('workflowJson') || '',
        onProfilesChange: (profiles, activeId) => {
            store.set('comfyTxt2ImgWorkflows', profiles);
            store.set('comfyTxt2ImgWorkflowId', activeId);
        },
        onJsonChange: (json) => store.set('workflowJson', json),
        fetchDefaults: fetchComfyUITxt2ImgWorkflows,
        onRefresh: () => {}
    });
    container.appendChild(cardC5Workflow);

    // ── C6: 局部重绘工作流预设卡片 ─────────────────────────────────────────
    const cardC6Workflow = createWorkflowPresetCard({
        title: '局部重绘工作流预设',
        description: '配置用于图像局部抠图、修补与重绘的 API Format Workflow JSON',
        label: '重绘工作流',
        blueprintMode: 'inpaint',
        fieldLabel: '重绘 API 工作流 JSON',
        helpTooltip: '用于 Mask 掩码抠图与 Inpaint 生成的 ComfyUI 工作流。可点击右侧按钮打开可视化蓝图。',
        placeholder: '请输入 API 格式局部重绘 Workflow JSON，或使用上方工具栏导入与选择工作流...',
        getProfiles: () => store.get('comfyInpaintWorkflows') || [],
        getCurrentProfileId: () => store.get('comfyInpaintWorkflowId') || '',
        getCurrentJson: () => store.get('inpaintWorkflowJson') || '',
        onProfilesChange: (profiles, activeId) => {
            store.set('comfyInpaintWorkflows', profiles);
            store.set('comfyInpaintWorkflowId', activeId);
        },
        onJsonChange: (json) => store.set('inpaintWorkflowJson', json),
        fetchDefaults: fetchComfyUIInpaintWorkflows,
        onRefresh: () => {}
    });
    container.appendChild(cardC6Workflow);


    container.dispose = () => {
        rendererDraft.dispose();
        rendererMain.dispose();
        draftStore.dispose();
    };

    return container;
}
