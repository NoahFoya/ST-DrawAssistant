/**
 * @module domain/drivers/cloud-adapter
 * @description 云端多模态生图适配器 (Google Gemini · xAI Grok · OpenAI GPT Image)
 *
 * 1. 支持 Google generateContent 与 OpenAI /images/generations 接口协议；
 * 2. 支持通过 referenceImageBlobs 传递多张参考图；
 * 3. 将接口返回的图片数据解析为统一的 Blob 格式；
 * 4. 统一处理接口报错、限流与审核拦截状态。
 */

import { BaseDriver, BaseDriverOptions } from './base-driver';
import { blobToBase64, base64ToBlob } from '../../../common/utils/binary';
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
} from '../types';

/** 云端多模态配置接口 */
export interface CloudEngineConfig {
    provider: 'google' | 'openai' | 'xai' | 'auto';
    proxyUrl: string;
    apiKey: string;
    model: string;
    size?: string;
    width: number;
    height: number;
    quality?: string;
    style?: string;
    aspectRatio?: string;
    [key: string]: unknown;
}

/** 云端多模态默认配置 */
export const DEFAULT_CLOUD_CONFIG: CloudEngineConfig = {
    provider: 'openai',
    proxyUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'dall-e-3',
    width: 1024,
    height: 1024,
    size: '1024x1024',
    quality: 'standard',
    style: 'vivid'
};

/** 云端生图专有配置选项 */
export interface CloudEngineOptions extends Partial<CloudEngineConfig> {}

export interface CloudAdapterOptions extends BaseDriverOptions {}

export class CloudAdapter extends BaseDriver {
    public readonly id = 'cloud';
    public readonly name = 'Cloud Multimodal';
    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: true,
        lora: false,
        progressWebSocket: false,
        interrupt: false,
        syntaxType: 'natural'
    };


    constructor(options: CloudAdapterOptions) {
        super(options);
    }

    /**
     * 根据服务通道获取基准 URL
     * 优先遵循用户显式指定的代理或服务器地址，其次选用对应通道的官方默认端点
     */
    public getProviderBaseUrl(provider: 'google' | 'openai' | 'xai', options: CloudEngineOptions = {}): string {
        const configuredUrl = (options.proxyUrl as string) || (options.serverUrl as string);
        if (configuredUrl) {
            return configuredUrl.replace(/\/+$/, '');
        }

        const base = this.getBaseUrl();
        if (base && base !== 'https://generativelanguage.googleapis.com') {
            return base;
        }

        switch (provider) {
            case 'openai':
                return 'https://api.openai.com';
            case 'xai':
                return 'https://api.x.ai';
            case 'google':
            default:
                return 'https://generativelanguage.googleapis.com';
        }
    }


    public override async checkHealth(): Promise<HealthCheckResult> {
        const start = performance.now();
        const cfg = (this._getConfig?.() as CloudEngineOptions | undefined) || {};
        const apiKey = cfg.apiKey as string | undefined;

        try {
            const provider = this.detectProvider(cfg.model as string | undefined);
            const baseUrl = this.getProviderBaseUrl(provider, cfg);
            const cleanBase = baseUrl.replace(/\/+$/, '');

            if (provider === 'google') {
                const googleEndpoint = `${cleanBase}/v1beta/models?pageSize=1`;
                const headers: Record<string, string> = {};
                if (apiKey) {
                    headers['x-goog-api-key'] = apiKey;
                }
                await this.network.fetchExternal(googleEndpoint, {
                    timeoutMs: 6000,
                    headers,
                    serviceType: 'gemini'
                });
                return {
                    ok: true,
                    latencyMs: Math.round(performance.now() - start)
                };
            }

            const modelsEndpoint = cleanBase.endsWith('/v1') ? `${cleanBase}/models` : `${cleanBase}/v1/models`;
            const headers: Record<string, string> = {};
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
            await this.network.fetchExternal(modelsEndpoint, {
                timeoutMs: 6000,
                headers,
                serviceType: provider === 'openai' ? 'openai' : 'grok'
            });
            return {
                ok: true,
                latencyMs: Math.round(performance.now() - start)
            };
        } catch (err: any) {
            const latencyMs = Math.round(performance.now() - start);
            return {
                ok: false,
                latencyMs,
                statusCode: err instanceof DriverError ? err.statusCode : undefined,
                message: err?.message || '连接云端生图接口失败'
            };
        }
    }

    protected override async doSyncAssets(): Promise<ProviderAssetCatalog> {
        return {
            models: [
                'gemini-3.1-flash-image-preview',
                'gemini-3-pro-image-preview',
                'gemini-2.5-flash-image',
                'grok-imagine-image',
                'grok-imagine-image-quality',
                'gpt-image-2',
                'gpt-image-1',
                'gpt-image-1-mini'
            ]
        };
    }

    protected override async doGenerate(
        request: GenerationRequest,
        signal?: AbortSignal,
        _onProgress?: ProgressCallback
    ): Promise<GenerationResult> {
        const startTime = performance.now();
        const options: CloudEngineOptions = {
            ...(this._getConfig?.() as CloudEngineOptions | undefined),
            ...(request.engineOptions as CloudEngineOptions)
        };

        const model = options.model || 'gemini-3.1-flash-image-preview';
        const provider = options.provider && options.provider !== 'auto'
            ? options.provider
            : this.detectProvider(model);

        // 云端多模态模型基于自然语言理解，不支持独立的负向提示词，直接忽略 negativePrompt 避免影响生成效果
        if (request.negativePrompt) {
            this.logger.debug('云端多模态模型不支持独立负向提示词，已忽略');
        }

        let imageBlobs: Blob[];

        if (provider === 'google') {
            imageBlobs = await this.generateWithGoogleGemini(model, request, options, signal);
        } else {
            imageBlobs = await this.generateWithOpenAICompatible(model, request, options, signal);
        }

        this.checkCancelled();

        if (!imageBlobs || imageBlobs.length === 0) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, '云端生图接口未返回任何有效图像数据');
        }

        const totalDurationMs = Math.round(performance.now() - startTime);

        return {
            taskId: request.taskId,
            engine: this.id,
            images: imageBlobs.map((blob) => ({
                blob,
                format: blob.type || 'image/png',
                metadata: {
                    model,
                    provider
                }
            })),
            durationMs: totalDurationMs
        };
    }

    public extractMetadata(request: GenerationRequest, _result: GenerationResult): Record<string, unknown> {
        const options: CloudEngineOptions = {
            ...(this._getConfig?.() as CloudEngineOptions | undefined),
            ...(request.engineOptions as CloudEngineOptions)
        };
        return {
            engine: this.id,
            model: options.model,
            provider: options.provider,
            size: options.size,
            quality: options.quality,
            style: options.style,
            aspectRatio: options.aspectRatio
        };
    }

    public restoreParameters(metadata: ImageMetadata): Record<string, unknown> {
        const params = metadata.engineParams || {};
        return {
            model: params.model,
            provider: params.provider,
            size: params.size,
            quality: params.quality,
            style: params.style,
            aspectRatio: params.aspectRatio
        };
    }

    /** 检测给定模型标识所属的协议通道 */
    private detectProvider(model?: string): 'google' | 'openai' | 'xai' {
        if (!model) return 'google';
        const lower = model.toLowerCase();
        if (lower.includes('gemini') || lower.includes('banana')) {
            return 'google';
        }
        if (lower.includes('grok')) {
            return 'xai';
        }
        return 'openai';
    }

    /**
     * Google Gemini (Nano Banana) 原生协议生成
     */
    private async generateWithGoogleGemini(
        model: string,
        request: GenerationRequest,
        options: CloudEngineOptions,
        signal?: AbortSignal
    ): Promise<Blob[]> {
        const baseUrl = this.getProviderBaseUrl('google', options);
        const apiKey = options.apiKey;
        const queryParam = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
        const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent${queryParam}`;

        const parts: Array<Record<string, unknown>> = [
            { text: request.prompt }
        ];

        // 注入参考图像 (最高支持 14 张)
        const refBlobs = request.imageInputs?.referenceImageBlobs || [];
        if (request.imageInputs?.initImageBlob) {
            refBlobs.unshift(request.imageInputs.initImageBlob);
        }

        for (const blob of refBlobs.slice(0, 14)) {
            const b64 = await blobToBase64(blob);
            parts.push({
                inlineData: {
                    mimeType: blob.type || 'image/png',
                    data: b64
                }
            });
        }

        const generationConfig: Record<string, unknown> = {
            responseModalities: ['TEXT', 'IMAGE']
        };
        if (options.aspectRatio) {
            generationConfig.aspectRatio = options.aspectRatio;
        }

        const body = {
            contents: [
                {
                    role: 'user',
                    parts
                }
            ],
            generationConfig
        };

        const res = await this.postJson<{
            candidates?: Array<{
                content?: {
                    parts?: Array<{
                        text?: string;
                        inlineData?: { mimeType?: string; data?: string };
                        inline_data?: { mime_type?: string; data?: string };
                    }>;
                };
            }>;
            error?: { message?: string; code?: number };
        }>(endpoint, body, { signal, serviceType: 'gemini' });

        if (res.error) {
            throw new DriverError(
                DriverErrorType.BACKEND_ERROR,
                `Gemini 接口报错: ${res.error.message || JSON.stringify(res.error)}`,
                res.error.code
            );
        }

        const candidateParts = res.candidates?.[0]?.content?.parts || [];
        const blobs: Blob[] = [];

        for (const part of candidateParts) {
            const inlineObj = part.inlineData || part.inline_data;
            if (inlineObj && inlineObj.data) {
                const mime = ('mimeType' in inlineObj && inlineObj.mimeType)
                    ? inlineObj.mimeType
                    : ('mime_type' in inlineObj && inlineObj.mime_type)
                        ? inlineObj.mime_type
                        : 'image/png';
                blobs.push(base64ToBlob(inlineObj.data, mime));
            }
        }

        if (blobs.length === 0) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'Gemini 响应未包含图像数据部分');
        }

        return blobs;
    }

    /**
     * OpenAI / xAI Grok 兼容协议生成
     */
    private async generateWithOpenAICompatible(
        model: string,
        request: GenerationRequest,
        options: CloudEngineOptions,
        signal?: AbortSignal
    ): Promise<Blob[]> {
        const apiKey = options.apiKey;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const provider = this.detectProvider(model);
        const baseUrl = this.getProviderBaseUrl(provider, options);
        const cleanBase = baseUrl.replace(/\/+$/, '');
        const endpoint = cleanBase.endsWith('/v1')
            ? `${cleanBase}/images/generations`
            : `${cleanBase}/v1/images/generations`;

        let body: Record<string, unknown>;

        if (provider === 'xai') {
            // xAI Grok Imagine 原生支持 aspect_ratio 与 resolution
            let aspectRatio = options.aspectRatio;
            if (!aspectRatio && options.width && options.height) {
                const ratio = options.width / options.height;
                if (Math.abs(ratio - 1) < 0.05) aspectRatio = '1:1';
                else if (Math.abs(ratio - 16 / 9) < 0.05) aspectRatio = '16:9';
                else if (Math.abs(ratio - 9 / 16) < 0.05) aspectRatio = '9:16';
                else if (Math.abs(ratio - 4 / 3) < 0.05) aspectRatio = '4:3';
                else if (Math.abs(ratio - 3 / 4) < 0.05) aspectRatio = '3:4';
            }

            body = {
                model,
                prompt: request.prompt,
                n: 1,
                aspect_ratio: aspectRatio || '1:1',
                response_format: 'b64_json'
            };
            if (options.quality) {
                body.resolution = (options.quality === 'high' || options.quality === '2k') ? '2k' : '1k';
            }
        } else {
            const size = options.size || (options.width && options.height ? `${options.width}x${options.height}` : '1024x1024');
            body = {
                model,
                prompt: request.prompt,
                n: 1,
                size,
                response_format: 'b64_json'
            };
            if (options.quality) body.quality = options.quality;
            if (options.style) body.style = options.style;
        }

        const res = await this.postJson<{
            data?: Array<{
                b64_json?: string;
                url?: string;
            }>;
            error?: { message?: string; type?: string; code?: string };
        }>(endpoint, body, {
            signal,
            headers,
            serviceType: provider === 'xai' ? 'grok' : 'openai'
        });

        if (res.error) {
            throw new DriverError(
                DriverErrorType.BACKEND_ERROR,
                `图像接口报错: ${res.error.message || JSON.stringify(res.error)}`
            );
        }

        if (!res.data || res.data.length === 0) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, '图像接口返回空数据');
        }

        const blobs: Blob[] = [];
        for (const item of res.data) {
            if (item.b64_json) {
                blobs.push(base64ToBlob(item.b64_json, 'image/png'));
            } else if (item.url) {
                const blob = await this.getBlob(item.url, { signal });
                blobs.push(blob);
            }
        }

        return blobs;
    }
}
