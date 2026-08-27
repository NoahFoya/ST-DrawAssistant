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
import { PipelineHooks } from './pipeline-hooks';
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
export declare function joinPromptParts(...parts: Array<string | undefined | null>): string;
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
export declare function cleanPromptText(rawPrompt: string, shouldClean?: boolean): string;
/**
 * 提示词生命周期处理管线
 */
export declare class PromptPipeline {
    private readonly _hooks;
    constructor(hooks: PipelineHooks);
    /**
     * 处理原始提示词并委托目标驱动生成终态请求载荷 (Payload)
     *
     * @param options 管线处理参数
     * @param settings 全局配置快照
     * @returns 包含终态 Payload 与处理后正向词的结果对象
     */
    process(options: PipelineProcessOptions, settings: DrawAssistantSettings): Promise<{
        payload: GenerationPayload;
        cleanPrompt: string;
    }>;
}
//# sourceMappingURL=prompt-pipeline.d.ts.map