/**
 * @module domain/pipeline/pipeline-hooks
 * @description 提示词流水线拦截钩子与实现 (PipelineHooks, AsyncSeriesWaterfallHook)
 */
import { IDisposable } from '../../core/foundation/disposable';
import { GenerationPayload } from '../drivers/driver-contract';
export interface PipelineHookContext {
    readonly messageId: number;
    readonly chatId: string;
    readonly rawPrompt: string;
    readonly metadata?: Record<string, unknown>;
}
export type HookCallback<T, C> = (data: T, context: C) => Promise<T> | T;
export declare class AsyncSeriesWaterfallHook<T, C = any> {
    private readonly _taps;
    tap(id: string, fn: HookCallback<T, C>, priority?: number): IDisposable;
    call(initialData: T, context: C): Promise<T>;
}
export interface PipelineHooks {
    /** 阶段 1：原始文本清洗前拦截 */
    readonly beforeClean: AsyncSeriesWaterfallHook<string, PipelineHookContext>;
    /** 阶段 2：角色标签、服装与宏规则树展开拦截 (扩展核心挂载点) */
    readonly beforePromptBuild: AsyncSeriesWaterfallHook<string, PipelineHookContext>;
    /** 阶段 3：派发生图驱动前的最终 Payload 终态拦截 */
    readonly beforeSubmit: AsyncSeriesWaterfallHook<GenerationPayload, PipelineHookContext>;
}
export declare function createPipelineHooks(): PipelineHooks;
//# sourceMappingURL=pipeline-hooks.d.ts.map