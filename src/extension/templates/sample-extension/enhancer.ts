/**
 * 样例扩展业务逻辑处理模块
 *
 * 功能：
 * 1. 提供提示词画质标签读取、更新与追加增强能力。
 *
 * Tips：
 * 1. 仅通过标准受控存储访问器 (ExtensionStorageAccessor) 存取数据，不依赖插件外部未授权变量。
 */

import type { ExtensionStorageAccessor } from '@types';

export interface EnhancerConfig {
    qualityTag: string;
    enabled: boolean;
}

export class PromptEnhancer {
    private readonly _storage: ExtensionStorageAccessor;

    constructor(storage: ExtensionStorageAccessor) {
        this._storage = storage;
    }

    getConfig(): EnhancerConfig {
        return {
            qualityTag: this._storage.get<string>('qualityTag', 'masterpiece, high quality'),
            enabled: this._storage.get<boolean>('enabled', true)
        };
    }

    updateConfig(partial: Partial<EnhancerConfig>): void {
        if (partial.qualityTag !== undefined) {
            this._storage.set('qualityTag', partial.qualityTag);
        }
        if (partial.enabled !== undefined) {
            this._storage.set('enabled', partial.enabled);
        }
    }

    enhance(prompt: string): string {
        const config = this.getConfig();
        if (!config.enabled || !config.qualityTag.trim()) {
            return prompt;
        }

        const tag = config.qualityTag.trim();
        const trimmedPrompt = prompt.trim();

        if (!trimmedPrompt) {
            return tag;
        }

        // 避免重复追加相同修饰词
        if (trimmedPrompt.toLowerCase().includes(tag.toLowerCase())) {
            return trimmedPrompt;
        }

        return `${tag}, ${trimmedPrompt}`;
    }
}
