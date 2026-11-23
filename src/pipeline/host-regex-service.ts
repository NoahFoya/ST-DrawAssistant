/**
 * 酒馆宿主原生全局正则持久化同步服务 (HostRegexService)。
 *
 * @remarks
 * 负责将插件「绘图与设计思考显示（显示 / 折叠 / 隐藏）」、「清理历史绘图与设计思考」及「清理历史生图与档案标记」三项配置，
 * 直接幂等同步至 SillyTavern 原生 `extensionSettings.regex` 全局正则脚本列表中：
 * 1. 跨禁用持久生效：正则条目直接保存在酒馆宿主全局正则库内，即使本插件被关闭或禁用，隐藏与历史清洗正则在酒馆内依然有效；
 * 2. 思维链显示控制 (`st_da_regex_thinking_display`)：
 *    - 仅格式化前端消息显示 (`markdownOnly: true, promptOnly: false, placement: [2]`)，不修改聊天原文；
 *    - `'collapse'` 模式将 `<imagethink>` / `<designthink>` 渲染为 `<details>` 折叠栏；
 *    - `'hide'` 模式将其替换为空字符串；
 *    - `'show'` 模式从 `extensionSettings.regex` 中移除该条目。
 * 3. 清理历史绘图与设计思考 (`st_da_regex_history_clean_thinking`)：
 *    - 仅在拼装发送给目标 AI 的上下文提示词时生效 (`promptOnly: true, markdownOnly: false, placement: [2], minDepth: 0`)；
 *    - 独立剥离历史消息中的 `<imagethink>...</imagethink>` 与 `<designthink>...</designthink>` 闭合块。
 * 4. 清理历史生图与档案标记 (`st_da_regex_history_clean_markup`)：
 *    - 仅在拼装发送给目标 AI 的上下文提示词时生效 (`promptOnly: true, markdownOnly: false, placement: [2], minDepth: 0`)；
 *    - 动态联动当前配置的生图起止标记 (`promptStartTag` / `promptEndTag`) 与素材档案提取起止标记，
 *      独立剥离历史消息中的 `image###...###` 及 `<character>` / `<outfit>` 块，
 *      既消除历史标记对上下文的占用，又保留前端历史楼层的生图按钮、已生成图片与档案胶囊。
 */

import type { ThinkingDisplayMode } from '@types';
import {
    settingsStore,
    type DrawAssistantSettings,
    type SettingsStore,
} from '../store/settings-store';
import { resolveActiveMaterialExtractionConfig } from './material-definitions';
import { logger } from '../util/logger';

/** 绘图与设计思维链显示控制正则固定唯一 ID */
export const THINKING_DISPLAY_REGEX_ID = 'st_da_regex_thinking_display';

/** 清理历史绘图与设计思考正则固定唯一 ID */
export const HISTORY_CLEAN_THINKING_REGEX_ID = 'st_da_regex_history_clean_thinking';

/** 清理历史生图与档案标记正则固定唯一 ID */
export const HISTORY_CLEAN_MARKUP_REGEX_ID = 'st_da_regex_history_clean_markup';

/** 酒馆原生 Regex 扩展的作用目标枚举：2 = AI_OUTPUT */
const REGEX_PLACEMENT_AI_OUTPUT = 2;

/** SillyTavern 原生 RegexScriptData 数据结构 */
export interface HostRegexScriptData {
    id: string;
    scriptName: string;
    findRegex: string;
    replaceString: string;
    trimStrings: string[];
    placement: number[];
    disabled: boolean;
    markdownOnly: boolean;
    promptOnly: boolean;
    runOnEdit: boolean;
    substituteRegex: number;
    minDepth: number | null;
    maxDepth: number | null;
}

function escapeRegexPattern(raw: string): string {
    return raw.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * 构建用于匹配自定义档案成对起止标记的正则分支（排除反引号包裹，禁止跨越同级起始符与思考链边界）。
 */
function buildPairedArchiveTagBranch(startTag: string, endTag: string): string | null {
    const cleanStart = (startTag || '').trim();
    const cleanEnd = (endTag || '').trim();
    if (!cleanStart || !cleanEnd || cleanStart.toLowerCase() === cleanEnd.toLowerCase()) {
        return null;
    }
    const escapedStart = escapeRegexPattern(cleanStart);
    const escapedEnd = escapeRegexPattern(cleanEnd);
    return `(?<!\`)${escapedStart}(?:(?!${escapedStart}|<\\/?(?:think|thinking|thought|imagethink|designthink)\\b)[\\s\\S])*?${escapedEnd}(?!\`)`;
}

/**
 * 构建用于匹配生图指令成对起止标记的正则分支：
 * - 排除反引号包裹的行内代码说明；
 * - 禁止跨越同级起始符、主思维链/绘图思考链标签边界以及多段空行，防止草稿中孤立标签跨段落误吞正文或匹配 Markdown 标题。
 */
function buildPairedDrawingTagBranch(startTag: string, endTag: string): string | null {
    const cleanStart = (startTag || '').trim();
    const cleanEnd = (endTag || '').trim();
    if (!cleanStart || !cleanEnd || cleanStart.toLowerCase() === cleanEnd.toLowerCase()) {
        return null;
    }
    const escapedStart = escapeRegexPattern(cleanStart);
    const escapedEnd = escapeRegexPattern(cleanEnd);
    return `(?<!\`)${escapedStart}(?:(?!${escapedStart}|<\\/?(?:think|thinking|thought|imagethink|designthink)\\b|\\r?\\n\\s*\\r?\\n)[^\`])*?${escapedEnd}(?!\`)`;
}

/**
 * 构建「绘图与设计思考显示控制」酒馆原生正则脚本对象。
 * 当 `mode === 'show'` 时返回 `null`（表示应从宿主全局正则列表中移除）。
 */
export function buildThinkingDisplayRegexScript(
    mode: ThinkingDisplayMode | undefined
): HostRegexScriptData | null {
    if (mode !== 'collapse' && mode !== 'hide') {
        return null;
    }

    const findRegex =
        '/(?<!`)<(imagethink|designthink)\\b[^>]*>((?:(?!<(?:imagethink|designthink)\\b|<\\/?(?:think|thinking|thought)\\b)[\\s\\S])*?)<\\/\\1\\s*>(?!`)/gi';
    const replaceString =
        mode === 'collapse'
            ? '<details><summary>绘画与设计思考</summary>\n$2\n</details>'
            : '';

    return {
        id: THINKING_DISPLAY_REGEX_ID,
        scriptName: 'ST-DrawAssistant · 绘图与设计思考显示控制',
        findRegex,
        replaceString,
        trimStrings: [],
        placement: [REGEX_PLACEMENT_AI_OUTPUT],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    };
}

/**
 * 构建「清理历史绘图与设计思考」酒馆原生正则脚本对象。
 * 当 `cleanHistoryThinking !== true` 时返回 `null`（表示应从宿主全局正则列表中移除）。
 */
export function buildHistoryCleanThinkingRegexScript(
    cleanHistoryThinking: boolean | undefined
): HostRegexScriptData | null {
    if (!cleanHistoryThinking) {
        return null;
    }

    const findRegex =
        '/(?<!`)<(imagethink|designthink)\\b[^>]*>(?:(?!<(?:imagethink|designthink)\\b|<\\/?(?:think|thinking|thought)\\b)[\\s\\S])*?<\\/\\1\\s*>(?!`)/gi';

    return {
        id: HISTORY_CLEAN_THINKING_REGEX_ID,
        scriptName: 'ST-DrawAssistant · 清理历史绘图与设计思考',
        findRegex,
        replaceString: '',
        trimStrings: [],
        placement: [REGEX_PLACEMENT_AI_OUTPUT],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: 0,
        maxDepth: null,
    };
}

/**
 * 构建「清理历史生图与档案标记」酒馆原生正则脚本对象。
 * 当 `cleanHistoryMarkup !== true` 时返回 `null`（表示应从宿主全局正则列表中移除）。
 */
export function buildHistoryCleanMarkupRegexScript(
    settings: Pick<
        DrawAssistantSettings,
        'cleanHistoryMarkup' | 'promptStartTag' | 'promptEndTag' | 'presets' | 'materialConfig'
    >
): HostRegexScriptData | null {
    if (!settings.cleanHistoryMarkup) {
        return null;
    }

    const branches: string[] = [
        // 1. 标准角色与服装档案闭合块（带反引号排除与防跨块/防跨越思考链负向断言）
        '(?<!`)<(character|outfit)(?=[\\s>])[^>]*>(?:(?!<(?:character|outfit)(?=[\\s>])|<\\/?(?:think|thinking|thought|imagethink|designthink)\\b)[\\s\\S])*?<\\/\\1\\s*>(?!`)',
    ];

    // 2. 自定义素材提取起止标签（若与默认 <character> / <outfit> 不同）
    const extraction = resolveActiveMaterialExtractionConfig(
        settings as DrawAssistantSettings
    );
    if (extraction) {
        const charStart = (extraction.charStartTag || '').trim();
        const charEnd = (extraction.charEndTag || '').trim();
        if (
            charStart &&
            charEnd &&
            (charStart.toLowerCase() !== '<character>' ||
                charEnd.toLowerCase() !== '</character>')
        ) {
            const customCharBranch = buildPairedArchiveTagBranch(charStart, charEnd);
            if (customCharBranch) {
                branches.push(customCharBranch);
            }
        }

        const outfitStart = (extraction.outfitStartTag || '').trim();
        const outfitEnd = (extraction.outfitEndTag || '').trim();
        if (
            outfitStart &&
            outfitEnd &&
            (outfitStart.toLowerCase() !== '<outfit>' ||
                outfitEnd.toLowerCase() !== '</outfit>')
        ) {
            const customOutfitBranch = buildPairedArchiveTagBranch(outfitStart, outfitEnd);
            if (customOutfitBranch) {
                branches.push(customOutfitBranch);
            }
        }
    }

    // 3. 默认与自定义生图指令起止标记（带防反引号、防跨越思考链与防跨空行保护）
    const defaultDrawingBranch = buildPairedDrawingTagBranch('image###', '###');
    if (defaultDrawingBranch) {
        branches.push(defaultDrawingBranch);
    }

    const customPromptStart = (settings.promptStartTag || 'image###').trim() || 'image###';
    const customPromptEnd = (settings.promptEndTag || '###').trim() || '###';
    if (customPromptStart !== 'image###' || customPromptEnd !== '###') {
        const customDrawingBranch = buildPairedDrawingTagBranch(customPromptStart, customPromptEnd);
        if (customDrawingBranch) {
            branches.push(customDrawingBranch);
        }
    }

    const findRegex = `/(?:${branches.join('|')})/gi`;

    return {
        id: HISTORY_CLEAN_MARKUP_REGEX_ID,
        scriptName: 'ST-DrawAssistant · 清理历史生图与档案标记',
        findRegex,
        replaceString: '',
        trimStrings: [],
        placement: [REGEX_PLACEMENT_AI_OUTPUT],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: 0,
        maxDepth: null,
    };
}

/**
 * 比较两条宿主正则脚本关键配置是否完全一致，避免无变更时重复触发宿主保存。
 */
function isRegexScriptEqual(a: unknown, b: HostRegexScriptData): boolean {
    if (!a || typeof a !== 'object') {
        return false;
    }
    const rec = a as Record<string, unknown>;
    if (
        rec.id !== b.id ||
        rec.scriptName !== b.scriptName ||
        rec.findRegex !== b.findRegex ||
        rec.replaceString !== b.replaceString ||
        rec.disabled !== b.disabled ||
        rec.markdownOnly !== b.markdownOnly ||
        rec.promptOnly !== b.promptOnly ||
        rec.runOnEdit !== b.runOnEdit ||
        rec.substituteRegex !== b.substituteRegex ||
        rec.minDepth !== b.minDepth ||
        rec.maxDepth !== b.maxDepth
    ) {
        return false;
    }
    if (!Array.isArray(rec.placement) || rec.placement.length !== b.placement.length) {
        return false;
    }
    for (let i = 0; i < b.placement.length; i++) {
        if (rec.placement[i] !== b.placement[i]) {
            return false;
        }
    }
    return true;
}

/**
 * 酒馆原生全局正则同步服务。
 */
export class HostRegexService {
    private readonly _store: SettingsStore;

    public constructor(storeInstance?: SettingsStore) {
        this._store = storeInstance ?? settingsStore;
    }

    /**
     * 将当前配置幂等同步至 `SillyTavern.getContext().extensionSettings.regex`。
     *
     * @param options.reloadChatOnDisplayChange 当思维链显示控制正则发生实质变化时是否调用宿主 `reloadCurrentChat()` 刷新楼层显示
     * @returns `{ changed, displayChanged }` 是否发生了正则列表变更及显示层变更
     */
    public syncToHost(options?: {
        readonly reloadChatOnDisplayChange?: boolean;
    }): { changed: boolean; displayChanged: boolean } {
        const hostContext =
            typeof window !== 'undefined' ? window.SillyTavern?.getContext?.() : undefined;
        const extSettings = hostContext?.extensionSettings;
        if (!hostContext || !extSettings || typeof extSettings !== 'object') {
            return { changed: false, displayChanged: false };
        }

        const settings = this._store.getSettings();
        const desiredThinking = buildThinkingDisplayRegexScript(settings.thinkingDisplayMode);
        const desiredHistoryCleanThinking = buildHistoryCleanThinkingRegexScript(
            settings.cleanHistoryThinking
        );
        const desiredHistoryCleanMarkup = buildHistoryCleanMarkupRegexScript(settings);

        const existingList = Array.isArray(extSettings.regex) ? extSettings.regex : null;
        if (
            !existingList &&
            !desiredThinking &&
            !desiredHistoryCleanThinking &&
            !desiredHistoryCleanMarkup
        ) {
            return { changed: false, displayChanged: false };
        }

        const list: unknown[] = existingList ? [...existingList] : [];
        let changed = false;
        let displayChanged = false;

        const applyDesiredScript = (
            scriptId: string,
            desired: HostRegexScriptData | null
        ): boolean => {
            const matchedIndices: number[] = [];
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (item && typeof item === 'object' && (item as { id?: unknown }).id === scriptId) {
                    matchedIndices.push(i);
                }
            }

            if (!desired) {
                if (matchedIndices.length === 0) {
                    return false;
                }
                for (let k = matchedIndices.length - 1; k >= 0; k--) {
                    list.splice(matchedIndices[k], 1);
                }
                return true;
            }

            if (matchedIndices.length === 0) {
                list.push(desired);
                return true;
            }

            const primaryIdx = matchedIndices[0];
            let localChanged = !isRegexScriptEqual(list[primaryIdx], desired);
            if (localChanged) {
                list[primaryIdx] = desired;
            }

            // 清理可能重复的同 ID 旧条目
            if (matchedIndices.length > 1) {
                for (let k = matchedIndices.length - 1; k >= 1; k--) {
                    list.splice(matchedIndices[k], 1);
                }
                localChanged = true;
            }

            return localChanged;
        };

        if (applyDesiredScript(THINKING_DISPLAY_REGEX_ID, desiredThinking)) {
            changed = true;
            displayChanged = true;
        }

        if (applyDesiredScript(HISTORY_CLEAN_THINKING_REGEX_ID, desiredHistoryCleanThinking)) {
            changed = true;
        }

        if (applyDesiredScript(HISTORY_CLEAN_MARKUP_REGEX_ID, desiredHistoryCleanMarkup)) {
            changed = true;
        }

        if (changed) {
            extSettings.regex = list;
            logger.debug(
                `[HostRegexService] 已同步酒馆全局正则 (思考显示: ${settings.thinkingDisplayMode || 'show'}, 清理历史思考: ${Boolean(settings.cleanHistoryThinking)}, 清理历史标记: ${Boolean(settings.cleanHistoryMarkup)})`
            );
            try {
                hostContext.saveSettingsDebounced?.();
            } catch (err) {
                logger.warn('[HostRegexService] 调用宿主 saveSettingsDebounced 异常:', err);
            }

            if (
                displayChanged &&
                options?.reloadChatOnDisplayChange &&
                typeof hostContext.reloadCurrentChat === 'function'
            ) {
                try {
                    void hostContext.reloadCurrentChat();
                } catch (err) {
                    logger.warn('[HostRegexService] 调用宿主 reloadCurrentChat 异常:', err);
                }
            }
        }

        return { changed, displayChanged };
    }
}

/** 全局宿主正则同步服务单例 */
export const hostRegexService = new HostRegexService();
