/**
 * OpenAI 兼容绘图服务提供方适配器 (OpenAIProvider)。
 *
 * @remarks
 * 兼容 OpenAI `/v1/images/generations` 规范的通用适配器，
 * 支持 GPT Image、Grok Imagine、Gemini OpenAI-compat 等第三方云端或自建兼容服务：
 * 1. 认证规范：请求头携带 `Authorization: Bearer <apiKey>`；
 * 2. 图像二进制数据提取：默认显式指定 `response_format: 'b64_json'`，直接解析 Base64 编码转换为 PNG Blob，
 *    避免临时云端图片 URL 几分钟后过期失效或前端直连被 CORS 跨域策略阻断；
 * 3. 提示词清洗：自动剥离 Stable Diffusion 专用的 `<lora:...>` 语法标签，避免污染自然语言多模态大模型的语义理解；
 * 4. 纯净正向词请求：云端标准接口不支持 negative_prompt 字段，负向提示词不组装进请求体；
 * 5. 模型发现与连通性：通过 GET /v1/models 探测服务可用性并提取包含 image/vision/dall-e/imagine 关键词的候选模型。
 */

import type {
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    TaskProgressCallback,
    ImageGenerationMetadata,
    OpenAIProviderConfig,
    DrawingPresetData,
    PromptPresetData,
} from '@types';
import { BaseGenerationProvider, type BaseProviderOptions } from '../base-provider';
import { logger } from '../../util/logger';
import { base64ToBlob } from '../../util/http-client';

/** OpenAI 兼容提供方初始化配置项 */
export interface OpenAIProviderOptions extends BaseProviderOptions {}

/**
 * 将 width/height 组装为 OpenAI images/generations 的 size 字符串。
 *
 * @remarks
 * 仅在 width 和 height 均有效时返回 "WxH" 格式字符串。
 * 为空时由调用方省略该字段，由后端按其默认值处理。
 */
export function buildSizeString(width?: number, height?: number): string | undefined {
    if (width && height && width > 0 && height > 0) {
        return `${width}x${height}`;
    }
    return undefined;
}

/**
 * 从 GET /v1/models 响应中过滤图像相关模型标识。
 *
 * @remarks
 * 按常见图像模型 ID 关键词过滤（不区分大小写）。
 * 不支持 /v1/models 的后端返回空数组，不报错。
 */
export function filterImageModels(models: Array<{ id: string }>): string[] {
    const IMAGE_KEYWORDS = ['image', 'dall-e', 'dalle', 'grok-2-image', 'imagine', 'vision'];
    return models
        .map((m) => m.id)
        .filter((id) =>
            IMAGE_KEYWORDS.some((kw) => id.toLowerCase().includes(kw))
        );
}

/**
 * 解析 OpenAI 兼容服务的目标模型标识符。
 *
 * @remarks
 * 优先级：单次覆盖参数 model > 单次覆盖参数 customModel > 预设 customModel > 预设 baseModel > 默认模型 (dall-e-3)。
 *
 * @param parameters 单次任务覆盖参数
 * @param preset 当前绘图预设数据
 * @returns 解析得到的有效模型名称
 */
export function resolveOpenAIModel(
    parameters?: Record<string, unknown>,
    preset?: DrawingPresetData
): string {
    return (
        (parameters?.model as string | undefined) ??
        (parameters?.customModel as string | undefined) ??
        (preset?.customModel as string | undefined) ??
        (preset?.baseModel as string | undefined) ??
        'dall-e-3'
    );
}

/**
 * OpenAI 兼容绘图服务提供方实现类。
 */
export class OpenAIProvider extends BaseGenerationProvider {
    public readonly providerType: ProviderType = 'openai';
    public readonly name: string = 'OpenAI Compatible';

    public constructor(options: OpenAIProviderOptions = {}) {
        super(options);
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
     * 请求 GET /v1/models 验证服务可达性；该端点在大多数兼容实现中均存在。
     *
     * @param signal 中止信号
     */
    public async checkHealth(signal?: AbortSignal): Promise<ProviderHealthResult> {
        const serverUrl = this.getServerUrl();
        const config = this._getConfig();
        const transport = this.getTransport();
        const probeUrl = `${serverUrl}/v1/models`;

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
     * 请求 GET /v1/models，过滤 id 含图像关键词的条目。
     * 若后端不支持该端点则静默返回空数组。
     *
     * @param signal 中止信号
     * @returns 图像模型标识数组
     */
    public async fetchModels(signal?: AbortSignal): Promise<string[]> {
        const serverUrl = this.getServerUrl();
        const config = this._getConfig();
        const transport = this.getTransport();
        const url = `${serverUrl}/v1/models`;

        try {
            const response = await this.fetchWithTransport(
                url,
                {
                    method: 'GET',
                    headers: this._buildHeaders(config?.apiKey),
                    timeoutMs: 10000,
                    signal,
                },
                transport
            );

            if (!response.ok) {
                return [];
            }

            const data = (await response.json()) as { data?: Array<{ id: string }> } | Array<{ id: string }>;

            // 支持 { data: [...] } 与扁平数组两种响应格式
            const models = Array.isArray(data) ? data : (data as { data?: Array<{ id: string }> }).data ?? [];
            return filterImageModels(models);
        } catch {
            // 后端不支持 /v1/models 时静默返回空数组
            return [];
        }
    }

    /**
     * 执行 OpenAI 兼容图像生成任务。
     *
     * @remarks
     * 向 /v1/images/generations 端点提交生图请求，优先解析响应中的 b64_json 图像数据，
     * 若服务端仅返回 url 则通过 HTTP 客户端执行二次拉取并转换为 Blob。
     *
     * @param request 生图请求参数
     * @param onProgress 进度与状态回调
     * @param signal 中止信号
     * @returns 包含图像 Blob 与生成元数据的生成结果
     */
    public async generate(
        request: GenerationRequest,
        onProgress?: TaskProgressCallback,
        signal?: AbortSignal
    ): Promise<GenerationResult> {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        const startTime = Date.now();
        const config = this._getConfig();
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const params = request.parameters ?? {};
        const maxTimeoutMs = this.getTimeoutMs();

        let drawingPreset: DrawingPresetData | undefined;
        if (this._settingsStore) {
            const activeDrawingId = config?.activeDrawingPresetId;
            if (activeDrawingId) {
                drawingPreset = this._settingsStore.getPreset<DrawingPresetData>(
                    'drawing',
                    activeDrawingId,
                    'openai'
                )?.data;
            }
            if (!drawingPreset && typeof this._settingsStore.getPresets === 'function') {
                const allPresets = this._settingsStore.getPresets<DrawingPresetData>('drawing', 'openai');
                if (allPresets && allPresets.length > 0) {
                    drawingPreset = allPresets[0].data;
                }
            }
        }

        // 1. 尝试从绑定的提示词预设方案中解析自然语言模板 (SSOT)
        let resolvedPrompt = request.prompt;
        const promptPresetId = (params.promptPresetId ?? drawingPreset?.promptPresetId) as string | undefined;
        if (this._settingsStore && promptPresetId) {
            const promptPreset = this._settingsStore.getPreset<PromptPresetData>('prompts', promptPresetId)?.data;
            if (promptPreset) {
                const prefix = (promptPreset.positivePrefix || '').trim();
                const suffix = (promptPreset.positiveSuffix || '').trim();
                if (prefix) resolvedPrompt = `${prefix}, ${resolvedPrompt}`;
                if (suffix) resolvedPrompt = `${resolvedPrompt}, ${suffix}`;
            }
        }

        const resolvedModel = resolveOpenAIModel(params, drawingPreset);

        const resolvedWidth = (params.width ?? drawingPreset?.width) as number | undefined;
        const resolvedHeight = (params.height ?? drawingPreset?.height) as number | undefined;
        const sizeStr = buildSizeString(resolvedWidth, resolvedHeight);

        const resolvedQuality = (params.quality ?? drawingPreset?.quality) as string | undefined;
        const resolvedStyle = (params.style ?? drawingPreset?.style) as string | undefined;

        // 2. 清洗剥离 SD 专用 <lora:...> 语法，防止污染云端大模型对自然语言提示词的理解
        resolvedPrompt = resolvedPrompt
            .replace(/<lora:[^>]+>/gi, '')
            .replace(/,\s*,+/g, ',')
            .replace(/^\s*,\s*|\s*,\s*$/g, '')
            .trim();

        // 3. 组装标准生成请求体 (云端接口原生不支持负向提示词，严格保持纯净正向词请求)
        const requestBody: Record<string, unknown> = {
            prompt: resolvedPrompt,
            n: 1,
            response_format: 'b64_json',
        };

        if (resolvedModel) requestBody['model'] = resolvedModel;
        if (sizeStr) requestBody['size'] = sizeStr;
        if (resolvedQuality) requestBody['quality'] = resolvedQuality;
        if (resolvedStyle) requestBody['style'] = resolvedStyle;

        // 3. 自定义 JSON 请求体合并扩展
        const customBodyJson = (params.customBodyJson ?? drawingPreset?.customBodyJson) as string | undefined;
        if (customBodyJson && typeof customBodyJson === 'string' && customBodyJson.trim()) {
            try {
                const customObj = JSON.parse(customBodyJson.trim());
                if (customObj && typeof customObj === 'object' && !Array.isArray(customObj)) {
                    Object.assign(requestBody, customObj);
                    // 确保核心必要参数优先级
                    requestBody['prompt'] = resolvedPrompt;
                    requestBody['n'] = 1;
                    if (!requestBody['response_format']) {
                        requestBody['response_format'] = 'b64_json';
                    }
                }
            } catch (err) {
                logger.warn('[OpenAIProvider] 自定义请求体 JSON 解析失败，跳过附加参数:', err);
            }
        }

        if (onProgress) {
            onProgress({ percent: 5, statusText: '提交生图请求...' });
        }

        const generateUrl = `${serverUrl}/v1/images/generations`;
        const response = await this.fetchWithTransport(
            generateUrl,
            {
                method: 'POST',
                headers: this._buildHeaders(config?.apiKey),
                body: JSON.stringify(requestBody),
                timeoutMs: maxTimeoutMs,
                signal,
            },
            transport
        );

        if (!response.ok) {
            let errorDetail = `HTTP ${response.status}`;
            try {
                const errJson = (await response.json()) as { error?: { message?: string }; message?: string };
                errorDetail = errJson.error?.message ?? errJson.message ?? errorDetail;
            } catch {
                // 忽略响应体解析失败
            }

            // 429 速率限制与安全拒绝区分处理
            if (response.status === 429) {
                throw new Error(`请求被限速，请稍后重试: ${errorDetail}`);
            }
            throw new Error(`OpenAI 兼容服务生图失败: ${errorDetail}`);
        }

        if (onProgress) {
            onProgress({ percent: 80, statusText: '解析响应...' });
        }

        const responseData = (await response.json()) as {
            data?: Array<{ b64_json?: string; url?: string }>;
        };

        const firstImage = responseData.data?.[0];
        if (!firstImage) {
            throw new Error('OpenAI 兼容服务返回结果中未包含图像数据');
        }

        let blob: Blob;

        // 优先解析 b64_json 避免 URL 过期；无 b64_json 时拉取 url 字段指向的图像
        if (firstImage.b64_json) {
            blob = base64ToBlob(firstImage.b64_json, 'image/png');
        } else if (firstImage.url) {
            const imgResponse = await this.fetchWithTransport(
                firstImage.url,
                { method: 'GET', timeoutMs: 30000, signal },
                transport
            );
            if (!imgResponse.ok) {
                throw new Error(`图像 URL 下载失败: HTTP ${imgResponse.status}`);
            }
            blob = await imgResponse.blob();
        } else {
            throw new Error('OpenAI 兼容服务响应中不含有效图像字段（b64_json 或 url）');
        }

        if (onProgress) {
            onProgress({ percent: 100, statusText: '生图完成' });
        }

        const durationMs = Date.now() - startTime;
        const metadata: ImageGenerationMetadata = {
            prompt: resolvedPrompt,
            // OpenAI /v1/images/generations 协议无负向提示词字段，执行元数据如实记录为 undefined
            negativePrompt: undefined,
            engine: 'openai',
            durationMs,
            baseModel: resolvedModel,
            width: resolvedWidth,
            height: resolvedHeight,
        };

        return {
            blob,
            metadata,
        };
    }
}
