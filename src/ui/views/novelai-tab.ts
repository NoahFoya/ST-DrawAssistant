/**
 * @module ui/views/novelai-tab
 * @description NovelAI 生图后端配置面板视图 (NovelAITabView)
 *
 * 架构范式：继承 BaseTabView，实现 ITabView 接口
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    IDriverRegistry,
    DEFAULT_NOVELAI_URL,
    NOVELAI_SIZE_PRESETS
} from '../../core';
import { FormRenderer, SectionCardSchema } from '../controls';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';

/**
 * NovelAI 后端配置面板视图
 */
export class NovelAITabView extends BaseTabView {
    private readonly _renderer: FormRenderer<DrawAssistantSettings>;

    constructor(
        private readonly _store: ObservableStore<DrawAssistantSettings>,
        private readonly _drivers?: IDriverRegistry
    ) {
        super('da-novelai-tab');
        this._renderer = new FormRenderer<DrawAssistantSettings>(_store);
        this._disposables.add(this._renderer);

        this._root.appendChild(this._buildConnectionCard());
        this._root.appendChild(this._buildModelCard());
        this._root.appendChild(this._buildSizeCard());
    }

    // ── Card 1: 接口连接与 API Key 鉴权 ─────────────────────────────────────
    private _buildConnectionCard(): HTMLElement {
        const drivers = this._drivers;

        const cardConnectionSchema: SectionCardSchema<DrawAssistantSettings> = {
            title: 'NovelAI 服务连接',
            description: '配置 NovelAI 官方或反向代理服务地址，填写个人 API Token (Bearer 鉴权)',
            headerExtra: () => {
                const testBtn = document.createElement('button');
                testBtn.className = 'da-btn da-btn--secondary da-btn--sm';
                testBtn.textContent = '测试连接';
                testBtn.onclick = async () => {
                    testBtn.disabled = true;
                    testBtn.textContent = '测试中...';
                    try {
                        const driver = drivers?.get('novelai');
                        if (!driver) {
                            FeedbackService.toastError('未找到 NovelAI 驱动实例');
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
                    key: 'naiUrl',
                    type: 'input',
                    label: 'NovelAI 服务地址',
                    helpTooltip: '官方服务地址为 https://image.novelai.net 或第三方自建反向代理。',
                    placeholder: DEFAULT_NOVELAI_URL
                },
                {
                    key: 'naiApiKey',
                    type: 'input',
                    label: 'NovelAI API Token',
                    helpTooltip: '个人授权 Token (以 pst- 开头，存放在本地浏览器安全数据库中)。',
                    placeholder: 'pst-...'
                }
            ]
        };
        return this._renderer.renderCard(cardConnectionSchema);
    }

    // ── Card 2: 模型与采样算法配置 ──────────────────────────────────────────
    private _buildModelCard(): HTMLElement {
        const cardModelSchema: SectionCardSchema<DrawAssistantSettings> = {
            title: '模型与采样配置',
            description: '设定 NovelAI 官方扩散模型版本、采样调度算法及 SMEA 采样增强',
            rows: [
                {
                    key: 'naiModel',
                    type: 'select',
                    label: '扩散模型版本',
                    helpTooltip: '推荐使用最新的 NAI Diffusion V4 系列模型获得卓越的二次元画质与服饰细节。',
                    options: [
                        { label: 'NAI Diffusion V4 Full', value: 'nai-diffusion-4-full' },
                        { label: 'NAI Diffusion V4 Curated', value: 'nai-diffusion-4-curated' },
                        { label: 'NAI Diffusion V3', value: 'nai-diffusion-3' },
                        { label: 'NAI Diffusion Anime V2', value: 'safe-diffusion' }
                    ]
                },
                {
                    key: 'naiSampler',
                    type: 'select',
                    label: '采样算法',
                    helpTooltip: '推荐使用 Euler Ancestral 或 DPM++ 2M SDE。',
                    options: [
                        { label: 'Euler Ancestral', value: 'k_euler_ancestral' },
                        { label: 'Euler', value: 'k_euler' },
                        { label: 'DPM++ 2S Ancestral', value: 'k_dpmpp_2s_ancestral' },
                        { label: 'DPM++ 2M SDE', value: 'k_dpmpp_2m_sde' },
                        { label: 'DPM++ 2M', value: 'k_dpmpp_2m' },
                        { label: 'DDIM V3', value: 'ddim_v3' }
                    ]
                },
                {
                    key: 'naiSmea',
                    type: 'toggle',
                    label: 'SMEA 采样增强',
                    helpTooltip: '启用 Sinusoidal Multipass Euler Ancestral 算法，改善极端画幅下的构图与肢体表现。'
                },
                {
                    key: 'naiSmeaDyn',
                    type: 'toggle',
                    label: 'DYN 动态采样增强',
                    helpTooltip: '与 SMEA 搭配开启，在超大分辨率下进一步提升画面锐度。',
                    disabledWhen: (s) => !s.naiSmea
                }
            ]
        };
        return this._renderer.renderCard(cardModelSchema);
    }

    // ── Card 3: 画面尺寸与提示词控制 ────────────────────────────────────────
    private _buildSizeCard(): HTMLElement {
        const store = this._store;

        const cardSizeSchema: SectionCardSchema<DrawAssistantSettings> = {
            title: '画面尺寸与提示词控制',
            description: '定制 NovelAI 专属分辨率、采样步数、CFG 比例及负向质量过滤',
            rows: [
                {
                    type: 'select',
                    label: '生成分辨率预设',
                    helpTooltip: '选择 NovelAI 标准画幅预设。',
                    options: [...NOVELAI_SIZE_PRESETS],
                    onChangeHook: (val: string) => {
                        if (val !== 'custom') {
                            const [w, h] = val.split('x').map((n) => parseInt(n, 10));
                            if (w && h) store.update({ naiWidth: w, naiHeight: h });
                        }
                    }
                },
                {
                    key: 'naiWidth',
                    type: 'number',
                    label: '生成宽度',
                    helpTooltip: '生成图像物理像素宽度。',
                    min: 64,
                    max: 2048,
                    step: 64,
                    unit: 'px'
                },
                {
                    key: 'naiHeight',
                    type: 'number',
                    label: '生成高度',
                    helpTooltip: '生成图像物理像素高度。',
                    min: 64,
                    max: 2048,
                    step: 64,
                    unit: 'px'
                },
                {
                    key: 'naiSteps',
                    type: 'number',
                    label: '采样步数',
                    helpTooltip: '官方推荐 28 步即可达到高质感收敛。',
                    min: 1,
                    max: 50,
                    step: 1,
                    unit: '步'
                },
                {
                    key: 'naiScale',
                    type: 'number',
                    label: '提示词引导系数 (CFG)',
                    helpTooltip: '控制画面与提示词的贴合程度（推荐 5.0 ~ 7.0）。',
                    min: 1.0,
                    max: 20.0,
                    step: 0.5
                },
                {
                    key: 'naiPromptPrefix',
                    type: 'textarea',
                    label: '专属正向提示词前缀',
                    helpTooltip: '自动附加在发往 NovelAI 的正向提示词最前。',
                    placeholder: 'masterpiece, best quality, amazing visual...'
                },
                {
                    key: 'naiPromptSuffix',
                    type: 'textarea',
                    label: '专属正向提示词后缀',
                    helpTooltip: '自动附加在发往 NovelAI 的正向提示词末尾。',
                    placeholder: '8k resolution, highly detailed...'
                },
                {
                    key: 'naiNegativePrefix',
                    type: 'textarea',
                    label: '全局负向提示词',
                    helpTooltip: '全局排除的不期望特征或画质瑕疵词。',
                    placeholder: 'lowres, bad anatomy, worst quality...'
                }
            ]
        };
        return this._renderer.renderCard(cardSizeSchema);
    }
}

