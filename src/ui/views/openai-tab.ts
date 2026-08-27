/**
 * @module ui/views/openai-tab
 * @description OpenAI / Grok / Banana 兼容生图后端配置面板视图 (OpenAITabView)
 *
 * 架构范式：继承 BaseTabView，实现 ITabView 接口
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    IDriverRegistry,
    DEFAULT_OPENAI_URL
} from '../../core';
import { FormRenderer, SectionCardSchema } from '../controls';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';

/**
 * OpenAI 兼容生图配置面板视图
 */
export class OpenAITabView extends BaseTabView {
    private readonly _renderer: FormRenderer<DrawAssistantSettings>;

    constructor(
        private readonly _store: ObservableStore<DrawAssistantSettings>,
        private readonly _drivers?: IDriverRegistry
    ) {
        super('da-openai-tab');
        this._renderer = new FormRenderer<DrawAssistantSettings>(_store);
        this._disposables.add(this._renderer);

        this._root.appendChild(this._buildConnectionCard());
        this._root.appendChild(this._buildParamsCard());
    }

    // ── Card 1: 接口连接与鉴权配置 ──────────────────────────────────────────
    private _buildConnectionCard(): HTMLElement {
        const drivers = this._drivers;

        const cardConnectionSchema: SectionCardSchema<DrawAssistantSettings> = {
            title: 'OpenAI 兼容服务连接',
            description: '配置 OpenAI 官方、xAI Grok、Banana 或任何支持 /v1/images/generations 的兼容服务',
            headerExtra: () => {
                const testBtn = document.createElement('button');
                testBtn.className = 'da-btn da-btn--secondary da-btn--sm';
                testBtn.textContent = '测试连接';
                testBtn.onclick = async () => {
                    testBtn.disabled = true;
                    testBtn.textContent = '测试中...';
                    try {
                        const driver = drivers?.get('openai');
                        if (!driver) {
                            FeedbackService.toastError('未找到 OpenAI 驱动实例');
                            return;
                        }
                        const res = driver.checkConnection
                            ? await driver.checkConnection()
                            : { connected: await driver.ping() };
                        if (res.connected) {
                            FeedbackService.toastSuccess(`连接成功！延迟: ${res.latencyMs || 0}ms`);
                        } else {
                            FeedbackService.toastError(`连接失败: ${res.error || '无法连接'}`);
                        }
                    } catch (err: any) {
                        FeedbackService.toastError(`测试发生异常: ${err?.message || err}`);
                    } finally {
                        if (testBtn && testBtn.isConnected) {
                            testBtn.disabled = false;
                            testBtn.textContent = '测试连接';
                        }
                    }
                };
                return testBtn;
            },
            rows: [
                {
                    key: 'openaiBaseUrl',
                    type: 'input',
                    label: '服务接口地址',
                    helpTooltip: 'OpenAI 规范服务接口基础地址 (无需包含 /images/generations)。',
                    placeholder: DEFAULT_OPENAI_URL
                },
                {
                    key: 'openaiApiKey',
                    type: 'input',
                    label: 'API Key',
                    helpTooltip: '服务商提供的 API 密钥 (Bearer 格式鉴权，本地安全存储)。',
                    placeholder: 'sk-...'
                }
            ]
        };
        return this._renderer.renderCard(cardConnectionSchema);
    }

    // ── Card 2: 模型与参数配置 ──────────────────────────────────────────────
    private _buildParamsCard(): HTMLElement {
        const store = this._store;
        const modelOptions = [
            { label: 'DALL-E 3', value: 'dall-e-3' },
            { label: 'DALL-E 2', value: 'dall-e-2' },
            { label: 'grok-2-image', value: 'grok-2-image' },
            { label: 'gemini-2.0-flash-image', value: 'gemini-2.0-flash-image' },
            { label: '自定义模型', value: 'custom' }
        ];

        const cardParamsSchema: SectionCardSchema<DrawAssistantSettings> = {
            title: '模型与生成参数',
            description: '设定默认调用的生图模型、生成画幅尺寸、画质风格及全局专属前缀',
            rows: [
                {
                    key: 'openaiModel',
                    type: 'select',
                    label: '生图模型预设',
                    helpTooltip: '选择目标服务商提供的标准模型，或选择自定义后在下方输入模型标识。',
                    options: modelOptions,
                    fromStore: (m) => {
                        const val = m || 'dall-e-3';
                        return modelOptions.some((o) => o.value === val && o.value !== 'custom') ? val : 'custom';
                    },
                    toStore: (uiVal) => {
                        if (uiVal === 'custom') {
                            return store.get('openaiModel') || 'dall-e-3';
                        }
                        return uiVal;
                    }
                },
                {
                    key: 'openaiModel',
                    type: 'input',
                    label: '自定义模型名称',
                    helpTooltip: '输入服务商文档中指定的 model 字符串 (如 midjourney-v6, flux-pro)。',
                    placeholder: 'dall-e-3'
                },
                {
                    key: 'openaiSize',
                    type: 'select',
                    label: '生成分辨率',
                    helpTooltip: '指定图像物理宽高尺寸。',
                    options: [
                        { label: '方图 1024 × 1024', value: '1024x1024' },
                        { label: '竖图 1024 × 1792', value: '1024x1792' },
                        { label: '横图 1792 × 1024', value: '1792x1024' },
                        { label: '方图 512 × 512', value: '512x512' },
                        { label: '方图 256 × 256', value: '256x256' }
                    ]
                },
                {
                    key: 'openaiQuality',
                    type: 'select',
                    label: '生成画质',
                    helpTooltip: 'DALL-E 3 专享画质模式：高清 (hd) 生成更细腻纹理，标准 (standard) 响应更快。',
                    disabledWhen: (s) => !((s.openaiModel || 'dall-e-3').includes('dall-e-3')),
                    options: [
                        { label: '标准画质 (standard)', value: 'standard' },
                        { label: '高清画质 (hd)', value: 'hd' }
                    ]
                },
                {
                    key: 'openaiStyle',
                    type: 'select',
                    label: '画面风格倾向',
                    helpTooltip: '鲜明生动 (vivid) 偏向超写实与高饱和度，自然真实 (natural) 更加写实质朴。',
                    disabledWhen: (s) => !((s.openaiModel || 'dall-e-3').includes('dall-e-3')),
                    options: [
                        { label: '鲜明生动 (vivid)', value: 'vivid' },
                        { label: '自然写实 (natural)', value: 'natural' }
                    ]
                },
                {
                    key: 'openaiPromptPrefix',
                    type: 'textarea',
                    label: '专属正向提示词前缀',
                    helpTooltip: '自动附加在发往 OpenAI/Grok 的提示词开头。',
                    placeholder: 'masterpiece, high quality digital art...'
                }
            ]
        };
        return this._renderer.renderCard(cardParamsSchema);
    }
}

