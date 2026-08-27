/**
 * @module domain/drivers/sdwebui-driver
 * @description SD-WebUI (A1111) 生图后端驱动实现 (继承 BaseDriver，支持 txt2img/img2img、Hires.fix、资产同步与中断)
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    LoraItem,
    DEFAULT_SDWEBUI_URL,
    DEFAULT_TASK_TIMEOUT_MS,
    GenerationPayload,
    DriverBuildPayloadOptions,
    CommonGenParams,
    DriverAssetSyncResult,
    DriverCapabilities
} from '../../core';
import { BaseDriver, DriverError, DriverErrorType } from './base-driver';
import { joinPromptParts } from '../pipeline/prompt-pipeline';

/** SD WebUI /sdapi/v1/txt2img / img2img 响应格式 */
interface Txt2ImgResponse {
    images: string[];
    parameters: Record<string, unknown>;
    info: string;
}

export class SDWebUIDriver extends BaseDriver {
    public readonly id = 'sdwebui';
    public readonly name = 'SD WebUI';
    public readonly capabilities: DriverCapabilities = {
        supportsInterrupt: true,
        supportsInpaint: true,
        supportsAssetSync: true,
        promptSyntax: 'parentheses'
    };

    constructor(store: ObservableStore<DrawAssistantSettings>) {
        super(store, 'SDWebUIDriver');
    }

    protected override getEndpointUrl(): string {
        return this.store.getState().sdWebUrl || DEFAULT_SDWEBUI_URL;
    }

    public async ping(): Promise<boolean> {
        try {
            await this.getJson<Record<string, unknown>>('/sdapi/v1/options', 5000);
            return true;
        } catch {
            return false;
        }
    }

    public formatPrompt(rawPrompt: string): string {
        return (rawPrompt || '').trim();
    }

    /**
     * 格式化 LoRA 模型为 SD-WebUI A1111 语法标签 (<lora:Name:ModelW> 或 <lora:Name:ModelW:ClipW>)
     *
     * @param lora LoRA 配置项
     * @returns 格式化后的 SD LoRA 标签字符串
     */
    public override formatLoraTag(lora: LoraItem): string {
        const cleanName = (lora.name || '').replace(/\.(safetensors|ckpt|pt|pth)$/i, '');
        if (!cleanName) return '';
        const mWeight = lora.weight ?? 1.0;
        if (lora.clipWeight !== undefined && lora.clipWeight !== lora.weight) {
            return `<lora:${cleanName}:${mWeight}:${lora.clipWeight}>`;
        }
        return `<lora:${cleanName}:${mWeight}>`;
    }

    /** 批量拉取 SD-WebUI 后端资产并同步至 Store */
    public override async syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult> {
        const [models, samplers, upscalers, loras] = await Promise.all([
            this.getModels(),
            this.getSamplers(),
            this.getUpscalers(),
            this.getLoras()
        ]);

        if (models.length > 0) store.set('cachedModels', models);
        if (samplers.length > 0) store.set('cachedSamplers', samplers);
        if (upscalers.length > 0) store.set('cachedUpscalers', upscalers);
        if (loras.length > 0) store.set('cachedLoras', loras);

        const total = models.length + samplers.length + upscalers.length + loras.length;
        return {
            updatedCount: total,
            summary: `已成功自动更新：${models.length} 个模型、${samplers.length} 个采样器、${upscalers.length} 个放大算法、${loras.length} 个 LoRA。`,
            details: {
                models: models.length,
                samplers: samplers.length,
                upscalers: upscalers.length,
                loras: loras.length
            }
        };
    }

    /**
     * 构建 SD-WebUI 专属生图请求载荷 (Payload)
     *
     * 载荷构建流程：
     * 1. 组装正向提示词（SD 专属前缀 + 全局前缀 + 楼层词 + 后缀 + SD LoRA）；
     * 2. 组装负向提示词（SD 专属负向前缀 + 全局负向前缀 + 楼层负向词）；
     * 3. 构建采样参数与可选的高清修复（Hires.fix）二阶段超分参数。
     *
     * @param options 驱动请求载荷构建参数
     * @returns 构建完成的 GenerationPayload
     */
    public buildPayload(options: DriverBuildPayloadOptions): GenerationPayload {
        const { cleanPositive, cleanNegative, mode, initImageBlob, maskImageBlob, denoiseStrength, settings } = options;

        // 1. 将配置的 LoRA 列表转换为 SD-WebUI 原生格式
        let loraSuffix = '';
        if (settings.loras && settings.loras.length > 0) {
            loraSuffix = settings.loras
                .filter((l: LoraItem) => Boolean(l.name) && l.enabled !== false)
                .map((l: LoraItem) => this.formatLoraTag(l))
                .filter(Boolean)
                .join(', ');
        }

        // 2. 组装 SD 专属正向与负向提示词 (纯粹独立，绝不混入全局或 ComfyUI 提示词)
        const fullPositive = joinPromptParts(
            settings.sdPromptPrefix,
            cleanPositive,
            settings.sdPromptSuffix,
            loraSuffix
        );

        const fullNegative = joinPromptParts(
            settings.sdNegativePrefix,
            cleanNegative
        );

        // 3. 组装 SD 专属运行参数与 Hires.fix 高清修复参数 (支持 options.overrides 优先覆盖)
        const overrides = options.overrides || {};
        const commonParams: CommonGenParams = {
            seed: typeof overrides.seed === 'number' ? overrides.seed : Math.floor(Math.random() * 2147483647),
            steps: typeof overrides.steps === 'number' ? overrides.steps : (settings.sdSteps ?? 20),
            cfgScale: typeof overrides.cfgScale === 'number' ? overrides.cfgScale : (settings.sdCfgScale ?? 7.0),
            samplerName: (overrides.samplerName as string) || settings.sdSamplerName || 'Euler a',
            width: typeof overrides.width === 'number' ? overrides.width : (settings.sdWidth ?? 512),
            height: typeof overrides.height === 'number' ? overrides.height : (settings.sdHeight ?? 768),
            model: (overrides.model as string) || settings.sdModelCheckpoint,
            clipSkip: typeof overrides.clipSkip === 'number' ? overrides.clipSkip : settings.sdClipSkip
        };

        if (settings.sdEnableHires) {
            commonParams.enableHires = true;
            commonParams.hiresScale = typeof overrides.hiresScale === 'number' ? overrides.hiresScale : (settings.sdHiresUpscaleBy ?? 1.5);
            commonParams.hiresUpscaler = (overrides.hiresUpscaler as string) || settings.sdHiresUpscaler;
            commonParams.hiresSteps = typeof overrides.hiresSteps === 'number' ? overrides.hiresSteps : settings.sdHiresSteps;
            commonParams.hiresDenoise = typeof overrides.hiresDenoise === 'number' ? overrides.hiresDenoise : settings.sdHiresDenoise;
        }

        if (mode === 'inpaint' && initImageBlob && maskImageBlob) {
            return {
                mode: 'inpaint',
                prompt: fullPositive,
                negativePrompt: fullNegative,
                params: commonParams,
                initImageBlob,
                maskImageBlob,
                denoiseStrength: denoiseStrength ?? settings.sdDenoisingStrength ?? 0.75
            };
        }

        return {
            mode: 'txt2img',
            prompt: fullPositive,
            negativePrompt: fullNegative,
            params: commonParams
        };
    }

    protected override async doGenerate(
        payload: GenerationPayload
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }> {
        const settings = this.store.getState();
        const timeoutMs = settings.taskTimeout || DEFAULT_TASK_TIMEOUT_MS;

        let response: Txt2ImgResponse;
        const overrideSettings: Record<string, any> = {};
        if (settings.sdModelCheckpoint) overrideSettings.sd_model_checkpoint = settings.sdModelCheckpoint;
        if (settings.sdClipSkip) overrideSettings.CLIP_stop_at_last_layers = settings.sdClipSkip;

        if (payload.mode === 'inpaint' && payload.initImageBlob && payload.maskImageBlob) {
            const initBase64 = await this.blobToBase64(payload.initImageBlob);
            const maskBase64 = await this.blobToBase64(payload.maskImageBlob);

            const body: Record<string, any> = {
                prompt: payload.prompt,
                negative_prompt: payload.negativePrompt || '',
                init_images: [initBase64],
                mask: maskBase64,
                denoising_strength: payload.denoiseStrength ?? settings.sdDenoisingStrength ?? 0.75,
                seed: payload.params.seed ?? -1,
                steps: payload.params.steps ?? settings.sdSteps ?? 20,
                cfg_scale: payload.params.cfgScale ?? settings.sdCfgScale ?? 7,
                sampler_name: payload.params.samplerName || settings.sdSamplerName || 'Euler a',
                width: payload.params.width ?? settings.sdWidth ?? 512,
                height: payload.params.height ?? settings.sdHeight ?? 768,
                override_settings: overrideSettings
            };

            response = await this.postJson<Txt2ImgResponse>('/sdapi/v1/img2img', body, timeoutMs);
        } else {
            const body: Record<string, any> = {
                prompt: payload.prompt,
                negative_prompt: payload.negativePrompt || '',
                seed: payload.params.seed ?? -1,
                steps: payload.params.steps ?? settings.sdSteps ?? 20,
                cfg_scale: payload.params.cfgScale ?? settings.sdCfgScale ?? 7,
                sampler_name: payload.params.samplerName || settings.sdSamplerName || 'Euler a',
                width: payload.params.width ?? settings.sdWidth ?? 512,
                height: payload.params.height ?? settings.sdHeight ?? 768,
                override_settings: overrideSettings
            };

            // 二阶段高清修复 (Hires.fix)
            if (settings.sdEnableHires) {
                body.enable_hr = true;
                body.hr_scale = settings.sdHiresUpscaleBy || 2;
                body.hr_upscaler = settings.sdHiresUpscaler || 'R-ESRGAN 4x+ Anime6B';
                body.hr_second_pass_steps = settings.sdHiresSteps || 15;
                body.denoising_strength = settings.sdHiresDenoise || 0.5;
            }

            response = await this.postJson<Txt2ImgResponse>('/sdapi/v1/txt2img', body, timeoutMs);
        }

        this.checkCancelled();

        if (!response.images || response.images.length === 0) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'SD-WebUI 返回空图像数据');
        }

        const imageBlobs: Blob[] = [];
        for (const b64 of response.images) {
            imageBlobs.push(this.base64ToBlob(b64, 'image/png'));
        }

        return {
            imageBlobs,
            metadata: { info: response.info, parameters: response.parameters }
        };
    }

    public async checkConnection(): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
        const start = performance.now();
        try {
            await this.getJson<Record<string, unknown>>('/sdapi/v1/options', 5000);
            return {
                connected: true,
                latencyMs: Math.round(performance.now() - start)
            };
        } catch (err: any) {
            return {
                connected: false,
                error: err?.message || String(err)
            };
        }
    }

    public override async getModels(): Promise<string[]> {
        try {
            const data = await this.getJson<Array<{ title?: string; model_name?: string }>>('/sdapi/v1/sd-models', 8000);
            if (Array.isArray(data)) {
                return data.map((m) => m.title || m.model_name || '').filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('获取 SD-WebUI 模型列表失败', err);
        }
        return [];
    }

    public override async getSamplers(): Promise<string[]> {
        try {
            const data = await this.getJson<Array<{ name?: string }>>('/sdapi/v1/samplers', 8000);
            if (Array.isArray(data)) {
                return data.map((s) => s.name || '').filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('获取 SD-WebUI 采样器列表失败', err);
        }
        return [];
    }

    public async getUpscalers(): Promise<string[]> {
        try {
            const data = await this.getJson<Array<{ name?: string }>>('/sdapi/v1/upscalers', 8000);
            if (Array.isArray(data)) {
                return data.map((u) => u.name || '').filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('获取 SD-WebUI 放大算法列表失败', err);
        }
        return [];
    }

    public override async getLoras(): Promise<string[]> {
        try {
            const data = await this.getJson<Array<{ name?: string; alias?: string }>>('/sdapi/v1/loras', 8000);
            if (Array.isArray(data)) {
                return data.map((l) => l.name || l.alias || '').filter(Boolean);
            }
        } catch (err) {
            this.logger.debug('获取 SD-WebUI LoRA 列表失败', err);
        }
        return [];
    }

    public override async interrupt(): Promise<void> {
        await super.interrupt();
        try {
            await this.postJson('/sdapi/v1/interrupt', {}, 3000);
        } catch (e) {
            this.logger.warn('中断 SD-WebUI 任务失败', e);
        }
    }
}
