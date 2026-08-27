/**
 * @module domain/drivers/comfyui-driver
 * @description ComfyUI 生图后端驱动实现 (支持 WebSocket 状态追踪、API 工作流变量安全替换、Inpaint 资产上传与中断清理)
 */
import { BaseDriver } from './base-driver';
import { GenerationPayload, DriverAssetSyncResult } from './driver-contract';
import { ObservableStore } from '../../core/state/store';
import type { DrawAssistantSettings } from '../../core/state/store-types';
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
export declare function substituteWorkflowVariables(workflowJsonStr: string | Record<string, any>, payload: GenerationPayload, settings: DrawAssistantSettings, initImageFileName?: string, maskImageFileName?: string): Record<string, any>;
export declare class ComfyUIDriver extends BaseDriver {
    readonly id = "comfyui";
    readonly name = "ComfyUI";
    private readonly _clientId;
    /** 常驻 WebSocket 连接与多任务并发路由表 */
    private _ws;
    private _wsConnectingPromise;
    private readonly _pendingTasks;
    /** /object_info 内存缓存 (TTL: 5分钟) */
    private readonly _objectInfoCache;
    private readonly _objectInfoTTL;
    constructor(store: ObservableStore<DrawAssistantSettings>);
    protected getEndpointUrl(): string;
    ping(): Promise<boolean>;
    checkConnection(): Promise<{
        connected: boolean;
        latencyMs?: number;
        error?: string;
    }>;
    formatPrompt(rawPrompt: string): string;
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
    formatLoraTag(lora: {
        name: string;
        weight?: number;
        clipWeight?: number;
        textWeight?: number;
        triggerWeight?: number;
    }): string;
    /** 批量拉取 ComfyUI 后端资产并同步至 Store */
    syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult>;
    buildPayload(options: {
        cleanPositive: string;
        cleanNegative: string;
        mode?: 'txt2img' | 'inpaint';
        initImageBlob?: Blob;
        maskImageBlob?: Blob;
        denoiseStrength?: number;
        overrides?: Record<string, unknown>;
    }): GenerationPayload;
    generate(payload: GenerationPayload, onProgress?: (progress: {
        percent: number;
        nodeName?: string;
        previewBlob?: Blob;
    }) => void): Promise<{
        imageBlobs: Blob[];
        metadata: Record<string, unknown>;
    }>;
    interrupt(): Promise<void>;
    /** 兼容历史 cancel 别名调用 */
    cancel(): Promise<void>;
    private ensureWebSocket;
    private handleWebSocketMessage;
    private fetchPromptImages;
    private uploadImageBlob;
    private getCachedObjectInfo;
    /**
     * 获取 ComfyUI 后端支持的全部类型主模型 (包含 Checkpoint, UNet, DiffusionModel, GGUF 等并合并去重)
     */
    getModels(): Promise<string[]>;
    /**
     * 获取 ComfyUI 后端全部 CLIP 编码器模型列表 (含 DualCLIPLoader)
     */
    getClips(): Promise<string[]>;
    /**
     * 获取 ComfyUI 后端全部 VAE 图像解码器模型列表
     */
    getVaes(): Promise<string[]>;
    /**
     * 获取 ComfyUI 后端全部 LoRA 模型列表 (包含 GGUF LoRA)
     */
    getLoras(): Promise<string[]>;
    /**
     * 获取 ComfyUI 采样算法列表
     */
    getSamplers(): Promise<string[]>;
    /**
     * 获取 ComfyUI 调度器算法列表
     */
    getSchedulers(): Promise<string[]>;
}
//# sourceMappingURL=comfyui-driver.d.ts.map