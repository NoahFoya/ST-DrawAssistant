/**
 * SD-WebUI / Forge 生图引擎适配器
 * 遵循 sd-webui-api-reference 与 st-image-gen 规范。
 * 支持 txt2img、img2img、A1111 LoRA 语法拼装、进度轮询与作业中断。
 */

import type { EngineCapabilities, EngineType, HealthCheckResult, ImageGenerationParams, ImageGenerationResult } from '@types';
import { BaseAdapter } from './base';
import { base64ToBlob, blobToBase64 } from '../../util/image';
import { formatLoraTag, type LoraFormatItem } from '../../util/prompt';
import type { HttpClient } from '../../util/http';

export class SdWebUIAdapter extends BaseAdapter {
    public readonly id: EngineType = 'sdwebui';
    public readonly name = 'SD-WebUI / Forge';

    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: true,
        inpaint: true,
        lora: true,
        progress: true,
        interrupt: true,
        customWorkflow: false
    };

    constructor(baseUrl = 'http://127.0.0.1:7860', httpClient?: HttpClient) {
        super(baseUrl, httpClient);
    }

    /**
     * 连通性探测与 SD-WebUI / Forge 远端资产拉取 (Checkpoints, VAEs, LoRAs, Samplers, Upscalers)
     */
    public override async fetchAssets(signal?: AbortSignal): Promise<HealthCheckResult> {
        if (!this.baseUrl) {
            return { ok: false, message: 'SD-WebUI 服务地址未配置' };
        }

        const start = performance.now();
        try {
            // 1. 探活探测 /sdapi/v1/options
            const probeResp = await this.httpClient.fetchExternal(`${this.baseUrl}/sdapi/v1/options?_t=${Date.now()}`, {
                method: 'GET',
                timeoutMs: 6000,
                signal
            });

            const latencyMs = Math.round(performance.now() - start);

            if (!probeResp.ok) {
                return {
                    ok: false,
                    latencyMs,
                    message: `SD-WebUI 服务响应异常 (HTTP ${probeResp.status})`
                };
            }

            // 2. 并发拉取远端资产 (使用 Promise.allSettled 替代静默吞没)
            const models: string[] = [];
            const vaes: string[] = [];
            const loras: string[] = [];
            const samplers: string[] = [];
            const upscalers: string[] = [];
            const failedEndpoints: string[] = [];

            const endpoints = [
                { key: 'models', url: `${this.baseUrl}/sdapi/v1/sd-models` },
                { key: 'vaes', url: `${this.baseUrl}/sdapi/v1/sd-vae` },
                { key: 'loras', url: `${this.baseUrl}/sdapi/v1/loras` },
                { key: 'samplers', url: `${this.baseUrl}/sdapi/v1/samplers` },
                { key: 'upscalers', url: `${this.baseUrl}/sdapi/v1/upscalers` }
            ];

            const results = await Promise.allSettled(
                endpoints.map(ep =>
                    this.httpClient.fetchExternal(ep.url, { method: 'GET', timeoutMs: 10000, signal })
                        .then(async (res) => {
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            return { key: ep.key, data: await res.json() };
                        })
                )
            );

            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const ep = endpoints[i];
                if (r.status === 'fulfilled') {
                    const list = r.value.data;
                    if (Array.isArray(list)) {
                        if (ep.key === 'models') {
                            models.push(...list.map((item: any) => item.model_name || item.title || String(item)));
                        } else if (ep.key === 'vaes') {
                            vaes.push(...list.map((item: any) => item.model_name || String(item)));
                        } else if (ep.key === 'loras') {
                            loras.push(...list.map((item: any) => item.name || String(item)));
                        } else if (ep.key === 'samplers') {
                            samplers.push(...list.map((item: any) => item.name || String(item)));
                        } else if (ep.key === 'upscalers') {
                            upscalers.push(...list.map((item: any) => item.name || String(item)));
                        }
                    }
                } else {
                    failedEndpoints.push(ep.key);
                    this.logger.warn(`SD-WebUI 资产端点 [${ep.url}] 同步受阻:`, r.reason);
                }
            }

            let assetsSummary = models.length > 0
                ? `已同步 ${models.length} 款主模型、${vaes.length} 款 VAE、${loras.length} 款 LoRA、${upscalers.length} 款放大算法`
                : '网络连接正常';

            if (failedEndpoints.length > 0) {
                assetsSummary += ` (部分接口未就绪: ${failedEndpoints.join(', ')})`;
            }

            return {
                ok: true,
                latencyMs,
                assetsSummary,
                availableModels: models,
                assets: { models, vaes, loras, samplers, upscalers }
            };
        } catch (err: any) {
            this.logger.error('SD-WebUI 连通性探测异常:', err);
            return {
                ok: false,
                latencyMs: 0,
                message: err?.message || '无法连接至 SD-WebUI 服务，请确认服务已启动并已添加 --api 参数'
            };
        }
    }

    /**
     * 执行 SD-WebUI 生图请求
     */
    public async generate(
        params: ImageGenerationParams,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult> {
        const startTime = performance.now();

        // 1. 组装正向提示词（包含 A1111 语法 LoRA 标签）
        let finalPrompt = params.prompt || '';
        const loras = params.extraParams?.loras as LoraFormatItem[] | undefined;
        if (Array.isArray(loras) && loras.length > 0) {
            const loraTags = loras.map(l => formatLoraTag(l, 'webui')).filter(Boolean);
            if (loraTags.length > 0) {
                finalPrompt = finalPrompt ? `${finalPrompt}, ${loraTags.join(', ')}` : loraTags.join(', ');
            }
        }

        // 2. 检查图生图输入源
        let sourceBase64: string | undefined;
        if (params.sourceImage) {
            if (typeof params.sourceImage === 'string') {
                sourceBase64 = params.sourceImage;
            } else if (params.sourceImage instanceof Blob) {
                sourceBase64 = await blobToBase64(params.sourceImage);
            }
        }

        const isImg2Img = Boolean(sourceBase64);
        const endpoint = `${this.baseUrl}/sdapi/v1/${isImg2Img ? 'img2img' : 'txt2img'}`;

        // 3. 构建请求体载荷
        const payload: Record<string, unknown> = {
            prompt: finalPrompt,
            negative_prompt: params.negativePrompt || '',
            steps: params.steps ?? 20,
            cfg_scale: params.cfgScale ?? 7.0,
            width: params.width,
            height: params.height,
            seed: params.seed ?? -1,
            sampler_name: params.sampler || 'Euler a',
            ...(params.scheduler ? { scheduler: params.scheduler } : {}),
            ...(params.extraParams?.override_settings ? { override_settings: params.extraParams.override_settings } : {})
        };

        if (isImg2Img && sourceBase64) {
            payload.init_images = [sourceBase64];
            payload.denoising_strength = params.denoisingStrength ?? 0.75;
        }

        // 4. 进度轮询器（若传入进度回调）
        let progressTimer: ReturnType<typeof setInterval> | null = null;
        if (onProgress) {
            progressTimer = setInterval(async () => {
                try {
                    const progResp = await this.httpClient.fetchExternal(
                        `${this.baseUrl}/sdapi/v1/progress?skip_current_image=true`,
                        { method: 'GET', signal }
                    );
                    if (progResp.ok) {
                        const data = await progResp.json();
                        if (typeof data.progress === 'number') {
                            onProgress(Math.min(1, Math.max(0, data.progress)));
                        }
                    }
                } catch {
                    // 轮询偶发异常不影响主生图流程
                }
            }, 500);
        }

        try {
            // 5. 发送生图请求
            const resp = await this.httpClient.fetchExternal(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal
            });

            const resultData = await resp.json();
            if (!resultData.images || !Array.isArray(resultData.images) || resultData.images.length === 0) {
                throw new Error('SD-WebUI 服务未返回图像数据');
            }

            const rawImageStr = resultData.images[0] as string;
            const blob = base64ToBlob(rawImageStr, 'image/png');

            // 解析实际种子
            let resolvedSeed = params.seed;
            if (typeof resultData.info === 'string') {
                try {
                    const parsedInfo = JSON.parse(resultData.info);
                    if (typeof parsedInfo.seed === 'number') {
                        resolvedSeed = parsedInfo.seed;
                    }
                } catch {
                    // info 字段为可选，解析失败时保留请求传入的 seed 就近返回
                }
            }

            if (onProgress) {
                onProgress(1.0);
            }

            return {
                blob,
                mimeType: 'image/png',
                width: params.width,
                height: params.height,
                seed: resolvedSeed,
                durationMs: this.measureDuration(startTime),
                metadata: {
                    info: resultData.info
                }
            };
        } finally {
            if (progressTimer !== null) {
                clearInterval(progressTimer);
            }
        }
    }

    /**
     * 主动中止 SD-WebUI 当前任务
     */
    public override async interrupt(): Promise<void> {
        try {
            await this.httpClient.fetchExternal(`${this.baseUrl}/sdapi/v1/interrupt`, {
                method: 'POST'
            });
            this.logger.info('已向 SD-WebUI 发送中断请求');
        } catch (err: any) {
            this.logger.warn(`SD-WebUI 中断请求失败: ${err?.message || err}`);
        }
    }
}
