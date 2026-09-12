/**
 * 标点符号清洗转换器 (Punctuation Cleaner)
 * 职责：将正向与负向提示词中的全角中文标点统一转为半角英文标点，并规整空白与连续逗号。
 */

import { PromptTransformer } from '../prompt-pipeline';
import { normalizePromptPunctuation } from '../prompt-utils';

export const punctuationCleanerTransformer: PromptTransformer = (ctx) => {
    return {
        ...ctx,
        positivePrompt: normalizePromptPunctuation(ctx.positivePrompt),
        negativePrompt: ctx.negativePrompt ? normalizePromptPunctuation(ctx.negativePrompt) : undefined
    };
};
