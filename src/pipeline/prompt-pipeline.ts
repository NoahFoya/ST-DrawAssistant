/**
 * 提示词预处理与意图解析模块。
 *
 * @remarks
 * 负责从原始输入指令中提取正负向提示词、剥离思考链与代码块干扰、
 * 按配置整理连续重复标点/空行并执行纯英文逗号标签去重，构建 GenerationRequest 请求对象。
 */

import type {
    GenerationRequest,
    ProviderType,
    PresetItem,
    PromptPresetData,
    PromptPollingPoolItem,
    DrawingPresetData,
    ResolvedLoraSpec,
} from '@types';
import { PROMPT_POLLING_PRESET_ID } from '../config/constants';
import { type SettingsStore, settingsStore } from '../store/settings-store';
import {
    normalizePresetNameKey,
    resolveNovelAIModelFamily,
    resolveNovelAIModelName,
    resolveTriggeredLoras,
    supportsLoraSyntax,
} from '../domain';
import { resolvePromptMacros } from './macro-resolver';
import { splitTopLevelTags } from './material-definitions';
import { stripThinkingAndComments } from './prompt-injector';
import { sanitizeLoraPrompts } from './lora-utils';
import { providerRegistry } from '../provider/registry';
import { logger } from '../util/logger';

/** 找到与 startIdx 处 `(` 匹配的闭合 `)` 索引（跳过转义括号） */
function findMatchingParen(src: string, startIdx: number): number {
    let depth = 0;
    let escaped = false;
    for (let i = startIdx; i < src.length; i++) {
        const ch = src[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

/** 格式化权重数值为简洁字符串（最多保留 4 位小数，去除末尾无意义零） */
function formatWeightNumber(weight: number): string {
    return Number(weight.toFixed(4)).toString();
}

/** 计算 NovelAI V3 单层花/方括号数量（官方单层倍率约为 1.05） */
function computeV3BracketCount(weight: number): number {
    if (!Number.isFinite(weight) || weight <= 0 || Math.abs(weight - 1.0) < 1e-6) {
        return 0;
    }
    const rawCount = Math.round(Math.abs(Math.log(weight) / Math.log(1.05)));
    return Math.max(1, Math.min(5, rawCount));
}

/** 将内容包装为 NovelAI V3 `{...}` 或 `[...]` 语法（`weight <= 0` 时返回空串安全剔除） */
function formatV3WeightSyntax(inner: string, weight: number): string {
    const trimmed = inner.trim();
    if (!trimmed || !Number.isFinite(weight)) {
        return trimmed;
    }
    if (weight <= 0) {
        return '';
    }
    if (Math.abs(weight - 1.0) < 1e-6) {
        return trimmed;
    }
    const count = computeV3BracketCount(weight);
    if (count === 0) {
        return trimmed;
    }
    return weight > 1.0
        ? '{'.repeat(count) + trimmed + '}'.repeat(count)
        : '['.repeat(count) + trimmed + ']'.repeat(count);
}

/**
 * 判断起始索引处的 `(` 是否构成多层纯嵌套裸括号 `((tag))`（无 `:weight` 后缀且内外括号一一成对包拢）。
 */
function matchNestedBareParens(
    src: string,
    startIdx: number,
    outerCloseIdx: number
): { depth: number; innerText: string } | null {
    let depth = 0;
    while (startIdx + depth < outerCloseIdx && src[startIdx + depth] === '(') {
        depth++;
    }
    if (depth < 2) {
        return null;
    }
    for (let k = 1; k < depth; k++) {
        if (findMatchingParen(src, startIdx + k) !== outerCloseIdx - k) {
            return null;
        }
    }
    const innerText = src.slice(startIdx + depth, outerCloseIdx - depth + 1);
    if (!innerText.trim() || /:[-+]?\d+(?:\.\d+)?$/.test(innerText.trim())) {
        return null;
    }
    return { depth, innerText };
}

/**
 * 将 WebUI / SD 权重语法转换为 NovelAI 对应模型架构的原生权重语法：
 * - V4 / V4.5 / V5 默认模式：将 `(tag:1.2)`、`(tag:-1)` 与双层及以上裸括号 `((tag))` 转为 `weight::tag::`，
 *   保留单层消歧括号（如 `dino (dinoartforame)`）与既有 `weight::tag::` 区块；
 * - V3 兼容模式：将 `(tag:weight)`、`((tag))` 及 V4 `weight::tag::` 统一转换为以 1.05 倍率校准的 `{tag}` / `[tag]`。
 */
export function convertNovelAIWeightSyntax(
    text: string,
    modelFamily: 'v3' | 'v4' | 'v5' = 'v4'
): string {
    if (!text) return '';

    const isV3 = modelFamily === 'v3';
    let out = '';
    let i = 0;

    while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length) {
            out += text.slice(i, i + 2);
            i += 2;
            continue;
        }

        // 检测既有 `weight::...::` 权重区块（仅当前导位于边界或上一组 `::` 之后）
        const rest = text.slice(i);
        const colonOpenMatch = rest.match(/^([-+]?\d+(?:\.\d+)?)::/);
        if (
            colonOpenMatch &&
            (i === 0 || /(?:^|[,\s]|::)$/.test(text.slice(Math.max(0, i - 2), i)))
        ) {
            const openLen = colonOpenMatch[0].length;
            const closeColonIdx = text.indexOf('::', i + openLen);
            if (closeColonIdx !== -1) {
                const fullBlock = text.slice(i, closeColonIdx + 2);
                if (!isV3) {
                    out += fullBlock;
                } else {
                    const weight = parseFloat(colonOpenMatch[1]);
                    const rawInner = text.slice(i + openLen, closeColonIdx);
                    const convertedInner = convertNovelAIWeightSyntax(rawInner, 'v3').trim();
                    out += formatV3WeightSyntax(convertedInner, weight);
                }
                i = closeColonIdx + 2;
                continue;
            }
        }

        if (text[i] === '(') {
            const closeIdx = findMatchingParen(text, i);
            if (closeIdx > i) {
                const nestedBare = matchNestedBareParens(text, i, closeIdx);
                if (nestedBare) {
                    const weight = Number(Math.pow(1.1, nestedBare.depth).toFixed(2));
                    const convertedInner = convertNovelAIWeightSyntax(
                        nestedBare.innerText,
                        modelFamily
                    ).trim();
                    if (convertedInner) {
                        out += isV3
                            ? formatV3WeightSyntax(convertedInner, weight)
                            : `${formatWeightNumber(weight)}::${convertedInner}::`;
                    }
                    i = closeIdx + 1;
                    continue;
                }

                const inner = text.slice(i + 1, closeIdx);
                const weightMatch = inner.match(/^([\s\S]*):([-+]?\d+(?:\.\d+)?)$/);
                if (weightMatch) {
                    const convertedInner = convertNovelAIWeightSyntax(
                        weightMatch[1],
                        modelFamily
                    ).trim();
                    const weight = parseFloat(weightMatch[2]);
                    if (!convertedInner) {
                        i = closeIdx + 1;
                        continue;
                    }
                    if (!Number.isFinite(weight)) {
                        out += `(${convertNovelAIWeightSyntax(inner, modelFamily)})`;
                        i = closeIdx + 1;
                        continue;
                    }
                    if (isV3) {
                        out += formatV3WeightSyntax(convertedInner, weight);
                    } else if (Math.abs(weight - 1.0) < 1e-6) {
                        out += convertedInner;
                    } else {
                        out += `${formatWeightNumber(weight)}::${convertedInner}::`;
                    }
                    i = closeIdx + 1;
                    continue;
                }

                out += `(${convertNovelAIWeightSyntax(inner, modelFamily)})`;
                i = closeIdx + 1;
                continue;
            }
        }

        out += text[i];
        i++;
    }

    return out;
}

/** 提示词轮询候选池解析结果 */
export interface ResolvedPromptPollingResult {
    readonly isPolling: boolean;
    readonly hasExplicitPool: boolean;
    readonly candidates: PresetItem<PromptPresetData>[];
    readonly missingEntries: PromptPollingPoolItem[];
}

/**
 * 统一解析指定生图参数预设的提示词轮询候选预设列表与失效项（供预处理管线、资产校验与 UI 共用）。
 */
export function resolvePromptPollingCandidates(
    store: Pick<SettingsStore, 'getPresets'>,
    provider: ProviderType,
    drawingPreset?: DrawingPresetData | null
): ResolvedPromptPollingResult {
    const isPolling = drawingPreset?.promptPresetId === PROMPT_POLLING_PRESET_ID;
    const pool = Array.isArray(drawingPreset?.promptPollingPool)
        ? drawingPreset.promptPollingPool
        : [];
    const hasExplicitPool = pool.length > 0;
    const allPrompts =
        typeof store.getPresets === 'function'
            ? store.getPresets<PromptPresetData>('prompts', provider)
            : [];

    if (!isPolling) {
        return { isPolling: false, hasExplicitPool, candidates: [], missingEntries: [] };
    }

    if (!hasExplicitPool) {
        return {
            isPolling: true,
            hasExplicitPool: false,
            candidates: [...allPrompts],
            missingEntries: [],
        };
    }

    const byId = new Map(allPrompts.map((p) => [p.id, p]));
    const byName = new Map(
        allPrompts
            .filter((p) => Boolean(p.name?.trim()))
            .map((p) => [normalizePresetNameKey(p.name), p])
    );

    const candidates: PresetItem<PromptPresetData>[] = [];
    const seenIds = new Set<string>();
    const missingEntries: PromptPollingPoolItem[] = [];

    for (const entry of pool) {
        if (!entry) continue;
        const matched =
            byId.get(entry.presetId) ??
            (entry.presetName ? byName.get(normalizePresetNameKey(entry.presetName)) : undefined);
        if (!matched) {
            missingEntries.push(entry);
            continue;
        }
        if (entry.enabled !== false && !seenIds.has(matched.id)) {
            seenIds.add(matched.id);
            candidates.push(matched);
        }
    }

    return {
        isPolling: true,
        hasExplicitPool: true,
        candidates,
        missingEntries,
    };
}

/**
 * 解析当前生效生图参数预设用于资产/LoRA 校验的关联提示词预设列表（统一支持固定预设与轮询模式）。
 */
export function resolveEffectivePromptPresetsForValidation(
    store: Pick<SettingsStore, 'getPreset' | 'getPresets'>,
    provider: ProviderType,
    drawingPreset?: DrawingPresetData | null
): PromptPresetData[] {
    const pid = drawingPreset?.promptPresetId;
    if (!pid) return [];
    if (pid === PROMPT_POLLING_PRESET_ID) {
        return resolvePromptPollingCandidates(store, provider, drawingPreset).candidates.map(
            (item) => item.data
        );
    }
    const pp = store.getPreset<PromptPresetData>('prompts', pid, provider);
    return pp ? [pp.data] : [];
}

/**
 * 合并预设通用负向提示词与用户自定义负向提示词并去重。
 *
 * @param presetNegative 预设通用负向提示词
 * @param userNegative 用户特定排除负向提示词
 * @returns 合并去重后的负向提示词字符串
 */
export function mergeNegativePrompts(
    presetNegative?: string,
    userNegative?: string,
    deduplicateOrOptions: boolean | CleanPromptOptions = true,
    normalizeChinesePunctuation = false
): string {
    const cleanOptions: CleanPromptOptions =
        typeof deduplicateOrOptions === 'boolean'
            ? {
                  deduplicate: deduplicateOrOptions,
                  cleanPunctuation: true,
                  normalizeChinesePunctuation,
              }
            : deduplicateOrOptions;
    const p1 = (presetNegative ?? '').trim();
    const p2 = (userNegative ?? '').trim();
    if (!p1 && !p2) return '';
    if (!p1) return cleanPromptText(p2, cleanOptions);
    if (!p2) return cleanPromptText(p1, cleanOptions);

    return cleanPromptText(joinPromptSegment(p1, p2), cleanOptions);
}

/**
 * 提示词通用拼接工具函数。
 *
 * @remarks
 * 过滤空值与空白字符串，并以英文逗号及空格 (, ) 进行连接，不改动词序与大小写。
 *
 * @param parts 待拼接的文本片段列表
 * @returns 逗号连接后的提示词字符串
 */
export function joinPromptParts(...parts: Array<string | undefined | null>): string {
    return parts
        .map((p) => (p ?? '').trim())
        .filter(Boolean)
        .join(', ');
}

/**
 * 过滤消息文本中的干扰标签。
 *
 * @remarks
 * 剥离 HTML 注释、已闭合与未闭合的大模型思考链 (<think>...</think>) 以及代码块，
 * 避免模型思考草稿与大段代码块干扰提取或混入生图提示词；不误删正文行内反引号内容。
 *
 * @param rawText 原始文本
 * @returns 净化后的文本
 */
function sanitizeMessageText(rawText: string): string {
    if (!rawText || typeof rawText !== 'string') {
        return '';
    }

    // 1. 复用公共规则剥离 HTML 注释与 <think>/<thinking> 思考链
    let text = stripThinkingAndComments(rawText);
    // 2. 剥离围栏代码块与代码标签
    text = text.replace(/<pre[\s\S]*?<\/pre>/gi, '');
    text = text.replace(/<code[\s\S]*?<\/code>/gi, '');
    text = text.replace(/```[\s\S]*?```/g, '');

    return text.trim();
}

/** 在 `<...>` 语法标签外部将中文全角逗号与顿号替换为英文半角逗号 */
function replaceChineseCommasOutsideTags(line: string): string {
    let result = '';
    let angle = 0;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '<') {
            angle++;
            result += ch;
        } else if (ch === '>') {
            angle = Math.max(0, angle - 1);
            result += ch;
        } else if (angle === 0 && (ch === '，' || ch === '、')) {
            result += ', ';
            while (i + 1 < line.length && (line[i + 1] === ' ' || line[i + 1] === '\t')) {
                i++;
            }
        } else {
            result += ch;
        }
    }
    return result;
}

/** 仅折叠连续重复的同类分隔与句读标点（保留 `::` 权重边界与 `...`/`……` 省略号） */
function collapseDuplicatePunctuation(line: string): string {
    return line
        .replace(/,[ \t]*(?:,[ \t]*)+/g, ', ')
        .replace(/，(?:[ \t]*，)+/g, '，')
        .replace(/、(?:[ \t]*、)+/g, '、')
        .replace(/。(?:[ \t]*。)+/g, '。')
        .replace(/；(?:[ \t]*；)+/g, '；')
        .replace(/;(?:[ \t]*;)+/g, ';')
        .replace(/！(?:[ \t]*！)+/g, '！')
        .replace(/？(?:[ \t]*？)+/g, '？')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

/** 判断逗号切分后的词元是否为纯英文短标签并返回去重键，非纯英文短标签返回 null 以原样保留 */
function getAsciiTagDedupeKey(token: string): string | null {
    if (!token) return null;
    if (/[^\x20-\x7E]/.test(token)) {
        return null;
    }

    const isLoraTag = /^<(?:lora|wlr):/i.test(token) && token.endsWith('>');
    if (isLoraTag) {
        return token.replace(/\\/g, '/').toLowerCase();
    }
    if (token.startsWith('<') && token.endsWith('>')) {
        return token;
    }

    // 保留 NovelAI 复合权重容器（含内部逗号）以及句末带句读符号的自然语言完整分句
    if (token.includes('::') && token.includes(',')) {
        return null;
    }
    if (/[.!?;]$/.test(token) && !/[>)]$/.test(token) && !token.endsWith('::')) {
        return null;
    }

    const wordCount = token.trim().split(/\s+/).length;
    if (wordCount > 5) {
        return null;
    }
    return token.toLowerCase();
}

/** 提示词清理与标点整理选项 */
export interface CleanPromptOptions {
    /** 是否执行纯英文逗号标签保序去重，默认为 false */
    readonly deduplicate?: boolean;
    /** 是否自动整理连续重复标点、多余逗号并去除多余空白行，默认为 true */
    readonly cleanPunctuation?: boolean;
    /** 是否将中文全角逗号与顿号规整为英文半角逗号，默认为 false */
    readonly normalizeChinesePunctuation?: boolean;
}

/**
 * 统一规范化提示词文本：按需执行标点与空行整理（清除空白行并保留单次换行）、纯英文逗号标签去重，以及中文标点转换。
 *
 * @param rawPrompt 原始提示词文本
 * @param deduplicateOrOptions 布尔值（兼容旧签名：是否去重）或清理选项对象
 * @param normalizeChinesePunctuation 是否将中文全角逗号与顿号规整为英文半角逗号，默认为 false
 * @returns 规整后的提示词文本
 */
export function cleanPromptText(
    rawPrompt: string,
    deduplicateOrOptions: boolean | CleanPromptOptions = false,
    normalizeChinesePunctuation = false
): string {
    if (!rawPrompt || typeof rawPrompt !== 'string') {
        return '';
    }

    const deduplicate =
        typeof deduplicateOrOptions === 'boolean'
            ? deduplicateOrOptions
            : Boolean(deduplicateOrOptions?.deduplicate);
    const cleanPunctuation =
        typeof deduplicateOrOptions === 'boolean'
            ? true
            : deduplicateOrOptions?.cleanPunctuation !== false;
    const normalizeZh =
        typeof deduplicateOrOptions === 'boolean'
            ? normalizeChinesePunctuation
            : Boolean(deduplicateOrOptions?.normalizeChinesePunctuation);

    const normalizedLines = rawPrompt.replace(/\r\n?/g, '\n').split('\n');
    while (normalizedLines.length > 0 && !normalizedLines[0].trim()) {
        normalizedLines.shift();
    }
    while (normalizedLines.length > 0 && !normalizedLines[normalizedLines.length - 1].trim()) {
        normalizedLines.pop();
    }
    if (normalizedLines.length === 0) {
        return '';
    }

    if (!deduplicate && !cleanPunctuation && !normalizeZh) {
        return normalizedLines.join('\n').trim();
    }

    const workingLines = cleanPunctuation
        ? normalizedLines.filter((line) => Boolean(line.trim()))
        : normalizedLines;
    const seenAsciiTags = new Set<string>();
    const processedLines: string[] = [];

    for (let i = 0; i < workingLines.length; i++) {
        let line = workingLines[i].trim();
        if (!line) {
            processedLines.push('');
            continue;
        }

        if (normalizeZh) {
            line = replaceChineseCommasOutsideTags(line);
        }
        if (cleanPunctuation) {
            line = collapseDuplicatePunctuation(line);
        }

        if (!deduplicate && !cleanPunctuation) {
            processedLines.push(line);
            continue;
        }

        const hasTrailingComma = line.endsWith(',');
        const nextLineHasContent = i + 1 < workingLines.length && workingLines[i + 1].trim().length > 0;
        const segments = splitTopLevelTags(line, false);
        const keptTokens: string[] = [];

        for (const token of segments) {
            if (!token) continue;
            if (deduplicate) {
                const dedupeKey = getAsciiTagDedupeKey(token);
                if (dedupeKey !== null) {
                    if (seenAsciiTags.has(dedupeKey)) {
                        continue;
                    }
                    seenAsciiTags.add(dedupeKey);
                }
            }
            keptTokens.push(token);
        }

        if (keptTokens.length === 0) {
            continue;
        }

        let formattedLine = keptTokens.join(', ');
        if (hasTrailingComma && nextLineHasContent) {
            formattedLine += ',';
        }
        processedLines.push(formattedLine);
    }

    return processedLines.join('\n').trim();
}

/**
 * 统一提示词片段拼接：若前段以中英文句末/分句标点结尾则直接空格连接，否则补英文逗号后连接。
 */
export function joinPromptSegment(head: string, tail: string): string {
    const a = head.trim();
    const b = tail.trim();
    if (!a) return b;
    if (!b) return a;
    if (/[.,;:!?\n，。、；：！？…—]$/.test(a) || /(?<=[.,!?。！？])['"”’]$/.test(a)) {
        return `${a} ${b}`;
    }
    return `${a}, ${b}`;
}

/** 楼层中提取出的生图指令描述 */
export interface ExtractedDrawingCommand {
    rawMatch: string;
    promptText: string;
    instructionIndex: number;
}

/**
 * 从文本中扫描并提取生图指令。
 * @param text 消息原文
 * @param startTag 起始标签 (默认 'image###')
 * @param endTag 结束标签 (默认 '###')
 */
export function extractDrawingCommands(
    text: string,
    startTag = 'image###',
    endTag = '###'
): ExtractedDrawingCommand[] {
    if (!text) return [];

    // 配置为空或仅含空白时回退至默认指令标签
    const cleanStart = (startTag || '').trim() || 'image###';
    const cleanEnd = (endTag || '').trim() || '###';

    // 先行清洗思考链与代码块干扰，避免模型在思考草稿中留下的伪指令被错误提取
    const sanitizedText = sanitizeMessageText(text);

    const commands: ExtractedDrawingCommand[] = [];
    const escapedStart = cleanStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = cleanEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 第一分支跳过成对 Markdown 行内反引号示例（含双反引号），第二分支严格以成对生图起止标记匹配（支持内部换行与空行，仅防范跨入同级起始符或思考链边界）
    const regex = new RegExp(
        `(?<!\`)(\`+)(?:[^\\n\`]|(?!\\1)\`)*?\\1(?!\`)|(?<!\`)${escapedStart}((?:(?!${escapedStart}|<\\/?(?:think|thinking|thought|imagethink|designthink)\\b)[\\s\\S])*?)${escapedEnd}(?!\`)`,
        'gi'
    );

    let match: RegExpExecArray | null;
    let idx = 0;
    let lastIndexBeforeMatch = -1;
    while ((match = regex.exec(sanitizedText)) !== null) {
        // 零宽匹配处理：若正则游标未向前推进，步进一位避免死循环
        if (regex.lastIndex === lastIndexBeforeMatch) {
            regex.lastIndex++;
        }
        lastIndexBeforeMatch = regex.lastIndex;

        if (match[1]) {
            continue;
        }
        const promptText = (match[2] || '').trim();
        if (promptText) {
            commands.push({
                rawMatch: match[0],
                promptText,
                instructionIndex: idx++,
            });
        }
    }

    return commands;
}

/**
 * 按照首个英文管道符 `|` 分离正向提示词与负向提示词。
 *
 * @remarks
 * 遵循业界常规约定：首个管道符左侧为正向提示词，右侧为负向提示词。
 * 若不存在管道符，则全量文本视为正向提示词，负向词为空字符串。
 *
 * @param input 原始输入文本
 * @returns 正向与负向提示词对象
 */
export function separatePromptByPipe(input: string): { positive: string; negative: string } {
    const safe = (input ?? '').trim();
    let paren = 0;
    let square = 0;
    let curly = 0;
    let angle = 0;
    let escaped = false;
    let pipeIndex = -1;

    for (let i = 0; i < safe.length; i++) {
        const ch = safe[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '(') paren++;
        else if (ch === ')') paren = Math.max(0, paren - 1);
        else if (ch === '[') square++;
        else if (ch === ']') square = Math.max(0, square - 1);
        else if (ch === '{') curly++;
        else if (ch === '}') curly = Math.max(0, curly - 1);
        else if (ch === '<') {
            // 仅当同一行内存在配对的闭合 '>' 且未跨越 '|' 时视为尖括号语法块（如 <lora:...>），防止孤立 '<3' 吞掉分隔符
            const closeIdx = safe.indexOf('>', i + 1);
            if (closeIdx !== -1) {
                const segment = safe.slice(i + 1, closeIdx);
                if (!/[\r\n|]/.test(segment)) {
                    angle++;
                }
            }
        } else if (ch === '>') angle = Math.max(0, angle - 1);
        else if (
            ch === '|' &&
            paren === 0 &&
            square === 0 &&
            curly === 0 &&
            angle === 0
        ) {
            pipeIndex = i;
            break;
        }
    }

    if (pipeIndex !== -1) {
        return {
            positive: safe.substring(0, pipeIndex).trim(),
            negative: safe.substring(pipeIndex + 1).trim(),
        };
    }

    return {
        positive: safe,
        negative: '',
    };
}

/**
 * 构建提示词请求的入参配置项。
 */
export interface BuildPromptOptions {
    /** 用户原始输入或楼层提取文本 */
    rawPrompt: string;
    /** 提示词编译模式：'raw' 执行预设拼接/宏展开/LoRA触发解析；'final' 直发终稿不二次叠加预设 */
    promptMode?: 'raw' | 'final';
    /** 可选显式继承的结构化 LoRA 列表（常用于 'final' 模式原参数复现） */
    explicitLoras?: readonly ResolvedLoraSpec[];
    /** 可选保留的源原始正向提示词（用于在 'final' 重绘后仍保留 rawPrompt 溯源） */
    originRawPrompt?: string;
    /** 可选保留的源原始负向提示词 */
    originRawNegativePrompt?: string;
    /** 可选的图生图原图数据（Blob 或 Base64 字符串） */
    sourceImage?: Blob | string;
    /** 可选的局部重绘蒙版遮罩数据（Blob 或 Base64 字符串） */
    maskImage?: Blob | string;
    /** 可选的单次调用覆盖参数（优先于预设参数） */
    parameters?: Record<string, unknown>;
    /** 目标生图服务提供方类型 */
    providerType?: ProviderType;
}

/**
 * 提示词预处理器。
 */
export class PromptPipeline {
    private readonly _settingsStore: SettingsStore;
    private readonly _lastPolledByProvider = new Map<ProviderType, string>();

    public constructor(settingsStoreInstance?: SettingsStore) {
        this._settingsStore = settingsStoreInstance ?? settingsStore;
    }

    /**
     * 解析原始提示词、展开素材宏、应用预设并装配 GenerationRequest 请求对象：
     * 1. 过滤干扰标签（思考链、代码块）；
     * 2. 分离正负向提示词；
     * 3. 解析与展开本地素材库宏 ($名称$ 与 $名称-部位$)；
     * 4. 解析关联的提示词与生图参数预设；
     * 5. 应用预设前缀、后缀与通用负向词；
     * 6. 依据后端能力分流组装 LoRA 词条；
     * 7. NovelAI 权重括号语法转换；
     * 8. 剥离不支持后端的残留 LoRA 标签；
     * 9. 按独立开关规整文本（纯英文逗号标签去重、多余标点与空行清理、中文标点转换）。
     *
     * @param options 处理配置项
     * @returns 装配好的生图请求对象
     */
    public buildGenerationRequest(options: BuildPromptOptions): GenerationRequest {
        const currentSettings = this._settingsStore.getSettings();
        const shouldDeduplicate = Boolean(currentSettings?.cleanPrompt);
        const shouldCleanPunctuation = currentSettings?.cleanPromptPunctuation !== false;
        const normalizeChinesePunctuation = Boolean(currentSettings?.normalizeChinesePunctuation);
        const provider = options.providerType;
        const params = options.parameters || {};
        const isFinalMode = options.promptMode === 'final';

        const supportsNegative = provider
            ? providerRegistry.getProvider(provider)?.supportsNegativePrompt !== false
            : true;

        // 1 & 2. 根据提示词模式解析正负向基础文本：
        // - 'raw' 模式：清洗思考链/代码块后按顶层 `|` 分离正负向并合并参数负向词；
        // - 'final' 模式：直收弹窗确认后的终稿正文，不再剥离代码块或按 `|` 拆切。
        let rawPositive = '';
        let combinedNegative = '';
        if (isFinalMode) {
            rawPositive = typeof options.rawPrompt === 'string' ? options.rawPrompt : '';
            combinedNegative =
                supportsNegative && typeof params.negativePrompt === 'string'
                    ? params.negativePrompt.trim()
                    : '';
        } else {
            const sanitizedRaw = sanitizeMessageText(options.rawPrompt);
            const { positive: parsedPositive, negative: parsedNegative } =
                separatePromptByPipe(sanitizedRaw);
            rawPositive = parsedPositive;
            const rawNegative = supportsNegative ? parsedNegative : '';
            const paramNegative =
                supportsNegative && typeof params.negativePrompt === 'string'
                    ? params.negativePrompt.trim()
                    : '';
            combinedNegative = [rawNegative, paramNegative].filter(Boolean).join(', ');
        }

        const rawPositiveInput =
            isFinalMode &&
            typeof options.originRawPrompt === 'string' &&
            options.originRawPrompt.trim()
                ? options.originRawPrompt.trim()
                : rawPositive.trim();
        const rawNegativeInput =
            isFinalMode &&
            supportsNegative &&
            typeof options.originRawNegativePrompt === 'string' &&
            options.originRawNegativePrompt.trim()
                ? options.originRawNegativePrompt.trim()
                : combinedNegative.trim();

        // 3. 展开本地素材库宏 ($ID$ / $ID-key1-key2$)
        let positive = rawPositive;
        let negative = combinedNegative;

        const allUnresolvedMacros: string[] = [];

        const applyMaterialMacros = (input: string): string => {
            if (!input || !input.includes('$')) {
                return input;
            }
            const res = resolvePromptMacros(input, currentSettings);
            if (res.unresolvedMacros.length > 0) {
                allUnresolvedMacros.push(...res.unresolvedMacros);
            }
            return res.text;
        };

        positive = applyMaterialMacros(positive);
        negative = applyMaterialMacros(negative);
        // 保留仅包含当次生图正文与素材宏展开的快照，供关键词触发 LoRA 判定（不纳入预设自身前后缀）
        const macroExpandedPositive = positive;

        // 4. 解析关联的生图参数预设与提示词预设（'final' 模式跳过提示词预设双拼，仅保留必要参数/语法参考）
        let promptPreset: PromptPresetData | undefined;
        let drawingPreset: DrawingPresetData | undefined;
        let resolvedPromptPresetId: string | undefined;
        let resolvedPromptPresetName: string | undefined;
        let promptPresetId =
            !isFinalMode &&
            typeof params.promptPresetId === 'string' &&
            params.promptPresetId.trim()
                ? params.promptPresetId.trim()
                : undefined;
        if (provider) {
            const explicitDrawingId =
                typeof params.drawingPresetId === 'string' && params.drawingPresetId.trim()
                    ? params.drawingPresetId.trim()
                    : undefined;
            const resolved = this._settingsStore.resolveDrawingPreset<DrawingPresetData>(provider, {
                explicitPresetId: explicitDrawingId,
                throwOnMissingActive: !isFinalMode,
            });
            drawingPreset = resolved.preset;
            if (!isFinalMode && !promptPresetId) {
                promptPresetId = drawingPreset?.promptPresetId;
            }
        }
        if (!isFinalMode && promptPresetId === PROMPT_POLLING_PRESET_ID) {
            if (!provider) {
                throw new Error('使用提示词轮询时必须指定生图后端 (provider)');
            }
            const pollingInfo = resolvePromptPollingCandidates(
                this._settingsStore,
                provider,
                drawingPreset
            );
            if (pollingInfo.candidates.length === 0) {
                throw new Error(
                    pollingInfo.hasExplicitPool
                        ? '提示词轮询池中暂无已启用的有效预设，请在生图参数预设的轮询面板中勾选至少一项提示词预设'
                        : '当前暂无已启用的提示词预设可供轮询，请至少启用一项提示词预设'
                );
            }
            const lastId = this._lastPolledByProvider.get(provider);
            const pickPool =
                pollingInfo.candidates.length >= 2 && lastId
                    ? pollingInfo.candidates.filter((c) => c.id !== lastId)
                    : pollingInfo.candidates;
            const poolToUse = pickPool.length > 0 ? pickPool : pollingInfo.candidates;
            const chosen = poolToUse[Math.floor(Math.random() * poolToUse.length)];
            this._lastPolledByProvider.set(provider, chosen.id);
            promptPreset = chosen.data;
            resolvedPromptPresetId = chosen.id;
            resolvedPromptPresetName = chosen.name;
        } else if (!isFinalMode && promptPresetId) {
            const pp = this._settingsStore.getPreset<PromptPresetData>('prompts', promptPresetId, provider);
            if (!pp) {
                throw new Error(`关联的提示词预设已失效或不存在 (ID: ${promptPresetId})，请重新选择预设`);
            }
            promptPreset = pp.data;
            resolvedPromptPresetId = pp.id;
            resolvedPromptPresetName = pp.name;
        }

        // 5. 应用提示词预设（'final' 模式下跳过前后缀拼接，优先继承显式传递的 LoRA 快照）
        let resolvedLoras: ResolvedLoraSpec[] =
            isFinalMode && Array.isArray(options.explicitLoras) && supportsLoraSyntax(provider)
                ? [...options.explicitLoras]
                : [];
        if (promptPreset) {
            const prefix = applyMaterialMacros((promptPreset.positivePrefix || '').trim());
            const suffix = applyMaterialMacros((promptPreset.positiveSuffix || '').trim());
            const defaultNeg = applyMaterialMacros((promptPreset.negativePrompt || '').trim());

            if (prefix) {
                positive = joinPromptSegment(prefix, positive);
            }

            // 6. 对支持 LoRA 的后端（SD-WebUI / ComfyUI）筛选当次触发的结构化 LoRA 列表，交由各 Provider 按实际工作流/协议转译
            if (Array.isArray(promptPreset.loras) && promptPreset.loras.length > 0 && supportsLoraSyntax(provider)) {
                resolvedLoras = resolveTriggeredLoras(
                    promptPreset.loras,
                    rawPositiveInput,
                    macroExpandedPositive
                );
            }

            if (suffix) {
                positive = joinPromptSegment(positive, suffix);
            }
            if (supportsNegative && defaultNeg) {
                negative = mergeNegativePrompts(defaultNeg, negative, {
                    deduplicate: shouldDeduplicate,
                    cleanPunctuation: shouldCleanPunctuation,
                    normalizeChinesePunctuation,
                });
            }
        }

        if (allUnresolvedMacros.length > 0) {
            const uniqueUnresolved = Array.from(new Set(allUnresolvedMacros));
            logger.warn(`未找到角色/服装宏定义：${uniqueUnresolved.map((m) => `$${m}$`).join(', ')}`);
        }

        // 7. 若为 NovelAI，按模型族转换权重语法（V4/V4.5/V5 默认转为原生 weight::tag::；V3 兼容转为 {}/[]）
        if (provider === 'novelai') {
            const enableConvertSyntax = (params.convertSyntax ?? drawingPreset?.convertSyntax) !== false;
            if (enableConvertSyntax) {
                const resolvedModel = resolveNovelAIModelName(params, drawingPreset);
                const modelFamily = resolveNovelAIModelFamily(resolvedModel);
                positive = convertNovelAIWeightSyntax(positive, modelFamily);
                if (negative) {
                    negative = convertNovelAIWeightSyntax(negative, modelFamily);
                }
            }
        }

        // 8. 针对不支持 LoRA 的后端（NovelAI、OpenAI、Gemini、Grok），自动剥离残留的手写 <lora:...> 与 <wlr:...> 并显式提醒
        if (provider && !supportsLoraSyntax(provider)) {
            const sanitized = sanitizeLoraPrompts(positive, negative, {
                allowLora: false,
                allowWlr: false,
                sourceLabel: `${provider} 服务`,
                guidance: '当前绘图服务不支持 LoRA 语法',
            });
            positive = sanitized.positivePrompt;
            if (negative) {
                negative = sanitized.negativePrompt;
            }
        }

        // 9. 统一规整文本：'raw' 模式按独立开关规整；'final' 模式完整保留终稿措辞顺序，仅做首尾空白裁剪
        const cleanOptions: CleanPromptOptions = {
            deduplicate: shouldDeduplicate,
            cleanPunctuation: shouldCleanPunctuation,
            normalizeChinesePunctuation,
        };
        const cleanPositive = isFinalMode ? positive.trim() : cleanPromptText(positive, cleanOptions);
        const cleanNegative = isFinalMode ? negative.trim() : cleanPromptText(negative, cleanOptions);

        return {
            prompt: cleanPositive,
            negativePrompt: cleanNegative || undefined,
            rawPrompt: rawPositiveInput,
            rawNegativePrompt: rawNegativeInput || undefined,
            loras: resolvedLoras.length > 0 ? resolvedLoras : undefined,
            sourceImage: options.sourceImage ?? (params.sourceImage as Blob | string | undefined),
            maskImage: options.maskImage ?? (params.maskImage as Blob | string | undefined),
            resolvedPromptPresetId,
            resolvedPromptPresetName,
            parameters: options.parameters,
        };
    }

    /**
     * 从文本中提取符合当前指令标签配置的全部生图指令
     * @param text 消息原文
     */
    public extractCommands(text: string): ExtractedDrawingCommand[] {
        const settings = this._settingsStore.getSettings();
        const startTag = settings?.promptStartTag || 'image###';
        const endTag = settings?.promptEndTag || '###';
        return extractDrawingCommands(text, startTag, endTag);
    }
}

/** 全局默认提示词预处理器实例 */
export const promptPipeline = new PromptPipeline();
