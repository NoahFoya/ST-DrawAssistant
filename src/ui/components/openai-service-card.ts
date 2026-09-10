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

export type OpenAIServiceFieldTarget = 'all' | 'url' | 'key' | 'headers';

export interface OpenAIServiceCardElement extends HTMLElement, IDisposable {
    /** 外部程序化切换激活的提供商 */
    setProvider: (provider: OpenAIProviderType) => void;
    /** 更新延迟状态徽标 */
    updateStatusBadge: (latencyMs?: number) => void;
    /** 获取当前选中的提供商 */
    getCurrentProvider: () => OpenAIProviderType;
    /** 获取当前选中的提供商配置 */
    getCurrentSettings: () => OpenAIProviderSettings;
    /** 设置字段修改态 */
    setDirty: (isDirty: boolean, target?: OpenAIServiceFieldTarget) => void;
    /** 设置字段失效报错 */
    setError: (hasError: boolean, tooltip?: string, target?: OpenAIServiceFieldTarget) => void;
    /** 设置测试操作状态反馈 */
    setStatus: (status: 'idle' | 'testing' | 'success' | 'error', text?: string) => void;
    /** 固化当前提供商的基准值 */
    resetBaseline: () => void;
}

const PROVIDER_SELECT_OPTIONS: Array<{ value: OpenAIProviderType; label: string }> = [
    { value: 'openai-official', label: 'OpenAI 官方 (GPT-Image / DALL·E 3)' },
    { value: 'siliconflow', label: '硅基流动 SiliconFlow (FLUX / Kolors / SD3.5)' },
    { value: 'xai-grok', label: 'xAI Grok Imagine (宽屏生图)' },
    { value: 'openrouter', label: 'OpenRouter (全球大模型聚合)' },
    { value: 'together', label: 'Together AI (云端开源大模型推理)' },
    { value: 'custom', label: '自定义兼容服务 (自主配置)' }
];

interface FieldState {
    isDirty: boolean;
    hasError: boolean;
    errorTooltip: string;
}

function updateFieldVisual(el: HTMLInputElement, state: FieldState): void {
    el.classList.toggle('is-invalid', state.hasError);
    el.classList.toggle('is-dirty', state.isDirty && !state.hasError);
    if (state.hasError) {
        el.title = state.errorTooltip;
    } else if (state.isDirty) {
        el.title = '已修改';
    } else {
        el.removeAttribute('title');
    }
}

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

    // 各提供商独立基准快照 (用于脏值精准判定)
    const baselines: Record<OpenAIProviderType, { serverUrl: string; apiKey: string; customHeadersJson: string }> = {} as any;
    for (const key of Object.keys(defaults) as OpenAIProviderType[]) {
        baselines[key] = {
            serverUrl: providersMap[key].serverUrl || '',
            apiKey: providersMap[key].apiKey || '',
            customHeadersJson: providersMap[key].customHeadersJson || ''
        };
    }

    let currentProvider: OpenAIProviderType = options.activeProvider || 'openai-official';

    const getSettings = (p: OpenAIProviderType): OpenAIProviderSettings => {
        if (!providersMap[p]) {
            providersMap[p] = { ...(defaults[p] || defaults['custom']) };
        }
        return providersMap[p];
    };

    // 局部参数字段状态
    const urlState: FieldState = { isDirty: false, hasError: false, errorTooltip: '已失效：无法连接到目标服务地址' };
    const keyState: FieldState = { isDirty: false, hasError: false, errorTooltip: '已失效：授权凭据无效' };
    const headersState: FieldState = { isDirty: false, hasError: false, errorTooltip: '已失效：请求头格式错误' };

    // --- 1. 服务供应商选择行 (Provider Select & Badge) ---
    const providerRow = createRow(['left', 'right'], { align: 'center', divided: true });
    providerRow.slots[0].appendChild(createFieldLabel({
        title: '服务供应商',
        helpTooltip: '切换当前生效的大模型生图服务商，各服务商独立保存端点与密钥'
    }));

    const providerContainer = document.createElement('div');
    providerContainer.className = 'da-input-group';

    const providerSelectEl = document.createElement('select');
    providerSelectEl.className = 'da-select da-flex-1';

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

    // --- 2. 接口 Base URL 行 ---
    const urlRow = createRow(['left', 'right'], { align: 'center', divided: true });
    urlRow.slots[0].appendChild(createFieldLabel({
        title: '接口 Base URL',
        helpTooltip: 'OpenAI 兼容端点基地址，自动补充 /v1 并过滤多余路径'
    }));

    const urlContainer = document.createElement('div');
    urlContainer.className = 'da-input-group';

    const urlInputEl = document.createElement('input');
    urlInputEl.type = 'text';
    urlInputEl.className = 'da-input da-input--text da-flex-1';
    urlInputEl.value = getSettings(currentProvider).serverUrl;
    urlInputEl.placeholder = 'https://api.openai.com/v1';

    const resetUrlBtn = document.createElement('button');
    resetUrlBtn.type = 'button';
    resetUrlBtn.className = 'da-btn da-btn--secondary da-btn--sm da-nowrap';
    resetUrlBtn.innerHTML = `<svg class="da-icon" viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>恢复默认`;
    resetUrlBtn.title = '恢复为当前提供商推荐的官方默认地址';

    const syncUrlChange = () => {
        const normalized = normalizeOpenAiBaseUrl(urlInputEl.value);
        const settings = getSettings(currentProvider);
        settings.serverUrl = normalized;
        options.onSettingsChange(currentProvider, settings);

        // 自愈解除失效，并计算脏值
        urlState.hasError = false;
        urlState.isDirty = normalized.trim() !== (baselines[currentProvider]?.serverUrl || '').trim();
        updateFieldVisual(urlInputEl, urlState);
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

    // --- 3. API Key 访问密钥行 ---
    const keyRow = createRow(['left', 'right'], { align: 'center', divided: true });
    keyRow.slots[0].appendChild(createFieldLabel({
        title: 'API Key (访问密钥)',
        helpTooltip: 'Bearer 授权令牌，保存在浏览器本地扩展配置中，直连时携带'
    }));

    const keyContainer = document.createElement('div');
    keyContainer.className = 'da-input-group';

    const keyInputEl = document.createElement('input');
    keyInputEl.type = 'password';
    keyInputEl.className = 'da-input da-input--text da-flex-1';
    keyInputEl.value = getSettings(currentProvider).apiKey;
    keyInputEl.placeholder = 'sk-...';

    const syncKeyChange = () => {
        const val = keyInputEl.value.trim();
        const settings = getSettings(currentProvider);
        settings.apiKey = val;
        options.onSettingsChange(currentProvider, settings);

        // 自愈解除失效，并计算脏值
        keyState.hasError = false;
        keyState.isDirty = val !== (baselines[currentProvider]?.apiKey || '').trim();
        updateFieldVisual(keyInputEl, keyState);
    };
    keyInputEl.addEventListener('input', syncKeyChange);
    keyInputEl.addEventListener('change', syncKeyChange);

    const EYE_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

    const toggleEyeBtn = document.createElement('button');
    toggleEyeBtn.type = 'button';
    toggleEyeBtn.className = 'da-btn da-btn--secondary da-icon-btn';
    toggleEyeBtn.innerHTML = EYE_SVG;
    toggleEyeBtn.title = '显示/隐藏密钥';
    toggleEyeBtn.setAttribute('aria-label', '显示/隐藏密钥');
    toggleEyeBtn.onclick = () => {
        if (keyInputEl.type === 'password') {
            keyInputEl.type = 'text';
            toggleEyeBtn.innerHTML = EYE_OFF_SVG;
        } else {
            keyInputEl.type = 'password';
            toggleEyeBtn.innerHTML = EYE_SVG;
        }
    };

    keyContainer.appendChild(keyInputEl);
    keyContainer.appendChild(toggleEyeBtn);
    keyRow.slots[1].appendChild(keyContainer);
    card.body.appendChild(keyRow.root);

    // --- 4. 专属请求头 (JSON) 行 ---
    const headersRow = createRow(['left', 'right'], { align: 'center', divided: true });
    headersRow.slots[0].appendChild(createFieldLabel({
        title: '专享请求头 (JSON)',
        helpTooltip: '如 OpenRouter 要求的 HTTP-Referer 或网关鉴权头'
    }));

    const headersInputEl = document.createElement('input');
    headersInputEl.type = 'text';
    headersInputEl.className = 'da-input da-w-full';
    headersInputEl.placeholder = '{"HTTP-Referer": "https://sillytavern.app"}';
    headersInputEl.value = getSettings(currentProvider).customHeadersJson || '';

    const syncHeadersChange = () => {
        const val = headersInputEl.value.trim();
        const settings = getSettings(currentProvider);
        settings.customHeadersJson = val;
        options.onSettingsChange(currentProvider, settings);

        headersState.hasError = false;
        headersState.isDirty = val !== (baselines[currentProvider]?.customHeadersJson || '').trim();
        updateFieldVisual(headersInputEl, headersState);
    };
    headersInputEl.addEventListener('input', syncHeadersChange);
    headersInputEl.addEventListener('change', syncHeadersChange);

    headersRow.slots[1].appendChild(headersInputEl);
    card.body.appendChild(headersRow.root);

    // --- 5. 连通性测试与模型同步操作行 ---
    const actionRow = createRow(['left', 'right'], { align: 'center' });
    actionRow.slots[0].appendChild(createFieldLabel({
        title: '连通性与模型同步',
        helpTooltip: '探测端点有效性，并拉取同步最新生图模型目录'
    }));

    const actionContainer = document.createElement('div');
    actionContainer.className = 'da-flex-row da-gap-sm';

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

    const setStatus = (status: 'idle' | 'testing' | 'success' | 'error', text?: string) => {
        testBtn.classList.remove('is-loading', 'da-btn--success', 'da-btn--danger');
        if (status === 'testing') {
            testBtn.classList.add('is-loading');
            testBtn.disabled = true;
            testBtn.textContent = text || '测试中...';
        } else if (status === 'success') {
            testBtn.classList.add('da-btn--success');
            testBtn.disabled = false;
            testBtn.textContent = text || '连接成功';

            // 连通成功固化当前输入为当前提供商的新基准值
            baselines[currentProvider] = {
                serverUrl: urlInputEl.value.trim(),
                apiKey: keyInputEl.value.trim(),
                customHeadersJson: headersInputEl.value.trim()
            };
            urlState.isDirty = false;
            urlState.hasError = false;
            updateFieldVisual(urlInputEl, urlState);

            keyState.isDirty = false;
            keyState.hasError = false;
            updateFieldVisual(keyInputEl, keyState);

            headersState.isDirty = false;
            headersState.hasError = false;
            updateFieldVisual(headersInputEl, headersState);
        } else if (status === 'error') {
            testBtn.classList.add('da-btn--danger');
            testBtn.disabled = false;
            testBtn.textContent = text || '连接失败';
        } else {
            testBtn.disabled = false;
            testBtn.textContent = text || '测试连接';
        }
    };

    // --- 核心切换与绑定逻辑 ---
    const bindProvider = (newProvider: OpenAIProviderType) => {
        currentProvider = newProvider;
        const s = getSettings(newProvider);

        providerSelectEl.value = newProvider;
        urlInputEl.value = s.serverUrl;
        keyInputEl.value = s.apiKey;
        headersInputEl.value = s.customHeadersJson || '';
        updateBadge(s.lastLatencyMs);

        // 切换提供商时清除旧提供商的 dirty / invalid 状态
        urlState.isDirty = false;
        urlState.hasError = false;
        updateFieldVisual(urlInputEl, urlState);

        keyState.isDirty = false;
        keyState.hasError = false;
        updateFieldVisual(keyInputEl, keyState);

        headersState.isDirty = false;
        headersState.hasError = false;
        updateFieldVisual(headersInputEl, headersState);

        testBtn.classList.remove('is-loading', 'da-btn--success', 'da-btn--danger');
        testBtn.disabled = false;
        testBtn.textContent = '测试连接';

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

    rootEl.setDirty = (isDirty: boolean, target: OpenAIServiceFieldTarget = 'all') => {
        if (target === 'all' || target === 'url') {
            urlState.isDirty = isDirty;
            updateFieldVisual(urlInputEl, urlState);
        }
        if (target === 'all' || target === 'key') {
            keyState.isDirty = isDirty;
            updateFieldVisual(keyInputEl, keyState);
        }
        if (target === 'all' || target === 'headers') {
            headersState.isDirty = isDirty;
            updateFieldVisual(headersInputEl, headersState);
        }
    };

    rootEl.setError = (hasError: boolean, tooltip?: string, target: OpenAIServiceFieldTarget = 'url') => {
        if (target === 'all' || target === 'url') {
            urlState.hasError = hasError;
            if (tooltip) urlState.errorTooltip = tooltip;
            updateFieldVisual(urlInputEl, urlState);
        }
        if (target === 'all' || target === 'key') {
            keyState.hasError = hasError;
            if (tooltip) keyState.errorTooltip = tooltip;
            updateFieldVisual(keyInputEl, keyState);
        }
        if (target === 'all' || target === 'headers') {
            headersState.hasError = hasError;
            if (tooltip) headersState.errorTooltip = tooltip;
            updateFieldVisual(headersInputEl, headersState);
        }
    };

    rootEl.setStatus = setStatus;

    rootEl.resetBaseline = () => {
        baselines[currentProvider] = {
            serverUrl: urlInputEl.value.trim(),
            apiKey: keyInputEl.value.trim(),
            customHeadersJson: headersInputEl.value.trim()
        };
        urlState.isDirty = false;
        urlState.hasError = false;
        updateFieldVisual(urlInputEl, urlState);

        keyState.isDirty = false;
        keyState.hasError = false;
        updateFieldVisual(keyInputEl, keyState);

        headersState.isDirty = false;
        headersState.hasError = false;
        updateFieldVisual(headersInputEl, headersState);
    };

    rootEl.dispose = () => {
        urlInputEl.removeEventListener('input', syncUrlChange);
        urlInputEl.removeEventListener('change', syncUrlChange);
        keyInputEl.removeEventListener('input', syncKeyChange);
        keyInputEl.removeEventListener('change', syncKeyChange);
        headersInputEl.removeEventListener('input', syncHeadersChange);
        headersInputEl.removeEventListener('change', syncHeadersChange);
    };

    return rootEl;
}
