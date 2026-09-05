/**
 * @module domain/pipeline/prompt-pipeline
 * @description 提示词处理流水线
 *
 * 1. 保留原始提取的提示词格式（换行与标点）；
 * 2. 按首个管道符 | 分割正向与负向提示词；
 * 3. 组织生命周期钩子调用（供未来独立扩展按需挂载）；
 * 4. 组装标准化生图请求对象 (GenerationRequest)。
 */

import { IDisposable } from '../../../common';
import { GenerationRequest } from '../types';
import { PipelineHooks, PipelineHookContext, createPipelineHooks } from './pipeline-hooks';
import { separatePromptByPipe } from './prompt-utils';

/** 流水线处理请求选项 */
export interface PipelineProcessOptions {
    /** 原始提取的提示词文本 */
    rawPrompt: string;
    /** 可选的补充负向提示词 */
    negativePrompt?: string;
    /** 目标后端标识 (如 'comfyui' | 'sdwebui' | 'novelai' | 'cloud') */
    targetEngine?: string;
    /** 任务标识 (可选，未提供时由流水线生成) */
    taskId?: string;
    /** 关联的会话上下文信息 (可选) */
    contextInfo?: {
        characterId?: string | number;
        characterName?: string;
        userName?: string;
        messageId?: number;
        chatId?: string;
        swipeId?: number;
        buttonIndex?: number;
    };
    /** 关联的图像媒体输入 (可选) */
    imageInputs?: {
        initImageBlob?: Blob;
        maskImageBlob?: Blob;
        referenceImageBlobs?: Blob[];
        denoiseStrength?: number;
    };
    /** 目标后端的专属参数选项 */
    engineOptions?: Record<string, unknown>;
    /** 扩展元数据 */
    metadata?: Record<string, unknown>;
}

/** 流水线处理输出结果 */
export interface PipelineProcessResult {
    /** 生图请求对象 */
    request: GenerationRequest;
    /** 处理后的正向提示词 */
    prompt: string;
}

/**
 * 提示词处理流水线
 * 插件本体基础功能：负责正负向提示词切分与生图请求组装；
 * 同时提供标准的生命周期钩子容器，供外部扩展按需挂载。
 */
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
     *
     * 处理流程：
     * 1. 调度 onRawInput 钩子（供扩展层按需介入初始文本）；
     * 2. 管道符 | 分割正负向提示词；
     * 3. 调度 beforePromptBuild 钩子（供未来扩展模块按需补充特征）；
     * 4. 组装请求参数并调度 beforeSubmit 钩子校验。
     *
     * @param options 流水线调度参数
     * @param settings 全局配置快照 (可选)
     * @returns 标准化生图请求对象与提示词
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

        // 1. 原始输入预处理钩子：供扩展层按需介入初始文本
        const rawInput = options.rawPrompt || '';
        const safeInput = await this.hooks.onRawInput.call(rawInput, context);

        // 2. 按首个管道符 | 分隔正负向提示词，保留内部换行与标点
        const { positive: rawPositive, negative: rawNegative } = separatePromptByPipe(safeInput);

        // 3. 提示词组装前钩子：供外部扩展模块补充特征或风格
        const processedPositive = await this.hooks.beforePromptBuild.call(rawPositive, context);

        // 合并可选负向提示词
        const combinedNegative = options.negativePrompt
            ? (rawNegative ? `${rawNegative}, ${options.negativePrompt}` : options.negativePrompt)
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

        // 4. 提交前检查：允许外部扩展在提交任务前调整或校验请求参数
        const finalRequest = await this.hooks.beforeSubmit.call(initialRequest, context);

        return {
            request: finalRequest,
            prompt: finalRequest.prompt
        };
    }
}
