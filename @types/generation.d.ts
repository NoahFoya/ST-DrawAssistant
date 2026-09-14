/**
 * 统一生图参数、响应结果与传输模式类型定义 (@types/generation)
 *
 * 核心功能：
 * 1. 定义生图引擎类型标识 (EngineType) 与网络传输模式 (TransportMode)；
 * 2. 声明统一强类型生图任务输入参数 (ImageGenerationParams) 与标准化生图结果模型 (ImageGenerationResult)；
 * 3. 声明各生图引擎的能力特性矩阵 (EngineCapabilities)。
 *
 * 注意事项：
 * 1. 业务逻辑层与具体引擎实现解耦，统一通过该模块声明的类型进行交互；
 * 2. 传输模式支持 SillyTavern 宿主中继与浏览器直接通信，根据服务地址协议与跨域策略自动判定。
 */

/** 生图引擎类型标识 */
export type EngineType = 'sdwebui' | 'comfyui' | 'novelai' | 'openai';

/**
 * 请求传输方式：
 * - relay: 经由 SillyTavern 宿主后端 /api/sd/... 中继（携带 CSRF 凭据）
 * - direct: 浏览器前端直接调用目标引擎服务地址（支持 WebSocket 实时通知）
 * - auto: 由适配器或配置根据服务地址协议和连通性自动协商
 */
export type TransportMode = 'relay' | 'direct' | 'auto';

import type { EngineGenerationTaskParams } from './engine-data';

/** 统一生图请求参数对象（基于各后端原生结构的强类型判别联合体） */
export type ImageGenerationParams = EngineGenerationTaskParams;

/** 统一格式化生图响应结果 */
export interface ImageGenerationResult {
    /** 图片二进制数据 */
    blob: Blob;
    /** 媒体 MIME 类型，通常为 'image/png' 或 'image/jpeg' */
    mimeType: string;
    /** 实际输出宽度 */
    width: number;
    /** 实际输出高度 */
    height: number;
    /** 实际使用的随机种子 */
    seed: number;
    /** 生图耗时（毫秒） */
    durationMs: number;
    /** 引擎返回的额外原始元数据（如生图信息参数、模型哈希等） */
    metadata?: Record<string, unknown>;
}

/** 引擎能力描述结构 */
export interface EngineCapabilities {
    /** 是否支持文生图 */
    readonly txt2img: boolean;
    /** 是否支持图生图 */
    readonly img2img: boolean;
    /** 是否支持局部重绘 */
    readonly inpaint: boolean;
    /** 是否支持 LoRA 模型参数注入 */
    readonly lora: boolean;
    /** 是否支持生成进度回调轮询或流式推送 */
    readonly progress: boolean;
    /** 是否支持中断正在执行的生图任务 */
    readonly interrupt: boolean;
    /** 是否支持自定义工作流模板注入（如 ComfyUI JSON 蓝图） */
    readonly customWorkflow: boolean;
}
