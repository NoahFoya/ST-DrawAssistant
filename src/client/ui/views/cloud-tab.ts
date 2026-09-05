/**
 * @module ui/views/cloud-tab
 * @description 云端多模态生图后端配置面板视图 (CloudTabView)
 *
 * 统一支持三大云端多模态模型：
 * 1. Google Gemini (Nano Banana / Gemini 2.5 Flash Image)
 * 2. xAI Grok (Grok Imagine)
 * 3. OpenAI (DALL-E 3 / GPT Image)
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

/** 云端生图配置类型定义 */
export interface CloudConfig {
    provider?: 'google' | 'openai' | 'xai' | 'auto';
    serverUrl?: string;
    proxyUrl?: string;
    apiKey?: string;
    model?: string;
    aspectRatio?: string;
    quality?: string;
    size?: string;
    [key: string]: any;
}

export class CloudTabView extends BaseTabView {
    private readonly _engineStore: EngineFormStore<CloudConfig>;
    private readonly _renderer: FormRenderer<CloudConfig>;
    private readonly _adapterRegistry?: AdapterRegistry;

    constructor(
        private readonly _mainStore: ConfigStore,
        adapterRegistry?: AdapterRegistry
    ) {
        super('da-cloud-tab');
        this._adapterRegistry = adapterRegistry;

        const initialConfig: CloudConfig = {
            provider: 'google',
            serverUrl: 'https://generativelanguage.googleapis.com',
            apiKey: '',
            model: 'gemini-3.1-flash-image-preview',
            aspectRatio: '1:1',
            quality: 'standard',
            size: '1024x1024',
            ..._mainStore.getEngineConfig('cloud')
        };

        this._engineStore = new EngineFormStore<CloudConfig>(initialConfig, (data) => {
            this._mainStore.setEngineConfig('cloud', data);
        });
        this._mainStore.setEngineConfig('cloud', initialConfig);
        this._disposables.add(this._engineStore);

        this._renderer = new FormRenderer<CloudConfig>(this._engineStore);
        this._disposables.add(this._renderer);

        this._buildCards();
    }

    private _buildCards(): void {
        const adapter = this._adapterRegistry?.get('cloud');

        // 1. 服务商与网关端点卡片
        const connectionCard = createConnectionCard({
            title: '云端多模态网关连接',
            description: '配置官方 API 或第三方代理网关地址与连通性检测',
            currentUrl: this._engineStore.get('serverUrl'),
            defaultUrl: 'https://generativelanguage.googleapis.com',
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
                                    FeedbackService.toastInfo(`已同步云端可用模型推荐列表 (${modelCount} 个模型)`);
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

        // 2. 服务商选择与凭据
        this._root.appendChild(this._buildProviderCard());

        // 3. 模型与生成参数
        this._root.appendChild(this._buildModelCard());

        // 4. 自然语言提示说明
        this._root.appendChild(this._buildTipsCard());
    }

    private _buildProviderCard(): HTMLElement {
        const schema: SectionCardSchema<CloudConfig> = {
            title: '云端服务商与凭据',
            description: '选择云端生图平台并配置访问密钥',
            rows: [
                {
                    key: 'provider',
                    type: 'select',
                    label: '云端生图服务商通道',
                    options: [
                        { label: 'Google Gemini (Gemini 3 / 2.5 Flash Image)', value: 'google' },
                        { label: 'OpenAI (GPT Image)', value: 'openai' },
                        { label: 'xAI Grok (Grok Imagine)', value: 'xai' },
                        { label: '根据模型自动识别 (Auto)', value: 'auto' }
                    ]
                },
                {
                    key: 'apiKey',
                    type: 'input',
                    label: 'API 访问密钥 (API Key)',
                    helpTooltip: '所选服务商的 API 密钥，保存在浏览器本地安全存储中，请求时由服务端代理网关注入。',
                    placeholder: 'AIzaSy... / sk-...'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    private _buildModelCard(): HTMLElement {
        const schema: SectionCardSchema<CloudConfig> = {
            title: '生图模型与画面规格',
            description: '配置目标模型版本、画质等级与纵横比例',
            rows: [
                {
                    key: 'model',
                    type: 'input',
                    label: '模型名称',
                    helpTooltip: '如 gemini-3.1-flash-image-preview、gpt-image-2、grok-imagine-image 等。',
                    placeholder: 'gemini-3.1-flash-image-preview'
                },
                {
                    key: 'aspectRatio',
                    type: 'select',
                    label: '图像纵横比 (Aspect Ratio)',
                    options: [
                        { label: '1:1 方形', value: '1:1' },
                        { label: '3:4 纵向人像', value: '3:4' },
                        { label: '4:3 横向风景', value: '4:3' },
                        { label: '9:16 手机全屏壁纸', value: '9:16' },
                        { label: '16:9 宽屏宽幅', value: '16:9' }
                    ]
                },
                {
                    key: 'quality',
                    type: 'select',
                    label: '图像生成质量',
                    options: [
                        { label: '标准质量 (Standard)', value: 'standard' },
                        { label: '高清画质 (HD / High Detail)', value: 'hd' }
                    ]
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    private _buildTipsCard(): HTMLElement {
        const cardEl = document.createElement('div');
        cardEl.className = 'da-card';
        cardEl.innerHTML = `
            <div class="da-card__header">
                <div class="da-field-title">💡 提示词编写建议</div>
            </div>
            <div class="da-card__body" style="color: var(--da-text-muted); font-size: 13px; line-height: 1.6;">
                云端多模态模型（如 Gemini 3.1 Flash Image、Grok Imagine 和 GPT Image）对自然语言具备深层语义理解能力：<br/>
                • <b>推荐</b>：使用富有叙事性与场景光影描绘的英文或中文自然语句，例如 <i>"A cinematic portrait of a cyberpunk girl in neon rain..."</i>；<br/>
                • <b>注意</b>：云端模型通常不解析 Danbooru 风格的加权标签（如 <code>(masterpiece:1.2)</code>）与负向提示词，系统会自动将提示词平滑整合为自然文本提交。
            </div>
        `;
        return cardEl;
    }
}
