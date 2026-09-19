/**
 * OpenAI 兼容绘图服务提供方适配器。
 *
 * @remarks
 * 兼容 OpenAI `/v1/images/generations` 规范的通用适配器，
 * 支持 GPT Image、Grok Imagine、Gemini OpenAI-compat 等第三方云端或自建服务：
 * - 认证方式：请求头携带 Authorization: Bearer <apiKey>；
 * - 数据提取：优先请求并解析 b64_json 字段以避免临时 URL 快速失效与跨域限制，在仅返回 url 时执行二次拉取；
 * - 模型发现：通过 /v1/models 接口动态发现具有图像生成能力的目标模型。
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
} from '@types';
import { BaseGenerationProvider, type BaseProviderOptions } from '../base-provider';

/** OpenAI 兼容提供方初始化配置项 */
export interface OpenAIProviderOptions extends BaseProviderOptions {}

/**
 * 将 Base64 字符串解码为 Blob。
 *
 * @param b64 Base64 编码图像字符串（可含 data URI 前缀）
 * @param mimeType 图像 MIME 类型
 */
function base64ToBlob(b64: string, mimeType = 'image/png'): Blob {
    const raw = b64.includes(',') ? b64.split(',')[1] : b64;
    const binaryStr = atob(raw);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

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
     * 读取配置中心的 OpenAI 兼容服务地址，未配置时回退为默认公共端点 (https://api.openai.com)。
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

            // 兼容 { data: [...] } 与直接数组两种响应格式
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
        if (this._settingsStore && config?.activeDrawingProfileId) {
            drawingPreset = this._settingsStore.getPreset<DrawingPresetData>(
                'drawing',
                config.activeDrawingProfileId,
                'openai'
            )?.data;
        }

        const resolvedModel =
            (params.model as string | undefined) ??
            (drawingPreset?.baseModel as string | undefined) ??
            'dall-e-3';

        const resolvedWidth = (params.width ?? drawingPreset?.width) as number | undefined;
        const resolvedHeight = (params.height ?? drawingPreset?.height) as number | undefined;
        const sizeStr = buildSizeString(resolvedWidth, resolvedHeight);

        const requestBody: Record<string, unknown> = {
            prompt: request.prompt,
            n: 1,
            response_format: 'b64_json',
        };

        if (resolvedModel) requestBody['model'] = resolvedModel;
        if (sizeStr) requestBody['size'] = sizeStr;

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

        // 优先 b64_json 避免 URL 过期；不含 b64_json 时回退下载 url 字段指向的图像
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
            prompt: request.prompt,
            negativePrompt: request.negativePrompt,
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
