/**
 * ComfyUI 绘图服务提供方适配器。
 *
 * @remarks
 * 基于 ComfyUI 原生 API 规范对接服务端：
 * - 工作流编排：将绘图预设注入 Prompt Graph 变量占位符，提交至 /prompt 队列；
 * - 结果获取：通过轮询 /history/{prompt_id} 检索执行完成的 Output 节点信息；
 * - 图像下载：根据输出文件名与子目录通过 /view 接口获取原始图像二进制流。
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
} from '@types';
import { BaseGenerationProvider, type BaseProviderOptions } from '../base-provider';
import { buildWorkflow, resolveSeed, type WorkflowVariables } from './workflow-builder';

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
     * 读取配置中心的 ComfyUI 服务地址，未配置时回退为默认本地地址 (http://127.0.0.1:8188)。
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
     * 获取 ComfyUI 服务端支持的模型列表。
     *
     * @remarks
     * 从 /object_info 元数据中提取 CheckpointLoader、CheckpointLoaderSimple 及 UNETLoader 的模型文件名并去重。
     *
     * @param signal 中止信号
     * @returns 可用模型文件名数组
     */
    public async fetchModels(signal?: AbortSignal): Promise<string[]> {
        const serverUrl = this.getServerUrl();
        const transport = this.getTransport();
        const url = `${serverUrl}/object_info`;

        const response = await this.fetchWithTransport(url, { method: 'GET', timeoutMs: 15000, signal }, transport);
        const data = (await response.json()) as Record<string, any>;

        const modelSet = new Set<string>();

        // CheckpointLoader / CheckpointLoaderSimple 模型
        const simpleCkptNames = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
        if (Array.isArray(simpleCkptNames)) {
            for (const name of simpleCkptNames) {
                if (typeof name === 'string' && name.trim()) {
                    modelSet.add(name.trim());
                }
            }
        }

        const fullCkptNames = data?.CheckpointLoader?.input?.required?.ckpt_name?.[0];
        if (Array.isArray(fullCkptNames)) {
            for (const name of fullCkptNames) {
                if (typeof name === 'string' && name.trim()) {
                    modelSet.add(name.trim());
                }
            }
        }

        // UNETLoader 模型
        const unetNames = data?.UNETLoader?.input?.required?.unet_name?.[0];
        if (Array.isArray(unetNames)) {
            for (const name of unetNames) {
                if (typeof name === 'string' && name.trim()) {
                    modelSet.add(name.trim());
                }
            }
        }

        return Array.from(modelSet);
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
            const config = this._settingsStore.getProviderConfig<ComfyUIProviderConfig>('comfyui');
            if (config?.activeWorkflowProfileId) {
                const workflowPreset = this._settingsStore.getPreset<WorkflowPresetData>(
                    'workflows',
                    config.activeWorkflowProfileId
                );
                if (workflowPreset?.data?.workflow) {
                    rawWorkflow = workflowPreset.data.workflow;
                }
            }
        }

        if (!rawWorkflow || Object.keys(rawWorkflow).length === 0) {
            throw new Error('缺少有效的工作流模板，请在设置中选择或在请求参数中传入');
        }

        let drawingPreset: DrawingPresetData | undefined;
        if (this._settingsStore) {
            const config = this._settingsStore.getProviderConfig<ComfyUIProviderConfig>('comfyui');
            if (config?.activeDrawingProfileId) {
                drawingPreset = this._settingsStore.getPreset<DrawingPresetData>(
                    'drawing',
                    config.activeDrawingProfileId,
                    'comfyui'
                )?.data;
            }
        }

        const resolvedBaseModel = (params.baseModel ?? drawingPreset?.baseModel) as string | undefined;
        const extraModels = (params.extraModels ?? drawingPreset?.extraModels ?? []) as string[];
        const resolvedSeed = resolveSeed(params.seed as number | undefined ?? drawingPreset?.seed);

        const variables: WorkflowVariables = {
            basemodel_name: resolvedBaseModel,
            unet_name: (params.unetName ?? drawingPreset?.unetName ?? resolvedBaseModel) as string | undefined,
            clip_name: (params.clipName ?? drawingPreset?.clipName) as string | undefined,
            vae_name: (params.vaeName ?? drawingPreset?.vaeName) as string | undefined,

            prompt: request.prompt,
            negative_prompt: request.negativePrompt ?? '',

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

        // 轮询任务执行结果
        const pollIntervalMs = 1000;
        let promptHistory: any;

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
                const historyData = (await historyResponse.json()) as Record<string, any>;
                const currentHistory = historyData[promptId];

                if (currentHistory) {
                    if (currentHistory.status?.status_str === 'error') {
                        const msgs = Array.isArray(currentHistory.status.messages)
                            ? currentHistory.status.messages
                                  .map((m: any) =>
                                      Array.isArray(m) ? m.join(': ') : typeof m === 'object' ? JSON.stringify(m) : String(m)
                                  )
                                  .join('; ')
                            : '未知节点执行异常';
                        throw new Error(`ComfyUI 执行失败: ${msgs}`);
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

        for (const nodeOutput of Object.values(promptHistory.outputs as Record<string, any>)) {
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
            prompt: request.prompt,
            negativePrompt: request.negativePrompt,
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
