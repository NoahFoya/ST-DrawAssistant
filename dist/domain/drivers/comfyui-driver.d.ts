/**
 * @module domain/drivers/comfyui-driver
 * @description ComfyUI 生图后端驱动 (支持多 Loader 模型聚合、WebSocket 节点解复用、动态插槽与 Inpaint 上传)
 */
import { IDrawDriver, GenerationPayload } from './driver-contract';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
export declare class ComfyUIDriver implements IDrawDriver {
    readonly id = "comfyui";
    readonly name = "ComfyUI";
    private readonly _store;
    private readonly _logger;
    private readonly _clientId;
    private _activeWs;
    /** /object_info 内存缓存 (TTL: 5分钟) */
    private readonly _objectInfoCache;
    private readonly _objectInfoTTL;
    constructor(store: ObservableStore<DrawAssistantSettings>);
    ping(): Promise<boolean>;
    formatPrompt(rawPrompt: string): string;
    /**
     * 获取缓存的 /object_info/{nodeClass}
     */
    private getCachedObjectInfo;
    /**
     * 获取聚合的主模型列表 (合并 CheckpointLoaderSimple + UNETLoader + DiffusionModelLoader)
     */
    getModels(): Promise<string[]>;
    /**
     * 获取 CLIP 文本编码器模型列表
     */
    getClips(): Promise<string[]>;
    /**
     * 获取 VAE 解码器模型列表
     */
    getVaes(): Promise<string[]>;
    /**
     * 获取 LoRA 模型列表
     */
    getLoras(): Promise<string[]>;
    /**
     * 获取采样算法 (Sampler) 列表
     */
    getSamplers(): Promise<string[]>;
    /**
     * 获取调度器 (Scheduler) 列表
     */
    getSchedulers(): Promise<string[]>;
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
    private uploadImage;
    private submitPrompt;
    private fetchResultImages;
    private injectWorkflowParameters;
}
//# sourceMappingURL=comfyui-driver.d.ts.map