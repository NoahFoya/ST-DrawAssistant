/**
 * 提示词处理流水线 (Prompt Pipeline)
 * 基于线性纯函数中间件链 (PromptTransformer Chain) 架构，
 * 依次执行标点规范化、首个管道符正负分离、质量词注入等核心规则，
 * 并支持上层扩展和第三方模块通过 .use() 自由插入自定义转换规则。
 */

import { IDisposable, GenerationRequest } from '../types';
import {
    punctuationCleanerTransformer,
    pipeSeparatorTransformer,
    qualityTagsInjectorTransformer
} from './transformers';

export interface PromptContext {
    /** 原始用户输入提示词 (只读保留) */
    readonly rawPrompt: string;
    /** 当前流转中的正向提示词 */
    positivePrompt: string;
    /** 当前流转中的负向提示词 */
    negativePrompt?: string;
    /** 目标生图引擎标识 */
    targetEngine: string;
    /** 本次任务 ID */
    taskId: string;
    /** 楼层与消息上下文信息 (由宿主提取的纯粹数据) */
    contextInfo?: {
        characterId?: string | number;
        characterName?: string;
        userName?: string;
        messageId?: number;
        chatId?: string;
        swipeId?: number;
        buttonIndex?: number;
    };
    /** 图生图 / 局部重绘底图与蒙版输入 */
    imageInputs?: {
        initImageBlob?: Blob;
        maskImageBlob?: Blob;
        referenceImageBlobs?: Blob[];
        denoiseStrength?: number;
    };
    /** 引擎专属透传参数选项 */
    engineOptions: Record<string, unknown>;
    /** 扩展元数据字典 */
    metadata: Record<string, unknown>;
    /** 全局插件配置快照 */
    settings: Record<string, any>;
}

/** 纯函数中间件转换器 */
export type PromptTransformer = (ctx: PromptContext) => Promise<PromptContext> | PromptContext;

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
    private _isDisposed = false;
    private readonly _transformers: PromptTransformer[] = [];

    constructor() {
        // 默认按标准顺序注册内置核心转换器：管道符切分 -> 标点符号规范化 -> 质量起手式与负向词注入
        this._transformers.push(
            pipeSeparatorTransformer,
            punctuationCleanerTransformer,
            qualityTagsInjectorTransformer
        );
    }

    /**
     * 注册自定义提示词转换中间件
     * @param transformer 转换器纯函数
     */
    public use(transformer: PromptTransformer): this {
        if (typeof transformer === 'function') {
            this._transformers.push(transformer);
        }
        return this;
    }

    /** 获取当前已注册的转换器清单 */
    public getTransformers(): readonly PromptTransformer[] {
        return this._transformers;
    }

    /** 清空当前转换器 (用于特殊定制或纯净单测) */
    public clearTransformers(): this {
        this._transformers.length = 0;
        return this;
    }

    public dispose(): void {
        this._isDisposed = true;
        this._transformers.length = 0;
    }

    /**
     * 执行流水线转换，输出标准的生图请求对象 (GenerationRequest)
     */
    public async process(
        options: PipelineProcessOptions,
        settings: Record<string, any> = {}
    ): Promise<PipelineProcessResult> {
        if (this._isDisposed) {
            throw new Error('提示词流水线已被销毁，无法继续处理请求');
        }

        const rawPrompt = options.rawPrompt || '';
        const taskId = options.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const targetEngine = options.targetEngine || settings.activeProvider || 'default';

        // 构造初始流转上下文
        let ctx: PromptContext = {
            rawPrompt,
            positivePrompt: rawPrompt,
            negativePrompt: options.negativePrompt || undefined,
            targetEngine,
            taskId,
            contextInfo: options.contextInfo,
            imageInputs: options.imageInputs,
            engineOptions: options.engineOptions || {},
            metadata: options.metadata || {},
            settings
        };

        // 顺序流转中间件链
        for (const transformer of this._transformers) {
            try {
                ctx = await transformer(ctx);
            } catch (err) {
                console.warn('[PromptPipeline] 中间件执行异常，回退当前上下文并继续流转:', err);
            }
        }

        // 组装标准的 GenerationRequest
        const request: GenerationRequest = {
            taskId: ctx.taskId,
            targetEngine: ctx.targetEngine,
            prompt: ctx.positivePrompt,
            negativePrompt: ctx.negativePrompt || undefined,
            contextInfo: ctx.contextInfo,
            imageInputs: ctx.imageInputs,
            engineOptions: ctx.engineOptions
        };

        return {
            request,
            prompt: request.prompt
        };
    }
}
