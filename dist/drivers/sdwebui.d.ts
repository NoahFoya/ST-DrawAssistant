/**
 * @module drivers/sdwebui
 * @description Automatic1111 Stable Diffusion WebUI 驱动适配器
 *
 * 封装与 SD WebUI API (/sdapi/v1/*) 的通信协议，履行 ImageDriver 标准契约。
 */
import { BaseDriver } from './base';
import { type ConnectionInfo, type GenerateOptions, type GenerateResult, type ProgressCallback } from './types';
export declare class SDWebUIDriver extends BaseDriver {
    readonly name = "sd-webui";
    /**
     * 测量 SD WebUI 服务器连通性与响应延迟
     *
     * @returns 包含连通状态与延迟毫秒数的 ConnectionInfo
     */
    checkConnection(): Promise<ConnectionInfo>;
    /**
     * 提交文生图任务至 SD WebUI (POST /sdapi/v1/txt2img) 并持续轮询任务进度
     *
     * @param options 完整的生图参数配置
     * @param onProgress 任务进度实时回调函数
     * @returns 包含 Base64/Blob 图像与实际 Seed 的 GenerateResult
     */
    generate(options: GenerateOptions, onProgress?: ProgressCallback): Promise<GenerateResult>;
    /**
     * 取消当前任务并发送 /sdapi/v1/interrupt 中断请求
     */
    cancel(): void;
    /**
     * 获取支持的采样器列表 (/sdapi/v1/samplers)
     */
    getSamplers(): Promise<string[]>;
    /**
     * 获取支持的模型列表 (/sdapi/v1/sd-models)
     */
    getModels(): Promise<string[]>;
}
//# sourceMappingURL=sdwebui.d.ts.map