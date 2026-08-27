/**
 * @module domain/drivers/driver-contract
 * @description 生图后端驱动接口与请求参数定义 (IDrawDriver, GenerationPayload)
 */

export * from './base-driver';
import type { ObservableStore } from '../../core/state/store';
import type { DrawAssistantSettings } from '../../core/state/store-types';
import type {
    IDrawDriverContract,
    DriverAssetSyncResult,
    GenerationPayload,
    DriverBuildPayloadOptions
} from '../../core/contracts';

export type {
    CommonGenParams,
    GenerationPayload,
    DriverBuildPayloadOptions,
    DriverAssetSyncResult,
    IDrawDriverContract
} from '../../core/contracts';







/** 生图后端驱动通用抽象接口 */
export interface IDrawDriver extends IDrawDriverContract {
    readonly id: string;
    readonly name: string;

    /** 检查后端连通性与健康状态 */
    ping(): Promise<boolean>;

    /** 检查后端连通性并返回耗时与状态 (供遥测与健康检测使用) */
    checkConnection(): Promise<{ connected: boolean; latencyMs?: number; error?: string }>;

    /** 同步拉取后端全量模型、采样器与 LoRA 资产并批量缓存至 Store */
    syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult>;

    /** 适配目标后端的提示词权重语法 */
    formatPrompt(rawPrompt: string): string;

    /** 适配目标后端的 LoRA 标签语法 (如 ComfyUI WLR 语法 vs SD-WebUI 语法) */
    formatLoraTag(lora: { name: string; weight?: number; clipWeight?: number; textWeight?: number; triggerWeight?: number }): string;

    /** 组装引擎专属的 GenerationPayload */
    buildPayload(options: DriverBuildPayloadOptions): GenerationPayload;

    /** 执行生图流程并派发生图进度 */
    generate(
        payload: GenerationPayload,
        onProgress: (progress: { percent: number; nodeName?: string; previewBlob?: Blob }) => void
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }>;

    /** 中断当前正在执行的任务 */
    interrupt(): Promise<void>;
}
