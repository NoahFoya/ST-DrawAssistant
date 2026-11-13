/**
 * ComfyUI 绘图服务提供方适配器 (ComfyUIProvider)。
 *
 * 基于 ComfyUI API 对接服务端：
 * 1. 将提示词与参数注入工作流模板并提交至 POST /prompt；
 * 2. 深度解析服务端返回的 node_errors 节点校验异常；
 * 3. 轮询 GET /history/{prompt_id} 并在完成后从 GET /view 下载图片；
 * 4. 任务取消或超时时采用客户端丢弃策略，仅中止本地轮询，不向服务端发送队列删除或中断指令。
 */

import type {
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    ImageGenerationMetadata,
    ComfyUIProviderConfig,
    DrawingPresetData,
    WorkflowPresetData,
} from '@types';
import { BaseGenerationProvider, type BaseProviderOptions } from '../base-provider';
import { buildWorkflow, resolveSeed, type WorkflowVariables } from './workflow-builder';
import { imageInputToBlob, ensureValidImageBlob, HttpError } from '../../util/http-client';
import { logger } from '../../util/logger';

interface ComfyPromptHistoryOutput {
    images?: Array<{ filename: string; subfolder?: string; type?: string }>;
}

interface ComfyPromptHistoryItem {
    status?: {
        status_str?: string;
        completed?: boolean;
        messages?: unknown[];
    };
    outputs?: Record<string, ComfyPromptHistoryOutput>;
}

/** 解析 ComfyUI 提交接口返回或 HttpError 中的 node_errors / error 详细校验信息 */
function formatComfySubmitError(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
        return typeof payload === 'string' && payload.trim() ? payload.trim() : undefined;
    }
    const obj = payload as {
        error?: { message?: string; details?: string } | string;
        node_errors?: Record<
            string,
            {
                errors?: Array<{ message?: string; details?: string } | string>;
                message?: string;
                class_type?: string;
            }
        >;
    };

    if (obj.node_errors && Object.keys(obj.node_errors).length > 0) {
        return Object.entries(obj.node_errors)
            .map(([nodeId, errObj]) => {
                let errorText = '';
                if (Array.isArray(errObj.errors)) {
                    errorText = errObj.errors
                        .map((e) =>
                            typeof e === 'object' && e?.message
                                ? `${e.message}${e.details ? ` (${e.details})` : ''}`
                                : String(e)
                        )
                        .join(', ');
                } else {
                    errorText = errObj.message || JSON.stringify(errObj);
                }
                return `节点 ${nodeId} (${errObj.class_type || 'Unknown'}): ${errorText}`;
            })
            .join('; ');
    }

    if (typeof obj.error === 'string' && obj.error.trim()) {
        return obj.error.trim();
    }
    if (obj.error && typeof obj.error === 'object' && obj.error.message) {
        return `${obj.error.message}${obj.error.details ? ` (${obj.error.details})` : ''}`;
    }
    return undefined;
}

/** 判定 ComfyUI 历史记录中是否已产出有效图像文件 */
function hasComfyImageOutputs(item?: ComfyPromptHistoryItem): boolean {
    if (!item?.outputs) return false;
    return Object.values(item.outputs).some(
        (nodeOut) => Array.isArray(nodeOut?.images) && nodeOut.images.some((img) => Boolean(img?.filename))
    );
}

/** ComfyUI 提供方初始化配置项 */
export interface ComfyUIProviderOptions extends BaseProviderOptions {
    /** 会话客户端唯一标识符（可选，缺省自动生成随机标识） */
    clientId?: string;
}

/** ComfyUI /object_info 单个节点的输入参数与元数据定义 */
export interface ComfyNodeDef {
    input?: {
        required?: Record<string, unknown[]>;
        optional?: Record<string, unknown[]>;
    };
    output?: unknown[];
    output_name?: string[];
    name?: string;
    display_name?: string;
    description?: string;
    category?: string;
}

/** ComfyUI 服务端 /object_info 返回的完整节点字典 */
export type ComfyObjectInfoMap = Record<string, ComfyNodeDef>;

/**
 * ComfyUI 绘图服务提供方实现类。
 */
export class ComfyUIProvider extends BaseGenerationProvider {
    public readonly providerType: ProviderType = 'comfyui';
    public readonly name: string = 'ComfyUI';

    private _clientId: string;

    // /object_info 节点元数据缓存与单飞并发去重 (Single-flight)
    private _objectInfoCache: {
        data: ComfyObjectInfoMap;
        serverUrl: string;
        transport: string;
        timestamp: number;
    } | null = null;
    private _inFlightObjectInfo: Promise<ComfyObjectInfoMap> | null = null;

    /** /object_info 节点元数据缓存有效期 (60 秒) */
    private static readonly OBJECT_INFO_CACHE_TTL_MS = 60_000;

    public constructor(options: ComfyUIProviderOptions = {}) {
        super(options);
        this._clientId = options.clientId ?? `st-da-${Math.random().toString(36).substring(2, 10)}`;
    }

    /**
     * 获取 ComfyUI 服务基础地址。
     *
     * @remarks
     * 读取配置中心的 ComfyUI 服务地址，未配置时缺省为默认本地地址 (http://127.0.0.1:8188)。
     * 自动规整末尾斜杠以确保 URL 拼接的一致性。
     */
    public getServerUrl(): string {
        const config = this._settingsStore?.getProviderConfig<ComfyUIProviderConfig>('comfyui');
        if (config?.serverUrl) {
            return this.normalizeUrl(config.serverUrl);
        }
        return 'http://127.0.0.1:8188';
    }

    /**
     * 检查 ComfyUI 服务连通性。
     *
     * @param signal 中止信号
     */
    public async checkHealth(signal?: AbortSignal): Promise<ProviderHealthResult> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const probeUrl = `${serverUrl}/system_stats`;

        const pingResult = await this._httpClient.ping(probeUrl, {
            transport,
            signal,
            timeoutMs: 5000,
        });

        if (pingResult.ok) {
            return {
                status: 'ok',
                latencyMs: pingResult.latencyMs,
                message: `ComfyUI 响应正常 (${pingResult.latencyMs}ms)`,
            };
        }

        return {
            status: 'error',
            latencyMs: pingResult.latencyMs,
            message: pingResult.error || `连接失败 (HTTP ${pingResult.status ?? 'unknown'})`,
        };
    }

    /**
     * 清空当前提供方内存中的资产缓存。
     */
    public clearAssetCache(): void {
        this._objectInfoCache = null;
        this._inFlightObjectInfo = null;
    }

    /**
     * 获取 ComfyUI 服务端的 /object_info 节点元数据字典。
     *
     * @remarks
     * 1. 单飞并发去重 (Single-flight)：并发请求共享同一个进行中的 Promise，避免瞬间并发打满连接池；
     * 2. 60 秒短时 TTL 缓存：减少大体积 JSON 重复网络传输与 JSON.parse 性能损耗；
     * 3. 显式刷新与环境失效：支持 forceRefresh 直接请求服务端，并在服务地址或连接方式变更时自动失效旧缓存。
     *
     * @param signal 中止信号
     * @param forceRefresh 是否强制忽略缓存拉取最新数据
     */
    public async fetchObjectInfo(
        signal?: AbortSignal,
        forceRefresh = false
    ): Promise<ComfyObjectInfoMap> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const now = Date.now();

        // 1. 检查有效缓存（地址和协议一致，且未过期）
        if (
            !forceRefresh &&
            this._objectInfoCache &&
            this._objectInfoCache.serverUrl === serverUrl &&
            this._objectInfoCache.transport === transport &&
            now - this._objectInfoCache.timestamp < ComfyUIProvider.OBJECT_INFO_CACHE_TTL_MS
        ) {
            return this._objectInfoCache.data;
        }

        // 2. 正在进行中的请求直接合并复用
        if (this._inFlightObjectInfo) {
            return this._inFlightObjectInfo;
        }

        // 3. 发起真实网络请求
        const url = `${serverUrl}/object_info`;
        const fetchPromise = (async () => {
            try {
                const response = await this.fetchWithTransport(
                    url,
                    { method: 'GET', timeoutMs: 30000, signal },
                    transport
                );
                const data = (await response.json()) as ComfyObjectInfoMap;
                this._objectInfoCache = {
                    data,
                    serverUrl,
                    transport,
                    timestamp: Date.now(),
                };
                return data;
            } finally {
                this._inFlightObjectInfo = null;
            }
        })();

        this._inFlightObjectInfo = fetchPromise;
        return fetchPromise;
    }

    /**
     * 获取 ComfyUI 服务端支持的主模型列表。
     *
     * @param signal 中止信号
     * @returns 可用模型文件名数组
     */
    public async fetchModels(signal?: AbortSignal): Promise<string[]> {
        const cat = await this.fetchCategorizedModels(signal);
        return Array.from(new Set([...cat.checkpoints, ...cat.unets]));
    }

    /**
     * 获取按类别分组的 ComfyUI 服务端支持的主模型列表。
     *
     * @param signal 中止信号
     * @returns 包含 checkpoints 与 unets 的分类模型列表
     */
    public async fetchCategorizedModels(
        signal?: AbortSignal
    ): Promise<{ checkpoints: string[]; unets: string[] }> {
        const data = await this.fetchObjectInfo(signal);

        const checkpoints = new Set<string>();
        const unets = new Set<string>();

        // 1. Checkpoint 模型 (CheckpointLoader / CheckpointLoaderSimple)
        const simpleCkpt = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
        if (Array.isArray(simpleCkpt)) {
            for (const name of simpleCkpt) {
                if (typeof name === 'string' && name.trim()) checkpoints.add(name.trim());
            }
        }
        const fullCkpt = data?.CheckpointLoader?.input?.required?.ckpt_name?.[0];
        if (Array.isArray(fullCkpt)) {
            for (const name of fullCkpt) {
                if (typeof name === 'string' && name.trim()) checkpoints.add(name.trim());
            }
        }

        // 2. UNet / 扩散模型 (UNETLoader / UnetLoaderGGUF / DiffusionModelLoader)
        const unetNames = data?.UNETLoader?.input?.required?.unet_name?.[0];
        if (Array.isArray(unetNames)) {
            for (const name of unetNames) {
                if (typeof name === 'string' && name.trim()) unets.add(name.trim());
            }
        }
        const ggufNames = data?.UnetLoaderGGUF?.input?.required?.unet_name?.[0];
        if (Array.isArray(ggufNames)) {
            for (const name of ggufNames) {
                if (typeof name === 'string' && name.trim()) unets.add(name.trim());
            }
        }
        const diffNames = data?.DiffusionModelLoader?.input?.required?.unet_name?.[0];
        if (Array.isArray(diffNames)) {
            for (const name of diffNames) {
                if (typeof name === 'string' && name.trim()) unets.add(name.trim());
            }
        }

        return {
            checkpoints: Array.from(checkpoints),
            unets: Array.from(unets),
        };
    }

    /**
     * 获取 ComfyUI 服务端已加载的 VAE 模型列表。
     *
     * @param signal 中止信号
     * @returns 可用 VAE 模型名称数组
     */
    public async fetchVaes(signal?: AbortSignal): Promise<string[]> {
        const data = await this.fetchObjectInfo(signal);

        const vaeSet = new Set<string>();
        const vaeNames = data?.VAELoader?.input?.required?.vae_name?.[0];
        if (Array.isArray(vaeNames)) {
            for (const name of vaeNames) {
                if (typeof name === 'string' && name.trim()) {
                    vaeSet.add(name.trim());
                }
            }
        }

        return Array.from(vaeSet);
    }

    /**
     * 获取 ComfyUI 服务端已加载的 CLIP 编码器模型列表。
     *
     * @param signal 中止信号
     * @returns 可用 CLIP 模型名称数组
     */
    public async fetchClips(signal?: AbortSignal): Promise<string[]> {
        const data = await this.fetchObjectInfo(signal);

        const clipSet = new Set<string>();
        const clipNames = data?.CLIPLoader?.input?.required?.clip_name?.[0];
        if (Array.isArray(clipNames)) {
            for (const name of clipNames) {
                if (typeof name === 'string' && name.trim()) {
                    clipSet.add(name.trim());
                }
            }
        }
        const dualClipNames = data?.DualCLIPLoader?.input?.required?.clip_name1?.[0];
        if (Array.isArray(dualClipNames)) {
            for (const name of dualClipNames) {
                if (typeof name === 'string' && name.trim()) {
                    clipSet.add(name.trim());
                }
            }
        }

        return Array.from(clipSet);
    }

    /**
     * 获取 ComfyUI 服务端已载入的 LoRA 模型列表。
     *
     * @param signal 中止信号
     * @returns 可用 LoRA 模型文件名数组
     */
    public async fetchLoras(signal?: AbortSignal): Promise<string[]> {
        const data = await this.fetchObjectInfo(signal);
        const loras = new Set<string>();

        const list1 = data?.LoraLoader?.input?.required?.lora_name?.[0];
        if (Array.isArray(list1)) {
            for (const name of list1) {
                if (typeof name === 'string' && name.trim()) {
                    loras.add(name.trim());
                }
            }
        }
        const list2 = data?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0];
        if (Array.isArray(list2)) {
            for (const name of list2) {
                if (typeof name === 'string' && name.trim()) {
                    loras.add(name.trim());
                }
            }
        }

        return Array.from(loras);
    }

    /**
     * 获取 ComfyUI 服务端支持的采样算法列表。
     *
     * @param signal 中止信号
     * @returns 可用采样算法名称数组
     */
    public async fetchSamplers(signal?: AbortSignal): Promise<string[]> {
        const data = await this.fetchObjectInfo(signal);
        const samplers = new Set<string>();

        const ksamplerSamplers = data?.KSampler?.input?.required?.sampler_name?.[0];
        if (Array.isArray(ksamplerSamplers)) {
            for (const name of ksamplerSamplers) {
                if (typeof name === 'string' && name.trim()) {
                    samplers.add(name.trim());
                }
            }
        }
        const customSamplers = data?.KSamplerAdvanced?.input?.required?.sampler_name?.[0];
        if (Array.isArray(customSamplers)) {
            for (const name of customSamplers) {
                if (typeof name === 'string' && name.trim()) {
                    samplers.add(name.trim());
                }
            }
        }

        return Array.from(samplers);
    }

    /**
     * 获取 ComfyUI 服务端支持的调度器列表。
     *
     * @param signal 中止信号
     * @returns 可用调度器名称数组
     */
    public async fetchSchedulers(signal?: AbortSignal): Promise<string[]> {
        const data = await this.fetchObjectInfo(signal);
        const schedulers = new Set<string>();

        const ksamplerSchedulers = data?.KSampler?.input?.required?.scheduler?.[0];
        if (Array.isArray(ksamplerSchedulers)) {
            for (const name of ksamplerSchedulers) {
                if (typeof name === 'string' && name.trim()) {
                    schedulers.add(name.trim());
                }
            }
        }
        const customSchedulers = data?.KSamplerAdvanced?.input?.required?.scheduler?.[0];
        if (Array.isArray(customSchedulers)) {
            for (const name of customSchedulers) {
                if (typeof name === 'string' && name.trim()) {
                    schedulers.add(name.trim());
                }
            }
        }

        return Array.from(schedulers);
    }

    /**
     * 上传二进制图像文件至 ComfyUI 服务端。
     *
     * @param blob 待上传的图片二进制 Blob
     * @param fileName 上传文件名 (如 st_inpaint_init_xxx.png)
     * @param imageType 目标目录类型，默认为 'input'
     * @param signal 中止信号
     * @returns 服务端确认的文件名
     */
    public async uploadImageBlob(
        blob: Blob,
        fileName: string,
        imageType = 'input',
        signal?: AbortSignal
    ): Promise<string> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const formData = new FormData();
        formData.append('image', blob, fileName);
        formData.append('type', imageType);
        formData.append('overwrite', 'true');

        const uploadUrl = `${serverUrl}/upload/image`;
        const response = await this.fetchWithTransport(
            uploadUrl,
            {
                method: 'POST',
                body: formData,
                timeoutMs: 30000,
                retries: 1,
                signal,
            },
            transport
        );

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`ComfyUI 图像上传失败 (${response.status}): ${errText || response.statusText}`);
        }

        const data = (await response.json()) as { name?: string };
        return data.name || fileName;
    }

    /**
     * 执行 ComfyUI 图像生成任务。
     *
     * @param request 生图请求参数
     * @param signal 中止信号
     * @returns 包含图像 Blob 与生成元数据的生成结果
     */
    public async generate(
        request: GenerationRequest,
        signal?: AbortSignal
    ): Promise<GenerationResult> {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        const startTime = Date.now();
        const transport = this.getTransport();
        const serverUrl = this.getServerUrl();
        const params = request.parameters ?? {};
        const maxTimeoutMs = this.getTimeoutMs();

        // 1. 读取激活的绘图预设（优先使用队列快照固定的 drawingPresetId）
        const drawingPreset = this.resolveDrawingPreset<DrawingPresetData>(params);

        const isInpaintMode = params.mode === 'inpaint';

        // 2. 加载工作流模板（显式参数优先，缺省使用预设绑定的工作流）
        let rawWorkflow: Record<string, unknown> | undefined;
        let resolvedWorkflowId: string | undefined;

        if (params.workflow) {
            resolvedWorkflowId = (isInpaintMode
                ? (params.inpaintPresetId ?? drawingPreset?.inpaintPresetId)
                : (params.txt2imgWorkflowId ?? drawingPreset?.txt2imgWorkflowId)) as string | undefined;
            if (typeof params.workflow === 'string') {
                try {
                    rawWorkflow = JSON.parse(params.workflow);
                } catch {
                    throw new Error('ComfyUI 工作流 JSON 格式解析失败');
                }
            } else if (typeof params.workflow === 'object' && params.workflow !== null) {
                rawWorkflow = params.workflow as Record<string, unknown>;
            }
        } else if (this._settingsStore) {
            if (isInpaintMode) {
                resolvedWorkflowId = (params.inpaintPresetId ?? drawingPreset?.inpaintPresetId) as string | undefined;
                if (!resolvedWorkflowId) {
                    throw new Error('当前预设未绑定局部重绘预设，请前往设置中心-ComfyUI 绑定局部重绘预设');
                }
            } else {
                resolvedWorkflowId =
                    (params.txt2imgWorkflowId as string | undefined) ?? drawingPreset?.txt2imgWorkflowId;
                if (!resolvedWorkflowId) {
                    throw new Error('当前预设未配置文生图工作流，请在设置中绑定');
                }
            }

            const workflowPreset = this._settingsStore.getPreset<WorkflowPresetData>(
                'workflows',
                resolvedWorkflowId
            );
            if (workflowPreset?.data?.workflow) {
                rawWorkflow = workflowPreset.data.workflow;
            } else {
                throw new Error(`缺少有效的工作流模板：绑定的工作流预设不存在或已失效 (ID: ${resolvedWorkflowId})`);
            }
        }

        if (!rawWorkflow || Object.keys(rawWorkflow).length === 0) {
            throw new Error('缺少有效的工作流模板，请在设置中选择或在请求参数中传入');
        }

        // 3. 解析提示词与变量映射，构建执行工作流对象
        const promptText = request.prompt;
        const negativePromptText = request.negativePrompt ?? '';

        const resolvedBaseModel = (params.baseModel ?? drawingPreset?.baseModel) as string | undefined;
        const extraModels = (params.extraModels ?? drawingPreset?.extraModels ?? []) as string[];
        const resolvedSeed = resolveSeed(params.seed as number | undefined ?? drawingPreset?.seed);

        let uploadedInitImageName: string | undefined;
        let uploadedMaskImageName: string | undefined;

        if (isInpaintMode) {
            const sourceImage = request.sourceImage;
            const maskImage = request.maskImage;

            if (!sourceImage) {
                throw new Error('局部重绘模式下必须提供底图数据');
            }
            if (!maskImage) {
                throw new Error('局部重绘模式下必须提供遮罩蒙版数据');
            }

            const [sourceBlob, maskBlob] = await Promise.all([
                imageInputToBlob(sourceImage),
                imageInputToBlob(maskImage),
            ]);

            const timestamp = Date.now();
            const sourceFileName = `st_inpaint_init_${timestamp}.png`;
            const maskFileName = `st_inpaint_mask_${timestamp}.png`;

            [uploadedInitImageName, uploadedMaskImageName] = await Promise.all([
                this.uploadImageBlob(sourceBlob, sourceFileName, 'input', signal),
                this.uploadImageBlob(maskBlob, maskFileName, 'input', signal),
            ]);
        }

        const variables: WorkflowVariables = {
            basemodel_name: resolvedBaseModel,
            model_name: resolvedBaseModel,
            unet_name: (params.unetName ?? resolvedBaseModel) as string | undefined,
            clip_name: (params.clipName ?? drawingPreset?.clipName ?? '') as string,
            vae_name: (params.vaeName ?? drawingPreset?.vaeName ?? '') as string,

            prompt: promptText,
            negative_prompt: negativePromptText,

            seed: resolvedSeed,
            steps: (params.steps ?? drawingPreset?.steps) as number | undefined,
            cfg: (params.cfgScale ?? drawingPreset?.cfgScale) as number | undefined,
            sampler_name: (params.samplerName ?? drawingPreset?.samplerName) as string | undefined,
            scheduler: (params.scheduler ?? drawingPreset?.scheduler) as string | undefined,
            denoise: isInpaintMode
                ? ((params.denoiseStrength ?? 0.75) as number)
                : ((params.denoise ?? 1.0) as number),
            width: (params.width ?? drawingPreset?.width) as number | undefined,
            height: (params.height ?? drawingPreset?.height) as number | undefined,
            batch_size: (params.batchSize ?? 1) as number | undefined,
        };

        if (isInpaintMode && uploadedInitImageName) {
            variables['input_image'] = uploadedInitImageName;
            variables['inpaint_image'] = uploadedInitImageName;
            if (uploadedMaskImageName) {
                variables['inpaint_mask'] = uploadedMaskImageName;
                variables['mask_image'] = uploadedMaskImageName;
            }
            variables['mask_blur'] = (params.maskBlur ?? 4) as number;
        }

        if (Array.isArray(extraModels)) {
            extraModels.forEach((mName, idx) => {
                if (typeof mName === 'string' && mName.trim()) {
                    variables[`extramodel_name${idx + 1}`] = mName.trim();
                }
            });
        }

        if (params.variables && typeof params.variables === 'object') {
            for (const [k, v] of Object.entries(params.variables as Record<string, unknown>)) {
                if (typeof v === 'string' || typeof v === 'number') {
                    variables[k] = v;
                }
            }
        }

        const injectedWorkflow = buildWorkflow(rawWorkflow, variables);

        // 4. 提交工作流至 POST /prompt 端点并校验 node_errors
        const promptPayload = {
            client_id: this._clientId,
            prompt: injectedWorkflow,
        };

        let submitResponse: Response;
        try {
            submitResponse = await this.fetchWithTransport(
                `${serverUrl}/prompt`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(promptPayload),
                    timeoutMs: maxTimeoutMs,
                    retries: 0,
                    signal,
                },
                transport
            );
        } catch (err: unknown) {
            if (err instanceof HttpError) {
                const detail = formatComfySubmitError(err.details) ?? `HTTP ${err.status}`;
                throw new Error(`ComfyUI 工作流校验失败: ${detail}`);
            }
            throw err;
        }

        const submitResult = (await submitResponse.json()) as {
            prompt_id?: string;
            error?: unknown;
            node_errors?: Record<string, unknown>;
        };

        const submitErrDetail = formatComfySubmitError(submitResult);
        if (submitErrDetail) {
            throw new Error(`ComfyUI 工作流校验失败: ${submitErrDetail}`);
        }

        const promptId = submitResult.prompt_id;
        if (!promptId) {
            throw new Error('ComfyUI 未返回有效任务标识 (prompt_id)');
        }

        // 5. 轮询 GET /history/{prompt_id} 等待任务执行完成，收到中止信号时仅客户端退出（不发服务端中断）
        const pollIntervalMs = 1000;
        const maxConsecutiveNetworkErrors = 5;
        let consecutiveNetworkErrors = 0;
        let promptHistory: ComfyPromptHistoryItem | undefined;

        while (true) {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            if (Date.now() - startTime > maxTimeoutMs) {
                throw new Error(`ComfyUI 生图执行超时 (超过 ${Math.round(maxTimeoutMs / 1000)} 秒)`);
            }

            await this.sleep(pollIntervalMs, signal);

            let historyResponse: Response | null = null;
            try {
                historyResponse = await this.fetchWithTransport(
                    `${serverUrl}/history/${promptId}`,
                    { method: 'GET', timeoutMs: maxTimeoutMs, retries: 0, signal },
                    transport
                );
                consecutiveNetworkErrors = 0;
            } catch (err: unknown) {
                if (signal?.aborted) {
                    throw err;
                }
                if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
                    throw new Error(`ComfyUI 轮询任务状态失败 (HTTP ${err.status})`);
                }
                consecutiveNetworkErrors++;
                if (consecutiveNetworkErrors >= maxConsecutiveNetworkErrors) {
                    throw new Error(
                        `ComfyUI 服务连接中断（连续 ${consecutiveNetworkErrors} 次轮询不可达），请检查 ComfyUI 服务是否正常运行`
                    );
                }
                logger.warn(
                    `[ComfyUI] 轮询任务状态网络瞬断 (${consecutiveNetworkErrors}/${maxConsecutiveNetworkErrors})，稍后重试 (prompt_id: ${promptId}):`,
                    err
                );
                continue;
            }

            if (historyResponse.ok) {
                const historyData = (await historyResponse.json()) as Record<string, ComfyPromptHistoryItem>;
                const currentHistory = historyData[promptId];

                if (currentHistory) {
                    if (currentHistory.status?.status_str === 'error') {
                        let errorDetails = '';
                        if (Array.isArray(currentHistory.status.messages)) {
                            const errMessages: string[] = [];
                            for (const msgItem of currentHistory.status.messages) {
                                if (Array.isArray(msgItem)) {
                                    const [event, payload] = msgItem;
                                    if (event === 'execution_error' && typeof payload === 'object' && payload !== null) {
                                        const p = payload as Record<string, unknown>;
                                        const nodeInfo = p.node_id ? `节点 ${p.node_id} (${p.node_type || 'Unknown'}): ` : '';
                                        const exMsg = p.exception_message || p.exception_type || JSON.stringify(p);
                                        errMessages.push(`${nodeInfo}${exMsg}`);
                                    }
                                } else if (typeof msgItem === 'string') {
                                    errMessages.push(msgItem);
                                }
                            }
                            if (errMessages.length > 0) {
                                errorDetails = errMessages.join('; ');
                            }
                        }
                        if (!errorDetails) {
                            errorDetails = '未知节点执行异常';
                        }
                        throw new Error(`ComfyUI 执行失败: ${errorDetails}`);
                    }

                    if (hasComfyImageOutputs(currentHistory)) {
                        promptHistory = currentHistory;
                        break;
                    }

                    // 任务已完成但无图像输出节点，立刻报错避免空转等到超时
                    if (
                        currentHistory.status?.completed === true ||
                        currentHistory.status?.status_str === 'success'
                    ) {
                        throw new Error('ComfyUI 执行完成，但未检索到有效图像输出');
                    }
                }
            }
        }

        // 6. 检索输出图像并请求 /view 获取图像二进制
        let targetImage: { filename: string; subfolder?: string; type?: string } | undefined;
        let fallbackImage: { filename: string; subfolder?: string; type?: string } | undefined;

        const outputs = promptHistory?.outputs || {};
        for (const nodeOutput of Object.values(outputs)) {
            if (Array.isArray(nodeOutput.images)) {
                for (const img of nodeOutput.images) {
                    if (img && typeof img.filename === 'string') {
                        if (img.type === 'output') {
                            targetImage = img;
                            break;
                        }
                        if (!fallbackImage) {
                            fallbackImage = img;
                        }
                    }
                }
                if (targetImage) {
                    break;
                }
            }
        }

        const chosenImage = targetImage || fallbackImage;
        if (!chosenImage) {
            throw new Error('ComfyUI 执行完成，但未检索到有效图像输出');
        }

        const viewParams = new URLSearchParams({
            filename: chosenImage.filename,
            subfolder: chosenImage.subfolder || '',
            type: chosenImage.type || 'output',
        });
        const viewUrl = `${serverUrl}/view?${viewParams.toString()}`;

        const viewResponse = await this.fetchWithTransport(
            viewUrl,
            { method: 'GET', timeoutMs: maxTimeoutMs, signal },
            transport
        );
        if (!viewResponse.ok) {
            throw new Error(`ComfyUI 图像下载失败 (/view HTTP ${viewResponse.status})`);
        }
        const blob = await ensureValidImageBlob(await viewResponse.blob(), 'ComfyUI');

        // 7. 装配生成元数据
        const durationMs = Date.now() - startTime;
        const metadata: ImageGenerationMetadata = {
            prompt: String(variables.prompt ?? promptText),
            negativePrompt: String(variables.negative_prompt ?? negativePromptText) || undefined,
            seed: Number(variables.seed ?? resolvedSeed),
            sampler: (variables.sampler_name as string | undefined) || undefined,
            scheduler: (variables.scheduler as string | undefined) || undefined,
            steps: variables.steps as number | undefined,
            cfgScale: variables.cfg as number | undefined,
            engine: 'comfyui',
            durationMs,
            workflowId: resolvedWorkflowId,
            promptId,
            filename: chosenImage.filename,
            baseModel: resolvedBaseModel,
            extraModels: extraModels.length > 0 ? extraModels : undefined,
            width: variables.width as number | undefined,
            height: variables.height as number | undefined,
            mode: isInpaintMode ? 'inpaint' : 'txt2img',
            denoiseStrength: isInpaintMode ? ((params.denoiseStrength ?? 0.75) as number) : undefined,
            maskBlur: isInpaintMode ? ((params.maskBlur ?? 4) as number) : undefined,
            parentImageId: (params as { parentImageId?: string }).parentImageId,
        };

        return {
            blob,
            metadata,
        };
    }
}
