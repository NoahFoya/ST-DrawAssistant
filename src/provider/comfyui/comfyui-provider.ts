/**
 * ComfyUI 绘图服务提供方适配器 (ComfyUIProvider)。
 *
 * @remarks
 * 基于 ComfyUI 原生 API 规范对接服务端：
 * 1. 变量注入与工作流构建：根据当前激活的绘图预设、提示词预设与单次临时覆盖参数，通过 workflow-builder
 *    将变量（如 prompt, negative_prompt, seed, steps, cfg, sampler_name, scheduler, width, height 等）
 *    动态编译并注入原始 Graph JSON 模板；
 * 2. 会话隔离与提交：携带唯一 client_id 向 POST /prompt 提交任务，并深度解析服务端 node_errors 校验异常；
 * 3. 结果轮询与下载：通过定时 GET /history/{prompt_id} 检索输出节点信息，经由 GET /view 下载原始图片二进制流；
 * 4. 客户端丢弃策略 (Client Discard)：取消时不向服务端发送破坏性的全局 /interrupt（避免打断局域网或共享实例上正在执行的其他任务），
 *    仅终止本地轮询并抛出 AbortError 释放前端资源。
 */

import type {
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    TaskProgressCallback,
    ImageGenerationMetadata,
    ComfyUIProviderConfig,
    DrawingPresetData,
    WorkflowPresetData,
    PromptPresetData,
} from '@types';
import { BaseGenerationProvider, type BaseProviderOptions } from '../base-provider';
import { buildWorkflow, resolveSeed, type WorkflowVariables } from './workflow-builder';
import { formatLoraTag } from '../../ui/composite/lora-manager';

interface ComfyPromptHistoryOutput {
    images?: Array<{ filename: string; subfolder?: string; type?: string }>;
}

interface ComfyPromptHistoryItem {
    status?: {
        status_str?: string;
        messages?: unknown[];
    };
    outputs?: Record<string, ComfyPromptHistoryOutput>;
}

/** ComfyUI 提供方初始化配置项 */
export interface ComfyUIProviderOptions extends BaseProviderOptions {
    /** 会话客户端唯一标识符（可选，缺省自动生成随机标识） */
    clientId?: string;
}

/**
 * ComfyUI 绘图服务提供方实现类。
 */
export class ComfyUIProvider extends BaseGenerationProvider {
    public readonly providerType: ProviderType = 'comfyui';
    public readonly name: string = 'ComfyUI';

    private _clientId: string;

    public constructor(options: ComfyUIProviderOptions = {}) {
        super(options);
        this._clientId = options.clientId ?? `st-da-${Math.random().toString(36).substring(2, 10)}`;
    }

    /** 获取当前客户端会话标识符 */
    public getClientId(): string {
        return this._clientId;
    }

    /** 设置客户端会话标识符 */
    public setClientId(clientId: string): void {
        this._clientId = clientId;
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
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const url = `${serverUrl}/object_info`;

        const response = await this.fetchWithTransport(
            url,
            { method: 'GET', timeoutMs: 15000, signal },
            transport
        );
        const data = (await response.json()) as Record<string, any>;

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
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const url = `${serverUrl}/object_info`;

        const response = await this.fetchWithTransport(
            url,
            { method: 'GET', timeoutMs: 15000, signal },
            transport
        );
        const data = (await response.json()) as Record<string, any>;

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
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const url = `${serverUrl}/object_info`;

        const response = await this.fetchWithTransport(
            url,
            { method: 'GET', timeoutMs: 15000, signal },
            transport
        );
        const data = (await response.json()) as Record<string, any>;

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
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const url = `${serverUrl}/object_info`;

        const response = await this.fetchWithTransport(
            url,
            { method: 'GET', timeoutMs: 15000, signal },
            transport
        );
        const data = (await response.json()) as Record<string, any>;
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
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const url = `${serverUrl}/object_info`;

        const response = await this.fetchWithTransport(
            url,
            { method: 'GET', timeoutMs: 15000, signal },
            transport
        );
        const data = (await response.json()) as Record<string, any>;
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
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const url = `${serverUrl}/object_info`;

        const response = await this.fetchWithTransport(
            url,
            { method: 'GET', timeoutMs: 15000, signal },
            transport
        );
        const data = (await response.json()) as Record<string, any>;
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
     * 执行 ComfyUI 图像生成任务。
     *
     * @param request 生图请求参数
     * @param onProgress 进度与状态回调
     * @param signal 中止信号
     * @returns 包含图像 Blob 与生成元数据的生成结果
     */
    public async generate(
        request: GenerationRequest,
        onProgress?: TaskProgressCallback,
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

        let drawingPreset: DrawingPresetData | undefined;
        if (this._settingsStore) {
            const config = this._settingsStore.getProviderConfig<ComfyUIProviderConfig>('comfyui');
            const activeDrawingId = config?.activeDrawingPresetId;
            if (activeDrawingId) {
                drawingPreset = this._settingsStore.getPreset<DrawingPresetData>(
                    'drawing',
                    activeDrawingId,
                    'comfyui'
                )?.data;
            }
            if (!drawingPreset && typeof this._settingsStore.getPresets === 'function') {
                const allPresets = this._settingsStore.getPresets<DrawingPresetData>('drawing', 'comfyui');
                if (allPresets && allPresets.length > 0) {
                    drawingPreset = allPresets[0].data;
                }
            }
        }

        let rawWorkflow: Record<string, unknown> | undefined;

        if (params.workflow) {
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
            const isImg2Img = Boolean(request.sourceImage || params.sourceImage);
            let workflowId: string | undefined;

            if (isImg2Img) {
                workflowId = drawingPreset?.img2imgWorkflowId;
                if (!workflowId) {
                    throw new Error('当前方案未配置图生图工作流，请在设置中绑定');
                }
            } else {
                workflowId = drawingPreset?.txt2imgWorkflowId;
                if (!workflowId) {
                    throw new Error('当前方案未配置文生图工作流，请在设置中绑定');
                }
            }

            const workflowPreset = this._settingsStore.getPreset<WorkflowPresetData>(
                'workflows',
                workflowId
            );
            if (workflowPreset?.data?.workflow) {
                rawWorkflow = workflowPreset.data.workflow;
            } else {
                throw new Error(`缺少有效的工作流模板：绑定的工作流方案不存在或已失效 (ID: ${workflowId})`);
            }
        }

        if (!rawWorkflow || Object.keys(rawWorkflow).length === 0) {
            throw new Error('缺少有效的工作流模板，请在设置中选择或在请求参数中传入');
        }

        let promptText = request.prompt;
        let negativePromptText = request.negativePrompt ?? '';

        const linkedPromptId = drawingPreset?.promptPresetId;
        if (this._settingsStore && linkedPromptId) {
            const promptPreset = this._settingsStore.getPreset<PromptPresetData>('prompts', linkedPromptId);
            if (promptPreset?.data) {
                const pData = promptPreset.data;
                const prefix = (pData.positivePrefix || '').trim();
                const suffix = (pData.positiveSuffix || '').trim();
                const defaultNeg = (pData.negativePrompt || '').trim();

                if (prefix) {
                    promptText = `${prefix}, ${promptText}`;
                }
                if (suffix) {
                    promptText = `${promptText}, ${suffix}`;
                }
                if (defaultNeg) {
                    negativePromptText = negativePromptText ? `${negativePromptText}, ${defaultNeg}` : defaultNeg;
                }

                // 若预设包含 LoRA 配置，且正向提示词中未显式写入该 LoRA，则遵从方案语法模式追加对应标签
                if (Array.isArray(pData.loras)) {
                    const syntaxMode = pData.loraSyntaxMode ?? 'standard';
                    for (const lora of pData.loras) {
                        if (!lora || !lora.name) continue;
                        const cleanName = lora.name.replace(/\.(safetensors|pt|ckpt|pth)$/i, '').trim();
                        const hasTag =
                            promptText.includes(`<lora:${cleanName}:`) ||
                            promptText.includes(`<wlr:${cleanName}:`);
                        if (!hasTag) {
                            const tag = formatLoraTag(lora, syntaxMode);
                            if (tag) {
                                promptText = `${promptText}, ${tag}`;
                            }
                        }
                    }
                }
            }
        }

        const resolvedBaseModel = (params.baseModel ?? drawingPreset?.baseModel) as string | undefined;
        const extraModels = (params.extraModels ?? drawingPreset?.extraModels ?? []) as string[];
        const resolvedSeed = resolveSeed(params.seed as number | undefined ?? drawingPreset?.seed);

        const variables: WorkflowVariables = {
            basemodel_name: resolvedBaseModel,
            model_name: resolvedBaseModel,
            unet_name: (params.unetName ?? resolvedBaseModel) as string | undefined,
            clip_name: (params.clipName ?? drawingPreset?.clipName) as string | undefined,
            vae_name: (params.vaeName ?? drawingPreset?.vaeName) as string | undefined,

            prompt: promptText,
            negative_prompt: negativePromptText,

            seed: resolvedSeed,
            steps: (params.steps ?? drawingPreset?.steps) as number | undefined,
            cfg: (params.cfgScale ?? drawingPreset?.cfgScale) as number | undefined,
            sampler_name: (params.samplerName ?? drawingPreset?.samplerName) as string | undefined,
            scheduler: (params.scheduler ?? drawingPreset?.scheduler) as string | undefined,
            denoise: (params.denoise ?? drawingPreset?.denoise ?? 1.0) as number | undefined,
            width: (params.width ?? drawingPreset?.width) as number | undefined,
            height: (params.height ?? drawingPreset?.height) as number | undefined,
            batch_size: (params.batchSize ?? drawingPreset?.batchSize ?? 1) as number | undefined,
        };

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

        const promptPayload = {
            client_id: this._clientId,
            prompt: injectedWorkflow,
        };

        const submitResponse = await this.fetchWithTransport(
            `${serverUrl}/prompt`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(promptPayload),
                retries: 0,
                signal,
            },
            transport
        );

        const submitResult = (await submitResponse.json()) as {
            prompt_id?: string;
            node_errors?: Record<
                string,
                {
                    errors?: Array<{ message?: string } | string>;
                    message?: string;
                    class_type?: string;
                }
            >;
        };

        if (submitResult.node_errors && Object.keys(submitResult.node_errors).length > 0) {
            const errDetails = Object.entries(submitResult.node_errors)
                .map(([nodeId, errObj]) => {
                    let errorText = '';
                    if (Array.isArray(errObj.errors)) {
                        errorText = errObj.errors
                            .map((e) => (typeof e === 'object' && e?.message ? e.message : String(e)))
                            .join(', ');
                    } else {
                        errorText = errObj.message || JSON.stringify(errObj);
                    }
                    return `节点 ${nodeId} (${errObj.class_type || 'Unknown'}): ${errorText}`;
                })
                .join('; ');
            throw new Error(`ComfyUI 工作流校验失败: ${errDetails}`);
        }

        const promptId = submitResult.prompt_id;
        if (!promptId) {
            throw new Error('ComfyUI 未返回有效任务标识 (prompt_id)');
        }

        // 轮询任务执行结果（采用客户端丢弃策略，收到中止信号时安全退出轮询并抛出 AbortError）
        const pollIntervalMs = 1000;
        let promptHistory: ComfyPromptHistoryItem | undefined;

        while (true) {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            if (Date.now() - startTime > maxTimeoutMs) {
                throw new Error(`ComfyUI 生图执行超时 (超过 ${Math.round(maxTimeoutMs / 1000)} 秒)`);
            }

            await this.sleep(pollIntervalMs, signal);

            const historyResponse = await this.fetchWithTransport(
                `${serverUrl}/history/${promptId}`,
                { method: 'GET', signal },
                transport
            );

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

                    if (currentHistory.outputs && Object.keys(currentHistory.outputs).length > 0) {
                        promptHistory = currentHistory;
                        break;
                    }
                }
            }
        }

        // 检索输出图像（优先选择 output 类型的正式输出）
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

        const viewResponse = await this.fetchWithTransport(viewUrl, { method: 'GET', signal }, transport);
        const blob = await viewResponse.blob();

        if (onProgress) {
            onProgress({ percent: 100, statusText: '生图完成' });
        }

        const durationMs = Date.now() - startTime;
        const metadata: ImageGenerationMetadata = {
            prompt: promptText,
            negativePrompt: negativePromptText || undefined,
            seed: resolvedSeed,
            sampler: variables.sampler_name as string | undefined,
            steps: variables.steps as number | undefined,
            cfgScale: variables.cfg as number | undefined,
            engine: 'comfyui',
            durationMs,
            promptId,
            filename: chosenImage.filename,
            baseModel: resolvedBaseModel,
            extraModels: extraModels.length > 0 ? extraModels : undefined,
            width: variables.width as number | undefined,
            height: variables.height as number | undefined,
        };

        return {
            blob,
            metadata,
        };
    }
}
