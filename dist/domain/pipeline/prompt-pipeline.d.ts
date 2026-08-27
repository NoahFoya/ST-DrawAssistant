/**
 * @module domain/pipeline/prompt-pipeline
 * @description 提示词多阶段流水线核心引擎 (严格遵循多阶段拦截时序)
 */
import { PipelineHooks } from './pipeline-hooks';
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
export declare class PromptPipeline {
    private readonly _hooks;
    private readonly _evaluator;
    constructor(hooks: PipelineHooks);
    process(options: PipelineProcessOptions, settings: DrawAssistantSettings): Promise<{
        payload: GenerationPayload;
        cleanPrompt: string;
    }>;
    private cleanBaseText;
}
//# sourceMappingURL=prompt-pipeline.d.ts.map