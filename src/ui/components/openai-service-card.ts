/**
 * 大模型生图服务连接与供应商独立配置卡片 (OpenAIServiceCard)
 *
 * 负责大模型服务提供商 (OpenAI 官方、硅基流动、xAI Grok 等) 的切换、
 * 各供应商独立 API 端点/访问密钥绑定、专享请求头配置、连通性测试与模型同步。
 */

import { IDisposable } from '../../types';
import {
    OpenAIProviderType,
    OpenAIProviderSettings,
    PROVIDER_CAPABILITIES,
    createDefaultOpenAIProviders,
    normalizeOpenAiBaseUrl
} from '../../services/drivers/openai-driver';
import { createCard, createCardHeader, createRow, createFieldLabel } from '../layout/container-factory';

export interface OpenAIServiceCardOptions {
    /** 初始选中的服务提供商 */
    activeProvider: OpenAIProviderType;
    /** 提供商独立配置映射表 */
    providers: Record<OpenAIProviderType, OpenAIProviderSettings>;
    /** 切换提供商时的回调 */
    onProviderChange: (newProvider: OpenAIProviderType, newSettings: OpenAIProviderSettings) => void;
    /** 当前提供商的端点、密钥或请求头修改时的回调 */
    onSettingsChange: (provider: OpenAIProviderType, newSettings: OpenAIProviderSettings) => void;
    /** 点击测试连接时的回调 */
    onTestConnection: (provider: OpenAIProviderType, settings: OpenAIProviderSettings, btn: HTMLButtonElement) => Promise<void>;
    /** 点击同步远端模型时的回调 */
    onSyncModels: (provider: OpenAIProviderType, settings: OpenAIProviderSettings, btn: HTMLButtonElement) => Promise<void>;
}

export interface OpenAIServiceCardElement extends HTMLElement, IDisposable {
    /** 外部程序化切换激活的提供商 */
    setProvider: (provider: OpenAIProviderType) => void;
    /** 更新延迟状态徽标 */
    updateStatusBadge: (latencyMs?: number) => void;
    /** 获取当前选中的提供商 */
    getCurrentProvider: () => OpenAIProviderType;
    /** 获取当前选中的提供商配置 */
    getCurrentSettings: () => OpenAIProviderSettings;
}

const PROVIDER_SELECT_OPTIONS: Array<{ value: OpenAIProviderType; label: string }> = [
    { value: 'openai-official', label: 'OpenAI 官方 (GPT-Image / DALL·E 3)' },
    { value: 'siliconflow', label: '硅基流动 SiliconFlow (FLUX / Kolors / SD3.5)' },
    { value: 'xai-grok', label: 'xAI Grok Imagine (宽屏生图)' },
    { value: 'openrouter', label: 'OpenRouter (全球大模型聚合)' },
    { value: 'together', label: 'Together AI (云端开源大模型推理)' },
    { value: 'custom', label: '自定义兼容服务 (自主配置)' }
];

/**
 * 创建独立的大模型服务连接卡片
 */
export function createOpenAIServiceCard(options: OpenAIServiceCardOptions): OpenAIServiceCardElement {
    const card = createCard({ hoverable: true });
    const header = createCardHeader({
        title: '大模型生图服务连接与提供商',
        description: '选择大模型服务提供商并配置相应的 API 端点与凭据，各提供商独立保存专属设置'
    });
    card.header.appendChild(header);

    // 确保各提供商配置字典完备
    const defaults = createDefaultOpenAIProviders();
    const providersMap: Record<OpenAIProviderType, OpenAIProviderSettings> = {
        ...defaults,
        ...options.providers
    };
    for (const key of Object.keys(defaults) as OpenAIProviderType[]) {
        if (!providersMap[key]) {
            providersMap[key] = { ...defaults[key] };
        }
    }

    let currentProvider: OpenAIProviderType = options.activeProvider || 'openai-official';

    const getSettings = (p: OpenAIProviderType): OpenAIProviderSettings => {
        if (!providersMap[p]) {
            providersMap[p] = { ...defaults[p] || defaults['custom'] };
        }
        return providersMap[p];
    };

    // ─────────────────────────────────────────────────────────────
    // 1. 服务供应商选择行 (Provider Select & Badge)
    // ─────────────────────────────────────────────────────────────
    const providerRow = createRow(['left', 'right'], { align: 'center', divided: true });
    providerRow.slots[0].appendChild(createFieldLabel({
        title: '服务供应商',
        description: '切换当前生效的大模型生图服务商，各服务商独立保存端点与密钥'
    }));

    const providerContainer = document.createElement('div');
    providerContainer.style.display = 'flex';
    providerContainer.style.alignItems = 'center';
    providerContainer.style.gap = '8px';
    providerContainer.style.width = '100%';

    const providerSelectEl = document.createElement('select');
    providerSelectEl.className = 'da-select';
    providerSelectEl.style.flex = '1';

    for (const opt of PROVIDER_SELECT_OPTIONS) {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        providerSelectEl.appendChild(optionEl);
    }
    providerSelectEl.value = currentProvider;

    const statusBadgeEl = document.createElement('span');
    statusBadgeEl.className = 'da-badge da-badge--muted';

    const updateBadge = (latencyMs?: number) => {
        if (typeof latencyMs === 'number' && latencyMs >= 0) {
            statusBadgeEl.className = 'da-badge da-badge--success';
            statusBadgeEl.textContent = `已连接 ${latencyMs}ms`;
        } else {
            statusBadgeEl.className = 'da-badge da-badge--muted';
            statusBadgeEl.textContent = '未连接';
        }
    };
    updateBadge(getSettings(currentProvider).lastLatencyMs);

    providerContainer.appendChild(providerSelectEl);
    providerContainer.appendChild(statusBadgeEl);
    providerRow.slots[1].appendChild(providerContainer);
    card.body.appendChild(providerRow.root);

    // ─────────────────────────────────────────────────────────────
    // 2. 接口 Base URL 行
    // ─────────────────────────────────────────────────────────────
    const urlRow = createRow(['left', 'right'], { align: 'center', divided: true });
    urlRow.slots[0].appendChild(createFieldLabel({
        title: '接口 Base URL',
        description: 'OpenAI 兼容端点基地址，自动补充 /v1 并过滤多余路径'
    }));

    const urlContainer = document.createElement('div');
    urlContainer.style.display = 'flex';
    urlContainer.style.alignItems = 'center';
    urlContainer.style.gap = '6px';
    urlContainer.style.width = '100%';

    const urlInputEl = document.createElement('input');
    urlInputEl.type = 'text';
    urlInputEl.className = 'da-input da-input--text';
    urlInputEl.style.flex = '1';
    urlInputEl.value = getSettings(currentProvider).serverUrl;
    urlInputEl.placeholder = 'https://api.openai.com/v1';

    const resetUrlBtn = document.createElement('button');
    resetUrlBtn.type = 'button';
    resetUrlBtn.className = 'da-btn da-btn--secondary';
    resetUrlBtn.textContent = '🔄 默认';
    resetUrlBtn.title = '恢复为当前提供商推荐的官方默认地址';
    resetUrlBtn.style.padding = '4px 8px';

    const syncUrlChange = () => {
        const normalized = normalizeOpenAiBaseUrl(urlInputEl.value);
        const settings = getSettings(currentProvider);
        settings.serverUrl = normalized;
        options.onSettingsChange(currentProvider, settings);
    };
    urlInputEl.addEventListener('input', syncUrlChange);
    urlInputEl.addEventListener('change', syncUrlChange);

    resetUrlBtn.onclick = () => {
        const capability = PROVIDER_CAPABILITIES[currentProvider] || PROVIDER_CAPABILITIES['custom'];
        urlInputEl.value = capability.defaultUrl;
        syncUrlChange();
    };

    urlContainer.appendChild(urlInputEl);
    urlContainer.appendChild(resetUrlBtn);
    urlRow.slots[1].appendChild(urlContainer);
    card.body.appendChild(urlRow.root);

    // ─────────────────────────────────────────────────────────────
    // 3. API Key 访问密钥行
    // ─────────────────────────────────────────────────────────────
    const keyRow = createRow(['left', 'right'], { align: 'center', divided: true });
    keyRow.slots[0].appendChild(createFieldLabel({
        title: 'API Key (访问密钥)',
        description: 'Bearer 授权令牌，保存在浏览器本地扩展配置中，直连时携带'
    }));

    const keyContainer = document.createElement('div');
    keyContainer.style.display = 'flex';
    keyContainer.style.alignItems = 'center';
    keyContainer.style.gap = '6px';
    keyContainer.style.width = '100%';

    const keyInputEl = document.createElement('input');
    keyInputEl.type = 'password';
    keyInputEl.className = 'da-input da-input--text';
    keyInputEl.style.flex = '1';
    keyInputEl.value = getSettings(currentProvider).apiKey;
    keyInputEl.placeholder = 'sk-...';

    const syncKeyChange = () => {
        const val = keyInputEl.value.trim();
        const settings = getSettings(currentProvider);
        settings.apiKey = val;
        options.onSettingsChange(currentProvider, settings);
    };
    keyInputEl.addEventListener('input', syncKeyChange);
    keyInputEl.addEventListener('change', syncKeyChange);

    const toggleEyeBtn = document.createElement('button');
    toggleEyeBtn.type = 'button';
    toggleEyeBtn.className = 'da-btn da-btn--secondary';
    toggleEyeBtn.textContent = '👁️';
    toggleEyeBtn.title = '显示/隐藏密钥';
    toggleEyeBtn.style.padding = '0 10px';
    toggleEyeBtn.onclick = () => {
        if (keyInputEl.type === 'password') {
            keyInputEl.type = 'text';
            toggleEyeBtn.textContent = '🔒';
        } else {
            keyInputEl.type = 'password';
            toggleEyeBtn.textContent = '👁️';
        }
    };

    keyContainer.appendChild(keyInputEl);
    keyContainer.appendChild(toggleEyeBtn);
    keyRow.slots[1].appendChild(keyContainer);
    card.body.appendChild(keyRow.root);

    // ─────────────────────────────────────────────────────────────
    // 4. 专属请求头 (JSON) 行
    // ─────────────────────────────────────────────────────────────
    const headersRow = createRow(['left', 'right'], { align: 'center', divided: true });
    headersRow.slots[0].appendChild(createFieldLabel({
        title: '专享请求头 (JSON)',
        description: '如 OpenRouter 要求的 HTTP-Referer 或网关鉴权头'
    }));

    const headersInputEl = document.createElement('input');
    headersInputEl.type = 'text';
    headersInputEl.className = 'da-input da-w-full';
    headersInputEl.placeholder = '{"HTTP-Referer": "https://sillytavern.app"}';
    headersInputEl.value = getSettings(currentProvider).customHeadersJson || '';

    headersInputEl.addEventListener('change', () => {
        const settings = getSettings(currentProvider);
        settings.customHeadersJson = headersInputEl.value.trim();
        options.onSettingsChange(currentProvider, settings);
    });

    headersRow.slots[1].appendChild(headersInputEl);
    card.body.appendChild(headersRow.root);

    // ─────────────────────────────────────────────────────────────
    // 5. 连通性测试与模型同步操作行
    // ─────────────────────────────────────────────────────────────
    const actionRow = createRow(['left', 'right'], { align: 'center' });
    actionRow.slots[0].appendChild(createFieldLabel({
        title: '连通性与模型同步',
        description: '探测端点有效性，并拉取同步最新生图模型目录'
    }));

    const actionContainer = document.createElement('div');
    actionContainer.style.display = 'flex';
    actionContainer.style.gap = '8px';

    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'da-btn da-btn--secondary';
    testBtn.textContent = '测试连接';
    testBtn.onclick = () => {
        const s = getSettings(currentProvider);
        void options.onTestConnection(currentProvider, s, testBtn);
    };

    const syncModelsBtn = document.createElement('button');
    syncModelsBtn.type = 'button';
    syncModelsBtn.className = 'da-btn da-btn--secondary';
    syncModelsBtn.textContent = '同步远端模型';
    syncModelsBtn.onclick = () => {
        const s = getSettings(currentProvider);
        void options.onSyncModels(currentProvider, s, syncModelsBtn);
    };

    actionContainer.appendChild(testBtn);
    actionContainer.appendChild(syncModelsBtn);
    actionRow.slots[1].appendChild(actionContainer);
    card.body.appendChild(actionRow.root);

    // ─────────────────────────────────────────────────────────────
    // 核心切换与绑定逻辑
    // ─────────────────────────────────────────────────────────────
    const bindProvider = (newProvider: OpenAIProviderType) => {
        currentProvider = newProvider;
        const s = getSettings(newProvider);

        providerSelectEl.value = newProvider;
        urlInputEl.value = s.serverUrl;
        keyInputEl.value = s.apiKey;
        headersInputEl.value = s.customHeadersJson || '';
        updateBadge(s.lastLatencyMs);

        options.onProviderChange(newProvider, s);
    };

    providerSelectEl.addEventListener('change', () => {
        const selected = providerSelectEl.value as OpenAIProviderType;
        bindProvider(selected);
    });

    // 组装并返回增强 DOM 节点
    const rootEl = card.root as OpenAIServiceCardElement;
    rootEl.setProvider = (p: OpenAIProviderType) => bindProvider(p);
    rootEl.updateStatusBadge = (latencyMs?: number) => {
        const s = getSettings(currentProvider);
        s.lastLatencyMs = latencyMs;
        updateBadge(latencyMs);
    };
    rootEl.getCurrentProvider = () => currentProvider;
    rootEl.getCurrentSettings = () => getSettings(currentProvider);
    rootEl.dispose = () => {
        urlInputEl.removeEventListener('input', syncUrlChange);
        urlInputEl.removeEventListener('change', syncUrlChange);
        keyInputEl.removeEventListener('input', syncKeyChange);
        keyInputEl.removeEventListener('change', syncKeyChange);
    };

    return rootEl;
}
