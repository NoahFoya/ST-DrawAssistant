/**
 * 提示词处理流水线
 * 保留原始提取的提示词格式（换行与标点），按首个管道符切分正负向提示词，
 * 调度生命周期钩子，最终组装为标准生图请求对象。
 */

import { IDisposable, GenerationRequest } from '../types';
import { PipelineHooks, PipelineHookContext, createPipelineHooks } from './pipeline-hooks';
import { separatePromptByPipe, normalizePromptPunctuation } from './prompt-utils';

export interface PipelineProcessOptions {
    rawPrompt: string;
    negativePrompt?: string;
    targetEngine?: string;
    taskId?: string;
    contextInfo?: {
        characterId?: string | number;
        characterName?: string;
        userName?: string;
        messageId?: number;
        chatId?: string;
        swipeId?: number;
        buttonIndex?: number;
    };
    imageInputs?: {
        initImageBlob?: Blob;
        maskImageBlob?: Blob;
        referenceImageBlobs?: Blob[];
        denoiseStrength?: number;
    };
    engineOptions?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export interface PipelineProcessResult {
    request: GenerationRequest;
    prompt: string;
}

export class PromptPipeline implements IDisposable {
    public readonly hooks: PipelineHooks;
    private _isDisposed = false;

    constructor(hooks?: PipelineHooks) {
        this.hooks = hooks || createPipelineHooks();
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this.hooks.onRawInput.clear();
        this.hooks.beforePromptBuild.clear();
        this.hooks.beforeSubmit.clear();
    }

    /**
     * 处理原始提示词并输出标准的生图请求对象 (GenerationRequest)
     */
    public async process(
        options: PipelineProcessOptions,
        settings: Record<string, any> = {}
    ): Promise<PipelineProcessResult> {
        if (this._isDisposed) {
            throw new Error('提示词流水线已被销毁，无法继续处理请求');
        }

        const context: PipelineHookContext = {
            messageId: options.contextInfo?.messageId,
            chatId: options.contextInfo?.chatId,
            rawPrompt: options.rawPrompt,
            characterId: options.contextInfo?.characterId,
            characterName: options.contextInfo?.characterName,
            userName: options.contextInfo?.userName,
            metadata: options.metadata
        };

        const rawInput = options.rawPrompt || '';
        const safeInput = await this.hooks.onRawInput.call(rawInput, context);

        const { positive: rawPositive, negative: rawNegative } = separatePromptByPipe(safeInput);

        const processedPositive = await this.hooks.beforePromptBuild.call(rawPositive, context);

        const normalizedExtraNeg = options.negativePrompt ? normalizePromptPunctuation(options.negativePrompt) : '';
        const combinedNegative = normalizedExtraNeg
            ? (rawNegative ? `${rawNegative}, ${normalizedExtraNeg}` : normalizedExtraNeg)
            : rawNegative;

        const taskId = options.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const targetEngine = options.targetEngine || settings.activeProvider || 'default';

        const initialRequest: GenerationRequest = {
            taskId,
            targetEngine,
            prompt: processedPositive,
            negativePrompt: combinedNegative || undefined,
            contextInfo: options.contextInfo,
            imageInputs: options.imageInputs,
            engineOptions: options.engineOptions || {}
        };

        const finalRequest = await this.hooks.beforeSubmit.call(initialRequest, context);

        return {
            request: finalRequest,
            prompt: finalRequest.prompt
        };
    }
}
