/**
 * @module domain/pipeline/pipeline-hooks
 * @description 提示词流水线处理钩子与注册管理
 */

import { IDisposable, toDisposable } from '../../../common';
import { GenerationRequest } from '../types';

/** 提示词上下文信息快照 */
export interface PipelineHookContext {
    messageId?: number;
    chatId?: string;
    rawPrompt: string;
    characterId?: string | number;
    characterName?: string;
    userName?: string;
    metadata?: Record<string, unknown>;
}

/** 处理函数签名 */
export type HookHandler<TInput, TOutput> = (
    input: TInput,
    context: PipelineHookContext
) => Promise<TOutput> | TOutput;

interface RegisteredHook<TInput, TOutput> {
    id: string;
    handler: HookHandler<TInput, TOutput>;
    priority: number;
    critical: boolean;
}

/**
 * 异步处理链钩子
 * 注册的处理函数按优先级升序串行执行，前一个函数的输出作为后一个函数的输入
 */
export class AsyncPipelineHook<T> {
    private _hooks: RegisteredHook<T, T>[] = [];

    /**
     * 注册钩子。同标识覆盖，返回用于注销的 IDisposable 句柄
     * @param id 钩子唯一标识
     * @param handler 处理函数
     * @param priority 执行优先级 (越小越先执行，默认 100)
     * @param critical 是否为关键钩子 (若为 true，执行异常时向外抛出并中止流水线；若为 false，异常时记录日志并跳过)
     */
    public register(
        id: string,
        handler: HookHandler<T, T>,
        priority = 100,
        critical = false
    ): IDisposable {
        this._hooks = this._hooks.filter((h) => h.id !== id);
        this._hooks.push({ id, handler, priority, critical });
        this._hooks.sort((a, b) => a.priority - b.priority);

        return toDisposable(() => {
            this._hooks = this._hooks.filter((h) => h.id !== id);
        });
    }

    /**
     * 执行钩子调用链。关键钩子异常直接抛出，可选钩子异常记录并跳过
     */
    public async call(initialValue: T, context: PipelineHookContext): Promise<T> {
        let current = initialValue;
        for (const hook of this._hooks) {
            try {
                current = await hook.handler(current, context);
            } catch (err) {
                if (hook.critical) {
                    throw err;
                }
                console.warn(`[PipelineHook] 可选钩子 [${hook.id}] 执行异常（已跳过）:`, err);
            }
        }
        return current;
    }

    public clear(): void {
        this._hooks = [];
    }
}

/** 流水线钩子集合 */
export interface PipelineHooks {
    /** 原始文本输入就绪时触发，允许外部修改初始原始输入 */
    readonly onRawInput: AsyncPipelineHook<string>;
    /** 提示词构建前触发，供扩展模块按需附加角色外貌与环境特征 */
    readonly beforePromptBuild: AsyncPipelineHook<string>;
    /** 提交任务前触发，用于检查或修改最终请求参数 */
    readonly beforeSubmit: AsyncPipelineHook<GenerationRequest>;
}

export function createPipelineHooks(): PipelineHooks {
    return {
        onRawInput: new AsyncPipelineHook<string>(),
        beforePromptBuild: new AsyncPipelineHook<string>(),
        beforeSubmit: new AsyncPipelineHook<GenerationRequest>()
    };
}
