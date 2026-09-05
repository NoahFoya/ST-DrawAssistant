/**
 * @module domain/context
 * @description 领域服务容器 (组装驱动注册表、任务管理器与提示词流水线)
 */

import { IDisposable } from '../../common';
import { CoreContext } from '../core/context';
import { Logger } from '../core/logger';
import { AdapterRegistry } from './drivers/adapter-registry';
import { SdWebUIAdapter, DEFAULT_SDWEBUI_CONFIG, SdWebUIEngineConfig } from './drivers/sdwebui-adapter';
import { NovelAIAdapter, DEFAULT_NOVELAI_CONFIG, NovelAIEngineConfig } from './drivers/novelai-adapter';
import { ComfyUIAdapter, DEFAULT_COMFYUI_CONFIG, ComfyUIEngineConfig } from './drivers/comfyui-adapter';
import { CloudAdapter, DEFAULT_CLOUD_CONFIG, CloudEngineConfig } from './drivers/cloud-adapter';
import { PromptPipeline } from './pipeline/prompt-pipeline';
import { PipelineHooks } from './pipeline/pipeline-hooks';
import { TaskManager, ResultIntegrator } from './task';

export interface DomainContextOptions {
    core: CoreContext;
}

/**
 * 领域服务容器
 * 负责初始化各生图驱动、任务调度器与流水线，并在扩展卸载时释放资源
 */
export class DomainContext implements IDisposable {
    public readonly adapters: AdapterRegistry;
    public readonly pipeline: PromptPipeline;
    public readonly tasks: TaskManager;
    public readonly results: ResultIntegrator;
    private readonly _core: CoreContext;
    private readonly _logger = new Logger('DomainContext');
    private _isDisposed = false;

    /** 访问底层提示词流水线生命周期钩子容器，供外部扩展模块 (如角色管理扩展) 按需挂载 */
    public get hooks(): PipelineHooks {
        return this.pipeline.hooks;
    }

    constructor(options: DomainContextOptions) {
        this._core = options.core;

        this.adapters = new AdapterRegistry();
        this.registerDefaultAdapters();

        // 初始化插件本体基础提示词流水线
        this.pipeline = new PromptPipeline();

        this.tasks = new TaskManager({
            adapters: this.adapters,
            events: this._core.events,
            getConfig: () => {
                const settings = this._core.store.getState();
                return {
                    maxConcurrentTasks: settings.maxConcurrentTasks,
                    taskTimeoutMs: settings.taskTimeoutMs,
                    activeProvider: settings.activeProvider
                };
            }
        });

        // 监听任务结果并进行保存或展示
        this.results = new ResultIntegrator({
            events: this._core.events,
            storage: this._core.storage,
            host: this._core.host,
            tasks: this.tasks,
            getSettings: () => this._core.store.getState()
        });
    }

    /**
     * 注册内置生图驱动并注入默认配置
     */
    private registerDefaultAdapters(): void {
        const store = this._core.store;
        const network = this._core.network;

        // 注入各适配器的默认配置
        store.registerEngineDefaults('sdwebui', DEFAULT_SDWEBUI_CONFIG);
        store.registerEngineDefaults('novelai', DEFAULT_NOVELAI_CONFIG);
        store.registerEngineDefaults('comfyui', DEFAULT_COMFYUI_CONFIG);
        store.registerEngineDefaults('cloud', DEFAULT_CLOUD_CONFIG);

        // SD-WebUI 适配器
        const sdWebUi = new SdWebUIAdapter({
            network,
            driverName: 'SdWebUI',
            getEndpointUrl: () => {
                const cfg = store.getEngineConfig<SdWebUIEngineConfig>('sdwebui');
                return cfg?.serverUrl || DEFAULT_SDWEBUI_CONFIG.serverUrl;
            },
            getConfig: () => store.getEngineConfig('sdwebui')
        });
        this.adapters.register(sdWebUi);

        // NovelAI 适配器
        const novelai = new NovelAIAdapter({
            network,
            driverName: 'NovelAI',
            getEndpointUrl: () => {
                const cfg = store.getEngineConfig<NovelAIEngineConfig>('novelai');
                return cfg?.serverUrl || DEFAULT_NOVELAI_CONFIG.serverUrl;
            },
            getConfig: () => store.getEngineConfig('novelai')
        });
        this.adapters.register(novelai);

        // ComfyUI 适配器
        const comfyui = new ComfyUIAdapter({
            network,
            driverName: 'ComfyUI',
            getEndpointUrl: () => {
                const cfg = store.getEngineConfig<ComfyUIEngineConfig>('comfyui');
                return cfg?.serverUrl || DEFAULT_COMFYUI_CONFIG.serverUrl;
            },
            getConfig: () => store.getEngineConfig('comfyui')
        });
        this.adapters.register(comfyui);

        // 云端多模态适配器
        const cloud = new CloudAdapter({
            network,
            driverName: 'CloudAdapter',
            getEndpointUrl: () => {
                const cfg = store.getEngineConfig<CloudEngineConfig>('cloud');
                return cfg?.proxyUrl || DEFAULT_CLOUD_CONFIG.proxyUrl;
            },
            getConfig: () => store.getEngineConfig('cloud')
        });
        this.adapters.register(cloud);
    }

    /**
     * 释放所有领域服务资源
     * 包含终止未完成任务、注销所有适配器并清理定时器
     */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._logger.info('正在释放领域层资源...');

        try {
            this.results.dispose();
        } catch (err) {
            this._logger.error('释放 ResultIntegrator 异常', err);
        }

        try {
            this.tasks.dispose();
        } catch (err) {
            this._logger.error('释放 TaskManager 异常', err);
        }

        try {
            this.adapters.dispose();
        } catch (err) {
            this._logger.error('释放 AdapterRegistry 异常', err);
        }

        try {
            this.pipeline.dispose();
        } catch (err) {
            this._logger.error('释放 PromptPipeline 异常', err);
        }
    }
}

/** 创建领域服务容器实例 */
export function createDomainContext(options: DomainContextOptions): DomainContext {
    return new DomainContext(options);
}
