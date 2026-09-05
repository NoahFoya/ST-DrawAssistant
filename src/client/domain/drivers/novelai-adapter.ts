/**
 * @module domain/drivers/novelai-adapter
 * @description NovelAI 图像生成适配器
 *
 * 1. 支持将权重语法转换为花括号 {tag} 与方括号 [tag]；
 * 2. 图像宽高自动对齐为 64 的整倍数；
 * 3. 兼容 V3 与 V4+ 模型参数差异；
 * 4. 解压 ZIP 响应提取 PNG 图片；
 * 5. 支持读取图片内嵌的生图参数。
 */

import { BaseDriver, BaseDriverOptions } from './base-driver';
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
} from '../types';

/** NovelAI 配置接口 */
export interface NovelAIEngineConfig {
    serverUrl: string;
    apiKey: string;
    model: string;
    width: number;
    height: number;
    steps: number;
    scale: number;
    sampler: string;
    qualityToggle?: boolean;
    ucPreset?: number;
    smea?: boolean;
    smeaDyn?: boolean;
    decrisper?: boolean;
    uncondScale?: number;
    convertPromptSyntax?: boolean;
    [key: string]: unknown;
}

/** NovelAI 默认配置 */
export const DEFAULT_NOVELAI_CONFIG: NovelAIEngineConfig = {
    serverUrl: 'https://image.novelai.net',
    apiKey: '',
    model: 'nai-diffusion-4-curated-preview',
    width: 832,
    height: 1216,
    steps: 28,
    scale: 5.0,
    sampler: 'k_euler',
    qualityToggle: true,
    ucPreset: 0,
    convertPromptSyntax: true
};

/** NovelAI 专有请求选项 */
export interface NovelAIEngineOptions extends Partial<NovelAIEngineConfig> {
    seed?: number;
    v4Prompt?: Record<string, unknown>;
}

export interface NovelAIAdapterOptions extends BaseDriverOptions {}

/**
 * 将标准加权语法转换为 NovelAI 官方规范的花括号/方括号语法
 * (tag:1.2) -> {tag}, (tag:0.8) -> [tag], (tag) -> {tag}
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
 * 将尺寸数值规整为 64 的整倍数
 *
 * NovelAI V3/V4 底层基于 8x 潜空间 VAE 与分块注意力机制，
 * 服务端 API 严格限制图像宽高必须为 64 的整数倍 (如 832x1216)，否则会导致 HTTP 400 校验失败。
 */
export function snapTo64(val: number | undefined, fallback = 832): number {
    const raw = typeof val === 'number' && val > 0 ? val : fallback;
    return Math.max(64, Math.round(raw / 64) * 64);
}

/**
 * 从 NovelAI 返回的二进制 Buffer (PNG 或 ZIP 归档) 中提取图像 Blob
 *
 * NovelAI 官方端点默认将生成的图像打包为单文件条目的 ZIP 归档回传，
 * 内部通常使用 Deflate-raw (算法 8) 无头压缩；本函数优先检测直接 PNG，次之解包 ZIP，
 * 若遇到非图像的错误文本响应则直接阻断并抛出异常，杜绝生成损坏的死图 Blob。
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

    // 若既非 PNG 也非 ZIP，检查是否为第三方反代返回的错误 JSON 或纯文本
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

/**
 * 智能解析 NovelAI 生图请求绝对端点
 * 自动识别官方域名、第三方反代 Base URL 与直接生图端点
 */
export function resolveNovelAIEndpoint(baseUrl: string): string {
    const clean = (baseUrl || 'https://image.novelai.net').trim().replace(/\/+$/, '');
    if (clean.endsWith('/ai/generate-image') || clean.endsWith('/api/generate') || clean.endsWith('/generate')) {
        return clean;
    }
    return `${clean}/ai/generate-image`;
}

export class NovelAIAdapter extends BaseDriver {
    public readonly id = 'novelai';
    public readonly name = 'NovelAI';
    public readonly description = 'NovelAI 官方与第三方中转云端图像生成服务适配器';
    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: false,
        lora: false,
        progressWebSocket: false,
        interrupt: false,
        syntaxType: 'tagBased'
    };


    constructor(options: NovelAIAdapterOptions) {
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
                headers,
                serviceType: 'novelai'
            });
            return {
                ok: true,
                latencyMs: Math.round(performance.now() - start)
            };
        } catch (err: any) {
            const latencyMs = Math.round(performance.now() - start);
            if (err instanceof DriverError && (err.statusCode === 405 || err.statusCode === 200)) {
                return {
                    ok: true,
                    latencyMs
                };
            }
            if (err instanceof DriverError && (err.statusCode === 401 || err.statusCode === 403)) {
                return {
                    ok: false,
                    latencyMs,
                    statusCode: err.statusCode,
                    message: 'NovelAI API Token 鉴权失败，请检查 Token 是否有效 (401/403)'
                };
            }
            return {
                ok: false,
                latencyMs,
                statusCode: err instanceof DriverError ? err.statusCode : undefined,
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
        const options: NovelAIEngineOptions = {
            ...(this._getConfig?.() as NovelAIEngineOptions | undefined),
            ...(request.engineOptions as NovelAIEngineOptions)
        };

        const apiKey = options.apiKey;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/x-zip-compressed, image/png, application/octet-stream'
        };

        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        // NovelAI 语法适配与尺寸 64 像素对齐
        const shouldConvert = options.convertPromptSyntax !== false;
        const finalPositive = shouldConvert ? convertToNovelAIPromptSyntax(request.prompt || '') : (request.prompt || '');
        const finalNegative = shouldConvert ? convertToNovelAIPromptSyntax(request.negativePrompt || '') : (request.negativePrompt || '');
        const width = snapTo64(options.width, 832);
        const height = snapTo64(options.height, 1216);

        const model = options.model || 'nai-diffusion-4-full';
        const isV3 = model.includes('nai-diffusion-3') || model.includes('safe-diffusion');
        const seed = typeof options.seed === 'number' && options.seed >= 0
            ? options.seed
            : Math.floor(Math.random() * 4294967295);

        const parameters: Record<string, unknown> = {
            params_version: 3,
            width,
            height,
            scale: options.scale ?? 6.0,
            sampler: options.sampler || 'k_euler_ancestral',
            steps: options.steps ?? 28,
            n_samples: 1,
            ucPreset: options.ucPreset ?? 0,
            qualityToggle: options.qualityToggle ?? true,
            uc: finalNegative,
            negative_prompt: finalNegative,
            seed
        };

        // V3 与 V4+ 专有参数分发 (V4+ 支持结构化 v4_prompt，V3 采用 legacy SMEA 参数)
        if (isV3) {
            parameters.sm = options.smea ?? true;
            parameters.sm_dyn = options.smeaDyn ?? false;
            parameters.dynamic_thresholding = options.decrisper ?? false;
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
                signal: mergedSignal,
                serviceType: 'novelai'
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
            model: options.model || 'nai-diffusion-4-full',
            scale: options.scale ?? 6.0,
            sampler: options.sampler || 'k_euler_ancestral',
            steps: options.steps ?? 28,
            width: snapTo64(options.width, 832),
            height: snapTo64(options.height, 1216),
            seed,
            qualityToggle: options.qualityToggle,
            ucPreset: options.ucPreset,
            smea: options.smea,
            smeaDyn: options.smeaDyn,
            decrisper: options.decrisper,
            uncondScale: options.uncondScale
        };
    }

    public restoreParameters(metadata: ImageMetadata): Record<string, unknown> {
        const params = metadata.engineParams || {};
        return {
            model: params.model,
            scale: params.scale,
            sampler: params.sampler,
            steps: params.steps,
            width: params.width ?? metadata.dimensions?.width,
            height: params.height ?? metadata.dimensions?.height,
            seed: params.seed,
            qualityToggle: params.qualityToggle,
            ucPreset: params.ucPreset,
            smea: params.smea,
            smeaDyn: params.smeaDyn,
            decrisper: params.decrisper,
            uncondScale: params.uncondScale
        };
    }

    public async getModels(): Promise<string[]> {
        return [
            'nai-diffusion-5-full',
            'nai-diffusion-4-5-full',
            'nai-diffusion-4-full',
            'nai-diffusion-4-curated',
            'nai-diffusion-3',
            'safe-diffusion'
        ];
    }

    public async getSamplers(): Promise<string[]> {
        return [
            'k_euler_ancestral',
            'k_euler',
            'k_dpmpp_2s_ancestral',
            'k_dpmpp_2m_sde',
            'k_dpmpp_2m',
            'ddim_v3'
        ];
    }

    private normalizeNovelAIError(err: unknown, url: string): Error {
        if (err instanceof DriverError) return err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('aborted') || msg.includes('AbortError')) {
            return new DriverError(DriverErrorType.CANCELLED, 'NovelAI 请求已中止');
        }
        return new DriverError(DriverErrorType.NETWORK_ERROR, `访问 NovelAI 接口失败 [${url}]: ${msg}`);
    }
}
