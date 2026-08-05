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
     * 当前正在执行的 prompt_id
     * 用于将二进制预览图路由给正确的任务（二进制消息不含 prompt_id）
     */
    private _activePromptId;
    /** 当前活跃且尚未释放的二进制预览图 Object URL 句柄（用于及时撤销规避 Blob 内存泄漏） */
    private _activePreviewUrl;
    /** 用于追踪当前后端 KSampler 执行环节的 PerformanceSpan */
    private _executionSpanMap;
    /**
     * 每个 prompt_id 对应一个 Promise 的 resolve/reject 控制器
     * 用于在 WebSocket 消息中按 prompt_id 路由结果
     */
    private _pendingTasks;
    constructor(settings: DrawAssistantSettings);
    /** /object_info 内存缓存，以 nodeClass 为键（SKILL.md §7.2） */
    private readonly _objectInfoCache;
    /** 缓存 TTL：5 分钟（单位：ms） */
    private readonly _objectInfoTTL;
    /**
     * 获取 /object_info/{nodeClass}，带 TTL 缓存
     * 避免每次切换设置面板都重复请求
     */
    private _getCachedObjectInfo;
    private _getOrCreateClientId;
    /**
     * 建立 WebSocket 连接
     * 连接建立后发送 feature_flags 消息进行能力协商（SKILL.md §8.3）
     */
    private _connectWebSocket;
    private _handleJsonMessage;
    /** 释放当前追踪的活跃预览图 Object URL 句柄 */
    private _clearActivePreviewUrl;
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
    getSchedulers(): Promise<string[]>;
    getModels(): Promise<string[]>;
    getClips(): Promise<string[]>;
    getVaes(): Promise<string[]>;
    getLoras(): Promise<string[]>;
    private _waitForWebSocketOpen;
}
//# sourceMappingURL=comfyui.d.ts.map