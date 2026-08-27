/**
 * @module domain/drivers/openai-driver
 * @description OpenAI 兼容图像生图后端驱动实现 (支持 OpenAI DALL-E 2/3、Grok 图像及兼容中转接口)
 *
 * 核心处理规则：
 * - 面向自然语言提示词引擎：直接传递自然语言描述，不拼接负向提示词与扩散模型专有标签；
 * - 支持 Base64 JSON 与 URL 图像异步下载，自动处理跨源安全拉取。
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { BaseDriver } from './base-driver';
import type { GenerationPayload, DriverBuildPayloadOptions, DriverAssetSyncResult } from './driver-contract';
export declare class OpenAIDriver extends BaseDriver {
    readonly id = "openai";
    readonly name = "OpenAI / Grok / Banana";
    constructor(store: ObservableStore<DrawAssistantSettings>);
    protected getEndpointUrl(): string;
    ping(): Promise<boolean>;
    checkConnection(): Promise<{
        connected: boolean;
        latencyMs?: number;
        error?: string;
    }>;
    formatPrompt(rawPrompt: string): string;
    syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult>;
    getModels(): Promise<string[]>;
    buildPayload(options: DriverBuildPayloadOptions): GenerationPayload;
    generate(payload: GenerationPayload, onProgress?: (progress: {
        percent: number;
        nodeName?: string;
        previewBlob?: Blob;
    }) => void): Promise<{
        imageBlobs: Blob[];
        metadata: Record<string, unknown>;
    }>;
}
//# sourceMappingURL=openai-driver.d.ts.map