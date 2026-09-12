/**
 * 管道符正负词切分转换器 (Pipe Separator)
 * 职责：按首个管道符 `|` 分割用户意图词，精准提取正向词与局部负向词，并与既有负向词做标准化合并。
 */

import { PromptTransformer } from '../prompt-pipeline';
import { separatePromptByPipe } from '../prompt-utils';

export const pipeSeparatorTransformer: PromptTransformer = (ctx) => {
    if (!ctx.positivePrompt.includes('|')) {
        return ctx;
    }

    const { positive, negative } = separatePromptByPipe(ctx.positivePrompt);
    const combinedNegative = negative
        ? (ctx.negativePrompt ? `${negative}, ${ctx.negativePrompt}` : negative)
        : ctx.negativePrompt;

    return {
        ...ctx,
        positivePrompt: positive,
        negativePrompt: combinedNegative || undefined
    };
};
