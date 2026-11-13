/**
 * SD-WebUI / Forge 绘图服务提供方适配器 (SdWebUIProvider)。
 *
 * 基于 A1111 HTTP API 对接 SD-WebUI / Forge / SD.Next 服务端：
 * 1. 直接转发提示词与负向提示词；
 * 2. 通过 override_settings 设置任务模型并在出图后自动还原；
 * 3. 提交 txt2img 请求并等待出图；
 * 4. 取消时中止本地网络等待，不触发服务端全局中断。
 */

import type {
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    ImageGenerationMetadata,
    SDWebUIProviderConfig,
    DrawingPresetData,
} from '@types';
import { BaseGenerationProvider, type BaseProviderOptions } from '../base-provider';
import { base64ToBlob, imageInputToBase64 } from '../../util/http-client';

/** SD-WebUI 提供方初始化配置项 */
export interface SdWebUIProviderOptions extends BaseProviderOptions {}

/**
 * SD-WebUI / Forge 绘图服务提供方实现类。
 */
export class SdWebUIProvider extends BaseGenerationProvider {
    public readonly providerType: ProviderType = 'sdwebui';
    public readonly name: string = 'SD-WebUI';

    /** 资产短时内存缓存过期时间 (60 秒) */
    public static readonly ASSET_CACHE_TTL_MS = 60_000;

    private _modelsCache: { data: string[]; timestamp: number; serverUrl: string } | null = null;
    private _vaesCache: { data: string[]; timestamp: number; serverUrl: string } | null = null;
    private _samplersCache: { data: string[]; timestamp: number; serverUrl: string } | null = null;
    private _lorasCache: { data: string[]; timestamp: number; serverUrl: string } | null = null;

    private _inFlightModels: Promise<string[]> | null = null;
    private _inFlightVaes: Promise<string[]> | null = null;
    private _inFlightSamplers: Promise<string[]> | null = null;
    private _inFlightLoras: Promise<string[]> | null = null;

    public constructor(options: SdWebUIProviderOptions = {}) {
        super(options);
    }

    /**
     * 清空当前提供方内存中的资产缓存与进行中的请求单飞状态。
     */
    public clearAssetCache(): void {
        this._modelsCache = null;
        this._vaesCache = null;
        this._samplersCache = null;
        this._lorasCache = null;
        this._inFlightModels = null;
        this._inFlightVaes = null;
        this._inFlightSamplers = null;
        this._inFlightLoras = null;
    }

    /**
     * 获取 SD-WebUI 服务基础地址。
     *
     * @remarks
     * 读取配置中心的 SD-WebUI 服务地址，未配置时缺省为默认本地地址 (http://127.0.0.1:7860)。
     * 自动规整末尾斜杠以确保 URL 拼接的一致性。
     */
    public getServerUrl(): string {
        const config = this._settingsStore?.getProviderConfig<SDWebUIProviderConfig>('sdwebui');
        if (config?.serverUrl) {
            return this.normalizeUrl(config.serverUrl);
        }
        return 'http://127.0.0.1:7860';
    }

    /**
     * 检查 SD-WebUI 服务连通性。
     *
     * @param signal 中止信号
     */
    public async checkHealth(signal?: AbortSignal): Promise<ProviderHealthResult> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        // GET /sdapi/v1/samplers 作为连通性探针，能响应 2xx 即视为服务可达
        const probeUrl = `${serverUrl}/sdapi/v1/samplers`;

        const pingResult = await this._httpClient.ping(probeUrl, {
            transport,
            signal,
            timeoutMs: 5000,
        });

        if (pingResult.ok) {
            return {
                status: 'ok',
                latencyMs: pingResult.latencyMs,
                message: `SD-WebUI 响应正常 (${pingResult.latencyMs}ms)`,
            };
        }

        return {
            status: 'error',
            latencyMs: pingResult.latencyMs,
            message: pingResult.error || `连接失败 (HTTP ${pingResult.status ?? 'unknown'})`,
        };
    }

    /**
     * 获取 SD-WebUI 服务端已加载的模型列表。
     *
     * @remarks
     * 支持单飞并发合并与 60 秒短时内存缓存，避免频繁拉取模型造成网络冗余与宿主代理拥塞。
     *
     * @param signal 中止信号
     * @param forceRefresh 是否强制忽略缓存拉取最新数据
     * @returns 可用模型名称数组
     */
    public async fetchModels(signal?: AbortSignal, forceRefresh = false): Promise<string[]> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const now = Date.now();

        if (
            !forceRefresh &&
            this._modelsCache &&
            this._modelsCache.serverUrl === serverUrl &&
            now - this._modelsCache.timestamp < SdWebUIProvider.ASSET_CACHE_TTL_MS
        ) {
            return this._modelsCache.data;
        }

        if (this._inFlightModels) {
            return this._inFlightModels;
        }

        const url = `${serverUrl}/sdapi/v1/sd-models`;
        const fetchPromise = (async () => {
            try {
                const response = await this.fetchWithTransport(
                    url,
                    { method: 'GET', timeoutMs: 15000, signal },
                    transport
                );
                const data = (await response.json()) as Array<{ title?: string; model_name?: string }>;

                if (!Array.isArray(data)) {
                    return [];
                }

                const models = data
                    .map((m) => m.title ?? m.model_name ?? '')
                    .filter((name) => name.trim().length > 0);
                this._modelsCache = { data: models, timestamp: Date.now(), serverUrl };
                return models;
            } finally {
                this._inFlightModels = null;
            }
        })();

        this._inFlightModels = fetchPromise;
        return fetchPromise;
    }

    /**
     * 获取 SD-WebUI 服务端已加载的 VAE 模型列表。
     *
     * @remarks
     * 支持单飞并发合并与 60 秒短时内存缓存。
     *
     * @param signal 中止信号
     * @param forceRefresh 是否强制忽略缓存拉取最新数据
     * @returns 可用 VAE 模型名称数组
     */
    public async fetchVaes(signal?: AbortSignal, forceRefresh = false): Promise<string[]> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const now = Date.now();

        if (
            !forceRefresh &&
            this._vaesCache &&
            this._vaesCache.serverUrl === serverUrl &&
            now - this._vaesCache.timestamp < SdWebUIProvider.ASSET_CACHE_TTL_MS
        ) {
            return this._vaesCache.data;
        }

        if (this._inFlightVaes) {
            return this._inFlightVaes;
        }

        const url = `${serverUrl}/sdapi/v1/sd-vae`;
        const fetchPromise = (async () => {
            try {
                const response = await this.fetchWithTransport(
                    url,
                    { method: 'GET', timeoutMs: 15000, signal },
                    transport
                );
                const data = (await response.json()) as Array<{ model_name?: string }>;

                if (!Array.isArray(data)) {
                    return [];
                }

                const vaes = data
                    .map((m) => m.model_name ?? '')
                    .filter((name) => name.trim().length > 0);
                this._vaesCache = { data: vaes, timestamp: Date.now(), serverUrl };
                return vaes;
            } finally {
                this._inFlightVaes = null;
            }
        })();

        this._inFlightVaes = fetchPromise;
        return fetchPromise;
    }

    /**
     * 获取 SD-WebUI 服务端支持的采样器列表。
     *
     * @remarks
     * 支持单飞并发合并与 60 秒短时内存缓存。
     *
     * @param signal 中止信号
     * @param forceRefresh 是否强制忽略缓存拉取最新数据
     * @returns 可用采样器名称数组
     */
    public async fetchSamplers(signal?: AbortSignal, forceRefresh = false): Promise<string[]> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const now = Date.now();

        if (
            !forceRefresh &&
            this._samplersCache &&
            this._samplersCache.serverUrl === serverUrl &&
            now - this._samplersCache.timestamp < SdWebUIProvider.ASSET_CACHE_TTL_MS
        ) {
            return this._samplersCache.data;
        }

        if (this._inFlightSamplers) {
            return this._inFlightSamplers;
        }

        const url = `${serverUrl}/sdapi/v1/samplers`;
        const fetchPromise = (async () => {
            try {
                const response = await this.fetchWithTransport(
                    url,
                    { method: 'GET', timeoutMs: 15000, signal },
                    transport
                );
                const data = (await response.json()) as Array<{ name?: string }>;

                if (!Array.isArray(data)) {
                    return [];
                }

                const samplers = data
                    .map((s) => s.name ?? '')
                    .filter((name) => name.trim().length > 0);
                this._samplersCache = { data: samplers, timestamp: Date.now(), serverUrl };
                return samplers;
            } finally {
                this._inFlightSamplers = null;
            }
        })();

        this._inFlightSamplers = fetchPromise;
        return fetchPromise;
    }

    /**
     * 获取 SD-WebUI 服务端已加载的 LoRA 模型列表。
     *
     * @remarks
     * 支持单飞并发合并与 60 秒短时内存缓存。
     *
     * @param signal 中止信号
     * @param forceRefresh 是否强制忽略缓存拉取最新数据
     * @returns 可用 LoRA 模型名称数组
     */
    public async fetchLoras(signal?: AbortSignal, forceRefresh = false): Promise<string[]> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const now = Date.now();

        if (
            !forceRefresh &&
            this._lorasCache &&
            this._lorasCache.serverUrl === serverUrl &&
            now - this._lorasCache.timestamp < SdWebUIProvider.ASSET_CACHE_TTL_MS
        ) {
            return this._lorasCache.data;
        }

        if (this._inFlightLoras) {
            return this._inFlightLoras;
        }

        const url = `${serverUrl}/sdapi/v1/loras`;
        const fetchPromise = (async () => {
            try {
                const response = await this.fetchWithTransport(
                    url,
                    { method: 'GET', timeoutMs: 15000, signal },
                    transport
                );
                const data = (await response.json()) as Array<{ name?: string; alias?: string }>;

                if (!Array.isArray(data)) {
                    return [];
                }

                const loras = data
                    .map((item) => item.name ?? item.alias ?? '')
                    .filter((name) => name.trim().length > 0);
                this._lorasCache = { data: loras, timestamp: Date.now(), serverUrl };
                return loras;
            } finally {
                this._inFlightLoras = null;
            }
        })();

        this._inFlightLoras = fetchPromise;
        return fetchPromise;
    }

    /**
     * 执行 SD-WebUI 图像生成任务（txt2img）。
     *
     * 包含以下流程：
     * 1. 读取绘图预设与调用参数，装配请求体与 override_settings；
     * 2. 发起 txt2img 请求并等待生成结果；
     * 3. 将响应的 Base64 图片转换为 PNG Blob 并封装元数据返回。
     *
     * @param request 生图请求参数
     * @param signal 中止信号
     * @returns 包含图像 Blob 与生成元数据的生成结果
     */
    public async generate(
        request: GenerationRequest,
        signal?: AbortSignal
    ): Promise<GenerationResult> {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        const startTime = Date.now();
        const transport = this.getTransport();
        const serverUrl = this.getServerUrl();
        const params = request.parameters ?? {};
        const maxTimeoutMs = this.getTimeoutMs();

        // 1. 读取激活预设与常规绘图超参数
        let drawingPreset: DrawingPresetData | undefined;
        if (this._settingsStore) {
            const config = this._settingsStore.getProviderConfig<SDWebUIProviderConfig>('sdwebui');
            const activeDrawingId = config?.activeDrawingPresetId;
            if (activeDrawingId) {
                drawingPreset = this._settingsStore.getPreset<DrawingPresetData>(
                    'drawing',
                    activeDrawingId,
                    'sdwebui'
                )?.data;
                if (!drawingPreset) {
                    throw new Error(`当前激活的绘图预设已失效或不存在 (ID: ${activeDrawingId})，请重新选择预设`);
                }
            }
        }

        const resolvedSteps = (params.steps ?? drawingPreset?.steps) as number | undefined;
        const resolvedCfgScale = (params.cfgScale ?? drawingPreset?.cfgScale) as number | undefined;
        const resolvedSamplerName = (params.samplerName ?? drawingPreset?.samplerName) as string | undefined;
        const resolvedScheduler = (params.scheduler ?? drawingPreset?.scheduler) as string | undefined;
        const resolvedWidth = (params.width ?? drawingPreset?.width) as number | undefined;
        const resolvedHeight = (params.height ?? drawingPreset?.height) as number | undefined;
        const resolvedSeed = (params.seed ?? drawingPreset?.seed ?? -1) as number;
        const resolvedBaseModel = (params.baseModel ?? drawingPreset?.baseModel) as string | undefined;
        const resolvedClipSkip = (params.clipSkip ?? drawingPreset?.clipSkip) as number | undefined;
        const resolvedVae = (params.vaeName ?? drawingPreset?.vaeName) as string | undefined;

        const fullPrompt = request.prompt;
        const fullNegativePrompt = request.negativePrompt || '';

        // 2. 构建 override_settings（按任务切换模型，完成后自动还原）
        const overrideSettings: Record<string, unknown> = {};
        if (resolvedBaseModel) {
            overrideSettings['sd_model_checkpoint'] = resolvedBaseModel;
        }
        if (resolvedClipSkip !== undefined) {
            overrideSettings['CLIP_stop_at_last_layers'] = resolvedClipSkip;
        }
        if (resolvedVae && resolvedVae !== 'automatic' && resolvedVae.trim().length > 0) {
            overrideSettings['sd_vae'] = resolvedVae;
        }

        // 3. 装配 txt2img 请求体
        const requestBody: Record<string, unknown> = {
            prompt: fullPrompt,
            negative_prompt: fullNegativePrompt,
            seed: resolvedSeed,
            batch_size: 1,
            n_iter: 1,
            override_settings_restore_afterwards: true,
        };

        if (resolvedSteps !== undefined) requestBody['steps'] = resolvedSteps;
        if (resolvedCfgScale !== undefined) requestBody['cfg_scale'] = resolvedCfgScale;
        if (resolvedSamplerName !== undefined) requestBody['sampler_name'] = resolvedSamplerName;
        if (resolvedScheduler !== undefined) requestBody['scheduler'] = resolvedScheduler;
        if (resolvedWidth !== undefined) requestBody['width'] = resolvedWidth;
        if (resolvedHeight !== undefined) requestBody['height'] = resolvedHeight;
        if (Object.keys(overrideSettings).length > 0) {
            requestBody['override_settings'] = overrideSettings;
        }

        const isInpaintMode = params.mode === 'inpaint';
        let endpoint = `${serverUrl}/sdapi/v1/txt2img`;

        if (isInpaintMode) {
            endpoint = `${serverUrl}/sdapi/v1/img2img`;
            const sourceImage = request.sourceImage;
            const maskImage = request.maskImage ?? params.maskImage;

            if (!sourceImage) {
                throw new Error('局部重绘模式下必须提供底图数据');
            }
            if (!maskImage) {
                throw new Error('局部重绘模式下必须提供遮罩蒙版数据');
            }

            const [initImageBase64, maskImageBase64] = await Promise.all([
                imageInputToBase64(sourceImage),
                imageInputToBase64(maskImage),
            ]);

            requestBody['init_images'] = [initImageBase64];
            requestBody['mask'] = maskImageBase64;
            requestBody['denoising_strength'] = params.denoiseStrength ?? 0.75;
            requestBody['mask_blur'] = params.maskBlur ?? 4;
            requestBody['inpainting_fill'] = 1;
            requestBody['inpaint_full_res'] = 0;
            requestBody['inpaint_full_res_padding'] = 32;
        } else {
            // 高清修复 (Hires. fix) 选配参数（仅在文生图模式生效）
            const enableHires = Boolean(params.enableHires ?? drawingPreset?.enableHires);
            if (enableHires) {
                requestBody['enable_hr'] = true;
                const hiresUpscaler = (params.hiresUpscaler ?? drawingPreset?.hiresUpscaler) as string | undefined;
                if (hiresUpscaler) requestBody['hr_upscaler'] = hiresUpscaler;
                const hiresScale = (params.hiresScale ?? drawingPreset?.hiresScale) as number | undefined;
                if (hiresScale !== undefined) requestBody['hr_scale'] = hiresScale;
                const hiresSteps = (params.hiresSteps ?? drawingPreset?.hiresSteps) as number | undefined;
                if (hiresSteps !== undefined) requestBody['hr_second_pass_steps'] = hiresSteps;
                const hiresDenoise = (params.hiresDenoise ?? drawingPreset?.hiresDenoise) as number | undefined;
                if (hiresDenoise !== undefined) requestBody['denoising_strength'] = hiresDenoise;
            }
        }

        // 4. 发起 HTTP 生图请求
        const resp = await this.fetchWithTransport(
            endpoint,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                timeoutMs: maxTimeoutMs,
                retries: 0,
                signal,
            },
            transport
        );

        if (!resp.ok) {
            const errBody = await resp.text().catch(() => '');
            throw new Error(`SD-WebUI 服务响应错误 (${resp.status}): ${errBody || resp.statusText}`);
        }

        // 5. 解析响应并转换图像二进制（A1111 images[] 末尾可能追加 grid 图，取第一张即为目标图）
        const generationResult = (await resp.json()) as Record<string, unknown>;
        const images = generationResult['images'];
        if (!Array.isArray(images) || images.length === 0) {
            throw new Error('SD-WebUI 返回结果中未包含图像数据');
        }

        const imageBase64 = images[0] as string;
        const blob = base64ToBlob(imageBase64, 'image/png');

        const durationMs = Date.now() - startTime;
        const infoStr = generationResult['info'];
        let parsedSeed: number | undefined;
        if (typeof infoStr === 'string') {
            try {
                const info = JSON.parse(infoStr) as Record<string, unknown>;
                if (typeof info['seed'] === 'number') {
                    parsedSeed = info['seed'];
                }
            } catch {
                // info 字段解析失败时忽略，使用原始入参 seed
            }
        }

        // 6. 装配生成元数据
        const metadata: ImageGenerationMetadata = {
            prompt: fullPrompt,
            negativePrompt: fullNegativePrompt || undefined,
            seed: parsedSeed ?? resolvedSeed,
            sampler: resolvedSamplerName,
            steps: resolvedSteps,
            cfgScale: resolvedCfgScale,
            engine: 'sdwebui',
            durationMs,
            baseModel: resolvedBaseModel,
            width: resolvedWidth,
            height: resolvedHeight,
            mode: isInpaintMode ? 'inpaint' : 'txt2img',
            denoiseStrength: isInpaintMode ? (params.denoiseStrength ?? 0.75) : undefined,
            maskBlur: isInpaintMode ? (params.maskBlur ?? 4) : undefined,
            parentImageId: (params as { parentImageId?: string }).parentImageId,
        };

        return {
            blob,
            metadata,
        };
    }
}
