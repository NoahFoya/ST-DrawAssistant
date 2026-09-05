/**
 * @module domain/drivers/comfyui-adapter
 * @description ComfyUI 图像生成适配器
 *
 * 1. 支持 API 格式工作流 JSON 的变量替换；
 * 2. 支持上传底图与蒙版到 ComfyUI (/upload/image)；
 * 3. 通过轮询 /history/{prompt_id} 获取任务完成状态与输出图片；
 * 4. 通过 /view 端点获取图片并转为 Blob；
 * 5. 支持调用 /interrupt 取消任务，支持获取模型列表 (/object_info)。
 */

import { BaseDriver, BaseDriverOptions } from './base-driver';
import {
    EngineCapabilities,
    GenerationRequest,
    GenerationResult,
    HealthCheckResult,
    ProviderAssetCatalog,
    ProgressCallback,
    LoraItem,
    DriverError,
    DriverErrorType,
    ImageMetadata
} from '../types';

/** ComfyUI 配置接口 */
export interface ComfyUIEngineConfig {
    serverUrl: string;
    workflowJson: string;
    inpaintWorkflowJson?: string;
    steps: number;
    cfgScale: number;
    samplerName: string;
    scheduler: string;
    width: number;
    height: number;
    ckptName?: string;
    clipName?: string;
    vaeName?: string;
    inpaintDenoise?: number;
    inpaintMaskBlur?: number;
    inpaintGrowMask?: number;
    loras?: LoraItem[];
    [key: string]: unknown;
}

/** ComfyUI 默认配置 (包含基础文生图 API 工作流模板) */
export const DEFAULT_COMFYUI_CONFIG: ComfyUIEngineConfig = {
    serverUrl: 'http://127.0.0.1:8188',
    workflowJson: JSON.stringify({
        "3": {
            "inputs": {
                "seed": "%seed%",
                "steps": "%steps%",
                "cfg": "%cfg%",
                "sampler_name": "%sampler_name%",
                "scheduler": "%scheduler%",
                "denoise": 1,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0]
            },
            "class_type": "KSampler"
        },
        "4": {
            "inputs": {
                "ckpt_name": "%ckpt_name%"
            },
            "class_type": "CheckpointLoaderSimple"
        },
        "5": {
            "inputs": {
                "width": "%width%",
                "height": "%height%",
                "batch_size": 1
            },
            "class_type": "EmptyLatentImage"
        },
        "6": {
            "inputs": {
                "text": "%prompt%",
                "clip": ["4", 1]
            },
            "class_type": "CLIPTextEncode"
        },
        "7": {
            "inputs": {
                "text": "%negative_prompt%",
                "clip": ["4", 1]
            },
            "class_type": "CLIPTextEncode"
        },
        "8": {
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2]
            },
            "class_type": "VAEDecode"
        },
        "9": {
            "inputs": {
                "filename_prefix": "ST-Draw-",
                "images": ["8", 0]
            },
            "class_type": "SaveImage"
        }
    }),
    steps: 28,
    cfgScale: 6.5,
    samplerName: 'euler_ancestral',
    scheduler: 'normal',
    width: 832,
    height: 1216,
    ckptName: '',
    clipName: '',
    vaeName: '',
    inpaintDenoise: 0.75,
    inpaintMaskBlur: 8,
    inpaintGrowMask: 6,
    loras: []
};

/** ComfyUI 专有请求选项 */
export interface ComfyUIEngineOptions extends Partial<ComfyUIEngineConfig> {
    clientId?: string;
    seed?: number;
}

export interface ComfyUIAdapterOptions extends BaseDriverOptions {}

interface ComfyImageOutput {
    filename: string;
    subfolder?: string;
    type?: string;
}

interface ComfyHistoryItem {
    status?: {
        completed?: boolean;
        status_str?: string;
    };
    outputs?: Record<string, {
        images?: ComfyImageOutput[];
    }>;
}

/**
 * 将工作流 JSON 中的 %xxx% 占位符安全替换为实际参数
 * 数字变量保持数值，字符串变量经过 JSON.stringify 转义
 */
export function substituteWorkflowVariables(
    workflowJsonStr: string | Record<string, unknown>,
    request: GenerationRequest,
    options: ComfyUIEngineOptions = {},
    initImageFileName = '',
    maskImageFileName = ''
): Record<string, unknown> {
    const rawJson = typeof workflowJsonStr === 'string'
        ? workflowJsonStr.trim() || '{}'
        : JSON.stringify(workflowJsonStr || {});

    const seed = typeof options.seed === 'number' && options.seed >= 0
        ? options.seed
        : Math.floor(Math.random() * 1000000000000000);

    const baseValueMap: Record<string, string | number> = {
        '%prompt%': request.prompt || '',
        '%negative_prompt%': request.negativePrompt || '',
        '%seed%': seed,
        '%steps%': options.steps ?? 28,
        '%cfg%': options.cfgScale ?? 6.5,
        '%sampler_name%': options.samplerName || 'euler_ancestral',
        '%scheduler%': options.scheduler || 'normal',
        '%width%': options.width ?? 1024,
        '%height%': options.height ?? 1024,
        '%ckpt_name%': options.ckptName || '',
        '%clip_name%': options.clipName || '',
        '%vae_name%': options.vaeName || '',
        '%inpaint_denoise%': request.imageInputs?.denoiseStrength ?? options.inpaintDenoise ?? 0.75,
        '%inpaint_image%': initImageFileName,
        '%inpaint_mask%': maskImageFileName,
        '%mask_blur%': options.inpaintMaskBlur ?? 8,
        '%grow_mask_by%': options.inpaintGrowMask ?? 6
    };

    let processed = rawJson;
    const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 数字变量按数值直接替换 (同时支持 "%key%" 与 %key% 占位符)
    const numericKeys = ['%seed%', '%steps%', '%cfg%', '%width%', '%height%', '%inpaint_denoise%', '%mask_blur%', '%grow_mask_by%'];
    for (const key of numericKeys) {
        const val = baseValueMap[key];
        if (val === undefined) continue;
        const numStr = String(val);
        const escaped = escapeReg(key);
        processed = processed.replace(new RegExp(`"${escaped}"`, 'g'), numStr);
        processed = processed.replace(new RegExp(escaped, 'g'), numStr);
    }

    // 字符串变量经 JSON 序列化安全转义，保留换行与特殊标点
    const stringKeys = ['%prompt%', '%negative_prompt%', '%sampler_name%', '%scheduler%', '%ckpt_name%', '%clip_name%', '%vae_name%', '%inpaint_image%', '%inpaint_mask%'];
    for (const key of stringKeys) {
        const val = String(baseValueMap[key] ?? '');
        const escaped = escapeReg(key);
        const jsonEncoded = JSON.stringify(val);
        processed = processed.replace(new RegExp(`"${escaped}"`, 'g'), jsonEncoded);
        processed = processed.replace(new RegExp(escaped, 'g'), jsonEncoded.slice(1, -1));
    }

    try {
        return JSON.parse(processed);
    } catch (err: any) {
        throw new DriverError(
            DriverErrorType.INVALID_PARAMS,
            `ComfyUI 工作流 JSON 解析失败: ${err.message}`
        );
    }
}

export class ComfyUIAdapter extends BaseDriver {
    public readonly id = 'comfyui';
    public readonly name = 'ComfyUI';
    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: true,
        lora: true,
        progressWebSocket: false,
        interrupt: true,
        syntaxType: 'nodeGraph'
    };

    private readonly _defaultSessionClientId: string;
    private _currentPromptId: string | null = null;
    private _objectInfoCache: { data: Record<string, unknown>; fetchedAt: number } | null = null;

    constructor(options: ComfyUIAdapterOptions) {
        super(options);
        this._defaultSessionClientId = `st-da-${Math.random().toString(36).slice(2, 10)}`;
    }

    /** 获取当前生效的 ComfyUI 客户端标识 */
    public getClientId(): string {
        const cfg = this._getConfig?.() as ComfyUIEngineOptions | undefined;
        return (cfg?.clientId as string) || this._defaultSessionClientId;
    }


    public override async checkHealth(): Promise<HealthCheckResult> {
        const start = performance.now();
        try {
            await this.getJson('/system_stats', { timeoutMs: 5000 });
            return {
                ok: true,
                latencyMs: Math.round(performance.now() - start)
            };
        } catch (err: any) {
            const latencyMs = Math.round(performance.now() - start);
            return {
                ok: false,
                latencyMs,
                statusCode: err instanceof DriverError ? err.statusCode : undefined,
                message: err?.message || '无法连接到 ComfyUI 服务，请确保服务已启动并可访问'
            };
        }
    }

    protected override async doSyncAssets(): Promise<ProviderAssetCatalog> {
        const info = await this.fetchObjectInfo();
        const models: string[] = [];
        const samplers: string[] = [];
        const schedulers: string[] = [];
        const loras: string[] = [];

        const ckptNode = (info['CheckpointLoaderSimple'] || info['UNETLoader']) as any;
        if (ckptNode?.input?.required?.ckpt_name?.[0]) {
            models.push(...ckptNode.input.required.ckpt_name[0]);
        }

        const ksampler = (info['KSampler'] || info['KSamplerAdvanced']) as any;
        if (ksampler?.input?.required?.sampler_name?.[0]) {
            samplers.push(...ksampler.input.required.sampler_name[0]);
        }
        if (ksampler?.input?.required?.scheduler?.[0]) {
            schedulers.push(...ksampler.input.required.scheduler[0]);
        }

        const loraNodes = [info['LoraLoader'], info['LoraLoaderModelOnly']];
        for (const node of loraNodes) {
            const rawList = (node as any)?.input?.required?.lora_name?.[0];
            if (Array.isArray(rawList)) {
                for (const name of rawList) {
                    if (typeof name === 'string' && !loras.includes(name)) {
                        loras.push(name);
                    }
                }
            }
        }

        return {
            models,
            samplers,
            schedulers,
            loras
        };
    }

    /**
     * 将结构化 LoRA 配置格式化为 WeiLin 节点标签 (<wlr:name:modelWeight:clipWeight:triggerWeight>)
     *
     * @param lora LoRA 配置项
     * @returns 格式化后的 WeiLin 标签字符串
     */
    public formatLoraTag(lora: LoraItem): string {
        const cleanName = (lora.name || '').replace(/\.(safetensors|pt|ckpt|pth)$/i, '').trim();
        if (!cleanName) return '';
        const modelWeight = lora.weight ?? 1.0;
        const clipWeight = lora.clipWeight ?? lora.textWeight ?? modelWeight;
        const triggerWeight = lora.triggerWeight ?? 1.0;
        return `<wlr:${cleanName}:${modelWeight}:${clipWeight}:${triggerWeight}>`;
    }

    protected override async doGenerate(
        request: GenerationRequest,
        signal?: AbortSignal,
        onProgress?: ProgressCallback
    ): Promise<GenerationResult> {
        const startTime = performance.now();
        const options: ComfyUIEngineOptions = {
            ...(this._getConfig?.() as ComfyUIEngineOptions | undefined),
            ...(request.engineOptions as ComfyUIEngineOptions)
        };

        // 处理结构化 LoRA 列表拼装
        let effectivePrompt = (request.prompt || '').trim();
        const loras = options.loras || [];
        if (Array.isArray(loras) && loras.length > 0) {
            const loraTags = loras
                .filter((l) => Boolean(l.name) && l.enabled !== false)
                .map((l) => this.formatLoraTag(l))
                .filter(Boolean);

            for (const tag of loraTags) {
                if (!effectivePrompt.includes(tag)) {
                    effectivePrompt = effectivePrompt ? `${effectivePrompt} ${tag}` : tag;
                }
            }
        }

        const effectiveRequest: GenerationRequest = {
            ...request,
            prompt: effectivePrompt
        };

        let initImageFileName = '';
        let maskImageFileName = '';

        // 存在底图或遮罩时，携带唯一任务前缀上传至 ComfyUI 临时目录，杜绝并发文件名冲突
        const taskPrefix = (request.taskId || `task_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
        if (request.imageInputs?.initImageBlob) {
            initImageFileName = await this.uploadImage(request.imageInputs.initImageBlob, `${taskPrefix}_init.png`, signal);
        }
        if (request.imageInputs?.maskImageBlob) {
            maskImageFileName = await this.uploadImage(request.imageInputs.maskImageBlob, `${taskPrefix}_mask.png`, signal);
        }

        const workflowSource = options.workflowJson || {};
        const substitutedWorkflow = substituteWorkflowVariables(
            workflowSource,
            effectiveRequest,
            options,
            initImageFileName,
            maskImageFileName
        );

        const submitPayload = {
            client_id: this.getClientId(),
            prompt: substitutedWorkflow
        };

/** 格式化 ComfyUI /prompt 校验失败时的具体节点错误信息 */
function formatComfyNodeErrors(nodeErrors: unknown): string {
    if (!nodeErrors || typeof nodeErrors !== 'object') return '';
    const details: string[] = [];
    for (const [nodeId, nodeErr] of Object.entries(nodeErrors as Record<string, any>)) {
        const classType = nodeErr?.class_type ? ` [${nodeErr.class_type}]` : '';
        if (Array.isArray(nodeErr?.errors)) {
            const errMsgs = nodeErr.errors
                .map((e: any) => e?.message || e?.details || JSON.stringify(e))
                .filter(Boolean)
                .join('; ');
            if (errMsgs) {
                details.push(`节点 #${nodeId}${classType}: ${errMsgs}`);
            }
        } else if (typeof nodeErr === 'string') {
            details.push(`节点 #${nodeId}${classType}: ${nodeErr}`);
        }
    }
    return details.join('\n');
}

        const submitRes = await this.postJson<{
            prompt_id?: string;
            number?: number;
            node_errors?: Record<string, unknown>;
            error?: string | { message?: string; details?: string };
        }>(
            '/prompt',
            submitPayload,
            { signal }
        );

        if (submitRes?.node_errors && Object.keys(submitRes.node_errors).length > 0) {
            const formatted = formatComfyNodeErrors(submitRes.node_errors);
            throw new DriverError(
                DriverErrorType.INVALID_PARAMS,
                `ComfyUI 工作流校验失败:\n${formatted}`
            );
        }

        if (!submitRes?.prompt_id) {
            const errorMsg = typeof submitRes?.error === 'object'
                ? submitRes.error.message || JSON.stringify(submitRes.error)
                : (submitRes?.error || 'ComfyUI 提交失败，未返回 prompt_id');
            throw new DriverError(DriverErrorType.BACKEND_ERROR, String(errorMsg));
        }

        const promptId = submitRes.prompt_id;
        this._currentPromptId = promptId;

        try {
            // 协同等待执行生命周期 (WebSocket 优先，HTTP 轮询兜底)
            await this.waitForCompletion(promptId, signal, onProgress);
            this.checkCancelled();

            const history = await this.getJson<Record<string, ComfyHistoryItem>>(`/history/${promptId}`, { signal });
            const item = history[promptId];
            if (!item) {
                throw new DriverError(DriverErrorType.BACKEND_ERROR, `未能从 ComfyUI 历史记录中找到任务 [${promptId}]`);
            }

            if (item.status?.status_str === 'error') {
                const msgs = Array.isArray((item.status as any)?.messages)
                    ? (item.status as any).messages.map((m: any) => typeof m === 'string' ? m : JSON.stringify(m)).join('; ')
                    : '';
                throw new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `ComfyUI 任务执行异常崩溃: ${msgs || '未知节点执行错误'}`
                );
            }

            if (!item.outputs) {
                throw new DriverError(DriverErrorType.BACKEND_ERROR, `ComfyUI 任务执行完毕但无输出字典 [${promptId}]`);
            }

            const allImages: ComfyImageOutput[] = [];
            for (const nodeOutput of Object.values(item.outputs)) {
                if (Array.isArray(nodeOutput.images)) {
                    allImages.push(...nodeOutput.images);
                }
            }

            // 优先选取正式保存的图像 (type === 'output')；若工作流仅包含预览节点，则降级选取临时预览 (type === 'temp')
            const finalOutputs = allImages.filter((img) => img.type === 'output');
            const imageOutputs = finalOutputs.length > 0 ? finalOutputs : allImages;

            if (imageOutputs.length === 0) {
                throw new DriverError(DriverErrorType.BACKEND_ERROR, 'ComfyUI 节点已执行，但未产生图像输出');
            }

            // 通过 /view 拉取输出图像数据
            const blobs: Blob[] = [];
            for (const img of imageOutputs) {
                const query = new URLSearchParams({
                    filename: img.filename,
                    subfolder: img.subfolder || '',
                    type: img.type || 'output'
                });
                const blob = await this.getBlob(`/view?${query.toString()}`, { signal });
                blobs.push(blob);
            }

            const totalDurationMs = Math.round(performance.now() - startTime);

            return {
                taskId: request.taskId,
                engine: this.id,
                images: blobs.map((b) => ({
                    blob: b,
                    format: 'image/png',
                    seed: options.seed,
                    metadata: {
                        promptId,
                        imageOutputs
                    }
                })),
                durationMs: totalDurationMs
            };
        } finally {
            this._currentPromptId = null;
        }
    }

    public override async interrupt(taskId?: string): Promise<void> {
        await super.interrupt(taskId);
        const pid = this._currentPromptId;
        if (pid) {
            try {
                await this.postJson('/queue', { delete: [pid] }, { timeoutMs: 3000 }).catch(() => {});
            } catch {}
        }
        try {
            await this.postJson('/interrupt', {}, { timeoutMs: 3000 }).catch(() => {});
        } catch {}
    }

    public extractMetadata(request: GenerationRequest, _result: GenerationResult): Record<string, unknown> {
        const options: ComfyUIEngineOptions = {
            ...(this._getConfig?.() as ComfyUIEngineOptions | undefined),
            ...(request.engineOptions as ComfyUIEngineOptions)
        };
        return {
            engine: this.id,
            steps: options.steps,
            cfgScale: options.cfgScale,
            samplerName: options.samplerName,
            scheduler: options.scheduler,
            width: options.width,
            height: options.height,
            seed: options.seed,
            ckptName: options.ckptName,
            clipName: options.clipName,
            vaeName: options.vaeName,
            loras: options.loras
        };
    }

    public restoreParameters(metadata: ImageMetadata): Record<string, unknown> {
        const params = metadata.engineParams || {};
        return {
            steps: params.steps,
            cfgScale: params.cfgScale,
            samplerName: params.samplerName,
            scheduler: params.scheduler,
            width: params.width ?? metadata.dimensions?.width,
            height: params.height ?? metadata.dimensions?.height,
            seed: params.seed,
            ckptName: params.ckptName,
            clipName: params.clipName,
            vaeName: params.vaeName,
            loras: params.loras
        };
    }

    /** 上传底图或蒙版到 ComfyUI */
    private async uploadImage(blob: Blob, filename: string, signal?: AbortSignal): Promise<string> {
        const formData = new FormData();
        const file = typeof File !== 'undefined' ? new File([blob], filename, { type: blob.type }) : blob;
        formData.append('image', file, filename);
        formData.append('overwrite', 'true');

        const res = await this.uploadFormData<{ name: string; subfolder?: string; type?: string }>(
            '/upload/image',
            formData,
            { signal }
        );

        return res.name || filename;
    }

    /** 动态获取 /object_info 附带 5 分钟 TTL 缓存 */
    private async fetchObjectInfo(): Promise<Record<string, unknown>> {
        const now = Date.now();
        if (this._objectInfoCache && (now - this._objectInfoCache.fetchedAt < 300_000)) {
            return this._objectInfoCache.data;
        }

        try {
            const data = await this.getJson<Record<string, unknown>>('/object_info', { timeoutMs: 10000 });
            this._objectInfoCache = {
                data: data || {},
                fetchedAt: now
            };
            return this._objectInfoCache.data;
        } catch (err) {
            this.logger.debug('拉取 ComfyUI /object_info 失败', err);
            return {};
        }
    }

    /**
     * 等待指定 promptId 完成 (基于稳健的 HTTP /history 历史轮询，彻底避免 WebSocket 在代理/HTTPS 下报错)
     */
    private async waitForCompletion(
        promptId: string,
        signal?: AbortSignal,
        onProgress?: ProgressCallback
    ): Promise<void> {
        await this.waitViaHttpPolling(promptId, signal, onProgress);
    }

    private async waitViaHttpPolling(
        promptId: string,
        signal?: AbortSignal,
        _onProgress?: ProgressCallback
    ): Promise<void> {
        const intervalMs = 1000;
        const maxAttempts = 600; // 10 分钟最大等待

        for (let i = 0; i < maxAttempts; i++) {
            if (signal?.aborted || this._cancelled) {
                throw new DriverError(DriverErrorType.CANCELLED, 'ComfyUI 任务已取消');
            }

            try {
                const history = await this.getJson<Record<string, ComfyHistoryItem>>(`/history/${promptId}`, {
                    timeoutMs: 5000,
                    signal
                });
                if (history && history[promptId]) {
                    const item = history[promptId];
                    if (item.status?.status_str === 'error') {
                        const msgs = Array.isArray((item.status as any)?.messages)
                            ? (item.status as any).messages.map((m: any) => typeof m === 'string' ? m : JSON.stringify(m)).join('; ')
                            : '';
                        throw new DriverError(
                            DriverErrorType.BACKEND_ERROR,
                            `ComfyUI 任务执行异常崩溃: ${msgs || '未知节点执行错误'}`
                        );
                    }
                    // 已进入历史记录，说明工作流执行完成
                    return;
                }
            } catch (err: any) {
                if (err instanceof DriverError) {
                    throw err;
                }
            }

            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    signal?.removeEventListener('abort', onAbort);
                    resolve();
                }, intervalMs);

                const onAbort = () => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', onAbort);
                    reject(new DriverError(DriverErrorType.CANCELLED, 'ComfyUI 任务已取消'));
                };

                if (signal?.aborted || this._cancelled) {
                    clearTimeout(timer);
                    reject(new DriverError(DriverErrorType.CANCELLED, 'ComfyUI 任务已取消'));
                    return;
                }

                signal?.addEventListener('abort', onAbort, { once: true });
            });
        }

        throw new DriverError(DriverErrorType.TIMEOUT, `等待 ComfyUI 执行结果超时 [${promptId}]`);
    }
}
