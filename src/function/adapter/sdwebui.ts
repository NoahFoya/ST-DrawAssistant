/**
 * SD-WebUI / Forge 生图引擎适配器 (SdWebUIAdapter)
 *
 * 功能：
 * 1. 对接 SD-WebUI 与 Forge 的 txt2img 及 img2img REST 接口；
 * 2. 将 LoRA 列表转换为标准 A1111 格式的 <lora:name:weight> 提示词标签；
 * 3. 支持服务端生成作业的实时中断 (POST /sdapi/v1/interrupt)；
 * 4. 同步远端 Checkpoint 模型与采样器列表，执行连通性探测。
 *
 * Tips：
 * 1. 变种兼容：针对 A1111 与 Forge 等衍生分支，采样器名称与参数字段可能存在微小差异，需容错解析；
 * 2. 图像解析：接口返回的 Base64 图片数据需转换为二进制 Blob，并提取 PNG Info 生成参数。
 */

import type {
    EngineCapabilities,
    EngineType,
    HealthCheckResult,
    ImageGenerationResult,
    SdWebUIRequestData,
    SdWebUIResponseData
} from '@types';
import { BaseAdapter } from './base';
import { base64ToBlob } from '@util/image';
import { formatLoraTag } from '@util/prompt';
import type { HttpClient } from '@util/http';

export class SdWebUIAdapter extends BaseAdapter<SdWebUIRequestData> {
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
            // 1. 连通性探测 /sdapi/v1/options
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
        params: SdWebUIRequestData,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult> {
        const startTime = performance.now();

        // 1. 组装正向提示词（包含 A1111 语法 LoRA 标签）
        let finalPrompt = params.prompt || '';
        const loras = params.loras;
        if (Array.isArray(loras) && loras.length > 0) {
            const loraTags = loras.map(l => formatLoraTag(l, 'webui')).filter(Boolean);
            if (loraTags.length > 0) {
                finalPrompt = finalPrompt ? `${finalPrompt}, ${loraTags.join(', ')}` : loraTags.join(', ');
            }
        }

        // 2. 检查图生图输入源
        const initImages = Array.isArray(params.init_images) && params.init_images.length > 0
            ? params.init_images
            : undefined;
        const isImg2Img = Boolean(initImages);
        const endpoint = `${this.baseUrl}/sdapi/v1/${isImg2Img ? 'img2img' : 'txt2img'}`;

        // 3. 构建发往后端的请求数据
        const requestBody: Record<string, unknown> = {
            prompt: finalPrompt,
            negative_prompt: params.negative_prompt ?? params.negativePrompt ?? '',
            steps: params.steps ?? 20,
            cfg_scale: params.cfg_scale ?? 7.0,
            width: params.width,
            height: params.height,
            seed: params.seed ?? -1,
            sampler_name: params.sampler_name ?? 'Euler a'
        };

        if (params.scheduler) {
            requestBody.scheduler = params.scheduler;
        }
        if (params.override_settings) {
            requestBody.override_settings = params.override_settings;
            requestBody.override_settings_restore_afterwards = params.override_settings_restore_afterwards ?? true;
        }
        if (params.restore_faces !== undefined) requestBody.restore_faces = params.restore_faces;
        if (params.tiling !== undefined) requestBody.tiling = params.tiling;
        if (params.enable_hr !== undefined) requestBody.enable_hr = params.enable_hr;
        if (params.hr_scale !== undefined) requestBody.hr_scale = params.hr_scale;
        if (params.hr_upscaler !== undefined) requestBody.hr_upscaler = params.hr_upscaler;
        if (params.hr_second_pass_steps !== undefined) requestBody.hr_second_pass_steps = params.hr_second_pass_steps;

        if (isImg2Img && initImages) {
            requestBody.init_images = initImages;
            requestBody.denoising_strength = params.denoising_strength ?? 0.75;
            if (params.mask) requestBody.mask = params.mask;
            if (params.mask_blur !== undefined) requestBody.mask_blur = params.mask_blur;
            if (params.inpainting_fill !== undefined) requestBody.inpainting_fill = params.inpainting_fill;
            if (params.inpaint_full_res !== undefined) requestBody.inpaint_full_res = params.inpaint_full_res;
            if (params.inpaint_full_res_padding !== undefined) requestBody.inpaint_full_res_padding = params.inpaint_full_res_padding;
            if (params.inpainting_mask_invert !== undefined) requestBody.inpainting_mask_invert = params.inpainting_mask_invert;
        }

        // 4. 进度轮询器（若传入进度回调）
        let progressTimer: ReturnType<typeof setInterval> | null = null;
        if (onProgress) {
            progressTimer = setInterval(async () => {
                try {
                    const progResp = await this.fetchWithTransport(
                        `${this.baseUrl}/sdapi/v1/progress?skip_current_image=true`,
                        { method: 'GET', signal },
                        params.transport
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
            const resp = await this.fetchWithTransport(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal
            }, params.transport);

            const resultData: SdWebUIResponseData = await resp.json();
            if (!resultData.images || !Array.isArray(resultData.images) || resultData.images.length === 0) {
                throw new Error('SD-WebUI 服务未返回图像数据');
            }

            const rawImageStr = resultData.images[0];
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
            await this.fetchWithTransport(`${this.baseUrl}/sdapi/v1/interrupt`, {
                method: 'POST'
            });
            this.logger.info('已向 SD-WebUI 发送中断请求');
        } catch (err: any) {
            this.logger.warn(`SD-WebUI 中断请求失败: ${err?.message || err}`);
        }
    }
}
