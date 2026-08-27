/**
 * @module drivers/comfyui
 * @description ComfyUI 生图驱动实现类
 *
 * 职责：
 * - 封装 ComfyUI API 与 WebSocket 实时消息通信
 * - 支持提交工作流、监听推流进度与提取最终生成的图片 Base64
 * - 自动管理二进制预览图 Object URL 生命周期，防范内存泄露
 */
import { BaseDriver } from './base';
import { type ConnectionInfo, type GenerateOptions, type GenerateResult, type ProgressCallback } from './types';
import type { DrawAssistantSettings } from '../settings/types';
export interface WorkflowNode {
    inputs: Record<string, unknown>;
    class_type: string;
    _meta?: Record<string, unknown>;
}
export type WorkflowJson = Record<string, WorkflowNode>;
/**
 * 获取工作流 JSON 对象
 * - 若 workflowJsonStr 非空，解析用户自定义工作流
 * - 否则使用内置 Wai 工作流
 */
export declare function loadWorkflow(workflowJsonStr: string): WorkflowJson;
/**
 * 使用正则与类型解析将工作流 JSON 字符串中的 %xxx% 变量替换为实际运行参数
 */
export declare function substituteWorkflowVariables(workflowJsonStr: string, options: GenerateOptions): WorkflowJson;
/**
 * 从 /history 响应的 outputs 中提取输出图像信息
 */
export declare function extractFirstOutputImage(outputs: Record<string, {
    images?: Array<{
        filename: string;
        subfolder: string;
        type: string;
    }>;
}>, saveImageNodeId: string): {
    filename: string;
    subfolder: string;
    type: string;
} | null;
export declare class ComfyUIDriver extends BaseDriver {
    readonly name = "comfyui";
    /** 固定 client_id，在生命周期内保持一致（相同 client_id 重连会自动替换旧连接） */
    private readonly _clientId;
    /** 当前 WebSocket 连接 */
    private _ws;
    /** 用于追踪当前后端 KSampler 执行环节的 PerformanceSpan */
    private _executionSpanMap;
    /**
     * 每个 prompt_id 对应一个 Promise 的 resolve/reject 控制器
     * 用于在 WebSocket 消息中按 prompt_id 路由结果
     */
    private _pendingTasks;
    constructor(settings: DrawAssistantSettings);
    /** /object_info 内存缓存，以 nodeClass 为键（TTL=5min，避免重复请求） */
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
     * 连接建立后发送 feature_flags 消息进行能力协商（开启二进制预览帧传输）
     */
    private _connectWebSocket;
    private _handleJsonMessage;
    /** 从 /history 获取完成结果，再从 /view 取回图像二进制 */
    private _fetchAndResolveResult;
    private _fetchHistory;
    private _fetchImageBlob;
    private _blobToBase64;
    private _buildWebSocketUrl;
    checkConnection(): Promise<ConnectionInfo>;
    generate(options: GenerateOptions, onProgress?: ProgressCallback): Promise<GenerateResult>;
    cancel(): void;
    /**
     * 显式销毁 ComfyUIDriver 实例
     * 关闭 WebSocket 连接、释放预览图 Object URL、拒绝所有未完成的任务 Promise 并清理监听句柄
     */
    dispose(): void;
    getSamplers(): Promise<string[]>;
    getSchedulers(): Promise<string[]>;
    getModels(): Promise<string[]>;
    getClips(): Promise<string[]>;
    getVaes(): Promise<string[]>;
    getLoras(): Promise<string[]>;
    private _waitForWebSocketOpen;
}
//# sourceMappingURL=comfyui.d.ts.map