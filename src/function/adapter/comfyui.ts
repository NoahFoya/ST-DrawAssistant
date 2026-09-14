/**
 * ComfyUI 生图引擎适配器 (ComfyUIAdapter)
 *
 * 核心功能：
 * 1. 提交 ComfyUI 原生 API 格式工作流 (POST /prompt) 并管理 prompt_id 任务生命周期；
 * 2. 支持工作流节点变量精准替换与 WeiLin 4 段式 LoRA 语法嵌入；
 * 3. 建立 WebSocket 实时进度追踪，推送采样步数进度与预览图像；
 * 4. 任务取消时同步清理 ComfyUI 队列并中断当前计算节点；
 * 5. 拉取最终生成图像二进制数据并规范化输出。
 *
 * 注意事项：
 * 1. 节点连线 (Link) 数组结构极为严格，变量注入严禁破坏节点关联依赖与非目标字段；
 * 2. 长连接异常断开时应具备退避重试能力，且需处理节点执行报错抛出的异常状态。
 */

import type {
    EngineCapabilities,
    EngineType,
    HealthCheckResult,
    ImageGenerationResult,
    ComfyUITaskData,
    ComfyUIRequestData,
    ComfyUIHistoryResponseData,
    ComfyUIWsMessageData
} from '@types';
import { BaseAdapter } from './base';
import { formatLoraTag } from '../../util/prompt';
import type { HttpClient } from '../../util/http';

/**
 * 工作流模板变量直接替换纯函数
 */
export function injectWorkflowVariables(
    workflow: Record<string, any>,
    finalPrompt: string,
    params: ComfyUITaskData,
    resolvedSeed: number
): Record<string, any> {
    const vars = params.variables || ({} as ComfyUITaskData['variables']);
    const stringVars: Record<string, string> = {
        '%prompt%': finalPrompt,
        '%negative_prompt%': params.negativePrompt || '',
        '%sampler_name%': vars.sampler_name || 'euler',
        '%scheduler%': vars.scheduler || 'normal',
        '%model_name%': vars.model_name || ''
    };

    const numberVars: Record<string, number> = {
        '%seed%': resolvedSeed,
        '%width%': vars.width,
        '%height%': vars.height,
        '%steps%': vars.steps ?? 20,
        '%cfg%': vars.cfg ?? 8.0
    };

    // 注入附加自定义变量
    for (const [key, value] of Object.entries(vars)) {
        if (typeof value === 'number') {
            numberVars[`%${key}%`] = value;
        } else if (typeof value === 'string') {
            stringVars[`%${key}%`] = value;
        }
    }

    function processValue(val: any): any {
        if (typeof val === 'string') {
            // 若完全匹配数值型占位符，直接替换为原生 number
            if (val in numberVars) {
                return numberVars[val];
            }
            // 否则执行字符串插值替换（采用 split/join 确保 ES2020 兼容）
            let str = val;
            for (const [key, replacement] of Object.entries(stringVars)) {
                str = str.split(key).join(replacement);
            }
            for (const [key, replacement] of Object.entries(numberVars)) {
                str = str.split(key).join(String(replacement));
            }
            return str;
        }
        if (Array.isArray(val)) {
            return val.map(processValue);
        }
        if (val !== null && typeof val === 'object') {
            const nextObj: Record<string, any> = {};
            for (const [k, v] of Object.entries(val)) {
                nextObj[k] = processValue(v);
            }
            return nextObj;
        }
        return val;
    }

    return processValue(workflow);
}

export class ComfyUIAdapter extends BaseAdapter<ComfyUITaskData> {
    public readonly id: EngineType = 'comfyui';
    public readonly name = 'ComfyUI';

    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: true,
        inpaint: true,
        lora: true,
        progress: true,
        interrupt: true,
        customWorkflow: true
    };

    constructor(baseUrl = 'http://127.0.0.1:8188', httpClient?: HttpClient) {
        super(baseUrl, httpClient);
    }

    /**
     * 连通性探测与 ComfyUI 远端节点资产拉取 (Checkpoints, VAEs, LoRAs)
     */
    public override async fetchAssets(signal?: AbortSignal): Promise<HealthCheckResult> {
        if (!this.baseUrl) {
            return { ok: false, message: 'ComfyUI 服务地址未配置' };
        }

        const start = performance.now();
        try {
            // 1. 探活探测 /system_stats
            const probeResp = await this.httpClient.fetchExternal(`${this.baseUrl}/system_stats?_t=${Date.now()}`, {
                method: 'GET',
                timeoutMs: 6000,
                signal
            });

            const latencyMs = Math.round(performance.now() - start);

            if (!probeResp.ok) {
                return {
                    ok: false,
                    latencyMs,
                    message: `ComfyUI 服务响应异常 (HTTP ${probeResp.status})`
                };
            }

            // 2. 拉取远端节点元数据资产 /object_info
            const models: string[] = [];
            const vaes: string[] = [];
            const loras: string[] = [];
            let assetWarning: string | undefined;

            try {
                const objResp = await this.httpClient.fetchExternal(`${this.baseUrl}/object_info?_t=${Date.now()}`, {
                    method: 'GET',
                    timeoutMs: 15000,
                    signal
                });

                if (objResp.ok) {
                    const objData = await objResp.json();
                    const ckptInputs = objData?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
                    if (Array.isArray(ckptInputs)) {
                        models.push(...ckptInputs);
                    }
                    const vaeInputs = objData?.VAELoader?.input?.required?.vae_name?.[0];
                    if (Array.isArray(vaeInputs)) {
                        vaes.push(...vaeInputs);
                    }
                    const loraInputs = objData?.LoraLoader?.input?.required?.lora_name?.[0];
                    if (Array.isArray(loraInputs)) {
                        loras.push(...loraInputs);
                    }
                } else {
                    assetWarning = `节点信息获取失败 (HTTP ${objResp.status})`;
                    this.logger.warn(`ComfyUI /object_info 响应失败: HTTP ${objResp.status}`);
                }
            } catch (err: any) {
                assetWarning = `节点信息同步失败: ${err?.message || '网络异常'}`;
                this.logger.warn('ComfyUI 节点资产 /object_info 拉取异常:', err);
            }

            const assetsSummary = models.length > 0
                ? `已同步 ${models.length} 款主模型、${vaes.length} 款 VAE、${loras.length} 款 LoRA`
                : (assetWarning ? `通信正常 (${latencyMs}ms)，但${assetWarning}` : '网络连接正常');

            return {
                ok: true,
                latencyMs,
                assetsSummary,
                availableModels: models,
                assets: { models, vaes, loras }
            };
        } catch (err: any) {
            this.logger.error('ComfyUI 连通性探测异常:', err);
            return {
                ok: false,
                latencyMs: 0,
                message: err?.message || '无法连接至 ComfyUI 服务，请确认服务已启动且地址正确'
            };
        }
    }

    /**
     * 执行 ComfyUI 工作流生图任务
     */
    public async generate(
        params: ComfyUITaskData,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult> {
        const startTime = performance.now();

        // 1. 组装正向提示词（依据用户配置拼入 WeiLin 4段式 LoRA 标签）
        let finalPrompt = params.prompt || '';
        const loras = params.loras;
        if (Array.isArray(loras) && loras.length > 0) {
            const loraTags = loras.map(l => formatLoraTag(l, 'weilin')).filter(Boolean);
            if (loraTags.length > 0) {
                finalPrompt = finalPrompt ? `${finalPrompt}, ${loraTags.join(', ')}` : loraTags.join(', ');
            }
        }

        // 2. 准备工作流模板
        let rawWorkflow = params.workflow;
        if (typeof rawWorkflow === 'string') {
            try {
                rawWorkflow = JSON.parse(rawWorkflow);
            } catch {
                throw new Error('ComfyUI 工作流 JSON 解析失败');
            }
        }
        if (!rawWorkflow || typeof rawWorkflow !== 'object') {
            throw new Error('ComfyUI 请求缺少有效的工作流定义');
        }

        // 3. 计算并注入工作流变量
        const vars = params.variables || ({} as ComfyUITaskData['variables']);
        let modelName = vars.model_name || '';
        if (!modelName) {
            try {
                const infoResp = await this.httpClient.fetchExternal(`${this.baseUrl}/object_info/CheckpointLoaderSimple`, { signal });
                if (infoResp.ok) {
                    const infoData = await infoResp.json();
                    const availableModels = infoData?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
                    if (Array.isArray(availableModels) && availableModels.length > 0) {
                        modelName = availableModels[0];
                    }
                }
            } catch {
                // modelName 为可选辅助字段；探测失败时工作流占位符保持空白，由工作流模板自行处理
            }
        }

        const resolvedSeed = (typeof vars.seed === 'number' && vars.seed > 0)
            ? vars.seed
            : Math.floor(Math.random() * 100000000000000);

        const resolvedParams: ComfyUITaskData = {
            ...params,
            variables: {
                ...vars,
                seed: resolvedSeed,
                model_name: modelName
            }
        };
        const injectedGraph = injectWorkflowVariables(rawWorkflow, finalPrompt, resolvedParams, resolvedSeed);

        // 4. 生成客户端标识并提交发往后端的请求数据
        const clientId = `st-da-${Math.random().toString(36).substring(2, 10)}`;
        const requestData: ComfyUIRequestData = {
            client_id: clientId,
            prompt: injectedGraph
        };

        const submitResp = await this.fetchWithTransport(`${this.baseUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData),
            signal
        }, params.transport);

        const submitResult = await submitResp.json();
        const promptId = submitResult.prompt_id as string;
        if (!promptId) {
            throw new Error(`ComfyUI 任务提交失败: ${JSON.stringify(submitResult)}`);
        }

        // 5. 监听 WebSocket 进度或轮询 /history
        await this.waitForCompletion(clientId, promptId, onProgress, signal);

        // 6. 从 /history 拉取输出图像元数据
        const historyResp = await this.fetchWithTransport(`${this.baseUrl}/history/${promptId}`, {
            method: 'GET',
            signal
        }, params.transport);
        const historyData: ComfyUIHistoryResponseData = await historyResp.json();
        const promptHistory = historyData[promptId];
        if (!promptHistory || !promptHistory.outputs) {
            throw new Error(`ComfyUI 历史记录未包含 promptId: ${promptId} 的输出`);
        }

        // 查找图像输出：优先检索正式输出 (type === 'output')，避免误抓取 PreviewImage 临时预览图 (type === 'temp')
        let targetImage: { filename: string; subfolder: string; type: string } | null = null;
        let fallbackImage: { filename: string; subfolder: string; type: string } | null = null;

        for (const nodeOutput of Object.values(promptHistory.outputs)) {
            if (Array.isArray(nodeOutput.images) && nodeOutput.images.length > 0) {
                for (const img of nodeOutput.images) {
                    if (img && img.type === 'output') {
                        targetImage = img;
                        break;
                    }
                    if (!fallbackImage && img) {
                        fallbackImage = img;
                    }
                }
                if (targetImage) break;
            }
        }

        const finalImage = targetImage || fallbackImage;
        if (!finalImage) {
            throw new Error('ComfyUI 执行完成，但未检索到有效输出图片');
        }

        // 7. 拉取实际图像二进制 Blob
        const viewUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(finalImage.filename)}&subfolder=${encodeURIComponent(finalImage.subfolder || '')}&type=${encodeURIComponent(finalImage.type || 'output')}`;
        const imageResp = await this.fetchWithTransport(viewUrl, {
            method: 'GET',
            signal
        }, params.transport);

        const blob = await imageResp.blob();

        if (onProgress) {
            onProgress(1.0);
        }

        return {
            blob,
            mimeType: blob.type || 'image/png',
            width: vars.width || 832,
            height: vars.height || 1216,
            seed: resolvedSeed,
            durationMs: this.measureDuration(startTime),
            metadata: {
                promptId,
                filename: finalImage.filename
            }
        };
    }

    /**
     * 轮询与监听作业完成
     */
    private async waitForCompletion(
        clientId: string,
        promptId: string,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<void> {
        let ws: WebSocket | null = null;
        let isDone = false;

        // 尝试通过 WebSocket 接收进度
        try {
            const wsProtocol = this.baseUrl.startsWith('https:') ? 'wss:' : 'ws:';
            const wsUrl = `${this.baseUrl.replace(/^https?:/, wsProtocol)}/ws?clientId=${clientId}`;
            if (typeof WebSocket !== 'undefined') {
                ws = new WebSocket(wsUrl);
                ws.onmessage = (event: MessageEvent) => {
                    try {
                        if (typeof event.data === 'string') {
                            const msg = JSON.parse(event.data) as ComfyUIWsMessageData;
                            if (msg.type === 'progress' && msg.data) {
                                const { value, max } = msg.data;
                                if (typeof value === 'number' && typeof max === 'number' && max > 0 && onProgress) {
                                    onProgress(Math.min(1, Math.max(0, value / max)));
                                }
                            } else if (msg.type === 'executing' && msg.data) {
                                if (msg.data.prompt_id === promptId && msg.data.node === null) {
                                    isDone = true;
                                }
                            }
                        }
                    } catch {
                        // ComfyUI WS 会推送二进制预览帧，非字符串帧的 JSON 解析失败为预期行为
                    }
                };
            }
        } catch (err: any) {
            // 部分 ComfyUI 反代部署不支持 WS 升级，回退至 HTTP 轮询
            this.logger.debug('ComfyUI WebSocket 初始化失败，回退至 HTTP 轮询:', err?.message || err);
        }

        // 轮询检查 /history
        const pollIntervalMs = 1000;
        const maxWaitMs = 600000; // 最长等待 10 分钟
        const startWait = Date.now();

        try {
            while (!isDone) {
                if (signal?.aborted) {
                    throw new Error('ComfyUI 任务已被取消');
                }
                if (Date.now() - startWait > maxWaitMs) {
                    throw new Error('ComfyUI 等待生图结果超时');
                }

                await new Promise(res => setTimeout(res, pollIntervalMs));

                const checkResp = await this.httpClient.fetchExternal(`${this.baseUrl}/history/${promptId}`, {
                    method: 'GET',
                    signal
                });
                if (checkResp.ok) {
                    const data = await checkResp.json();
                    if (data && data[promptId]) {
                        isDone = true;
                        break;
                    }
                }
            }
        } finally {
            if (ws) {
                try {
                    ws.close();
                } catch {
                    // 已断开的 WebSocket 调用 close() 可能抛出，清理步骤不向上传播
                }
            }
        }
    }

    /**
     * 中止在途作业或清理排队
     */
    public override async interrupt(jobId?: string): Promise<void> {
        if (jobId) {
            try {
                await this.fetchWithTransport(`${this.baseUrl}/queue`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ delete: [jobId] })
                });
                this.logger.info(`已从 ComfyUI 队列删除任务: ${jobId}`);
            } catch (err: any) {
                this.logger.warn(`ComfyUI 队列删除失败: ${err?.message || err}`);
            }
        }

        try {
            await this.fetchWithTransport(`${this.baseUrl}/interrupt`, {
                method: 'POST'
            });
            this.logger.info('已向 ComfyUI 发送中断执行请求');
        } catch (err: any) {
            this.logger.warn(`ComfyUI 中断执行请求失败: ${err?.message || err}`);
        }
    }
}
