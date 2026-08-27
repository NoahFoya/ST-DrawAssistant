/**
 * @module domain/drivers/openai-driver
 * @description OpenAI 兼容图像生图后端驱动实现 (支持 OpenAI DALL-E 2/3、Grok 图像及兼容中转接口)
 *
 * 核心处理规则：
 * - 面向自然语言提示词引擎：直接传递自然语言描述，不拼接负向提示词与扩散模型专有标签；
 * - 支持 Base64 JSON 与 URL 图像异步下载，自动处理跨源安全拉取。
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    DEFAULT_TASK_TIMEOUT_MS,
    DEFAULT_DOWNLOAD_TIMEOUT_MS,
    GenerationPayload,
    DriverBuildPayloadOptions,
    DriverAssetSyncResult,
    DriverCapabilities
} from '../../core';
import { BaseDriver, DriverError, DriverErrorType } from './base-driver';
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
    public readonly capabilities: DriverCapabilities = {
        supportsInterrupt: false,
        supportsInpaint: false,
        supportsAssetSync: false,
        promptSyntax: 'plain'
    };

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

        // 解析 OpenAI 专有尺寸字符串 (如 "1024x1792" 或 "1792x1024")
        const overrides = options.overrides || {};
        let targetWidth = typeof overrides.width === 'number' ? overrides.width : (settings.width || 1024);
        let targetHeight = typeof overrides.height === 'number' ? overrides.height : (settings.height || 1024);
        if (!overrides.width && !overrides.height && settings.openaiSize && settings.openaiSize.includes('x')) {
            const [wStr, hStr] = settings.openaiSize.split('x');
            const parsedW = parseInt(wStr, 10);
            const parsedH = parseInt(hStr, 10);
            if (!isNaN(parsedW) && parsedW > 0) targetWidth = parsedW;
            if (!isNaN(parsedH) && parsedH > 0) targetHeight = parsedH;
        }

        return {
            mode: 'txt2img',
            prompt: finalPositive,
            negativePrompt: '',
            params: {
                seed: typeof overrides.seed === 'number' ? overrides.seed : -1,
                steps: typeof overrides.steps === 'number' ? overrides.steps : 1,
                cfgScale: typeof overrides.cfgScale === 'number' ? overrides.cfgScale : 1,
                samplerName: (overrides.samplerName as string) || 'default',
                width: targetWidth,
                height: targetHeight,
                model: (overrides.model as string) || settings.openaiModel || 'dall-e-3'
            }
        };
    }

    protected override async doGenerate(
        payload: GenerationPayload
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }> {
        const settings = this.store.getState();
        const timeoutMs = settings.taskTimeout || DEFAULT_TASK_TIMEOUT_MS;

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

        try {
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
                imageBlob = await this.getBlob(item.url, DEFAULT_DOWNLOAD_TIMEOUT_MS);
            } else {
                throw new DriverError(DriverErrorType.BACKEND_ERROR, '响应中未包含有效图像数据 (b64_json / url 均为空)');
            }

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
