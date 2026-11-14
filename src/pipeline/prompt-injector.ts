/**
 * 多预设多深度提示词组装与宿主注入服务 (PromptInjector)。
 *
 * @remarks
 * 负责将「故事插画」、「素材创作」、「词汇指导」、「素材注入」四类提示词预设动态计算，
 * 按 `(position, depth, role)` 聚合段落并按 `order` 升序拼接，通过宿主
 * `SillyTavern.getContext().setExtensionPrompt` 写入生成上下文：
 * 1. 素材单层列表渲染：根据当前启用预设与 `materialConfig.format` 行模板生成
 *    `{{角色启用列表}}` 与 `{{服装启用列表}}`；
 * 2. 空素材置空与注释剥离：投递前剥离 `{{//...}}` 酒馆注释，开启 `skipWhenEmpty` 时将空素材变量置换为空文本（若整条条目因此为空则自动跳过）；
 * 3. 失效注入项自动清理：追踪已注册的 `st_da_inj_*` 键集合，当预设关闭或条目深度变更时自动清空旧项。
 */

import type {
    ActivationTriggerMode,
    PresetCategory,
    PromptChannelId,
    PromptInjectionEntry,
    PromptChannelPresetData,
    CharacterPresetData,
    OutfitPresetData,
    MaterialActivationPresetData,
    MaterialFormatConfig,
    MaterialMacroRule,
    PresetItem,
} from '@types';
import {
    settingsStore,
    type SettingsStore,
    type DrawAssistantSettings,
} from '../store/settings-store';
import {
    normalizeCharacterData,
    normalizeOutfitData,
    splitKeywordTokens,
    matchesOutfitId,
} from './material-definitions';
export { splitKeywordTokens };
import { logger } from '../util/logger';

/** 宿主扩展提示词注入键名前缀 */
export const PROMPT_EXTENSION_KEY_PREFIX = 'st_da_inj_';

/** 宿主聊天上下文中用于识别当前角色卡的最小字段 */
export interface HostCardContextLike {
    readonly name2?: string;
    readonly characterId?: string | number;
    readonly characters?: Array<{ name?: string } | undefined>;
    readonly groupId?: string;
    readonly groups?: Array<{ id?: string; name?: string } | undefined>;
}

/**
 * 统一收集当前活跃角色卡候选名称列表（涵盖单聊角色卡名、群聊名与 name2，去重）。
 */
export function resolveHostCardCandidates(
    hostContext?: HostCardContextLike,
    explicitCardKey?: string | readonly string[]
): string[] {
    const rawList: string[] = [];
    if (explicitCardKey !== undefined) {
        if (Array.isArray(explicitCardKey)) {
            rawList.push(...explicitCardKey);
        } else if (typeof explicitCardKey === 'string') {
            rawList.push(explicitCardKey);
        }
    } else if (hostContext) {
        const charId = hostContext.characterId;
        const idx =
            typeof charId === 'number'
                ? charId
                : typeof charId === 'string'
                  ? parseInt(charId, 10)
                  : NaN;
        if (!Number.isNaN(idx) && Array.isArray(hostContext.characters)) {
            const cardName = hostContext.characters[idx]?.name;
            if (typeof cardName === 'string' && cardName.trim()) {
                rawList.push(cardName);
            }
        }
        if (hostContext.groupId && Array.isArray(hostContext.groups)) {
            const groupName = hostContext.groups.find((g) => g?.id === hostContext.groupId)?.name;
            if (typeof groupName === 'string' && groupName.trim()) {
                rawList.push(groupName);
            }
        }
        if (typeof hostContext.name2 === 'string' && hostContext.name2.trim()) {
            rawList.push(hostContext.name2);
        }
    }

    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of rawList) {
        const trimmed = (item || '').trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            out.push(trimmed);
        }
    }
    return out;
}

const PROMPT_CHANNEL_DEFS: ReadonlyArray<{
    readonly id: PromptChannelId;
    readonly category: PresetCategory;
}> = [
    { id: 'story', category: 'prompt_story' },
    { id: 'vocab', category: 'prompt_vocab' },
    { id: 'character', category: 'prompt_character' },
    { id: 'material', category: 'prompt_material' },
];

/** 默认单层角色、服装与宏单项渲染模板 */
export const DEFAULT_FORMAT_TEMPLATES: MaterialFormatConfig = {
    characterTemplate:
        '{{name}}:\n  - 别名: {{aliases}}\n  - 描述: {{description}}\n  - 专属服装:\n{{outfits}}',
    outfitTemplate:
        '[{{name}}]\n  - 别名: {{aliases}}\n  - 描述: {{description}}',
    macroTemplate:
        '- {{macro}}: {{description}}',
};

/**
 * 渲染单条宏规则行模板。
 */
export function renderMacroRowTemplate(
    template: string,
    rule: MaterialMacroRule
): string {
    const macroName = (rule.name || '').trim();
    const desc = (rule.description || '').trim();
    const parts = Array.isArray(rule.targetParts) ? rule.targetParts.join(', ') : '';

    return template
        .replace(/\{\{\s*(?:macro|key)\s*\}\}/g, macroName)
        .replace(/\{\{\s*description\s*\}\}/g, desc)
        .replace(/\{\{\s*parts\s*\}\}/g, parts);
}

/** 素材启用列表单层行渲染结果 */
export interface MaterialRenderedListsResult {
    /** 当前生效的启用预设 ID */
    readonly activeActivationPresetId: string;
    /** 角色列表文本（对应 {{角色启用列表}}） */
    readonly charactersText: string;
    /** 服装列表文本（对应 {{服装启用列表}}） */
    readonly outfitsText: string;
    /** 角色可用宏列表文本（对应 {{角色可用宏列表}}） */
    readonly characterMacrosText: string;
    /** 服装可用宏列表文本（对应 {{服装可用宏列表}}） */
    readonly outfitMacrosText: string;
    /** 命中的角色条数 */
    readonly charactersCount: number;
    /** 命中的服装条数 */
    readonly outfitsCount: number;
    /** 命中的角色是否实际携带至少一套有效专属服装 */
    readonly hasBoundOutfits?: boolean;
    /** 命中的角色展示名列表 */
    readonly matchedCharacterNames: string[];
    /** 命中的服装展示名列表 */
    readonly matchedOutfitNames: string[];
}

/** 命中的单条提示词注入摘要 */
export interface MatchedPromptEntrySummary {
    readonly channelId: PromptChannelId;
    readonly entryId: string;
    readonly entryName: string;
    readonly triggerMode: ActivationTriggerMode;
    readonly matchedKeywords?: readonly string[];
    readonly position: 0 | 1 | 2;
    readonly depth: number;
    readonly role: 0 | 1 | 2;
    readonly order: number;
    readonly renderedContent: string;
}

/** 按 (position, depth, role) 聚合后的单个宿主注入段落 */
export interface PromptInjectionBucket {
    readonly key: string;
    readonly position: 0 | 1 | 2;
    readonly depth: number;
    readonly role: 0 | 1 | 2;
    readonly content: string;
    readonly entries: MatchedPromptEntrySummary[];
}

/** 提示词注入整体计算结果 */
export interface PromptComputedResult {
    readonly buckets: PromptInjectionBucket[];
    readonly matchedEntries: MatchedPromptEntrySummary[];
    readonly materialLists: MaterialRenderedListsResult;
}

/** 提示词注入计算可选参数 */
export interface ComputePromptInjectionsOptions {
    /** 配置快照（缺省读取全局 settingsStore） */
    readonly settings?: DrawAssistantSettings;
    /** 聊天消息数组（缺省读取宿主 context.chat） */
    readonly chatMessages?: Array<{ mes?: string }>;
    /** 当前酒馆角色卡名称（缺省读取宿主 context.name2） */
    readonly activeCardKey?: string;
    /** 是否忽略插件总开关与预设级开关（供设置页实时预览使用，单条目自身的 enabled 仍生效） */
    readonly ignoreChannelEnabled?: boolean;
    /** 仅计算指定的预设类型子集（缺省计算全部四类） */
    readonly channels?: PromptChannelId[];
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
    return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

/**
 * 剥离酒馆模板注释块 `{{// ... }}`。
 */
export function stripStTemplateComments(text: string): string {
    if (!text || !text.includes('{{//')) {
        return text || '';
    }
    return text.replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
}

/**
 * 剥离 HTML 注释与标准推理思考块（`<think>` / `<thinking>`），供提示词处理流程与关键词扫描共用。
 */
export function stripThinkingAndComments(text: string): string {
    if (!text) {
        return '';
    }
    return text
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<(think|thinking)\b[^>]*>[\s\S]*$/gi, ' ');
}

/**
 * 剥离历史消息中的插件思考/生图/对话/档案块，防止上轮 AI 输出的 Tags 连带触发关键词条目。
 */
export function stripAiMarkupForKeywordScan(text: string): string {
    if (!text) {
        return '';
    }
    return stripThinkingAndComments(text)
        .replace(/<(imgthink|image|talk|角色|服装)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<imgthink\b[^>]*>[\s\S]*$/gi, ' ')
        .replace(/<\/?(?:image|talk|角色|服装)\b[^>]*>/gi, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const REGEX_LITERAL_RE = /^\/((?:\\.|[^/\\])+)\/([dgimsuvy]*)$/;
const PURE_ASCII_TOKEN_RE = /^[A-Za-z0-9_\s-]+$/;
const VALID_REGEX_FLAGS_RE = /^[dgimsuvy]*$/;

function hasValidUniqueRegexFlags(flags: string): boolean {
    if (!VALID_REGEX_FLAGS_RE.test(flags)) {
        return false;
    }
    const seen = new Set<string>();
    for (const ch of flags) {
        if (seen.has(ch)) {
            return false;
        }
        seen.add(ch);
    }
    return !(seen.has('u') && seen.has('v'));
}

function escapeRegExpLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 校验关键词是否为合法 `/pattern/flags` 正则字面量；非法时返回错误信息。
 */
export function validateKeywordRegexToken(rawToken: string): string | null {
    const token = rawToken.trim();
    if (!token.startsWith('/')) {
        return null;
    }
    const match = REGEX_LITERAL_RE.exec(token);
    if (!match) {
        return `正则字面量格式无效: ${token}`;
    }
    const pattern = match[1];
    const flags = match[2];
    if (!hasValidUniqueRegexFlags(flags)) {
        return `正则标志无效或重复: ${token}`;
    }
    try {
        new RegExp(pattern, flags.replace(/[gy]/g, ''));
        return null;
    } catch (err: unknown) {
        return err instanceof Error ? err.message : `无效正则: ${token}`;
    }
}

export function matchKeywordToken(
    rawToken: string,
    rawText: string,
    lowerText: string,
    caseSensitive: boolean,
    matchWholeWords = false
): boolean {
    const token = rawToken.trim();
    if (!token) {
        return false;
    }

    const regexMatch = REGEX_LITERAL_RE.exec(token);
    if (regexMatch) {
        const pattern = regexMatch[1];
        // 剥离 g/y 有状态标志，确保多次 .test() 结果幂等
        let flags = regexMatch[2].replace(/[gy]/g, '');
        if (!caseSensitive && !flags.includes('i')) {
            flags += 'i';
        }
        if (hasValidUniqueRegexFlags(flags)) {
            try {
                const re = new RegExp(pattern, flags);
                return re.test(rawText);
            } catch {
                // 非法正则时降级为字面文本包含匹配
            }
        }
    }

    if (matchWholeWords && PURE_ASCII_TOKEN_RE.test(token)) {
        const boundaryFlags = caseSensitive ? '' : 'i';
        const boundaryRe = new RegExp(
            `(?:^|[^A-Za-z0-9_])${escapeRegExpLiteral(token)}(?=$|[^A-Za-z0-9_])`,
            boundaryFlags
        );
        return boundaryRe.test(rawText);
    }

    return caseSensitive
        ? rawText.includes(token)
        : lowerText.includes(token.toLowerCase());
}

/**
 * 提取最近 N 条聊天消息的净化拼接文本（自动剥离插件与 AI 思考标签）。
 * 当 `scanDepth === 0` 时返回空字符串（禁止扫描消息记录）。
 */
function extractRecentChatText(
    chatMessages: Array<{ mes?: string }> | undefined,
    scanDepth: number
): string {
    if (!Array.isArray(chatMessages) || chatMessages.length === 0 || scanDepth <= 0) {
        return '';
    }
    const parts: string[] = [];
    const slice = chatMessages.slice(-Math.floor(scanDepth));
    for (const msg of slice) {
        if (typeof msg?.mes === 'string' && msg.mes.trim()) {
            const cleaned = stripAiMarkupForKeywordScan(msg.mes);
            if (cleaned) {
                parts.push(cleaned);
            }
        }
    }
    return parts.join('\n');
}

/**
 * 判断素材条目（角色或服装）的主名称或任一别名是否出现在上下文文本中。
 */
function isArchiveNameMatchedInText(
    name: string,
    aliases: string,
    rawContextText: string,
    lowerContextText: string
): boolean {
    if (!lowerContextText) {
        return false;
    }

    const candidateTokens: string[] = [];
    const primary = (name || '').trim();
    if (primary) {
        candidateTokens.push(primary);
    }
    for (const token of splitKeywordTokens(aliases)) {
        candidateTokens.push(token);
    }

    for (const token of candidateTokens) {
        if (matchKeywordToken(token, rawContextText, lowerContextText, false)) {
            return true;
        }
    }
    return false;
}

/**
 * 将角色绑定的服装预设 ID 列表精确解析为服装预设数据数组。
 */
export function resolveBoundOutfitPresets(
    boundOutfitIds: readonly string[],
    allOutfitPresets: ReadonlyArray<{ id: string; name: string; data: OutfitPresetData }>
): OutfitPresetData[] {
    if (!Array.isArray(boundOutfitIds) || boundOutfitIds.length === 0) {
        return [];
    }

    const resolved: OutfitPresetData[] = [];
    const seenIds = new Set<string>();

    for (const rawId of boundOutfitIds) {
        const id = (rawId || '').trim();
        if (!id || seenIds.has(id)) continue;
        const hit = allOutfitPresets.find((o) => o.id === id);
        if (hit) {
            seenIds.add(hit.id);
            resolved.push(hit.data);
        }
    }
    return resolved;
}

/**
 * 渲染单条角色或服装行模板，支持名称、别名、描述、专属服装与各部位变量展开。
 *
 * @remarks
 * 服装启用列表展示通用服装；角色绑定的服装为角色专属服装，
 * 在角色模板中通过 {{outfits}} 展开时使用相同的服装行模板渲染。
 */
export function renderArchiveRowTemplate(
    template: string,
    data: CharacterPresetData | OutfitPresetData,
    allOutfitPresets: ReadonlyArray<{ id: string; name: string; data: OutfitPresetData }>,
    outfitTemplate?: string,
    includeBoundOutfits = true
): string {
    const name = (data.name || '').trim();
    const aliases = (data.aliases || '').trim() || '无';
    const isChar = 'boundOutfitIds' in data;
    const description = (data.description || '').trim() || '无';

    const parts: Record<string, string> = data.parts || {};

    let result = template
        .replace(/\{\{\s*name\s*\}\}/g, name)
        .replace(/\{\{\s*aliases\s*\}\}/g, aliases)
        .replace(/\{\{\s*description\s*\}\}/g, description);

    if (isChar) {
        const charData = data as CharacterPresetData;
        const trigger = (charData.trigger || '').trim();
        const appearance = (parts.appearance || '').trim();

        const boundOutfits =
            includeBoundOutfits && Array.isArray(charData.boundOutfitIds)
                ? resolveBoundOutfitPresets(charData.boundOutfitIds, allOutfitPresets)
                : [];

        const rowTpl = outfitTemplate || DEFAULT_FORMAT_TEMPLATES.outfitTemplate;

        // 格式化专属服装子树：严格遵循 4 格相对缩进，同时保留模板原有的属性引导词
        if (boundOutfits.length === 0) {
            result = result
                .replace(
                    /(\r?\n)([ \t]*(?:-\s*)?[^:\r\n|]+:)\s*(?:\r?\n[ \t]*)?\{\{\s*outfits\s*\}\}/g,
                    '$1$2 无'
                )
                .replace(/([^:\r\n|]+:)\s*\{\{\s*outfits\s*\}\}/g, '$1 无')
                .replace(/\{\{\s*outfits\s*\}\}/g, '无');
        } else {
            const renderedOutfits = boundOutfits
                .map((bo) => {
                    const single = renderArchiveRowTemplate(rowTpl, bo, allOutfitPresets);
                    return single
                        .split('\n')
                        .map((line) => (line.trim() ? `    ${line}` : ''))
                        .join('\n');
                })
                .join('\n');

            result = result
                .replace(
                    /(\r?\n)([ \t]*(?:-\s*)?[^:\r\n|]+:)\s*(?:\r?\n[ \t]*)?\{\{\s*outfits\s*\}\}/g,
                    (_match, newline, header) => `${newline}${header}\n${renderedOutfits}`
                )
                .replace(/(\r?\n)[ \t]*\{\{\s*outfits\s*\}\}/g, () => `\n${renderedOutfits}`)
                .replace(/\{\{\s*outfits\s*\}\}/g, () => `\n${renderedOutfits}`);
        }

        result = result
            .replace(/\{\{\s*trigger\s*\}\}/g, trigger)
            .replace(/\{\{\s*appearance\s*\}\}/g, appearance)
            .replace(/\{\{\s*hair\s*\}\}/g, (parts.hair || '').trim())
            .replace(/\{\{\s*face\s*\}\}/g, (parts.face || '').trim())
            .replace(/\{\{\s*features\s*\}\}/g, (parts.features || '').trim())
            .replace(/\{\{\s*chest\s*\}\}/g, (parts.chest || '').trim())
            .replace(/\{\{\s*upper_body\s*\}\}/g, (parts.upper_body || '').trim())
            .replace(/\{\{\s*waist\s*\}\}/g, (parts.waist || '').trim())
            .replace(/\{\{\s*hips\s*\}\}/g, (parts.hips || '').trim())
            .replace(/\{\{\s*legs\s*\}\}/g, (parts.legs || '').trim())
            .replace(/\{\{\s*feet\s*\}\}/g, (parts.feet || '').trim())
            .replace(/\{\{\s*hands\s*\}\}/g, (parts.hands || '').trim())
            .replace(/\{\{\s*accessories\s*\}\}/g, (parts.accessories || '').trim())
            .replace(/\{\{\s*privates\s*\}\}/g, (parts.privates || '').trim());
    } else {
        const outfitData = data as OutfitPresetData;
        const trigger = (outfitData.trigger || '').trim();
        const style = (parts.style || '').trim();

        result = result.replace(/\{\{\s*outfits\s*\}\}/g, '');
        result = result
            .replace(/\{\{\s*trigger\s*\}\}/g, trigger)
            .replace(/\{\{\s*style\s*\}\}/g, style)
            .replace(/\{\{\s*headwear\s*\}\}/g, (parts.headwear || '').trim())
            .replace(/\{\{\s*top\s*\}\}/g, (parts.top || '').trim())
            .replace(/\{\{\s*bottom\s*\}\}/g, (parts.bottom || '').trim())
            .replace(/\{\{\s*handwear\s*\}\}/g, (parts.handwear || '').trim())
            .replace(/\{\{\s*socks\s*\}\}/g, (parts.socks || '').trim())
            .replace(/\{\{\s*shoes\s*\}\}/g, (parts.shoes || '').trim())
            .replace(/\{\{\s*accessories\s*\}\}/g, (parts.accessories || '').trim())
            .replace(/\{\{\s*underwear\s*\}\}/g, (parts.underwear || '').trim());
    }

    return result;
}

/**
 * 解析当前生效的素材启用预设（支持跟随酒馆角色卡自动匹配切换）。
 */
export function resolveActiveMaterialActivationPreset(
    settings: DrawAssistantSettings,
    activeCardKey?: string | readonly string[]
): PresetItem<MaterialActivationPresetData> | undefined {
    const actList = settings.presets.material_activations || [];
    if (actList.length === 0) {
        return undefined;
    }

    const matCfg = settings.materialConfig;
    const cardSet = new Set(
        (Array.isArray(activeCardKey) ? activeCardKey : activeCardKey ? [activeCardKey] : [])
            .map((k) => (k || '').trim().toLowerCase())
            .filter(Boolean)
    );

    if (matCfg?.autoSwitchByCard && cardSet.size > 0) {
        const cardMatched = actList.find((preset) => {
            const names = preset.data?.boundCardNames;
            return (
                Array.isArray(names) &&
                names.some((n) => cardSet.has((n || '').trim().toLowerCase()))
            );
        });
        if (cardMatched) {
            return cardMatched;
        }
    }

    return (
        actList.find((preset) => preset.id === matCfg?.activeActivationPresetId) ||
        actList[0]
    );
}

/**
 * 校验启用规则是否匹配当前活跃角色卡。
 * 开启绑定且指定目标卡名时，要求当前会话存在同名角色卡（大小写无关、前后空白规整）。
 */
function matchesBoundCharacterCard(
    rule: { bindCharacterCard?: boolean; boundCharacterCardName?: string },
    activeCardCandidates?: string | readonly string[]
): boolean {
    if (!rule.bindCharacterCard) {
        return true;
    }
    const target = (rule.boundCharacterCardName || '').trim().toLowerCase();
    if (!target) {
        return true;
    }
    const candidates = Array.isArray(activeCardCandidates)
        ? activeCardCandidates
        : activeCardCandidates
          ? [activeCardCandidates]
          : [];
    return candidates.some((k) => (k || '').trim().toLowerCase() === target);
}

/**
 * 根据当前启用预设、聊天上下文与单层行模板计算角色与服装启用列表文本。
 */
export function computeMaterialRenderedLists(options: {
    readonly settings?: DrawAssistantSettings;
    readonly chatMessages?: Array<{ mes?: string }>;
    readonly activeCardKey?: string;
    readonly formatOverride?: Partial<MaterialFormatConfig>;
} = {}): MaterialRenderedListsResult {
    const hostContext =
        typeof window !== 'undefined' ? window.SillyTavern?.getContext?.() : undefined;
    const settings = options.settings ?? settingsStore.getSettings();
    const chatMessages =
        options.chatMessages ??
        (hostContext?.chat as Array<{ mes?: string }> | undefined) ??
        [];
    const cardCandidates = resolveHostCardCandidates(hostContext, options.activeCardKey);

    const activeActivationPreset = resolveActiveMaterialActivationPreset(
        settings,
        cardCandidates
    );
    const actData = activeActivationPreset?.data;

    const allCharPresets = (settings.presets.characters || [])
        .map((p) => {
            const normalized = normalizeCharacterData(p.data);
            const fallbackName = normalized.name.trim() || (p.name || '').trim();
            return {
                id: p.id,
                name: p.name,
                data: fallbackName === normalized.name ? normalized : { ...normalized, name: fallbackName },
            };
        })
        .filter((p) => Boolean(p.data.name.trim()));

    const allOutfitPresets = (settings.presets.outfits || [])
        .map((p) => {
            const normalized = normalizeOutfitData(p.data);
            const fallbackName = normalized.name.trim() || (p.name || '').trim();
            return {
                id: p.id,
                name: p.name,
                data: fallbackName === normalized.name ? normalized : { ...normalized, name: fallbackName },
            };
        })
        .filter((p) => Boolean(p.data.name.trim()));

    const fmtPresets = settings.presets?.material_formats || [];
    const activeFmtId = settings.materialConfig?.activeFormatPresetId;
    const activeFmtPreset = fmtPresets.find((p) => p.id === activeFmtId) || fmtPresets[0];
    const fmtData = activeFmtPreset?.data;

    const format: MaterialFormatConfig = {
        ...DEFAULT_FORMAT_TEMPLATES,
        ...(fmtData
            ? {
                  characterTemplate: fmtData.characterTemplate,
                  outfitTemplate: fmtData.outfitTemplate,
                  macroTemplate: fmtData.macroTemplate,
              }
            : {}),
        ...(settings.materialConfig?.format || {}),
        ...(options.formatOverride || {}),
    };

    const effectiveMacroTemplate =
        format.macroTemplate || DEFAULT_FORMAT_TEMPLATES.macroTemplate || '- {{macro}}: {{description}}';

    const charRules =
        settings.materialConfig?.characterMacros && settings.materialConfig.characterMacros.length > 0
            ? settings.materialConfig.characterMacros
            : fmtData?.characterMacros || [];

    const outfitRules =
        settings.materialConfig?.outfitMacros && settings.materialConfig.outfitMacros.length > 0
            ? settings.materialConfig.outfitMacros
            : fmtData?.outfitMacros || [];

    const characterMacrosText = charRules
        .map((r) => renderMacroRowTemplate(effectiveMacroTemplate, r))
        .join('\n');

    const outfitMacrosText = outfitRules
        .map((r) => renderMacroRowTemplate(effectiveMacroTemplate, r))
        .join('\n');

    if (!actData) {
        return {
            activeActivationPresetId: '',
            charactersText: '',
            outfitsText: '',
            characterMacrosText,
            outfitMacrosText,
            charactersCount: 0,
            outfitsCount: 0,
            matchedCharacterNames: [],
            matchedOutfitNames: [],
        };
    }

    const scanDepth =
        typeof actData.scanDepth === 'number' && Number.isFinite(actData.scanDepth) && actData.scanDepth >= 0
            ? Math.floor(actData.scanDepth)
            : 2;
    const includeBoundOutfits = actData.includeBoundOutfits !== false;
    const rawRecentText = extractRecentChatText(chatMessages, scanDepth);
    const lowerRecentText = rawRecentText.toLowerCase();

    const triggeredCharacters: CharacterPresetData[] = [];
    const matchedCharacterNames: string[] = [];
    const matchedOutfitNames: string[] = [];

    for (const charPreset of allCharPresets) {
        const charData = charPreset.data;
        const rule = actData.characterRules?.[charPreset.id];
        if (!rule?.enabled) {
            continue;
        }

        if (!matchesBoundCharacterCard(rule, cardCandidates)) {
            continue;
        }

        const isTriggered =
            rule.triggerMode === 'always' ||
            isArchiveNameMatchedInText(
                charData.name,
                charData.aliases,
                rawRecentText,
                lowerRecentText
            );

        if (isTriggered) {
            triggeredCharacters.push(charData);
            matchedCharacterNames.push(charData.name);
        }
    }

    // 角色专属服装列表和通用服装列表不共享服装池：按预设 ID 收集所有已被角色绑定的专属服装
    const boundOutfitIdSet = new Set<string>();
    for (const charPreset of allCharPresets) {
        if (Array.isArray(charPreset.data.boundOutfitIds)) {
            for (const rawId of charPreset.data.boundOutfitIds) {
                const id = (rawId || '').trim();
                if (id) {
                    boundOutfitIdSet.add(id);
                }
            }
        }
    }

    // 通用服装启用列表：列举未被任何角色绑定的通用服装，遵从服装启用设置规则
    const triggeredOutfits: OutfitPresetData[] = [];
    for (const outfitPreset of allOutfitPresets) {
        // 排除已从属于角色的专属服装，防止混入通用服装列表造成重复
        if (boundOutfitIdSet.has(outfitPreset.id)) {
            continue;
        }

        const outfitData = outfitPreset.data;

        const rule = actData.outfitRules?.[outfitPreset.id];

        if (!rule?.enabled) {
            continue;
        }

        if (!matchesBoundCharacterCard(rule, cardCandidates)) {
            continue;
        }

        const isTriggered =
            rule.triggerMode === 'always' ||
            isArchiveNameMatchedInText(
                outfitData.name,
                outfitData.aliases,
                rawRecentText,
                lowerRecentText
            );

        if (isTriggered) {
            triggeredOutfits.push(outfitData);
            matchedOutfitNames.push(outfitData.name);
        }
    }

    const effectiveOutfitTemplate =
        format.outfitTemplate || DEFAULT_FORMAT_TEMPLATES.outfitTemplate;
    const effectiveCharTemplate =
        format.characterTemplate || DEFAULT_FORMAT_TEMPLATES.characterTemplate;

    const hasBoundOutfits =
        includeBoundOutfits &&
        triggeredCharacters.some((charData) =>
            allOutfitPresets.some((o) => matchesOutfitId(charData.boundOutfitIds, o.id))
        );

    const charactersText = triggeredCharacters
        .map((c) =>
            renderArchiveRowTemplate(
                effectiveCharTemplate,
                c,
                allOutfitPresets,
                effectiveOutfitTemplate,
                includeBoundOutfits
            )
        )
        .join('\n\n---\n\n');

    const outfitsText = triggeredOutfits
        .map((o) =>
            renderArchiveRowTemplate(
                effectiveOutfitTemplate,
                o,
                allOutfitPresets
            )
        )
        .join('\n\n---\n\n');

    return {
        activeActivationPresetId: activeActivationPreset?.id || '',
        charactersText,
        outfitsText,
        characterMacrosText,
        outfitMacrosText,
        charactersCount: triggeredCharacters.length,
        outfitsCount: triggeredOutfits.length,
        hasBoundOutfits,
        matchedCharacterNames,
        matchedOutfitNames,
    };
}

/**
 * 将素材变量替换为多行列表文本，并继承变量所在行的前导缩进。
 */
function replaceMaterialPlaceholderWithIndent(
    source: string,
    placeholderNamePattern: string,
    replacementText: string,
    emptyFallback: string
): string {
    const hasValue = Boolean(replacementText.trim());
    const valueToInsert = hasValue ? replacementText : emptyFallback;

    if (!valueToInsert) {
        // 当为空占位符且整行仅包含该占位符时，一并清理空白行及多余空格
        const wholeLineRegex = new RegExp(
            `^[ \\t]*\\{\\{\\s*${placeholderNamePattern}\\s*\\}\\}[ \\t]*(?:\\r?\\n|$)`,
            'gm'
        );
        const inlineRegex = new RegExp(`\\{\\{\\s*${placeholderNamePattern}\\s*\\}\\}`, 'g');
        return source.replace(wholeLineRegex, '').replace(inlineRegex, '');
    }

    const lineRegex = new RegExp(
        `^([ \\t]*)\\{\\{\\s*${placeholderNamePattern}\\s*\\}\\}`,
        'gm'
    );
    const inlineRegex = new RegExp(`\\{\\{\\s*${placeholderNamePattern}\\s*\\}\\}`, 'g');

    const afterLine = source.replace(lineRegex, (_m, indent: string) => {
        return valueToInsert
            .split('\n')
            .map((line) => (line ? `${indent}${line}` : line))
            .join('\n');
    });

    return afterLine.replace(inlineRegex, valueToInsert);
}

/**
 * 在条目正文中注入角色与服装启用列表变量。
 *
 * @remarks
 * 当 `skipWhenEmpty` 开启时，仅将空素材列表占位符置换为空字符串并收紧多余空行，
 * 保留条目内其余提示词文本；仅当整条正文置换后仍为空白时才跳过注入。
 */
const MATERIAL_LIST_PLACEHOLDER_RE =
    /\{\{\s*(?:角色启用列表|服装启用列表|角色可用宏列表|服装可用宏列表)\s*\}\}/;

function applyMaterialVariablesToEntryContent(
    strippedContent: string,
    materialLists: MaterialRenderedListsResult,
    skipWhenEmpty = false
): string {
    if (!strippedContent.includes('{{')) {
        return strippedContent;
    }

    const hasCharacters = materialLists.charactersCount > 0;
    const hasOutfits = materialLists.outfitsCount > 0;
    const hasAnyOutfitMacros = hasOutfits || Boolean(materialLists.hasBoundOutfits);
    if (
        skipWhenEmpty &&
        !hasCharacters &&
        !hasOutfits &&
        !hasAnyOutfitMacros &&
        MATERIAL_LIST_PLACEHOLDER_RE.test(strippedContent)
    ) {
        return '';
    }

    let result = replaceMaterialPlaceholderWithIndent(
        strippedContent,
        '角色启用列表',
        materialLists.charactersText,
        skipWhenEmpty ? '' : '(当前无激活角色)'
    );
    result = replaceMaterialPlaceholderWithIndent(
        result,
        '服装启用列表',
        materialLists.outfitsText,
        skipWhenEmpty ? '' : '(当前无激活服装)'
    );
    result = replaceMaterialPlaceholderWithIndent(
        result,
        '角色可用宏列表',
        skipWhenEmpty && !hasCharacters ? '' : materialLists.characterMacrosText,
        skipWhenEmpty ? '' : '(当前无可用角色宏)'
    );
    result = replaceMaterialPlaceholderWithIndent(
        result,
        '服装可用宏列表',
        skipWhenEmpty && !hasAnyOutfitMacros ? '' : materialLists.outfitMacrosText,
        skipWhenEmpty ? '' : '(当前无可用服装宏)'
    );

    if (skipWhenEmpty) {
        if (!hasCharacters) {
            result = result
                .replace(/<character_database\b[^>]*>\s*<\/character_database>/gi, '')
                .replace(/^[ \t]*\d+\.\s*角色可用宏[：:]\s*$/gm, '');
        }
        if (!hasOutfits) {
            result = result.replace(/<outfit_database\b[^>]*>\s*<\/outfit_database>/gi, '');
        }
        if (!hasAnyOutfitMacros) {
            result = result.replace(/^[ \t]*\d+\.\s*服装可用宏[：:]\s*$/gm, '');
        }
        result = result.replace(/\n{3,}/g, '\n\n');
    }
    return result;
}

/**
 * 生成宿主 `setExtensionPrompt` 的注入段落唯一键名。
 */
export function buildPromptBucketKey(
    position: 0 | 1 | 2,
    depth: number,
    role: 0 | 1 | 2
): string {
    return `${PROMPT_EXTENSION_KEY_PREFIX}p${position}_d${depth}_r${role}`;
}

/**
 * 纯函数：根据当前四类预设配置、素材库与聊天上下文计算全部提示词注入结果。
 */
export function computePromptInjections(
    options: ComputePromptInjectionsOptions = {}
): PromptComputedResult {
    const hostContext =
        typeof window !== 'undefined' ? window.SillyTavern?.getContext?.() : undefined;
    const settings = options.settings ?? settingsStore.getSettings();
    const chatMessages =
        options.chatMessages ??
        (hostContext?.chat as Array<{ mes?: string }> | undefined) ??
        [];
    const ignoreChannelEnabled = Boolean(options.ignoreChannelEnabled);

    if (!ignoreChannelEnabled && !settings.enabled) {
        return {
            buckets: [],
            matchedEntries: [],
            materialLists: {
                activeActivationPresetId: '',
                charactersText: '',
                outfitsText: '',
                characterMacrosText: '',
                outfitMacrosText: '',
                charactersCount: 0,
                outfitsCount: 0,
                matchedCharacterNames: [],
                matchedOutfitNames: [],
            },
        };
    }

    const materialLists = computeMaterialRenderedLists({
        settings,
        chatMessages,
        activeCardKey: options.activeCardKey,
    });

    const allowedChannels = options.channels ? new Set(options.channels) : null;
    // 在单次计算内按消息索引缓存清洗结果，避免不同 scanDepth 重复正则清洗
    const cleanedMessagesCache = new Map<number, string>();
    const recentTextCache = new Map<number, { raw: string; lower: string }>();
    const getRecentText = (depth: number): { raw: string; lower: string } => {
        const normalizedDepth =
            typeof depth === 'number' && Number.isFinite(depth) && depth >= 0
                ? Math.floor(depth)
                : 2;
        let cached = recentTextCache.get(normalizedDepth);
        if (cached === undefined) {
            if (normalizedDepth <= 0 || !Array.isArray(chatMessages) || chatMessages.length === 0) {
                cached = { raw: '', lower: '' };
            } else {
                const startIdx = Math.max(0, chatMessages.length - normalizedDepth);
                const parts: string[] = [];
                for (let idx = startIdx; idx < chatMessages.length; idx++) {
                    let cleaned = cleanedMessagesCache.get(idx);
                    if (cleaned === undefined) {
                        const mes = chatMessages[idx]?.mes;
                        cleaned =
                            typeof mes === 'string' && mes.trim()
                                ? stripAiMarkupForKeywordScan(mes)
                                : '';
                        cleanedMessagesCache.set(idx, cleaned);
                    }
                    if (cleaned) {
                        parts.push(cleaned);
                    }
                }
                const raw = parts.join('\n');
                cached = { raw, lower: raw.toLowerCase() };
            }
            recentTextCache.set(normalizedDepth, cached);
        }
        return cached;
    };

    interface InternalBucketEntry extends MatchedPromptEntrySummary {
        readonly seq: number;
    }

    const bucketMap = new Map<
        string,
        {
            key: string;
            position: 0 | 1 | 2;
            depth: number;
            role: 0 | 1 | 2;
            items: InternalBucketEntry[];
        }
    >();
    const matchedEntries: MatchedPromptEntrySummary[] = [];
    let globalSeq = 0;

    for (const channelDef of PROMPT_CHANNEL_DEFS) {
        if (allowedChannels && !allowedChannels.has(channelDef.id)) {
            continue;
        }

        const channelCfg = settings.promptInjection?.[channelDef.id];
        if (!ignoreChannelEnabled && !channelCfg?.enabled) {
            continue;
        }

        const presetList =
            (settings.presets[channelDef.category] as
                | PresetItem<PromptChannelPresetData>[]
                | undefined) || [];
        const activePreset =
            presetList.find((p) => p.id === channelCfg?.activePresetId) || presetList[0];
        const entries: PromptInjectionEntry[] = Array.isArray(activePreset?.data?.entries)
            ? activePreset.data.entries
            : [];

        for (const entry of entries) {
            const seq = globalSeq++;
            if (!entry || !entry.enabled) {
                continue;
            }

            const triggerMode: ActivationTriggerMode =
                entry.triggerMode === 'always' ? 'always' : 'keyword';
            let isTriggered = triggerMode === 'always';
            let matchedKeywords: string[] | undefined;

            if (!isTriggered) {
                const caseSensitive = Boolean(entry.caseSensitive);
                const matchWholeWords = Boolean(entry.matchWholeWords);
                const { raw: rawText, lower: lowerText } = getRecentText(entry.scanDepth ?? 2);

                const primaryKws = splitKeywordTokens(entry.keywords);
                if (primaryKws.length === 0) {
                    continue;
                }

                const secondaryKws = splitKeywordTokens(entry.secondaryKeywords);
                const logic = entry.logicType || 'and_any';
                const hitPrimary = primaryKws.filter((kw) =>
                    matchKeywordToken(kw, rawText, lowerText, caseSensitive, matchWholeWords)
                );

                if (secondaryKws.length > 0) {
                    if (hitPrimary.length === 0) {
                        continue;
                    }
                    const secondaryMatched =
                        logic === 'and_all'
                            ? secondaryKws.every((kw) =>
                                  matchKeywordToken(
                                      kw,
                                      rawText,
                                      lowerText,
                                      caseSensitive,
                                      matchWholeWords
                                  )
                              )
                            : logic === 'not_any'
                              ? !secondaryKws.some((kw) =>
                                    matchKeywordToken(
                                        kw,
                                        rawText,
                                        lowerText,
                                        caseSensitive,
                                        matchWholeWords
                                    )
                                )
                              : secondaryKws.some((kw) =>
                                    matchKeywordToken(
                                        kw,
                                        rawText,
                                        lowerText,
                                        caseSensitive,
                                        matchWholeWords
                                    )
                                );
                    if (!secondaryMatched) {
                        continue;
                    }
                    matchedKeywords = hitPrimary;
                } else {
                    const primaryMatched =
                        logic === 'and_all'
                            ? hitPrimary.length === primaryKws.length
                            : logic === 'not_any'
                              ? hitPrimary.length === 0
                              : hitPrimary.length > 0;
                    if (!primaryMatched) {
                        continue;
                    }
                    if (hitPrimary.length > 0) {
                        matchedKeywords = hitPrimary;
                    }
                }

                isTriggered = true;
            }

            if (!isTriggered) {
                continue;
            }

            const stripped = stripStTemplateComments(entry.content || '');
            if (!stripped.trim()) {
                continue;
            }

            const rendered = applyMaterialVariablesToEntryContent(
                stripped,
                materialLists,
                Boolean(entry.skipWhenEmpty)
            ).trim();

            if (!rendered) {
                continue;
            }

            const position: 0 | 1 | 2 =
                entry.position === 0 || entry.position === 1 || entry.position === 2
                    ? entry.position
                    : 1;
            const depth =
                position === 1 && typeof entry.depth === 'number' && Number.isFinite(entry.depth)
                    ? Math.max(0, Math.floor(entry.depth))
                    : 0;
            const role: 0 | 1 | 2 = entry.role === 1 || entry.role === 2 ? entry.role : 0;
            const order =
                typeof entry.order === 'number' && Number.isFinite(entry.order)
                    ? Math.floor(entry.order)
                    : 100;

            const summary: MatchedPromptEntrySummary = {
                channelId: channelDef.id,
                entryId: entry.id,
                entryName: entry.name,
                triggerMode,
                ...(matchedKeywords && matchedKeywords.length > 0 ? { matchedKeywords } : {}),
                position,
                depth,
                role,
                order,
                renderedContent: rendered,
            };
            matchedEntries.push(summary);

            const bucketKey = buildPromptBucketKey(position, depth, role);
            let bucket = bucketMap.get(bucketKey);
            if (!bucket) {
                bucket = {
                    key: bucketKey,
                    position,
                    depth,
                    role,
                    items: [],
                };
                bucketMap.set(bucketKey, bucket);
            }
            bucket.items.push({ ...summary, seq });
        }
    }

    const buckets: PromptInjectionBucket[] = [];
    for (const bucket of bucketMap.values()) {
        bucket.items.sort((a, b) => a.order - b.order || a.seq - b.seq);
        const orderedSummaries: MatchedPromptEntrySummary[] = bucket.items.map(
            ({ seq: _seq, ...rest }) => rest
        );
        buckets.push({
            key: bucket.key,
            position: bucket.position,
            depth: bucket.depth,
            role: bucket.role,
            content: orderedSummaries.map((item) => item.renderedContent).join('\n\n'),
            entries: orderedSummaries,
        });
    }

    // 注入段落按 position -> depth 降序 -> role 升序排列，便于预览面板按上下文阅读顺序展示
    buckets.sort(
        (a, b) => a.position - b.position || b.depth - a.depth || a.role - b.role
    );

    return {
        buckets,
        matchedEntries,
        materialLists,
    };
}

/**
 * 提示词宿主注入管理器。
 */
export class PromptInjector {
    private readonly _store: SettingsStore;
    private readonly _registeredMeta = new Map<
        string,
        { position: 0 | 1 | 2; depth: number; role: 0 | 1 | 2 }
    >();
    private _pendingMicrotaskPromise: Promise<PromptComputedResult> | null = null;
    private _syncEpoch = 0;

    public constructor(storeInstance?: SettingsStore) {
        this._store = storeInstance ?? settingsStore;
    }

    /**
     * 微任务合批调度提示词同步注入。
     *
     * @remarks
     * 在同一个事件循环/宏任务周期内多次调用时自动合批为微任务末尾的单次全量计算与注入，
     * 消除短时间内的密集重复正则与素材匹配计算。
     * 若调度期间发生清理或停用 (`_syncEpoch` 递增)，则放弃该微任务回写。
     *
     * @returns 最终合批执行的计算结果 Promise
     */
    public scheduleSyncToHost(): Promise<PromptComputedResult> {
        if (!this._pendingMicrotaskPromise) {
            const scheduledEpoch = this._syncEpoch;
            this._pendingMicrotaskPromise = Promise.resolve().then(() => {
                this._pendingMicrotaskPromise = null;
                if (scheduledEpoch !== this._syncEpoch) {
                    return computePromptInjections({
                        settings: this._store.getSettings(),
                        channels: [],
                    });
                }
                return this.syncToHost();
            });
        }
        return this._pendingMicrotaskPromise;
    }

    /**
     * 计算当前激活的所有提示词段落并同步写入 SillyTavern 宿主 `setExtensionPrompt`。
     */
    public syncToHost(): PromptComputedResult {
        // 若存在尚待触发的合批微任务，直接废弃旧占位并立即计算最新态，防止同 Tick 重复刷新
        if (this._pendingMicrotaskPromise) {
            this._syncEpoch += 1;
            this._pendingMicrotaskPromise = null;
        }
        const settings = this._store.getSettings();
        const hostContext =
            typeof window !== 'undefined' ? window.SillyTavern?.getContext?.() : undefined;
        const setPromptFn = hostContext?.setExtensionPrompt;

        const computed = computePromptInjections({ settings });

        if (typeof setPromptFn !== 'function') {
            return computed;
        }

        const staleCandidates = new Set<string>(this._registeredMeta.keys());
        const hostPrompts = hostContext?.extensionPrompts;
        if (isPlainObject(hostPrompts)) {
            for (const existingKey of Object.keys(hostPrompts)) {
                if (existingKey.startsWith(PROMPT_EXTENSION_KEY_PREFIX)) {
                    staleCandidates.add(existingKey);
                }
            }
        }

        const nextMeta = new Map<string, { position: 0 | 1 | 2; depth: number; role: 0 | 1 | 2 }>();

        for (const bucket of computed.buckets) {
            nextMeta.set(bucket.key, {
                position: bucket.position,
                depth: bucket.depth,
                role: bucket.role,
            });
            staleCandidates.delete(bucket.key);
            try {
                setPromptFn(
                    bucket.key,
                    bucket.content,
                    bucket.position,
                    bucket.depth,
                    false,
                    bucket.role
                );
            } catch (err) {
                logger.warn(
                    `[PromptInjector] 调用宿主 setExtensionPrompt(${bucket.key}) 异常:`,
                    err
                );
            }
        }

        for (const staleKey of staleCandidates) {
            const prevMeta = this._registeredMeta.get(staleKey);
            try {
                setPromptFn(
                    staleKey,
                    '',
                    prevMeta?.position ?? 1,
                    prevMeta?.depth ?? 0,
                    false,
                    prevMeta?.role ?? 0
                );
            } catch (err) {
                logger.warn(
                    `[PromptInjector] 清理宿主失效提示词注入项 (${staleKey}) 异常:`,
                    err
                );
            }
        }

        this._registeredMeta.clear();
        for (const [k, meta] of nextMeta.entries()) {
            this._registeredMeta.set(k, meta);
        }

        return computed;
    }

    /**
     * 主动清空本扩展在宿主中注册的全部提示词注入项（供插件停用卸载时调用）。
     */
    public clearAllFromHost(): void {
        this._syncEpoch += 1;
        this._pendingMicrotaskPromise = null;
        const hostContext =
            typeof window !== 'undefined' ? window.SillyTavern?.getContext?.() : undefined;
        const setPromptFn = hostContext?.setExtensionPrompt;
        if (typeof setPromptFn !== 'function') {
            this._registeredMeta.clear();
            return;
        }

        const keysToClear = new Set<string>(this._registeredMeta.keys());
        const hostPrompts = hostContext?.extensionPrompts;
        if (isPlainObject(hostPrompts)) {
            for (const existingKey of Object.keys(hostPrompts)) {
                if (existingKey.startsWith(PROMPT_EXTENSION_KEY_PREFIX)) {
                    keysToClear.add(existingKey);
                }
            }
        }

        for (const key of keysToClear) {
            const prevMeta = this._registeredMeta.get(key);
            try {
                setPromptFn(
                    key,
                    '',
                    prevMeta?.position ?? 1,
                    prevMeta?.depth ?? 0,
                    false,
                    prevMeta?.role ?? 0
                );
            } catch {
                // 忽略卸载阶段异常
            }
        }
        this._registeredMeta.clear();
    }
}

/** 全局提示词注入管理器单例 */
export const promptInjector = new PromptInjector();
