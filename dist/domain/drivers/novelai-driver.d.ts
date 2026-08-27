/**
 * @module domain/drivers/novelai-driver
 * @description NovelAI 后端生图驱动实现 (支持 NAI v3/v4 专属模型、SMEA 增强采样与 ZIP 二进制响应解包)
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { BaseDriver } from './base-driver';
import type { GenerationPayload, DriverBuildPayloadOptions, DriverAssetSyncResult } from './driver-contract';
/**
 * 二进制解包：从 NovelAI API 返回的响应 Buffer 中提取图片 Blob
 *
 * 处理流程：
 * 1. 检测原生 PNG 文件头魔数 (0x89 0x50 0x4E 0x47)，若为单张 PNG 则直接封装为 Blob；
 * 2. 检测 ZIP 文件头魔数 (0x50 0x4B 0x03 0x04)，若为 Store 模式 (无压缩) 则根据偏移量提取数据，若为 Deflate 则通过 DecompressionStream 解压；
 * 3. 兜底封装为 PNG 格式 Blob。
 *
 * @param buffer 后端返回的 ArrayBuffer 原始二进制数据
 * @returns 解析提取生成的图片 Blob 对象
 */
export declare function extractImageFromZipBuffer(buffer: ArrayBuffer): Promise<Blob>;
/**
 * 将标准 SD 权重提示词语法转换为 NovelAI 官方花括号/方括号规范语法
 *
 * 转换规则：
 * - (tag:1.x) / (tag) -> {tag}
 * - (tag:0.x) -> [tag]
 *
 * @param prompt 原始提示词文本
 * @returns 符合 NovelAI 规范的提示词文本
 */
export declare function convertToNovelAIPromptSyntax(prompt: string): string;
export declare class NovelAIDriver extends BaseDriver {
    readonly id = "novelai";
    readonly name = "NovelAI";
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
    getSamplers(): Promise<string[]>;
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
//# sourceMappingURL=novelai-driver.d.ts.map