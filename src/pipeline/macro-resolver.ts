/**
 * 素材库角色与服装生图宏解析器 (MacroResolver)。
 *
 * @remarks
 * 负责在提示词清洗前单层解析 `$名称-宏-状态$` 格式的素材宏引用：
 * 1. 严格固定格式 (`$名称-宏-状态$`):
 *    - 前段匹配素材库格式预设中的宏规则（如 `closeup` / `upper` / `cowboy` / `full` / `bust` / `crotch` 等）；
 *    - 后段匹配该类型的固定状态后缀（角色: `covered` / `exposed` / `nude`；服装: `intact` / `disheveled`）；
 *    - 展开时按标准部位顺序依次加载各选中部位的 `通用tags + [状态]tags` 并去重。
 * 2. 缺省状态降级 (`$名称-宏$`):
 *    - 仅作解析器回退策略，不鼓励 AI 省略状态；省略状态时仅展开选中部位的 `通用tags`。
 * 3. 无后缀调用 (`$名称$`):
 *    - 若档案配有专属触发词 (`data.trigger`)，仅展开触发词；不支持直接调用部位或叠加多段后缀。
 * 4. 防循环嵌套与匹配优先级：
 *    - 自动剥离部位文本内混入的 `$...$` 标记；匹配名优先主名称，同长时合法后缀优先。
 */

import type {
    CharacterPresetData,
    OutfitPresetData,
    MaterialMacroRule,
} from '@types';
import { settingsStore, type DrawAssistantSettings } from '../store/settings-store';
import {
    CHARACTER_PART_DEFS,
    OUTFIT_PART_DEFS,
    CHARACTER_PART_STATES,
    OUTFIT_PART_STATES,
    CHARACTER_PART_STATE_LABELS,
    OUTFIT_PART_STATE_LABELS,
    normalizeCharacterData,
    normalizeOutfitData,
    dedupeCommaTags,
    splitKeywordTokens,
    resolveActiveMaterialFormatConfig,
    resolvePartTagsForState,
} from './material-definitions';
import { logger } from '../util/logger';

/** 统一的可展开宏预设条目结构（角色或服装） */
export interface MacroPresetEntry {
    readonly presetId: string;
    readonly kind: 'character' | 'outfit';
    readonly name: string;
    readonly aliases: string;
    readonly description: string;
    /** 包含主名称与全部 | 分隔别名的候选匹配数组 */
    readonly matchNames: string[];
    /** 专属触发词标签（已清洗嵌套宏的 data.trigger） */
    readonly triggerTags: string;
    /** 清洗过嵌套宏标记的部位标签字典 */
    readonly parts: Record<string, string>;
}

/** 后缀解析结果 */
export interface SuffixResolutionAnalysis {
    /** 已识别的宏名与状态词列表 */
    readonly matchedTokens: string[];
    /** 未识别或非法的后缀词列表 */
    readonly unknownSuffixes: string[];
    /** 按标准部位顺序提取出的非空部位标签段落 */
    readonly partSegments: string[];
    /** 命中降级无状态调用（仅输出通用 tags） */
    readonly isStateFallback?: boolean;
}

/** 宏解析结果结构 */
export interface MacroResolutionResult {
    /** 展开宏之后的提示词文本 */
    readonly text: string;
    /** 成功命中的宏标记列表 */
    readonly resolvedMacros: string[];
    /** 未找到对应素材或含非法后缀的宏标记列表 */
    readonly unresolvedMacros: string[];
}

const CHAR_STATE_SET = new Set<string>(CHARACTER_PART_STATES);
const OUTFIT_STATE_SET = new Set<string>(OUTFIT_PART_STATES);

/**
 * 剥离素材标签文本中可能混入的 `$...$` 宏标记（与主解析保持一致的边界定义），确保单层展开不产生循环引用。
 */
export function stripNestedMacroTokens(rawTags: string): string {
    if (!rawTags || typeof rawTags !== 'string' || !rawTags.includes('$')) {
        return (rawTags || '').trim();
    }
    return rawTags
        .replace(/\$([^\r\n$,，;；:：!！?？]+?)\$/g, (full, inner: string) =>
            /^\d+(\.\d+)?$/.test(inner.trim()) ? full : ''
        )
        .split(/[,，]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .join(', ');
}

/**
 * 构建宏规则字典映射表（宏名称 -> 部位键列表）。
 */
function buildMacroRuleMap(
    rules?: MaterialMacroRule[]
): Map<string, readonly string[]> {
    const map = new Map<string, readonly string[]>();
    if (!Array.isArray(rules)) return map;

    for (const rule of rules) {
        if (!rule?.name) continue;
        const lowerName = rule.name.trim().toLowerCase();
        map.set(lowerName, rule.targetParts || []);
    }

    return map;
}

/**
 * 解析角色或服装的 `$名称-宏-状态$` 后缀（兼容省略状态的 `$名称-宏$` 回退策略）。
 */
function analyzeMaterialSuffixes(
    kind: 'character' | 'outfit',
    remainder: string,
    parts: Record<string, string>,
    customRules?: MaterialMacroRule[]
): SuffixResolutionAnalysis {
    const rawSegments = (remainder || '')
        .split('-')
        .map((s) => s.trim())
        .filter(Boolean);

    if (rawSegments.length === 0) {
        return {
            matchedTokens: [],
            unknownSuffixes: [],
            partSegments: [],
        };
    }

    const ruleMap = buildMacroRuleMap(customRules);
    const validStates = kind === 'character' ? CHAR_STATE_SET : OUTFIT_STATE_SET;
    const partDefs = kind === 'character' ? CHARACTER_PART_DEFS : OUTFIT_PART_DEFS;

    const macroSeg = rawSegments[0];
    const macroKey = macroSeg.toLowerCase();
    const macroParts = ruleMap.get(macroKey);

    if (rawSegments.length === 1) {
        if (!macroParts) {
            return {
                matchedTokens: [],
                unknownSuffixes: [macroSeg],
                partSegments: [],
            };
        }
        // 降级回退：仅命中宏名但缺少状态后缀时，仅加载各选中部位的通用 tags
        const selectedParts = new Set(macroParts);
        const partSegments: string[] = [];
        for (const def of partDefs) {
            if (!selectedParts.has(def.key)) continue;
            const resolved = resolvePartTagsForState(parts[def.key] || '', undefined);
            if (resolved) {
                partSegments.push(resolved);
            }
        }
        return {
            matchedTokens: [macroKey],
            unknownSuffixes: [],
            partSegments,
            isStateFallback: true,
        };
    }

    const stateSeg = rawSegments[1];
    const stateKey = stateSeg.toLowerCase();
    const matchedTokens: string[] = [];
    const unknownSuffixes: string[] = [];

    if (macroParts) {
        matchedTokens.push(macroKey);
    } else {
        unknownSuffixes.push(macroSeg);
    }

    if (validStates.has(stateKey)) {
        matchedTokens.push(stateKey);
    } else {
        unknownSuffixes.push(stateSeg);
    }

    if (rawSegments.length > 2) {
        unknownSuffixes.push(...rawSegments.slice(2));
    }

    if (unknownSuffixes.length > 0 || !macroParts) {
        return {
            matchedTokens,
            unknownSuffixes,
            partSegments: [],
        };
    }

    const selectedParts = new Set(macroParts);
    const partSegments: string[] = [];
    for (const def of partDefs) {
        if (!selectedParts.has(def.key)) continue;
        const resolved = resolvePartTagsForState(parts[def.key] || '', stateKey);
        if (resolved) {
            partSegments.push(resolved);
        }
    }

    return {
        matchedTokens,
        unknownSuffixes: [],
        partSegments,
    };
}

/**
 * 从配置快照构建角色与服装的统一宏条目检索表。
 */
export function buildMacroPresetEntries(
    settings?: Partial<DrawAssistantSettings>
): MacroPresetEntry[] {
    if (!settings?.presets) {
        return [];
    }

    const entries: MacroPresetEntry[] = [];
    const charPresets = settings.presets.characters || [];
    const outfitPresets = settings.presets.outfits || [];

    for (const item of charPresets) {
        const raw = item?.data as Partial<CharacterPresetData> | undefined;
        const data = normalizeCharacterData(raw);
        const primaryName = data.name.trim();
        if (!primaryName) continue;

        const aliasList = splitKeywordTokens(data.aliases);
        const matchNames = Array.from(new Set([primaryName, ...aliasList]));

        const triggerSegs: string[] = [];
        if (data.trigger?.trim()) {
            triggerSegs.push(stripNestedMacroTokens(data.trigger));
        }

        const cleanedParts: Record<string, string> = {};
        for (const def of CHARACTER_PART_DEFS) {
            cleanedParts[def.key] = stripNestedMacroTokens(data.parts[def.key] || '');
        }

        entries.push({
            presetId: item.id,
            kind: 'character',
            name: primaryName,
            aliases: data.aliases.trim(),
            description: data.description.trim(),
            matchNames,
            triggerTags: dedupeCommaTags(triggerSegs),
            parts: cleanedParts,
        });
    }

    for (const item of outfitPresets) {
        const raw = item?.data as Partial<OutfitPresetData> | undefined;
        const data = normalizeOutfitData(raw);
        const primaryName = data.name.trim();
        if (!primaryName) continue;

        const aliasList = splitKeywordTokens(data.aliases);
        const matchNames = Array.from(new Set([primaryName, ...aliasList]));

        const triggerSegs: string[] = [];
        if (data.trigger?.trim()) {
            triggerSegs.push(stripNestedMacroTokens(data.trigger));
        }

        const cleanedParts: Record<string, string> = {};
        for (const def of OUTFIT_PART_DEFS) {
            cleanedParts[def.key] = stripNestedMacroTokens(data.parts[def.key] || '');
        }

        entries.push({
            presetId: item.id,
            kind: 'outfit',
            name: primaryName,
            aliases: data.aliases.trim(),
            description: data.description.trim(),
            matchNames,
            triggerTags: dedupeCommaTags(triggerSegs),
            parts: cleanedParts,
        });
    }

    return entries;
}

interface CandidateMatch {
    readonly entry: MacroPresetEntry;
    readonly alias: string;
    readonly isPrimaryName: boolean;
    readonly remainder: string;
    readonly analysis: SuffixResolutionAnalysis;
    readonly valid: boolean;
}

/**
 * 在候选名称与别名列表中收集全部命中 `$前缀-后缀$` 形态的候选并按「后缀全合法 > 匹配名更长 > 主名称优先」择优。
 */
function pickBestSuffixCandidate(
    token: string,
    entries: MacroPresetEntry[],
    charRules?: MaterialMacroRule[],
    outfitRules?: MaterialMacroRule[]
): CandidateMatch | undefined {
    const lowerToken = token.toLowerCase();
    const candidates: CandidateMatch[] = [];

    for (const entry of entries) {
        const rules = entry.kind === 'character' ? charRules : outfitRules;
        const primaryLower = entry.name.toLowerCase();
        for (const alias of entry.matchNames) {
            const lowerAlias = alias.toLowerCase();
            if (!lowerAlias || !lowerToken.startsWith(`${lowerAlias}-`)) {
                continue;
            }
            const remainder = token.slice(alias.length + 1);
            const analysis = analyzeMaterialSuffixes(entry.kind, remainder, entry.parts, rules);
            const valid = analysis.unknownSuffixes.length === 0 && analysis.matchedTokens.length > 0;
            candidates.push({
                entry,
                alias,
                isPrimaryName: lowerAlias === primaryLower,
                remainder,
                analysis,
                valid,
            });
        }
    }

    if (candidates.length === 0) {
        return undefined;
    }

    candidates.sort((a, b) => {
        if (a.valid !== b.valid) return a.valid ? -1 : 1;
        if (b.alias.length !== a.alias.length) return b.alias.length - a.alias.length;
        if (a.isPrimaryName !== b.isPrimaryName) return a.isPrimaryName ? -1 : 1;
        return 0;
    });

    return candidates[0];
}

/**
 * 匹配单个宏内部标识并展开为对应的 Tags 字符串。
 */
function expandSingleMacroToken(
    rawToken: string,
    entries: MacroPresetEntry[],
    charRules?: MaterialMacroRule[],
    outfitRules?: MaterialMacroRule[]
): { matched: boolean; expanded: string } {
    const token = rawToken.trim();
    if (!token) {
        return { matched: false, expanded: '' };
    }

    const lowerToken = token.toLowerCase();

    // 1. 无后缀调用 ($名称$) 仅在配置了非空专属触发词时展开触发词
    const exactPrimary = entries.find((entry) => entry.name.toLowerCase() === lowerToken);
    const exactEntry =
        exactPrimary ||
        entries.find((entry) => entry.matchNames.some((c) => c.toLowerCase() === lowerToken));
    if (exactEntry) {
        const trigger = exactEntry.triggerTags.trim();
        return trigger ? { matched: true, expanded: trigger } : { matched: false, expanded: '' };
    }

    // 2. 前缀匹配（固定格式：$名称-宏-状态$，兼容缺省状态的 $名称-宏$ 回退）
    const best = pickBestSuffixCandidate(token, entries, charRules, outfitRules);
    if (best) {
        if (!best.valid) {
            return { matched: false, expanded: '' };
        }
        const combined = dedupeCommaTags([
            best.entry.triggerTags,
            ...best.analysis.partSegments,
        ]);
        return {
            matched: true,
            expanded: combined,
        };
    }

    return { matched: false, expanded: '' };
}

/**
 * 展开提示词文本中的所有角色与服装宏 (`$名称-宏-状态$` / 非空触发词 `$名称$`)。
 */
export function resolvePromptMacros(
    text: string,
    settings?: Partial<DrawAssistantSettings>
): MacroResolutionResult {
    if (!text || typeof text !== 'string' || !text.includes('$')) {
        return {
            text: text || '',
            resolvedMacros: [],
            unresolvedMacros: [],
        };
    }

    const entries = buildMacroPresetEntries(settings);
    const fmtData = resolveActiveMaterialFormatConfig(settings as DrawAssistantSettings);
    const charRules = fmtData.characterMacros || [];
    const outfitRules = fmtData.outfitMacros || [];

    const resolvedMacros: string[] = [];
    const unresolvedMacros: string[] = [];

    const expandedText = text.replace(
        /(\(\s*)\$([^\r\n$,，;；:：!！?？()（）]+?)\$(\s*\))|(（\s*)\$([^\r\n$,，;；:：!！?？()（）]+?)\$(\s*）)|\$([^\r\n$,，;；:：!！?？]+?)\$/g,
        (
            fullMatch,
            halfOpen: string | undefined,
            halfInner: string | undefined,
            halfClose: string | undefined,
            fullOpen: string | undefined,
            fullInner: string | undefined,
            fullClose: string | undefined,
            bareInner: string | undefined
        ) => {
            const innerToken = halfInner ?? fullInner ?? bareInner ?? '';
            const openWrapper = halfOpen ?? fullOpen ?? '';
            const closeWrapper = halfClose ?? fullClose ?? '';
            const hasWrapper = Boolean(openWrapper && closeWrapper);

            const trimmed = innerToken.trim();
            if (!trimmed) {
                return fullMatch;
            }

            // 纯数字或金额格式（如 $100$）不作为宏处理，原样保留
            if (/^\d+(\.\d+)?$/.test(trimmed)) {
                return fullMatch;
            }

            const { matched, expanded } = expandSingleMacroToken(
                trimmed,
                entries,
                charRules,
                outfitRules
            );
            if (matched) {
                resolvedMacros.push(trimmed);
                return hasWrapper ? `${openWrapper}${expanded}${closeWrapper}` : expanded;
            }

            unresolvedMacros.push(trimmed);
            // 行内括号写法（如 爱丽丝($不存在$)）若宏未命中，同步移除空括号以避免残留 ()
            return '';
        }
    );

    if (unresolvedMacros.length > 0) {
        logger.warn(
            `[MacroResolver] 宏未命中、缺少 -宏-状态 后缀（且无触发词）或含非法后缀，已自动清空: ${unresolvedMacros.map((m) => `$${m}$`).join(', ')}`
        );
    }

    return {
        text: expandedText,
        resolvedMacros,
        unresolvedMacros,
    };
}

/** 联想候选条目类型 */
export type LexiconCandidateKind =
    | 'custom-word'
    | 'file-word'
    | 'material-macro'
    | 'material-suffix';

/** 统一联想候选条目结构 */
export interface LexiconCandidateItem {
    readonly kind: LexiconCandidateKind;
    /** 选中后替换当前输入片段的完整文本 */
    readonly insertText: string;
    /** 候选主标题（如英文 Tag、$名称$ 或 -upper） */
    readonly label: string;
    /** 候选副标题（如中文释义、角色别名或部位说明） */
    readonly subLabel?: string;
    /** 右侧来源徽章文本 */
    readonly badge: string;
    /** 词频热度（可选） */
    readonly count?: number;
    /** Danbooru 分类编号（可选） */
    readonly category?: number;
}

/** 编辑框内单个 $宏$ 调用诊断结果 */
export interface MacroTokenDiagnostic {
    /** 原始宏片段（含首尾 $，如 "$角色名-full-covered$"） */
    readonly rawToken: string;
    /** 去除首尾 $ 后的内部标识 */
    readonly innerToken: string;
    /** 宏调用细分状态：active（有效匹配）、invalid（未定义或后缀失效） */
    readonly status: 'active' | 'invalid';
    /** 是否有效命中素材库且所有后缀均合法 */
    readonly valid: boolean;
    /** 命中的素材类型 */
    readonly kind?: 'character' | 'outfit';
    /** 命中的素材主名称 */
    readonly materialName?: string;
    /** 展开后的实际 Tags 预览 */
    readonly expandedTags: string;
    /** 未识别的后缀列表 */
    readonly unknownSuffixes: string[];
    /** 状态说明文案 */
    readonly reason: string;
}

/**
 * 构建 `$名称-宏-状态$` 两段式补全候选列表（先匹配宏规则，或在 `-宏-` 后选择固定状态后缀）。
 */
function buildSuffixCandidates(
    entry: MacroPresetEntry,
    matchedAlias: string,
    remainder: string,
    limit: number,
    settings?: Partial<DrawAssistantSettings>,
): LexiconCandidateItem[] {
    const effectiveSettings = settings ?? settingsStore.getSettings();
    const fmtData = resolveActiveMaterialFormatConfig(effectiveSettings as DrawAssistantSettings);
    const rules =
        entry.kind === 'character'
            ? fmtData.characterMacros || []
            : fmtData.outfitMacros || [];

    const lowerRemainder = (remainder || '').toLowerCase();
    const sortedRules = [...rules]
        .filter((r) => Boolean(r?.name?.trim()))
        .sort((a, b) => b.name.trim().length - a.name.trim().length);

    // 1. 已输入 `$名称-宏名-` 时，进入固定状态后缀选择阶段
    const matchedMacro = sortedRules.find((r) =>
        lowerRemainder.startsWith(`${r.name.trim().toLowerCase()}-`)
    );

    if (matchedMacro) {
        const macroKey = matchedMacro.name.trim();
        const stateQuery = lowerRemainder.slice(macroKey.length + 1).trim();
        const stateList: ReadonlyArray<{ key: string; label: string }> =
            entry.kind === 'character'
                ? CHARACTER_PART_STATES.map((s) => ({
                      key: s,
                      label: CHARACTER_PART_STATE_LABELS[s],
                  }))
                : OUTFIT_PART_STATES.map((s) => ({
                      key: s,
                      label: OUTFIT_PART_STATE_LABELS[s],
                  }));

        return stateList
            .filter(
                (st) =>
                    !stateQuery ||
                    st.key.includes(stateQuery) ||
                    st.label.toLowerCase().includes(stateQuery)
            )
            .slice(0, limit)
            .map((st) => ({
                kind: 'material-suffix',
                insertText: `$${matchedAlias}-${macroKey}-${st.key}$`,
                label: `-${st.key}`,
                subLabel: st.label,
                badge: `${entry.name}·状态`,
            }));
    }

    // 2. 尚未键入状态分隔 `-` 时，推荐宏规则（默认附带常规状态，键入 `-宏名-` 可切选全部状态）
    const q = lowerRemainder.trim();
    return rules
        .filter((rule) => Boolean(rule?.name?.trim()))
        .filter((rule) => {
            if (!q) return true;
            const ruleName = rule.name.trim().toLowerCase();
            const desc = (rule.description || '').toLowerCase();
            return ruleName.includes(q) || desc.includes(q);
        })
        .slice(0, limit)
        .map((rule) => {
            const ruleName = rule.name.trim();
            const defaultState =
                entry.kind === 'character'
                    ? ruleName === 'crotch'
                        ? 'nude'
                        : 'covered'
                    : 'intact';
            const baseDesc =
                rule.description?.trim() || `部位: ${(rule.targetParts || []).join(', ')}`;
            return {
                kind: 'material-suffix',
                insertText: `$${matchedAlias}-${ruleName}-${defaultState}$`,
                label: `-${ruleName}-${defaultState}`,
                subLabel: `${baseDesc}（键入 -${ruleName}- 可选全部状态）`,
                badge: `${entry.name}·宏`,
            };
        });
}

/**
 * 根据输入光标处的当前片段检索匹配的 `$名称$` 宏条目或 `-后缀` 链式调用候选。
 *
 * @param rawToken 当前光标所在的 `$` 起始片段（如 `"$"`, `"$角色"`, `"$角色名-"`）
 * @param customSettings 可选配置快照（默认从 settingsStore 读取）
 * @param limit 最大返回条数
 */
export function searchMaterialMacros(
    rawToken: string,
    customSettings?: Partial<DrawAssistantSettings>,
    limit = 15,
): LexiconCandidateItem[] {
    const trimmed = (rawToken || '').trim();
    if (!trimmed.startsWith('$')) {
        return [];
    }
    // 已通过双侧 `$` 闭合的完整宏引用不再弹出联想面板
    if (trimmed.length > 1 && trimmed.endsWith('$')) {
        return [];
    }

    const settings = customSettings ?? settingsStore.getSettings();
    const inner = trimmed.replace(/^\$+/, '');
    const lowerInner = inner.toLowerCase();

    const entries = buildMacroPresetEntries(settings);
    if (entries.length === 0) {
        return [];
    }

    // 1. 检查是否处于 `$名称-...` 后缀输入阶段（选取匹配成功的最长名称/别名，同长时主名称优先）
    let bestEntry: MacroPresetEntry | undefined;
    let bestAlias = '';
    let bestIsPrimary = false;
    let bestRemainder = '';

    for (const entry of entries) {
        const primaryLower = entry.name.toLowerCase();
        for (const candidate of entry.matchNames) {
            const lowerCandidate = candidate.toLowerCase();
            if (!lowerInner.startsWith(`${lowerCandidate}-`)) {
                continue;
            }
            const isPrimary = lowerCandidate === primaryLower;
            if (
                lowerCandidate.length > bestAlias.length ||
                (lowerCandidate.length === bestAlias.length && isPrimary && !bestIsPrimary)
            ) {
                bestEntry = entry;
                bestAlias = candidate;
                bestIsPrimary = isPrimary;
                bestRemainder = inner.slice(candidate.length + 1);
            }
        }
    }

    if (bestEntry) {
        return buildSuffixCandidates(
            bestEntry,
            bestAlias,
            bestRemainder,
            limit,
            settings,
        );
    }

    // 2. 处于 `$角色或服装名` 主体输入阶段
    const scored: Array<{
        entry: MacroPresetEntry;
        matchTier: number;
    }> = [];

    for (const entry of entries) {
        if (!lowerInner) {
            scored.push({ entry, matchTier: 2 });
            continue;
        }

        let matchTier = 0;
        if (entry.name.toLowerCase().startsWith(lowerInner)) {
            matchTier = 4;
        } else if (entry.matchNames.some((n) => n.toLowerCase().startsWith(lowerInner))) {
            matchTier = 3;
        } else if (
            entry.matchNames.some((n) => n.toLowerCase().includes(lowerInner)) ||
            entry.description.toLowerCase().includes(lowerInner)
        ) {
            matchTier = 2;
        }

        if (matchTier > 0) {
            scored.push({ entry, matchTier });
        }
    }

    scored.sort((a, b) => {
        if (b.matchTier !== a.matchTier) {
            return b.matchTier - a.matchTier;
        }
        if (a.entry.kind !== b.entry.kind) {
            return a.entry.kind === 'character' ? -1 : 1;
        }
        return a.entry.name.localeCompare(b.entry.name);
    });

    return scored.slice(0, limit).map(({ entry }) => {
        const configuredPartCount = Object.values(entry.parts).filter((v) =>
            Boolean(v?.trim()),
        ).length;
        const subParts: string[] = [];
        if (entry.aliases) {
            subParts.push(`别名: ${entry.aliases}`);
        }
        if (entry.description) {
            subParts.push(entry.description);
        }
        if (configuredPartCount > 0) {
            subParts.push(`已填 ${configuredPartCount} 个部位`);
        }

        const baseBadge = entry.kind === 'character' ? '角色宏' : '服装宏';
        return {
            kind: 'material-macro',
            insertText: `$${entry.name}$`,
            label: `$${entry.name}$`,
            subLabel: subParts.join(' · '),
            badge: baseBadge,
        };
    });
}

/**
 * 诊断提示词文本中的所有 `$...$` 宏片段，用于生图编辑框实时展示宏是否调用成功。
 */
export function inspectPromptMacros(
    text: string,
    customSettings?: Partial<DrawAssistantSettings>,
): MacroTokenDiagnostic[] {
    if (!text || typeof text !== 'string' || !text.includes('$')) {
        return [];
    }

    const settings = customSettings ?? settingsStore.getSettings();
    const entries = buildMacroPresetEntries(settings);
    const fmtData = resolveActiveMaterialFormatConfig(settings);
    const charRules = fmtData.characterMacros;
    const outfitRules = fmtData.outfitMacros;

    const diagnostics: MacroTokenDiagnostic[] = [];

    const regex = /\$([^\r\n$,，;；:：!！?？]+?)\$/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const rawToken = match[0];
        const innerToken = (match[1] || '').trim();
        if (!innerToken || /^\d+(\.\d+)?$/.test(innerToken)) {
            continue;
        }

        const lowerToken = innerToken.toLowerCase();

        // 1. 尝试无后缀完整名称或别名匹配（主名称优先于别名）
        const exactEntry =
            entries.find((entry) => entry.name.toLowerCase() === lowerToken) ||
            entries.find((entry) => entry.matchNames.some((n) => n.toLowerCase() === lowerToken));

        if (exactEntry) {
            const trigger = exactEntry.triggerTags.trim();
            if (!trigger) {
                diagnostics.push({
                    rawToken,
                    innerToken,
                    status: 'invalid',
                    valid: false,
                    kind: exactEntry.kind,
                    materialName: exactEntry.name,
                    expandedTags: '',
                    unknownSuffixes: [],
                    reason: `「${exactEntry.name}」未配置专属触发词，请使用 $${exactEntry.name}-宏-状态$ 格式调用（生图时将自动清空）`,
                });
            } else {
                diagnostics.push({
                    rawToken,
                    innerToken,
                    status: 'active',
                    valid: true,
                    kind: exactEntry.kind,
                    materialName: exactEntry.name,
                    expandedTags: trigger,
                    unknownSuffixes: [],
                    reason: `已匹配${exactEntry.kind === 'character' ? '角色' : '服装'}「${exactEntry.name}」专属触发词`,
                });
            }
            continue;
        }

        // 2. 尝试带宏与状态后缀的候选择优匹配
        const bestCandidate = pickBestSuffixCandidate(
            innerToken,
            entries,
            charRules,
            outfitRules
        );

        if (bestCandidate) {
            const { entry: bestEntry, analysis } = bestCandidate;
            const expandedTags = dedupeCommaTags([
                bestEntry.triggerTags,
                ...analysis.partSegments,
            ]);

            const valid =
                analysis.unknownSuffixes.length === 0 &&
                analysis.matchedTokens.length > 0;
            let status: 'active' | 'invalid';
            let reason: string;
            if (analysis.matchedTokens.length === 0 && analysis.unknownSuffixes.length === 0) {
                status = 'invalid';
                reason = `「${bestEntry.name}」末尾的宏后缀为空，请使用 $名称-宏-状态$ 格式或移除末尾 "-"（生图时将自动清空）`;
            } else if (!valid) {
                status = 'invalid';
                reason = `「${bestEntry.name}」包含无效后缀: ${analysis.unknownSuffixes.join(', ')}（请使用 $名称-宏-状态$，不支持直接部位调用或叠加；生图时将自动清空）`;
            } else if (analysis.isStateFallback) {
                status = 'active';
                reason = `已匹配「${bestEntry.name}」宏 [${analysis.matchedTokens[0]}]（未指定状态后缀，降级仅输出通用标签）`;
            } else {
                status = 'active';
                reason = `已匹配「${bestEntry.name}」[$${bestEntry.name}-${analysis.matchedTokens.join('-')}$]`;
            }

            diagnostics.push({
                rawToken,
                innerToken,
                status,
                valid,
                kind: bestEntry.kind,
                materialName: bestEntry.name,
                expandedTags,
                unknownSuffixes: analysis.unknownSuffixes,
                reason,
            });
            continue;
        }

        // 3. 完全未匹配任何角色或服装
        diagnostics.push({
            rawToken,
            innerToken,
            status: 'invalid',
            valid: false,
            expandedTags: '',
            unknownSuffixes: [],
            reason: '素材库中未找到对应的角色或服装定义（生图时将自动清空）',
        });
    }

    return diagnostics;
}
