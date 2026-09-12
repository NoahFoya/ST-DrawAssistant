/**
 * OpenAI-Compatible 生图引擎适配器
 * 遵循 openai-compatible-image-api 与 st-image-gen 规范。
 * 支持 /v1/images/generations 调用与 b64_json 解码归一化。
 */

import type { EngineCapabilities, EngineType, ImageGenerationParams, ImageGenerationResult } from '@types';
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
