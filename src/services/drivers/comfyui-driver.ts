/**
 * ComfyUI 生图引擎驱动
 * 支持 API 格式工作流变量替换，上传底图/蒙版至 /upload/image，轮询 /history/{prompt_id} 并通过 /view 获取图像。
 */

import { BaseDriver, BaseDriverOptions } from './base-driver';
import { joinPromptParts } from '../../pipeline/prompt-utils';
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
    ImageMetadata,
    ModelAssetItem
} from '../../types/driver';
import { detectModelArchitecture, detectModelFormatType } from './model-asset-utils';

export interface ComfyUIEngineConfig {
    serverUrl: string;
    activeDrawingProfileId?: string;
    activePromptProfileId?: string;
    activeWorkflowProfileId?: string;

    workflowJson?: string;
    img2imgWorkflowJson?: string;
    inpaintWorkflowJson?: string;
    steps?: number;
    cfgScale?: number;
    samplerName?: string;
    scheduler?: string;
    width?: number;
    height?: number;
    model?: string;
    clipName?: string;
    vaeName?: string;
    img2imgDenoise?: number;
    inpaintDenoise?: number;
    inpaintMaskBlur?: number;
    inpaintGrowMask?: number;
    loras?: LoraItem[];
    promptPrefix?: string;
    promptSuffix?: string;
    negativePrompt?: string;
    [key: string]: unknown;
}

export const DEFAULT_COMFYUI_CONFIG: ComfyUIEngineConfig = {
    serverUrl: 'http://127.0.0.1:8188',
    activeDrawingProfileId: 'comfyui_drawing_wai_default',
    activePromptProfileId: 'prompt_anime_general',
    activeWorkflowProfileId: 'comfyui_checkpoint_standard',
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
                "ckpt_name": "%model_name%"
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
    model: '',
    clipName: '',
    vaeName: '',
    inpaintDenoise: 0.75,
    inpaintMaskBlur: 8,
    inpaintGrowMask: 6,
    promptPrefix: '',
    promptSuffix: '',
    negativePrompt: '',
    loras: []
};

export interface ComfyUIEngineOptions extends Partial<ComfyUIEngineConfig> {
    clientId?: string;
    seed?: number;
}

export interface ComfyUIDriverOptions extends BaseDriverOptions {}

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
 * 替换工作流中的 %xxx% 占位符。
 * 数值变量保持数值字面量，字符串变量经 JSON 转义，保留换行与特殊标点。
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

    const finalPrompt = joinPromptParts(options.promptPrefix, request.prompt, options.promptSuffix);
    const finalNegativePrompt = joinPromptParts(options.negativePrompt, request.negativePrompt);

    const modelName = String(options.model || '');
    const baseValueMap: Record<string, string | number> = {
        '%prompt%': finalPrompt,
        '%negative_prompt%': finalNegativePrompt,
        '%seed%': seed,
        '%steps%': options.steps ?? 20,
        '%cfg%': options.cfgScale ?? 7.0,
        '%sampler_name%': options.samplerName || 'euler',
        '%scheduler%': options.scheduler || 'normal',
        '%width%': options.width ?? 1024,
        '%height%': options.height ?? 1024,
        '%model_name%': modelName,
        '%clip_name%': options.clipName || '',
        '%vae_name%': options.vaeName || '',
        '%denoise%': request.imageInputs?.denoiseStrength ?? options.img2imgDenoise ?? 0.75,
        '%img2img_denoise%': request.imageInputs?.denoiseStrength ?? options.img2imgDenoise ?? 0.75,
        '%inpaint_denoise%': request.imageInputs?.denoiseStrength ?? options.inpaintDenoise ?? 0.75,
        '%input_image%': initImageFileName,
        '%init_image%': initImageFileName,
        '%inpaint_image%': initImageFileName,
        '%mask_image%': maskImageFileName,
        '%inpaint_mask%': maskImageFileName,
        '%mask_blur%': options.inpaintMaskBlur ?? 8,
        '%grow_mask_by%': options.inpaintGrowMask ?? 6
    };

    let processed = rawJson;
    const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const numericKeys = ['%seed%', '%steps%', '%cfg%', '%width%', '%height%', '%denoise%', '%img2img_denoise%', '%inpaint_denoise%', '%mask_blur%', '%grow_mask_by%'];
    for (const key of numericKeys) {
        const val = baseValueMap[key];
        if (val === undefined) continue;
        const numStr = String(val);
        const escaped = escapeReg(key);
        // 使用函数式回调避免 JavaScript 字符串替换中的特殊美元符模式 ($1, $& 等) 破坏 JSON 语法
        processed = processed.replace(new RegExp(`"${escaped}"`, 'g'), () => numStr);
        processed = processed.replace(new RegExp(escaped, 'g'), () => numStr);
    }

    const stringKeys = [
        '%prompt%',
        '%negative_prompt%',
        '%sampler_name%',
        '%scheduler%',
        '%model_name%',
        '%clip_name%',
        '%vae_name%',
        '%input_image%',
        '%init_image%',
        '%inpaint_image%',
        '%mask_image%',
        '%inpaint_mask%'
    ];
    for (const key of stringKeys) {
        const val = String(baseValueMap[key] ?? '');
        const escaped = escapeReg(key);
        const jsonEncoded = JSON.stringify(val);
        // 优先替换带双引号的 "%placeholder%"，若模板为局部嵌入裸占位符则替换内部转义字符
        processed = processed.replace(new RegExp(`"${escaped}"`, 'g'), () => jsonEncoded);
        processed = processed.replace(new RegExp(escaped, 'g'), () => jsonEncoded.slice(1, -1));
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

export class ComfyUiDriver extends BaseDriver {
    public readonly id = 'comfyui';
    public readonly name = 'ComfyUI';
    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: true,
        lora: true,
        interrupt: true,
        syntaxType: 'nodeGraph'
    };

    public getDefaultConfig(): Record<string, unknown> {
        return { ...DEFAULT_COMFYUI_CONFIG };
    }

    private readonly _defaultSessionClientId: string;
    private _currentPromptId: string | null = null;
    private _objectInfoCache: { data: Record<string, unknown>; fetchedAt: number } | null = null;

    constructor(options: ComfyUIDriverOptions) {
        super(options);
        this._defaultSessionClientId = `st-da-${Math.random().toString(36).slice(2, 10)}`;
    }

    public getClientId(): string {
        const cfg = this._getConfig?.() as ComfyUIEngineOptions | undefined;
        return (cfg?.clientId as string) || this._defaultSessionClientId;
    }

    public override async checkHealth(): Promise<HealthCheckResult> {
        const start = performance.now();
        try {
            await this.getJson('/system_stats', { timeoutMs: 5000 });
            this._isConnected = true;
            return {
                ok: true,
                latencyMs: Math.round(performance.now() - start)
            };
        } catch (err: any) {
            this._isConnected = false;
            const latencyMs = Math.round(performance.now() - start);
            return {
                ok: false,
                latencyMs,
                statusCode: err instanceof DriverError ? err.statusCode : undefined,
                message: err?.message || '无法连接到 ComfyUI 服务，请确认服务已启动并已允许跨域'
            };
        }
    }

    protected override async doSyncAssets(): Promise<ProviderAssetCatalog> {
        const info = await this.fetchObjectInfo(true);
        const modelItems: ModelAssetItem[] = [];
        const seenModelNames = new Set<string>();

        const addModel = (name: string, defaultType: string) => {
            if (!name || typeof name !== 'string' || seenModelNames.has(name)) return;
            seenModelNames.add(name);
            const formatType = detectModelFormatType(name, defaultType);
            const arch = detectModelArchitecture(name);
            modelItems.push({
                name,
                type: formatType,
                architecture: arch
            });
        };

        // 1. Checkpoint 完整模型加载器
        const ckptNodes = [info['CheckpointLoaderSimple'], info['CheckpointLoader']];
        for (const node of ckptNodes) {
            const rawList = (node as any)?.input?.required?.ckpt_name?.[0];
            if (Array.isArray(rawList)) {
                for (const name of rawList) addModel(name, 'checkpoint');
            }
        }

        // 2. NF4 量化模型加载器
        const nf4Nodes = [info['CheckpointLoaderNF4']];
        for (const node of nf4Nodes) {
            const rawList = (node as any)?.input?.required?.ckpt_name?.[0];
            if (Array.isArray(rawList)) {
                for (const name of rawList) addModel(name, 'nf4');
            }
        }

        // 3. UNet / Diffusion Model 扩散模型加载器
        const unetNodes = [info['UNETLoader'], info['DiffusionModelLoader']];
        for (const node of unetNodes) {
            const rawList = (node as any)?.input?.required?.unet_name?.[0] || (node as any)?.input?.required?.model_name?.[0];
            if (Array.isArray(rawList)) {
                for (const name of rawList) addModel(name, 'unet');
            }
        }

        // 4. GGUF 量化模型加载器 (ComfyUI-GGUF)
        const ggufNodes = [info['UnetLoaderGGUF']];
        for (const node of ggufNodes) {
            const rawList = (node as any)?.input?.required?.unet_name?.[0];
            if (Array.isArray(rawList)) {
                for (const name of rawList) addModel(name, 'gguf');
            }
        }

        // 5. Diffusers 管道格式加载器
        const diffusersNodes = [info['DiffusersLoader']];
        for (const node of diffusersNodes) {
            const rawList = (node as any)?.input?.required?.model_path?.[0];
            if (Array.isArray(rawList)) {
                for (const name of rawList) addModel(name, 'diffusers');
            }
        }

        const vaes: string[] = [];
        const clips: string[] = [];
        const samplers: string[] = [];
        const schedulers: string[] = [];
        const loras: string[] = [];

        const vaeNode = info['VAELoader'] as any;
        const vaeList = vaeNode?.input?.required?.vae_name?.[0];
        if (Array.isArray(vaeList)) {
            for (const name of vaeList) {
                if (typeof name === 'string' && !vaes.includes(name)) {
                    vaes.push(name);
                }
            }
        }

        const clipNode = info['CLIPLoader'] as any;
        const clipList = clipNode?.input?.required?.clip_name?.[0];
        if (Array.isArray(clipList)) {
            for (const name of clipList) {
                if (typeof name === 'string' && !clips.includes(name)) {
                    clips.push(name);
                }
            }
        }
        const dualClip = info['DualCLIPLoader'] as any;
        const clip1 = dualClip?.input?.required?.clip_name1?.[0];
        if (Array.isArray(clip1)) {
            for (const name of clip1) {
                if (typeof name === 'string' && !clips.includes(name)) {
                    clips.push(name);
                }
            }
        }

        const ksampler = (info['KSampler'] || info['KSamplerAdvanced']) as any;
        if (Array.isArray(ksampler?.input?.required?.sampler_name?.[0])) {
            samplers.push(...ksampler.input.required.sampler_name[0]);
        }
        if (Array.isArray(ksampler?.input?.required?.scheduler?.[0])) {
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
            models: modelItems,
            vaes,
            clips,
            samplers,
            schedulers,
            loras
        };
    }

    /**
     * 按照 Weilin 语法格式化 LoRA 标签：<wlr:name:modelWeight:clipWeight:triggerWeight>
     */
    public formatLoraTag(lora: LoraItem, _mode?: string): string {
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
        const rawOptions: ComfyUIEngineOptions = {
            ...(this._getConfig?.() as ComfyUIEngineOptions | undefined),
            ...(request.engineOptions as ComfyUIEngineOptions)
        };

        let options: ComfyUIEngineOptions = { ...rawOptions };
        const drawingProfiles: any[] = (rawOptions as any).drawingProfiles || [];
        const activeDrawingId = rawOptions.activeDrawingProfileId;

        if (drawingProfiles.length > 0 && activeDrawingId) {
            const activeProfile = drawingProfiles.find((p) => p.id === activeDrawingId)?.data;
            if (activeProfile) {
                options = { ...options, ...activeProfile };

                const promptProfiles: any[] = (rawOptions as any).promptProfiles || [];
                if (activeProfile.promptProfileId && promptProfiles.length > 0) {
                    const promptProf = promptProfiles.find((p) => p.id === activeProfile.promptProfileId)?.data;
                    if (promptProf) {
                        options.promptPrefix = promptProf.promptPrefix;
                        options.promptSuffix = promptProf.promptSuffix;
                        options.negativePrompt = promptProf.negativePrompt;
                        options.loras = promptProf.loras || [];
                    }
                }

                const workflowProfiles: any[] = (rawOptions as any).workflowProfiles || [];
                const resolveWorkflowJson = (id?: string) => {
                    const found = workflowProfiles.find((w) => w.id === id);
                    return found?.data?.json || found?.json;
                };

                if (request.imageInputs?.maskImageBlob) {
                    options.workflowJson = resolveWorkflowJson(activeProfile.inpaintWorkflowId) || options.inpaintWorkflowJson || options.workflowJson;
                } else if (request.imageInputs?.initImageBlob) {
                    options.workflowJson = resolveWorkflowJson(activeProfile.img2imgWorkflowId) || options.img2imgWorkflowJson || options.workflowJson;
                } else {
                    options.workflowJson = resolveWorkflowJson(activeProfile.txt2imgWorkflowId) || options.workflowJson;
                }
            }
        }

        let effectivePrompt = (request.prompt || '').trim();
        const loras = options.loras || [];
        if (Array.isArray(loras) && loras.length > 0) {
            const loraTags = loras
                .filter((l) => Boolean(l.name) && l.enabled !== false)
                .map((l) => this.formatLoraTag(l, 'weilin'))
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

        // 携带任务前缀上传至 ComfyUI 临时目录，避免并发任务覆盖同名文件
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
                throw new DriverError(DriverErrorType.BACKEND_ERROR, `ComfyUI 任务执行完毕但未返回输出字典 [${promptId}]`);
            }

            const allImages: ComfyImageOutput[] = [];
            for (const nodeOutput of Object.values(item.outputs)) {
                if (Array.isArray(nodeOutput.images)) {
                    allImages.push(...nodeOutput.images);
                }
            }

            // 优先选取保存节点输出 (type === 'output')；若只有预览节点则降级选取预览图 (type === 'temp')
            const finalOutputs = allImages.filter((img) => img.type === 'output');
            const imageOutputs = finalOutputs.length > 0 ? finalOutputs : allImages;

            if (imageOutputs.length === 0) {
                throw new DriverError(DriverErrorType.BACKEND_ERROR, 'ComfyUI 节点已执行，但未产生图像输出');
            }

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
                await this.postControlJson('/queue', { delete: [pid] }, { timeoutMs: 3000 }).catch(() => {});
            } catch {}
        }
        try {
            await this.postControlJson('/interrupt', {}, { timeoutMs: 3000 }).catch(() => {});
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
            model: options.model,
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
            model: params.model,
            clipName: params.clipName,
            vaeName: params.vaeName,
            loras: params.loras
        };
    }

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

    private async fetchObjectInfo(force = false): Promise<Record<string, unknown>> {
        const now = Date.now();
        if (!force && this._objectInfoCache && (now - this._objectInfoCache.fetchedAt < 300_000)) {
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

    private async waitForCompletion(
        promptId: string,
        signal?: AbortSignal,
        _onProgress?: ProgressCallback
    ): Promise<void> {
        const intervalMs = 1000;
        const maxAttempts = 600;
        const cancelSignal = this.composeWithCancelSignal(signal);

        for (let i = 0; i < maxAttempts; i++) {
            if (cancelSignal?.aborted || this._cancelled) {
                throw new DriverError(DriverErrorType.CANCELLED, 'ComfyUI 任务已取消');
            }

            try {
                const history = await this.getJson<Record<string, ComfyHistoryItem>>(`/history/${promptId}`, {
                    timeoutMs: 5000,
                    signal: cancelSignal
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
                    return;
                }
            } catch (err: any) {
                if (err instanceof DriverError) {
                    throw err;
                }
            }

            await new Promise<void>((resolve, reject) => {
                const onAbort = () => {
                    clearTimeout(timer);
                    cancelSignal?.removeEventListener('abort', onAbort);
                    reject(new DriverError(DriverErrorType.CANCELLED, 'ComfyUI 任务已取消'));
                };

                const timer = setTimeout(() => {
                    cancelSignal?.removeEventListener('abort', onAbort);
                    resolve();
                }, intervalMs);

                if (cancelSignal?.aborted || this._cancelled) {
                    clearTimeout(timer);
                    reject(new DriverError(DriverErrorType.CANCELLED, 'ComfyUI 任务已取消'));
                    return;
                }

                cancelSignal?.addEventListener('abort', onAbort, { once: true });
            });
        }

        throw new DriverError(DriverErrorType.TIMEOUT, `等待 ComfyUI 执行结果超时 [${promptId}]`);
    }
}
