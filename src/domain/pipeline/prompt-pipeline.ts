/**
 * @module domain/pipeline/prompt-pipeline
 * @description 提示词多阶段流水线核心引擎 (严格遵循多阶段拦截时序)
 */

import { PipelineHooks, PipelineHookContext } from './pipeline-hooks';
import { VariableEvaluator } from './variable-evaluator';
import { GenerationPayload, IDrawDriver } from '../drivers/driver-contract';
import { DrawAssistantSettings } from '../../core/state/store-types';

export interface PipelineProcessOptions {
    rawPrompt: string;
    messageId: number;
    chatId: string;
    mode?: 'txt2img' | 'inpaint';
    initImageBlob?: Blob;
    maskImageBlob?: Blob;
    denoiseStrength?: number;
    driver?: IDrawDriver;
    metadata?: Record<string, unknown>;
}

export class PromptPipeline {
    private readonly _hooks: PipelineHooks;
    private readonly _evaluator = new VariableEvaluator();

    constructor(hooks: PipelineHooks) {
        this._hooks = hooks;
    }

    public async process(
        options: PipelineProcessOptions,
        settings: DrawAssistantSettings
    ): Promise<{ payload: GenerationPayload; cleanPrompt: string }> {
        const context: PipelineHookContext = {
            messageId: options.messageId,
            chatId: options.chatId,
            rawPrompt: options.rawPrompt,
            metadata: options.metadata
        };

        // 阶段 1: hooks.beforeClean (清洗前文本拦截)
        let text = await this._hooks.beforeClean.call(options.rawPrompt, context);

        // 阶段 2: Core Clean (HTML 标签过滤与基础标点清洗)
        text = this.cleanBaseText(text);

        // 阶段 3: hooks.beforePromptBuild (扩展层执行: 树形宏展开与角色/服装标签注入)
        text = await this._hooks.beforePromptBuild.call(text, context);

        // 阶段 4: Core Variable Evaluator (提取 <lora:...>, <wlr:...> 标签并清洗)
        const evalResult = this._evaluator.parseLoraTags(text);
        text = evalResult.cleanText;

        // 阶段 5: Target Driver Syntax Formatter
        if (options.driver?.formatPrompt) {
            text = options.driver.formatPrompt(text);
        }

        // 阶段 6: Core Assemble (注入通用起手词、质量词与负向词，组装初始 Payload)
        const positivePrefix = settings.promptPrefix || '';
        const promptSuffix = settings.promptSuffix || '';
        const negativePrefix = settings.negativePrefix || '';

        const fullPositive = [positivePrefix, text, promptSuffix].filter(Boolean).join(', ');
        const fullNegative = negativePrefix;

        let initialPayload: GenerationPayload;
        const commonParams = {
            seed: Math.floor(Math.random() * 2147483647),
            steps: settings.steps || 20,
            cfgScale: settings.cfgScale || 7.0,
            samplerName: settings.samplerName || 'Euler a',
            scheduler: settings.scheduler || 'normal',
            width: settings.width || 512,
            height: settings.height || 768
        };

        if (options.mode === 'inpaint' && options.initImageBlob && options.maskImageBlob) {
            initialPayload = {
                mode: 'inpaint',
                prompt: fullPositive,
                negativePrompt: fullNegative,
                params: commonParams,
                initImageBlob: options.initImageBlob,
                maskImageBlob: options.maskImageBlob,
                denoiseStrength: options.denoiseStrength ?? settings.inpaintDenoise ?? 0.75
            };
        } else {
            initialPayload = {
                mode: 'txt2img',
                prompt: fullPositive,
                negativePrompt: fullNegative,
                params: commonParams
            };
        }

        // 阶段 7: hooks.beforeSubmit (终态 Payload 参数与多模态数据修正)
        const finalPayload = await this._hooks.beforeSubmit.call(initialPayload, context);

        return {
            payload: finalPayload,
            cleanPrompt: text
        };
    }

    private cleanBaseText(raw: string): string {
        if (!raw) return '';
        return raw
            .replace(/<[^>]+>/g, ' ')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/,\s*,+/g, ',')
            .replace(/^\s*,|,\s*$/g, '')
            .trim();
    }
}
