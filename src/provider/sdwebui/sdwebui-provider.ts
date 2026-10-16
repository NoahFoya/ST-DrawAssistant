/**
 * SD-WebUI / Forge 绘图服务提供方适配器 (SdWebUIProvider)。
 *
 * @remarks
 * 基于 A1111 兼容 HTTP API 对接 SD-WebUI / Forge / SD.Next 服务端：
 * 1. 模型按任务局部隔离：利用 A1111 协议专有字段 `override_settings` (sd_model_checkpoint/sd_vae/CLIP_stop_at_last_layers)
 *    配合 `override_settings_restore_afterwards: true`，实现任务级动态切换模型且不污染服务端全局默认底模；
 * 2. LoRA 标签拼装与防重：通过正则检测正向提示词中是否已包含同名 `<lora:name:`，自动拼接未声明的预设 LoRA；
 * 3. 进度监控与并发通信：生图 POST /sdapi/v1/txt2img 阻塞执行期间，并发轮询 /sdapi/v1/progress 获取步数与百分比；
 * 4. 客户端丢弃策略 (Client Discard)：取消时不向服务端调用破坏性的全局 /sdapi/v1/interrupt，
 *    仅中止本地 fetch 等待并回收本地轮询控制器，保证多客户端并发与共享实例的稳定性。
 */

import type {
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    TaskProgressCallback,
    ImageGenerationMetadata,
    SDWebUIProviderConfig,
    DrawingPresetData,
    PromptPresetData,
} from '@types';
import { BaseGenerationProvider, type BaseProviderOptions } from '../base-provider';
import { base64ToBlob } from '../../util/http-client';

/** SD-WebUI 提供方初始化配置项 */
export interface SdWebUIProviderOptions extends BaseProviderOptions {}

/**
 * 将 PromptPresetData.loras[] 拼装为 A1111 LoRA 标签字符串，支持提示词防重。
 *
 * @param loras LoRA 配置列表
 * @param existingPrompt 当前已存在的提示词文本，用于防重检测
 * @returns 追加至提示词的标签字符串，无 LoRA 或均已存在时返回空字符串
 */
export function buildLoraTagString(
    loras?: Array<{ name: string; weight: number; trigger?: string }>,
    existingPrompt = ''
): string {
    if (!loras || loras.length === 0) {
        return '';
    }
    const tags: string[] = [];
    for (const lora of loras) {
        const name = lora?.name?.trim();
        if (!name) continue;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`<lora:${escaped}:`, 'i');
        if (pattern.test(existingPrompt)) {
            continue;
        }
        tags.push(`<lora:${name}:${Number(lora.weight ?? 1)}>`);
    }
    return tags.join(' ');
}

/**
 * 将预设负向提示词（通用画质基底词）与用户单次负向提示词基底合并去重。
 *
 * @param presetNegative 预设通用负向提示词
 * @param userNegative 用户特定排除负向提示词
 * @returns 合并去重后的负向提示词字符串
 */
export function mergeNegativePrompts(presetNegative?: string, userNegative?: string): string {
    const p1 = (presetNegative ?? '').trim();
    const p2 = (userNegative ?? '').trim();
    if (!p1 && !p2) return '';
    if (!p1) return p2;
    if (!p2) return p1;

    const seen = new Set<string>();
    const tags: string[] = [];
    for (const part of `${p1}, ${p2}`.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            tags.push(trimmed);
        }
    }
    return tags.join(', ');
}

/**
 * SD-WebUI / Forge 绘图服务提供方实现类。
 */
export class SdWebUIProvider extends BaseGenerationProvider {
    public readonly providerType: ProviderType = 'sdwebui';
    public readonly name: string = 'SD-WebUI';

    public constructor(options: SdWebUIProviderOptions = {}) {
        super(options);
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
     * @param signal 中止信号
     * @returns 可用模型名称数组
     */
    public async fetchModels(signal?: AbortSignal): Promise<string[]> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const url = `${serverUrl}/sdapi/v1/sd-models`;

        const response = await this.fetchWithTransport(url, { method: 'GET', timeoutMs: 15000, signal }, transport);
        const data = (await response.json()) as Array<{ title?: string; model_name?: string }>;

        if (!Array.isArray(data)) {
            return [];
        }

        return data
            .map((m) => m.title ?? m.model_name ?? '')
            .filter((name) => name.trim().length > 0);
    }

    /**
     * 获取 SD-WebUI 服务端已加载的 VAE 模型列表。
     *
     * @param signal 中止信号
     * @returns 可用 VAE 模型名称数组
     */
    public async fetchVaes(signal?: AbortSignal): Promise<string[]> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const url = `${serverUrl}/sdapi/v1/sd-vae`;

        const response = await this.fetchWithTransport(url, { method: 'GET', timeoutMs: 15000, signal }, transport);
        const data = (await response.json()) as Array<{ model_name?: string }>;

        if (!Array.isArray(data)) {
            return [];
        }

        return data
            .map((m) => m.model_name ?? '')
            .filter((name) => name.trim().length > 0);
    }

    /**
     * 获取 SD-WebUI 服务端支持的采样器列表。
     *
     * @param signal 中止信号
     * @returns 可用采样器名称数组
     */
    public async fetchSamplers(signal?: AbortSignal): Promise<string[]> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const url = `${serverUrl}/sdapi/v1/samplers`;

        const response = await this.fetchWithTransport(url, { method: 'GET', timeoutMs: 15000, signal }, transport);
        const data = (await response.json()) as Array<{ name?: string }>;

        if (!Array.isArray(data)) {
            return [];
        }

        return data
            .map((s) => s.name ?? '')
            .filter((name) => name.trim().length > 0);
    }

    /**
     * 执行 SD-WebUI 图像生成任务（txt2img）。
     *
     * @remarks
     * 业务时序与参数装配：
     * 1. 预设参数解析：从当前激活的 drawingPreset 与 promptPreset 加载默认超参数，request.parameters 仅用于单次临时覆盖；
     * 2. 提示词装配：拼接正向预设前后缀与 LoRA 防重标签，合并默认负向词与用户负向词；
     * 3. 任务级模型隔离：装配 override_settings (sd_model_checkpoint, CLIP_stop_at_last_layers, sd_vae)；
     * 4. 双工并发：阻塞等待 txt2img POST 请求的同时，后台独立定时轮询 /sdapi/v1/progress 并通过 onProgress 回调通知；
     * 5. 结果标准化：从响应 images[0] 解码 Base64 为 PNG Blob，并封装标准元数据。
     *
     * @param request 生图请求参数
     * @param onProgress 进度与状态回调
     * @param signal 中止信号
     * @returns 包含图像 Blob 与生成元数据的生成结果
     */
    public async generate(
        request: GenerationRequest,
        onProgress?: TaskProgressCallback,
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
            }
            if (!drawingPreset && typeof this._settingsStore.getPresets === 'function') {
                const allPresets = this._settingsStore.getPresets<DrawingPresetData>('drawing', 'sdwebui');
                if (allPresets && allPresets.length > 0) {
                    drawingPreset = allPresets[0].data;
                }
            }
        }

        let promptPreset: PromptPresetData | undefined;
        const linkedPromptId = drawingPreset?.promptPresetId;
        if (this._settingsStore && linkedPromptId) {
            promptPreset = this._settingsStore.getPreset<PromptPresetData>(
                'prompts',
                linkedPromptId
            )?.data;
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

        const promptPrefix = promptPreset?.positivePrefix ?? '';
        const promptSuffix = promptPreset?.positiveSuffix ?? '';
        const negativeDefault = promptPreset?.negativePrompt ?? '';

        // 将 Prompt 预设的 LoRA 标签追加至正向提示词（防重）
        const loraTagStr = buildLoraTagString(promptPreset?.loras, request.prompt);

        const fullPrompt = [promptPrefix, request.prompt, loraTagStr, promptSuffix]
            .filter(Boolean)
            .join(', ');
        // 预设负向词作为默认底模，与用户负向词基底合并去重
        const fullNegativePrompt = mergeNegativePrompts(negativeDefault, request.negativePrompt);

        // 构建 override_settings（按任务切换模型，完成后自动还原）
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

        // 高清修复 (Hires. fix) 选配参数
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

        // 生图 POST 提交后轮询 /sdapi/v1/progress；generate POST 阻塞期间两者并发执行
        let pollingStopped = false;
        let generationResult: Record<string, unknown> | undefined;
        let generationError: unknown;

        const pollingController = new AbortController();
        const pollingSignal = pollingController.signal;

        if (signal) {
            signal.addEventListener('abort', () => pollingController.abort(), { once: true });
        }

        const pollProgress = async (): Promise<void> => {
            const progressUrl = `${serverUrl}/sdapi/v1/progress?skip_current_image=true`;
            while (!pollingStopped && !pollingSignal.aborted) {
                try {
                    await this.sleep(800, pollingSignal);
                    if (pollingSignal.aborted) break;

                    const resp = await this.fetchWithTransport(
                        progressUrl,
                        { method: 'GET', timeoutMs: 5000, signal: pollingSignal },
                        transport
                    );
                    if (!resp.ok) continue;

                    const data = (await resp.json()) as { progress?: number; state?: { job?: string } };
                    const percent = Math.round((data.progress ?? 0) * 100);

                    if (onProgress) {
                        onProgress({ percent: Math.min(percent, 99), statusText: '生成中...' });
                    }
                } catch {
                    // 中止或网络瞬断时退出轮询
                    break;
                }
            }
        };

        const generatePost = this.fetchWithTransport(
            `${serverUrl}/sdapi/v1/txt2img`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                timeoutMs: maxTimeoutMs,
                retries: 0,
                signal,
            },
            transport
        )
            .then(async (resp) => {
                generationResult = (await resp.json()) as Record<string, unknown>;
            })
            .catch((err) => {
                generationError = err;
            })
            .finally(() => {
                pollingStopped = true;
                pollingController.abort();
            });

        await Promise.all([generatePost, pollProgress()]);

        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        if (generationError) {
            throw generationError;
        }
        if (!generationResult) {
            throw new Error('SD-WebUI 未返回有效响应');
        }

        // A1111 images[] 末尾可能追加 grid 图，batch_size=n_iter=1 时取第一张即为目标图
        const images = generationResult['images'];
        if (!Array.isArray(images) || images.length === 0) {
            throw new Error('SD-WebUI 返回结果中未包含图像数据');
        }

        const imageBase64 = images[0] as string;
        const blob = base64ToBlob(imageBase64, 'image/png');

        if (onProgress) {
            onProgress({ percent: 100, statusText: '生图完成' });
        }

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
        };

        return {
            blob,
            metadata,
        };
    }
}
