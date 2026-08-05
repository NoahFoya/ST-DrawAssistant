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


import {
    DriverError,
    DriverErrorType,
    type ConnectionInfo,
    type GenerateOptions,
    type GenerateResult,
    type ImageDriver,
    type ProgressCallback,
} from './types';
import type { DrawAssistantSettings } from '../settings/types';

export abstract class BaseDriver implements ImageDriver {
    abstract readonly name: string;

    protected readonly settings: DrawAssistantSettings;

    /**
     * 取消标志：true 表示当前任务已被要求取消
     */
    protected _cancelled = false;

    /**
     * 当前请求的 AbortController
     *
     * 设计说明：此实例属性由 `resetCancelState()` 赋値，由子类的 `cancel()` 提前中止。
     * 注意：`request()` 方法内部使用局部的 `new AbortController()` 做超时控制，
     * 而非此实例属性——因此此属性只用于子类主动 abort()，无法取消运行中的 request() 调用。
     * 如需支持主动取消 HTTP 请求，应将 `request()` 改为使用此属性并在 cancel() 中中止。
     */
    protected _abortController: AbortController | null = null;

    constructor(settings: DrawAssistantSettings) {
        this.settings = settings;
    }

    // ─── 抽象方法（子类必须实现） ────────────────────────────────────────────

    abstract checkConnection(): Promise<ConnectionInfo>;
    abstract generate(options: GenerateOptions, onProgress?: ProgressCallback): Promise<GenerateResult>;
    abstract getSamplers(): Promise<string[]>;

    // ─── 取消控制 ────────────────────────────────────────────────────────────

    /**
     * 取消当前生成任务
     * 同时中止 fetch 请求并设置取消标志
     */
    cancel(): void {
        this._cancelled = true;
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    /**
     * 重置取消状态（在新任务开始前调用）
     */
    protected resetCancelState(): void {
        this._cancelled = false;
        this._abortController = new AbortController();
    }

    /**
     * 检查是否已被取消，若是则抛出 CANCELLED 错误
     */
    protected checkCancelled(): void {
        if (this._cancelled) {
            throw new DriverError(DriverErrorType.CANCELLED, 'Task was cancelled by user');
        }
    }

    // ─── URL 工具 ─────────────────────────────────────────────────────────────

    /**
     * 将路径拼接到 serverUrl，自动处理末尾斜杠
     *
     * @param path API 路径（如 '/api/generate'）
     * @returns 完整 URL
     */
    protected buildUrl(path: string): string {
        const base = this.settings.serverUrl.replace(/\/+$/, '');
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return `${base}${normalizedPath}`;
    }

    // ─── HTTP 请求工具 ────────────────────────────────────────────────────────

    /**
     * 发起 GET 请求并返回 JSON 响应
     *
     * @param path API 路径
     * @param timeoutMs 超时时间（毫秒），默认使用 settings.requestTimeout
     * @returns 解析后的 JSON 数据
     * @throws {DriverError} 网络错误、超时、HTTP 错误等
     */
    protected async getJson<T = unknown>(path: string, timeoutMs?: number, headers?: Record<string, string>): Promise<T> {
        return this.request<T>('GET', path, undefined, timeoutMs, headers);
    }

    /**
     * 发起 POST 请求并返回 JSON 响应
     *
     * @param path API 路径
     * @param body 请求体（将被 JSON 序列化）
     * @param timeoutMs 超时时间（毫秒）
     * @param headers 可选的额外 HTTP 请求头
     */
    protected async postJson<T = unknown>(
        path: string,
        body: unknown,
        timeoutMs?: number,
        headers?: Record<string, string>
    ): Promise<T> {
        return this.request<T>('POST', path, body, timeoutMs, headers);
    }

    /**
     * 通用 HTTP 请求方法
     */
    private async request<T>(
        method: string,
        path: string,
        body?: unknown,
        timeoutMs?: number,
        headers?: Record<string, string>
    ): Promise<T> {
        const url = this.buildUrl(path);
        const timeout = timeoutMs ?? this.settings.requestTimeout;

        this.checkCancelled();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.settings.apiKey
                        ? { Authorization: `Bearer ${this.settings.apiKey}` }
                        : {}),
                    ...(headers ?? {}),
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new DriverError(
                    DriverErrorType.BACKEND_ERROR,
                    `HTTP ${response.status}: ${response.statusText} [${url}]`
                );
            }

            return (await response.json()) as T;
        } catch (err) {
            clearTimeout(timeoutId);

            if (err instanceof DriverError) throw err;

            if (err instanceof DOMException && err.name === 'AbortError') {
                if (this._cancelled) {
                    throw new DriverError(DriverErrorType.CANCELLED, 'Request cancelled');
                }
                throw new DriverError(
                    DriverErrorType.TIMEOUT,
                    `Request timed out after ${timeout}ms [${url}]`,
                    err
                );
            }

            throw new DriverError(
                DriverErrorType.NETWORK_ERROR,
                `Network error for ${url}: ${err instanceof Error ? err.message : String(err)}`,
                err
            );
        }
    }
}
