/**
 * @module drivers/comfyui
 * @description ComfyUIDriver — ComfyUI 后端生图驱动实现类
 *
 * 职责：
 * - 封装 ComfyUI REST API 与 WebSocket 双通道通信逻辑
 * - 提交工作流任务、监听实时进度推流与提取生成结果图像
 * - 自动管理二进制预览图 Blob Object URL 生命周期，防范内存泄漏
 *
 * 通信协议与约束：
 * - 提交任务：POST /prompt（带 JSON 工作流与 client_id）
 * - 进度追踪：WebSocket ws://host/ws?clientId={clientId}
 * - 取消策略：PENDING 状态 POST /queue 删除，RUNNING 状态由客户端丢弃响应
 *
 * 规范参考：
 * - .agents/Skills/comfyui-api-reference/SKILL.md (ComfyUI API 与 WebSocket 协议)
 * - .agents/Skills/browser-storage/SKILL.md §4 (Blob Object URL 声明与释放规范)
 */

import { logger } from '../core/logger';
import { PerformanceCollector, type PerformanceSpan } from '../core/performance';
import { BaseDriver } from './base';
import {
    DriverError,
    DriverErrorType,
    type ConnectionInfo,
    type GenerateOptions,
    type GenerateResult,
    type ProgressCallback,
} from './types';
import { substituteWorkflowVariables, extractFirstOutputImage } from './comfyui-workflow';
import type { DrawAssistantSettings } from '../settings/types';

// ─── WebSocket 消息类型 ───────────────────────────────────────────────────────

interface WsJsonMessage {
    type: 'status' | 'executing' | 'executed' | 'progress' | 'execution_error' | 'execution_interrupted' | string;
    data: Record<string, unknown>;
}

interface ProgressEvent {
    value: number;
    max: number;
    prompt_id: string;
    node: string;
}

interface ExecutingEvent {
    node: string | null;
    prompt_id: string;
}

interface ExecutionErrorEvent {
    exception_message: string;
    exception_type: string;
    prompt_id: string;
}

// ─── /history 响应类型 ────────────────────────────────────────────────────────

interface HistoryEntry {
    outputs: Record<string, {
        images?: Array<{ filename: string; subfolder: string; type: string }>;
    }>;
    status: { status_str: string; completed: boolean };
}

// ─── ComfyUIDriver ────────────────────────────────────────────────────────────

export class ComfyUIDriver extends BaseDriver {
    readonly name = 'comfyui';

    /** 固定 client_id，在生命周期内保持一致（相同 client_id 重连会自动替换旧连接） */
    private readonly _clientId: string;

    /** 当前 WebSocket 连接 */
    private _ws: WebSocket | null = null;

    /**
     * 当前正在执行的 prompt_id
     * 用于将二进制预览图路由给正确的任务（二进制消息不含 prompt_id）
     */
    private _activePromptId: string | null = null;

    /** 当前活跃且尚未释放的二进制预览图 Object URL 句柄（用于及时撤销规避 Blob 内存泄漏） */
    private _activePreviewUrl: string | null = null;

    /** 用于追踪当前后端 KSampler 执行环节的 PerformanceSpan */
    private _executionSpanMap: Map<string, PerformanceSpan> = new Map();

    /**
     * 每个 prompt_id 对应一个 Promise 的 resolve/reject 控制器
     * 用于在 WebSocket 消息中按 prompt_id 路由结果
     */
    private _pendingTasks: Map<string, {
        resolve: (result: GenerateResult) => void;
        reject: (err: Error) => void;
        onProgress?: ProgressCallback;
    }> = new Map();

    constructor(settings: DrawAssistantSettings) {
        super(settings);
        // 从设置中读取或生成 client_id
        this._clientId = this._getOrCreateClientId();
    }

    // ─── /object_info 缓存 ──────────────────────────────────────────────────────────

    /** /object_info 内存缓存，以 nodeClass 为键（SKILL.md §7.2） */
    private readonly _objectInfoCache = new Map<string, {
        data: Record<string, unknown>;
        fetchedAt: number;
    }>();

    /** 缓存 TTL：5 分钟（单位：ms） */
    private readonly _objectInfoTTL = 300_000;

    /**
     * 获取 /object_info/{nodeClass}，带 TTL 缓存
     * 避免每次切换设置面板都重复请求
     */
    private async _getCachedObjectInfo(nodeClass: string, timeoutMs: number): Promise<Record<string, unknown>> {
        const cached = this._objectInfoCache.get(nodeClass);
        if (cached && Date.now() - cached.fetchedAt < this._objectInfoTTL) {
            logger.debug(`/object_info/${nodeClass} 命中缓存（副本年龄 ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s）`);
            return cached.data;
        }
        const data = await this.getJson<Record<string, unknown>>(`/object_info/${nodeClass}`, timeoutMs);
        this._objectInfoCache.set(nodeClass, { data, fetchedAt: Date.now() });
        return data;
    }

    // ─── client_id 管理 ───────────────────────────────────────────────────────

    private _getOrCreateClientId(): string {
        const key = '__da_comfyui_client_id__';
        let id = localStorage.getItem(key);
        if (!id) {
            id = crypto.randomUUID();
            localStorage.setItem(key, id);
        }
        return id;
    }

    // ─── WebSocket 管理 ───────────────────────────────────────────────────────

    /**
     * 建立 WebSocket 连接
     * 连接建立后发送 feature_flags 消息进行能力协商（SKILL.md §8.3）
     */
    private _connectWebSocket(): void {
        if (this._ws) {
            if (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING) {
                return;
            }
            try {
                this._ws.close();
            } catch {
                // 忽略显式关闭异常
            }
            this._ws = null;
        }

        // SKILL.md §8.1：WebSocket URL 只接受 clientId 参数
        const wsUrl = this._buildWebSocketUrl(`/ws?clientId=${this._clientId}`);

        this._ws = new WebSocket(wsUrl);

        this._ws.onmessage = (event: MessageEvent) => {
            if (event.data instanceof Blob) {
                this._handleBinaryMessage(event.data);
            } else if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data) as WsJsonMessage;
                    this._handleJsonMessage(msg);
                } catch {
                    // 忽略非 JSON 消息
                }
            }
        };

        // 使用 addEventListener 注册永久日志 handler，避免属性赋値被后续调用覆盖
        // _waitForWebSocketOpen 会单独注册一次性连接监听器，不干扰此处
        this._ws.addEventListener('error', (event) => {
            logger.error('WebSocket 发生错误', event);
        });

        // 连接建立后发送 feature_flags 协商消息（SKILL.md §8.3）
        // 这是开启二进制预览图的正确方式（而非将其放入 URL QueryString）
        this._ws.addEventListener('open', () => {
            this._ws?.send(JSON.stringify({
                type: 'feature_flags',
                data: { supports_binary_preview: true },
            }));
            logger.debug('WebSocket 已连接，已发送 feature_flags 协商消息');
        }, { once: true });

        this._ws.onclose = () => {
            this._ws = null;
            if (this._cancelled) {
                // 主动取消引发的关闭，不再重复 reject
                logger.debug('WebSocket 因取消操作关闭');
                return;
            }
            for (const task of this._pendingTasks.values()) {
                task.reject(new DriverError(DriverErrorType.NETWORK_ERROR, 'WebSocket 连接意外关闭'));
            }
            this._pendingTasks.clear();
        };
    }

    // ─── WebSocket 消息处理 ───────────────────────────────────────────────────

    private _handleJsonMessage(msg: WsJsonMessage): void {
        const data = msg.data;
        const promptId = (data['prompt_id'] as string | undefined);

        if (!promptId) return;

        const task = this._pendingTasks.get(promptId);
        if (!task) return; // 不属于本客户端的任务，忽略

        switch (msg.type) {
            case 'progress': {
                const evt = data as unknown as ProgressEvent;
                const percentage = evt.max > 0 ? Math.round((evt.value / evt.max) * 100) : 0;
                task.onProgress?.({
                    currentStep: evt.value,
                    totalSteps: evt.max,
                    percentage,
                    statusMessage: `采样中 ${evt.value}/${evt.max}`,
                });
                break;
            }

            case 'executing': {
                const evt = data as unknown as ExecutingEvent;
                const perf = PerformanceCollector.getInstance();
                if (evt.node !== null) {
                    // 开始 KSampler 执行链路测量
                    if (!this._executionSpanMap.has(promptId)) {
                        const span = perf.startSpan('comfyui.execution', promptId, { startNode: evt.node });
                        this._executionSpanMap.set(promptId, span);
                    }
                } else {
                    // 任务执行完成信号，结束执行链路测量
                    const span = this._executionSpanMap.get(promptId);
                    if (span) {
                        perf.endSpan(span);
                        this._executionSpanMap.delete(promptId);
                    }
                    // 从 /history 取回结果
                    void this._fetchAndResolveResult(promptId, task.resolve, task.reject);
                }
                break;
            }

            case 'execution_error': {
                const evt = data as unknown as ExecutionErrorEvent;
                this._pendingTasks.delete(promptId);
                task.reject(new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `ComfyUI 执行错误: ${evt.exception_message}（${evt.exception_type}）`
                ));
                break;
            }

            case 'execution_interrupted': {
                this._pendingTasks.delete(promptId);
                task.reject(new DriverError(DriverErrorType.CANCELLED, 'Task was interrupted'));
                break;
            }
        }
    }

    /** 释放当前追踪的活跃预览图 Object URL 句柄 */
    private _clearActivePreviewUrl(): void {
        if (this._activePreviewUrl) {
            URL.revokeObjectURL(this._activePreviewUrl);
            this._activePreviewUrl = null;
        }
    }

    /** 处理二进制消息（预览图） */
    private _handleBinaryMessage(blob: Blob): void {
        // 前 4 字节为事件类型 ID（大端序 uint32），事件类型 1 = 预览图
        blob.arrayBuffer().then(buffer => {
            const view = new DataView(buffer);
            const eventType = view.getUint32(0);
            if (eventType === 1) {
                const imageData = buffer.slice(4);
                const previewBlob = new Blob([imageData], { type: 'image/png' });
                
                // 每次创建新预览图前，主动撤销上一次未被 UI 消费的旧预览图 URL，防范内存泄漏
                this._clearActivePreviewUrl();

                const previewUrl = URL.createObjectURL(previewBlob);
                this._activePreviewUrl = previewUrl;

                // 二进制消息格式不含 prompt_id（SKILL.md §8.5）
                // 使用 _activePromptId 将预览图路由给当前正在执行的任务
                if (this._activePromptId) {
                    const task = this._pendingTasks.get(this._activePromptId);
                    if (task) {
                        task.onProgress?.({
                            currentStep: 0,
                            totalSteps: 0,
                            percentage: -1, // -1 表示仅有预览图，无精确步数
                            statusMessage: '预览图',
                            previewImage: previewUrl,
                        });
                    }
                } else {
                    logger.debug('收到二进制预览图但当前无活跃任务 prompt_id，已即时撤销');
                    this._clearActivePreviewUrl();
                }
            }
        }).catch((err) => { logger.debug('WebSocket 二进制预览图消息解析失败（非致命错误，展示会正常进行）', err); });
    }

    // ─── 结果获取 ─────────────────────────────────────────────────────────────

    /** 从 /history 获取完成结果，再从 /view 取回图像二进制 */
    private async _fetchAndResolveResult(
        promptId: string,
        resolve: (result: GenerateResult) => void,
        reject: (err: Error) => void
    ): Promise<void> {
        this._pendingTasks.delete(promptId);
        this._activePromptId = null; // 任务完成，清除活跃 prompt_id
        this._clearActivePreviewUrl(); // 清除残留预览图 Object URL

        const perf = PerformanceCollector.getInstance();
        const fetchSpan = perf.startSpan('comfyui.fetch_result', promptId);

        try {
            // 轮询 /history/{promptId}（通常第一次就能取到）
            const history = await this._fetchHistory(promptId);
            const entry = history[promptId];

            if (!entry) {
                reject(new DriverError(DriverErrorType.BACKEND_ERROR, `任务 ${promptId} 在 history 中不存在`));
                return;
            }

            // 对不同终态做差异化处理（SKILL.md §3.4）
            const statusStr = entry.status.status_str;
            if (statusStr === 'interrupted') {
                reject(new DriverError(DriverErrorType.CANCELLED, '任务被中断（/interrupt 触发）'));
                return;
            }
            if (statusStr === 'cancelled') {
                reject(new DriverError(DriverErrorType.CANCELLED, '任务已被取消'));
                return;
            }
            if (statusStr !== 'success') {
                reject(new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `任务 ${promptId} 状态异常: ${statusStr}`
                ));
                return;
            }

            // 从 SaveImage 节点获取输出图像
            const saveImageNodeId = this.settings.workflowInjection.saveImageNodeId;
            const imageRef = extractFirstOutputImage(entry.outputs, saveImageNodeId);

            if (!imageRef) {
                reject(new DriverError(DriverErrorType.BACKEND_ERROR, '工作流输出中未找到图像'));
                return;
            }

            // 取回图像二进制
            const imageBlob = await this._fetchImageBlob(imageRef.filename, imageRef.subfolder, imageRef.type);
            const base64 = await this._blobToBase64(imageBlob);

            perf.endSpan(fetchSpan, { success: true });

            resolve({
                imageData: base64,
                mimeType: 'image/png',
            });
        } catch (err) {
            perf.endSpan(fetchSpan, { success: false, error: String(err) });
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    }

    private async _fetchHistory(promptId: string): Promise<Record<string, HistoryEntry>> {
        return this.getJson<Record<string, HistoryEntry>>(`/history/${promptId}`, 15000);
    }

    private async _fetchImageBlob(filename: string, subfolder: string, type: string): Promise<Blob> {
        const url = this.buildUrl(`/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, `无法获取图像: HTTP ${response.status}`);
        }
        return response.blob();
    }

    private _blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                // 去掉 "data:image/png;base64," 前缀，只返回纯 base64
                resolve(dataUrl.split(',')[1] ?? dataUrl);
            };
            reader.onerror = () => reject(new Error('FileReader 转换失败'));
            reader.readAsDataURL(blob);
        });
    }

    // ─── URL 工具 ─────────────────────────────────────────────────────────────

    private _buildWebSocketUrl(path: string): string {
        const httpUrl = this.settings.serverUrl.replace(/\/+$/, '');
        const wsUrl = httpUrl.replace(/^https?:\/\//, (match) =>
            match === 'https://' ? 'wss://' : 'ws://'
        );
        return `${wsUrl}${path}`;
    }

    // ─── ImageDriver 接口实现 ─────────────────────────────────────────────────

    async checkConnection(): Promise<ConnectionInfo> {
        const startTime = Date.now();
        try {
            await this.getJson<unknown>('/system_stats', 5000);
            return { connected: true, latencyMs: Date.now() - startTime };
        } catch (err) {
            const message = err instanceof DriverError ? err.message : String(err);
            return { connected: false, error: message };
        }
    }

    async generate(options: GenerateOptions, onProgress?: ProgressCallback): Promise<GenerateResult> {
        this.resetCancelState();

        // 1. 建立 WebSocket 连接
        this._connectWebSocket();

        // 2. 等待 WebSocket 就绪（最多 5 秒）
        await this._waitForWebSocketOpen(5000);

        this.checkCancelled();

        // 3. 运行变量替换引擎将参数注入工作流 (options.prompt 已在前置 buildGenerateParams 中完成编译与多段拼接)
        const workflow = substituteWorkflowVariables(
            this.settings.workflowJson,
            options
        );

        // 4. 提交任务
        const perf = PerformanceCollector.getInstance();
        const submitSpan = perf.startSpan('comfyui.submit');

        const extraHeaders: Record<string, string> = {};
        if (this.settings.requestMode === 'server') {
            // server 模式：可在此处添加宿主鉴权 Header（如有）
        }

        const submitResult = await this.postJson<{ prompt_id: string; number: number; node_errors: Record<string, unknown> }>(
            '/prompt',
            { prompt: workflow, client_id: this._clientId },
            undefined,
            Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined
        );

        perf.endSpan(submitSpan, { promptId: submitResult?.prompt_id });

        const promptId = submitResult.prompt_id;

        if (!promptId) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'ComfyUI 未返回 prompt_id');
        }

        if (Object.keys(submitResult.node_errors ?? {}).length > 0) {
            logger.error('ComfyUI Workflow node_errors:', submitResult.node_errors);
            throw new DriverError(
                DriverErrorType.BACKEND_ERROR,
                `Workflow 节点错误: ${JSON.stringify(submitResult.node_errors)}`
            );
        }

        // 5. 等待 WebSocket 推送完成信号
        return new Promise<GenerateResult>((resolve, reject) => {
            this._activePromptId = promptId; // 记录当前活跃任务，用于二进制预览图路由
            this._pendingTasks.set(promptId, { resolve, reject, onProgress });
        });
    }

    cancel(): void {
        this._cancelled = true;
        this._activePromptId = null; // 清除活跃任务，后续二进制消息不再路由
        this._clearActivePreviewUrl(); // 释放未清理的预览图 Object URL

        // 对 PENDING 任务：发送 /queue delete（对 RUNNING 状态无效）
        const promptIds = Array.from(this._pendingTasks.keys());
        if (promptIds.length > 0) {
            void this.postJson('/queue', { delete: promptIds }).catch((err) => {
                // 正常情况：任务已从 PENDING 进入 RUNNING 时 delete 会失败，这是预期行为
                // 异常情况：网络错误也会走此路径，故用 debug 而非 warn 级别记录
                logger.debug('向 ComfyUI 发送 /queue delete 失败（任务可能已在执行中）', err);
            });
        }

        // 对 RUNNING 任务：发送 /interrupt 通知后端中断当前执行（SKILL.md §6）
        // ⚠️ /interrupt 是全局操作，会中断当前正在执行的任何任务，不区分 prompt_id。
        //    本扩展 maxConcurrent=1，等价于精确取消当前任务。
        void this.postJson('/interrupt', {}).catch((err) => {
            logger.debug('向 ComfyUI 发送 /interrupt 失败', err);
        });

        // 客户端丢弃模式：无论后端请求是否成功，均显式 reject 所有等待中任务并彻底清空 Map
        for (const task of this._pendingTasks.values()) {
            task.reject(new DriverError(DriverErrorType.CANCELLED, '用户取消了生图任务'));
        }
        this._pendingTasks.clear();

        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    async getSamplers(): Promise<string[]> {
        try {
            const info = await this._getCachedObjectInfo('KSampler', 10000);
            const samplerField = (info?.['KSampler'] as { input?: { required?: { sampler_name?: unknown[] } } } | undefined)?.input?.required?.['sampler_name'];
            if (Array.isArray(samplerField) && Array.isArray(samplerField[0])) {
                return samplerField[0] as string[];
            }
        } catch (err) {
            logger.warn('获取 ComfyUI KSampler 采样器列表失败，返回空列表（UI 层应提示用户检查连接）', err);
        }
        // 返回空列表而非硬编码后备：
        // 硬编码列表与实际 ComfyUI 安装（含自定义节点）可能不匹配，是误导性降级。
        // UI 层应将空列表处理为"加载失败"状态，提示用户检查后端连接后重试。
        return [];
    }

    async getSchedulers(): Promise<string[]> {
        try {
            const info = await this._getCachedObjectInfo('KSampler', 10000);
            const schedulerField = (info?.['KSampler'] as { input?: { required?: { scheduler?: unknown[] } } } | undefined)?.input?.required?.['scheduler'];
            if (Array.isArray(schedulerField) && Array.isArray(schedulerField[0])) {
                return schedulerField[0] as string[];
            }
        } catch (err) {
            logger.warn('获取 ComfyUI KSampler 调度器列表失败，返回空列表（UI 层应提示用户检查连接）', err);
        }
        // 返回空列表而非硬编码后备（原因同 getSamplers）
        return [];
    }

    async getModels(): Promise<string[]> {
        const models = new Set<string>();
        const nodes = ['CheckpointLoaderSimple', 'CheckpointLoader', 'UNETLoader', 'DiffusionModelLoader'];
        for (const nodeClass of nodes) {
            try {
                const info = await this._getCachedObjectInfo(nodeClass, 5000);
                const req = (info?.[nodeClass] as { input?: { required?: Record<string, unknown[]> } } | undefined)?.input?.required;
                if (req) {
                    for (const key of ['ckpt_name', 'unet_name', 'model_name']) {
                        const field = req[key];
                        if (Array.isArray(field) && Array.isArray(field[0])) {
                            (field[0] as string[]).forEach(m => models.add(m));
                        }
                    }
                }
            } catch (err) {
                logger.warn(`获取 ComfyUI 模型节点 ${nodeClass} 失败, 尝试其他节点`, err);
            }
        }
        return Array.from(models);
    }

    async getClips(): Promise<string[]> {
        try {
            const info = await this._getCachedObjectInfo('CLIPLoader', 8000);
            const clipField = (info?.['CLIPLoader'] as { input?: { required?: { clip_name?: unknown[] } } } | undefined)?.input?.required?.['clip_name'];
            if (Array.isArray(clipField) && Array.isArray(clipField[0])) {
                return clipField[0] as string[];
            }
        } catch (err) {
            logger.warn('获取 ComfyUI CLIP 列表失败', err);
        }
        return [];
    }

    async getVaes(): Promise<string[]> {
        try {
            const info = await this._getCachedObjectInfo('VAELoader', 8000);
            const vaeField = (info?.['VAELoader'] as { input?: { required?: { vae_name?: unknown[] } } } | undefined)?.input?.required?.['vae_name'];
            if (Array.isArray(vaeField) && Array.isArray(vaeField[0])) {
                return vaeField[0] as string[];
            }
        } catch (err) {
            logger.warn('获取 ComfyUI VAE 列表失败', err);
        }
        return [];
    }

    async getLoras(): Promise<string[]> {
        const loras = new Set<string>();
        const nodes = ['LoraLoader', 'LoraLoaderModelOnly', 'CR Lora Stack'];
        for (const nodeClass of nodes) {
            try {
                const info = await this._getCachedObjectInfo(nodeClass, 8000);
                const req = (info?.[nodeClass] as { input?: { required?: Record<string, unknown[]> } } | undefined)?.input?.required;
                if (req) {
                    for (const key of ['lora_name', 'lora_name_1', 'lora_name_2', 'lora_name_3']) {
                        const field = req[key];
                        if (Array.isArray(field) && Array.isArray(field[0])) {
                            (field[0] as string[]).forEach(l => loras.add(l));
                        }
                    }
                }
            } catch (err) {
                logger.warn(`获取 ComfyUI Lora 节点 ${nodeClass} 失败`, err);
            }
        }
        return Array.from(loras);
    }

    // ─── 工具方法 ─────────────────────────────────────────────────────────────

    private _waitForWebSocketOpen(timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this._ws) {
                reject(new DriverError(DriverErrorType.NETWORK_ERROR, 'WebSocket 未初始化'));
                return;
            }
            if (this._ws.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                cleanup();
                reject(new DriverError(DriverErrorType.TIMEOUT, `WebSocket 连接超时（${timeoutMs}ms）`));
            }, timeoutMs);

            // 使用一次性 handler，用完后立即移除，不影响 _connectWebSocket 注册的永久日志 handler
            const onError = () => {
                cleanup();
                reject(new DriverError(DriverErrorType.NETWORK_ERROR, `WebSocket 连接失败，请确认 ComfyUI 以 --enable-cors-header 参数启动`));
            };
            const onOpen = () => {
                cleanup();
                resolve();
            };
            const cleanup = () => {
                clearTimeout(timeout);
                this._ws?.removeEventListener('error', onError);
                this._ws?.removeEventListener('open', onOpen);
            };

            this._ws.addEventListener('error', onError);
            this._ws.addEventListener('open', onOpen);
        });
    }
}
