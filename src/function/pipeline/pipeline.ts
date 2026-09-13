/**
 * 提示词业务装配流水线 (Prompt Pipeline)
 * 职责：
 * 1. 纯函数式串联提示词清洗、管道符切分、世界书外观标签展开、插件正则规则与画风预设拼装；
 * 2. 宿主原生宏安全委托调用（不自造酒馆宏引擎）；
 * 3. 分离 LoRA 语法与工作流变量，仅输出纯净标准的正负向提示词。
 */

import {
    normalizePromptPunctuation,
    separatePromptByPipe,
    joinPromptParts,
    sanitizeMessageText,
    applyTextReplacements,
    applyRegexRules,
    RegexReplacementRule
} from '../../util/prompt';

export interface MacroMatchContext {
    /** 宏作用的上下文源：楼层消息、世界书词条或用户提示词 */
    source: 'floor_message' | 'world_info' | 'prompt';
    rawText: string;
    messageId?: number;
    characterId?: string | number;
    metadata?: Record<string, unknown>;
}

export interface PluginMacroRule {
    id: string;
    name: string;
    targetScope: 'floor_message' | 'world_info' | 'all';
    ruleType: 'replace' | 'trigger' | 'both';
    pattern: RegExp | string;
    replace?(matched: string, ctx: MacroMatchContext): string;
    onTrigger?(matched: string, ctx: MacroMatchContext): Promise<{ triggered: boolean; action?: string }>;
}

export interface PromptPipelineOptions {
    /** 原始输入提示词（来自楼层提取或用户面板输入） */
    rawPrompt: string;
    /** 原始附加负向词（若有） */
    rawNegativePrompt?: string;
    /** 画风预设质量前缀 */
    prefix?: string;
    /** 画风预设质量后缀 */
    suffix?: string;
    /** 画风预设默认负向词 */
    defaultNegative?: string;
    /** 用户/插件自定义正则清洗规则 */
    regexRules?: RegexReplacementRule[];
    /** 宏/世界书视觉外观替换字典 (如 { '{char_visual}': '1girl, blonde hair' }) */
    macroReplacements?: Record<string, string>;
    /** 插件宏规则集合（可选） */
    macroRules?: PluginMacroRule[];
    /** 宿主原生宏展开器（委托给 SillyTavern.getContext().substituteParams） */
    substituteParamsProvider?: (text: string) => string;
    /** 上下文元数据 */
    context?: MacroMatchContext;
}

export interface ProcessedPromptResult {
    /** 处理并装配完成的正向提示词 */
    positivePrompt: string;
    /** 处理并装配完成的负向提示词 */
    negativePrompt: string;
}

/**
 * 转义正则特殊字符
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 应用宏规则的替换操作
 */
function applyMacroRuleReplacements(
    text: string,
    rules: PluginMacroRule[],
    ctx: MacroMatchContext
): string {
    if (!text || !rules || rules.length === 0) {
        return text;
    }

    let result = text;
    for (const rule of rules) {
        if (rule.ruleType === 'trigger' || typeof rule.replace !== 'function') {
            continue;
        }

        const pattern = typeof rule.pattern === 'string'
            ? new RegExp(escapeRegExp(rule.pattern), 'g')
            : rule.pattern;

        result = result.replace(pattern, (match) => {
            return rule.replace ? rule.replace(match, ctx) : match;
        });
    }

    return result;
}

/**
 * 执行提示词处理流水线
 * 依次执行：干扰过滤 -> 管道符切分 -> 插件正则 -> 世界书外观替换 -> 宿主宏替换 -> 画风预设拼装 -> 标点符号清理与规范化
 */
export function processPrompt(options: PromptPipelineOptions): ProcessedPromptResult {
    const rawInput = options.rawPrompt || '';
    const rawNegative = options.rawNegativePrompt || '';

    // 1. 输入预清洗（剔除思考链、代码块并初步规整标点）
    let positive = normalizePromptPunctuation(sanitizeMessageText(rawInput));
    let negative = normalizePromptPunctuation(sanitizeMessageText(rawNegative));

    // 2. 正负向切分（若输入中包含未转义管道符 |）
    if (positive.includes('|')) {
        const separated = separatePromptByPipe(positive);
        positive = separated.positive;
        negative = joinPromptParts(separated.negative, negative);
    }

    // 3. 插件正则规则清洗（词汇过滤、敏感词处理）
    if (options.regexRules && options.regexRules.length > 0) {
        positive = applyRegexRules(positive, options.regexRules);
        negative = applyRegexRules(negative, options.regexRules);
    }

    // 4. 世界书外观标签与宏字典替换
    if (options.macroReplacements) {
        positive = applyTextReplacements(positive, options.macroReplacements);
        negative = applyTextReplacements(negative, options.macroReplacements);
    }

    // 5. 插件扩展宏规则替换
    if (options.macroRules && options.macroRules.length > 0) {
        const matchContext: MacroMatchContext = options.context || {
            source: 'prompt',
            rawText: rawInput
        };
        positive = applyMacroRuleReplacements(positive, options.macroRules, matchContext);
        negative = applyMacroRuleReplacements(negative, options.macroRules, matchContext);
    }

    // 6. 宿主原生宏安全委托展开
    if (typeof options.substituteParamsProvider === 'function') {
        positive = options.substituteParamsProvider(positive);
        negative = options.substituteParamsProvider(negative);
    }

    // 7. 画风预设装配（质量前缀、后缀、默认负向）
    positive = joinPromptParts(options.prefix, positive, options.suffix);
    negative = joinPromptParts(options.defaultNegative, negative);

    // 8. 标点符号清理与规范化
    positive = normalizePromptPunctuation(positive);
    negative = normalizePromptPunctuation(negative);

    return {
        positivePrompt: positive,
        negativePrompt: negative
    };
}
