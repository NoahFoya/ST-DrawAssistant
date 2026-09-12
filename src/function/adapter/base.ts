/**
 * 引擎适配器轻量抽象基类
 * 遵循 browser-network-api 与 st-image-gen 规范。
 * 提供基础属性持有、执行耗时统计与基础连通性探测。
 */

import type { EngineCapabilities, EngineType, ImageGenerationParams, ImageGenerationResult, HealthCheckResult, IEngineAdapter } from '@types';
import { HttpClient } from '../../util/http';
import { Logger } from '../../util/logger';

export abstract class BaseAdapter implements IEngineAdapter {
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
     * 计算自 startTime 以来的毫秒耗时
     */
    protected measureDuration(startTime: number): number {
        return Math.max(1, Math.round(performance.now() - startTime));
    }

    /**
     * 执行生图任务抽象方法，由各引擎根据自身协议实现
     */
    public abstract generate(
        params: ImageGenerationParams,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult>;

    /**
     * 主动中止作业（若引擎协议支持）
     */
    public interrupt?(jobId?: string): Promise<void>;
}
