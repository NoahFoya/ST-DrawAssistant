/**
 * @module ui/views/sdwebui-tab
 * @description Stable Diffusion WebUI (AUTOMATIC1111 / Forge) 生图后端配置面板视图 (SDWebUITabView)
 */

import { ConfigStore } from '../../core';
import { AdapterRegistry } from '../../domain/drivers/adapter-registry';
import {
    FormRenderer,
    SectionCardSchema,
    createConnectionCard,
    createLoraManagerControl,
    LoraItem
} from '../controls';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { EngineFormStore } from '../foundation/form-binder';

/** SD-WebUI 配置类型定义 */
export interface SDWebUIConfig {
    serverUrl?: string;
    model?: string;
    samplerName?: string;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    clipSkip?: number;
    denoisingStrength?: number;
    enableHires?: boolean;
    hiresUpscaler?: string;
    hiresScale?: number;
    hiresSteps?: number;
    hiresDenoise?: number;
    promptPrefix?: string;
    negativePrefix?: string;
    promptSuffix?: string;
    negativeSuffix?: string;
    loras?: LoraItem[];
    [key: string]: any;
}

export class SDWebUITabView extends BaseTabView {
    private readonly _engineStore: EngineFormStore<SDWebUIConfig>;
    private readonly _renderer: FormRenderer<SDWebUIConfig>;
    private readonly _adapterRegistry?: AdapterRegistry;

    constructor(
        private readonly _mainStore: ConfigStore,
        adapterRegistry?: AdapterRegistry
    ) {
        super('da-sdwebui-tab');
        this._adapterRegistry = adapterRegistry;

        const initialConfig: SDWebUIConfig = {
            serverUrl: 'http://127.0.0.1:7860',
            steps: 20,
            cfgScale: 7,
            width: 512,
            height: 768,
            samplerName: 'Euler a',
            clipSkip: 2,
            denoisingStrength: 0.7,
            enableHires: false,
            hiresUpscaler: 'R-ESRGAN 4x+',
            hiresScale: 1.5,
            hiresSteps: 15,
            hiresDenoise: 0.5,
            promptPrefix: '',
            negativePrefix: '',
            promptSuffix: '',
            negativeSuffix: '',
            loras: [],
            ..._mainStore.getEngineConfig('sdwebui')
        };

        this._engineStore = new EngineFormStore<SDWebUIConfig>(initialConfig, (data) => {
            this._mainStore.setEngineConfig('sdwebui', data);
        });
        this._mainStore.setEngineConfig('sdwebui', initialConfig);
        this._disposables.add(this._engineStore);

        this._renderer = new FormRenderer<SDWebUIConfig>(this._engineStore);
        this._disposables.add(this._renderer);

        this._buildCards();
    }

    private _buildCards(): void {
        const adapter = this._adapterRegistry?.get('sdwebui');

        // 1. 服务连接卡片
        const connectionCard = createConnectionCard({
            title: 'SD-WebUI 服务连接',
            description: '配置 Stable Diffusion WebUI / Forge 服务地址与连通性检测',
            currentUrl: this._engineStore.get('serverUrl'),
            defaultUrl: 'http://127.0.0.1:7860',
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

        // 3. 高分修复 (Hires.fix) 卡片
        this._root.appendChild(this._buildHiresCard());

        // 4. LoRA 管理卡片
        this._buildLoraCard();

        // 5. 提示词前后缀
        this._root.appendChild(this._buildPromptCard());
    }

    private _buildSamplingCard(): HTMLElement {
        const schema: SectionCardSchema<SDWebUIConfig> = {
            title: '基础模型与采样参数',
            description: '配置主模型、采样算法、迭代步数与生成尺寸',
            rows: [
                {
                    key: 'model',
                    type: 'input',
                    label: '主模型 Checkpoint 名称',
                    placeholder: '留空使用后端当前默认模型'
                },
                {
                    key: 'samplerName',
                    type: 'select',
                    label: '采样算法 (Sampler)',
                    options: [
                        { label: 'Euler a', value: 'Euler a' },
                        { label: 'Euler', value: 'Euler' },
                        { label: 'DPM++ 2M Karras', value: 'DPM++ 2M Karras' },
                        { label: 'DPM++ SDE Karras', value: 'DPM++ SDE Karras' },
                        { label: 'DPM++ 2M SDE Karras', value: 'DPM++ 2M SDE Karras' },
                        { label: 'DDIM', value: 'DDIM' }
                    ]
                },
                {
                    key: 'steps',
                    type: 'number',
                    label: '迭代步数 (Steps)',
                    min: 1,
                    max: 150,
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
                    min: 128,
                    max: 2048,
                    step: 64,
                    unit: 'px'
                },
                {
                    key: 'height',
                    type: 'number',
                    label: '图像默认高度',
                    min: 128,
                    max: 2048,
                    step: 64,
                    unit: 'px'
                },
                {
                    key: 'clipSkip',
                    type: 'number',
                    label: 'CLIP Skip (跳过层数)',
                    min: 1,
                    max: 12,
                    step: 1,
                    unit: '层'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    private _buildHiresCard(): HTMLElement {
        const schema: SectionCardSchema<SDWebUIConfig> = {
            title: '高分辨率修复 (Hires.fix)',
            description: '通过两阶段潜空间或超分算法提升画质细节与分辨率',
            rows: [
                {
                    key: 'enableHires',
                    type: 'toggle',
                    label: '启用高清修复'
                },
                {
                    key: 'hiresUpscaler',
                    type: 'select',
                    label: '放大算法 (Upscaler)',
                    options: [
                        { label: 'R-ESRGAN 4x+', value: 'R-ESRGAN 4x+' },
                        { label: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
                        { label: 'Latent', value: 'Latent' },
                        { label: 'ESRGAN_4x', value: 'ESRGAN_4x' },
                        { label: 'ScuNET', value: 'ScuNET' }
                    ]
                },
                {
                    key: 'hiresScale',
                    type: 'number',
                    label: '放大倍数 (Upscale by)',
                    min: 1.1,
                    max: 4.0,
                    step: 0.1,
                    unit: 'x'
                },
                {
                    key: 'hiresSteps',
                    type: 'number',
                    label: '二次高清步数 (Hires steps)',
                    min: 0,
                    max: 100,
                    step: 1,
                    unit: '步'
                },
                {
                    key: 'hiresDenoise',
                    type: 'number',
                    label: '重绘幅度 (Denoising strength)',
                    min: 0.05,
                    max: 1.0,
                    step: 0.05
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    private _buildLoraCard(): void {
        const initialLoras: LoraItem[] = this._engineStore.get('loras') || [];
        const loraManager = createLoraManagerControl({
            loras: initialLoras,
            cachedLoras: [],
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
            <div style="font-size:12px;color:var(--da-text-muted);">配置 SD-WebUI 出图时嵌入的 &lt;lora:name:weight&gt; 权重模型</div>
        `;
        cardEl.appendChild(cardHeader);
        cardEl.appendChild(loraManager);
        this._root.appendChild(cardEl);
    }

    private _buildPromptCard(): HTMLElement {
        const schema: SectionCardSchema<SDWebUIConfig> = {
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
                    placeholder: 'lowres, bad anatomy, text, error, ...'
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
