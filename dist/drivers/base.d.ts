/**
 * @module drivers/base
 * @description BaseDriver 抽象基类
 *
 * 封装所有驱动共用的基础逻辑：
 * - URL 拼接与规范化
 * - 通用 HTTP 请求方法（含超时控制与 Fetch API 封装）
 * - 取消状态管理
 * - 统一错误包装
 *
 * 规范参考：
 * - .agents/Skills/st-image-generation-patterns/SKILL.md (ImageDriver 统一接口模式)
 */
import { type ConnectionInfo, type GenerateOptions, type GenerateResult, type ImageDriver, type ProgressCallback } from './types';
import type { DrawAssistantSettings } from '../settings/types';
export declare abstract class BaseDriver implements ImageDriver {
    abstract readonly name: string;
    protected readonly settings: DrawAssistantSettings;
    /**
     * 取消标志：true 表示当前任务已被要求取消
     */
    protected _cancelled: boolean;
    /**
     * 当前请求的 AbortController
     *
     * 设计说明：此实例属性由 `resetCancelState()` 赋値，由子类的 `cancel()` 提前中止。
     * 注意：`request()` 方法内部使用局部的 `new AbortController()` 做超时控制，
     * 而非此实例属性——因此此属性只用于子类主动 abort()，无法取消运行中的 request() 调用。
     * 如需支持主动取消 HTTP 请求，应将 `request()` 改为使用此属性并在 cancel() 中中止。
     */
    protected _abortController: AbortController | null;
    constructor(settings: DrawAssistantSettings);
    abstract checkConnection(): Promise<ConnectionInfo>;
    abstract generate(options: GenerateOptions, onProgress?: ProgressCallback): Promise<GenerateResult>;
    abstract getSamplers(): Promise<string[]>;
    /**
     * 取消当前生成任务
     * 同时中止 fetch 请求并设置取消标志
     */
    cancel(): void;
    /**
     * 重置取消状态（在新任务开始前调用）
     */
    protected resetCancelState(): void;
    /**
     * 检查是否已被取消，若是则抛出 CANCELLED 错误
     */
    protected checkCancelled(): void;
    /**
     * 将路径拼接到 serverUrl，自动处理末尾斜杠
     *
     * @param path API 路径（如 '/api/generate'）
     * @returns 完整 URL
     */
    protected buildUrl(path: string): string;
    /**
     * 发起 GET 请求并返回 JSON 响应
     *
     * @param path API 路径
     * @param timeoutMs 超时时间（毫秒），默认使用 settings.requestTimeout
     * @returns 解析后的 JSON 数据
     * @throws {DriverError} 网络错误、超时、HTTP 错误等
     */
    protected getJson<T = unknown>(path: string, timeoutMs?: number, headers?: Record<string, string>): Promise<T>;
    /**
     * 发起 POST 请求并返回 JSON 响应
     *
     * @param path API 路径
     * @param body 请求体（将被 JSON 序列化）
     * @param timeoutMs 超时时间（毫秒）
     * @param headers 可选的额外 HTTP 请求头
     */
    protected postJson<T = unknown>(path: string, body: unknown, timeoutMs?: number, headers?: Record<string, string>): Promise<T>;
    /**
     * 通用 HTTP 请求方法
     */
    private request;
}
//# sourceMappingURL=base.d.ts.map