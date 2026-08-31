/**
 * 引擎适配器接口定义
 */

import type { EngineCapabilities, EngineType, ImageGenerationParams, ImageGenerationResult } from './generation';

/** 服务健康检查结果 */
export interface HealthCheckResult {
    /** 服务是否正常可用 */
    ok: boolean;
    /** 探测延迟（毫秒） */
    latencyMs?: number;
    /** 状态信息或错误描述 */
    message?: string;
    /** 探测获取到的可用模型列表 */
    availableModels?: string[];
}

/** 引擎适配器标准接口 */
export interface IEngineAdapter {
    /** 适配器唯一类型标识 */
    readonly id: EngineType;
    /** 显示名称 */
    readonly name: string;
    /** 能力描述结构 */
    readonly capabilities: EngineCapabilities;

    /** 获取该引擎的默认配置项 */
    getDefaultConfig(): Record<string, unknown>;

    /** 服务可用性与连通性检查 */
    checkHealth(signal?: AbortSignal): Promise<HealthCheckResult>;

    /**
     * 执行生图任务
     * @param params 统一生图参数对象
     * @param onProgress 进度更新回调函数（0.0 ~ 1.0）
     * @param signal 用于中止网络请求或长连接的 AbortSignal
     */
    generate(
        params: ImageGenerationParams,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult>;

    /** 主动中止作业（若引擎支持） */
    interrupt?(jobId?: string): Promise<void>;
}
