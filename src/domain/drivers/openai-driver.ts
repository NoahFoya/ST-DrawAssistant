/**
 * @module domain/drivers/openai-driver
 * @description OpenAI 兼容图像生图后端驱动实现 (支持 OpenAI DALL-E 2/3、Grok 图像及兼容中转接口)
 *
 * 核心处理规则：
 * - 面向自然语言提示词引擎：直接传递自然语言描述，不拼接负向提示词与扩散模型专有标签；
 * - 支持 Base64 JSON 与 URL 图像异步下载，自动处理跨源安全拉取。
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { BaseDriver, DriverError, DriverErrorType } from './base-driver';
import type { GenerationPayload, DriverBuildPayloadOptions, DriverAssetSyncResult } from './driver-contract';
import { joinPromptParts } from '../pipeline/prompt-pipeline';

interface OpenAIImageResponse {
    created?: number;
    data?: Array<{
        b64_json?: string;
        url?: string;
        revised_prompt?: string;
    }>;
    error?: {
        message?: string;
        type?: string;
        code?: string;
    };
}

export class OpenAIDriver extends BaseDriver {
    public readonly id = 'openai';
    public readonly name = 'OpenAI / Grok / Banana';

    constructor(store: ObservableStore<DrawAssistantSettings>) {
        super(store, 'OpenAIDriver');
    }

    protected override getEndpointUrl(): string {
        const url = this.store.getState().openaiBaseUrl || 'https://api.openai.com/v1';
        return url.replace(/\/+$/, '');
    }

    public async ping(): Promise<boolean> {
        try {
            const settings = this.store.getState();
            const headers: Record<string, string> = {};
            if (settings.openaiApiKey) {
                headers['Authorization'] = `Bearer ${settings.openaiApiKey}`;
            }
            await this.getJson('/models', 5000, headers);
            return true;
        } catch (err: any) {
            // 401/403 表示服务器可达，但密钥不正确或未提供，仍然代表后端已连通
            if (err instanceof DriverError && (err.statusCode === 401 || err.statusCode === 403)) {
                return true;
            }
            return false;
        }
    }

    public override async checkConnection(): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
        const start = performance.now();
        try {
            const settings = this.store.getState();
            const headers: Record<string, string> = {};
            if (settings.openaiApiKey) {
                headers['Authorization'] = `Bearer ${settings.openaiApiKey}`;
            }
            await this.getJson('/models', 6000, headers);
            return {
                connected: true,
                latencyMs: Math.round(performance.now() - start)
            };
        } catch (err: any) {
            if (err instanceof DriverError && (err.statusCode === 401 || err.statusCode === 403)) {
                return {
                    connected: true,
                    latencyMs: Math.round(performance.now() - start),
                    error: '服务可连接，但 API Key 鉴权未通过 (401/403)'
                };
            }
            return {
                connected: false,
                error: err?.message || String(err)
            };
        }
    }

    public formatPrompt(rawPrompt: string): string {
        return (rawPrompt || '').trim();
    }

    public override async syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult> {
        const models = await this.getModels();
        if (models.length > 0) {
            store.set('cachedModels', models);
        }
        return {
            updatedCount: models.length,
            summary: `已拉取 ${models.length} 个兼容模型。`,
            details: { models: models.length }
        };
    }

    public override async getModels(): Promise<string[]> {
        try {
            const settings = this.store.getState();
            const headers: Record<string, string> = {};
            if (settings.openaiApiKey) {
                headers['Authorization'] = `Bearer ${settings.openaiApiKey}`;
            }
            const res = await this.getJson<{ data?: Array<{ id: string }> }>('/models', 6000, headers);
            if (res?.data && Array.isArray(res.data)) {
                return res.data.map((m) => m.id).filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('拉取 OpenAI 兼容模型列表失败', err);
        }
        return ['dall-e-3', 'dall-e-2', 'grok-2-image', 'gemini-2.0-flash-image'];
    }

    public buildPayload(options: DriverBuildPayloadOptions): GenerationPayload {
        const { cleanPositive, settings } = options;

        const finalPositive = joinPromptParts(
            settings.openaiPromptPrefix,
            settings.promptPrefix,
            cleanPositive
        );

        return {
            mode: 'txt2img',
            prompt: finalPositive,
            negativePrompt: '',
            params: {
                seed: -1,
                steps: 1,
                cfgScale: 1,
                samplerName: 'default',
                width: settings.width || 1024,
                height: settings.height || 1024,
                model: settings.openaiModel || 'dall-e-3'
            }
        };
    }

    public async generate(
        payload: GenerationPayload,
        onProgress?: (progress: { percent: number; nodeName?: string; previewBlob?: Blob }) => void
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }> {
        const settings = this.store.getState();
        const timeoutMs = settings.requestTimeout || 120000;

        onProgress?.({ percent: 10, nodeName: '提交生图请求' });

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        const apiKey = settings.openaiApiKey || settings.apiKey;
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const model = settings.openaiModel || 'dall-e-3';
        const size = settings.openaiSize || '1024x1024';

        const body: Record<string, any> = {
            model,
            prompt: payload.prompt,
            n: 1,
            size,
            response_format: 'b64_json'
        };

        if (model.includes('dall-e-3')) {
            if (settings.openaiQuality) body.quality = settings.openaiQuality;
            if (settings.openaiStyle) body.style = settings.openaiStyle;
        }

        this.resetCancelState();

        try {
            onProgress?.({ percent: 30, nodeName: '等待模型生成' });

            const response = await this.postJson<OpenAIImageResponse>(
                '/images/generations',
                body,
                timeoutMs,
                headers
            );

            this.checkCancelled();

            if (response.error) {
                throw new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `OpenAI 接口报错: ${response.error.message || JSON.stringify(response.error)}`
                );
            }

            if (!response.data || response.data.length === 0) {
                throw new DriverError(DriverErrorType.BACKEND_ERROR, 'OpenAI 接口返回空数据列表');
            }

            const item = response.data[0];
            let imageBlob: Blob;

            if (item.b64_json) {
                imageBlob = this.base64ToBlob(item.b64_json, 'image/png');
            } else if (item.url) {
                onProgress?.({ percent: 80, nodeName: '下载生成图像' });
                const fetchResp = await fetch(item.url, { signal: AbortSignal.timeout(30000) });
                if (!fetchResp.ok) {
                    throw new DriverError(DriverErrorType.NETWORK_ERROR, `下载图片链接失败: ${fetchResp.statusText}`);
                }
                imageBlob = await fetchResp.blob();
            } else {
                throw new DriverError(DriverErrorType.BACKEND_ERROR, '响应中未包含有效图像数据 (b64_json / url 均为空)');
            }

            onProgress?.({ percent: 100 });

            return {
                imageBlobs: [imageBlob],
                metadata: {
                    model,
                    size,
                    revised_prompt: item.revised_prompt || payload.prompt
                }
            };
        } catch (err: any) {
            if (err instanceof DriverError) throw err;
            throw new DriverError(
                DriverErrorType.BACKEND_ERROR,
                `OpenAI 生成失败: ${err?.message || '未知异常'}`
            );
        }
    }
}
