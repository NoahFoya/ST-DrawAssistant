/**
 * BaseDriver 抽象基类
 *
 * 封装所有驱动共用的基础逻辑：
 * - URL 拼接与规范化
 * - 通用 HTTP 请求方法（含超时控制）
 * - 取消状态管理
 * - 统一错误包装
 *
 * 具体后端驱动（ComfyUIDriver、WebUIDriver 等）继承此类并实现抽象方法。
 */
import { type ConnectionInfo, type GenerateOptions, type GenerateResult, type ImageDriver, type ProgressCallback } from './types';
import type { DrawAssistantSettings } from '../settings/types';
export declare abstract class BaseDriver implements ImageDriver {
    abstract readonly name: string;
    protected readonly settings: DrawAssistantSettings;
    /** 取消标志：true 表示当前任务已被要求取消 */
    protected _cancelled: boolean;
    /** 当前请求的 AbortController（用于取消 fetch） */
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
    protected getJson<T = unknown>(path: string, timeoutMs?: number): Promise<T>;
    /**
     * 发起 POST 请求并返回 JSON 响应
     *
     * @param path API 路径
     * @param body 请求体（将被 JSON 序列化）
     * @param timeoutMs 超时时间（毫秒）
     */
    protected postJson<T = unknown>(path: string, body: unknown, timeoutMs?: number): Promise<T>;
    /**
     * 通用 HTTP 请求方法
     */
    private request;
}
//# sourceMappingURL=base.d.ts.map