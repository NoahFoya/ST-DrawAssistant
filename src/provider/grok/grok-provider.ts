/**
 * xAI Grok 原生绘图服务提供方适配器 (GrokProvider)。
 *
 * 基于 xAI 原生图像接口规范对接图像生成与编辑服务：
 * 1. 请求头携带 Authorization: Bearer 鉴权；
 * 2. 文生图请求 POST {baseUrl}/images/generations，按模型能力附带 aspect_ratio 与 resolution；
 * 3. 若存在 sourceImage（重绘/编辑底图），路由至 POST {baseUrl}/images/edits；
 * 4. 不发送 OpenAI 专属的 size / quality / style 字段，避免上游校验拒绝；
 * 5. 通过 GET {baseUrl}/models 发现 Grok 图像模型。
 */

import type {
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    ImageGenerationMetadata,
    GrokProviderConfig,
    DrawingPresetData,
} from '@types';
import {
    BaseGenerationProvider,
    type BaseProviderOptions,
    type InFlightAssetSlot,
} from '../base-provider';
import {
    hashKeyFingerprint,
    parseCustomBodyObject,
    resolveCloudModelId,
    toCloudGenerationError,
} from '../cloud-provider-utils';
import {
    GROK_API_BASE,
    filterGrokImageModels,
    resolveGrokModelCapabilities,
} from '../../domain';
import {
    base64ToBlob,
    ensureValidImageBlob,
    HttpError,
    imageInputToBase64,
} from '../../util/http-client';
import { logger } from '../../util/logger';

const GROK_DEFAULT_MODEL = 'grok-imagine-image';

export class GrokProvider extends BaseGenerationProvider {
    public readonly providerType: ProviderType = 'grok';
    public readonly name: string = 'xAI Grok';
    public override readonly supportsNegativePrompt = false;
    public override readonly supportsHealthPolling = false;

    private static readonly ASSET_CACHE_TTL_MS = 60_000;

    private _modelsCache: { data: string[]; timestamp: number; cacheKey: string } | null = null;
    private _inFlightModels?: InFlightAssetSlot<string[]>;
    private _assetCacheGen = 0;

    public constructor(options: BaseProviderOptions = {}) {
        super(options);
    }

    public override clearAssetCache(): void {
        this._assetCacheGen += 1;
        this._modelsCache = null;
        if (this._inFlightModels) {
            const slot = this._inFlightModels;
            this._inFlightModels = undefined;
            slot.controller.abort(new DOMException('Asset cache cleared', 'AbortError'));
        }
    }

    private _getConfig(): GrokProviderConfig | undefined {
        return this._settingsStore?.getProviderConfig<GrokProviderConfig>('grok');
    }

    public getServerUrl(): string {
        const config = this._getConfig();
        return this.normalizeUrl(config?.serverUrl || GROK_API_BASE);
    }

    public getV1BaseUrl(): string {
        const base = this.getServerUrl().replace(/\/images\/(?:generations|edits)$/i, '');
        if (/\/v[0-9]+(?:[a-z]*)?$/i.test(base)) {
            return base;
        }
        return `${base}/v1`;
    }

    private _buildHeaders(apiKey?: string): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        return headers;
    }

    public async checkHealth(signal?: AbortSignal): Promise<ProviderHealthResult> {
        const v1Base = this.getV1BaseUrl();
        const config = this._getConfig();
        const transport = this.getTransport();
        const probeUrl = `${v1Base}/models`;

        const pingResult = await this._httpClient.ping(probeUrl, {
            transport,
            signal,
            timeoutMs: 5000,
            headers: config?.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
        });

        if (pingResult.ok) {
            return {
                status: 'ok',
                latencyMs: pingResult.latencyMs,
                message: `xAI Grok 服务响应正常 (${pingResult.latencyMs}ms)`,
            };
        }

        return this.formatPingFailure(pingResult, 'xAI Grok API Key 无效或无权访问');
    }

    public async fetchModels(signal?: AbortSignal, forceRefresh = false): Promise<string[]> {
        const v1Base = this.getV1BaseUrl();
        const config = this._getConfig();
        const transport = this.getTransport();
        const keyFingerprint = hashKeyFingerprint(config?.apiKey);
        const cacheKey = `${v1Base}::${transport}::${keyFingerprint}`;
        const now = Date.now();

        if (
            !forceRefresh &&
            this._modelsCache &&
            this._modelsCache.cacheKey === cacheKey &&
            now - this._modelsCache.timestamp < GrokProvider.ASSET_CACHE_TTL_MS
        ) {
            return this._modelsCache.data;
        }

        const reqGen = this._assetCacheGen;
        const url = `${v1Base}/models`;
        return this.shareInFlightAsset(
            () => this._inFlightModels,
            (slot) => {
                this._inFlightModels = slot;
            },
            cacheKey,
            forceRefresh,
            async (internalSignal) => {
                try {
                    const response = await this.fetchWithTransport(
                        url,
                        {
                            method: 'GET',
                            headers: this._buildHeaders(config?.apiKey),
                            timeoutMs: 10000,
                            signal: internalSignal,
                        },
                        transport
                    );

                    const data = (await response.json()) as
                        | { data?: Array<{ id?: string }> }
                        | Array<{ id?: string }>;
                    const rawModels = Array.isArray(data) ? data : data.data ?? [];
                    const filtered = filterGrokImageModels(rawModels);
                    const latestKey = `${this.getV1BaseUrl()}::${this.getTransport()}::${hashKeyFingerprint(this._getConfig()?.apiKey)}`;
                    if (reqGen === this._assetCacheGen && latestKey === cacheKey) {
                        this._modelsCache = { data: filtered, timestamp: Date.now(), cacheKey };
                    }
                    return filtered;
                } catch (err: unknown) {
                    if (
                        internalSignal.aborted ||
                        (err instanceof DOMException && err.name === 'AbortError')
                    ) {
                        throw err;
                    }
                    this.rethrowTransportDiagnostic(err);
                    if (err instanceof HttpError && (err.status === 404 || err.status === 405 || err.status === 501)) {
                        logger.debug(`[GrokProvider] 服务端未实现 /models 接口 (HTTP ${err.status})，跳过模型枚举`);
                    } else {
                        logger.warn(`[GrokProvider] 拉取模型列表 (${url}) 失败:`, err);
                    }
                    return [];
                }
            },
            signal
        );
    }

    public async generate(
        request: GenerationRequest,
        signal?: AbortSignal
    ): Promise<GenerationResult> {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        const startTime = Date.now();
        const config = this._getConfig();
        const v1Base = this.getV1BaseUrl();
        const transport = this.getTransport();
        const params = request.parameters ?? {};
        const maxTimeoutMs = this.getTimeoutMs();

        const drawingPreset = this.resolveDrawingPreset<DrawingPresetData>(params);
        const resolvedModel = resolveCloudModelId(params, drawingPreset, GROK_DEFAULT_MODEL);
        const capabilities = resolveGrokModelCapabilities(resolvedModel);

        const resolvedAspectRatio = capabilities.supportsAspectRatio
            ? (typeof params.aspectRatio === 'string' && params.aspectRatio.trim()) ||
              (typeof drawingPreset?.aspectRatio === 'string' &&
                  drawingPreset.aspectRatio.trim()) ||
              '1:1'
            : undefined;

        const resolvedResolution = capabilities.supportsResolution
            ? (typeof params.resolution === 'string' && params.resolution.trim()) ||
              (typeof drawingPreset?.resolution === 'string' &&
                  drawingPreset.resolution.trim()) ||
              '1k'
            : undefined;

        const isEdit = Boolean(request.sourceImage);
        const requestBody: Record<string, unknown> = {
            model: resolvedModel,
            prompt: request.prompt,
            n: 1,
            response_format: 'b64_json',
        };

        if (resolvedAspectRatio) {
            requestBody['aspect_ratio'] = resolvedAspectRatio;
        }
        if (resolvedResolution) {
            requestBody['resolution'] = resolvedResolution;
        }

        if (request.sourceImage) {
            const b64 = await imageInputToBase64(request.sourceImage, {
                signal,
                timeoutMs: maxTimeoutMs,
                transport,
            });
            const mimeType =
                request.sourceImage instanceof Blob && request.sourceImage.type
                    ? request.sourceImage.type
                    : 'image/png';
            requestBody['image'] = {
                url: `data:${mimeType};base64,${b64}`,
                type: 'image_url',
            };
        }

        const customObj = parseCustomBodyObject(
            params.customBodyJson ?? drawingPreset?.customBodyJson,
            '[GrokProvider]'
        );
        if (customObj) {
            Object.assign(requestBody, customObj);
            requestBody['prompt'] = request.prompt;
            requestBody['n'] = 1;
        }

        const generateUrl = isEdit
            ? `${v1Base}/images/edits`
            : `${v1Base}/images/generations`;

        let response: Response;
        try {
            response = await this.fetchWithTransport(
                generateUrl,
                {
                    method: 'POST',
                    headers: this._buildHeaders(config?.apiKey),
                    body: JSON.stringify(requestBody),
                    timeoutMs: maxTimeoutMs,
                    signal,
                    retries: 0,
                },
                transport
            );
        } catch (err: unknown) {
            if (err instanceof HttpError) {
                throw toCloudGenerationError(
                    err,
                    'xAI Grok 请求被限速，请稍后重试',
                    'xAI Grok 原生生图失败'
                );
            }
            throw err;
        }

        const responseData = (await response.json()) as {
            data?: Array<{ b64_json?: string; url?: string }>;
        };
        const firstImage = responseData.data?.[0];
        if (!firstImage) {
            throw new Error('xAI Grok 返回结果中未包含图像数据');
        }

        let blob: Blob;
        if (typeof firstImage.b64_json === 'string' && firstImage.b64_json.trim()) {
            blob = base64ToBlob(firstImage.b64_json, 'image/png');
        } else if (firstImage.url) {
            let imgResponse: Response;
            try {
                imgResponse = await this.fetchWithTransport(
                    firstImage.url,
                    { method: 'GET', timeoutMs: maxTimeoutMs, signal, retries: 0 },
                    transport
                );
            } catch (err: unknown) {
                if (err instanceof HttpError) {
                    throw this.formatProviderHttpError(err, '图像 URL 下载失败');
                }
                throw err;
            }
            blob = await imgResponse.blob();
        } else {
            throw new Error('xAI Grok 响应中不含有效图像字段（b64_json 或 url）');
        }

        blob = await ensureValidImageBlob(blob, 'xAI Grok 服务');

        const durationMs = Date.now() - startTime;
        const metadata: ImageGenerationMetadata = {
            prompt: request.prompt,
            negativePrompt: undefined,
            engine: 'grok',
            mode: isEdit ? 'inpaint' : 'txt2img',
            durationMs,
            baseModel: resolvedModel,
            aspectRatio: resolvedAspectRatio,
            resolution: resolvedResolution,
        };

        return { blob, metadata };
    }
}
