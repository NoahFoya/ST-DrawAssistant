/**
 * @module domain/pipeline/prompt-pipeline
 * @description 提示词处理流水线
 *
 * 核心原则：
 * 1. 核心层绝不对原生提取的提示词执行破坏性正则清洗、换行替换或管道符强行切割；
 * 2. 作为纯粹的无状态数据通道与生命周期调度器，原样透传上下文；
 * 3. 语法解析与特定参数映射交由具体适配器或扩展模块处理。
 */

import { IDisposable } from '../../../common';
import { GenerationRequest } from '../types';
import { PipelineHooks, PipelineHookContext } from './pipeline-hooks';

/** 流水线处理请求选项 */
export interface PipelineProcessOptions {
    /** 原始提取的提示词文本 (未经任何破坏性清洗) */
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
        messageId?: number;
        chatId?: string;
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
    /** 标准生图请求对象 */
    request: GenerationRequest;
    /** 处理后的正向提示词描述 */
    prompt: string;
}

export { joinPromptParts, separatePromptByPipe } from './prompt-utils';
import { separatePromptByPipe } from './prompt-utils';

/**
 * 提示词生命周期处理流水线
 * 负责组织生命周期钩子调度与上下文传递，不包含破坏性文本加工
 */
export class PromptPipeline implements IDisposable {
    private readonly _hooks: PipelineHooks;
    private _isDisposed = false;

    constructor(hooks: PipelineHooks) {
        this._hooks = hooks;
    }

    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._hooks.onRawInput.clear();
        this._hooks.beforePromptBuild.clear();
        this._hooks.beforeSubmit.clear();
    }

    /**
     * 处理原始提示词并输出标准的生图请求对象 (GenerationRequest)
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

        const messageId = options.contextInfo?.messageId;
        const chatId = options.contextInfo?.chatId;

        const context: PipelineHookContext = {
            messageId,
            chatId,
            rawPrompt: options.rawPrompt,
            metadata: options.metadata
        };

        // 原始输入前置拦截
        let safeInput = options.rawPrompt || '';
        safeInput = await this._hooks.onRawInput.call(safeInput, context);

        // 插件原生功能：首个管道符 | 分隔正负向提示词，零破坏保留段落换行与自然标点
        const { positive: rawPositive, negative: rawNegative } = separatePromptByPipe(safeInput);

        // 提示词构建前钩子，供扩展注入角色特征或风格词
        const processedPositive = await this._hooks.beforePromptBuild.call(rawPositive, context);

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

        // 提交前钩子，允许在入队前调整或校验最终请求参数
        const finalRequest = await this._hooks.beforeSubmit.call(initialRequest, context);

        return {
            request: finalRequest,
            prompt: finalRequest.prompt
        };

    }
}
