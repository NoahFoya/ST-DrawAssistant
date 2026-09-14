/**
 * 引擎适配器轻量抽象基类 (BaseAdapter)
 *
 * 核心功能：
 * 1. 声明各绘图后端适配器的标准接口定义（生图执行、任务中断、健康探测与远端资产同步）；
 * 2. 统一管理后端服务地址 (baseUrl)、HTTP 通信客户端与模块日志记录器；
 * 3. 封装请求传输通道（直连与代理中转）的参数装配逻辑。
 *
 * 注意事项：
 * 1. 子类在实现具体生图逻辑时，必须正确传递并监听 AbortSignal 取消信号；
 * 2. 各适配器产出的图像数据均需清洗规范为统一直观的 ImageGenerationResult 结构。
 */

import type { EngineCapabilities, EngineType, ImageGenerationParams, ImageGenerationResult, HealthCheckResult, IEngineAdapter, TransportMode } from '@types';
import { HttpClient, type HttpRequestOptions } from '../../util/http';
import { Logger } from '../../util/logger';

export abstract class BaseAdapter<TParams extends ImageGenerationParams = ImageGenerationParams> implements IEngineAdapter<TParams> {
    public abstract readonly id: EngineType;
    public abstract readonly name: string;
    public abstract readonly capabilities: EngineCapabilities;

    protected readonly logger: Logger;
    protected readonly httpClient: HttpClient;
    protected baseUrl: string;

    constructor(baseUrl = '', httpClient?: HttpClient) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.httpClient = httpClient ?? new HttpClient();
        this.logger = new Logger(`Adapter:${this.constructor.name}`);
    }

    /** 更新适配器基础服务地址 */
    public setBaseUrl(url: string): void {
        this.baseUrl = url.replace(/\/+$/, '');
    }

    /** 获取当前服务基础地址 */
    public getBaseUrl(): string {
        return this.baseUrl;
    }

    /** 获取引擎默认配置 */
    public getDefaultConfig(): Record<string, unknown> {
        return {
            baseUrl: this.baseUrl
        };
    }

    /**
     * 通用连通性探测基础实现
     */
    public async checkHealth(signal?: AbortSignal): Promise<HealthCheckResult> {
        if (!this.baseUrl) {
            return { ok: false, message: '服务地址未配置' };
        }
        const start = performance.now();
        const probe = await this.httpClient.probeEndpoint(this.baseUrl, { signal });
        const latencyMs = Math.round(performance.now() - start);

        return {
            ok: probe.ok,
            latencyMs,
            message: probe.ok ? '服务连接正常' : (probe.error || `HTTP ${probe.status}`)
        };
    }

    /**
     * 连通性探测与远端资产拉取默认实现 (子类可覆盖提供深度资产同步)
     */
    public async fetchAssets(signal?: AbortSignal, _options?: Record<string, unknown>): Promise<HealthCheckResult> {
        return this.checkHealth(signal);
    }

    /**
     * 依据传输模式与安全上下文发起网络请求
     * 当 transport 为 'relay' 或触发混合内容风险时，经由宿主后端发起请求 (fetchHost) 自动注入 CSRF 凭据；
     * 否则使用浏览器直连 (fetchExternal)。
     */
    protected async fetchWithTransport(
        url: string,
        options: HttpRequestOptions = {},
        transport?: TransportMode
    ): Promise<Response> {
        const mode = transport || 'direct';
        const isRelay = mode === 'relay' || (mode === 'auto' && this.httpClient.isMixedContent(url));

        if (isRelay) {
            return this.httpClient.fetchHost(url, options);
        }
        return this.httpClient.fetchExternal(url, options);
    }

    /**
     * 计算自 startTime 以来的毫秒耗时
     */
    protected measureDuration(startTime: number): number {
        return Math.max(1, Math.round(performance.now() - startTime));
    }

    /**
     * 执行生图任务抽象方法，由各引擎根据自身协议实现
     */
    public abstract generate(
        params: TParams,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult>;

    /**
     * 主动中止作业（若引擎协议支持）
     */
    public interrupt?(jobId?: string): Promise<void>;
}
