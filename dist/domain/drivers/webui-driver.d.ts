/**
 * @module domain/drivers/webui-driver
 * @description SD-WebUI (A1111) 生图后端驱动实现 (继承 BaseDriver，支持 txt2img/img2img、Hires.fix、安全进度轮询与中断)
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { BaseDriver } from './base-driver';
import type { GenerationPayload, DriverBuildPayloadOptions, DriverAssetSyncResult } from './driver-contract';
export declare class SDWebUIDriver extends BaseDriver {
    readonly id = "sdwebui";
    readonly name = "SD WebUI";
    constructor(store: ObservableStore<DrawAssistantSettings>);
    protected getEndpointUrl(): string;
    ping(): Promise<boolean>;
    formatPrompt(rawPrompt: string): string;
    /**
     * 格式化 LoRA 模型为 SD-WebUI A1111 语法标签 (<lora:Name:ModelW> 或 <lora:Name:ModelW:ClipW>)
     *
     * @param lora LoRA 配置项
     * @returns 格式化后的 SD LoRA 标签字符串
     */
    formatLoraTag(lora: {
        name: string;
        weight?: number;
        clipWeight?: number;
        textWeight?: number;
        triggerWeight?: number;
    }): string;
    /** 批量拉取 SD-WebUI 后端资产并同步至 Store */
    syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult>;
    /**
     * 构建 SD-WebUI 专属生图请求载荷 (Payload)
     *
     * 装配流程：
     * 1. 组装正向提示词（SD专属前缀 + 全局前缀 + 楼层词 + 后缀 + SD LoRA）；
     * 2. 组装负向提示词（SD专属负向前缀 + 全局负向前缀 + 楼层负向词）；
     * 3. 装配采样参数与可选的高清修复（Hires.fix）二阶段超分参数。
     *
     * @param options 驱动请求载荷构建参数
     * @returns 装配完成的 GenerationPayload
     */
    buildPayload(options: DriverBuildPayloadOptions): GenerationPayload;
    generate(payload: GenerationPayload, onProgress: (progress: {
        percent: number;
        nodeName?: string;
        previewBlob?: Blob;
    }) => void): Promise<{
        imageBlobs: Blob[];
        metadata: Record<string, unknown>;
    }>;
    checkConnection(): Promise<{
        connected: boolean;
        latencyMs?: number;
        error?: string;
    }>;
    getModels(): Promise<string[]>;
    getSamplers(): Promise<string[]>;
    getUpscalers(): Promise<string[]>;
    getLoras(): Promise<string[]>;
    interrupt(): Promise<void>;
}
//# sourceMappingURL=webui-driver.d.ts.map