/**
 * @module domain/drivers/novelai-driver
 * @description NovelAI 后端生图驱动实现 (支持 NAI v3/v4 专属模型、SMEA 增强采样与 ZIP 二进制响应解包)
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { BaseDriver, DriverError, DriverErrorType } from './base-driver';
import type { GenerationPayload, DriverBuildPayloadOptions, DriverAssetSyncResult } from './driver-contract';
import { joinPromptParts } from '../pipeline/prompt-pipeline';

/**
 * 二进制解包：从 NovelAI API 返回的响应 Buffer 中提取图片 Blob
 *
 * 处理流程：
 * 1. 检测原生 PNG 文件头魔数 (0x89 0x50 0x4E 0x47)，若为单张 PNG 则直接封装为 Blob；
 * 2. 检测 ZIP 文件头魔数 (0x50 0x4B 0x03 0x04)，若为 Store 模式 (无压缩) 则根据偏移量提取数据，若为 Deflate 则通过 DecompressionStream 解压；
 * 3. 兜底封装为 PNG 格式 Blob。
 *
 * @param buffer 后端返回的 ArrayBuffer 原始二进制数据
 * @returns 解析提取生成的图片 Blob 对象
 */
export async function extractImageFromZipBuffer(buffer: ArrayBuffer): Promise<Blob> {
    const bytes = new Uint8Array(buffer);

    // 检查是否为 PNG 原生魔数 (89 50 4E 47)
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return new Blob([buffer], { type: 'image/png' });
    }

    // 检查是否为 ZIP 本地文件头魔数 (50 4B 03 04)
    if (bytes.length >= 30 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
        const view = new DataView(buffer);
        const compressionMethod = view.getUint16(8, true);
        const compressedSize = view.getUint32(18, true);
        const fileNameLength = view.getUint16(26, true);
        const extraFieldLength = view.getUint16(28, true);

        const dataOffset = 30 + fileNameLength + extraFieldLength;
        const fileData = bytes.slice(dataOffset, dataOffset + (compressedSize || (bytes.length - dataOffset)));

        if (compressionMethod === 0) {
            // 无压缩存储 (Store)
            return new Blob([fileData], { type: 'image/png' });
        } else if (compressionMethod === 8) {
            // Deflate 压缩
            if (typeof DecompressionStream !== 'undefined') {
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
            } else {
                throw new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    '当前浏览器环境不支持 DecompressionStream，无法解压 NovelAI Deflate 图像数据'
                );
            }
        }
    }

    return new Blob([buffer], { type: 'image/png' });
}

/**
 * 将标准 SD 权重提示词语法转换为 NovelAI 官方花括号/方括号规范语法
 *
 * 转换规则：
 * - (tag:1.x) / (tag) -> {tag}
 * - (tag:0.x) -> [tag]
 *
 * @param prompt 原始提示词文本
 * @returns 符合 NovelAI 规范的提示词文本
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

export class NovelAIDriver extends BaseDriver {
    public readonly id = 'novelai';
    public readonly name = 'NovelAI';

    constructor(store: ObservableStore<DrawAssistantSettings>) {
        super(store, 'NovelAIDriver');
    }

    protected override getEndpointUrl(): string {
        const url = this.store.getState().naiUrl || 'https://image.novelai.net';
        return url.replace(/\/+$/, '');
    }

    public async ping(): Promise<boolean> {
        try {
            const settings = this.store.getState();
            const headers: Record<string, string> = {};
            if (settings.naiApiKey) {
                headers['Authorization'] = `Bearer ${settings.naiApiKey}`;
            }
            await this.getJson('/ai/generate-image', 5000, headers);
            return true;
        } catch (err: any) {
            // 401/405 表示端点可达
            if (err instanceof DriverError && (err.statusCode === 401 || err.statusCode === 405)) {
                return true;
            }
            return false;
        }
    }

    public override async checkConnection(): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
        const start = performance.now();
        try {
            const ok = await this.ping();
            const latencyMs = Math.round(performance.now() - start);
            return {
                connected: ok,
                latencyMs,
                error: ok ? undefined : '连接失败，无法访问 NovelAI 端点'
            };
        } catch (err: any) {
            return {
                connected: false,
                error: err?.message || String(err)
            };
        }
    }

    public override formatPrompt(rawPrompt: string): string {
        return convertToNovelAIPromptSyntax(rawPrompt);
    }

    public override async syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult> {
        const models = await this.getModels();
        const samplers = await this.getSamplers();
        store.set('cachedModels', models);
        store.set('cachedSamplers', samplers);
        return {
            updatedCount: models.length + samplers.length,
            summary: `已加载 ${models.length} 个 NAI 模型与 ${samplers.length} 个采样器。`,
            details: { models: models.length, samplers: samplers.length }
        };
    }

    public override async getModels(): Promise<string[]> {
        return [
            'nai-diffusion-4-full',
            'nai-diffusion-4-curated',
            'nai-diffusion-3',
            'safe-diffusion'
        ];
    }

    public override async getSamplers(): Promise<string[]> {
        return [
            'k_euler_ancestral',
            'k_euler',
            'k_dpmpp_2s_ancestral',
            'k_dpmpp_2m_sde',
            'k_dpmpp_2m',
            'ddim_v3'
        ];
    }

    public buildPayload(options: DriverBuildPayloadOptions): GenerationPayload {
        const { cleanPositive, cleanNegative, settings } = options;

        const finalPositive = joinPromptParts(
            settings.naiPromptPrefix,
            settings.promptPrefix,
            cleanPositive,
            settings.naiPromptSuffix
        );

        const finalNegative = joinPromptParts(
            settings.naiNegativePrefix,
            settings.negativePrefix,
            cleanNegative
        );

        return {
            mode: 'txt2img',
            prompt: this.formatPrompt(finalPositive),
            negativePrompt: this.formatPrompt(finalNegative),
            params: {
                seed: -1,
                steps: settings.naiSteps || 28,
                cfgScale: settings.naiScale || 6.0,
                samplerName: settings.naiSampler || 'k_euler_ancestral',
                width: settings.naiWidth || 832,
                height: settings.naiHeight || 1216,
                model: settings.naiModel || 'nai-diffusion-4-full'
            }
        };
    }

    public async generate(
        payload: GenerationPayload,
        onProgress?: (progress: { percent: number; nodeName?: string; previewBlob?: Blob }) => void
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }> {
        const settings = this.store.getState();
        const timeoutMs = settings.requestTimeout || 120000;

        onProgress?.({ percent: 15, nodeName: '提交 NovelAI 生图请求' });

        const apiKey = settings.naiApiKey || settings.apiKey;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/x-zip-compressed, image/png, application/octet-stream'
        };

        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const model = settings.naiModel || 'nai-diffusion-4-full';
        const seed = Math.floor(Math.random() * 4294967295);

        const body: Record<string, any> = {
            input: payload.prompt,
            model,
            action: 'generate',
            parameters: {
                params_version: 3,
                width: payload.params.width || settings.naiWidth || 832,
                height: payload.params.height || settings.naiHeight || 1216,
                scale: payload.params.cfgScale || settings.naiScale || 6.0,
                sampler: payload.params.samplerName || settings.naiSampler || 'k_euler_ancestral',
                steps: payload.params.steps || settings.naiSteps || 28,
                n_samples: 1,
                ucPreset: 0,
                qualityToggle: true,
                sm: settings.naiSmea ?? true,
                sm_dyn: settings.naiSmeaDyn ?? false,
                dynamic_thresholding: settings.naiDecrisper ?? false,
                uncond_scale: settings.naiUncondScale ?? 1.0,
                negative_prompt: payload.negativePrompt || '',
                seed
            }
        };

        this.resetCancelState();

        try {
            onProgress?.({ percent: 40, nodeName: 'NovelAI 云端渲染中' });

            const url = this.buildUrl('/ai/generate-image');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            const onParentAbort = () => controller.abort();
            if (this._abortController) {
                this._abortController.signal.addEventListener('abort', onParentAbort);
            }

            let response: Response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutId);
                if (this._abortController) {
                    this._abortController.signal.removeEventListener('abort', onParentAbort);
                }
            }

            this.checkCancelled();

            if (!response.ok) {
                const errText = await response.text().catch(() => response.statusText);
                throw new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `NovelAI 报错 (HTTP ${response.status}): ${errText}`,
                    response.status
                );
            }

            onProgress?.({ percent: 85, nodeName: '解包图像二进制流' });
            const arrayBuffer = await response.arrayBuffer();
            const imageBlob = await extractImageFromZipBuffer(arrayBuffer);

            onProgress?.({ percent: 100 });

            return {
                imageBlobs: [imageBlob],
                metadata: {
                    model,
                    seed,
                    prompt: payload.prompt,
                    negative_prompt: payload.negativePrompt
                }
            };
        } catch (err: any) {
            if (err instanceof DriverError) throw err;
            throw new DriverError(
                DriverErrorType.BACKEND_ERROR,
                `NovelAI 生图失败: ${err?.message || '未知异常'}`
            );
        }
    }
}
