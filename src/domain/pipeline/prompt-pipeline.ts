/**
 * @module domain/pipeline/prompt-pipeline
 * @description 提示词处理流水线
 *
 * 核心职责：
 * 1. 从楼层文本中提取正向与负向提示词（以 | 分割）；
 * 2. 调度提示词构建前置钩子 (beforePromptBuild)，允许已注册的扩展模块介入处理正向提示词；
 * 3. 委托目标生图后端驱动组装专属 Payload 并派发提交。
 *
 * 遵循原则：默认信任输入内容，不做过度清洗与破坏性拆解，各后端驱动自主维护参数装配。
 */

import { DrawAssistantSettings } from '../../core/state/store-types';
import { GenerationPayload, IDrawDriver } from '../drivers/driver-contract';
import { IDrawDriverContract } from '../../core/contracts';
import { PipelineHooks, PipelineHookContext } from './pipeline-hooks';

export interface PipelineProcessOptions {
    rawPrompt: string;
    messageId: number;
    chatId: string;
    mode?: 'txt2img' | 'inpaint';
    initImageBlob?: Blob;
    maskImageBlob?: Blob;
    denoiseStrength?: number;
    driver?: IDrawDriverContract | IDrawDriver;
    metadata?: Record<string, unknown>;
}

/**
 * 提示词通用拼接工具函数
 *
 * 仅过滤空字符串并以英文逗号连接，不做额外的正则拆分与大小写去重，保持用户原始输入。
 *
 * @param parts 待拼接的文本片段列表
 * @returns 逗号连接后的完整提示词字符串
 */
export function joinPromptParts(...parts: Array<string | undefined | null>): string {
    return parts
        .map((p) => (p || '').trim())
        .filter(Boolean)
        .join(', ');
}

/**
 * 规范化提示词文本中的换行与冗余逗号
 *
 * 处理流程：按换行拆分 → 逐段 trim → 过滤空段 → 逗号连接 → 逐词 trim → 过滤空词 → 逗号连接。
 * 由主要设置中 cleanExtraSpacesAndLines 开关控制是否执行，关闭时仅做 trim。
 *
 * @param rawPrompt 原始提示词文本
 * @param shouldClean 是否执行清洗（受 cleanExtraSpacesAndLines 设置控制，默认 true）
 * @returns 规范化后的提示词文本
 */
export function cleanPromptText(rawPrompt: string, shouldClean = true): string {
    if (!rawPrompt) return '';
    if (!shouldClean) return rawPrompt.trim();
    return rawPrompt
        .split(/[\r\n]+/)
        .map((seg) => seg.trim())
        .filter(Boolean)
        .join(', ')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .join(', ');
}

/**
 * 提示词生命周期处理管线
 */
export class PromptPipeline {
    private readonly _hooks: PipelineHooks;

    constructor(hooks: PipelineHooks) {
        this._hooks = hooks;
    }

    /**
     * 处理原始提示词并委托目标驱动生成终态请求载荷 (Payload)
     *
     * @param options 管线处理参数
     * @param settings 全局配置快照
     * @returns 包含终态 Payload 与处理后正向词的结果对象
     */
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

        // 1. 基础提取：支持 beforeClean 扩展钩子
        let safeInput = (options.rawPrompt || '').trim();
        safeInput = await this._hooks.beforeClean.call(safeInput, context);

        // 2. 按首个管道符 | 分离正向提示词与负向提示词
        let positive = safeInput;
        let negative = '';
        const pipeIndex = safeInput.indexOf('|');
        if (pipeIndex >= 0) {
            positive = safeInput.substring(0, pipeIndex).trim();
            negative = safeInput.substring(pipeIndex + 1).trim();
        }

        // 3. 根据主要设置 cleanExtraSpacesAndLines 进行轻量换行规整
        const shouldClean = settings.cleanExtraSpacesAndLines !== false;
        positive = cleanPromptText(positive, shouldClean);
        negative = cleanPromptText(negative, shouldClean);

        // 4. 执行提示词构建前置钩子 (允许外部扩展修改正向提示词)
        const processedPositive = await this._hooks.beforePromptBuild.call(positive, context);

        // 5. 委托目标生图后端驱动自主组装 Payload
        const targetDriver = options.driver;
        if (!targetDriver || typeof targetDriver.buildPayload !== 'function') {
            throw new Error('生图管线未接收到有效的生图后端驱动实例 (IDrawDriver)');
        }

        const initialPayload = targetDriver.buildPayload({
            cleanPositive: processedPositive,
            cleanNegative: negative,
            mode: options.mode,
            initImageBlob: options.initImageBlob,
            maskImageBlob: options.maskImageBlob,
            denoiseStrength: options.denoiseStrength,
            settings
        });

        // 6. 触发提交前终态拦截 Hook
        const finalPayload = await this._hooks.beforeSubmit.call(initialPayload, context);

        return {
            payload: finalPayload,
            cleanPrompt: processedPositive
        };
    }
}
