/**
 * @module domain/pipeline/pipeline-hooks
 * @description 提示词流水线拦截钩子与实现 (PipelineHooks, AsyncSeriesWaterfallHook)
 */
import { IDisposable } from '../../core/foundation/disposable';
import { GenerationPayload, PipelineHookContext, IPipelineHooksContract } from '../../core/contracts';
export type { PipelineHookContext } from '../../core/contracts';
export type HookCallback<T, C> = (data: T, context: C) => Promise<T> | T;
/**
 * 异步串行瀑布钩子执行器
 * 按 priority 降序排序所有注册的钩子，依次执行，每个钩子的输出作为下一个钩子的输入
 */
export declare class AsyncSeriesWaterfallHook<T, C = PipelineHookContext> {
    private readonly _taps;
    tap(id: string, fn: HookCallback<T, C>, priority?: number): IDisposable;
    call(initialData: T, context: C): Promise<T>;
}
export interface PipelineHooks extends IPipelineHooksContract {
    /** 阶段 1：原始文本清洗前阶段钩子 */
    readonly beforeClean: AsyncSeriesWaterfallHook<string, PipelineHookContext>;
    /** 阶段 2：提示词组装前阶段钩子 (通用扩展挂载点，支持自定义宏替换与标签注入) */
    readonly beforePromptBuild: AsyncSeriesWaterfallHook<string, PipelineHookContext>;
    /** 阶段 3：派发生图驱动前的最终 Payload 终态拦截阶段钩子 */
    readonly beforeSubmit: AsyncSeriesWaterfallHook<GenerationPayload, PipelineHookContext>;
}
export declare function createPipelineHooks(): PipelineHooks;
//# sourceMappingURL=pipeline-hooks.d.ts.map