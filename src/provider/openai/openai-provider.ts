/**
 * OpenAI 兼容绘图服务提供方适配器 (OpenAIProvider)。
 *
 * 基于 OpenAI /v1/images/generations 规范对接图像生成服务：
 * 1. 请求头携带 Authorization: Bearer 鉴权；
 * 2. 仅发送正向提示词（该接口不支持 negative_prompt）；
 * 3. 支持解析 b64_json 与下载 url 图片数据；
 * 4. 通过 GET ${v1Base}/models 发现图像相关模型。
 */

import type {
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    ImageGenerationMetadata,
    OpenAIProviderConfig,
    DrawingPresetData,
} from '@types';
import {
    BaseGenerationProvider,
    type BaseProviderOptions,
    type InFlightAssetSlot,
} from '../base-provider';
import { base64ToBlob, ensureValidImageBlob, HttpError } from '../../util/http-client';
import {
    extractHttpErrorMessage,
    hashKeyFingerprint,
    parseCustomBodyObject,
    resolveCloudModelId,
} from '../cloud-provider-utils';
import { resolveOpenAIModelCapabilities } from './openai-models';

/**
 * 将 width/height 组装为 OpenAI images/generations 的 size 字符串。
 *
 * @remarks
 * 仅在 width 和 height 均有效时返回 "WxH" 格式字符串。
 * 为空时由调用方省略该字段，由后端按其默认值处理。
 *
 * @param width 图像宽度像素
 * @param height 图像高度像素
 * @returns 形如 "1024x1024" 的尺寸字符串，无效时返回 undefined
 */
export function buildSizeString(width?: number, height?: number): string | undefined {
    if (width && height && width > 0 && height > 0) {
        return `${width}x${height}`;
    }
    return undefined;
}

/**
 * 从 GET ${v1Base}/models 响应中过滤图像相关模型标识。
 *
 * @remarks
 * 按常见图像模型 ID 关键词过滤（不区分大小写）。
 * 不支持 /v1/models 的后端返回空数组，不报错。
 *
 * @param models 服务端模型列表条目
 * @returns 过滤并规整后的图像模型标识数组
 */
export function filterImageModels(models: Array<{ id?: string } | null | undefined>): string[] {
    const IMAGE_KEYWORDS = ['image', 'dall-e', 'dalle', 'flux', 'kolors', 'stable-diffusion'];
    return models
        .filter((m): m is { id: string } => typeof m?.id === 'string' && m.id.trim().length > 0)
        .map((m) => m.id.trim())
        .filter((id) =>
            IMAGE_KEYWORDS.some((kw) => id.toLowerCase().includes(kw))
        );
}

/**
 * 解析 OpenAI 兼容服务的目标模型标识符。
 */
export function resolveOpenAIModel(
    parameters?: Record<string, unknown>,
    preset?: DrawingPresetData
): string {
    return resolveCloudModelId(parameters, preset, 'dall-e-3');
}

/**
 * OpenAI 兼容绘图服务提供方实现类。
 */
export class OpenAIProvider extends BaseGenerationProvider {
    public readonly providerType: ProviderType = 'openai';
    public readonly name: string = 'OpenAI Compatible';
    public override readonly supportsNegativePrompt = false;
    public override readonly supportsHealthPolling = false;

    /** 资产短时内存缓存过期时间 (60 秒) */
    private static readonly ASSET_CACHE_TTL_MS = 60_000;

    private _modelsCache: { data: string[]; timestamp: number; cacheKey: string } | null = null;
    private _inFlightModels?: InFlightAssetSlot<string[]>;
    private _assetCacheGen = 0;

    public constructor(options: BaseProviderOptions = {}) {
        super(options);
    }

    /**
     * 清空当前提供方内存中的资产缓存并中止在途资产拉取请求。
     */
    public clearAssetCache(): void {
        this._assetCacheGen += 1;
        this._modelsCache = null;
        if (this._inFlightModels) {
            const slot = this._inFlightModels;
            this._inFlightModels = undefined;
            slot.controller.abort(new DOMException('Asset cache cleared', 'AbortError'));
        }
    }

    private _getConfig(): OpenAIProviderConfig | undefined {
        return this._settingsStore?.getProviderConfig<OpenAIProviderConfig>('openai');
    }

    /**
     * 获取 OpenAI 兼容服务基础地址。
     *
     * @remarks
     * 读取配置中心的 OpenAI 兼容服务地址，未配置时缺省为默认公共端点 (https://api.openai.com)。
     * 自动规整末尾斜杠以确保 URL 拼接的一致性。
     */
    public getServerUrl(): string {
        const config = this._getConfig();
        if (config?.serverUrl) {
            return this.normalizeUrl(config.serverUrl);
        }
        return 'https://api.openai.com';
    }

    /**
     * 获取规范化后的 OpenAI 兼容服务基础地址。
     *
     * @remarks
     * 规整用户输入服务地址：
     * - 若输入已包含版本路由（如 "https://api.openai.com/v1"），规整后直接返回；
     * - 若未包含版本路由（如 "https://api.openai.com"），自动追加 "/v1"；
     * 确保下游各接口拼接时不会发生双重 "/v1/v1" 导致 404 故障。
     */
    public getV1BaseUrl(): string {
        const base = this.getServerUrl().replace(/\/images\/generations$/i, '');
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

    /**
     * 检查 OpenAI 兼容服务连通性。
     *
     * @remarks
     * 请求 GET ${v1Base}/models 验证服务可达性；该端点在大多数兼容实现中均存在。
     *
     * @param signal 中止信号
     */
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
                message: `OpenAI 兼容服务响应正常 (${pingResult.latencyMs}ms)`,
            };
        }

        return {
            status: 'error',
            latencyMs: pingResult.latencyMs,
            message: pingResult.error || `连接失败 (HTTP ${pingResult.status ?? 'unknown'})`,
        };
    }

    /**
     * 获取 OpenAI 兼容服务的图像相关模型列表。
     *
     * @remarks
     * 请求 GET ${v1Base}/models，过滤 id 含图像关键词的条目。
     * 支持并发请求复用与 60 秒短时内存缓存，避免重复请求。
     * 若后端不支持该端点则静默返回空数组。
     *
     * @param signal 中止信号
     * @param forceRefresh 是否强制忽略缓存拉取最新数据
     * @returns 图像模型标识数组
     */
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
            now - this._modelsCache.timestamp < OpenAIProvider.ASSET_CACHE_TTL_MS
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

                    const data = (await response.json()) as { data?: Array<{ id?: string }> } | Array<{ id?: string }>;

                    // 支持 { data: [...] } 与扁平数组两种响应格式
                    const rawModels = Array.isArray(data)
                        ? data
                        : (data as { data?: Array<{ id?: string }> }).data ?? [];
                    const filtered = filterImageModels(rawModels);
                    const latestKey = `${this.getV1BaseUrl()}::${this.getTransport()}::${hashKeyFingerprint(this._getConfig()?.apiKey)}`;
                    if (reqGen === this._assetCacheGen && latestKey === cacheKey) {
                        this._modelsCache = { data: filtered, timestamp: Date.now(), cacheKey };
                    }
                    return filtered;
                } catch (err: unknown) {
                    if (internalSignal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
                        throw err;
                    }
                    // 后端不支持 /v1/models 时静默返回空数组
                    return [];
                }
            },
            signal
        );
    }

    /**
     * 执行 OpenAI 兼容图像生成任务。
     *
     * @remarks
     * 向 /v1/images/generations 端点提交生图请求，优先解析响应中的 b64_json 图像数据，
     * 若服务端仅返回 url 则通过 HTTP 客户端执行二次拉取并转换为 Blob。
     *
     * @param request 生图请求参数
     * @param signal 中止信号
     * @returns 包含图像 Blob 与生成元数据的生成结果
     */
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

        // 1. 读取激活预设与调用参数（优先使用队列快照固定的 drawingPresetId）
        const drawingPreset = this.resolveDrawingPreset<DrawingPresetData>(params);

        const resolvedPrompt = request.prompt;
        const resolvedModel = resolveOpenAIModel(params, drawingPreset);
        const capabilities = resolveOpenAIModelCapabilities(resolvedModel);
        const isSiliconFlow =
            config?.serviceId === 'siliconflow' ||
            /(?:^|[./])siliconflow\.cn(?:[:/]|$)/i.test(v1Base);

        const resolvedWidth = (params.width ?? drawingPreset?.width) as number | undefined;
        const resolvedHeight = (params.height ?? drawingPreset?.height) as number | undefined;
        const sizeStr = buildSizeString(resolvedWidth, resolvedHeight);

        const rawQuality = (params.quality ?? drawingPreset?.quality) as string | undefined;
        const resolvedQuality =
            capabilities.supportsQuality &&
            typeof rawQuality === 'string' &&
            capabilities.qualityOptions.includes(rawQuality)
                ? rawQuality
                : undefined;
        const resolvedStyle = capabilities.supportsStyle
            ? ((params.style ?? drawingPreset?.style) as string | undefined)
            : undefined;
        const resolvedBackground = capabilities.supportsBackground
            ? ((params.background ?? drawingPreset?.background) as string | undefined)
            : undefined;
        const resolvedOutputFormat = capabilities.supportsOutputFormat
            ? ((params.outputFormat ?? drawingPreset?.outputFormat) as string | undefined)
            : undefined;

        // 2. 装配标准生成请求体（接口不支持独立的负向提示词字段，仅发送正向提示词）
        const requestBody: Record<string, unknown> = {
            prompt: resolvedPrompt,
        };
        if (isSiliconFlow) {
            requestBody['batch_size'] = 1;
        } else {
            requestBody['n'] = 1;
        }

        if (capabilities.sendResponseFormatB64) {
            requestBody['response_format'] = 'b64_json';
        }

        if (resolvedModel) requestBody['model'] = resolvedModel;
        if (sizeStr) {
            if (isSiliconFlow) {
                requestBody['image_size'] = sizeStr;
            } else {
                requestBody['size'] = sizeStr;
            }
        }
        if (resolvedQuality) requestBody['quality'] = resolvedQuality;
        if (resolvedStyle) requestBody['style'] = resolvedStyle;
        if (resolvedBackground && resolvedBackground !== 'auto') {
            requestBody['background'] = resolvedBackground;
        }
        if (resolvedOutputFormat) requestBody['output_format'] = resolvedOutputFormat;

        // 3. 自定义 JSON 请求体合并扩展
        const customObj = parseCustomBodyObject(
            params.customBodyJson ?? drawingPreset?.customBodyJson,
            '[OpenAIProvider]'
        );
        if (customObj) {
            Object.assign(requestBody, customObj);
            requestBody['prompt'] = resolvedPrompt;
            if (isSiliconFlow) {
                requestBody['batch_size'] = 1;
            } else {
                requestBody['n'] = 1;
            }
        }

        // 4. 发起 HTTP 图像生成请求
        const generateUrl = `${v1Base}/images/generations`;
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
                    retries: 0, // 生图为非幂等计费操作，禁止底层网络重试以防重复扣费
                },
                transport
            );
        } catch (err: unknown) {
            if (err instanceof HttpError) {
                const errorDetail = extractHttpErrorMessage(err);
                if (err.status === 429) {
                    throw new Error(`请求被限速，请稍后重试: ${errorDetail}`);
                }
                throw new Error(`OpenAI 兼容服务生图失败: ${errorDetail}`);
            }
            throw err;
        }

        const responseData = (await response.json()) as {
            data?: Array<{ b64_json?: string; url?: string }>;
            images?: Array<{ b64_json?: string; url?: string } | string>;
        };

        const rawFirst = responseData.data?.[0] ?? responseData.images?.[0];
        const firstImage =
            typeof rawFirst === 'string'
                ? rawFirst.startsWith('http')
                    ? { url: rawFirst }
                    : { b64_json: rawFirst }
                : rawFirst;
        if (!firstImage) {
            throw new Error('OpenAI 兼容服务返回结果中未包含图像数据');
        }

        // 5. 解析响应图像数据
        let blob: Blob;

        // 优先解析 b64_json 避免 URL 过期；无 b64_json 时拉取 url 字段指向的图像
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
                    throw new Error(`图像 URL 下载失败: HTTP ${err.status}`);
                }
                throw err;
            }
            blob = await imgResponse.blob();
        } else {
            throw new Error('OpenAI 兼容服务响应中不含有效图像字段（b64_json 或 url）');
        }

        blob = await ensureValidImageBlob(blob, 'OpenAI 兼容服务');

        // 6. 装配生成元数据（若 customBodyJson 覆写了 model、size、quality 或 style，则同步到最终元数据）
        const finalModel =
            typeof requestBody['model'] === 'string' && requestBody['model'].trim()
                ? requestBody['model'].trim()
                : resolvedModel;
        let finalWidth = resolvedWidth;
        let finalHeight = resolvedHeight;
        const effectiveSizeStr =
            typeof requestBody['image_size'] === 'string'
                ? requestBody['image_size']
                : requestBody['size'];
        if (typeof effectiveSizeStr === 'string') {
            const sizeMatch = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(effectiveSizeStr.trim());
            if (sizeMatch) {
                finalWidth = Number(sizeMatch[1]);
                finalHeight = Number(sizeMatch[2]);
            }
        }
        const finalQuality =
            typeof requestBody['quality'] === 'string' && requestBody['quality'].trim()
                ? requestBody['quality'].trim()
                : resolvedQuality || undefined;
        const finalStyle =
            typeof requestBody['style'] === 'string' && requestBody['style'].trim()
                ? requestBody['style'].trim()
                : resolvedStyle || undefined;
        const finalBackground =
            typeof requestBody['background'] === 'string' && requestBody['background'].trim()
                ? requestBody['background'].trim()
                : resolvedBackground || undefined;
        const finalOutputFormat =
            typeof requestBody['output_format'] === 'string' && requestBody['output_format'].trim()
                ? requestBody['output_format'].trim()
                : resolvedOutputFormat || undefined;

        const durationMs = Date.now() - startTime;
        const metadata: ImageGenerationMetadata = {
            prompt: resolvedPrompt,
            // OpenAI /v1/images/generations 协议无负向提示词字段，执行元数据如实记录为 undefined
            negativePrompt: undefined,
            engine: 'openai',
            mode: 'txt2img',
            durationMs,
            baseModel: finalModel,
            width: finalWidth,
            height: finalHeight,
            quality: finalQuality,
            style: finalStyle,
            background: finalBackground,
            outputFormat: finalOutputFormat,
        };

        return {
            blob,
            metadata,
        };
    }
}
