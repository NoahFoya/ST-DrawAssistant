/**
 * @module domain/drivers/comfyui-adapter
 * @description ComfyUI 图像生成适配器实现 (API 工作流变量安全替换、WebSocket/HTTP 状态轮询、资源上传与动态发现)
 *
 * 核心特性：
 * 1. 纯领域驱动设计，解耦全局 UI Store；
 * 2. 支持 API 格式工作流 JSON 的变量安全替换 (数字保持数值型、字符串经 JSON.stringify 安全转义)；
 * 3. 支持底图/蒙版上传至 ComfyUI (/upload/image)；
 * 4. 支持持久化 clientId，通过 WebSocket 监听执行生命周期 (executing / progress / executed)，具备 HTTP 轮询保底机制；
 * 5. 最终图像通过 /view 端点拉取并归一化为标准 Blob；
 * 6. 支持队列删除与 /interrupt 协同取消，动态缓存与解析 /object_info。
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

/** ComfyUI 专有请求选项 */
export interface ComfyUIEngineOptions {
    workflowJson?: string | Record<string, unknown>;
    clientId?: string;
    steps?: number;
    cfgScale?: number;
    samplerName?: string;
    scheduler?: string;
    width?: number;
    height?: number;
    seed?: number;
    ckptName?: string;
    clipName?: string;
    vaeName?: string;
    inpaintDenoise?: number;
    inpaintMaskBlur?: number;
    inpaintGrowMask?: number;
    loras?: LoraItem[];
    [key: string]: unknown;
}

export interface ComfyUIAdapterOptions extends BaseDriverOptions {
    defaultConfig?: ComfyUIEngineOptions;
}

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
        progressWebSocket: true,
        interrupt: true,
        syntaxType: 'nodeGraph'
    };

    private readonly _defaultConfig: ComfyUIEngineOptions;
    private readonly _sessionClientId: string;
    private _currentPromptId: string | null = null;
    private _objectInfoCache: { data: Record<string, unknown>; fetchedAt: number } | null = null;

    constructor(options: ComfyUIAdapterOptions) {
        super(options);
        this._defaultConfig = options.defaultConfig || {};
        this._sessionClientId = this._defaultConfig.clientId || `st-da-${Math.random().toString(36).slice(2, 10)}`;
    }

    public async ping(): Promise<boolean> {
        try {
            await this.getJson('/system_stats', { timeoutMs: 5000 });
            return true;
        } catch {
            return false;
        }
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
            ...this._defaultConfig,
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

        // 存在底图或遮罩时，先上传至 ComfyUI 临时目录供工作流节点引用
        if (request.imageInputs?.initImageBlob) {
            initImageFileName = await this.uploadImage(request.imageInputs.initImageBlob, 'init_image.png', signal);
        }
        if (request.imageInputs?.maskImageBlob) {
            maskImageFileName = await this.uploadImage(request.imageInputs.maskImageBlob, 'mask_image.png', signal);
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
            client_id: this._sessionClientId,
            prompt: substitutedWorkflow
        };

        const submitRes = await this.postJson<{ prompt_id: string; number: number; node_errors?: unknown }>(
            '/prompt',
            submitPayload,
            { signal }
        );

        if (!submitRes?.prompt_id) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'ComfyUI 提交失败，未返回 prompt_id');
        }

        const promptId = submitRes.prompt_id;
        this._currentPromptId = promptId;

        try {
            // 协同等待执行生命周期 (WebSocket 优先，HTTP 轮询兜底)
            await this.waitForCompletion(promptId, signal, onProgress);
            this.checkCancelled();

            const history = await this.getJson<Record<string, ComfyHistoryItem>>(`/history/${promptId}`, { signal });
            const item = history[promptId];
            if (!item || !item.outputs) {
                throw new DriverError(DriverErrorType.BACKEND_ERROR, `未能从 ComfyUI 历史记录中找到任务输出 [${promptId}]`);
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
            ...this._defaultConfig,
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
        formData.append('image', blob, filename);
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
     * 等待指定 promptId 完成 (优先通过 WebSocket，环境无 WS 则 HTTP 轮询)
     */
    private async waitForCompletion(
        promptId: string,
        signal?: AbortSignal,
        onProgress?: ProgressCallback
    ): Promise<void> {
        // 尝试 WebSocket 连接
        if (typeof WebSocket !== 'undefined') {
            try {
                await this.waitViaWebSocket(promptId, signal, onProgress);
                return;
            } catch (wsErr) {
                // 关键区分：若属于领域错误 (如节点执行异常 execution_error 或任务被取消)，必须立即向外抛出；
                // 仅在真正的底层网络连接异常 (如 WebSocket 意外断开) 时才降级为 HTTP 历史轮询
                if (wsErr instanceof DriverError) {
                    throw wsErr;
                }
                this.logger.debug('WebSocket 连接失败或中断，降级为 HTTP 历史轮询', wsErr);
            }
        }

        // 降级使用 HTTP 历史轮询
        await this.waitViaHttpPolling(promptId, signal, onProgress);
    }

    private waitViaWebSocket(
        promptId: string,
        signal?: AbortSignal,
        onProgress?: ProgressCallback
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const base = this.getBaseUrl().replace(/^http/, 'ws');
            const wsUrl = `${base}/ws?clientId=${this._sessionClientId}`;
            let ws: WebSocket | null = null;

            const cleanup = () => {
                if (ws) {
                    ws.onclose = null;
                    ws.onerror = null;
                    ws.onmessage = null;
                    try {
                        ws.close();
                    } catch {}
                    ws = null;
                }
                if (signal) {
                    signal.removeEventListener('abort', onAbort);
                }
            };

            const onAbort = () => {
                cleanup();
                reject(new DriverError(DriverErrorType.CANCELLED, 'ComfyUI 任务已取消'));
            };

            if (signal?.aborted) {
                onAbort();
                return;
            }
            signal?.addEventListener('abort', onAbort);

            try {
                ws = new WebSocket(wsUrl);
            } catch (e) {
                cleanup();
                reject(e);
                return;
            }

            ws.onmessage = (event) => {
                if (typeof event.data !== 'string') return;
                try {
                    const msg = JSON.parse(event.data);
                    const { type, data } = msg;

                    if (type === 'status' || type === 'caching') return;

                    // 进度事件
                    if (type === 'progress' && data) {
                        if (data.prompt_id === promptId || !data.prompt_id) {
                            if (typeof data.value === 'number' && typeof data.max === 'number' && data.max > 0) {
                                onProgress?.(data.value / data.max);
                            }
                        }
                    }

                    // 节点执行事件
                    if (type === 'executing' && data) {
                        if (data.prompt_id === promptId) {
                            // node 为 null 表示整张图所有节点执行完成
                            if (data.node === null) {
                                cleanup();
                                resolve();
                            }
                        }
                    }

                    // 异常事件
                    if (type === 'execution_error' && data) {
                        if (data.prompt_id === promptId) {
                            cleanup();
                            reject(new DriverError(
                                DriverErrorType.BACKEND_ERROR,
                                `ComfyUI 节点执行失败: ${data.exception_message || JSON.stringify(data)}`
                            ));
                        }
                    }
                } catch {}
            };

            ws.onerror = (err) => {
                cleanup();
                reject(err);
            };

            ws.onclose = () => {
                cleanup();
                reject(new Error('WebSocket 意外断开'));
            };
        });
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
                    // 已进入历史记录，说明工作流执行完成
                    return;
                }
            } catch (err: any) {
                if (err instanceof DriverError && err.type === DriverErrorType.CANCELLED) {
                    throw err;
                }
            }

            await new Promise((r) => setTimeout(r, intervalMs));
        }

        throw new DriverError(DriverErrorType.TIMEOUT, `等待 ComfyUI 执行结果超时 [${promptId}]`);
    }
}
