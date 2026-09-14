/**
 * OpenAI 兼容生图引擎适配器 (OpenAIAdapter)
 *
 * 核心功能：
 * 1. 调用各厂商标准 `/v1/images/generations` 接口发起图像生成；
 * 2. 处理返回的 Base64 编码图像数据 (b64_json) 并转换为二进制图片 Blob；
 * 3. 支持厂商特有自定义请求头与 Body 扩展参数注入；
 * 4. 执行连通性探测与模型列表同步。
 *
 * 注意事项：
 * 1. 优先请求 `b64_json` 响应格式，避免部分云厂商返回带有效期的临时外链导致失效；
 * 2. 需捕获各中转厂商特异的错误信息体，提取清晰明了的失败原因给用户。
 */

import type {
    EngineCapabilities,
    EngineType,
    HealthCheckResult,
    ImageGenerationResult,
    OpenAIRequestData,
    OpenAIResponseData
} from '@types';
import { BaseAdapter } from './base';
import { base64ToBlob } from '../../util/image';
import { NetworkError, type HttpClient } from '../../util/http';

export class OpenAIAdapter extends BaseAdapter<OpenAIRequestData> {
    public readonly id: EngineType = 'openai';
    public readonly name = 'OpenAI-Compatible';

    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: false,
        inpaint: false,
        lora: false,
        progress: false,
        interrupt: false,
        customWorkflow: false
    };

    private _apiKey: string;

    constructor(baseUrl = 'https://api.openai.com', apiKey = '', httpClient?: HttpClient) {
        super(baseUrl, httpClient);
        this._apiKey = apiKey;
    }

    public setApiKey(key: string): void {
        this._apiKey = key;
    }

    /**
     * OpenAI 兼容服务地址连通性探测与可用模型列表拉取 (/models)
     */
    public override async fetchAssets(
        signal?: AbortSignal,
        options?: { apiKey?: string; serverUrl?: string; customHeaders?: string }
    ): Promise<HealthCheckResult> {
        const apiKey = options?.apiKey ?? this._apiKey;
        const targetBaseUrl = (options?.serverUrl || this.baseUrl).replace(/\/+$/, '');

        if (!targetBaseUrl) {
            return {
                ok: false,
                latencyMs: 0,
                message: 'OpenAI 服务地址未配置'
            };
        }

        const start = performance.now();
        try {
            const headers: Record<string, string> = {};
            if (apiKey) {
                headers.Authorization = `Bearer ${apiKey.trim()}`;
            }

            if (options?.customHeaders) {
                try {
                    const parsed = JSON.parse(options.customHeaders);
                    if (typeof parsed === 'object' && parsed !== null) {
                        Object.assign(headers, parsed);
                    }
                } catch (e: any) {
                    this.logger.warn('自定义请求头 JSON 解析失败:', e);
                }
            }

            // 支持服务地址以 /v1 结尾或直接根路径
            const endpoint = targetBaseUrl.endsWith('/v1')
                ? `${targetBaseUrl}/models`
                : `${targetBaseUrl}/v1/models`;

            const resp = await this.httpClient.fetchExternal(endpoint, {
                method: 'GET',
                headers,
                timeoutMs: 8000,
                signal
            });

            const latencyMs = Math.round(performance.now() - start);

            if (resp.status === 401) {
                return {
                    ok: false,
                    latencyMs,
                    message: 'API Key 鉴权失败 (HTTP 401)，请核对密钥有效性'
                };
            }

            if (!resp.ok) {
                return {
                    ok: false,
                    latencyMs,
                    message: `OpenAI 服务响应异常 (HTTP ${resp.status})`
                };
            }

            const data = await resp.json().catch(() => ({}));
            const list: string[] = Array.isArray(data?.data)
                ? data.data.map((m: any) => String(m.id || m)).filter(Boolean)
                : [];

            const assetsSummary = list.length > 0
                ? `服务正常，已同步 ${list.length} 款可用模型`
                : '服务连接正常 (未拉取到模型列表)';

            return {
                ok: true,
                latencyMs,
                assetsSummary,
                availableModels: list,
                assets: { models: list }
            };
        } catch (err: any) {
            this.logger.error('OpenAI 连通性探测异常:', err);
            return {
                ok: false,
                latencyMs: 0,
                message: err?.message || '无法连接至目标服务地址，请检查网络或服务地址'
            };
        }
    }

    public async generate(
        params: OpenAIRequestData,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult> {
        const startTime = performance.now();
        const apiKey = this._apiKey;
        const endpoint = `${this.baseUrl}/v1/images/generations`;

        const [widthStr, heightStr] = (params.size || '1024x1024').split('x');
        const width = parseInt(widthStr, 10) || 1024;
        const height = parseInt(heightStr, 10) || 1024;

        const requestBody: Record<string, unknown> = {
            prompt: params.prompt || '',
            model: params.model || 'dall-e-3',
            size: params.size || `${width}x${height}`,
            response_format: params.response_format || 'b64_json',
            n: 1
        };

        if (params.quality) {
            requestBody.quality = params.quality;
        }
        if (params.style) {
            requestBody.style = params.style;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
        }

        let resp: Response;
        try {
            resp = await this.fetchWithTransport(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal
            }, params.transport);
        } catch (err: any) {
            if (err instanceof NetworkError || err?.status) {
                const status = err.status;
                const errData = err.details;
                const detail = errData?.error?.message || errData?.message || (typeof errData === 'string' ? errData : '');
                let errMsg = `OpenAI 生图请求失败 (HTTP ${status})`;
                if (detail) {
                    if (status === 401) {
                        errMsg = `OpenAI 鉴权失败 (HTTP 401): ${detail}`;
                    } else if (status === 429) {
                        errMsg = `OpenAI 触发频率限制或配额耗尽 (HTTP 429): ${detail}`;
                    } else if (status === 400) {
                        errMsg = `OpenAI 请求参数不合法或被安全策略拦截 (HTTP 400): ${detail}`;
                    } else {
                        errMsg = `OpenAI 服务返回错误 (HTTP ${status}): ${detail}`;
                    }
                } else if (status === 401) {
                    errMsg = 'OpenAI 鉴权失败 (HTTP 401)，请核对 API Key 有效性';
                } else if (status === 429) {
                    errMsg = 'OpenAI 触发频率限制或配额耗尽 (HTTP 429)';
                }
                throw new Error(errMsg);
            }
            throw err;
        }

        const data: OpenAIResponseData = await resp.json();
        if (!data || !Array.isArray(data.data) || data.data.length === 0) {
            throw new Error(`OpenAI 响应未包含有效图像数据: ${JSON.stringify(data)}`);
        }

        const item = data.data[0];
        let blob: Blob;

        if (item.b64_json) {
            blob = base64ToBlob(item.b64_json, 'image/png');
        } else if (item.url) {
            // 兼容仅返回临时 URL 的服务端
            const imgResp = await this.httpClient.fetchExternal(item.url, { signal });
            blob = await imgResp.blob();
        } else {
            throw new Error('OpenAI 响应未找到 b64_json 或 url 字段');
        }

        if (onProgress) {
            onProgress(1.0);
        }

        return {
            blob,
            mimeType: blob.type || 'image/png',
            width,
            height,
            seed: 0,
            durationMs: this.measureDuration(startTime),
            metadata: {
                model: params.model,
                revisedPrompt: item.revised_prompt
            }
        };
    }
}
