/**
 * @module ui/views/novelai-tab
 * @description NovelAI 生图后端配置面板视图 (NovelAITabView)
 */

import { ConfigStore } from '../../core';
import { AdapterRegistry } from '../../domain/drivers/adapter-registry';
import {
    FormRenderer,
    SectionCardSchema,
    createConnectionCard
} from '../controls';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { EngineFormStore } from '../foundation/form-binder';

/** NovelAI 配置类型定义 */
export interface NovelAIConfig {
    serverUrl?: string;
    apiKey?: string;
    model?: string;
    sampler?: string;
    steps?: number;
    scale?: number;
    width?: number;
    height?: number;
    ucPreset?: number;
    smea?: boolean;
    smeaDyn?: boolean;
    [key: string]: any;
}

export class NovelAITabView extends BaseTabView {
    private readonly _engineStore: EngineFormStore<NovelAIConfig>;
    private readonly _renderer: FormRenderer<NovelAIConfig>;
    private readonly _adapterRegistry?: AdapterRegistry;

    constructor(
        private readonly _mainStore: ConfigStore,
        adapterRegistry?: AdapterRegistry
    ) {
        super('da-novelai-tab');
        this._adapterRegistry = adapterRegistry;

        const initialConfig: NovelAIConfig = {
            serverUrl: 'https://image.novelai.net',
            apiKey: '',
            model: 'nai-diffusion-4-curated-preview',
            sampler: 'k_euler',
            steps: 28,
            scale: 6.0,
            width: 832,
            height: 1216,
            ucPreset: 0,
            smea: false,
            smeaDyn: false,
            ..._mainStore.getEngineConfig('novelai')
        };

        this._engineStore = new EngineFormStore<NovelAIConfig>(initialConfig, (data) => {
            this._mainStore.setEngineConfig('novelai', data);
        });
        this._mainStore.setEngineConfig('novelai', initialConfig);
        this._disposables.add(this._engineStore);

        this._renderer = new FormRenderer<NovelAIConfig>(this._engineStore);
        this._disposables.add(this._renderer);

        this._buildCards();
    }

    private _buildCards(): void {
        const adapter = this._adapterRegistry?.get('novelai');

        // 1. 服务连接与鉴权卡片
        const connectionCard = createConnectionCard({
            title: 'NovelAI 服务连接',
            description: '配置 NovelAI 官方或反代端点与 API 凭据 (pst-...)',
            currentUrl: this._engineStore.get('serverUrl'),
            defaultUrl: 'https://image.novelai.net',
            onUrlChange: (newUrl) => this._engineStore.set('serverUrl', newUrl),
            onTest: async (_url, btn) => {
                btn.disabled = true;
                btn.textContent = '测试中...';
                try {
                    const res = await adapter?.checkHealth();
                    if (res?.ok) {
                        FeedbackService.toastSuccess(`连接成功！延迟: ${res.latencyMs}ms`);
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

        // 2. 鉴权 Token
        this._root.appendChild(this._buildAuthCard());

        // 3. 模型与采样参数
        this._root.appendChild(this._buildModelCard());

        // 4. 尺寸与画幅
        this._root.appendChild(this._buildDimensionCard());
    }

    private _buildAuthCard(): HTMLElement {
        const schema: SectionCardSchema<NovelAIConfig> = {
            title: 'API 授权凭据',
            description: 'NovelAI 个人账号访问令牌，存储于浏览器本地数据库中',
            rows: [
                {
                    key: 'apiKey',
                    type: 'input',
                    label: 'API Token',
                    helpTooltip: '在 NovelAI 官网设置中生成的持久授权令牌 (格式为 pst-...)。',
                    placeholder: 'pst-...'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    private _buildModelCard(): HTMLElement {
        const schema: SectionCardSchema<NovelAIConfig> = {
            title: '生图模型与算法参数',
            description: '配置 NovelAI 专属模型版本、采样器与 UC 负向预设',
            rows: [
                {
                    key: 'model',
                    type: 'select',
                    label: '模型版本',
                    options: [
                        { label: 'NAI Diffusion V4 Curated (推荐)', value: 'nai-diffusion-4-curated-preview' },
                        { label: 'NAI Diffusion V3 (Anime)', value: 'nai-diffusion-3' },
                        { label: 'NAI Diffusion Furry V3', value: 'nai-diffusion-furry-3' }
                    ]
                },
                {
                    key: 'sampler',
                    type: 'select',
                    label: '采样器 (Sampler)',
                    options: [
                        { label: 'k_euler', value: 'k_euler' },
                        { label: 'k_euler_ancestral', value: 'k_euler_ancestral' },
                        { label: 'k_dpmpp_2m', value: 'k_dpmpp_2m' },
                        { label: 'k_dpmpp_2s_ancestral', value: 'k_dpmpp_2s_ancestral' },
                        { label: 'ddim_v3', value: 'ddim_v3' }
                    ]
                },
                {
                    key: 'steps',
                    type: 'number',
                    label: '迭代步数 (Steps)',
                    min: 1,
                    max: 50,
                    step: 1,
                    unit: '步'
                },
                {
                    key: 'scale',
                    type: 'number',
                    label: '提示词权重 (Prompt Guidance)',
                    min: 1.0,
                    max: 20.0,
                    step: 0.5
                },
                {
                    key: 'ucPreset',
                    type: 'select',
                    label: '负向提示词预设 (UC Preset)',
                    options: [
                        { label: '默认预设 (Heavy / Default)', value: 0 },
                        { label: '轻微预设 (Light)', value: 1 },
                        { label: '人体形态增强 (Human Anatomy)', value: 2 },
                        { label: '无内置预设 (None)', value: 3 }
                    ]
                },
                {
                    key: 'smea',
                    type: 'toggle',
                    label: '启用 SMEA (大分辨率细节增强)'
                },
                {
                    key: 'smeaDyn',
                    type: 'toggle',
                    label: '启用 DYN (动态高频细节)'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    private _buildDimensionCard(): HTMLElement {
        const schema: SectionCardSchema<NovelAIConfig> = {
            title: '画幅尺寸规格',
            description: '配置 NovelAI 标准分辨率像素尺寸',
            rows: [
                {
                    key: 'width',
                    type: 'number',
                    label: '图像宽度',
                    min: 512,
                    max: 1536,
                    step: 64,
                    unit: 'px'
                },
                {
                    key: 'height',
                    type: 'number',
                    label: '图像高度',
                    min: 512,
                    max: 1536,
                    step: 64,
                    unit: 'px'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }
}
