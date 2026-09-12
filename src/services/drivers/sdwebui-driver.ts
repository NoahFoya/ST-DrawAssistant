/**
 * Stable Diffusion WebUI (A1111 / Forge / reForge / SD.Next) 驱动
 * 支持文生图、图生图与重绘，支持 LoRA 标签拼装、override_settings 临时覆写与进度轮询中断。
 */

import { BaseDriver, BaseDriverOptions } from './base-driver';
import { blobToBase64, base64ToBlob } from '../../utils/binary';
import { joinPromptParts } from '../../pipeline/prompt-utils';
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
    ImageMetadata,
    ModelAssetItem
} from '../../types/driver';
import { detectModelArchitecture, detectModelFormatType } from './model-asset-utils';

export interface SDDrawingProfileData {
    model?: string;
    vae?: string;
    clipSkip?: number;
    width?: number;
    height?: number;
    samplerName?: string;
    scheduler?: string;
    steps?: number;
    cfgScale?: number;
    seed?: number;
    restoreFaces?: boolean;
    denoisingStrength?: number;
    enableHires?: boolean;
    hiresUpscaler?: string;
    hiresScale?: number;
    hiresSteps?: number;
    hiresDenoise?: number;
    promptProfileId?: string;
    [key: string]: unknown;
}

export interface SDPromptProfileData {
    promptPrefix?: string;
    promptSuffix?: string;
    negativePrompt?: string;
    loras?: LoraItem[];
    [key: string]: unknown;
}

export interface SdWebUIEngineConfig extends SDDrawingProfileData, SDPromptProfileData {
    serverUrl: string;
    activeDrawingProfileId?: string;
    activePromptProfileId?: string;
    batchSize?: number;
    nIter?: number;
    [key: string]: unknown;
}

export const DEFAULT_SDWEBUI_DRAWING_PROFILES: Array<{ id: string; name: string; data?: SDDrawingProfileData }> = [
    {
        id: 'default_sd15',
        name: 'SD 1.5 推荐预设',
        data: {
            model: '',
            vae: '',
            clipSkip: 2,
            samplerName: 'Euler a',
            scheduler: 'Automatic',
            steps: 20,
            cfgScale: 7.0,
            width: 512,
            height: 768,
            seed: -1,
            restoreFaces: false,
            denoisingStrength: 0.75,
            enableHires: false,
            hiresUpscaler: 'R-ESRGAN 4x+ Anime6B',
            hiresScale: 1.5,
            hiresSteps: 15,
            hiresDenoise: 0.45,
            promptProfileId: 'default_anime'
        }
    }
];

export const DEFAULT_SDWEBUI_PROMPT_PROFILES: Array<{ id: string; name: string; data?: SDPromptProfileData }> = [
    {
        id: 'default_anime',
        name: '默认二次元画风',
        data: {
            promptPrefix: 'masterpiece, best quality, ultra-detailed',
            promptSuffix: 'highly detailed, dynamic lighting',
            negativePrompt: 'lowres, bad anatomy, bad hands, text, blurry',
            loras: []
        }
    }
];

export const DEFAULT_SDWEBUI_CONFIG: SdWebUIEngineConfig = {
    serverUrl: 'http://127.0.0.1:7860',
    activeDrawingProfileId: 'default_sd15',
    activePromptProfileId: 'default_anime',
    model: '',
    vae: '',
    clipSkip: 2,
    samplerName: 'Euler a',
    scheduler: 'Automatic',
    steps: 20,
    cfgScale: 7.0,
    width: 512,
    height: 768,
    seed: -1,
    restoreFaces: false,
    denoisingStrength: 0.75,
    enableHires: false,
    hiresScale: 1.5,
    hiresUpscaler: 'R-ESRGAN 4x+ Anime6B',
    hiresSteps: 15,
    hiresDenoise: 0.45,
    promptPrefix: 'masterpiece, best quality, ultra-detailed',
    promptSuffix: 'highly detailed, dynamic lighting',
    negativePrompt: 'lowres, bad anatomy, bad hands, text, blurry',
    batchSize: 1,
    nIter: 1,
    loras: []
};

export interface SdWebUIEngineOptions extends Partial<SdWebUIEngineConfig> {
    seed?: number;
    subseed?: number;
    subseedStrength?: number;
}

export interface SdWebUIDriverOptions extends BaseDriverOptions {}

interface SdApiResponse {
    images?: string[];
    parameters?: Record<string, unknown>;
    info?: string;
}

export class SdWebUiDriver extends BaseDriver {
    public readonly id = 'sdwebui';
    public readonly name = 'SD WebUI';
    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: true,
        lora: true,
        interrupt: true,
        syntaxType: 'tagBased'
    };

    public getDefaultConfig(): Record<string, unknown> {
        return { ...DEFAULT_SDWEBUI_CONFIG };
    }

    constructor(options: SdWebUIDriverOptions) {
        super(options);
    }

    public override async checkHealth(): Promise<HealthCheckResult> {
        const start = performance.now();
        try {
            await this.getJson<Record<string, unknown>>('/sdapi/v1/options', { timeoutMs: 5000 });
            this._isConnected = true;
            return {
                ok: true,
                latencyMs: Math.round(performance.now() - start)
            };
        } catch (err: any) {
            this._isConnected = false;
            const latencyMs = Math.round(performance.now() - start);
            return {
                ok: false,
                latencyMs,
                statusCode: err instanceof DriverError ? err.statusCode : undefined,
                message: err?.message || '无法连接到 SD-WebUI，请确认启动参数包含 --api 与 --cors-allow-origins=*'
            };
        }
    }

    public override async interrupt(taskId?: string): Promise<void> {
        await super.interrupt(taskId);
        try {
            await this.postControlJson('/sdapi/v1/interrupt', {}, { timeoutMs: 3000 });
            this.logger.info('已向 SD-WebUI 发送中断请求');
        } catch (err) {
            this.logger.debug('向 SD-WebUI 发送中断请求失败', err);
        }
    }

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
        const [modelsRes, samplersRes, schedulersRes, upscalersRes, lorasRes, vaesRes] = await Promise.allSettled([
            this.getModels(),
            this.getSamplers(),
            this.getSchedulers(),
            this.getUpscalers(),
            this.getLoras(),
            this.getVaes()
        ]);

        return {
            models: modelsRes.status === 'fulfilled' ? modelsRes.value : [],
            samplers: samplersRes.status === 'fulfilled' ? samplersRes.value : [],
            schedulers: schedulersRes.status === 'fulfilled' ? schedulersRes.value : [],
            upscalers: upscalersRes.status === 'fulfilled' ? upscalersRes.value : [],
            loras: lorasRes.status === 'fulfilled' ? lorasRes.value : [],
            vaes: vaesRes.status === 'fulfilled' ? vaesRes.value : []
        };
    }

    /**
     * 启动进度轮询。在长请求进行的同时并发轮询 /sdapi/v1/progress。
     */
    private _startProgressPolling(
        onProgress?: ProgressCallback,
        signal?: AbortSignal
    ): () => void {
        if (!onProgress) {
            return () => {};
        }

        let isStopped = false;
        let pollTimer: ReturnType<typeof setTimeout> | null = null;

        const pollOnce = async () => {
            if (isStopped || signal?.aborted) return;
            try {
                const data = await this.getJson<{
                    progress?: number;
                    eta_relative?: number;
                    state?: {
                        sampling_step?: number;
                        sampling_steps?: number;
                    };
                    current_image?: string;
                }>('/sdapi/v1/progress?skip_current_image=false', { timeoutMs: 3000 });

                if (!isStopped && !signal?.aborted && data) {
                    const ratio = typeof data.progress === 'number' ? Math.max(0, Math.min(1, data.progress)) : 0;
                    const previewUrl = data.current_image ? `data:image/png;base64,${data.current_image}` : undefined;
                    onProgress(ratio, previewUrl);
                }
            } catch {
                // 轮询偶发失败不影响主生图流程
            } finally {
                if (!isStopped && !signal?.aborted) {
                    pollTimer = setTimeout(pollOnce, 600);
                }
            }
        };

        pollTimer = setTimeout(pollOnce, 400);

        return () => {
            isStopped = true;
            if (pollTimer) {
                clearTimeout(pollTimer);
                pollTimer = null;
            }
        };
    }

    protected override async doGenerate(
        request: GenerationRequest,
        signal?: AbortSignal,
        onProgress?: ProgressCallback
    ): Promise<GenerationResult> {
        const startTime = performance.now();
        const rawOptions: SdWebUIEngineOptions = {
            ...(this._getConfig?.() as SdWebUIEngineOptions | undefined),
            ...(request.engineOptions as SdWebUIEngineOptions)
        };

        let options: SdWebUIEngineOptions = { ...rawOptions };
        const drawingProfiles: any[] = (rawOptions as any).drawingProfiles || [];
        const activeDrawingId = (rawOptions as any).activeDrawingProfileId;

        if (drawingProfiles.length > 0 && activeDrawingId) {
            const activeProfile = drawingProfiles.find((p) => p.id === activeDrawingId)?.data;
            if (activeProfile) {
                options = { ...options, ...activeProfile };

                const promptProfiles: any[] = (rawOptions as any).promptProfiles || [];
                const promptProfileId = activeProfile.promptProfileId || (rawOptions as any).activePromptProfileId;
                if (promptProfileId && promptProfiles.length > 0) {
                    const promptProf = promptProfiles.find((p) => p.id === promptProfileId)?.data;
                    if (promptProf) {
                        options.promptPrefix = promptProf.promptPrefix;
                        options.promptSuffix = promptProf.promptSuffix;
                        options.negativePrompt = promptProf.negativePrompt;
                        options.loras = promptProf.loras || [];
                    }
                }
            }
        }

        let finalPrompt = joinPromptParts(options.promptPrefix, request.prompt, options.promptSuffix);

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

        const finalNegativePrompt = joinPromptParts(
            options.negativePrompt,
            request.negativePrompt
        );

        const overrideSettings: Record<string, unknown> = {};
        if (options.model) {
            overrideSettings.sd_model_checkpoint = options.model;
        }
        if (options.vae && options.vae !== 'None' && options.vae !== 'Automatic') {
            overrideSettings.sd_vae = options.vae;
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

        if (options.restoreFaces) {
            requestBody.restore_faces = true;
        }
        if (options.scheduler) {
            requestBody.scheduler = options.scheduler;
        }
        if (typeof options.subseed === 'number') {
            requestBody.subseed = options.subseed;
        }
        if (typeof options.subseedStrength === 'number') {
            requestBody.subseed_strength = options.subseedStrength;
        }
        requestBody.batch_size = 1;
        requestBody.n_iter = 1;

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

        const stopProgressPolling = this._startProgressPolling(onProgress, signal);

        let response: SdApiResponse;
        try {
            response = await this.postJson<SdApiResponse>(targetEndpoint, requestBody, { signal });
        } finally {
            stopProgressPolling();
        }

        this.checkCancelled();

        if (!response?.images || !Array.isArray(response.images) || response.images.length === 0) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'SD-WebUI 未返回有效图像数据');
        }

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

        // 多图生成时 A1111 默认首张为 Grid 拼接图，依据种子数自动裁切仅保留单图
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

    public async getModels(): Promise<ModelAssetItem[]> {
        try {
            const data = await this.getJson<Array<{
                title?: string;
                model_name?: string;
                filename?: string;
                config?: string;
                hash?: string;
            }>>('/sdapi/v1/sd-models', { timeoutMs: 8000 });
            if (Array.isArray(data)) {
                return data.map((m) => {
                    const rawName = m.title || m.model_name || '';
                    const filename = m.filename || rawName;
                    const formatType = detectModelFormatType(filename, 'checkpoint');
                    const arch = detectModelArchitecture(filename, m.config);
                    return {
                        name: rawName,
                        title: m.title || m.model_name || '',
                        type: formatType,
                        architecture: arch,
                        hash: m.hash,
                        filename: m.filename
                    };
                }).filter((item) => Boolean(item.name));
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

    public async getVaes(): Promise<string[]> {
        try {
            const data = await this.getJson<Array<{ model_name?: string }>>('/sdapi/v1/sd-vae', { timeoutMs: 8000 });
            if (Array.isArray(data)) {
                return data.map((v) => v.model_name || '').filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('获取 SD-WebUI VAE 列表失败', err);
        }
        return [];
    }
}
