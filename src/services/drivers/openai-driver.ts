/**
 * OpenAI 规范生图引擎驱动
 * 适配支持 POST /v1/images/generations 的服务（OpenAI 官方、xAI Grok、硅基流动、OpenRouter 等）。
 * 针对不同服务商动态适配 size/image_size 字段名，支持 Base64 与 URL 两种结果格式解析，并处理内容安全审核拦截错误。
 */

import { BaseDriver, BaseDriverOptions, extractStatusCode } from './base-driver';
import { base64ToBlob } from '../../utils/binary';
import {
    EngineCapabilities,
    GenerationRequest,
    GenerationResult,
    HealthCheckResult,
    ProviderAssetCatalog,
    ProgressCallback,
    DriverError,
    DriverErrorType,
    ImageMetadata
} from '../../types/driver';

export interface OpenAIDrawingProfileData {
    model: string;
    width: number;
    height: number;
    sizePreset?: string;
    quality: string;
    style: string;
    responseFormat: 'b64_json' | 'url';
    n: number;
    steps?: number;
    cfgScale?: number;
    seed?: number;
    negativePrompt?: string;
    customHeadersJson?: string;
    extraBodyJson?: string;
    [key: string]: unknown;
}

export interface OpenAIPresetItem<T = OpenAIDrawingProfileData> {
    id: string;
    name: string;
    data?: T;
}

export type OpenAIProviderType =
    | 'openai-official'
    | 'xai-grok'
    | 'siliconflow'
    | 'openrouter'
    | 'together'
    | 'custom';

export interface ProviderCapability {
    name: string;
    description: string;
    defaultUrl: string;
    allowNegativePrompt: boolean;
    allowSteps: boolean;
    allowCfgScale: boolean;
    allowSeed: boolean;
    allowQuality: boolean;
    qualityOptions?: string[];
    allowStyle: boolean;
    sizeParamKey: 'size' | 'image_size';
    defaultModel: string;
    recommendedModels: Array<{ id: string; name: string }>;
}

export const PROVIDER_CAPABILITIES: Record<OpenAIProviderType, ProviderCapability> = {
    'openai-official': {
        name: 'OpenAI 官方',
        description: 'OpenAI 官方生图接口 (支持 GPT-Image 系列与 DALL·E 3)',
        defaultUrl: 'https://api.openai.com/v1',
        allowNegativePrompt: false,
        allowSteps: false,
        allowCfgScale: false,
        allowSeed: false,
        allowQuality: true,
        qualityOptions: ['standard', 'hd'],
        allowStyle: true,
        sizeParamKey: 'size',
        defaultModel: 'gpt-image-2',
        recommendedModels: [
            { id: 'gpt-image-2', name: 'gpt-image-2 (推荐)' },
            { id: 'gpt-image-1', name: 'gpt-image-1' },
            { id: 'gpt-image-1-mini', name: 'gpt-image-1-mini' },
            { id: 'dall-e-3', name: 'dall-e-3' },
            { id: 'dall-e-2', name: 'dall-e-2' }
        ]
    },
    'xai-grok': {
        name: 'xAI Grok Imagine',
        description: 'xAI Grok 生图接口 (支持 Grok Imagine 2.0 宽屏自然渲染)',
        defaultUrl: 'https://api.x.ai/v1',
        allowNegativePrompt: false,
        allowSteps: false,
        allowCfgScale: false,
        allowSeed: false,
        allowQuality: true,
        qualityOptions: ['high', 'standard', 'low'],
        allowStyle: false,
        sizeParamKey: 'size',
        defaultModel: 'grok-imagine-image-2.0',
        recommendedModels: [
            { id: 'grok-imagine-image-2.0', name: 'grok-imagine-image-2.0 (推荐)' },
            { id: 'grok-imagine-image', name: 'grok-imagine-image' },
            { id: 'grok-imagine-image-quality', name: 'grok-imagine-image-quality' }
        ]
    },
    'siliconflow': {
        name: '硅基流动 (SiliconFlow)',
        description: '国内高并发聚合平台 (支持 FLUX.1、Kolors 可图、SD3.5 等扩散模型)',
        defaultUrl: 'https://api.siliconflow.cn/v1',
        allowNegativePrompt: true,
        allowSteps: true,
        allowCfgScale: true,
        allowSeed: true,
        allowQuality: false,
        allowStyle: false,
        sizeParamKey: 'image_size',
        defaultModel: 'black-forest-labs/FLUX.1-schnell',
        recommendedModels: [
            { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1-schnell (极速)' },
            { id: 'black-forest-labs/FLUX.1-dev', name: 'FLUX.1-dev (高质量)' },
            { id: 'Kwai-Kolors/Kolors', name: 'Kwai-Kolors/Kolors (可图中文强化)' },
            { id: 'stabilityai/stable-diffusion-3-5-large', name: 'SD 3.5 Large' }
        ]
    },
    'openrouter': {
        name: 'OpenRouter',
        description: 'OpenRouter 聚合网关 (连接全球主流生图大模型)',
        defaultUrl: 'https://openrouter.ai/api/v1',
        allowNegativePrompt: false,
        allowSteps: false,
        allowCfgScale: false,
        allowSeed: true,
        allowQuality: true,
        allowStyle: false,
        sizeParamKey: 'size',
        defaultModel: 'openai/gpt-image-2',
        recommendedModels: [
            { id: 'openai/gpt-image-2', name: 'openai/gpt-image-2' },
            { id: 'openai/dall-e-3', name: 'openai/dall-e-3' },
            { id: 'black-forest-labs/flux-1-schnell', name: 'flux-1-schnell' }
        ]
    },
    'together': {
        name: 'Together AI',
        description: 'Together AI 云端开源大模型推理',
        defaultUrl: 'https://api.together.xyz/v1',
        allowNegativePrompt: true,
        allowSteps: true,
        allowCfgScale: true,
        allowSeed: true,
        allowQuality: false,
        allowStyle: false,
        sizeParamKey: 'size',
        defaultModel: 'black-forest-labs/FLUX.1-schnell',
        recommendedModels: [
            { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1-schnell' },
            { id: 'black-forest-labs/FLUX.1-dev', name: 'FLUX.1-dev' },
            { id: 'stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL Base 1.0' }
        ]
    },
    'custom': {
        name: '自定义服务节点',
        description: '自定义兼容 OpenAI POST /v1/images/generations 的生图端点',
        defaultUrl: 'http://127.0.0.1:8000/v1',
        allowNegativePrompt: true,
        allowSteps: true,
        allowCfgScale: true,
        allowSeed: true,
        allowQuality: true,
        qualityOptions: ['standard', 'hd', 'high', 'medium', 'low'],
        allowStyle: true,
        sizeParamKey: 'size',
        defaultModel: 'gpt-image-2',
        recommendedModels: []
    }
};

export interface OpenAIProviderSettings {
    serverUrl: string;
    apiKey: string;
    customHeadersJson?: string;
    dynamicModels?: string[];
    lastLatencyMs?: number;
    lastConnectedAt?: number;
}

export function createDefaultOpenAIProviders(): Record<OpenAIProviderType, OpenAIProviderSettings> {
    return {
        'openai-official': {
            serverUrl: PROVIDER_CAPABILITIES['openai-official'].defaultUrl,
            apiKey: '',
            dynamicModels: []
        },
        'siliconflow': {
            serverUrl: PROVIDER_CAPABILITIES['siliconflow'].defaultUrl,
            apiKey: '',
            dynamicModels: []
        },
        'xai-grok': {
            serverUrl: PROVIDER_CAPABILITIES['xai-grok'].defaultUrl,
            apiKey: '',
            dynamicModels: []
        },
        'openrouter': {
            serverUrl: PROVIDER_CAPABILITIES['openrouter'].defaultUrl,
            apiKey: '',
            dynamicModels: []
        },
        'together': {
            serverUrl: PROVIDER_CAPABILITIES['together'].defaultUrl,
            apiKey: '',
            dynamicModels: []
        },
        'custom': {
            serverUrl: PROVIDER_CAPABILITIES['custom'].defaultUrl,
            apiKey: '',
            dynamicModels: []
        }
    };
}

export interface OpenAIEngineConfig {
    activeProvider: OpenAIProviderType;
    providers: Record<OpenAIProviderType, OpenAIProviderSettings>;
    activeDrawingProfileId: string;
    serverUrl: string;
    apiKey: string;
    dynamicModels?: string[];
    model?: string;
    width?: number;
    height?: number;
    size?: string;
    quality?: string;
    style?: string;
    responseFormat?: 'b64_json' | 'url';
    n?: number;
    steps?: number;
    cfgScale?: number;
    seed?: number;
    negativePrompt?: string;
    customHeadersJson?: string;
    extraBodyJson?: string;
    [key: string]: unknown;
}

export function createDefaultOpenAIConfig(): OpenAIEngineConfig {
    return {
        activeProvider: 'openai-official',
        providers: createDefaultOpenAIProviders(),
        activeDrawingProfileId: 'profile-gpt-image-2',
        serverUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-image-2',
        width: 1024,
        height: 1024,
        size: '1024x1024',
        quality: 'standard',
        style: 'vivid',
        responseFormat: 'b64_json',
        n: 1
    };
}

export const DEFAULT_OPENAI_DRAWING_PROFILES: OpenAIPresetItem<OpenAIDrawingProfileData>[] = [
    {
        id: 'profile-gpt-image-2',
        name: 'GPT-Image-2 (官方默认)',
        data: {
            model: 'gpt-image-2',
            width: 1024,
            height: 1024,
            sizePreset: '1024x1024',
            quality: 'standard',
            style: 'vivid',
            responseFormat: 'b64_json',
            n: 1
        }
    },
    {
        id: 'profile-flux-schnell',
        name: 'FLUX.1 Schnell (极速生成)',
        data: {
            model: 'black-forest-labs/FLUX.1-schnell',
            width: 1024,
            height: 1024,
            sizePreset: '1024x1024',
            quality: 'standard',
            style: 'natural',
            responseFormat: 'b64_json',
            n: 1,
            steps: 4,
            cfgScale: 1.0,
            seed: -1
        }
    },
    {
        id: 'profile-grok-imagine',
        name: 'Grok Imagine (宽屏)',
        data: {
            model: 'grok-imagine-image-2.0',
            width: 1792,
            height: 1024,
            sizePreset: '1792x1024',
            quality: 'high',
            style: 'natural',
            responseFormat: 'b64_json',
            n: 1
        }
    },
    {
        id: 'profile-kolors-standard',
        name: '可图 Kolors (中文增强)',
        data: {
            model: 'Kwai-Kolors/Kolors',
            width: 1024,
            height: 1024,
            sizePreset: '1024x1024',
            quality: 'standard',
            style: 'natural',
            responseFormat: 'b64_json',
            n: 1,
            steps: 25,
            cfgScale: 5.0,
            seed: -1,
            negativePrompt: 'blurry, low quality, distorted, bad anatomy'
        }
    }
];

export const DEFAULT_OPENAI_CONFIG: OpenAIEngineConfig = {
    activeProvider: 'openai-official',
    providers: createDefaultOpenAIProviders(),
    activeDrawingProfileId: 'profile-gpt-image-2',
    serverUrl: 'https://api.openai.com/v1',
    apiKey: '',
    dynamicModels: [],
    model: 'gpt-image-2',
    width: 1024,
    height: 1024,
    quality: 'standard',
    style: 'vivid',
    responseFormat: 'b64_json',
    n: 1,
    steps: 20,
    cfgScale: 7.0,
    seed: -1
};

export const PRESET_OPENAI_MODELS: Array<{ id: string; name: string }> = [
    { id: 'gpt-image-2', name: 'gpt-image-2 (OpenAI)' },
    { id: 'gpt-image-1', name: 'gpt-image-1 (OpenAI)' },
    { id: 'gpt-image-1-mini', name: 'gpt-image-1-mini (OpenAI)' },
    { id: 'grok-imagine-image-2.0', name: 'grok-imagine-image-2.0 (xAI)' },
    { id: 'grok-imagine-image', name: 'grok-imagine-image (xAI)' },
    { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1-schnell (扩散大模型)' },
    { id: 'black-forest-labs/FLUX.1-dev', name: 'FLUX.1-dev (扩散大模型)' },
    { id: 'Kwai-Kolors/Kolors', name: 'Kwai-Kolors/Kolors (可图)' },
    { id: 'dall-e-3', name: 'dall-e-3 (DALL·E 3)' },
    { id: 'dall-e-2', name: 'dall-e-2 (DALL·E 2)' }
];

export const IMAGE_MODEL_KEYWORD_REGEX = /(image|dall-e|flux|midjourney|sd|stable-diffusion|grok|kolors|cogview|recraft|imagen|banana)/i;

export function getActiveProviderSettings(config?: Partial<OpenAIEngineConfig>): {
    provider: OpenAIProviderType;
    settings: OpenAIProviderSettings;
} {
    const provider: OpenAIProviderType = config?.activeProvider || 'openai-official';
    const defaults = createDefaultOpenAIProviders();
    const settings = config?.providers?.[provider] || defaults[provider] || defaults['custom'];

    return {
        provider,
        settings: {
            ...settings,
            serverUrl: config?.serverUrl || settings.serverUrl,
            apiKey: config?.apiKey !== undefined ? config.apiKey : settings.apiKey,
            dynamicModels: config?.dynamicModels || settings.dynamicModels
        }
    };
}

export function normalizeOpenAiBaseUrl(rawUrl?: string): string {
    let url = (rawUrl || '').trim();
    if (!url) {
        return 'https://api.openai.com/v1';
    }
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/images\/(generations|edits)$/, '');
    url = url.replace(/\/+$/, '');

    if (/\/v\d+([a-zA-Z0-9_-]*)?$/.test(url)) {
        return url;
    }

    try {
        const parsed = new URL(url);
        if (parsed.pathname === '' || parsed.pathname === '/') {
            url = `${url}/v1`;
        }
    } catch {}

    return url;
}

export interface OpenAIEngineOptions extends Partial<OpenAIEngineConfig> {}
export interface OpenAIDriverOptions extends BaseDriverOptions {}

export class OpenAiDriver extends BaseDriver {
    public readonly id = 'openai';
    public readonly name = 'OpenAI 兼容';
    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: true,
        lora: false,
        interrupt: false,
        syntaxType: 'natural'
    };

    public getDefaultConfig(): Record<string, unknown> {
        return createDefaultOpenAIConfig() as unknown as Record<string, unknown>;
    }

    constructor(options: OpenAIDriverOptions) {
        super(options);
    }

    public getProviderBaseUrl(_provider?: string, options: OpenAIEngineOptions = {}): string {
        const { settings } = getActiveProviderSettings(options);
        const configuredUrl = (options.serverUrl as string) || (options.proxyUrl as string) || settings.serverUrl || this.getBaseUrl();
        return normalizeOpenAiBaseUrl(configuredUrl);
    }

    public override async checkHealth(): Promise<HealthCheckResult> {
        const start = performance.now();
        const cfg = (this._getConfig?.() as OpenAIEngineOptions | undefined) || {};
        const { settings } = getActiveProviderSettings(cfg);
        const baseUrl = normalizeOpenAiBaseUrl(settings.serverUrl || cfg.serverUrl || this.getBaseUrl());
        const apiKey = (settings.apiKey || cfg.apiKey || '').trim();

        try {
            const modelsEndpoint = `${baseUrl}/models`;
            const headers: Record<string, string> = {};
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            if (settings.customHeadersJson) {
                try {
                    const parsed = JSON.parse(settings.customHeadersJson);
                    if (parsed && typeof parsed === 'object') {
                        Object.assign(headers, parsed);
                    }
                } catch {}
            }

            await this.network.fetchExternal(modelsEndpoint, {
                timeoutMs: 6000,
                headers
            });

            this._isConnected = true;
            return {
                ok: true,
                latencyMs: Math.round(performance.now() - start)
            };
        } catch (err: any) {
            this._isConnected = false;
            const latencyMs = Math.round(performance.now() - start);
            const statusCode = extractStatusCode(err);
            let message = err?.message || '连接 OpenAI 兼容端点失败';
            if (statusCode === 401) {
                message = 'API Key 鉴权失败，请检查 API Key 是否有效 (HTTP 401)';
            } else if (statusCode === 403) {
                message = '访问被禁止或 Key 权限不足 (HTTP 403)';
            } else if (statusCode === 429) {
                message = '请求过于频繁或账户额度不足 (HTTP 429)';
            }
            return {
                ok: false,
                latencyMs,
                statusCode,
                message
            };
        }
    }

    protected override async doSyncAssets(): Promise<ProviderAssetCatalog> {
        const cfg = (this._getConfig?.() as OpenAIEngineOptions | undefined) || {};
        const { settings } = getActiveProviderSettings(cfg);
        const baseUrl = normalizeOpenAiBaseUrl(settings.serverUrl || cfg.serverUrl || this.getBaseUrl());
        const apiKey = (settings.apiKey || cfg.apiKey || '').trim();

        try {
            const modelsEndpoint = `${baseUrl}/models`;
            const headers: Record<string, string> = {};
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
            if (settings.customHeadersJson) {
                try {
                    const parsed = JSON.parse(settings.customHeadersJson);
                    if (parsed && typeof parsed === 'object') {
                        Object.assign(headers, parsed);
                    }
                } catch {}
            }

            const res = await this.network.fetchExternal(modelsEndpoint, {
                timeoutMs: 8000,
                headers
            });

            const json = await res.json() as { data?: Array<{ id: string }>; models?: Array<{ id: string }> };
            const rawList = Array.isArray(json?.data)
                ? json.data.map(item => item.id)
                : Array.isArray(json?.models)
                    ? json.models.map(item => item.id)
                    : [];

            if (rawList.length === 0) {
                return { models: [] };
            }

            const imageModels: string[] = [];
            const otherModels: string[] = [];

            for (const modelId of rawList) {
                if (IMAGE_MODEL_KEYWORD_REGEX.test(modelId)) {
                    imageModels.push(modelId);
                } else {
                    otherModels.push(modelId);
                }
            }

            imageModels.sort((a, b) => a.localeCompare(b));
            otherModels.sort((a, b) => a.localeCompare(b));

            return {
                models: [...imageModels, ...otherModels]
            };
        } catch (err: any) {
            this.logger.warn('拉取远端 /models 异常:', err);
            if (err instanceof DriverError) throw err;
            throw new DriverError(
                DriverErrorType.NETWORK_ERROR,
                `访问 OpenAI 模型列表接口失败 [${baseUrl}/models]: ${err?.message || err}`,
                undefined,
                err
            );
        }
    }

    protected override async doGenerate(
        request: GenerationRequest,
        signal?: AbortSignal,
        _onProgress?: ProgressCallback
    ): Promise<GenerationResult> {
        const startTime = performance.now();
        const globalConfig = (this._getConfig?.() as OpenAIEngineConfig | undefined) || DEFAULT_OPENAI_CONFIG;
        const { provider, settings } = getActiveProviderSettings(globalConfig);
        const providerType: OpenAIProviderType = (request.engineOptions as any)?.providerType
            || provider
            || 'openai-official';
        const capability = PROVIDER_CAPABILITIES[providerType] || PROVIDER_CAPABILITIES['custom'];

        let activeProfile: OpenAIDrawingProfileData | undefined;
        const rawDrawingProfiles = (globalConfig as any).drawingProfiles;
        if (Array.isArray(rawDrawingProfiles) && rawDrawingProfiles.length > 0) {
            const foundItem = rawDrawingProfiles.find((p: any) => p.id === globalConfig.activeDrawingProfileId)
                || rawDrawingProfiles[0];
            activeProfile = foundItem?.data;
        }

        const engineOpts = (request.engineOptions as Partial<OpenAIDrawingProfileData> | undefined) || {};

        const model = engineOpts.model || activeProfile?.model || globalConfig.model || capability.defaultModel;
        const width = engineOpts.width || activeProfile?.width || globalConfig.width || 1024;
        const height = engineOpts.height || activeProfile?.height || globalConfig.height || 1024;
        const quality = engineOpts.quality || activeProfile?.quality || globalConfig.quality || 'standard';
        const style = engineOpts.style || activeProfile?.style || globalConfig.style || 'vivid';
        const responseFormat = engineOpts.responseFormat || activeProfile?.responseFormat || 'b64_json';
        const n = 1;

        const baseUrl = normalizeOpenAiBaseUrl((engineOpts as any).serverUrl || settings.serverUrl || globalConfig.serverUrl || this.getBaseUrl());
        const endpoint = `${baseUrl}/images/generations`;
        const apiKey = ((engineOpts as any).apiKey || settings.apiKey || globalConfig.apiKey || '').trim();

        const payload: Record<string, unknown> = {
            model,
            prompt: request.prompt,
            n,
            response_format: responseFormat
        };

        const sizeStr = `${width}x${height}`;
        payload[capability.sizeParamKey] = sizeStr;

        if (capability.allowQuality && quality && quality !== 'auto' && quality !== 'none') {
            payload.quality = quality;
        }

        if (capability.allowStyle && style && style !== 'auto' && style !== 'none') {
            payload.style = style;
        }

        const steps = engineOpts.steps ?? activeProfile?.steps ?? globalConfig.steps;
        if (capability.allowSteps && typeof steps === 'number' && steps > 0) {
            payload.num_inference_steps = steps;
        }

        const cfgScale = engineOpts.cfgScale ?? activeProfile?.cfgScale ?? globalConfig.cfgScale;
        if (capability.allowCfgScale && typeof cfgScale === 'number' && cfgScale > 0) {
            payload.guidance_scale = cfgScale;
        }

        const seed = engineOpts.seed ?? activeProfile?.seed ?? globalConfig.seed;
        if (capability.allowSeed && typeof seed === 'number' && seed >= 0) {
            payload.seed = seed;
        }

        const negPrompt = request.negativePrompt || engineOpts.negativePrompt || activeProfile?.negativePrompt;
        if (negPrompt) {
            if (capability.allowNegativePrompt) {
                payload.negative_prompt = negPrompt;
            } else {
                this.logger.debug(`当前提供商 [${capability.name}] 不支持独立负向提示词，已忽略`);
            }
        }

        const extraBodyStr = engineOpts.extraBodyJson || activeProfile?.extraBodyJson;
        if (extraBodyStr) {
            try {
                const parsedExtra = JSON.parse(extraBodyStr);
                if (parsedExtra && typeof parsedExtra === 'object') {
                    Object.assign(payload, parsedExtra);
                }
            } catch (err) {
                this.logger.warn('解析附加请求参数 extraBodyJson 失败，已忽略:', err);
            }
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const providerHeadersStr = settings.customHeadersJson;
        if (providerHeadersStr) {
            try {
                const parsed = JSON.parse(providerHeadersStr);
                if (parsed && typeof parsed === 'object') {
                    Object.assign(headers, parsed);
                }
            } catch {}
        }

        const customHeadersStr = engineOpts.customHeadersJson || activeProfile?.customHeadersJson;
        if (customHeadersStr) {
            try {
                const parsedHeaders = JSON.parse(customHeadersStr);
                if (parsedHeaders && typeof parsedHeaders === 'object') {
                    Object.assign(headers, parsedHeaders);
                }
            } catch (err) {
                this.logger.warn('解析方案自定义请求头 customHeadersJson 失败，已忽略:', err);
            }
        }

        const res = await this.postJson<{
            data?: Array<{
                b64_json?: string;
                url?: string;
                revised_prompt?: string;
            }>;
            error?: { message?: string; type?: string; code?: string };
        }>(endpoint, payload, {
            signal,
            headers
        });

        if (res.error) {
            const errMsg = res.error.message || JSON.stringify(res.error);
            const errCode = (res.error.code || res.error.type || '').toLowerCase();
            if (
                errCode.includes('content_policy') ||
                errCode.includes('safety') ||
                errMsg.toLowerCase().includes('safety system') ||
                errMsg.toLowerCase().includes('content policy')
            ) {
                throw new DriverError(
                    DriverErrorType.INVALID_PARAMS,
                    `[内容安全审核拦截] 提示词触发了上游服务安全策略: ${errMsg}`
                );
            }
            throw new DriverError(
                DriverErrorType.BACKEND_ERROR,
                `OpenAI 生图接口返回错误: ${errMsg}`
            );
        }

        if (!res.data || res.data.length === 0) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'OpenAI 生图接口未返回图像数据');
        }

        this.checkCancelled();

        const images: Array<{ blob: Blob; format: string; metadata?: Record<string, unknown> }> = [];

        for (const item of res.data) {
            let blob: Blob;
            if (item.b64_json) {
                blob = base64ToBlob(item.b64_json, 'image/png');
            } else if (item.url) {
                try {
                    blob = await this.getBlob(item.url, { signal });
                } catch (urlErr: any) {
                    throw new DriverError(
                        DriverErrorType.NETWORK_ERROR,
                        `获取生成的图片 URL 失败 (${item.url}): ${urlErr?.message || urlErr}`
                    );
                }
            } else {
                continue;
            }

            images.push({
                blob,
                format: blob.type || 'image/png',
                metadata: {
                    model,
                    size: sizeStr,
                    provider: providerType,
                    revisedPrompt: item.revised_prompt,
                    seed: payload.seed,
                    steps: payload.num_inference_steps,
                    cfgScale: payload.guidance_scale
                }
            });
        }

        if (images.length === 0) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, '未从响应中解析出有效图片');
        }

        const totalDurationMs = Math.round(performance.now() - startTime);

        return {
            taskId: request.taskId,
            engine: this.id,
            images,
            durationMs: totalDurationMs
        };
    }

    public extractMetadata(request: GenerationRequest, result: GenerationResult): Record<string, unknown> {
        const globalConfig = (this._getConfig?.() as OpenAIEngineConfig | undefined) || DEFAULT_OPENAI_CONFIG;
        const options: OpenAIEngineOptions = {
            ...globalConfig,
            ...(request.engineOptions as OpenAIEngineOptions)
        };

        const firstImage = result.images[0];
        const revisedPrompt = firstImage?.metadata?.revisedPrompt;

        return {
            engine: this.id,
            providerType: options.providerType || 'openai-official',
            model: options.model,
            size: options.size || (options.width && options.height ? `${options.width}x${options.height}` : undefined),
            width: options.width,
            height: options.height,
            quality: options.quality,
            style: options.style,
            steps: options.steps,
            cfgScale: options.cfgScale,
            seed: options.seed,
            revisedPrompt
        };
    }

    public restoreParameters(metadata: ImageMetadata): Record<string, unknown> {
        const params = metadata.engineParams || {};
        return {
            model: params.model,
            size: params.size,
            width: params.width,
            height: params.height,
            quality: params.quality,
            style: params.style,
            steps: params.steps,
            cfgScale: params.cfgScale,
            seed: params.seed
        };
    }
}
