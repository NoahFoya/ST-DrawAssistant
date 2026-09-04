/**
 * @module domain/context
 * @description 领域服务组装容器 (集中组装驱动注册表、任务调度中心与提示词流水线)
 */

import { IDisposable } from '../../common';
import { CoreContext } from '../core/context';
import { Logger } from '../core/logger';
import { AdapterRegistry } from './drivers/adapter-registry';
import { SdWebUIAdapter } from './drivers/sdwebui-adapter';
import { NovelAIAdapter } from './drivers/novelai-adapter';
import { ComfyUIAdapter } from './drivers/comfyui-adapter';
import { CloudAdapter } from './drivers/cloud-adapter';
import { PromptPipeline } from './pipeline/prompt-pipeline';
import { createPipelineHooks } from './pipeline/pipeline-hooks';
import { TaskManager } from './task/task-manager';

export interface DomainContextOptions {
    core: CoreContext;
}

/**
 * 领域服务容器类
 * 负责集中实例化生图后端驱动、任务调度管理器与流水线，
 * 并在扩展卸载时协调释放所有受管业务资源。
 */
export class DomainContext implements IDisposable {
    public readonly adapters: AdapterRegistry;
    public readonly pipeline: PromptPipeline;
    public readonly tasks: TaskManager;
    private readonly _core: CoreContext;
    private readonly _logger = new Logger('DomainContext');
    private _isDisposed = false;

    constructor(options: DomainContextOptions) {
        this._core = options.core;

        this.adapters = new AdapterRegistry();
        this.registerDefaultAdapters();

        const hooks = createPipelineHooks();
        this.pipeline = new PromptPipeline(hooks);

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
    }

    /**
     * 注册默认的内置后端驱动适配器
     * 通过闭包动态读取各个引擎在 store 中的配置，解耦具体后端的内部参数变化
     */
    private registerDefaultAdapters(): void {
        const store = this._core.store;
        const network = this._core.network;

        // SD-WebUI 适配器
        const sdWebUi = new SdWebUIAdapter({
            network,
            driverName: 'SdWebUI',
            getEndpointUrl: () => {
                const cfg = store.getEngineConfig<Record<string, string>>('sdwebui');
                return cfg?.['serverUrl'] || 'http://127.0.0.1:7860';
            },
            getConfig: () => store.getEngineConfig('sdwebui')
        });
        this.adapters.register(sdWebUi);

        // NovelAI 适配器
        const novelai = new NovelAIAdapter({
            network,
            driverName: 'NovelAI',
            getEndpointUrl: () => {
                const cfg = store.getEngineConfig<Record<string, string>>('novelai');
                return cfg?.['serverUrl'] || cfg?.['proxyUrl'] || 'https://image.novelai.net';
            },
            getConfig: () => store.getEngineConfig('novelai')
        });
        this.adapters.register(novelai);

        // ComfyUI 适配器
        const comfyui = new ComfyUIAdapter({
            network,
            driverName: 'ComfyUI',
            getEndpointUrl: () => {
                const cfg = store.getEngineConfig<Record<string, string>>('comfyui');
                return cfg?.['serverUrl'] || 'http://127.0.0.1:8188';
            },
            getConfig: () => store.getEngineConfig('comfyui')
        });
        this.adapters.register(comfyui);

        // 云端多模态适配器
        const cloud = new CloudAdapter({
            network,
            driverName: 'CloudAdapter',
            getEndpointUrl: () => {
                const cfg = store.getEngineConfig<Record<string, string>>('cloud');
                return cfg?.['proxyUrl'] || 'https://generativelanguage.googleapis.com';
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
        this._logger.info('正在释放 Domain 领域层所有受管资源...');

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
