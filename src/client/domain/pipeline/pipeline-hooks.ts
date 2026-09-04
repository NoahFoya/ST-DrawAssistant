/**
 * @module domain/pipeline/pipeline-hooks
 * @description 提示词流水线生命周期拦截器调度器
 */

import { IDisposable, toDisposable } from '../../../common';
import { GenerationRequest } from '../types';

/** 提示词上下文信息快照 */
export interface PipelineHookContext {
    messageId?: number;
    chatId?: string;
    rawPrompt: string;
    metadata?: Record<string, unknown>;
}

/** 拦截处理函数签名 */
export type HookHandler<TInput, TOutput> = (
    input: TInput,
    context: PipelineHookContext
) => Promise<TOutput> | TOutput;

interface RegisteredHook<TInput, TOutput> {
    id: string;
    handler: HookHandler<TInput, TOutput>;
    priority: number;
}

/**
 * 异步链式拦截器
 * 注册的拦截器按优先级升序串行执行，前一个拦截器的输出作为后一个拦截器的输入
 */
export class AsyncPipelineHook<T> {
    private _hooks: RegisteredHook<T, T>[] = [];

    /**
     * 注册拦截器。同标识覆盖，返回用于注销的 IDisposable 句柄
     */
    public register(id: string, handler: HookHandler<T, T>, priority = 100): IDisposable {
        this._hooks = this._hooks.filter((h) => h.id !== id);
        this._hooks.push({ id, handler, priority });
        this._hooks.sort((a, b) => a.priority - b.priority);

        return toDisposable(() => {
            this._hooks = this._hooks.filter((h) => h.id !== id);
        });
    }

    /**
     * 执行拦截器调用链，捕获并降级单个拦截器异常，防止整条流水线意外中断
     */
    public async call(initialValue: T, context: PipelineHookContext): Promise<T> {
        let current = initialValue;
        for (const hook of this._hooks) {
            try {
                current = await hook.handler(current, context);
            } catch (err) {
                console.warn(`[PipelineHook] 拦截器 [${hook.id}] 执行异常:`, err);
            }
        }
        return current;
    }

    public clear(): void {
        this._hooks = [];
    }
}

/** 流水线生命周期拦截钩子集合 */
export interface PipelineHooks {
    /** 原始文本输入就绪时触发，允许外部修改初始原始输入 */
    readonly onRawInput: AsyncPipelineHook<string>;
    /** 提示词构建前触发，供扩展模块按需附加角色外貌与环境特征 */
    readonly beforePromptBuild: AsyncPipelineHook<string>;
    /** 请求对象生成后、交付调度中心前触发，用于提交前终态参数检查 */
    readonly beforeSubmit: AsyncPipelineHook<GenerationRequest>;
}

export function createPipelineHooks(): PipelineHooks {
    return {
        onRawInput: new AsyncPipelineHook<string>(),
        beforePromptBuild: new AsyncPipelineHook<string>(),
        beforeSubmit: new AsyncPipelineHook<GenerationRequest>()
    };
}
