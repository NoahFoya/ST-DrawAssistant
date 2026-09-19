/**
 * SD-WebUI / Forge 绘图服务提供方适配器。
 *
 * @remarks
 * 基于 A1111 兼容 HTTP API 对接 SD-WebUI / Forge 服务端：
 * - 模型隔离：使用 override_settings 与 override_settings_restore_afterwards 实现按任务局部生效与状态自动复原；
 * - LoRA 语法：通过向正向提示词嵌入 <lora:name:weight> 标签生效；
 * - 进度监控：POST 阻塞生成期间独立轮询 /sdapi/v1/progress 获取步数与百分比。
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

/** SD-WebUI 提供方初始化配置项 */
export interface SdWebUIProviderOptions extends BaseProviderOptions {}

/**
 * 将 Base64 字符串解码为 Blob。
 *
 * @param b64 Base64 编码图像字符串（可含 data URI 前缀）
 * @param mimeType 图像 MIME 类型
 */
function base64ToBlob(b64: string, mimeType = 'image/png'): Blob {
    // 去除可能存在的 data URI 前缀
    const raw = b64.includes(',') ? b64.split(',')[1] : b64;
    const binaryStr = atob(raw);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

/**
 * 将 PromptPresetData.loras[] 拼装为 A1111 LoRA 标签字符串。
 *
 * @param loras LoRA 配置列表
 * @returns 追加至提示词的标签字符串，无 LoRA 时返回空字符串
 */
function buildLoraTagString(loras?: Array<{ name: string; weight: number; trigger?: string }>): string {
    if (!loras || loras.length === 0) {
        return '';
    }
    return loras
        .filter((l) => l.name && l.name.trim())
        .map((l) => `<lora:${l.name.trim()}:${l.weight}>`)
        .join(' ');
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
     * 读取配置中心的 SD-WebUI 服务地址，未配置时回退为默认本地地址 (http://127.0.0.1:7860)。
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
     * 执行 SD-WebUI 图像生成任务（txt2img）。
     *
     * @remarks
     * 向 /sdapi/v1/txt2img 提交生图请求，并在任务阻塞执行期间并发轮询 /sdapi/v1/progress 获取步数与进度。
     * 常规绘图超参数从配置中心激活的预设加载，request.parameters 仅用于临时覆盖。
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
            if (config?.activeDrawingProfileId) {
                drawingPreset = this._settingsStore.getPreset<DrawingPresetData>(
                    'drawing',
                    config.activeDrawingProfileId,
                    'sdwebui'
                )?.data;
            }
        }

        let promptPreset: PromptPresetData | undefined;
        if (this._settingsStore) {
            const config = this._settingsStore.getProviderConfig<SDWebUIProviderConfig>('sdwebui');
            if (config?.activePromptProfileId) {
                promptPreset = this._settingsStore.getPreset<PromptPresetData>(
                    'prompts',
                    config.activePromptProfileId
                )?.data;
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

        // 将 Prompt 预设的 LoRA 标签追加至正向提示词
        const loraTagStr = buildLoraTagString(promptPreset?.loras);
        const promptPrefix = promptPreset?.prefix ?? '';
        const promptSuffix = promptPreset?.suffix ?? '';
        const negativeDefault = promptPreset?.defaultNegative ?? '';

        const fullPrompt = [promptPrefix, request.prompt, loraTagStr, promptSuffix]
            .filter(Boolean)
            .join(', ');
        const fullNegativePrompt = request.negativePrompt ?? negativeDefault;

        // 构建 override_settings（按任务切换模型，完成后自动还原）
        const overrideSettings: Record<string, unknown> = {};
        if (resolvedBaseModel) {
            overrideSettings['sd_model_checkpoint'] = resolvedBaseModel;
        }
        if (resolvedClipSkip !== undefined) {
            overrideSettings['CLIP_stop_at_last_layers'] = resolvedClipSkip;
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
            const progressUrl = `${serverUrl}/sdapi/v1/progress`;
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
            prompt: request.prompt,
            negativePrompt: request.negativePrompt,
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
