/**
 * 提示词流水线处理钩子与注册管理
 * 供扩展在提示词解析前后挂载自定义处理逻辑
 */

import { IDisposable, toDisposable, GenerationRequest } from '../types';

export interface PipelineHookContext {
    messageId?: number;
    chatId?: string;
    rawPrompt: string;
    characterId?: string | number;
    characterName?: string;
    userName?: string;
    metadata?: Record<string, unknown>;
}

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
 * 按优先级升序串行执行，前一个输出作为后一个输入
 */
export class AsyncPipelineHook<T> {
    private _hooks: RegisteredHook<T, T>[] = [];

    /**
     * 注册钩子处理函数
     * @param id 钩子唯一标识
     * @param handler 处理函数
     * @param priority 优先级 (越小越先执行，默认 100)
     * @param critical 是否为关键钩子 (若为 true，异常向外抛出；若为 false，异常记录警告并跳过)
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
     * 执行钩子链
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

export interface PipelineHooks {
    readonly onRawInput: AsyncPipelineHook<string>;
    readonly beforePromptBuild: AsyncPipelineHook<string>;
    readonly beforeSubmit: AsyncPipelineHook<GenerationRequest>;
}

export function createPipelineHooks(): PipelineHooks {
    return {
        onRawInput: new AsyncPipelineHook<string>(),
        beforePromptBuild: new AsyncPipelineHook<string>(),
        beforeSubmit: new AsyncPipelineHook<GenerationRequest>()
    };
}
