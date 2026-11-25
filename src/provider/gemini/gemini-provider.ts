/**
 * Google Gemini 原生绘图服务提供方适配器 (GeminiProvider)。
 *
 * 基于 Gemini 原生 REST API 规范对接图像生成服务：
 * 1. 请求头携带 x-goog-api-key 鉴权；
 * 2. 请求 POST {baseUrl}/models/{model}:generateContent，使用 responseModalities: ["IMAGE"] 与 imageConfig；
 * 3. 若请求包含 sourceImage（重绘/参考图），自动编码为 inlineData 随文本提示词一并提交；
 * 4. 遇 SAFETY / IMAGE_SAFETY / RECITATION / PROHIBITED_CONTENT 等拦截直接抛出明确错误且不重试；
 * 5. 通过 GET {baseUrl}/models 发现支持 generateContent 的 Gemini 图像模型。
 */

import type {
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    ImageGenerationMetadata,
    GeminiProviderConfig,
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
    GEMINI_API_BASE,
    filterGeminiImageModels,
    resolveGeminiModelCapabilities,
    type GeminiModelListItem,
} from './gemini-models';
import {
    base64ToBlob,
    ensureValidImageBlob,
    HttpError,
    imageInputToBase64,
} from '../../util/http-client';
import { logger } from '../../util/logger';

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash-image';

const BLOCK_FINISH_REASONS = new Set([
    'SAFETY',
    'IMAGE_SAFETY',
    'RECITATION',
    'PROHIBITED_CONTENT',
    'BLOCKLIST',
    'SPII',
    'IMAGE_PROHIBITED_CONTENT',
]);

interface GeminiInlineDataPart {
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; data?: string };
    text?: string;
}

interface GeminiGenerateContentResponse {
    candidates?: Array<{
        content?: { parts?: GeminiInlineDataPart[] };
        finishReason?: string;
        finishMessage?: string;
    }>;
    promptFeedback?: {
        blockReason?: string;
        blockReasonMessage?: string;
    };
}

export class GeminiProvider extends BaseGenerationProvider {
    public readonly providerType: ProviderType = 'gemini';
    public readonly name: string = 'Google Gemini';
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

    private _getConfig(): GeminiProviderConfig | undefined {
        return this._settingsStore?.getProviderConfig<GeminiProviderConfig>('gemini');
    }

    public getServerUrl(): string {
        const config = this._getConfig();
        return this.normalizeUrl(config?.serverUrl || GEMINI_API_BASE);
    }

    /**
     * 解析规范化后的 Gemini API 基础路径。
     * 若未包含版本路由（如 /v1beta、/v1），默认追加 /v1beta。
     */
    public getApiBaseUrl(): string {
        const base = this.getServerUrl().replace(/\/models(?:\/.*)?$/i, '');
        if (/\/v[0-9]+(?:[a-z]*)?$/i.test(base)) {
            return base;
        }
        return `${base}/v1beta`;
    }

    private _buildHeaders(apiKey?: string): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (apiKey) {
            headers['x-goog-api-key'] = apiKey;
        }
        return headers;
    }

    public async checkHealth(signal?: AbortSignal): Promise<ProviderHealthResult> {
        const apiBase = this.getApiBaseUrl();
        const config = this._getConfig();
        const transport = this.getTransport();
        const probeUrl = `${apiBase}/models`;

        const pingResult = await this._httpClient.ping(probeUrl, {
            transport,
            signal,
            timeoutMs: 5000,
            headers: config?.apiKey ? { 'x-goog-api-key': config.apiKey } : undefined,
        });

        if (pingResult.ok) {
            return {
                status: 'ok',
                latencyMs: pingResult.latencyMs,
                message: `Gemini 原生服务响应正常 (${pingResult.latencyMs}ms)`,
            };
        }

        return this.formatPingFailure(pingResult, 'Gemini API Key 无效或无权访问');
    }

    public async fetchModels(signal?: AbortSignal, forceRefresh = false): Promise<string[]> {
        const apiBase = this.getApiBaseUrl();
        const config = this._getConfig();
        const transport = this.getTransport();
        const keyFingerprint = hashKeyFingerprint(config?.apiKey);
        const cacheKey = `${apiBase}::${transport}::${keyFingerprint}`;
        const now = Date.now();

        if (
            !forceRefresh &&
            this._modelsCache &&
            this._modelsCache.cacheKey === cacheKey &&
            now - this._modelsCache.timestamp < GeminiProvider.ASSET_CACHE_TTL_MS
        ) {
            return this._modelsCache.data;
        }

        const reqGen = this._assetCacheGen;
        const baseModelsUrl = `${apiBase}/models`;
        return this.shareInFlightAsset(
            () => this._inFlightModels,
            (slot) => {
                this._inFlightModels = slot;
            },
            cacheKey,
            forceRefresh,
            async (internalSignal) => {
                try {
                    const allModels: GeminiModelListItem[] = [];
                    let pageToken: string | undefined;
                    const MAX_PAGES = 5;

                    for (let page = 0; page < MAX_PAGES; page++) {
                        const params = new URLSearchParams({ pageSize: '1000' });
                        if (pageToken) {
                            params.set('pageToken', pageToken);
                        }
                        const pageUrl = `${baseModelsUrl}?${params.toString()}`;
                        const response = await this.fetchWithTransport(
                            pageUrl,
                            {
                                method: 'GET',
                                headers: this._buildHeaders(config?.apiKey),
                                timeoutMs: 10000,
                                signal: internalSignal,
                            },
                            transport
                        );

                        const data = (await response.json()) as {
                            models?: GeminiModelListItem[];
                            nextPageToken?: string;
                        };
                        if (Array.isArray(data.models)) {
                            allModels.push(...data.models);
                        }
                        pageToken =
                            typeof data.nextPageToken === 'string' && data.nextPageToken.trim()
                                ? data.nextPageToken.trim()
                                : undefined;
                        if (!pageToken) {
                            break;
                        }
                    }

                    const filtered = filterGeminiImageModels(allModels);
                    const latestKey = `${this.getApiBaseUrl()}::${this.getTransport()}::${hashKeyFingerprint(this._getConfig()?.apiKey)}`;
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
                        logger.debug(`[GeminiProvider] 服务端未实现 /models 接口 (HTTP ${err.status})，跳过模型枚举`);
                    } else {
                        logger.warn(`[GeminiProvider] 拉取模型列表 (${baseModelsUrl}) 失败:`, err);
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
        const apiBase = this.getApiBaseUrl();
        const transport = this.getTransport();
        const params = request.parameters ?? {};
        const maxTimeoutMs = this.getTimeoutMs();

        const drawingPreset = this.resolveDrawingPreset<DrawingPresetData>(params);
        const resolvedModel = resolveCloudModelId(
            params,
            drawingPreset,
            GEMINI_DEFAULT_MODEL
        ).replace(/^models\//, '');
        const capabilities = resolveGeminiModelCapabilities(resolvedModel);

        const resolvedAspectRatio =
            (typeof params.aspectRatio === 'string' && params.aspectRatio.trim()) ||
            (typeof drawingPreset?.aspectRatio === 'string' && drawingPreset.aspectRatio.trim()) ||
            '1:1';
        const isAutoAspectRatio = resolvedAspectRatio.toLowerCase() === 'auto';

        const rawImageSize =
            (typeof params.imageSize === 'string' && params.imageSize.trim()) ||
            (typeof drawingPreset?.imageSize === 'string' && drawingPreset.imageSize.trim()) ||
            undefined;
        const isAutoImageSize = Boolean(rawImageSize && rawImageSize.toLowerCase() === 'auto');
        let resolvedImageSize: string | undefined;
        let metadataImageSize: string | undefined;
        if (capabilities.supportsImageSize) {
            if (isAutoImageSize) {
                resolvedImageSize = undefined;
                metadataImageSize = 'auto';
            } else if (rawImageSize && capabilities.supportedImageSizes.includes(rawImageSize)) {
                resolvedImageSize = rawImageSize;
                metadataImageSize = rawImageSize;
            } else if (rawImageSize && capabilities.supportedImageSizes.includes('1K')) {
                resolvedImageSize = '1K';
                metadataImageSize = '1K';
            } else if (!capabilities.allowsDefaultEmptyImageSize) {
                resolvedImageSize = capabilities.supportedImageSizes.includes('1K')
                    ? '1K'
                    : capabilities.supportedImageSizes[0];
                metadataImageSize = resolvedImageSize;
            }
        }

        // 1. 构建 contents[0].parts（含可选的参考底图 inlineData）
        const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
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
            parts.push({
                inlineData: {
                    mimeType,
                    data: b64,
                },
            });
        }

        const imageConfig: Record<string, unknown> = {};
        if (!isAutoAspectRatio) {
            imageConfig['aspectRatio'] = resolvedAspectRatio;
        }
        if (resolvedImageSize) {
            imageConfig['imageSize'] = resolvedImageSize;
        }

        const generationConfig: Record<string, unknown> = {
            responseModalities: ['IMAGE'],
        };
        if (Object.keys(imageConfig).length > 0) {
            generationConfig['imageConfig'] = imageConfig;
        }

        const requestBody: Record<string, unknown> = {
            contents: [{ parts }],
            generationConfig,
        };

        // 2. 可选自定义 JSON 扩展合并（保护 generationConfig 与 imageConfig 嵌套结构不被整块覆盖）
        const customObj = parseCustomBodyObject(
            params.customBodyJson ?? drawingPreset?.customBodyJson,
            '[GeminiProvider]'
        );
        if (customObj) {
            const { generationConfig: customGenCfg, ...restCustom } = customObj;
            Object.assign(requestBody, restCustom);
            if (
                customGenCfg &&
                typeof customGenCfg === 'object' &&
                !Array.isArray(customGenCfg)
            ) {
                const baseGenCfg = requestBody['generationConfig'] as Record<string, unknown>;
                const { imageConfig: customImgCfg, ...restGenCfg } = customGenCfg as Record<
                    string,
                    unknown
                >;
                Object.assign(baseGenCfg, restGenCfg);
                if (
                    customImgCfg &&
                    typeof customImgCfg === 'object' &&
                    !Array.isArray(customImgCfg)
                ) {
                    const baseImgCfg =
                        (baseGenCfg['imageConfig'] as Record<string, unknown> | undefined) ?? {};
                    baseGenCfg['imageConfig'] = baseImgCfg;
                    Object.assign(baseImgCfg, customImgCfg);
                }
            }
        }

        // 3. 发起原生 generateContent 请求
        const generateUrl = `${apiBase}/models/${encodeURIComponent(resolvedModel)}:generateContent`;
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
                    'Gemini 请求被限速，请稍后重试',
                    'Gemini 原生生图失败'
                );
            }
            throw err;
        }

        const payload = (await response.json()) as GeminiGenerateContentResponse;

        if (payload.promptFeedback?.blockReason) {
            const msg = payload.promptFeedback.blockReasonMessage
                ? ` (${payload.promptFeedback.blockReasonMessage})`
                : '';
            throw new Error(
                `Gemini 请求被安全策略拦截: ${payload.promptFeedback.blockReason}${msg}`
            );
        }

        const candidate = payload.candidates?.[0];
        if (!candidate) {
            throw new Error('Gemini 响应中未包含任何候选项 (candidates 为空)');
        }

        const responseParts = candidate.content?.parts ?? [];
        let inlineB64: string | undefined;
        let inlineMime = 'image/png';
        for (const part of responseParts) {
            const camel = part.inlineData;
            const snake = part.inline_data;
            if (camel?.data) {
                inlineB64 = camel.data;
                inlineMime = camel.mimeType || 'image/png';
                break;
            }
            if (snake?.data) {
                inlineB64 = snake.data;
                inlineMime = snake.mime_type || 'image/png';
                break;
            }
        }

        if (!inlineB64) {
            const reason = candidate.finishReason;
            if (reason && BLOCK_FINISH_REASONS.has(reason)) {
                const detail = candidate.finishMessage ? ` (${candidate.finishMessage})` : '';
                throw new Error(`Gemini 生图被拦截 (finishReason: ${reason})${detail}`);
            }
            const textHint = responseParts
                .map((p) => p.text)
                .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
                .join(' ')
                .slice(0, 160);
            throw new Error(
                `Gemini 未返回图像数据 (finishReason: ${reason || 'unknown'})${textHint ? `: ${textHint}` : ''}`
            );
        }

        let blob = base64ToBlob(inlineB64, inlineMime);
        blob = await ensureValidImageBlob(blob, 'Gemini 原生服务');

        const durationMs = Date.now() - startTime;
        const metadata: ImageGenerationMetadata = {
            prompt: request.prompt,
            negativePrompt: undefined,
            engine: 'gemini',
            mode: request.sourceImage ? 'inpaint' : 'txt2img',
            durationMs,
            baseModel: resolvedModel,
            aspectRatio: resolvedAspectRatio,
            imageSize: metadataImageSize,
        };

        return { blob, metadata };
    }
}
