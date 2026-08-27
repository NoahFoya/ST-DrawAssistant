/**
 * @module ui/media/image-info-panel
 * @description 图像详细元数据查看面板 (ImageInfoPanel)
 */
export interface ImageMetadata {
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    model?: string;
    samplerName?: string;
    scheduler?: string;
    timestamp?: number;
    [key: string]: unknown;
}
export declare function openImageInfoPanel(imageIdOrMeta: any, meta?: any): Promise<void>;
//# sourceMappingURL=image-info-panel.d.ts.map