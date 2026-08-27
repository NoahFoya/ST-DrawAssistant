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
import { type ConnectionInfo, type GenerateOptions, type GenerateResult, type ProgressCallback } from './types';
import type { DrawAssistantSettings } from '../settings/types';
export declare class ComfyUIDriver extends BaseDriver {
    readonly name = "comfyui";
    /** 固定 client_id，在生命周期内保持一致（相同 client_id 重连会自动替换旧连接） */
    private readonly _clientId;
    /** 当前 WebSocket 连接 */
    private _ws;
    /**
     * 每个 prompt_id 对应一个 Promise 的 resolve/reject 控制器
     * 用于在 WebSocket 消息中按 prompt_id 路由结果
     */
    private _pendingTasks;
    constructor(settings: DrawAssistantSettings);
    private _getOrCreateClientId;
    /**
     * 建立 WebSocket 连接
     * 声明 supports_binary_preview=true 以接收二进制预览图
     */
    private _connectWebSocket;
    private _handleJsonMessage;
    /** 处理二进制消息（预览图） */
    private _handleBinaryMessage;
    /** 从 /history 获取完成结果，再从 /view 取回图像二进制 */
    private _fetchAndResolveResult;
    private _fetchHistory;
    private _fetchImageBlob;
    private _blobToBase64;
    private _buildWebSocketUrl;
    checkConnection(): Promise<ConnectionInfo>;
    generate(options: GenerateOptions, onProgress?: ProgressCallback): Promise<GenerateResult>;
    cancel(): void;
    getSamplers(): Promise<string[]>;
    private _waitForWebSocketOpen;
}
//# sourceMappingURL=comfyui.d.ts.map