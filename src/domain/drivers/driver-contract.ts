/**
 * @module domain/drivers/driver-contract
 * @description 生图后端驱动抽象接口与多模态 Payload 数据定义 (IDrawDriver, GenerationPayload)
 */

export interface CommonGenParams {
    seed: number;
    steps: number;
    cfgScale: number;
    samplerName: string;
    scheduler?: string;
    width: number;
    height: number;
}

export type GenerationPayload =
    | {
          mode: 'txt2img';
          prompt: string;
          negativePrompt: string;
          params: CommonGenParams;
      }
    | {
          mode: 'inpaint';
          prompt: string;
          negativePrompt: string;
          params: CommonGenParams;
          initImageBlob: Blob;
          maskImageBlob: Blob;
          denoiseStrength: number;
      };

export interface ComfyWorkflowMapping {
    promptNodeId: string; // 正向提示词节点 ID (CLIPTextEncode)
    negativeNodeId: string; // 负向提示词节点 ID
    samplerNodeId: string; // 采样器节点 ID (KSampler)
    latentNodeId: string; // 尺寸 Latent 节点 ID
    outputNodeId: string; // 输出节点 ID (SaveImage / PreviewImage)
    imageInputNodeId?: string; // 重绘底图输入节点 ID (LoadImage)
    maskInputNodeId?: string; // 重绘遮罩输入节点 ID (LoadImageMask)
}

/**
 * 生图后端驱动抽象接口
 */
export interface IDrawDriver {
    /** 驱动唯一标识 ID (如 'comfyui', 'sdwebui') */
    readonly id: string;
    /** 驱动可读显示名称 */
    readonly name: string;

    /** 检查后端生图服务的连通性 */
    ping(): Promise<boolean>;

    /** 格式化提示词语法 (适配不同生图引擎的权重表达语法) */
    formatPrompt(rawPrompt: string): string;

    /**
     * 执行异步生图流程
     * @param payload 生图参数载荷
     * @param onProgress 进度更新回调函数
     * @returns 生成的图像 Blob 列表与元数据
     */
    generate(
        payload: GenerationPayload,
        onProgress: (progress: { percent: number; nodeName?: string; previewBlob?: Blob }) => void
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }>;

    /** 取消或中断当前正在执行的生图任务 */
    interrupt?(): Promise<void>;
}
