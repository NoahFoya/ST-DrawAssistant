/**
 * 绘图服务提供方抽象基类。
 *
 * @remarks
 * 为具体生图后端驱动（SD-WebUI、ComfyUI、NovelAI、OpenAI 等）提供通用通信能力：
 * - 依赖注入管理：统一持有 HTTP 客户端与配置中心实例；
 * - 基础环境参数：按需实时从配置中心读取通信通道（Direct/Relay）与单任务超时时限；
 * - 统一网络通信：封装 fetchWithTransport 方法，自动装配通信通道并委托 HTTP 客户端执行；
 * - 通用异步辅助：提供基础 URL 尾斜杠规整与带中止信号的安全延迟能力。
 */

import type {
    GenerationProvider,
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    TransportMode,
    TaskProgressCallback,
} from '@types';
import { httpClient, type HttpClient, type HttpRequestOptions } from '../util/http-client';
import { type SettingsStore, settingsStore, DEFAULT_TASK_TIMEOUT_MS } from '../store/settings-store';

/** 提供方基础依赖配置项（主要用于测试隔离与依赖替换） */
export interface BaseProviderOptions {
    /** 自定义 HTTP 客户端实例，缺省使用全局单例 */
    httpClient?: HttpClient;
    /** 自定义配置中心实例，缺省使用全局单例 */
    settingsStore?: SettingsStore;
}

/**
 * 绘图服务提供方抽象基类。
 */
export abstract class BaseGenerationProvider implements GenerationProvider {
    public abstract readonly providerType: ProviderType;
    public abstract readonly name: string;

    protected readonly _httpClient: HttpClient;
    protected readonly _settingsStore?: SettingsStore;

    protected constructor(options: BaseProviderOptions = {}) {
        this._httpClient = options.httpClient ?? httpClient;
        this._settingsStore = 'settingsStore' in options ? options.settingsStore : settingsStore;
    }

    /**
     * 检查服务连通性与健康状态。
     *
     * @param signal 中止信号
     */
    public abstract checkHealth(signal?: AbortSignal): Promise<ProviderHealthResult>;

    /**
     * 执行图像生成任务。
     *
     * @param request 生图请求参数
     * @param onProgress 进度与状态回调
     * @param signal 中止信号
     */
    public abstract generate(
        request: GenerationRequest,
        onProgress?: TaskProgressCallback,
        signal?: AbortSignal
    ): Promise<GenerationResult>;

    /**
     * 发现或获取可用模型列表（可选能力）。
     *
     * @param signal 中止信号
     */
    public fetchModels?(signal?: AbortSignal): Promise<string[]>;

    /**
     * 获取当前环境配置的有效通信传输通道。
     *
     * @remarks
     * 实时读取配置中心 settingsStore.get('transport')，
     * 缺省使用默认值 'direct'。
     */
    protected getTransport(): TransportMode {
        const store = this._settingsStore ?? settingsStore;
        if (store && typeof store.get === 'function') {
            const configured = store.get('transport');
            if (configured) {
                return configured;
            }
        }
        return 'direct';
    }

    /**
     * 获取当前环境配置的单任务超时时限（毫秒）。
     *
     * @remarks
     * 实时读取配置中心 settingsStore.get('taskTimeoutMs')，
     * 缺省使用系统默认常量 DEFAULT_TASK_TIMEOUT_MS。
     */
    protected getTimeoutMs(): number {
        const store = this._settingsStore ?? settingsStore;
        if (store && typeof store.get === 'function') {
            const storeTimeout = store.get('taskTimeoutMs');
            if (typeof storeTimeout === 'number' && storeTimeout > 0) {
                return storeTimeout;
            }
        }
        return DEFAULT_TASK_TIMEOUT_MS;
    }

    /**
     * 使用指定或默认的通信通道发送 HTTP 请求。
     *
     * @remarks
     * 委托全局 HttpClient 执行底层网络请求：
     * - 通道决策：未显式指定时，实时从 SettingsStore 获取当前激活通道 (getTransport())；
     * - 直连模式 (direct)：由浏览器直接向本地或远程服务端发起 fetch，自动享受本地回环 loopback 的 Mixed Content 豁免；
     * - 中继模式 (relay)：通过 SillyTavern 宿主后端中转，自动装配并合并宿主 CSRF 请求头；
     * - 瞬态重试：对 408/429/502/503/504 等网络状态码执行带随机抖动的指数退避重试。
     *
     * @param url 请求目标地址
     * @param init 请求配置项
     * @param transport 可选传输模式，未指定时遵循 getTransport()
     * @returns 响应 Promise
     */
    protected async fetchWithTransport(
        url: string,
        init: HttpRequestOptions,
        transport?: TransportMode
    ): Promise<Response> {
        const effectiveTransport = transport ?? this.getTransport();
        if (typeof this._httpClient?.fetch === 'function') {
            return this._httpClient.fetch(url, { ...init, transport: effectiveTransport });
        }
        if (effectiveTransport === 'relay') {
            return this._httpClient.fetchHost(url, init);
        }
        return this._httpClient.fetchExternal(url, init);
    }

    /**
     * 标准化服务基础地址，去除末尾连续斜杠。
     *
     * @param url 待规整的 URL 字符串
     * @returns 末尾不含斜杠的标准基础地址
     */
    protected normalizeUrl(url: string): string {
        return url.replace(/\/+$/, '');
    }

    /**
     * 支持 AbortSignal 的安全延迟等待。
     *
     * @remarks
     * 1. 信号前置检查：若传入的 signal 已处于 aborted 状态，立即抛出 AbortError；
     * 2. 定时完成即时解绑：定时器到期时解绑 abort 监听，防止轮询场景下事件累积造成泄漏；
     * 3. 中止即刻清理：收到 abort 信号时立即清理定时器并抛出 DOMException。
     *
     * @param ms 等待时间（毫秒）
     * @param signal 中止信号
     */
    protected sleep(ms: number, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                return reject(new DOMException('Aborted', 'AbortError'));
            }

            const timer = setTimeout(() => {
                if (signal) {
                    signal.removeEventListener('abort', onAbort);
                }
                resolve();
            }, ms);

            const onAbort = () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            };

            if (signal) {
                signal.addEventListener('abort', onAbort, { once: true });
            }
        });
    }
}
