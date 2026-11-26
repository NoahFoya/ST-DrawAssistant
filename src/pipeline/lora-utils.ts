/**
 * LoRA 触发判断、标签格式化、协议剥离与异常提醒兼容封装模块。
 *
 * @remarks
 * 纯领域函数已迁移至 `src/domain/lora/lora-syntax.ts`；
 * 本文件保留带 `toast:show` 与 `logger.warn` 副作用的管道辅助函数及过渡 re-export。
 */

import {
    formatLoraStrippedWarningMessage,
    sanitizeLoraPromptsPure,
    type SanitizeLoraPromptsOptions,
} from '../domain/lora/lora-syntax';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';

export {
    type LoraTagProtocol,
    DEFAULT_LORA_WEIGHTS,
    type StripLoraTagsOptions,
    type SanitizeLoraPromptsOptions,
    type StripLoraTagsResult,
    type SanitizeLoraPromptsResult,
    type FormatLoraTagInput,
    formatLoraWeightSummary,
    supportsLoraSyntax,
    cleanLoraModelBaseName,
    stripIncompatibleLoraTags,
    formatLoraStrippedWarningMessage,
    sanitizeLoraPromptsPure,
    stripLoraSyntax,
    isLoraTriggeredForPrompt,
    resolveTriggeredLoras,
    formatLoraTag,
    applyTextLoraTagsToPrompt,
} from '../domain/lora/lora-syntax';

/**
 * 当正/负向文本中被剥离不兼容 LoRA 标签时，统一输出日志与可见警告提醒。
 */
export function warnStrippedLoraTags(
    sourceLabel: string,
    strippedTags: readonly string[],
    guidance: string
): void {
    const message = formatLoraStrippedWarningMessage(sourceLabel, strippedTags, guidance);
    if (!message) {
        return;
    }
    logger.warn(`[LoraGuard] ${message}`);
    eventBus.emit('toast:show', {
        type: 'warn',
        message,
        duration: 5000,
    });
}

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

