/**
 * @module core/prompt-pipeline
 * @description 提示词处理管道
 *
 * 职责：
 * - 提供生图正负向提示词的规范化构建流程
 * - 允许模块注册自定义提示词处理函数，按顺序依次清洗和丰富文本
 * - 自动拼接正负向前缀、后缀以及 LoRA 语法串
 */
import type { DrawAssistantSettings } from '../settings/types';
/** Prompt 处理器调用时携带的上下文信息 */
export interface PromptContext {
    /** 消息在 chat 数组中的索引 */
    messageIndex: number;
    /** 同一消息中的按钮序号（从 0 开始） */
    buttonIndex: number;
    /** 来自占位符的原始提示词文本 */
    rawPrompt: string;
}
/**
 * Prompt 处理器函数签名
 * 接收当前 prompt 字符串与调用上下文，返回处理后的字符串（支持异步）
 */
export type PromptProcessor = (prompt: string, context: PromptContext) => string | Promise<string>;
/**
 * 注册一个 Prompt 处理器 Hook（由进阶扩展在初始化阶段调用）
 */
export declare function registerPromptProcessor(processor: PromptProcessor): void;
/**
 * 依次执行所有已注册的 Prompt 处理器
 * 单个处理器异常时记录警告并跳过，不中断主链路
 */
export declare function runPromptProcessors(raw: string, ctx: PromptContext): Promise<string>;
/**
 * 清洗 HTML 渲染残留标签与转义实体，并根据配置清洗多余空格与空行
 * ST 消息文本经过 markdown 渲染后可能包含 HTML，注入引擎前需统一清洗
 */
export declare function cleanRenderedText(text: string, shouldCleanExtraSpaces?: boolean): string;
/**
 * 智能过滤多层级前缀/起手词串中跨层级重复的 Tag
 * 保留靠前层级（如 Checkpoint 底模的起手词优先），对后续层级（如 Prompt 预设前缀与后缀）中的重复 Tag 进行精准剥离
 *
 * @param prefixes 依次传入的各层级前缀字符串（如 [checkpointPositivePrefix, promptPrefix]）
 * @returns 剥离重复重叠 Tag 后拼合的规范前缀串
 */
export declare function combinePrefixesWithDeduplication(...prefixes: Array<string | undefined>): string;
/**
 * 构建最终提交给驱动的正负向 Prompt 对
 *
 * 处理顺序：
 * 1. 按 `|` 拆分占位符文本为正向词与内嵌负向词
 * 2. 运行所有已注册的扩展 Hook（如角色宏展开）
 * 3. 拼接 Checkpoint 起手式与全局前缀（自动去重重叠 Tag）、处理后正向词、后缀、LoRA
 * 4. 拼接 Checkpoint 负向起手式与全局负向词（自动去重重叠 Tag）、内嵌负向词
 * 5. 对正负向词统一执行 cleanRenderedText 二次清洗
 */
export interface FinalPromptResult {
    /** 提交给生图驱动的完整拼接正向词 */
    positive: string;
    /** 提交给生图驱动的完整拼接负向词 */
    negative: string;
    /** 未经拼接拆解出来的原生正向词 */
    rawPositive: string;
    /** 未经拼接拆解出来的原生负向词 (若无则为 "") */
    rawNegative: string;
}
/**
 * 剥离 LoRA 名称末尾的 .safetensors 或 .ckpt 扩展名
 * 规避 WeiLin 插件 Python 后端固定拼接 .safetensors 导致 double-extension (.safetensors.safetensors) 的致命错误
 */
export declare function stripLoraExtension(name: string): string;
export declare function buildFinalPrompt(promptText: string, settings: DrawAssistantSettings, ctx: PromptContext): Promise<FinalPromptResult>;
//# sourceMappingURL=prompt-pipeline.d.ts.map