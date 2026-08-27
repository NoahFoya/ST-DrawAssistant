/**
 * @module ui/views/openai-tab
 * @description OpenAI / Grok / Banana 兼容生图后端配置面板视图 (OpenAI Tab) - 声明式 Schema 架构重构版
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { FormRenderer, SectionCardSchema } from '../controls';
import { FeedbackService } from '../feedback/feedback';
import type { IDriverRegistry } from '../../core/registry/driver-registry';
import { IDisposable } from '../../core/foundation/disposable';
import { DEFAULT_OPENAI_URL } from '../../core/constants';

/**
 * 构建并渲染 OpenAI 兼容生图配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @param drivers 生图驱动注册中心抽象
 * @returns 包含生命周期清理能力的 OpenAI 配置面板 DOM 根节点
 */
export function createOpenAITabView(
    store: ObservableStore<DrawAssistantSettings>,
    drivers?: IDriverRegistry
): HTMLElement & IDisposable {
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-openai-tab';

    const renderer = new FormRenderer<DrawAssistantSettings>(store);

    // ── Card 1: 接口连接与鉴权配置 ──────────────────────────────────────────
    const cardConnectionSchema: SectionCardSchema<DrawAssistantSettings> = {
        title: 'OpenAI 兼容服务连接',
        description: '配置 OpenAI 官方、xAI Grok、Banana 或任何支持 /v1/images/generations 的兼容服务',
        headerExtra: () => {
            const testBtn = document.createElement('button');
            testBtn.className = 'da-btn secondary da-btn-sm';
            testBtn.textContent = '🔄 测试连接';
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
                        testBtn.textContent = '🔄 测试连接';
                    }
                }
            };
            return testBtn;
        },
        rows: [
            {
                key: 'openaiBaseUrl',
                type: 'input',
                label: '服务接口地址 (Base URL)',
                helpTooltip: 'OpenAI 标准端点基础 URL (无需包含 /images/generations)。',
                placeholder: DEFAULT_OPENAI_URL
            },
            {
                key: 'openaiApiKey',
                type: 'input',
                label: 'API Key (授权密钥)',
                helpTooltip: '服务商提供的 API 密钥 (Bearer 格式鉴权，本地安全存储)。',
                placeholder: 'sk-...'
            }
        ]
    };
    container.appendChild(renderer.renderCard(cardConnectionSchema));

    // ── Card 2: 模型与参数配置 ──────────────────────────────────────────────
    const modelOptions = [
        { label: 'DALL-E 3 (OpenAI 旗舰推荐)', value: 'dall-e-3' },
        { label: 'DALL-E 2 (OpenAI 经典速绘)', value: 'dall-e-2' },
        { label: 'grok-2-image (xAI Grok 生图)', value: 'grok-2-image' },
        { label: 'gemini-2.0-flash-image (Banana 兼容)', value: 'gemini-2.0-flash-image' },
        { label: '自定义模型标识...', value: 'custom' }
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
                    { label: '1024 × 1024 (正方形 1:1，通用)', value: '1024x1024' },
                    { label: '1024 × 1792 (竖图 9:16，DALL-E 3 推荐)', value: '1024x1792' },
                    { label: '1792 × 1024 (横图 16:9，DALL-E 3 推荐)', value: '1792x1024' },
                    { label: '512 × 512 (正方形 1:1，DALL-E 2)', value: '512x512' },
                    { label: '256 × 256 (快速缩略图，DALL-E 2)', value: '256x256' }
                ]
            },
            {
                key: 'openaiQuality',
                type: 'select',
                label: '生成画质 (Quality)',
                helpTooltip: 'DALL-E 3 专享画质模式：高清 (hd) 生成更细腻纹理，标准 (standard) 响应更快。',
                options: [
                    { label: '标准画质 (standard)', value: 'standard' },
                    { label: '高清画质 (hd - DALL-E 3 专用)', value: 'hd' }
                ]
            },
            {
                key: 'openaiStyle',
                type: 'select',
                label: '画面风格倾向 (Style)',
                helpTooltip: '鲜明生动 (vivid) 偏向超写实与高饱和度，自然真实 (natural) 更加写实质朴。',
                options: [
                    { label: '鲜明生动 (vivid - 默认)', value: 'vivid' },
                    { label: '自然写实 (natural)', value: 'natural' }
                ]
            },
            {
                key: 'openaiPromptPrefix',
                type: 'input',
                label: '专属正向提示词前缀',
                helpTooltip: '自动附加在发往 OpenAI/Grok 的提示词开头。',
                placeholder: 'masterpiece, high quality digital art...'
            }

        ]
    };
    container.appendChild(renderer.renderCard(cardParamsSchema));

    container.dispose = () => {
        renderer.dispose();
    };

    return container;
}
