/**
 * @module domain/drivers/sdwebui-adapter
 * @description Stable Diffusion WebUI (A1111 / Forge / reForge / SD.Next) 适配器
 *
 * 1. 支持文生图、图生图与局部重绘；
 * 2. 格式化 LoRA 标签并拼入提示词；
 * 3. 支持通过 override_settings 指定模型与 CLIP Skip；
 * 4. 支持轮询 /sdapi/v1/progress 获取生成进度与预览；
 * 5. 支持调用 /sdapi/v1/interrupt 中断任务。
 */

import { BaseDriver, BaseDriverOptions } from './base-driver';
import { blobToBase64, base64ToBlob } from '../../../common/utils/binary';
import {
    EngineCapabilities,
    GenerationRequest,
    GenerationResult,
    HealthCheckResult,
    ProviderAssetCatalog,
    ProgressCallback,
    LoraItem,
    DriverError,
    DriverErrorType,
    ImageMetadata
} from '../types';

/** SD-WebUI 配置接口 */
export interface SdWebUIEngineConfig {
    serverUrl: string;
    model?: string;
    samplerName: string;
    scheduler?: string;
    steps: number;
    cfgScale: number;
    width: number;
    height: number;
    clipSkip?: number;
    loras?: LoraItem[];
    promptPrefix?: string;
    promptSuffix?: string;
    negativePrefix?: string;
    negativeSuffix?: string;
    enableHires?: boolean;
    hiresScale?: number;
    hiresUpscaler?: string;
    hiresSteps?: number;
    hiresDenoise?: number;
    denoisingStrength?: number;
    batchSize?: number;
    nIter?: number;
    [key: string]: unknown;
}

/** SD-WebUI 默认配置 */
export const DEFAULT_SDWEBUI_CONFIG: SdWebUIEngineConfig = {
    serverUrl: 'http://127.0.0.1:7860',
    model: '',
    samplerName: 'Euler a',
    steps: 20,
    cfgScale: 7.0,
    width: 512,
    height: 768,
    clipSkip: 2,
    promptPrefix: '',
    promptSuffix: '',
    negativePrefix: '',
    negativeSuffix: '',
    enableHires: false,
    hiresScale: 1.5,
    hiresUpscaler: 'R-ESRGAN 4x+ Anime6B',
    hiresSteps: 15,
    hiresDenoise: 0.45,
    denoisingStrength: 0.75,
    batchSize: 1,
    nIter: 1,
    loras: []
};

/** SD-WebUI 专属请求配置选项接口 */
export interface SdWebUIEngineOptions extends Partial<SdWebUIEngineConfig> {
    seed?: number;
    subseed?: number;
    subseedStrength?: number;
}

export interface SdWebUIAdapterOptions extends BaseDriverOptions {}

interface SdApiResponse {
    images?: string[];
    parameters?: Record<string, unknown>;
    info?: string;
}

interface ProgressResponse {
    progress?: number;
    eta_relative?: number;
    state?: {
        skipped?: boolean;
        interrupted?: boolean;
        job?: string;
        job_count?: number;
        job_timestamp?: string;
        job_no?: number;
        sampling_step?: number;
        sampling_steps?: number;
    };
    current_image?: string;
}

export class SdWebUIAdapter extends BaseDriver {
    public readonly id = 'sdwebui';
    public readonly name = 'SD WebUI';
    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: true,
        lora: true,
        progressWebSocket: false,
        interrupt: true,
        syntaxType: 'tagBased'
    };


    constructor(options: SdWebUIAdapterOptions) {
        super(options);
    }


    public override async checkHealth(): Promise<HealthCheckResult> {
        const start = performance.now();
        try {
            await this.getJson<Record<string, unknown>>('/sdapi/v1/options', { timeoutMs: 5000 });
            return {
                ok: true,
                latencyMs: Math.round(performance.now() - start)
            };
        } catch (err: any) {
            const latencyMs = Math.round(performance.now() - start);
            return {
                ok: false,
                latencyMs,
                statusCode: err instanceof DriverError ? err.statusCode : undefined,
                message: err?.message || '无法连接到 SD-WebUI，请检查服务地址并确保后端启动参数包含 --api'
            };
        }
    }

    /**
     * 将结构化 LoRA 配置格式化为 A1111 标签 (<lora:name:modelWeight:clipWeight> 或 <lora:name:modelWeight>)
     *
     * @param lora LoRA 配置项
     * @returns 格式化后的 A1111 标签字符串
     */
    public formatLoraTag(lora: LoraItem): string {
        const cleanName = (lora.name || '').replace(/\.(safetensors|ckpt|pt|pth)$/i, '').trim();
        if (!cleanName) return '';
        const mWeight = lora.weight ?? 1.0;
        if (lora.clipWeight !== undefined && lora.clipWeight !== mWeight) {
            return `<lora:${cleanName}:${mWeight}:${lora.clipWeight}>`;
        }
        return `<lora:${cleanName}:${mWeight}>`;
    }

    protected override async doSyncAssets(): Promise<ProviderAssetCatalog> {
        const [models, samplers, schedulers, upscalers, loras] = await Promise.all([
            this.getModels(),
            this.getSamplers(),
            this.getSchedulers(),
            this.getUpscalers(),
            this.getLoras()
        ]);

        return {
            models,
            samplers,
            schedulers,
            upscalers,
            loras
        };
    }

    protected override async doGenerate(
        request: GenerationRequest,
        signal?: AbortSignal,
        onProgress?: ProgressCallback
    ): Promise<GenerationResult> {
        const startTime = performance.now();
        const options: SdWebUIEngineOptions = {
            ...(this._getConfig?.() as SdWebUIEngineOptions | undefined),
            ...(request.engineOptions as SdWebUIEngineOptions)
        };

        // 组装正向提示词（前缀 + 正文 + 后缀）
        const promptParts: string[] = [];
        if (options.promptPrefix?.trim()) promptParts.push(options.promptPrefix.trim());
        if (request.prompt?.trim()) promptParts.push(request.prompt.trim());
        if (options.promptSuffix?.trim()) promptParts.push(options.promptSuffix.trim());
        let finalPrompt = promptParts.join(', ');

        const loras = options.loras || [];
        if (Array.isArray(loras) && loras.length > 0) {
            const loraTags = loras
                .filter((l) => Boolean(l.name) && l.enabled !== false)
                .map((l) => this.formatLoraTag(l))
                .filter(Boolean);

            for (const tag of loraTags) {
                if (!finalPrompt.includes(tag)) {
                    finalPrompt = finalPrompt ? `${finalPrompt} ${tag}` : tag;
                }
            }
        }

        // 组装负向提示词（前缀 + 正文 + 后缀）
        const negParts: string[] = [];
        if (options.negativePrefix?.trim()) negParts.push(options.negativePrefix.trim());
        if (request.negativePrompt?.trim()) negParts.push(request.negativePrompt.trim());
        if (options.negativeSuffix?.trim()) negParts.push(options.negativeSuffix.trim());
        const finalNegativePrompt = negParts.join(', ');

        const overrideSettings: Record<string, unknown> = {};
        if (options.model) {
            overrideSettings.sd_model_checkpoint = options.model;
        }
        if (typeof options.clipSkip === 'number') {
            overrideSettings.CLIP_stop_at_last_layers = options.clipSkip;
        }

        const width = options.width ?? 512;
        const height = options.height ?? 768;
        const seed = typeof options.seed === 'number' && options.seed >= 0
            ? options.seed
            : -1;

        const requestBody: Record<string, unknown> = {
            prompt: finalPrompt,
            negative_prompt: finalNegativePrompt,
            seed,
            steps: options.steps ?? 20,
            cfg_scale: options.cfgScale ?? 7.0,
            sampler_name: options.samplerName || 'Euler a',
            width,
            height,
            override_settings: overrideSettings,
            override_settings_restore_afterwards: true,
            send_images: true,
            save_images: false
        };

        if (options.scheduler) {
            requestBody.scheduler = options.scheduler;
        }
        if (typeof options.subseed === 'number') {
            requestBody.subseed = options.subseed;
        }
        if (typeof options.subseedStrength === 'number') {
            requestBody.subseed_strength = options.subseedStrength;
        }
        if (typeof options.batchSize === 'number') {
            requestBody.batch_size = options.batchSize;
        }
        if (typeof options.nIter === 'number') {
            requestBody.n_iter = options.nIter;
        }

        // 根据是否有参考底图区分图生图/重绘与文生图
        let targetEndpoint = '/sdapi/v1/txt2img';
        const initBlob = request.imageInputs?.initImageBlob;
        const maskBlob = request.imageInputs?.maskImageBlob;

        if (initBlob) {
            targetEndpoint = '/sdapi/v1/img2img';
            const initBase64 = await blobToBase64(initBlob);
            requestBody.init_images = [initBase64];
            requestBody.denoising_strength = request.imageInputs?.denoiseStrength
                ?? options.denoisingStrength
                ?? 0.75;

            if (maskBlob) {
                const maskBase64 = await blobToBase64(maskBlob);
                requestBody.mask = maskBase64;
            }
        } else if (options.enableHires) {
            requestBody.enable_hr = true;
            requestBody.hr_scale = options.hiresScale ?? 2.0;
            requestBody.hr_upscaler = options.hiresUpscaler || 'R-ESRGAN 4x+ Anime6B';
            requestBody.hr_second_pass_steps = options.hiresSteps ?? 15;
            requestBody.denoising_strength = options.hiresDenoise ?? 0.5;
        }

        // 受控递归轮询进度，避免并发堆叠，请求完成后才安排下一次探测
        let isPollingActive = Boolean(onProgress);
        let pollTimer: ReturnType<typeof setTimeout> | null = null;
        const pollProgress = async () => {
            if (!isPollingActive || this._cancelled || signal?.aborted) return;
            try {
                const prog = await this.getJson<ProgressResponse>('/sdapi/v1/progress?skip_current_image=true', {
                    timeoutMs: 3000,
                    signal
                });
                if (isPollingActive && prog && typeof prog.progress === 'number') {
                    const previewUrl = prog.current_image
                        ? `data:image/png;base64,${prog.current_image}`
                        : undefined;
                    onProgress?.(prog.progress, previewUrl);
                }
            } catch {
                // 轮询偶发异常不中断主生图流程
            } finally {
                if (isPollingActive && !this._cancelled && !signal?.aborted) {
                    pollTimer = setTimeout(pollProgress, 800);
                }
            }
        };

        if (isPollingActive) {
            pollTimer = setTimeout(pollProgress, 500);
        }

        let response: SdApiResponse;
        try {
            response = await this.postJson<SdApiResponse>(targetEndpoint, requestBody, { signal });
        } finally {
            isPollingActive = false;
            if (pollTimer) {
                clearTimeout(pollTimer);
                pollTimer = null;
            }
        }

        this.checkCancelled();

        if (!response?.images || !Array.isArray(response.images) || response.images.length === 0) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'SD-WebUI 未返回任何图像数据');
        }

        // 从后端 info JSON 中提取独立种子列表与当前主种子
        let rawImages = response.images;
        let allSeeds: number[] = [];
        let resolvedSeed: number | undefined;

        if (response.info) {
            try {
                const parsedInfo = JSON.parse(response.info);
                if (Array.isArray(parsedInfo.all_seeds)) {
                    allSeeds = parsedInfo.all_seeds.filter((s: unknown): s is number => typeof s === 'number');
                }
                if (typeof parsedInfo.seed === 'number') {
                    resolvedSeed = parsedInfo.seed;
                }
            } catch {
                // 忽略非关键 info 解析异常
            }
        }
        if (resolvedSeed === undefined && typeof seed === 'number' && seed >= 0) {
            resolvedSeed = seed;
        }

        // 当返回图像数大于种子数量 (多图生成时 A1111 默认在首位附加 Grid 拼图)，自动过滤首张拼图仅保留单图
        if (allSeeds.length > 0 && rawImages.length > allSeeds.length) {
            rawImages = rawImages.slice(rawImages.length - allSeeds.length);
        }

        const totalDurationMs = Math.round(performance.now() - startTime);
        const images = rawImages.map((b64, idx) => ({
            blob: base64ToBlob(b64, 'image/png'),
            format: 'image/png',
            seed: allSeeds[idx] ?? resolvedSeed,
            metadata: {
                info: response.info,
                parameters: response.parameters
            }
        }));

        return {
            taskId: request.taskId,
            engine: this.id,
            images,
            durationMs: totalDurationMs
        };
    }

    public override async interrupt(taskId?: string): Promise<void> {
        await super.interrupt(taskId);
        try {
            await this.postJson('/sdapi/v1/interrupt', {}, { timeoutMs: 3000 });
        } catch (e) {
            this.logger.warn('向 SD-WebUI 发送中断请求失败', e);
        }
    }

    /** 从请求与生成结果中提取标准 ImageMetadata.engineParams */
    public extractMetadata(request: GenerationRequest, result: GenerationResult): Record<string, unknown> {
        const options: SdWebUIEngineOptions = {
            ...(this._getConfig?.() as SdWebUIEngineOptions | undefined),
            ...(request.engineOptions as SdWebUIEngineOptions)
        };

        const firstImage = result.images[0];
        const seed = firstImage?.seed ?? options.seed;

        return {
            engine: this.id,
            steps: options.steps ?? 20,
            cfgScale: options.cfgScale ?? 7.0,
            samplerName: options.samplerName || 'Euler a',
            scheduler: options.scheduler,
            width: options.width ?? 512,
            height: options.height ?? 768,
            seed,
            model: options.model,
            clipSkip: options.clipSkip,
            loras: options.loras,
            enableHires: options.enableHires,
            hiresScale: options.hiresScale,
            hiresUpscaler: options.hiresUpscaler,
            hiresSteps: options.hiresSteps,
            hiresDenoise: options.hiresDenoise,
            denoisingStrength: options.denoisingStrength
        };
    }

    /** 从元数据中恢复可用于 GenerationRequest.engineOptions 的配置字典 */
    public restoreParameters(metadata: ImageMetadata): Record<string, unknown> {
        const params = metadata.engineParams || {};
        return {
            steps: params.steps,
            cfgScale: params.cfgScale,
            samplerName: params.samplerName,
            scheduler: params.scheduler,
            width: params.width ?? metadata.dimensions?.width,
            height: params.height ?? metadata.dimensions?.height,
            seed: params.seed,
            model: params.model,
            clipSkip: params.clipSkip,
            loras: params.loras,
            enableHires: params.enableHires,
            hiresScale: params.hiresScale,
            hiresUpscaler: params.hiresUpscaler,
            hiresSteps: params.hiresSteps,
            hiresDenoise: params.hiresDenoise,
            denoisingStrength: params.denoisingStrength
        };
    }

    public async getModels(): Promise<string[]> {
        try {
            const data = await this.getJson<Array<{ title?: string; model_name?: string }>>('/sdapi/v1/sd-models', { timeoutMs: 8000 });
            if (Array.isArray(data)) {
                return data.map((m) => m.title || m.model_name || '').filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('获取 SD-WebUI Checkpoint 列表失败', err);
        }
        return [];
    }

    public async getSamplers(): Promise<string[]> {
        try {
            const data = await this.getJson<Array<{ name?: string }>>('/sdapi/v1/samplers', { timeoutMs: 8000 });
            if (Array.isArray(data)) {
                return data.map((s) => s.name || '').filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('获取 SD-WebUI 采样器列表失败', err);
        }
        return [];
    }

    public async getSchedulers(): Promise<string[]> {
        try {
            const data = await this.getJson<Array<{ name?: string }>>('/sdapi/v1/schedulers', { timeoutMs: 8000 });
            if (Array.isArray(data)) {
                return data.map((s) => s.name || '').filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('获取 SD-WebUI 调度器列表失败 (老版本可能不支持)', err);
        }
        return [];
    }

    public async getUpscalers(): Promise<string[]> {
        try {
            const data = await this.getJson<Array<{ name?: string }>>('/sdapi/v1/upscalers', { timeoutMs: 8000 });
            if (Array.isArray(data)) {
                return data.map((u) => u.name || '').filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('获取 SD-WebUI 放大算法列表失败', err);
        }
        return [];
    }

    public async getLoras(): Promise<string[]> {
        try {
            const data = await this.getJson<Array<{ name?: string; alias?: string }>>('/sdapi/v1/loras', { timeoutMs: 8000 });
            if (Array.isArray(data)) {
                return data.map((l) => l.name || l.alias || '').filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('获取 SD-WebUI LoRA 列表失败', err);
        }
        return [];
    }
}
