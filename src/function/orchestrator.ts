/**
 * 生图任务编排执行器 (GenerationOrchestrator)
 * 职责：作为连接任务调度队列、提示词装配流水线、后端引擎适配器与持久化整合器的核心执行中枢。
 * 遵循 st-image-gen、st-extension 与 browser-network-api 规范。
 */

import type {
    EngineType,
    ImageGenerationParams,
    ImageGenerationResult,
    TaskItem,
    TransportMode
} from '@types';
import { TaskQueueManager } from '../store/task';
import { ResultIntegrator } from '../store/integrator';
import { SettingsStore } from '../store/settings';
import { HttpClient } from '../util/http';
import { Logger } from '../util/logger';
import { IDisposable } from '../util/event-bus';
import { processPrompt, type PromptPipelineOptions } from './pipeline/pipeline';
import { getAdapter } from './adapter/registry';

export interface GenerationOrchestratorOptions {
    taskQueue: TaskQueueManager;
    integrator?: ResultIntegrator;
    settingsStore?: SettingsStore;
    httpClient?: HttpClient;
    activeChatIdProvider?: () => string | undefined;
}

export class GenerationOrchestrator implements IDisposable {
    private readonly _logger = new Logger('GenerationOrchestrator');
    private readonly _taskQueue: TaskQueueManager;
    private readonly _integrator?: ResultIntegrator;
    private readonly _settingsStore?: SettingsStore;
    private readonly _httpClient: HttpClient;
    private readonly _activeChatIdProvider?: () => string | undefined;
    private _isDisposed = false;

    constructor(options: GenerationOrchestratorOptions) {
        this._taskQueue = options.taskQueue;
        this._integrator = options.integrator;
        this._settingsStore = options.settingsStore;
        this._httpClient = options.httpClient ?? new HttpClient();
        this._activeChatIdProvider = options.activeChatIdProvider;

        // 注册自身为任务队列的执行器
        this._taskQueue.setExecutor(this.executeTask.bind(this));
    }

    /**
     * 判定当前任务的传输路径 (direct vs relay)
     */
    public resolveTransport(task: TaskItem): TransportMode {
        // 1. 任务显式指定的传输通道优先级最高
        const taskTransport = task.params.transport;
        if (taskTransport && taskTransport !== 'auto') {
            return taskTransport;
        }

        // 2. 其次读取引擎私有配置中的 transport
        const engineConfig = this._settingsStore?.get('engines')?.[task.engine as EngineType];
        const engineTransport = engineConfig?.transport as TransportMode | undefined;
        if (engineTransport && engineTransport !== 'auto') {
            return engineTransport;
        }

        // 3. 读取全局通用参数配置中的 requestMode
        const globalMode = (this._settingsStore?.get('requestMode') as TransportMode | undefined);
        if (globalMode && globalMode !== 'auto') {
            return globalMode;
        }

        // 4. 处理 auto 或默认模式：若触发 Mixed Content 风险则自动回退至 relay
        const backendUrl = this._resolveBackendUrl(task.engine);
        if (backendUrl && this._httpClient.isMixedContent(backendUrl)) {
            return 'relay';
        }

        return 'direct';
    }

    /**
     * 核心生图任务执行管道 (实现 TaskExecutor 接口约定)
     */
    public async executeTask(task: TaskItem, signal: AbortSignal): Promise<ImageGenerationResult> {
        if (this._isDisposed || signal.aborted) {
            throw new Error('任务已被取消');
        }

        // 阶段 1：提示词流水线装配
        const preset = task.params.extraParams?.preset as Record<string, any> | undefined;
        const pipelineOptions: PromptPipelineOptions = {
            rawPrompt: task.params.prompt,
            rawNegativePrompt: task.params.negativePrompt,
            prefix: (preset?.prefix as string) || undefined,
            suffix: (preset?.suffix as string) || undefined,
            defaultNegative: (preset?.defaultNegative as string) || undefined,
            macroReplacements: (preset?.macroReplacements as Record<string, string>) || (preset?.replacements as Record<string, string>) || undefined,
            macroRules: (preset?.macroRules as any) || undefined,
            regexRules: (preset?.regexRules as any) || undefined
        };

        const processed = processPrompt(pipelineOptions);
        const finalPrompt = processed.positivePrompt.trim();
        const finalNegativePrompt = processed.negativePrompt?.trim();

        if (!finalPrompt) {
            throw new Error('生图正向提示词为空，无法发起生成');
        }

        // 阶段 2：传输路由判定与请求参数构建
        const effectiveTransport = this.resolveTransport(task);
        const finalParams: ImageGenerationParams = {
            ...task.params,
            prompt: finalPrompt,
            negativePrompt: finalNegativePrompt,
            transport: effectiveTransport
        };

        // 阶段 3：引擎适配器分发与执行调度
        const adapter = getAdapter(task.engine as EngineType);

        const onProgress = (progress: number) => {
            if (!signal.aborted) {
                this._taskQueue.reportProgress(task.id, progress);
            }
        };

        // 挂载取消监听，尽力而为释放底层算力
        const onAbort = () => {
            if (typeof adapter.interrupt === 'function') {
                adapter.interrupt().catch((err: any) => {
                    this._logger.warn(`中止适配器作业异常: ${err?.message || err}`);
                });
            }
        };
        signal.addEventListener('abort', onAbort, { once: true });

        let result: ImageGenerationResult;
        try {
            result = await adapter.generate(finalParams, onProgress, signal);
        } finally {
            signal.removeEventListener('abort', onAbort);
        }

        // 阶段 4：取消与会话安全性死线检查
        if (signal.aborted) {
            throw new Error('任务已被取消');
        }

        const activeChatId = this._activeChatIdProvider ? this._activeChatIdProvider() : this._resolveActiveChatId();
        if (activeChatId && task.identity.chatId && activeChatId !== task.identity.chatId) {
            this._logger.warn(`会话已切换 (当前会话: ${activeChatId}, 任务归属: ${task.identity.chatId})，已废弃写入聊天楼层`);
            return result;
        }

        // 阶段 5：持久化与楼层数据整合
        if (this._integrator && task.identity.messageId !== undefined) {
            await this._integrator.integrate(task, result);
        }

        return result;
    }

    /**
     * 获取指定引擎的配置服务地址
     */
    private _resolveBackendUrl(engine: string): string {
        const engineSettings = this._settingsStore?.get('engines')?.[engine as EngineType];
        return (engineSettings?.baseUrl as string) || '';
    }

    /**
     * 获取当前 SillyTavern 激活的聊天会话标识
     */
    private _resolveActiveChatId(): string | undefined {
        if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
            return window.SillyTavern.getContext().chatId;
        }
        return undefined;
    }

    public dispose(): void {
        this._isDisposed = true;
    }
}
