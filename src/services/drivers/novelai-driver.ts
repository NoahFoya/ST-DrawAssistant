/**
 * NovelAI 生图引擎驱动
 * 转换提示词加权语法为花括号/方括号语法，规整尺寸为 64 的整倍数。
 * 兼容处理 V3 与 V4+ 参数差异，使用原生 DecompressionStream 解压 ZIP 响应并提取 PNG 图像。
 */

import { BaseDriver, BaseDriverOptions, extractStatusCode } from './base-driver';
import {
    EngineCapabilities,
    GenerationRequest,
    GenerationResult,
    HealthCheckResult,
    ProviderAssetCatalog,
    ProgressCallback,
    DriverError,
    DriverErrorType,
    ImageMetadata
} from '../../types/driver';

export interface NovelAIDrawingProfileData {
    model?: string;
    width?: number;
    height?: number;
    steps?: number;
    scale?: number;
    cfgRescale?: number;
    sampler?: string;
    noiseSchedule?: string;
    seed?: number;
    qualityToggle?: boolean;
    ucPreset?: number;
    convertPromptSyntax?: boolean;
    smeaMode?: string;
    smea?: boolean;
    smeaDyn?: boolean;
    decrisper?: boolean;
    variety?: boolean;
    uncondScale?: number;
    promptProfileId?: string;
    [key: string]: unknown;
}

export interface NovelAIPromptProfileData {
    promptPrefix?: string;
    promptSuffix?: string;
    negativePrompt?: string;
    [key: string]: unknown;
}

export interface NovelAIEngineConfig extends NovelAIDrawingProfileData, NovelAIPromptProfileData {
    serverUrl: string;
    apiKey: string;
    activeDrawingProfileId?: string;
    activePromptProfileId?: string;
    [key: string]: unknown;
}

export const DEFAULT_NOVELAI_DRAWING_PROFILES: Array<{ id: string; name: string; data?: NovelAIDrawingProfileData }> = [
    {
        id: 'default_v4_curated',
        name: 'NAI V4.5 精品插画 (推荐)',
        data: {
            model: 'nai-diffusion-4-5-full',
            width: 832,
            height: 1216,
            steps: 28,
            scale: 5.0,
            cfgRescale: 0.4,
            sampler: 'k_euler',
            noiseSchedule: 'karras',
            seed: -1,
            qualityToggle: true,
            ucPreset: 0,
            convertPromptSyntax: true,
            smeaMode: 'none',
            smea: false,
            smeaDyn: false,
            decrisper: false,
            variety: false,
            promptProfileId: 'default_anime'
        }
    },
    {
        id: 'v3_anime_smea',
        name: 'NAI V3 Anime (SMEA+DYN 增强)',
        data: {
            model: 'nai-diffusion-3',
            width: 832,
            height: 1216,
            steps: 28,
            scale: 6.0,
            cfgRescale: 0.0,
            sampler: 'k_euler_ancestral',
            noiseSchedule: 'karras',
            seed: -1,
            qualityToggle: true,
            ucPreset: 0,
            convertPromptSyntax: true,
            smeaMode: 'smea_dyn',
            smea: true,
            smeaDyn: true,
            decrisper: true,
            variety: false,
            promptProfileId: 'default_anime'
        }
    }
];

export const DEFAULT_NOVELAI_PROMPT_PROFILES: Array<{ id: string; name: string; data?: NovelAIPromptProfileData }> = [
    {
        id: 'default_anime',
        name: '默认日系插画预设',
        data: {
            promptPrefix: '1girl, vibrant colors, detailed eyes',
            promptSuffix: 'soft lighting, masterpiece',
            negativePrompt: 'bad anatomy, bad hands, mutated, blurry'
        }
    }
];

export const DEFAULT_NOVELAI_CONFIG: NovelAIEngineConfig = {
    serverUrl: 'https://image.novelai.net',
    apiKey: '',
    activeDrawingProfileId: 'default_v4_curated',
    activePromptProfileId: 'default_anime',
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    scale: 5.0,
    cfgRescale: 0.4,
    sampler: 'k_euler',
    noiseSchedule: 'karras',
    seed: -1,
    qualityToggle: true,
    ucPreset: 0,
    convertPromptSyntax: true,
    smeaMode: 'none',
    smea: false,
    smeaDyn: false,
    decrisper: false,
    variety: false
};

export interface NovelAIEngineOptions extends Partial<NovelAIEngineConfig> {
    seed?: number;
    v4Prompt?: Record<string, unknown>;
}

export interface NovelAIDriverOptions extends BaseDriverOptions {}

/**
 * 将标准加权语法转换为 NovelAI 官方规范的花括号/方括号语法。
 * (tag:1.2) -> {tag}, (tag:0.8) -> [tag]
 */
export function convertToNovelAIPromptSyntax(prompt: string): string {
    if (!prompt) return '';
    return prompt
        .replace(/\(([^:)]+):([0-9.]+)\)/g, (_, tag, w) => {
            const weight = parseFloat(w);
            if (isNaN(weight) || weight === 1) return tag.trim();
            return weight > 1 ? `{${tag.trim()}}` : `[${tag.trim()}]`;
        })
        .replace(/\(([^:)]+)\)/g, (_, tag) => `{${tag.trim()}}`);
}

/**
 * 将尺寸数值规整为 64 的整倍数。
 * NovelAI 服务端 API 严格限制图像宽高必须为 64 的整数倍，否则返回 HTTP 400 错误。
 */
export function snapTo64(val: number | undefined, fallback = 832): number {
    const raw = typeof val === 'number' && val > 0 ? val : fallback;
    return Math.max(64, Math.round(raw / 64) * 64);
}

/**
 * 从 NovelAI 响应二进制 Buffer 中提取图像 Blob。
 * 优先检测原生 PNG 魔数，次之采用浏览器原生 DecompressionStream('deflate-raw') 解包 ZIP 归档。
 */
export async function extractImageFromZipBuffer(buffer: ArrayBuffer): Promise<Blob> {
    if (!buffer || buffer.byteLength === 0) {
        throw new DriverError(DriverErrorType.BACKEND_ERROR, 'NovelAI 返回空响应数据');
    }

    const bytes = new Uint8Array(buffer);

    // 优先检测原生 PNG 格式 (魔数签名 89 50 4E 47)
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return new Blob([buffer], { type: 'image/png' });
    }

    // 检测 ZIP 归档并解析单文件条目 (头魔数 50 4B 03 04)
    if (bytes.length >= 30 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
        const view = new DataView(buffer);
        const compressionMethod = view.getUint16(8, true);
        const compressedSize = view.getUint32(18, true);
        const fileNameLength = view.getUint16(26, true);
        const extraFieldLength = view.getUint16(28, true);

        const dataOffset = 30 + fileNameLength + extraFieldLength;
        const fileData = bytes.slice(dataOffset, dataOffset + (compressedSize || (bytes.length - dataOffset)));

        if (compressionMethod === 0) {
            return new Blob([fileData], { type: 'image/png' });
        } else if (compressionMethod === 8) {
            try {
                const stream = new Blob([fileData]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                const decompressedArray = await new Response(stream).arrayBuffer();
                return new Blob([decompressedArray], { type: 'image/png' });
            } catch (err: any) {
                throw new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `NovelAI ZIP 响应流 Deflate 解压失败: ${err?.message || '未知解压异常'}`
                );
            }
        }
    }

    let textPreview = '';
    try {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        textPreview = decoder.decode(bytes.slice(0, 256)).trim();
    } catch {}

    if (textPreview.startsWith('{') || textPreview.startsWith('<') || textPreview.includes('error')) {
        throw new DriverError(
            DriverErrorType.BACKEND_ERROR,
            `NovelAI 端点返回非图像响应: ${textPreview}`
        );
    }

    return new Blob([buffer], { type: 'image/png' });
}

export function resolveNovelAIEndpoint(baseUrl: string): string {
    const clean = (baseUrl || 'https://image.novelai.net').trim().replace(/\/+$/, '');
    if (clean.endsWith('/ai/generate-image') || clean.endsWith('/api/generate') || clean.endsWith('/generate')) {
        return clean;
    }
    return `${clean}/ai/generate-image`;
}

export class NovelAiDriver extends BaseDriver {
    public readonly id = 'novelai';
    public readonly name = 'NovelAI';
    public readonly description = 'NovelAI 官方与第三方中转云端生图服务驱动';
    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: false,
        lora: false,
        interrupt: false,
        syntaxType: 'tagBased'
    };

    public getDefaultConfig(): Record<string, unknown> {
        return { ...DEFAULT_NOVELAI_CONFIG };
    }

    constructor(options: NovelAIDriverOptions) {
        super(options);
    }

    public override async checkHealth(): Promise<HealthCheckResult> {
        const start = performance.now();
        const cfg = (this._getConfig?.() as NovelAIEngineOptions | undefined) || {};
        const endpoint = resolveNovelAIEndpoint((cfg.proxyUrl as string) || (cfg.serverUrl as string) || this.getBaseUrl());

        try {
            const headers: Record<string, string> = {};
            if (cfg.apiKey) {
                headers['Authorization'] = `Bearer ${cfg.apiKey}`;
            }
            await this.network.fetchExternal(endpoint, {
                method: 'GET',
                timeoutMs: 6000,
                headers
            });
            this._isConnected = true;
            return {
                ok: true,
                latencyMs: Math.round(performance.now() - start)
            };
        } catch (err: any) {
            const latencyMs = Math.round(performance.now() - start);
            const statusCode = extractStatusCode(err);
            if (statusCode === 405 || statusCode === 200) {
                this._isConnected = true;
                return {
                    ok: true,
                    latencyMs
                };
            }
            this._isConnected = false;
            if (statusCode === 401 || statusCode === 403) {
                return {
                    ok: false,
                    latencyMs,
                    statusCode,
                    message: 'NovelAI API Token 鉴权失败，请检查 Token 是否有效 (401/403)'
                };
            }
            return {
                ok: false,
                latencyMs,
                statusCode,
                message: err?.message || '连接失败，无法访问 NovelAI 服务'
            };
        }
    }

    protected override async doSyncAssets(): Promise<ProviderAssetCatalog> {
        return {
            models: await this.getModels(),
            samplers: await this.getSamplers()
        };
    }

    protected override async doGenerate(
        request: GenerationRequest,
        signal?: AbortSignal,
        _onProgress?: ProgressCallback
    ): Promise<GenerationResult> {
        const startTime = performance.now();
        const cfg = (this._getConfig?.() as NovelAIEngineConfig | undefined) || DEFAULT_NOVELAI_CONFIG;

        const activeDrawingId = (request.engineOptions?.activeDrawingProfileId as string) || cfg.activeDrawingProfileId || (cfg as any).drawingProfiles?.[0]?.id;
        const drawingProfile = (cfg as any).drawingProfiles?.find((p: any) => p.id === activeDrawingId)?.data;

        const activePromptId = (request.engineOptions?.activePromptProfileId as string) || drawingProfile?.promptProfileId || cfg.activePromptProfileId || (cfg as any).promptProfiles?.[0]?.id;
        const promptProfile = (cfg as any).promptProfiles?.find((p: any) => p.id === activePromptId)?.data;

        const options: NovelAIEngineOptions = {
            ...cfg,
            ...(request.engineOptions as NovelAIEngineOptions),
            ...drawingProfile,
            ...promptProfile
        };

        const apiKey = options.apiKey;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/x-zip-compressed, image/png, application/octet-stream'
        };

        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const shouldConvert = options.convertPromptSyntax !== false;
        const positiveParts = [
            options.promptPrefix,
            request.prompt,
            options.promptSuffix
        ].map((s) => (s || '').trim()).filter((s) => s.length > 0);
        const rawPositive = positiveParts.join(', ');

        const negativeParts = [
            options.negativePrompt,
            request.negativePrompt
        ].map((s) => (s || '').trim()).filter((s) => s.length > 0);
        const rawNegative = negativeParts.join(', ');

        const finalPositive = shouldConvert ? convertToNovelAIPromptSyntax(rawPositive) : rawPositive;
        const finalNegative = shouldConvert ? convertToNovelAIPromptSyntax(rawNegative) : rawNegative;
        const width = snapTo64(options.width, 832);
        const height = snapTo64(options.height, 1216);

        const model = options.model || 'nai-diffusion-4-5-full';
        const isV3 = model.includes('nai-diffusion-3') || model.includes('safe-diffusion') || model.includes('furry-3');
        const seed = typeof options.seed === 'number' && options.seed >= 0
            ? options.seed
            : Math.floor(Math.random() * 4294967295);

        const parameters: Record<string, unknown> = {
            params_version: 3,
            width,
            height,
            scale: options.scale ?? (isV3 ? 6.0 : 5.0),
            sampler: options.sampler || (isV3 ? 'k_euler_ancestral' : 'k_euler'),
            steps: options.steps ?? 28,
            n_samples: 1,
            ucPreset: options.ucPreset ?? 0,
            qualityToggle: options.qualityToggle ?? true,
            uc: finalNegative,
            negative_prompt: finalNegative,
            seed
        };

        if (options.cfgRescale !== undefined && options.cfgRescale !== null) {
            parameters.cfg_rescale = options.cfgRescale;
        }

        if (options.noiseSchedule) {
            parameters.noise_schedule = options.noiseSchedule;
        }

        if (isV3) {
            let sm = options.smea ?? true;
            let smDyn = options.smeaDyn ?? false;
            if (options.smeaMode === 'smea') {
                sm = true;
                smDyn = false;
            } else if (options.smeaMode === 'smea_dyn') {
                sm = true;
                smDyn = true;
            } else if (options.smeaMode === 'none') {
                sm = false;
                smDyn = false;
            }
            parameters.sm = sm;
            parameters.sm_dyn = smDyn;
            parameters.dynamic_thresholding = options.decrisper ?? false;
            if (typeof options.variety === 'boolean') {
                parameters.variety = options.variety;
            }
            parameters.uncond_scale = options.uncondScale ?? 1.0;
        } else if (options.v4Prompt) {
            parameters.v4_prompt = options.v4Prompt;
        }

        const body = {
            input: finalPositive,
            model,
            action: 'generate',
            parameters
        };

        const url = resolveNovelAIEndpoint((options.proxyUrl as string) || (options.serverUrl as string) || this.getBaseUrl());
        const mergedSignal = this.composeWithCancelSignal(signal);
        let rawResponse: Response;

        try {
            rawResponse = await this.network.fetchExternal(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: mergedSignal
            });
        } catch (err: any) {
            throw this.normalizeNovelAIError(err, url);
        }

        this.checkCancelled();

        if (!rawResponse.ok) {
            const errText = await rawResponse.text().catch(() => rawResponse.statusText);
            throw new DriverError(
                rawResponse.status === 401 || rawResponse.status === 403
                    ? DriverErrorType.AUTHENTICATION_ERROR
                    : DriverErrorType.BACKEND_ERROR,
                `NovelAI 报错 (HTTP ${rawResponse.status}): ${errText}`,
                rawResponse.status,
                errText
            );
        }

        const buffer = await rawResponse.arrayBuffer();
        const imageBlob = await extractImageFromZipBuffer(buffer);

        const totalDurationMs = Math.round(performance.now() - startTime);

        return {
            taskId: request.taskId,
            engine: this.id,
            images: [
                {
                    blob: imageBlob,
                    format: 'image/png',
                    seed,
                    metadata: {
                        model,
                        seed,
                        parameters
                    }
                }
            ],
            durationMs: totalDurationMs
        };
    }

    public extractMetadata(request: GenerationRequest, result: GenerationResult): Record<string, unknown> {
        const options: NovelAIEngineOptions = {
            ...(this._getConfig?.() as NovelAIEngineOptions | undefined),
            ...(request.engineOptions as NovelAIEngineOptions)
        };

        const firstImage = result.images[0];
        const seed = firstImage?.seed ?? options.seed;

        return {
            engine: this.id,
            model: options.model || 'nai-diffusion-4-5-full',
            scale: options.scale ?? 5.0,
            cfgRescale: options.cfgRescale,
            sampler: options.sampler || 'k_euler',
            noiseSchedule: options.noiseSchedule,
            steps: options.steps ?? 28,
            width: snapTo64(options.width, 832),
            height: snapTo64(options.height, 1216),
            seed,
            qualityToggle: options.qualityToggle,
            ucPreset: options.ucPreset,
            smeaMode: options.smeaMode,
            smea: options.smea,
            smeaDyn: options.smeaDyn,
            decrisper: options.decrisper,
            variety: options.variety,
            uncondScale: options.uncondScale
        };
    }

    public restoreParameters(metadata: ImageMetadata): Record<string, unknown> {
        const params = metadata.engineParams || {};
        return {
            model: params.model,
            scale: params.scale,
            cfgRescale: params.cfgRescale,
            sampler: params.sampler,
            noiseSchedule: params.noiseSchedule,
            steps: params.steps,
            width: params.width ?? metadata.dimensions?.width,
            height: params.height ?? metadata.dimensions?.height,
            seed: params.seed,
            qualityToggle: params.qualityToggle,
            ucPreset: params.ucPreset,
            smeaMode: params.smeaMode,
            smea: params.smea,
            smeaDyn: params.smeaDyn,
            decrisper: params.decrisper,
            variety: params.variety,
            uncondScale: params.uncondScale
        };
    }

    public async getModels(): Promise<string[]> {
        return [
            'nai-diffusion-5-full',
            'nai-diffusion-5-curated',
            'nai-diffusion-4-5-full',
            'nai-diffusion-4-5-curated',
            'nai-diffusion-4-full',
            'nai-diffusion-4-curated-preview',
            'nai-diffusion-3',
            'nai-diffusion-furry-3',
            'safe-diffusion'
        ];
    }

    public async getSamplers(): Promise<string[]> {
        return [
            'k_euler',
            'k_euler_ancestral',
            'k_dpmpp_2s_ancestral',
            'k_dpmpp_2m_sde',
            'k_dpmpp_2m',
            'k_dpmpp_sde',
            'ddim_v3'
        ];
    }

    private normalizeNovelAIError(err: unknown, url: string): Error {
        if (err instanceof DriverError) return err;
        const statusCode = extractStatusCode(err);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('aborted') || msg.includes('AbortError')) {
            return new DriverError(DriverErrorType.CANCELLED, 'NovelAI 请求已中止');
        }
        if (statusCode === 401 || statusCode === 403) {
            return new DriverError(DriverErrorType.AUTHENTICATION_ERROR, `NovelAI API Token 鉴权失败: ${msg}`, statusCode, err);
        }
        return new DriverError(DriverErrorType.NETWORK_ERROR, `访问 NovelAI 接口失败 [${url}]: ${msg}`, statusCode, err);
    }
}
