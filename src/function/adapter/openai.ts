/**
 * OpenAI-Compatible 生图引擎适配器
 * 遵循 openai-compatible-image-api 与 st-image-gen 规范。
 * 支持 /v1/images/generations 调用与 b64_json 解码归一化。
 */

import type { EngineCapabilities, EngineType, HealthCheckResult, ImageGenerationParams, ImageGenerationResult } from '@types';
import { BaseAdapter } from './base';
import { base64ToBlob } from '../../util/image';
import type { HttpClient } from '../../util/http';

export class OpenAIAdapter extends BaseAdapter {
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
     * OpenAI 兼容端点连通性探测与可用模型列表拉取 (/models)
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
                message: 'OpenAI 服务端点未配置'
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

            // 支持服务端点以 /v1 结尾或直接根路径
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
        params: ImageGenerationParams,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult> {
        const startTime = performance.now();
        const apiKey = (params.extraParams?.apiKey as string) || this._apiKey;
        const endpoint = `${this.baseUrl}/v1/images/generations`;

        const payload: Record<string, unknown> = {
            prompt: params.prompt || '',
            model: (params.extraParams?.model as string) || 'dall-e-3',
            size: `${params.width}x${params.height}`,
            response_format: 'b64_json',
            n: 1
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
        }

        const resp = await this.httpClient.fetchExternal(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal
        });

        const data = await resp.json();
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
            width: params.width,
            height: params.height,
            seed: params.seed > 0 ? params.seed : 0,
            durationMs: this.measureDuration(startTime),
            metadata: {
                model: payload.model,
                revisedPrompt: item.revised_prompt
            }
        };
    }
}
