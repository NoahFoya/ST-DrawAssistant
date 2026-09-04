/**
 * @module domain/drivers/sdwebui-adapter
 * @description Stable Diffusion WebUI (A1111 / Forge / reForge / SD.Next) 适配器实现
 *
 * 核心特性：
 * 1. 纯领域驱动设计，解耦全局 UI Store，运行时参数由 GenerationRequest.engineOptions 与初始化配置供给；
 * 2. 消费流水线分离好的 prompt 与 negativePrompt，完成 LoRA 标签格式化与拼装；
 * 3. 支持 txt2img、img2img 与蒙版局部重绘；
 * 4. 支持 override_settings 针对单次请求设置 Checkpoint 与 CLIP Skip；
 * 5. 支持在生图过程中并发轮询 /sdapi/v1/progress 上报执行进度与预览帧；
 * 6. 支持 /sdapi/v1/interrupt 中断与元数据提取/参数双向还原。
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

/** SD-WebUI 专属请求配置选项接口 */
export interface SdWebUIEngineOptions {
    steps?: number;
    cfgScale?: number;
    samplerName?: string;
    scheduler?: string;
    width?: number;
    height?: number;
    seed?: number;
    subseed?: number;
    subseedStrength?: number;
    model?: string;
    clipSkip?: number;
    loras?: LoraItem[];
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

export interface SdWebUIAdapterOptions extends BaseDriverOptions {
    defaultConfig?: SdWebUIEngineOptions;
}

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

    private readonly _defaultConfig: SdWebUIEngineOptions;

    constructor(options: SdWebUIAdapterOptions) {
        super(options);
        this._defaultConfig = options.defaultConfig || {};
    }

    public async ping(): Promise<boolean> {
        try {
            await this.getJson<Record<string, unknown>>('/sdapi/v1/options', { timeoutMs: 5000 });
            return true;
        } catch {
            return false;
        }
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
            ...this._defaultConfig,
            ...(request.engineOptions as SdWebUIEngineOptions)
        };

        let finalPrompt = (request.prompt || '').trim();
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
            negative_prompt: request.negativePrompt || '',
            seed,
            steps: options.steps ?? 20,
            cfg_scale: options.cfgScale ?? 7.0,
            sampler_name: options.samplerName || 'Euler a',
            width,
            height,
            override_settings: overrideSettings,
            override_settings_restore_afterwards: true
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

        // 独立并发轮询进度，避免阻塞生图主请求
        let progressInterval: any = null;
        if (onProgress) {
            progressInterval = setInterval(async () => {
                try {
                    const prog = await this.getJson<ProgressResponse>('/sdapi/v1/progress?skip_current_image=false', {
                        timeoutMs: 3000
                    });
                    if (prog && typeof prog.progress === 'number') {
                        const previewUrl = prog.current_image
                            ? `data:image/png;base64,${prog.current_image}`
                            : undefined;
                        onProgress(prog.progress, previewUrl);
                    }
                } catch {
                    // 轮询异常不中断主任务
                }
            }, 600);
        }

        let response: SdApiResponse;
        try {
            response = await this.postJson<SdApiResponse>(targetEndpoint, requestBody, { signal });
        } finally {
            if (progressInterval) {
                clearInterval(progressInterval);
            }
        }

        this.checkCancelled();

        if (!response?.images || !Array.isArray(response.images) || response.images.length === 0) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'SD-WebUI 未返回任何图像数据');
        }

        // 从后端 info JSON 中提取实际生效的随机种子，未提供时回退至请求种子
        let resolvedSeed: number | undefined;
        if (response.info) {
            try {
                const parsedInfo = JSON.parse(response.info);
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

        const totalDurationMs = Math.round(performance.now() - startTime);
        const images = response.images.map((b64) => ({
            blob: base64ToBlob(b64, 'image/png'),
            format: 'image/png',
            seed: resolvedSeed,
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
            ...this._defaultConfig,
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
