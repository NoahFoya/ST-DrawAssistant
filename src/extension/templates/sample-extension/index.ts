/**
 * 提示词增强扩展样例入口
 * 遵循扩展自包含原则：
 * 1. 单向依赖原则：仅引用 @types 标准类型声明，绝不直接引入插件核心内部私有模块；
 * 2. 存储隔离原则：通过 context.storage 存取自身独立命名空间配置；
 * 3. 故障隔离原则：内部方法具备异常防范，由注册中心统一进行生命周期与钩子调用管理。
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
