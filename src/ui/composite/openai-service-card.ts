/**
 * @module src/ui/composite/openai-service-card
 * @description 大模型生图服务连接与多供应商卡片 (OpenAIServiceCard)
 *
 * 遵循规范 (UI_LAYOUT_PREVIEW.md 第四节第 3 条)：
 * 1. 结构：通用卡片 (.da-card) + 供应商下拉选择 + Base URL 居中输入框 + API Key 显隐密码框；
 * 2. 自定义请求头 (JSON) 折叠区域；
 * 3. 底栏状态与操作条：延迟响应状态小徽标 + [ 同步远端模型 ] 按钮 + [ 测试连接 ] 按钮；
 * 4. 多供应商配置隔离记忆 (OpenAI官方, 硅基流动, xAI Grok, OpenRouter, Together AI, 自定义)。
 */

import { createCard } from '../components/form-field';
import { createSelect, SelectHandle } from '../components/select';
import { createTextInput, createPasswordInput, createTextarea, TextInputHandle, PasswordInputHandle, TextareaHandle } from '../components/input';
import { createFormField, FormFieldHandle } from '../components/form-field';
import { createButton, ButtonHandle } from '../components/button';
import { createBadge, BadgeHandle } from '../components/feedback';
import { Toast } from '../components/feedback';
import { getIconSvg } from '../components/icons';

export type OpenAIProviderType =
    | 'openai-official'
    | 'siliconflow'
    | 'xai-grok'
    | 'openrouter'
    | 'together'
    | 'custom';

export interface OpenAIProviderConfig {
    provider: OpenAIProviderType;
    serverUrl: string;
    apiKey: string;
    customHeaders?: string;
}

export interface OpenAIServiceCardOptions {
    value?: Partial<OpenAIProviderConfig>;
    onCheckHealth?: (config: OpenAIProviderConfig, signal?: AbortSignal) => Promise<{ ok: boolean; latencyMs?: number; message?: string }>;
    onSyncModels?: (config: OpenAIProviderConfig, signal?: AbortSignal) => Promise<string[]>;
    onChange?: (config: OpenAIProviderConfig) => void;
    className?: string;
}

export interface OpenAIServiceCardHandle {
    readonly element: HTMLElement;
    getValue(): OpenAIProviderConfig;
    setValue(val: Partial<OpenAIProviderConfig>): void;
    setDisabled(disabled: boolean): void;
    dispose(): void;
}

export const DEFAULT_PROVIDER_URLS: Record<OpenAIProviderType, string> = {
    'openai-official': 'https://api.openai.com/v1',
    'siliconflow': 'https://api.siliconflow.cn/v1',
    'xai-grok': 'https://api.x.ai/v1',
    'openrouter': 'https://openrouter.ai/api/v1',
    'together': 'https://api.together.xyz/v1',
    'custom': ''
};

export function createOpenAIServiceCard(options: OpenAIServiceCardOptions = {}): OpenAIServiceCardHandle {
    const disposers: (() => void)[] = [];

    // 1. 卡片外壳
    const card = createCard({
        title: '大模型生图服务连接与提供商',
        iconSvg: getIconSvg('sparkles'),
        collapsible: false
    });
    card.element.classList.add('da-openai-service-card');
    if (options.className) card.element.classList.add(options.className);
    disposers.push(() => card.dispose());

    // 2. 供应商私有配置隔离存储
    const providerConfigs: Record<string, Partial<OpenAIProviderConfig>> = {
        'openai-official': { serverUrl: DEFAULT_PROVIDER_URLS['openai-official'] },
        'siliconflow': { serverUrl: DEFAULT_PROVIDER_URLS['siliconflow'] },
        'xai-grok': { serverUrl: DEFAULT_PROVIDER_URLS['xai-grok'] },
        'openrouter': { serverUrl: DEFAULT_PROVIDER_URLS['openrouter'] },
        'together': { serverUrl: DEFAULT_PROVIDER_URLS['together'] },
        'custom': { serverUrl: '' }
    };

    let currentProvider: OpenAIProviderType = options.value?.provider || 'openai-official';
    providerConfigs[currentProvider] = {
        provider: currentProvider,
        serverUrl: options.value?.serverUrl || DEFAULT_PROVIDER_URLS[currentProvider],
        apiKey: options.value?.apiKey || '',
        customHeaders: options.value?.customHeaders || ''
    };

    let abortController: AbortController | null = null;

    // 3. 服务提供商 Select
    const providerSelect: SelectHandle = createSelect({
        value: currentProvider,
        options: [
            { label: 'OpenAI 官方 (GPT-Image / DALL·E 3)', value: 'openai-official' },
            { label: '硅基流动 (SiliconFlow · 国内极速)', value: 'siliconflow' },
            { label: 'xAI Grok (Imagine 生图)', value: 'xai-grok' },
            { label: 'OpenRouter (多模型聚合路由)', value: 'openrouter' },
            { label: 'Together AI (开源模型云推理)', value: 'together' },
            { label: '自定义端点 (Custom Provider)', value: 'custom' }
        ],
        onChange: (val) => {
            providerConfigs[currentProvider] = {
                provider: currentProvider,
                serverUrl: urlInput.getValue().trim(),
                apiKey: keyInput.getValue().trim(),
                customHeaders: headersInput.getValue().trim()
            };

            currentProvider = val as OpenAIProviderType;
            const newConfig = providerConfigs[currentProvider] || {
                provider: currentProvider,
                serverUrl: DEFAULT_PROVIDER_URLS[currentProvider] || '',
                apiKey: '',
                customHeaders: ''
            };

            urlInput.setValue(newConfig.serverUrl || DEFAULT_PROVIDER_URLS[currentProvider] || '');
            keyInput.setValue(newConfig.apiKey || '');
            headersInput.setValue(newConfig.customHeaders || '');

            triggerChange();
        }
    });
    disposers.push(() => providerSelect.dispose?.());
    const providerField: FormFieldHandle = createFormField({
        label: '服务供应商',
        helpText: '选择预置的主流兼容供应商或自定义中继端点，各供应商凭据相互隔离存储',
        control: providerSelect
    });
    disposers.push(() => providerField.dispose?.());
    card.append(providerField);

    // 4. 服务端点 (Base URL)
    const urlInput: TextInputHandle = createTextInput({
        value: providerConfigs[currentProvider]?.serverUrl || DEFAULT_PROVIDER_URLS[currentProvider],
        placeholder: 'https://api.openai.com/v1',
        variant: 'normal',
        onChange: () => triggerChange()
    });
    disposers.push(() => urlInput.dispose?.());
    const urlField: FormFieldHandle = createFormField({
        label: '服务端点 (Base URL)',
        helpText: 'OpenAI 兼容协议基础接口端点，通常以 /v1 结尾',
        control: urlInput
    });
    disposers.push(() => urlField.dispose?.());
    card.append(urlField);

    // 5. API 密钥 (API Key)
    const keyInput: PasswordInputHandle = createPasswordInput({
        value: providerConfigs[currentProvider]?.apiKey || '',
        placeholder: 'sk-********************************',
        onChange: () => triggerChange()
    });
    disposers.push(() => keyInput.dispose?.());
    const keyField: FormFieldHandle = createFormField({
        label: 'API 密钥 (API Key)',
        helpText: '访问大模型生图接口所需的私有鉴权密钥，点击右侧眼睛可显隐查看',
        control: keyInput
    });
    disposers.push(() => keyField.dispose?.());
    card.append(keyField);

    // 6. 自定义请求头 (JSON) 折叠区域
    const headersInput: TextareaHandle = createTextarea({
        value: providerConfigs[currentProvider]?.customHeaders || '',
        placeholder: '{\n  "HTTP-Referer": "https://sillytavern.app"\n}',
        rows: 3,
        onChange: () => triggerChange()
    });
    disposers.push(() => headersInput.dispose?.());
    const headersField: FormFieldHandle = createFormField({
        label: '自定义请求头 (JSON)',
        helpText: '附带在每个 HTTP 请求中的私有头字段（如 OpenRouter 的 HTTP-Referer 或组织 ID）',
        control: headersInput
    });
    disposers.push(() => headersField.dispose?.());
    card.append(headersField);

    // 7. 底栏状态与操作条
    const footerBar = document.createElement('div');
    footerBar.className = 'da-openai-card__footer';
    footerBar.style.display = 'flex';
    footerBar.style.alignItems = 'center';
    footerBar.style.justifyContent = 'space-between';
    footerBar.style.padding = '8px 12px';
    footerBar.style.borderTop = '1px solid var(--da-border, #ffffff17)';

    // 状态徽标与延迟
    const badgeWrap = document.createElement('div');
    badgeWrap.style.display = 'flex';
    badgeWrap.style.alignItems = 'center';
    badgeWrap.style.gap = '8px';

    const latencyEl = document.createElement('span');
    latencyEl.className = 'da-connection-card__latency';
    latencyEl.style.fontSize = '12px';
    latencyEl.style.color = 'var(--da-text-secondary, #94a3b8)';
    latencyEl.style.display = 'none';

    const statusBadge: BadgeHandle = createBadge({
        text: '未检测',
        variant: 'muted',
        pulseDot: false
    });

    badgeWrap.appendChild(statusBadge.element);
    badgeWrap.appendChild(latencyEl);
    footerBar.appendChild(badgeWrap);

    // 动作按钮组：[ 同步远端模型 ] + [ 测试连接 ]
    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.alignItems = 'center';
    btnGroup.style.gap = '8px';

    const syncBtn: ButtonHandle = createButton({
        text: '同步远端模型',
        variant: 'secondary',
        size: 'sm',
        icon: 'refresh',
        onClick: () => handleSyncModels()
    });
    disposers.push(() => syncBtn.dispose());

    const testBtn: ButtonHandle = createButton({
        text: '测试连接',
        variant: 'primary',
        size: 'sm',
        icon: 'zap',
        onClick: () => handleCheckConnection()
    });
    disposers.push(() => testBtn.dispose());

    btnGroup.appendChild(syncBtn.element);
    btnGroup.appendChild(testBtn.element);
    footerBar.appendChild(btnGroup);

    card.append(footerBar);

    // 8. 反馈信息行
    const feedbackEl = document.createElement('div');
    feedbackEl.className = 'da-connection-card__feedback';
    feedbackEl.style.display = 'none';
    feedbackEl.style.padding = '4px 12px 8px 12px';
    feedbackEl.style.fontSize = '12px';
    card.append(feedbackEl);

    const triggerChange = () => {
        const cfg = getCurrentConfig();
        options.onChange?.(cfg);
    };

    const getCurrentConfig = (): OpenAIProviderConfig => ({
        provider: currentProvider,
        serverUrl: urlInput.getValue().trim(),
        apiKey: keyInput.getValue().trim(),
        customHeaders: headersInput.getValue().trim()
    });

    const handleCheckConnection = async () => {
        const cfg = getCurrentConfig();
        if (!cfg.serverUrl) {
            Toast.warn('请先输入服务端点 (Base URL)');
            return;
        }

        if (abortController) abortController.abort();
        abortController = new AbortController();

        statusBadge.setText('检测中...');
        statusBadge.setVariant('warn');
        testBtn.setLoading(true, '测试中...');
        feedbackEl.style.display = 'none';

        try {
            if (options.onCheckHealth) {
                const result = await options.onCheckHealth(cfg, abortController.signal);
                if (result.ok) {
                    statusBadge.setText('连接正常');
                    statusBadge.setVariant('success');
                    latencyEl.textContent = `${result.latencyMs ?? 0} ms`;
                    latencyEl.style.display = '';
                    Toast.success(`OpenAI 服务连接正常 (${result.latencyMs ?? 0}ms)`);
                } else {
                    statusBadge.setText('连接失败');
                    statusBadge.setVariant('error');
                    latencyEl.style.display = 'none';
                    feedbackEl.textContent = `✗ ${result.message || '连接失败'}`;
                    feedbackEl.style.color = 'var(--da-danger, #ef4444)';
                    feedbackEl.style.display = '';
                    Toast.error(result.message || '连接失败');
                }
            } else {
                statusBadge.setText('未配置检测');
                statusBadge.setVariant('muted');
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            statusBadge.setText('连接失败');
            statusBadge.setVariant('error');
            feedbackEl.textContent = `✗ ${err?.message || '网络连接异常'}`;
            feedbackEl.style.color = 'var(--da-danger, #ef4444)';
            feedbackEl.style.display = '';
            Toast.error(err?.message || '网络连接异常');
        } finally {
            testBtn.setLoading(false);
            abortController = null;
        }
    };

    const handleSyncModels = async () => {
        const cfg = getCurrentConfig();
        if (!cfg.serverUrl) {
            Toast.warn('请先输入服务端点 (Base URL)');
            return;
        }

        syncBtn.setLoading(true, '同步中...');
        try {
            if (options.onSyncModels) {
                const models = await options.onSyncModels(cfg);
                Toast.success(`成功拉取 ${models.length} 个可用模型`);
                feedbackEl.textContent = `✓ 已成功同步 ${models.length} 款远端可用模型`;
                feedbackEl.style.color = 'var(--da-success, #10b981)';
                feedbackEl.style.display = '';
            } else {
                Toast.info('未实现模型同步接口');
            }
        } catch (err: any) {
            Toast.error(`模型同步失败: ${err?.message || '未知错误'}`);
        } finally {
            syncBtn.setLoading(false);
        }
    };

    return {
        element: card.element,
        getValue(): OpenAIProviderConfig {
            return getCurrentConfig();
        },
        setValue(val: Partial<OpenAIProviderConfig>): void {
            if (val.provider) {
                currentProvider = val.provider;
                providerSelect.setValue(currentProvider);
            }
            if (val.serverUrl !== undefined) urlInput.setValue(val.serverUrl);
            if (val.apiKey !== undefined) keyInput.setValue(val.apiKey);
            if (val.customHeaders !== undefined) headersInput.setValue(val.customHeaders);
        },
        setDisabled(disabled: boolean): void {
            providerSelect.setDisabled(disabled);
            urlInput.setDisabled(disabled);
            keyInput.setDisabled(disabled);
            headersInput.setDisabled(disabled);
            testBtn.setDisabled(disabled);
            syncBtn.setDisabled(disabled);
        },
        dispose(): void {
            if (abortController) {
                abortController.abort();
                abortController = null;
            }
            for (const d of disposers) {
                d();
            }
        }
    };
}
