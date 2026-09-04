/**
 * @module domain/drivers/cloud-adapter
 * @description 云端多模态生图适配器实现 (Google Gemini Nano Banana · xAI Grok Imagine · OpenAI GPT Image)
 *
 * 核心特性：
 * 1. 统一多云模型协议：支持 Google generateContent 原生协议与 OpenAI /images/generations 协议；
 * 2. 自然语言意图保障：直接使用连贯场景描述，杜绝 SD 风格 Tag 堆叠与无关负向词污染；
 * 3. 支持多参考图传递：将 referenceImageBlobs 转化为 inlineData parts (Gemini 最高支持 14 张参考图)；
 * 4. 响应归一化：支持从 inlineData parts 与 b64_json 结构中提取标准 Blob；
 * 5. 安全与错误分类：支持服务端安全代理密钥隔离与速率限制、内容安全拦截归一化。
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

/** 云端生图专有配置选项 */
export interface CloudEngineOptions {
    provider?: 'google' | 'openai' | 'xai' | 'auto';
    model?: string;
    apiKey?: string;
    size?: string;
    width?: number;
    height?: number;
    quality?: string;
    style?: string;
    aspectRatio?: string;
    [key: string]: unknown;
}

export interface CloudAdapterOptions extends BaseDriverOptions {
    defaultConfig?: CloudEngineOptions;
}

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

    private readonly _defaultConfig: CloudEngineOptions;

    constructor(options: CloudAdapterOptions) {
        super(options);
        this._defaultConfig = options.defaultConfig || {};
    }

    public async ping(): Promise<boolean> {
        try {
            const provider = this.detectProvider(this._defaultConfig.model);
            if (provider === 'google') {
                return true;
            }
            await this.getJson('/models', { timeoutMs: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    public override async checkHealth(): Promise<HealthCheckResult> {
        const start = performance.now();
        const apiKey = this._defaultConfig.apiKey;
        if (!apiKey) {
            return {
                ok: false,
                latencyMs: 0,
                message: '未配置 API 密钥，请在设置中配置对应的 API Key'
            };
        }

        try {
            const provider = this.detectProvider(this._defaultConfig.model);
            if (provider === 'google') {
                return {
                    ok: true,
                    latencyMs: Math.round(performance.now() - start)
                };
            }

            const headers: Record<string, string> = {
                Authorization: `Bearer ${apiKey}`
            };
            await this.getJson('/models', { timeoutMs: 6000, headers });
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
            ...this._defaultConfig,
            ...(request.engineOptions as CloudEngineOptions)
        };

        const model = options.model || 'gemini-3.1-flash-image-preview';
        const provider = options.provider && options.provider !== 'auto'
            ? options.provider
            : this.detectProvider(model);

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
            ...this._defaultConfig,
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
        const apiKey = options.apiKey;
        const queryParam = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
        const endpoint = `/v1beta/models/${encodeURIComponent(model)}:generateContent${queryParam}`;

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

        const body = {
            contents: [
                {
                    role: 'user',
                    parts
                }
            ],
            generationConfig: {
                responseModalities: ['TEXT', 'IMAGE']
            }
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
        }>(endpoint, body, { signal });

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

        const size = options.size || (options.width && options.height ? `${options.width}x${options.height}` : '1024x1024');

        const body: Record<string, unknown> = {
            model,
            prompt: request.prompt,
            n: 1,
            size,
            response_format: 'b64_json'
        };

        if (options.quality) body.quality = options.quality;
        if (options.style) body.style = options.style;

        const res = await this.postJson<{
            data?: Array<{
                b64_json?: string;
                url?: string;
            }>;
            error?: { message?: string; type?: string; code?: string };
        }>('/images/generations', body, { signal, headers });

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
