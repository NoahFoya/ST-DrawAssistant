/**
 * 提示词增强扩展样例入口
 *
 * 功能：
 * 1. 演示自包含扩展开发：独立配置存储隔离、生命周期调度与提示词流程钩子注册；
 * 2. 在提示词装配前注入质量增强修饰词。
 *
 * Tips：
 * 1. 单向依赖：仅引用 @types 标准类型，避免直接依赖插件内部私有模块；
 * 2. 存储隔离：通过 context.storage 存取独立命名空间配置，不污染主配置树；
 * 3. 生命周期清理：destroy 时主动解绑流水线钩子并释放内部增强器实例。
 */

import type {
    DrawAssistantExtension,
    ExtensionContext
} from '@types';
import { PromptEnhancer } from './enhancer';

export class SamplePromptEnhancerExtension implements DrawAssistantExtension {
    readonly id = 'sample-prompt-enhancer';
    readonly name = '提示词增强扩展样例';
    readonly version = '1.0.0';
    readonly description = '演示自包含扩展开发：独立配置隔离、生命周期调度与提示词流程钩子';
    readonly defaultEnabled = true;

    private _context: ExtensionContext | null = null;
    private _enhancer: PromptEnhancer | null = null;
    private _unsubHook: (() => void) | null = null;
    private _active = false;

    init(context: ExtensionContext): void {
        this._context = context;
        this._enhancer = new PromptEnhancer(context.storage);
        this._active = true;

        context.log.info('提示词增强扩展样例已初始化');

        // 注册提示词流水线前置处理钩子
        if (context.hooks?.onBeforePromptProcess) {
            this._unsubHook = context.hooks.onBeforePromptProcess((prompt: string) => {
                if (!this._active || !this._enhancer) {
                    return prompt;
                }
                return this._enhancer.enhance(prompt);
            });
        }
    }

    onToggle(enabled: boolean): void {
        this._active = enabled;
        this._context?.log.info(`提示词增强扩展样例状态已切换: ${enabled ? '启用' : '禁用'}`);
    }

    dispose(): void {
        if (this._unsubHook) {
            this._unsubHook();
            this._unsubHook = null;
        }
        this._active = false;
        this._enhancer = null;
        this._context?.log.info('提示词增强扩展样例已释放');
        this._context = null;
    }
}

/**
 * 工厂函数：创建样例扩展实例
 */
export function createSampleExtension(): DrawAssistantExtension {
    return new SamplePromptEnhancerExtension();
}
