/**
 * LoRA 提示词协议清洗副作用封装模块。
 *
 * @remarks
 * 纯规则与格式化函数均直接由 `src/domain/lora/lora-syntax.ts` 提供；
 * 本文件仅负责对纯函数清洗结果附加 `toast:show` 与 `logger.warn` 运行时通知副作用。
 */

import {
    sanitizeLoraPromptsPure,
    type SanitizeLoraPromptsOptions,
} from '../domain/lora/lora-syntax';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';

/**
 * 统一对正向与负向提示词执行协议白名单清洗，合并剥离结果并输出显式告警。
 */
export function sanitizeLoraPrompts(
    positivePrompt: string,
    negativePrompt: string | undefined,
    options: SanitizeLoraPromptsOptions
): {
    readonly positivePrompt: string;
    readonly negativePrompt: string;
    readonly strippedTags: string[];
} {
    const res = sanitizeLoraPromptsPure(positivePrompt, negativePrompt, options);
    if (res.warningMessage) {
        logger.warn(`[LoraGuard] ${res.warningMessage}`);
        eventBus.emit('toast:show', {
            type: 'warn',
            message: res.warningMessage,
            duration: 5000,
        });
    }

    return {
        positivePrompt: res.positivePrompt,
        negativePrompt: res.negativePrompt,
        strippedTags: res.strippedTags,
    };
}

