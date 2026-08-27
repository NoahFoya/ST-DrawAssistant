/**
 * @module domain/pipeline/pipeline-hooks
 * @description 提示词流水线拦截钩子与实现 (PipelineHooks, AsyncSeriesWaterfallHook)
 */

import { IDisposable, toDisposable } from '../../core/foundation/disposable';
import { GenerationPayload } from '../drivers/driver-contract';

export interface PipelineHookContext {
    readonly messageId: number;
    readonly chatId: string;
    readonly rawPrompt: string;
    readonly metadata?: Record<string, unknown>;
}

export type HookCallback<T, C> = (data: T, context: C) => Promise<T> | T;

export class AsyncSeriesWaterfallHook<T, C = any> {
    private readonly _taps: Array<{ id: string; fn: HookCallback<T, C>; priority: number }> = [];

    public tap(id: string, fn: HookCallback<T, C>, priority = 50): IDisposable {
        this._taps.push({ id, fn, priority });
        this._taps.sort((a, b) => b.priority - a.priority);

        return toDisposable(() => {
            const index = this._taps.findIndex((t) => t.id === id);
            if (index !== -1) {
                this._taps.splice(index, 1);
            }
        });
    }

    public async call(initialData: T, context: C): Promise<T> {
        let current = initialData;
        for (const tap of this._taps) {
            current = await tap.fn(current, context);
        }
        return current;
    }
}

export interface PipelineHooks {
    /** 阶段 1：原始文本清洗前拦截 */
    readonly beforeClean: AsyncSeriesWaterfallHook<string, PipelineHookContext>;
    /** 阶段 2：角色标签、服装与宏规则树展开拦截 (扩展核心挂载点) */
    readonly beforePromptBuild: AsyncSeriesWaterfallHook<string, PipelineHookContext>;
    /** 阶段 3：派发生图驱动前的最终 Payload 终态拦截 */
    readonly beforeSubmit: AsyncSeriesWaterfallHook<GenerationPayload, PipelineHookContext>;
}

export function createPipelineHooks(): PipelineHooks {
    return {
        beforeClean: new AsyncSeriesWaterfallHook<string, PipelineHookContext>(),
        beforePromptBuild: new AsyncSeriesWaterfallHook<string, PipelineHookContext>(),
        beforeSubmit: new AsyncSeriesWaterfallHook<GenerationPayload, PipelineHookContext>()
    };
}
