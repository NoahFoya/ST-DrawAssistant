/**
 * @module domain/drivers/comfyui-driver
 * @description ComfyUI 生图后端驱动 (支持多 Loader 模型聚合、WebSocket 节点解复用、动态插槽与 Inpaint 上传)
 */

import { IDrawDriver, GenerationPayload, ComfyWorkflowMapping } from './driver-contract';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { Logger } from '../../core/diagnostics/logger';
import { cleanPromptFormatting } from '../../core/variables/macro-variables';
import { DEFAULT_COMFYUI_URL } from '../../core/constants';

export class ComfyUIDriver implements IDrawDriver {
    public readonly id = 'comfyui';
    public readonly name = 'ComfyUI';

    private readonly _store: ObservableStore<DrawAssistantSettings>;
    private readonly _logger = new Logger('ComfyUIDriver');
    private readonly _clientId = `st_da_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    private _activeWs: WebSocket | null = null;

    /** /object_info 内存缓存 (TTL: 5分钟) */
    private readonly _objectInfoCache = new Map<string, { data: Record<string, any>; fetchedAt: number }>();
    private readonly _objectInfoTTL = 300_000;

    constructor(store: ObservableStore<DrawAssistantSettings>) {
        this._store = store;
    }

    public async ping(): Promise<boolean> {
        try {
            const host = this.getBaseUrl();
            const res = await fetch(`${host}/system_stats`, { signal: AbortSignal.timeout(5000) });
            return res.ok;
        } catch {
            return false;
        }
    }

    public formatPrompt(rawPrompt: string): string {
        return cleanPromptFormatting(rawPrompt);
    }

    /**
     * 获取缓存的 /object_info/{nodeClass}
     */
    private async getCachedObjectInfo(nodeClass: string): Promise<Record<string, any>> {
        const cached = this._objectInfoCache.get(nodeClass);
        if (cached && Date.now() - cached.fetchedAt < this._objectInfoTTL) {
            return cached.data;
        }
        const host = this.getBaseUrl();
        const res = await fetch(`${host}/object_info/${nodeClass}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
            throw new Error(`获取 ${nodeClass} object_info 失败 (${res.status})`);
        }
        const data = await res.json();
        this._objectInfoCache.set(nodeClass, { data, fetchedAt: Date.now() });
        return data;
    }

    /**
     * 获取聚合的主模型列表 (合并 CheckpointLoaderSimple + UNETLoader + DiffusionModelLoader)
     */
    public async getModels(): Promise<string[]> {
        const models = new Set<string>();
        const nodes = ['CheckpointLoaderSimple', 'CheckpointLoader', 'UNETLoader', 'DiffusionModelLoader'];

        for (const nodeClass of nodes) {
            try {
                const info = await this.getCachedObjectInfo(nodeClass);
                const req = info?.[nodeClass]?.input?.required;
                if (req) {
                    for (const key of ['ckpt_name', 'unet_name', 'model_name']) {
                        const field = req[key];
                        if (Array.isArray(field) && Array.isArray(field[0])) {
                            (field[0] as string[]).forEach((m) => models.add(m));
                        }
                    }
                }
            } catch (err) {
                this._logger.debug(`获取 ComfyUI 模型节点 ${nodeClass} 失败，尝试其他节点`, err);
            }
        }
        return Array.from(models);
    }

    /**
     * 获取 CLIP 文本编码器模型列表
     */
    public async getClips(): Promise<string[]> {
        try {
            const info = await this.getCachedObjectInfo('CLIPLoader');
            const field = info?.['CLIPLoader']?.input?.required?.['clip_name'];
            if (Array.isArray(field) && Array.isArray(field[0])) {
                return field[0] as string[];
            }
        } catch {}
        return [];
    }

    /**
     * 获取 VAE 解码器模型列表
     */
    public async getVaes(): Promise<string[]> {
        try {
            const info = await this.getCachedObjectInfo('VAELoader');
            const field = info?.['VAELoader']?.input?.required?.['vae_name'];
            if (Array.isArray(field) && Array.isArray(field[0])) {
                return field[0] as string[];
            }
        } catch {}
        return [];
    }

    /**
     * 获取 LoRA 模型列表
     */
    public async getLoras(): Promise<string[]> {
        try {
            const info = await this.getCachedObjectInfo('LoraLoader');
            const field = info?.['LoraLoader']?.input?.required?.['lora_name'];
            if (Array.isArray(field) && Array.isArray(field[0])) {
                return field[0] as string[];
            }
        } catch {}
        return [];
    }

    /**
     * 获取采样算法 (Sampler) 列表
     */
    public async getSamplers(): Promise<string[]> {
        try {
            const info = await this.getCachedObjectInfo('KSampler');
            const field = info?.['KSampler']?.input?.required?.['sampler_name'];
            if (Array.isArray(field) && Array.isArray(field[0])) {
                return field[0] as string[];
            }
        } catch {}
        return [];
    }

    /**
     * 获取调度器 (Scheduler) 列表
     */
    public async getSchedulers(): Promise<string[]> {
        try {
            const info = await this.getCachedObjectInfo('KSampler');
            const field = info?.['KSampler']?.input?.required?.['scheduler'];
            if (Array.isArray(field) && Array.isArray(field[0])) {
                return field[0] as string[];
            }
        } catch {}
        return [];
    }

    public async generate(
        payload: GenerationPayload,
        onProgress: (progress: { percent: number; nodeName?: string; previewBlob?: Blob }) => void
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }> {
        const settings = this._store.getState();
        const baseUrl = this.getBaseUrl();

        // 1. 验证工作流 JSON
        const workflowTemplateStr =
            payload.mode === 'inpaint'
                ? settings.inpaintWorkflowJson || settings.workflowJson
                : settings.workflowJson;

        if (!workflowTemplateStr) {
            throw new Error('未配置 ComfyUI 工作流 JSON，请先在 ComfyUI 设置面板中导入');
        }

        let workflow: Record<string, any>;
        try {
            workflow = typeof workflowTemplateStr === 'string' ? JSON.parse(workflowTemplateStr) : workflowTemplateStr;
        } catch (e: any) {
            throw new Error(`工作流 JSON 格式错误: ${e.message}`);
        }

        // 2. 如果是 Inpaint 模式，先上传底图与遮罩
        let initImageFileName = '';
        let maskImageFileName = '';
        if (payload.mode === 'inpaint') {
            initImageFileName = await this.uploadImage(baseUrl, payload.initImageBlob, 'inpaint_init.png');
            maskImageFileName = await this.uploadImage(baseUrl, payload.maskImageBlob, 'inpaint_mask.png');
        }

        // 3. 动态映射插槽节点参数与模型注入
        this.injectWorkflowParameters(workflow, payload, settings, initImageFileName, maskImageFileName);

        // 4. 建立 WebSocket 监听与提交任务
        const wsUrl = baseUrl.replace(/^http/, 'ws');
        const promptId = await this.submitPrompt(baseUrl, workflow);

        return new Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }>((resolve, reject) => {
            let isResolved = false;
            const ws = new WebSocket(`${wsUrl}/ws?clientId=${this._clientId}`);
            this._activeWs = ws;

            const timeoutTimer = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    try {
                        ws.close();
                    } catch {}
                    reject(new Error(`ComfyUI 任务执行超时 (prompt_id: ${promptId})`));
                }
            }, (settings.requestTimeout || 120) * 1000);

            ws.onmessage = async (event) => {
                if (typeof event.data === 'string') {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'progress' && msg.data?.value && msg.data?.max) {
                            const percent = Math.round((msg.data.value / msg.data.max) * 100);
                            onProgress({ percent, nodeName: msg.data.node });
                        } else if (msg.type === 'executed' && msg.data?.prompt_id === promptId) {
                            if (msg.data.output?.images) {
                                if (isResolved) return;
                                isResolved = true;
                                clearTimeout(timeoutTimer);
                                try {
                                    ws.close();
                                } catch {}
                                const images = msg.data.output.images;
                                const blobs = await this.fetchResultImages(baseUrl, images);
                                resolve({
                                    imageBlobs: blobs,
                                    metadata: { promptId, payload }
                                });
                            }
                        } else if (msg.type === 'execution_error' && msg.data?.prompt_id === promptId) {
                            if (isResolved) return;
                            isResolved = true;
                            clearTimeout(timeoutTimer);
                            try {
                                ws.close();
                            } catch {}
                            reject(new Error(`ComfyUI 执行报错: ${msg.data.exception_message || '未知错误'}`));
                        }
                    } catch {}
                }
            };

            ws.onerror = (err) => {
                this._logger.error('WebSocket 连接异常', err);
            };

            ws.onclose = () => {
                this._activeWs = null;
            };
        });
    }

    public async interrupt(): Promise<void> {
        try {
            const host = this.getBaseUrl();
            await fetch(`${host}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(3000) });
            this._activeWs?.close();
        } catch (e) {
            this._logger.warn('中断 ComfyUI 任务失败', e);
        }
    }

    private getBaseUrl(): string {
        const settings = this._store.getState();
        return (settings.serverUrl || DEFAULT_COMFYUI_URL).replace(/\/+$/, '');
    }

    private async uploadImage(baseUrl: string, blob: Blob, filename: string): Promise<string> {
        const formData = new FormData();
        formData.append('image', blob, filename);
        formData.append('overwrite', 'true');

        const res = await fetch(`${baseUrl}/upload/image`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            throw new Error(`上传图片至 ComfyUI 失败: ${res.statusText}`);
        }

        const data = await res.json();
        return data.name || filename;
    }

    private async submitPrompt(baseUrl: string, promptWorkflow: Record<string, any>): Promise<string> {
        const res = await fetch(`${baseUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: promptWorkflow,
                client_id: this._clientId
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`提交 ComfyUI 任务失败 (${res.status}): ${errText}`);
        }

        const data = await res.json();
        return data.prompt_id;
    }

    private async fetchResultImages(baseUrl: string, images: Array<{ filename: string; subfolder: string; type: string }>): Promise<Blob[]> {
        const blobs: Blob[] = [];
        for (const img of images) {
            const url = `${baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`;
            const res = await fetch(url);
            if (res.ok) {
                blobs.push(await res.blob());
            }
        }
        return blobs;
    }

    private injectWorkflowParameters(
        workflow: Record<string, any>,
        payload: GenerationPayload,
        settings: DrawAssistantSettings,
        initFileName?: string,
        maskFileName?: string
    ): void {
        const mapping: ComfyWorkflowMapping = {
            promptNodeId: settings.workflowInjection?.positiveNodeId || '6',
            negativeNodeId: settings.workflowInjection?.negativeNodeId || '7',
            samplerNodeId: settings.workflowInjection?.kSamplerNodeId || '3',
            latentNodeId: settings.workflowInjection?.widthNodeId || '5',
            outputNodeId: settings.workflowInjection?.saveImageNodeId || '9',
            imageInputNodeId: '10',
            maskInputNodeId: '11'
        };

        // 1. 注入正反向提示词 (合并前缀与模板)
        let finalPrompt = payload.prompt || '';
        if (settings.checkpointPositivePrefix) finalPrompt = `${settings.checkpointPositivePrefix}, ${finalPrompt}`;
        if (settings.promptPrefix) finalPrompt = `${settings.promptPrefix}, ${finalPrompt}`;
        if (settings.promptSuffix) finalPrompt = `${finalPrompt}, ${settings.promptSuffix}`;

        let finalNegative = payload.negativePrompt || '';
        if (settings.checkpointNegativePrefix) finalNegative = `${settings.checkpointNegativePrefix}, ${finalNegative}`;
        if (settings.negativePrefix) finalNegative = `${settings.negativePrefix}, ${finalNegative}`;

        if (workflow[mapping.promptNodeId]?.inputs) {
            workflow[mapping.promptNodeId].inputs.text = cleanPromptFormatting(finalPrompt);
        }
        if (workflow[mapping.negativeNodeId]?.inputs) {
            workflow[mapping.negativeNodeId].inputs.text = cleanPromptFormatting(finalNegative);
        }

        // 2. 注入 KSampler / 采样器参数
        if (workflow[mapping.samplerNodeId]?.inputs) {
            const sInputs = workflow[mapping.samplerNodeId].inputs;
            sInputs.seed = payload.params.seed ?? Math.floor(Math.random() * 10000000000);
            sInputs.steps = payload.params.steps ?? settings.steps ?? 28;
            sInputs.cfg = payload.params.cfgScale ?? settings.cfgScale ?? 6.5;
            if (payload.params.samplerName || settings.samplerName) {
                sInputs.sampler_name = payload.params.samplerName || settings.samplerName;
            }
            if (payload.params.scheduler || settings.scheduler) {
                sInputs.scheduler = payload.params.scheduler || settings.scheduler;
            }
            if (payload.mode === 'inpaint') {
                sInputs.denoise = payload.denoiseStrength ?? settings.inpaintDenoise ?? 0.75;
            }
        }

        // 3. 注入分辨率尺寸 (EmptyLatentImage)
        if (workflow[mapping.latentNodeId]?.inputs) {
            const lInputs = workflow[mapping.latentNodeId].inputs;
            if (typeof lInputs.width !== 'undefined') lInputs.width = payload.params.width ?? settings.width ?? 1024;
            if (typeof lInputs.height !== 'undefined') lInputs.height = payload.params.height ?? settings.height ?? 1024;
        }

        // 4. 遍历工作流注入 Checkpoint / UNet / CLIP / VAE 模型选择
        for (const node of Object.values(workflow)) {
            if (!node || !node.inputs) continue;
            const classType = node.class_type;

            // 主模型 (CheckpointLoaderSimple / UNETLoader / DiffusionModelLoader)
            if (
                (classType === 'CheckpointLoaderSimple' || classType === 'CheckpointLoader' || classType === 'UNETLoader' || classType === 'DiffusionModelLoader') &&
                settings.ckptName
            ) {
                if (typeof node.inputs.ckpt_name !== 'undefined') node.inputs.ckpt_name = settings.ckptName;
                if (typeof node.inputs.unet_name !== 'undefined') node.inputs.unet_name = settings.ckptName;
                if (typeof node.inputs.model_name !== 'undefined') node.inputs.model_name = settings.ckptName;
            }

            // 独立 CLIP 编码器
            if (classType === 'CLIPLoader' && settings.clipName) {
                if (typeof node.inputs.clip_name !== 'undefined') node.inputs.clip_name = settings.clipName;
            }

            // 独立 VAE 解码器
            if (classType === 'VAELoader' && settings.vaeName) {
                if (typeof node.inputs.vae_name !== 'undefined') node.inputs.vae_name = settings.vaeName;
            }
        }

        // 5. 注入重绘底图与遮罩
        if (initFileName && mapping.imageInputNodeId && workflow[mapping.imageInputNodeId]?.inputs) {
            workflow[mapping.imageInputNodeId].inputs.image = initFileName;
        }
        if (maskFileName && mapping.maskInputNodeId && workflow[mapping.maskInputNodeId]?.inputs) {
            workflow[mapping.maskInputNodeId].inputs.image = maskFileName;
        }
    }
}
