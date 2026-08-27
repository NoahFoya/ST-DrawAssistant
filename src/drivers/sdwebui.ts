/**
 * @module drivers/sdwebui
 * @description Automatic1111 Stable Diffusion WebUI 驱动适配器
 *
 * 封装与 SD WebUI API (/sdapi/v1/*) 的通信协议，履行 ImageDriver 标准契约。
 */

import { logger } from '../core/logger';
import { BaseDriver } from './base';
import {
    DriverError,
    DriverErrorType,
    type ConnectionInfo,
    type GenerateOptions,
    type GenerateResult,
    type ProgressCallback,
} from './types';

/** SD WebUI /sdapi/v1/txt2img 响应体类型 */
interface Txt2ImgResponse {
    images: string[];
    parameters: Record<string, unknown>;
    info: string;
}

/** SD WebUI /sdapi/v1/samplers 元素类型 */
interface SamplerItem {
    name: string;
    aliases?: string[];
}

/** SD WebUI /sdapi/v1/sd-models 元素类型 */
interface ModelItem {
    title: string;
    model_name: string;
    hash?: string;
}

export class SDWebUIDriver extends BaseDriver {
    readonly name = 'sd-webui';

    /**
     * 测量 SD WebUI 服务器连通性与响应延迟
     *
     * @returns 包含连通状态与延迟毫秒数的 ConnectionInfo
     */
    async checkConnection(): Promise<ConnectionInfo> {
        const startTime = Date.now();
        try {
            await this.getJson<Record<string, unknown>>('/sdapi/v1/options', 5000);
            return {
                connected: true,
                latencyMs: Date.now() - startTime,
            };
        } catch (err) {
            return {
                connected: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    /**
     * 提交文生图任务至 SD WebUI (POST /sdapi/v1/txt2img) 并持续轮询任务进度
     *
     * @param options 完整的生图参数配置
     * @param onProgress 任务进度实时回调函数
     * @returns 包含 Base64/Blob 图像与实际 Seed 的 GenerateResult
     */
    async generate(options: GenerateOptions, onProgress?: ProgressCallback): Promise<GenerateResult> {
        this.resetCancelState();
        const startTime = Date.now();

        let progressInterval: ReturnType<typeof setInterval> | null = null;
        if (onProgress) {
            onProgress({
                currentStep: 0,
                totalSteps: options.steps,
                percentage: 0,
                statusMessage: '正在提交任务至 SD WebUI...',
            });

            progressInterval = setInterval(async () => {
                try {
                    const prog = await this.getJson<{
                        progress: number;
                        state: { sampling_step: number; sampling_steps: number; job_status?: string };
                    }>('/sdapi/v1/progress?skip_current_image=true', 3000);

                    if (prog && typeof prog.progress === 'number' && prog.progress > 0) {
                        const step = prog.state?.sampling_step ?? Math.round(prog.progress * options.steps);
                        const total = prog.state?.sampling_steps || options.steps;
                        const pct = Math.min(100, Math.round(prog.progress * 100));
                        onProgress({
                            currentStep: step,
                            totalSteps: total,
                            percentage: pct,
                            statusMessage: `采样中 (${step}/${total})... ${pct}%`,
                        });
                    }
                } catch {
                    // 轮询非致命异常处理，静默忽略
                }
            }, 1000);
        }

        const payload: Record<string, unknown> = {
            prompt: options.prompt,
            negative_prompt: options.negativePrompt ?? '',
            steps: options.steps,
            cfg_scale: options.cfgScale,
            width: options.width,
            height: options.height,
            sampler_name: options.samplerName,
            seed: options.seed ?? -1,
            ...(options.scheduler ? { scheduler: options.scheduler } : {}),
            ...(options.denoise !== undefined ? { denoising_strength: options.denoise } : {}),
            ...(options.ckptName ? { override_settings: { sd_model_checkpoint: options.ckptName } } : {}),
            ...(options.extra ?? {}),
        };

        try {
            const response = await this.postJson<Txt2ImgResponse>('/sdapi/v1/txt2img', payload);
            this.checkCancelled();

            if (!response.images || response.images.length === 0) {
                throw new DriverError(DriverErrorType.BACKEND_ERROR, 'SD WebUI 返回空图像数据');
            }

            let actualSeed: number | undefined = options.seed;
            if (response.info) {
                try {
                    const parsedInfo = JSON.parse(response.info) as { seed?: number };
                    if (typeof parsedInfo.seed === 'number') {
                        actualSeed = parsedInfo.seed;
                    }
                } catch {
                    // info 解析失败忽略，保留默认 seed
                }
            }

            if (onProgress) {
                onProgress({
                    currentStep: options.steps,
                    totalSteps: options.steps,
                    percentage: 100,
                    statusMessage: '生图完成！',
                });
            }

            return {
                imageData: response.images[0],
                mimeType: 'image/png',
                seed: actualSeed,
                durationMs: Date.now() - startTime,
            };
        } catch (err) {
            if (this._cancelled) {
                throw new DriverError(DriverErrorType.CANCELLED, '任务已被取消');
            }
            if (err instanceof DriverError) throw err;
            throw new DriverError(DriverErrorType.BACKEND_ERROR, `SD WebUI 生图异常: ${err instanceof Error ? err.message : String(err)}`, err);
        } finally {
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
        }
    }

    /**
     * 取消当前任务并发送 /sdapi/v1/interrupt 中断请求
     */
    cancel(): void {
        super.cancel();
        // 异步发送中断信号，忽略异常
        this.postJson('/sdapi/v1/interrupt', {}).catch(() => {
            // 中断异常静默处理
        });
    }

    /**
     * 获取支持的采样器列表 (/sdapi/v1/samplers)
     */
    async getSamplers(): Promise<string[]> {
        try {
            const items = await this.getJson<SamplerItem[]>('/sdapi/v1/samplers');
            return items.map((item) => item.name);
        } catch (err) {
            logger.warn('获取 SD WebUI 采样器列表失败，返回空列表（UI 层应提示用户检查连接）', err);
            return [];
        }
    }

    /**
     * 获取支持的模型列表 (/sdapi/v1/sd-models)
     */
    async getModels(): Promise<string[]> {
        try {
            const items = await this.getJson<ModelItem[]>('/sdapi/v1/sd-models');
            return items.map((item) => item.title || item.model_name);
        } catch (err) {
            logger.warn('获取 SD WebUI 模型列表失败，返回空列表（UI 层应提示用户检查连接）', err);
            return [];
        }
    }
}
