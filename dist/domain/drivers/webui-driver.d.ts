/**
 * @module domain/drivers/webui-driver
 * @description SD-WebUI (A1111) 生图后端驱动 (支持 REST 适配、Hires.fix 高清修复、500ms 进度轮询与全局中断)
 */
import { IDrawDriver, GenerationPayload } from './driver-contract';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
export declare class SDWebUIDriver implements IDrawDriver {
    readonly id = "sdwebui";
    readonly name = "SD WebUI";
    private readonly _store;
    private readonly _logger;
    private _isInterrupted;
    constructor(store: ObservableStore<DrawAssistantSettings>);
    ping(): Promise<boolean>;
    formatPrompt(rawPrompt: string): string;
    /**
     * 获取模型列表
     */
    getModels(): Promise<string[]>;
    /**
     * 获取采样算法列表
     */
    getSamplers(): Promise<string[]>;
    generate(payload: GenerationPayload, onProgress: (progress: {
        percent: number;
        nodeName?: string;
        previewBlob?: Blob;
    }) => void): Promise<{
        imageBlobs: Blob[];
        metadata: Record<string, unknown>;
    }>;
    interrupt(): Promise<void>;
    private getBaseUrl;
    private blobToBase64;
    private base64ToBlob;
}
//# sourceMappingURL=webui-driver.d.ts.map