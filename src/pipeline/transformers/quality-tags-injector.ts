/**
 * 质量起手式与负向词装配转换器 (Quality Tags Injector)
 * 职责：从当前引擎专属配置中提取 promptPrefix / promptSuffix 质量词，
 * 以及默认负向规整词，与当次正负向提示词进行安全拼装。
 */

import { PromptTransformer } from '../prompt-pipeline';
import { joinPromptParts } from '../prompt-utils';

export const qualityTagsInjectorTransformer: PromptTransformer = (ctx) => {
    const engineOpts = ctx.engineOptions || {};
    const prefix = typeof engineOpts.promptPrefix === 'string' ? engineOpts.promptPrefix : undefined;
    const suffix = typeof engineOpts.promptSuffix === 'string' ? engineOpts.promptSuffix : undefined;
    const engineNeg = typeof engineOpts.negativePrompt === 'string' ? engineOpts.negativePrompt : undefined;

    // 若无任何前缀、后缀或引擎负向词需要注入，直接透传当前上下文
    if (!prefix && !suffix && !engineNeg) {
        return ctx;
    }

    const mergedPositive = joinPromptParts(prefix, ctx.positivePrompt, suffix);
    const mergedNegative = joinPromptParts(engineNeg, ctx.negativePrompt);

    return {
        ...ctx,
        positivePrompt: mergedPositive || ctx.positivePrompt,
        negativePrompt: mergedNegative || ctx.negativePrompt
    };
};
