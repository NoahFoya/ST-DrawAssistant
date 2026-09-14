/**
 * 引擎适配器接口定义 (@types/adapter)
 *
 * 核心功能：
 * 1. 声明生图引擎适配器的标准接口规范 (IEngineAdapter)；
 * 2. 声明健康检查与连通性探测结果结构 (HealthCheckResult)；
 * 3. 约束生图执行、任务中断与远端资产同步方法。
 *
 * 注意事项：
 * 1. 接口输入参数泛型必须继承自 ImageGenerationParams；
 * 2. 异步方法需支持通过 AbortSignal 响应外部取消操作。
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
    /** 探测并同步获取到的资产对象 (模型、VAE、LoRA、采样器、账户状态等) */
    assets?: Record<string, unknown>;
    /** 资产拉取结果统计摘要说明 */
    assetsSummary?: string;
}

/** 引擎适配器标准接口 */
export interface IEngineAdapter<TParams extends ImageGenerationParams = ImageGenerationParams> {
    /** 适配器唯一类型标识 */
    readonly id: EngineType;
    /** 显示名称 */
    readonly name: string;
    /** 能力描述结构 */
    readonly capabilities: EngineCapabilities;

    /** 获取该引擎的默认配置项 */
    getDefaultConfig(): Record<string, unknown>;

    /** 更新适配器基础服务地址 */
    setBaseUrl?(url: string): void;

    /** 获取当前服务基础地址 */
    getBaseUrl?(): string;

    /** 服务可用性与连通性检查 */
    checkHealth(signal?: AbortSignal): Promise<HealthCheckResult>;

    /** 服务可用性与远端资产同步拉取 (模型、VAE、LoRA、采样器、订阅状态等) */
    fetchAssets?(signal?: AbortSignal, options?: Record<string, unknown>): Promise<HealthCheckResult>;

    /**
     * 执行生图任务
     * @param params 专属引擎原生生图参数对象
     * @param onProgress 进度更新回调函数（0.0 ~ 1.0）
     * @param signal 用于中止网络请求或长连接的 AbortSignal
     */
    generate(
        params: TParams,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult>;

    /** 主动中断生图任务（若引擎支持） */
    interrupt?(jobId?: string): Promise<void>;
}
