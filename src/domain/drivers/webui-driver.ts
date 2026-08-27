/**
 * @module domain/drivers/webui-driver
 * @description SD-WebUI (A1111) 生图后端驱动 (支持 REST 适配、Hires.fix 高清修复、500ms 进度轮询与全局中断)
 */

import { IDrawDriver, GenerationPayload } from './driver-contract';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { Logger } from '../../core/diagnostics/logger';
import { cleanPromptFormatting } from '../../core/variables/macro-variables';
import { DEFAULT_SDWEBUI_URL } from '../../core/constants';

export class SDWebUIDriver implements IDrawDriver {
    public readonly id = 'sdwebui';
    public readonly name = 'SD WebUI';

    private readonly _store: ObservableStore<DrawAssistantSettings>;
    private readonly _logger = new Logger('SDWebUIDriver');
    private _isInterrupted = false;

    constructor(store: ObservableStore<DrawAssistantSettings>) {
        this._store = store;
    }

    public async ping(): Promise<boolean> {
        try {
            const host = this.getBaseUrl();
            const res = await fetch(`${host}/sdapi/v1/sd-models`, { signal: AbortSignal.timeout(5000) });
            return res.ok;
        } catch {
            return false;
        }
    }

    public formatPrompt(rawPrompt: string): string {
        return cleanPromptFormatting(rawPrompt);
    }

    /**
     * 获取模型列表
     */
    public async getModels(): Promise<string[]> {
        try {
            const host = this.getBaseUrl();
            const res = await fetch(`${host}/sdapi/v1/sd-models`, { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    return data.map((m: any) => m.title || m.model_name);
                }
            }
        } catch (e) {
            this._logger.warn('获取 SD-WebUI 模型列表失败', e);
        }
        return [];
    }

    /**
     * 获取采样算法列表
     */
    public async getSamplers(): Promise<string[]> {
        try {
            const host = this.getBaseUrl();
            const res = await fetch(`${host}/sdapi/v1/samplers`, { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    return data.map((s: any) => s.name);
                }
            }
        } catch (e) {
            this._logger.warn('获取 SD-WebUI 采样器列表失败', e);
        }
        return [];
    }

    public async generate(
        payload: GenerationPayload,
        onProgress: (progress: { percent: number; nodeName?: string; previewBlob?: Blob }) => void
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }> {
        this._isInterrupted = false;
        const settings = this._store.getState();
        const baseUrl = this.getBaseUrl();

        // 启动 500ms 进度轮询器
        const pollTimer = setInterval(async () => {
            if (this._isInterrupted) return;
            try {
                const res = await fetch(`${baseUrl}/sdapi/v1/progress?skip_current_image=false`);
                if (res.ok) {
                    const data = await res.json();
                    const percent = Math.round((data.progress || 0) * 100);
                    onProgress({ percent });
                }
            } catch {}
        }, 500);

        try {
            let res: Response;
            let finalPrompt = payload.prompt || '';
            if (settings.sdPromptPrefix) finalPrompt = `${settings.sdPromptPrefix}, ${finalPrompt}`;
            if (settings.sdPromptSuffix) finalPrompt = `${finalPrompt}, ${settings.sdPromptSuffix}`;

            let finalNegative = payload.negativePrompt || '';
            if (settings.sdNegativePrefix) finalNegative = `${settings.sdNegativePrefix}, ${finalNegative}`;

            const overrideSettings: Record<string, any> = {};
            if (settings.sdModelCheckpoint) overrideSettings.sd_model_checkpoint = settings.sdModelCheckpoint;
            if (settings.sdClipSkip) overrideSettings.CLIP_stop_at_last_layers = settings.sdClipSkip;

            if (payload.mode === 'inpaint') {
                const initBase64 = await this.blobToBase64(payload.initImageBlob);
                const maskBase64 = await this.blobToBase64(payload.maskImageBlob);

                const body: Record<string, any> = {
                    prompt: cleanPromptFormatting(finalPrompt),
                    negative_prompt: cleanPromptFormatting(finalNegative),
                    init_images: [initBase64],
                    mask: maskBase64,
                    denoising_strength: payload.denoiseStrength ?? settings.sdDenoisingStrength ?? 0.75,
                    seed: payload.params.seed ?? -1,
                    steps: payload.params.steps ?? settings.sdSteps ?? 20,
                    cfg_scale: payload.params.cfgScale ?? settings.sdCfgScale ?? 7,
                    sampler_name: payload.params.samplerName || settings.sdSamplerName || 'Euler a',
                    width: payload.params.width ?? settings.sdWidth ?? 512,
                    height: payload.params.height ?? settings.sdHeight ?? 512,
                    override_settings: overrideSettings
                };

                res = await fetch(`${baseUrl}/sdapi/v1/img2img`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            } else {
                const body: Record<string, any> = {
                    prompt: cleanPromptFormatting(finalPrompt),
                    negative_prompt: cleanPromptFormatting(finalNegative),
                    seed: payload.params.seed ?? -1,
                    steps: payload.params.steps ?? settings.sdSteps ?? 20,
                    cfg_scale: payload.params.cfgScale ?? settings.sdCfgScale ?? 7,
                    sampler_name: payload.params.samplerName || settings.sdSamplerName || 'Euler a',
                    width: payload.params.width ?? settings.sdWidth ?? 512,
                    height: payload.params.height ?? settings.sdHeight ?? 512,
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

                res = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            }

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`SD-WebUI 生图请求失败 (${res.status}): ${errText}`);
            }

            const data = await res.json();
            const imageBlobs: Blob[] = [];

            if (Array.isArray(data.images)) {
                for (const b64 of data.images) {
                    imageBlobs.push(this.base64ToBlob(b64, 'image/png'));
                }
            }

            return {
                imageBlobs,
                metadata: { info: data.info }
            };
        } finally {
            clearInterval(pollTimer);
        }
    }

    public async interrupt(): Promise<void> {
        this._isInterrupted = true;
        try {
            const host = this.getBaseUrl();
            await fetch(`${host}/sdapi/v1/interrupt`, { method: 'POST' });
        } catch (e) {
            this._logger.warn('中断 SD-WebUI 任务失败', e);
        }
    }

    private getBaseUrl(): string {
        const settings = this._store.getState();
        return (settings.sdWebUrl || DEFAULT_SDWEBUI_URL).replace(/\/+$/, '');
    }

    private async blobToBase64(blob: Blob): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                resolve(result.replace(/^data:image\/[a-z]+;base64,/, ''));
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    private base64ToBlob(base64: string, mimeType: string): Blob {
        const byteChars = atob(base64.replace(/^data:image\/[a-z]+;base64,/, ''));
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }
}
