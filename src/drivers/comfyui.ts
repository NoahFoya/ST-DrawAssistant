/**
 * ComfyUIDriver — ComfyUI 后端驱动（完整实现）
 *
 * 通信协议：
 *   - 提交任务：POST /prompt（含 workflow JSON + client_id）
 *   - 进度追踪：WebSocket ws://host/ws?clientId={clientId}&feature_flags=supports_binary_preview=true
 *   - 获取结果：GET /history/{promptId} → GET /view?filename=...
 *
 * 取消策略（ComfyUI 官方限制）：
 *   - PENDING 任务：POST /queue { "delete": [promptId] }（有效）
 *   - RUNNING 任务：客户端丢弃模式（标记 _cancelled，忽略后续 WebSocket 消息）
 *
 * 参考：.agents/Skills/comfyui-api-reference/SKILL.md
 */

import { BaseDriver } from './base';
import {
    DriverError,
    DriverErrorType,
    type ConnectionInfo,
    type GenerateOptions,
    type GenerateResult,
    type ProgressCallback,
} from './types';
import { loadWorkflow, injectParams, extractFirstOutputImage } from './comfyui-workflow';
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
     * 声明 supports_binary_preview=true 以接收二进制预览图
     */
    private _connectWebSocket(): void {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) return;

        const wsUrl = this._buildWebSocketUrl(
            `/ws?clientId=${this._clientId}&feature_flags=supports_binary_preview%3Dtrue`
        );

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

        this._ws.onerror = (event) => {
            console.error('[ST-DrawAssistant] WebSocket 错误', event);
        };

        this._ws.onclose = () => {
            this._ws = null;
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
                if (evt.node === null) {
                    // 任务执行完成信号，从 /history 取回结果
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

    /** 处理二进制消息（预览图） */
    private _handleBinaryMessage(blob: Blob): void {
        // 前 4 字节为事件类型 ID（大端序 uint32），事件类型 1 = 预览图
        blob.arrayBuffer().then(buffer => {
            const view = new DataView(buffer);
            const eventType = view.getUint32(0);
            if (eventType === 1) {
                const imageData = buffer.slice(4);
                const previewBlob = new Blob([imageData], { type: 'image/png' });
                const previewUrl = URL.createObjectURL(previewBlob);

                // 将预览图分发给所有等待中的任务（目前只有一个活跃任务）
                for (const task of this._pendingTasks.values()) {
                    task.onProgress?.({
                        currentStep: 0,
                        totalSteps: 0,
                        percentage: -1, // -1 表示仅有预览图，无精确步数
                        statusMessage: '预览图',
                        previewImage: previewUrl,
                    });
                }
            }
        }).catch(() => { /* 忽略二进制消息解析错误 */ });
    }

    // ─── 结果获取 ─────────────────────────────────────────────────────────────

    /** 从 /history 获取完成结果，再从 /view 取回图像二进制 */
    private async _fetchAndResolveResult(
        promptId: string,
        resolve: (result: GenerateResult) => void,
        reject: (err: Error) => void
    ): Promise<void> {
        this._pendingTasks.delete(promptId);

        try {
            // 轮询 /history/{promptId}（通常第一次就能取到）
            const history = await this._fetchHistory(promptId);
            const entry = history[promptId];

            if (!entry) {
                reject(new DriverError(DriverErrorType.BACKEND_ERROR, `任务 ${promptId} 在 history 中不存在`));
                return;
            }

            if (entry.status.status_str !== 'success') {
                reject(new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `任务 ${promptId} 状态异常: ${entry.status.status_str}`
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

            resolve({
                imageData: base64,
                mimeType: 'image/png',
            });
        } catch (err) {
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

        // 3. 加载并注入参数到工作流
        const workflow = loadWorkflow(this.settings.workflowJson);
        injectParams(
            workflow,
            options,
            this.settings.workflowInjection,
            this.settings.promptPrefix,
            this.settings.negativePrefix
        );

        // 4. 提交任务
        const submitResult = await this.postJson<{ prompt_id: string; number: number; node_errors: Record<string, unknown> }>(
            '/prompt',
            { prompt: workflow, client_id: this._clientId }
        );

        const promptId = submitResult.prompt_id;

        if (!promptId) {
            throw new DriverError(DriverErrorType.BACKEND_ERROR, 'ComfyUI 未返回 prompt_id');
        }

        if (Object.keys(submitResult.node_errors ?? {}).length > 0) {
            throw new DriverError(
                DriverErrorType.BACKEND_ERROR,
                `Workflow 节点错误: ${JSON.stringify(submitResult.node_errors)}`
            );
        }

        // 5. 等待 WebSocket 推送完成信号
        return new Promise<GenerateResult>((resolve, reject) => {
            this._pendingTasks.set(promptId, { resolve, reject, onProgress });
        });
    }

    cancel(): void {
        this._cancelled = true;

        // 向 ComfyUI 发送队列删除请求（对 PENDING 任务有效）
        const promptIds = Array.from(this._pendingTasks.keys());
        if (promptIds.length > 0) {
            void this.postJson('/queue', { delete: promptIds }).catch(() => {
                // 忽略取消失败（任务可能已在 RUNNING 状态）
            });

            // 客户端丢弃模式：reject 所有等待中的任务
            for (const [id, task] of this._pendingTasks) {
                this._pendingTasks.delete(id);
                task.reject(new DriverError(DriverErrorType.CANCELLED, '用户取消了生图任务'));
            }
        }

        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    async getSamplers(): Promise<string[]> {
        try {
            const info = await this.getJson<Record<string, { input?: { required?: { sampler_name?: unknown[] } } }>>(
                '/object_info/KSampler',
                10000
            );
            const samplerField = info?.['KSampler']?.input?.required?.['sampler_name'];
            if (Array.isArray(samplerField) && Array.isArray(samplerField[0])) {
                return samplerField[0] as string[];
            }
        } catch {
            // 后备列表
        }
        return ['euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral', 'lms', 'ddim', 'uni_pc', 'dpmpp_2m', 'dpmpp_sde'];
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
                reject(new DriverError(DriverErrorType.TIMEOUT, `WebSocket 连接超时（${timeoutMs}ms）`));
            }, timeoutMs);

            this._ws.onopen = () => {
                clearTimeout(timeout);
                resolve();
            };
            this._ws.onerror = () => {
                clearTimeout(timeout);
                reject(new DriverError(DriverErrorType.NETWORK_ERROR, `WebSocket 连接失败，请确认 ComfyUI 以 --enable-cors-header 参数启动`));
            };
        });
    }
}
