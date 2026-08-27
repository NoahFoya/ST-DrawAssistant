/**
 * @module domain/drivers/comfyui-driver
 * @description ComfyUI 生图后端驱动实现 (支持 WebSocket 状态追踪、API 工作流变量安全替换、Inpaint 资产上传与中断清理)
 */

import { BaseDriver, DriverError, DriverErrorType } from './base-driver';
import { GenerationPayload, DriverAssetSyncResult } from './driver-contract';
import { ObservableStore } from '../../core/state/store';
import type { DrawAssistantSettings } from '../../core/state/store-types';
import { getMacroVariables } from '../../core/config/config-loader';
import { joinPromptParts } from '../pipeline/prompt-pipeline';

interface PendingTask {
    resolve: (result: { imageBlobs: Blob[]; metadata: Record<string, unknown> }) => void;
    reject: (err: Error) => void;
    onProgress: (progress: { percent: number; nodeName?: string; previewBlob?: Blob }) => void;
    payload: GenerationPayload;
    timeoutTimer: ReturnType<typeof setTimeout>;
}

function stripExt(name: string): string {
    return (name || '').replace(/\.(safetensors|ckpt|pt|pth)$/i, '');
}

/**
 * 将工作流 JSON 中的 %xxx% 占位符变量安全替换为实际运行参数
 *
 * 替换机制：
 * 1. 数字类型变量 (如 %steps%, %seed%, %width%)：替换为无引号的纯数字，保持 JSON 数据类型；
 * 2. 字符串类型变量 (如 %prompt%, %negative_prompt%, %ckpt_name%)：通过 JSON.stringify 转义后替换，防止提示词内的双引号破坏 JSON 语法结构。
 *
 * @param workflowJsonStr 工作流原始 JSON 字符串或对象
 * @param payload 当前生图请求参数
 * @param settings 全局配置
 * @param initImageFileName Inpaint 底图文件名
 * @param maskImageFileName Inpaint 遮罩文件名
 * @returns 替换完成的 ComfyUI API Prompt JSON 对象
 */
export function substituteWorkflowVariables(
    workflowJsonStr: string | Record<string, any>,
    payload: GenerationPayload,
    settings: DrawAssistantSettings,
    initImageFileName = '',
    maskImageFileName = ''
): Record<string, any> {
    const rawJson =
        typeof workflowJsonStr === 'string'
            ? workflowJsonStr.trim() || '{}'
            : JSON.stringify(workflowJsonStr || {});

    const seed =
        payload.params.seed !== undefined && payload.params.seed >= 0
            ? payload.params.seed
            : Math.floor(Math.random() * 1000000000000000);

    const baseValueMap: Record<string, string | number> = {
        '%prompt%': payload.prompt || '',
        '%negative_prompt%': payload.negativePrompt || '',
        '%seed%': seed,
        '%steps%': payload.params.steps || settings.steps || 28,
        '%cfg%': payload.params.cfgScale || settings.cfgScale || 6.5,
        '%sampler_name%': payload.params.samplerName || settings.samplerName || 'euler_ancestral',
        '%scheduler%': payload.params.scheduler || settings.scheduler || 'normal',
        '%width%': payload.params.width || settings.width || 1024,
        '%height%': payload.params.height || settings.height || 1024,
        '%ckpt_name%': settings.ckptName || '',
        '%clip_name%': settings.clipName || '',
        '%vae_name%': settings.vaeName || '',
        '%inpaint_denoise%':
            payload.mode === 'inpaint'
                ? payload.denoiseStrength ?? settings.inpaintDenoise ?? 0.75
                : settings.inpaintDenoise ?? 0.75,
        '%inpaint_image%': initImageFileName,
        '%inpaint_mask%': maskImageFileName,
        '%mask_blur%': settings.inpaintMaskBlur ?? 8,
        '%grow_mask_by%': settings.inpaintGrowMask ?? 6
    };

    const stringVarMap: Record<string, string> = {};
    const numVarMap: Record<string, number> = {};

    getMacroVariables().forEach((def) => {
        const val = baseValueMap[def.variable];
        if (val === undefined) return;

        const allKeys = [def.variable, ...(def.aliases || [])];
        for (const k of allKeys) {
            if (def.type === 'number') {
                numVarMap[k] = Number(val) || 0;
            } else {
                stringVarMap[k] = String(val);
            }
        }
    });

    let processed = rawJson;

    // 替换数字变量 (支持带引号与不带引号)
    for (const [key, numVal] of Object.entries(numVarMap)) {
        const quotedKeyRegex = new RegExp(`"\\${key}"`, 'g');
        const rawKeyRegex = new RegExp(`\\${key}`, 'g');
        const numStr = String(numVal);
        processed = processed.replace(quotedKeyRegex, numStr);
        processed = processed.replace(rawKeyRegex, numStr);
    }

    // 替换字符串变量 (安全转义)
    for (const [key, strVal] of Object.entries(stringVarMap)) {
        const quotedKeyRegex = new RegExp(`"\\${key}"`, 'g');
        const rawKeyRegex = new RegExp(`\\${key}`, 'g');
        const escaped = JSON.stringify(strVal);
        processed = processed.replace(quotedKeyRegex, escaped);
        // 若在非引号区直接内嵌，仅去掉首尾双引号
        processed = processed.replace(rawKeyRegex, escaped.substring(1, escaped.length - 1));
    }

    try {
        return JSON.parse(processed);
    } catch (err: any) {
        throw new DriverError(
            DriverErrorType.INVALID_PARAMS,
            `ComfyUI 工作流 JSON 语法或变量解析失败: ${err.message}`
        );
    }
}

export class ComfyUIDriver extends BaseDriver {
    public readonly id = 'comfyui';
    public readonly name = 'ComfyUI';

    private readonly _clientId = `st_da_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    /** 常驻 WebSocket 连接与多任务并发路由表 */
    private _ws: WebSocket | null = null;
    private _wsConnectingPromise: Promise<void> | null = null;
    private readonly _pendingTasks = new Map<string, PendingTask>();

    /** /object_info 内存缓存 (TTL: 5分钟) */
    private readonly _objectInfoCache = new Map<string, { data: Record<string, any>; fetchedAt: number }>();
    private readonly _objectInfoTTL = 300_000;

    constructor(store: ObservableStore<DrawAssistantSettings>) {
        super(store, 'ComfyUIDriver');
    }

    protected override getEndpointUrl(): string {
        return this.store.getState().serverUrl || 'http://127.0.0.1:8188';
    }

    public async ping(): Promise<boolean> {
        try {
            await this.getJson('/system_stats', 5000);
            return true;
        } catch {
            return false;
        }
    }

    public async checkConnection(): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
        const start = performance.now();
        try {
            await this.getJson('/system_stats', 5000);
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

    public formatPrompt(rawPrompt: string): string {
        return (rawPrompt || '').trim();
    }

    /**
     * 格式化 LoRA 模型为 WeiLin 插件文本语法标签 (<wlr:Name:ModelW:ClipW:TriggerW>)
     *
     * 规则：
     * 1. 必须移除文件名后缀（WeiLin 节点内部固定自动拼接 .safetensors）；
     * 2. 依次映射 UNet 权重、CLIP 文本编码器权重与触发词注入权重。
     *
     * @param lora LoRA 配置项
     * @returns 格式化后的 WeiLin LoRA 标签字符串
     */
    public override formatLoraTag(lora: { name: string; weight?: number; clipWeight?: number; textWeight?: number; triggerWeight?: number }): string {
        const cleanName = stripExt(lora.name);
        if (!cleanName) return '';
        const modelWeight = lora.weight ?? 1.0;
        const clipWeight = lora.clipWeight ?? lora.textWeight ?? modelWeight;
        const triggerWeight = lora.triggerWeight ?? 1.0;
        return `<wlr:${cleanName}:${modelWeight}:${clipWeight}:${triggerWeight}>`;
    }

    /** 批量拉取 ComfyUI 后端资产并同步至 Store */
    public override async syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult> {
        const [models, clips, vaes, samplers, schedulers, loras] = await Promise.all([
            this.getModels(),
            this.getClips(),
            this.getVaes(),
            this.getSamplers(),
            this.getSchedulers(),
            this.getLoras()
        ]);

        if (models.length > 0) store.set('cachedModels', models);
        if (clips.length > 0) store.set('cachedClips', clips);
        if (vaes.length > 0) store.set('cachedVaes', vaes);
        if (samplers.length > 0) store.set('cachedSamplers', samplers);
        if (schedulers.length > 0) store.set('cachedSchedulers', schedulers);
        if (loras.length > 0) store.set('cachedLoras', loras);

        const total = models.length + clips.length + vaes.length + samplers.length + schedulers.length + loras.length;
        return {
            updatedCount: total,
            summary: `已成功自动更新：${models.length} 个模型、${loras.length} 个 LoRA、${samplers.length} 个采样算法方案。`,
            details: {
                models: models.length,
                clips: clips.length,
                vaes: vaes.length,
                samplers: samplers.length,
                schedulers: schedulers.length,
                loras: loras.length
            }
        };
    }

    public override buildPayload(options: {
        cleanPositive: string;
        cleanNegative: string;
        mode?: 'txt2img' | 'inpaint';
        initImageBlob?: Blob;
        maskImageBlob?: Blob;
        denoiseStrength?: number;
        overrides?: Record<string, unknown>;
    }): GenerationPayload {
        const settings = this.store.getState();

        // 1. 组装正向提示词：模型起手词 + 全局前缀 + AI楼层正向词 + 全局后缀 + LoRA 标签 (WeiLin 格式)
        const loraTags = (settings.loras || [])
            .map((item) => this.formatLoraTag(item))
            .filter(Boolean)
            .join(', ');

        const finalPositive = joinPromptParts(
            settings.checkpointPositivePrefix,
            settings.promptPrefix,
            options.cleanPositive,
            settings.promptSuffix,
            loraTags
        );

        // 2. 组装负向提示词：模型避坑词 + 全局负向词 + AI楼层负向词
        const finalNegative = joinPromptParts(
            settings.checkpointNegativePrefix,
            settings.negativePrefix,
            options.cleanNegative
        );

        const params = {
            seed: typeof options.overrides?.seed === 'number' ? options.overrides.seed : -1,
            steps: typeof options.overrides?.steps === 'number' ? options.overrides.steps : settings.steps || 28,
            cfgScale: typeof options.overrides?.cfgScale === 'number' ? options.overrides.cfgScale : settings.cfgScale || 6.5,
            samplerName: (options.overrides?.samplerName as string) || settings.samplerName || 'euler_ancestral',
            scheduler: (options.overrides?.scheduler as string) || settings.scheduler || 'normal',
            width: typeof options.overrides?.width === 'number' ? options.overrides.width : settings.width || 1024,
            height: typeof options.overrides?.height === 'number' ? options.overrides.height : settings.height || 1024
        };

        if (options.mode === 'inpaint' && options.initImageBlob && options.maskImageBlob) {
            return {
                mode: 'inpaint',
                prompt: finalPositive,
                negativePrompt: finalNegative,
                params,
                initImageBlob: options.initImageBlob,
                maskImageBlob: options.maskImageBlob,
                denoiseStrength: options.denoiseStrength ?? settings.inpaintDenoise ?? 0.75
            };
        }

        return {
            mode: 'txt2img',
            prompt: finalPositive,
            negativePrompt: finalNegative,
            params
        };
    }

    public async generate(
        payload: GenerationPayload,
        onProgress?: (progress: { percent: number; nodeName?: string; previewBlob?: Blob }) => void
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }> {
        const settings = this.store.getState();

        // 确保 WebSocket 连接就绪
        await this.ensureWebSocket();

        let initImageFileName = '';
        let maskImageFileName = '';

        // 若为局部重绘模式，先上传底图与遮罩
        if (payload.mode === 'inpaint') {
            const timestamp = Date.now();
            initImageFileName = `inpaint_init_${timestamp}.png`;
            maskImageFileName = `inpaint_mask_${timestamp}.png`;

            await Promise.all([
                this.uploadImageBlob(payload.initImageBlob, initImageFileName, 'input'),
                this.uploadImageBlob(payload.maskImageBlob, maskImageFileName, 'input')
            ]);
        }

        const rawWorkflow =
            payload.mode === 'inpaint'
                ? settings.inpaintWorkflowJson || settings.workflowJson
                : settings.workflowJson;

        if (!rawWorkflow || !rawWorkflow.trim()) {
            throw new DriverError(
                DriverErrorType.INVALID_PARAMS,
                payload.mode === 'inpaint'
                    ? '未配置 ComfyUI 局部重绘工作流 JSON，请在设置面板中导入工作流'
                    : '未配置 ComfyUI 文生图工作流 JSON，请在设置面板中导入工作流'
            );
        }

        const promptJson = substituteWorkflowVariables(
            rawWorkflow,
            payload,
            settings,
            initImageFileName,
            maskImageFileName
        );

        const promptResp = await this.postJson<{ prompt_id: string; number: number; node_errors?: Record<string, any> }>(
            '/prompt',
            {
                prompt: promptJson,
                client_id: this._clientId
            },
            settings.requestTimeout || 120_000
        );

        if (!promptResp?.prompt_id) {
            let errorMsg = '未返回 prompt_id';
            if (promptResp?.node_errors && typeof promptResp.node_errors === 'object') {
                const parts: string[] = [];
                for (const [nodeId, errObj] of Object.entries(promptResp.node_errors)) {
                    const cType = (errObj as any)?.class_type ? ` (${(errObj as any).class_type})` : '';
                    const errors = Array.isArray((errObj as any)?.errors)
                        ? (errObj as any).errors.map((e: any) => e.message || JSON.stringify(e)).join('; ')
                        : (errObj as any)?.message || '参数配置不匹配';
                    parts.push(`节点 [${nodeId}${cType}]: ${errors}`);
                }
                if (parts.length > 0) {
                    errorMsg = parts.join('\n');
                }
            }
            throw new DriverError(
                DriverErrorType.BACKEND_ERROR,
                `ComfyUI 任务提交被拒绝:\n${errorMsg}`
            );
        }

        const promptId = promptResp.prompt_id;

        return new Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }>((resolve, reject) => {
            const timeoutTimer = setTimeout(() => {
                this._pendingTasks.delete(promptId);
                reject(
                    new DriverError(
                        DriverErrorType.TIMEOUT,
                        `ComfyUI 生成任务执行超时 (${Math.round((settings.requestTimeout || 120_000) / 1000)}s)`
                    )
                );
            }, settings.requestTimeout || 120_000);

            this._pendingTasks.set(promptId, {
                resolve,
                reject,
                onProgress: onProgress || (() => {}),
                payload,
                timeoutTimer
            });
        });
    }

    public override async interrupt(): Promise<void> {
        await super.interrupt();
        try {
            await this.postJson('/interrupt', {});
        } catch (err) {
            this.logger.warn('向 ComfyUI 发送中断指令失败', err);
        }

        for (const [promptId, task] of this._pendingTasks.entries()) {
            clearTimeout(task.timeoutTimer);
            task.reject(new DriverError(DriverErrorType.CANCELLED, '用户取消了生图任务'));
            this._pendingTasks.delete(promptId);
        }
    }

    /** 兼容历史 cancel 别名调用 */
    public async cancel(): Promise<void> {
        return this.interrupt();
    }

    // ─── WebSocket 管理与消息分发 ─────────────────────────────────────────────

    private async ensureWebSocket(): Promise<void> {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            return;
        }

        if (this._wsConnectingPromise) {
            return this._wsConnectingPromise;
        }

        this._wsConnectingPromise = new Promise<void>((resolve, reject) => {
            const serverUrl = this.store.getState().serverUrl || 'http://127.0.0.1:8188';
            const wsUrl = serverUrl.replace(/^http/, 'ws') + `/ws?clientId=${this._clientId}`;

            try {
                this._ws = new WebSocket(wsUrl);
                this._ws.binaryType = 'blob';

                this._ws.onopen = () => {
                    this.logger.info(`ComfyUI WebSocket 已连接: ${wsUrl}`);
                    this._wsConnectingPromise = null;
                    resolve();
                };

                this._ws.onerror = (evt) => {
                    this.logger.error('ComfyUI WebSocket 发生异常', evt);
                    this._wsConnectingPromise = null;
                    reject(new DriverError(DriverErrorType.NETWORK_ERROR, '无法连接到 ComfyUI WebSocket 服务'));
                };

                this._ws.onclose = () => {
                    this.logger.warn('ComfyUI WebSocket 连接已断开');
                    this._ws = null;
                    this._wsConnectingPromise = null;

                    // 安全清理当前挂起任务，防止 Promise 悬挂
                    for (const [promptId, task] of this._pendingTasks.entries()) {
                        clearTimeout(task.timeoutTimer);
                        task.reject(new DriverError(DriverErrorType.NETWORK_ERROR, 'ComfyUI WebSocket 连接意外断开'));
                        this._pendingTasks.delete(promptId);
                    }
                };

                this._ws.onmessage = async (evt) => {
                    if (evt.data instanceof Blob) {
                        // 二进制消息通常为实时预览图 (PNG/JPEG)
                        const previewBlob = evt.data.slice(8); // 前 8 字节为头部
                        for (const task of this._pendingTasks.values()) {
                            task.onProgress({ percent: -1, previewBlob });
                        }
                        return;
                    }

                    try {
                        const msg = JSON.parse(evt.data);
                        await this.handleWebSocketMessage(msg);
                    } catch (err) {
                        this.logger.debug('解析 ComfyUI WebSocket JSON 消息失败', err);
                    }
                };
            } catch (err: any) {
                this._wsConnectingPromise = null;
                reject(new DriverError(DriverErrorType.NETWORK_ERROR, `创建 WebSocket 失败: ${err.message}`));
            }
        });

        return this._wsConnectingPromise;
    }

    private async handleWebSocketMessage(msg: { type: string; data: any }): Promise<void> {
        const { type, data } = msg;

        if (type === 'progress') {
            const promptId = data?.prompt_id;
            const task = promptId ? this._pendingTasks.get(promptId) : Array.from(this._pendingTasks.values())[0];
            if (task && data?.max > 0) {
                const percent = Math.round((data.value / data.max) * 100);
                task.onProgress({ percent, nodeName: data?.node });
            }
        } else if (type === 'executing') {
            const promptId = data?.prompt_id;
            const node = data?.node;

            if (node === null && promptId) {
                // 任务完成，拉取输出结果
                const task = this._pendingTasks.get(promptId);
                if (task) {
                    clearTimeout(task.timeoutTimer);
                    this._pendingTasks.delete(promptId);
                    try {
                        const images = await this.fetchPromptImages(promptId);
                        task.resolve({
                            imageBlobs: images,
                            metadata: {
                                promptId,
                                prompt: task.payload.prompt,
                                negativePrompt: task.payload.negativePrompt,
                                params: task.payload.params
                            }
                        });
                    } catch (err: any) {
                        task.reject(err);
                    }
                }
            }
        } else if (type === 'execution_error') {
            const promptId = data?.prompt_id;
            const task = promptId ? this._pendingTasks.get(promptId) : null;
            if (task) {
                clearTimeout(task.timeoutTimer);
                this._pendingTasks.delete(promptId);
                task.reject(
                    new DriverError(
                        DriverErrorType.BACKEND_ERROR,
                        `ComfyUI 执行节点错误: ${data?.exception_message || JSON.stringify(data)}`
                    )
                );
            }
        }
    }

    private async fetchPromptImages(promptId: string): Promise<Blob[]> {
        const history = await this.getJson<Record<string, any>>(`/history/${promptId}`);
        const promptData = history?.[promptId];
        if (!promptData?.outputs) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'ComfyUI 历史记录中未找到任务输出数据');
        }

        const blobs: Blob[] = [];
        for (const nodeOutput of Object.values(promptData.outputs) as any[]) {
            if (nodeOutput.images && Array.isArray(nodeOutput.images)) {
                for (const imgInfo of nodeOutput.images) {
                    const query = new URLSearchParams({
                        filename: imgInfo.filename,
                        subfolder: imgInfo.subfolder || '',
                        type: imgInfo.type || 'output'
                    });
                    const blob = await this.getBlob(`/view?${query.toString()}`);
                    blobs.push(blob);
                }
            }
        }

        if (blobs.length === 0) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'ComfyUI 工作流未生成任何图像');
        }

        return blobs;
    }

    private async uploadImageBlob(blob: Blob, fileName: string, imageType = 'input'): Promise<void> {
        const formData = new FormData();
        formData.append('image', blob, fileName);
        formData.append('type', imageType);
        formData.append('overwrite', 'true');

        const serverUrl = this.store.getState().serverUrl || 'http://127.0.0.1:8188';
        const url = `${serverUrl.replace(/\/+$/, '')}/upload/image`;

        const resp = await fetch(url, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(30000)
        });

        if (!resp.ok) {
            throw new DriverError(
                DriverErrorType.NETWORK_ERROR,
                `上传重绘图像资源失败: ${resp.status} ${resp.statusText}`
            );
        }
    }

    // ─── /object_info 全量模型资产查询与缓存 ────────────────────────────────────

    private async getCachedObjectInfo(nodeClass: string): Promise<Record<string, any>> {
        const cached = this._objectInfoCache.get(nodeClass);
        if (cached && Date.now() - cached.fetchedAt < this._objectInfoTTL) {
            return cached.data;
        }
        const data = await this.getJson<Record<string, any>>(`/object_info/${nodeClass}`, 8000);
        this._objectInfoCache.set(nodeClass, { data, fetchedAt: Date.now() });
        return data;
    }

    /**
     * 获取 ComfyUI 后端支持的全部类型主模型 (包含 Checkpoint, UNet, DiffusionModel, GGUF 等并合并去重)
     */
    public async getModels(): Promise<string[]> {
        const models = new Set<string>();
        const nodes = [
            'CheckpointLoaderSimple',
            'CheckpointLoader',
            'UNETLoader',
            'DiffusionModelLoader',
            'UnetLoaderGGUF',
            'UnetLoaderPytorchModel'
        ];

        for (const nodeClass of nodes) {
            try {
                const info = await this.getCachedObjectInfo(nodeClass);
                const req = info?.[nodeClass]?.input?.required;
                if (req) {
                    for (const key of ['ckpt_name', 'unet_name', 'model_name', 'unet_name_gguf']) {
                        const field = req[key];
                        if (Array.isArray(field) && Array.isArray(field[0])) {
                            (field[0] as string[]).forEach((m) => models.add(m));
                        }
                    }
                }
            } catch (err) {
                this.logger.debug(`获取 ComfyUI 模型节点 ${nodeClass} 失败`, err);
            }
        }
        return Array.from(models);
    }

    /**
     * 获取 ComfyUI 后端全部 CLIP 编码器模型列表 (含 DualCLIPLoader)
     */
    public async getClips(): Promise<string[]> {
        const clips = new Set<string>();
        const nodes = ['CLIPLoader', 'DualCLIPLoader', 'TripleCLIPLoader'];

        for (const nodeClass of nodes) {
            try {
                const info = await this.getCachedObjectInfo(nodeClass);
                const req = info?.[nodeClass]?.input?.required;
                if (req) {
                    for (const key of ['clip_name', 'clip_name1', 'clip_name2', 'clip_name3']) {
                        const field = req[key];
                        if (Array.isArray(field) && Array.isArray(field[0])) {
                            (field[0] as string[]).forEach((c) => clips.add(c));
                        }
                    }
                }
            } catch (err) {
                this.logger.debug(`获取 ComfyUI CLIP 节点 ${nodeClass} 失败`, err);
            }
        }
        return Array.from(clips);
    }

    /**
     * 获取 ComfyUI 后端全部 VAE 图像解码器模型列表
     */
    public async getVaes(): Promise<string[]> {
        try {
            const info = await this.getCachedObjectInfo('VAELoader');
            const field = info?.['VAELoader']?.input?.required?.['vae_name'];
            if (Array.isArray(field) && Array.isArray(field[0])) {
                return field[0] as string[];
            }
        } catch (err) {
            this.logger.debug('获取 ComfyUI VAE 节点资产失败', err);
        }
        return [];
    }

    /**
     * 获取 ComfyUI 后端全部 LoRA 模型列表 (包含 GGUF LoRA)
     */
    public async getLoras(): Promise<string[]> {
        const loras = new Set<string>();
        const nodes = [
            'LoraLoader',
            'LoraLoaderModelOnly',
            'CR Lora Stack',
            'LoraLoaderModelOnlyGGUF',
            'LoraLoaderGGUF'
        ];

        for (const nodeClass of nodes) {
            try {
                const info = await this.getCachedObjectInfo(nodeClass);
                const req = info?.[nodeClass]?.input?.required;
                if (req) {
                    for (const key of ['lora_name', 'lora_name_1', 'lora_name_2', 'lora_name_3']) {
                        const field = req[key];
                        if (Array.isArray(field) && Array.isArray(field[0])) {
                            (field[0] as string[]).forEach((l) => loras.add(l));
                        }
                    }
                }
            } catch (err) {
                this.logger.debug(`获取 ComfyUI LoRA 节点 ${nodeClass} 失败`, err);
            }
        }
        return Array.from(loras);
    }

    /**
     * 获取 ComfyUI 采样算法列表
     */
    public async getSamplers(): Promise<string[]> {
        try {
            const info = await this.getCachedObjectInfo('KSampler');
            const field = info?.['KSampler']?.input?.required?.['sampler_name'];
            if (Array.isArray(field) && Array.isArray(field[0])) {
                return field[0] as string[];
            }
        } catch (err) {
            this.logger.debug('获取 ComfyUI 采样器列表失败', err);
        }
        return [];
    }

    /**
     * 获取 ComfyUI 调度器算法列表
     */
    public async getSchedulers(): Promise<string[]> {
        try {
            const info = await this.getCachedObjectInfo('KSampler');
            const field = info?.['KSampler']?.input?.required?.['scheduler'];
            if (Array.isArray(field) && Array.isArray(field[0])) {
                return field[0] as string[];
            }
        } catch (err) {
            this.logger.debug('获取 ComfyUI 调度器列表失败', err);
        }
        return [];
    }
}

