/**
 * @module ui/views/comfyui-tab
 * @description ComfyUI 生图后端配置面板视图 (ComfyUITabView)
 */

import { ConfigStore } from '../../core';
import { AdapterRegistry } from '../../domain/drivers/adapter-registry';
import {
    FormRenderer,
    SectionCardSchema,
    createConnectionCard,
    createLoraManagerControl,
    LoraItem,
    createWorkflowPresetCard,
    PresetProfileItem,
    WorkflowProfileData
} from '../controls';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { EngineFormStore } from '../foundation/form-binder';

/** ComfyUI 后端配置类型定义 */
export interface ComfyUIConfig {
    serverUrl?: string;
    ckptName?: string;
    clipName?: string;
    vaeName?: string;
    samplerName?: string;
    scheduler?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    promptPrefix?: string;
    negativePrefix?: string;
    promptSuffix?: string;
    negativeSuffix?: string;
    loras?: LoraItem[];
    workflows?: PresetProfileItem<WorkflowProfileData>[];
    activeWorkflowId?: string;
    [key: string]: any;
}

export class ComfyUITabView extends BaseTabView {
    private readonly _engineStore: EngineFormStore<ComfyUIConfig>;
    private readonly _renderer: FormRenderer<ComfyUIConfig>;
    private readonly _adapterRegistry?: AdapterRegistry;

    constructor(
        private readonly _mainStore: ConfigStore,
        adapterRegistry?: AdapterRegistry
    ) {
        super('da-comfyui-tab');
        this._adapterRegistry = adapterRegistry;

        const initialConfig: ComfyUIConfig = {
            serverUrl: 'http://127.0.0.1:8188',
            steps: 20,
            cfgScale: 7,
            width: 832,
            height: 1216,
            samplerName: 'euler',
            scheduler: 'normal',
            promptPrefix: '',
            negativePrefix: '',
            promptSuffix: '',
            negativeSuffix: '',
            loras: [],
            ..._mainStore.getEngineConfig('comfyui')
        };

        this._engineStore = new EngineFormStore<ComfyUIConfig>(initialConfig, (data) => {
            this._mainStore.setEngineConfig('comfyui', data);
        });
        this._mainStore.setEngineConfig('comfyui', initialConfig);
        this._disposables.add(this._engineStore);

        this._renderer = new FormRenderer<ComfyUIConfig>(this._engineStore);
        this._disposables.add(this._renderer);

        this._buildCards();
    }

    private _buildCards(): void {
        const adapter = this._adapterRegistry?.get('comfyui');

        // 1. 服务连接卡片
        const connectionCard = createConnectionCard({
            title: 'ComfyUI 服务连接',
            description: '配置 ComfyUI 后端 API 地址与连通性检测',
            currentUrl: this._engineStore.get('serverUrl'),
            defaultUrl: 'http://127.0.0.1:8188',
            onUrlChange: (newUrl) => this._engineStore.set('serverUrl', newUrl),
            onTest: async (_url, btn) => {
                btn.disabled = true;
                btn.textContent = '测试中...';
                try {
                    const res = await adapter?.checkHealth();
                    if (res?.ok) {
                        FeedbackService.toastSuccess(`连接成功！延迟: ${res.latencyMs}ms`);
                        try {
                            if (adapter && typeof adapter.syncAssets === 'function') {
                                const catalog = await adapter.syncAssets();
                                if (catalog) {
                                    const modelCount = catalog.models?.length ?? 0;
                                    const loraCount = catalog.loras?.length ?? 0;
                                    FeedbackService.toastInfo(`已同步远端资产: ${modelCount} 个主模型，${loraCount} 个 LoRA`);
                                }
                            }
                        } catch {
                            // 资产探测失败不影响健康检查成功状态
                        }
                    } else {
                        FeedbackService.toastError(`连接失败: ${res?.message || '无法连接'}`);
                    }
                } catch (e: any) {
                    FeedbackService.toastError(`测试异常: ${e?.message || e}`);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '测试连接';
                }
            }
        });
        this._root.appendChild(connectionCard);

        // 2. 核心采样参数卡片
        this._root.appendChild(this._buildSamplingCard());

        // 3. 工作流卡片
        this._buildWorkflowCard();

        // 4. LoRA 管理卡片
        this._buildLoraCard();

        // 5. 提示词前后缀修饰
        this._root.appendChild(this._buildPromptCard());
    }

    private _buildSamplingCard(): HTMLElement {
        const schema: SectionCardSchema<ComfyUIConfig> = {
            title: '模型与采样参数',
            description: '配置 ComfyUI 基础出图尺寸、采样步数与模型名称',
            rows: [
                {
                    key: 'ckptName',
                    type: 'input',
                    label: 'Checkpoint 主模型文件名',
                    placeholder: 'v1-5-pruned-emaonly.safetensors'
                },
                {
                    key: 'samplerName',
                    type: 'select',
                    label: '采样算法 (Sampler)',
                    options: [
                        { label: 'euler', value: 'euler' },
                        { label: 'euler_ancestral', value: 'euler_ancestral' },
                        { label: 'dpmpp_2m', value: 'dpmpp_2m' },
                        { label: 'dpmpp_2m_sde', value: 'dpmpp_2m_sde' },
                        { label: 'dpmpp_sde', value: 'dpmpp_sde' },
                        { label: 'ddim', value: 'ddim' },
                        { label: 'uni_pc', value: 'uni_pc' }
                    ]
                },
                {
                    key: 'scheduler',
                    type: 'select',
                    label: '调度器 (Scheduler)',
                    options: [
                        { label: 'normal', value: 'normal' },
                        { label: 'karras', value: 'karras' },
                        { label: 'exponential', value: 'exponential' },
                        { label: 'sgm_uniform', value: 'sgm_uniform' },
                        { label: 'simple', value: 'simple' }
                    ]
                },
                {
                    key: 'steps',
                    type: 'number',
                    label: '迭代步数 (Steps)',
                    min: 1,
                    max: 100,
                    step: 1,
                    unit: '步'
                },
                {
                    key: 'cfgScale',
                    type: 'number',
                    label: '提示词相关性 (CFG Scale)',
                    min: 1,
                    max: 30,
                    step: 0.5
                },
                {
                    key: 'width',
                    type: 'number',
                    label: '图像默认宽度',
                    min: 256,
                    max: 2048,
                    step: 64,
                    unit: 'px'
                },
                {
                    key: 'height',
                    type: 'number',
                    label: '图像默认高度',
                    min: 256,
                    max: 2048,
                    step: 64,
                    unit: 'px'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    private _buildWorkflowCard(): void {
        const workflowCard = createWorkflowPresetCard({
            title: 'ComfyUI 节点工作流',
            description: '管理并导入 API 格式的 ComfyUI 节点工作流 JSON',
            label: '文生图工作流',
            blueprintMode: 'txt2img',
            fieldLabel: '工作流 JSON 定义',
            helpTooltip: '请在 ComfyUI Web 界面中勾选 Enable Dev Mode Options 后点击 Save (API Format) 导出并粘贴在此处。',
            getProfiles: () => this._engineStore.get('workflows') || [],
            getCurrentProfileId: () => this._engineStore.get('activeWorkflowId') || '',
            getCurrentJson: () => {
                const profiles: PresetProfileItem<WorkflowProfileData>[] = this._engineStore.get('workflows') || [];
                const activeId = this._engineStore.get('activeWorkflowId');
                const active = profiles.find((p) => p.id === activeId) || profiles[0];
                return active?.data?.json || '';
            },
            onProfilesChange: (profiles, activeId) => {
                this._engineStore.set('workflows', profiles);
                this._engineStore.set('activeWorkflowId', activeId);
            },
            onJsonChange: (json) => {
                const profiles: PresetProfileItem<WorkflowProfileData>[] = this._engineStore.get('workflows') || [];
                const activeId = this._engineStore.get('activeWorkflowId');
                const next = profiles.map((p) => p.id === activeId ? { ...p, data: { json } } : p);
                this._engineStore.set('workflows', next);
            },
            onRefresh: () => {}
        });

        this._root.appendChild(workflowCard);
    }

    private _buildLoraCard(): void {
        const initialLoras: LoraItem[] = this._engineStore.get('loras') || [];
        const loraManager = createLoraManagerControl({
            loras: initialLoras,
            cachedLoras: [],
            showExtraWeights: true,
            onChange: (loras) => {
                this._engineStore.set('loras', loras);
            }
        });

        const cardEl = document.createElement('div');
        cardEl.className = 'da-card';
        const cardHeader = document.createElement('div');
        cardHeader.className = 'da-card__header';
        cardHeader.innerHTML = `
            <div class="da-field-title">LoRA 附加模型管理</div>
            <div style="font-size:12px;color:var(--da-text-muted);">配置出图时附加的 LoRA 权重模型列表</div>
        `;
        cardEl.appendChild(cardHeader);
        cardEl.appendChild(loraManager);
        this._root.appendChild(cardEl);
    }

    private _buildPromptCard(): HTMLElement {
        const schema: SectionCardSchema<ComfyUIConfig> = {
            title: '提示词前后缀与修饰',
            description: '自动在生图提示词前后拼接专属标签',
            rows: [
                {
                    key: 'promptPrefix',
                    type: 'input',
                    label: '正向提示词前缀',
                    placeholder: 'masterpiece, best quality, ...'
                },
                {
                    key: 'negativePrefix',
                    type: 'input',
                    label: '负向提示词前缀',
                    placeholder: 'lowres, bad anatomy, ...'
                },
                {
                    key: 'promptSuffix',
                    type: 'input',
                    label: '正向提示词后缀',
                    placeholder: 'highly detailed, ...'
                },
                {
                    key: 'negativeSuffix',
                    type: 'input',
                    label: '负向提示词后缀',
                    placeholder: 'worst quality, normal quality, ...'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }
}
