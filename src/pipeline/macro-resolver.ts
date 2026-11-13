/**
 * 素材库角色与服装生图宏解析器 (MacroResolver)。
 *
 * @remarks
 * 负责在提示词清洗前单层解析 `$名称$` 与 `$名称-后缀1-后缀2$` 格式的宏引用：
 * 1. 无后缀调用 (`$名称$`)：展开固定基底标签（角色展开 trigger + parts.appearance；服装展开 trigger + parts.style）；
 * 2. 带后缀调用 (`$名称-特写-feet$` / `$名称-upper_body-socks$`）：
 *    - 支持调用素材库配置中的宏规则（如 '特写' / 'closeup' / '半身' / '全身' / 'nude' 等）；
 *    - 支持直接调用原生部位变量名（如 'head', 'upper_body', 'feet', 'socks', 'shoes' 等）；
 *    - 支持多后缀自由链式叠加，按标准生理/穿搭层级顺序合并去重，空值部位静默跳过；
 * 3. 素材标签内部禁止嵌套其他 `$...$` 宏引用，展开时自动剥离内层宏标记以避免循环嵌套；
 * 4. 主调用名匹配 `name` 或以 `|` 分隔的任意 `aliases`（不区分大小写，带后缀时优先匹配最长名称）；
 * 5. 未命中的宏或包含未知后缀的宏替换为空字符串并记录未解析列表，避免原始宏标记发往生图后端。
 */

import type {
    CharacterPresetData,
    OutfitPresetData,
    MaterialActivationPresetData,
    MaterialMacroRule,
} from '@types';
import { settingsStore, type DrawAssistantSettings } from '../store/settings-store';
import {
    CHARACTER_PART_DEFS,
    OUTFIT_PART_DEFS,
    normalizeCharacterData,
    normalizeOutfitData,
    dedupeCommaTags,
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
    readonly enabled: boolean;
}

/** 后缀链解析结果 */
export interface SuffixResolutionAnalysis {
    /** 已识别的后缀词列表 */
    readonly matchedTokens: string[];
    /** 未识别的非法后缀词列表 */
    readonly unknownSuffixes: string[];
    /** 按标准部位顺序提取出的非空部位标签段落 */
    readonly partSegments: string[];
}

/** 宏解析结果结构 */
export interface MacroResolutionResult {
    /** 展开宏之后的提示词文本 */
    readonly text: string;
    /** 成功命中的宏标记列表 */
    readonly resolvedMacros: string[];
    /** 未找到对应素材或含未知后缀的宏标记列表 */
    readonly unresolvedMacros: string[];
}

const CHAR_PART_KEY_SET = new Set<string>(CHARACTER_PART_DEFS.map((d) => d.key));
const OUTFIT_PART_KEY_SET = new Set<string>(OUTFIT_PART_DEFS.map((d) => d.key));

/**
 * 剥离素材标签文本中可能混入的 `$...$` 宏标记，确保素材词条单层展开不产生嵌套引用。
 */
export function stripNestedMacroTokens(rawTags: string): string {
    if (!rawTags || typeof rawTags !== 'string' || !rawTags.includes('$')) {
        return (rawTags || '').trim();
    }
    return rawTags
        .replace(/\$[^$\r\n]*\$/g, '')
        .replace(/\$/g, '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .join(', ');
}

/**
 * 构建宏规则字典映射表（宏名称/别名 -> 部位键列表）。
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
 * 解析角色或服装的后缀链（如 `特写-feet` 或 `closeup-back`）。
 */
export function analyzeMaterialSuffixes(
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
    const selectedParts = new Set<string>();
    const matchedTokens: string[] = [];
    const unknownSuffixes: string[] = [];

    if (kind === 'character') {
        for (const seg of rawSegments) {
            const lower = seg.toLowerCase();
            const macroParts = ruleMap.get(lower);

            if (macroParts) {
                for (const p of macroParts) {
                    selectedParts.add(p);
                }
                matchedTokens.push(lower);
            } else if (CHAR_PART_KEY_SET.has(lower)) {
                // 原生身体/服装部位变量直接调用
                selectedParts.add(lower);
                matchedTokens.push(lower);
            } else {
                unknownSuffixes.push(seg);
            }
        }

        const partSegments: string[] = [];
        for (const def of CHARACTER_PART_DEFS) {
            if (selectedParts.has(def.key)) {
                const val = (parts[def.key] || '').trim();
                if (val) {
                    partSegments.push(val);
                }
            }
        }

        return { matchedTokens, unknownSuffixes, partSegments };
    }

    // Outfit
    for (const seg of rawSegments) {
        const lower = seg.toLowerCase();
        const macroParts = ruleMap.get(lower);

        if (macroParts) {
            for (const p of macroParts) {
                selectedParts.add(p);
            }
            matchedTokens.push(lower);
        } else if (OUTFIT_PART_KEY_SET.has(lower)) {
            // 原生穿戴部位变量直接调用
            selectedParts.add(lower);
            matchedTokens.push(lower);
        } else {
            unknownSuffixes.push(seg);
        }
    }

    const partSegments: string[] = [];
    for (const def of OUTFIT_PART_DEFS) {
        if (selectedParts.has(def.key)) {
            const val = (parts[def.key] || '').trim();
            if (val) {
                partSegments.push(val);
            }
        }
    }

    return { matchedTokens, unknownSuffixes, partSegments };
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

    const activeActId = settings.materialConfig?.activeActivationPresetId;
    const actList = (settings.presets.material_activations || []) as Array<{
        id: string;
        data: MaterialActivationPresetData;
    }>;
    const currentActPreset = actList.find((p) => p.id === activeActId) || actList[0];
    const charRules = currentActPreset?.data?.characterRules || {};
    const outfitRules = currentActPreset?.data?.outfitRules || {};

    for (const item of charPresets) {
        const raw = item?.data as Partial<CharacterPresetData> | undefined;
        const data = normalizeCharacterData(raw);
        const primaryName = data.name.trim() || (item?.name || '').trim();
        if (!primaryName) continue;

        const aliasList = data.aliases
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean);
        const matchNames = Array.from(new Set([primaryName, ...aliasList]));

        const rule = charRules[item.id] || charRules[primaryName];
        const isEnabled = rule ? Boolean(rule.enabled) : true;

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
            enabled: isEnabled,
        });
    }

    for (const item of outfitPresets) {
        const raw = item?.data as Partial<OutfitPresetData> | undefined;
        const data = normalizeOutfitData(raw);
        const primaryName = data.name.trim() || (item?.name || '').trim();
        if (!primaryName) continue;

        const aliasList = data.aliases
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean);
        const matchNames = Array.from(new Set([primaryName, ...aliasList]));

        const rule = outfitRules[item.id] || outfitRules[primaryName];
        const isEnabled = rule ? Boolean(rule.enabled) : true;

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
            enabled: isEnabled,
        });
    }

    entries.sort((a, b) => Number(b.enabled) - Number(a.enabled));
    return entries;
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

    // 1. 优先尝试完整名称精确匹配（无后缀调用：仅展开常驻标签）
    for (const entry of entries) {
        for (const candidate of entry.matchNames) {
            if (candidate.toLowerCase() === lowerToken) {
                return {
                    matched: true,
                    expanded: entry.triggerTags,
                };
            }
        }
    }

    // 2. 前缀匹配（带宏规则或部位后缀调用：$名称-key1-key2$，选取匹配成功的最长名称）
    let bestEntry: MacroPresetEntry | undefined;
    let bestAliasLength = -1;
    let bestRemainder = '';

    for (const entry of entries) {
        for (const candidate of entry.matchNames) {
            const lowerCandidate = candidate.toLowerCase();
            if (
                lowerToken.startsWith(`${lowerCandidate}-`) &&
                lowerCandidate.length > bestAliasLength
            ) {
                bestEntry = entry;
                bestAliasLength = lowerCandidate.length;
                bestRemainder = token.slice(candidate.length + 1);
            }
        }
    }

    if (bestEntry) {
        const rules = bestEntry.kind === 'character' ? charRules : outfitRules;
        const analysis = analyzeMaterialSuffixes(
            bestEntry.kind,
            bestRemainder,
            bestEntry.parts,
            rules
        );
        if (analysis.unknownSuffixes.length > 0 || analysis.matchedTokens.length === 0) {
            return { matched: false, expanded: '' };
        }
        const combined = dedupeCommaTags([
            bestEntry.triggerTags,
            ...analysis.partSegments,
        ]);
        return {
            matched: true,
            expanded: combined,
        };
    }

    return { matched: false, expanded: '' };
}

/**
 * 展开提示词文本中的所有角色与服装宏 (`$名称$` / `$名称-后缀1-后缀2$`)。
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
    const fmtPresets = settings?.presets?.material_formats || [];
    const activeFmtId = settings?.materialConfig?.activeFormatPresetId;
    const activeFmtPreset = fmtPresets.find((p) => p.id === activeFmtId) || fmtPresets[0];
    const fmtData = activeFmtPreset?.data;

    const charRules =
        settings?.materialConfig?.characterMacros && settings.materialConfig.characterMacros.length > 0
            ? settings.materialConfig.characterMacros
            : fmtData?.characterMacros || [];
    const outfitRules =
        settings?.materialConfig?.outfitMacros && settings.materialConfig.outfitMacros.length > 0
            ? settings.materialConfig.outfitMacros
            : fmtData?.outfitMacros || [];

    const resolvedMacros: string[] = [];
    const unresolvedMacros: string[] = [];

    const expandedText = text.replace(
        /\$([^\s$,，;；:：!！?？]+?)\$/g,
        (fullMatch, innerToken: string) => {
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
                return expanded;
            }

            unresolvedMacros.push(trimmed);
            return '';
        }
    );

    if (unresolvedMacros.length > 0) {
        logger.warn(
            `[MacroResolver] 未找到角色/服装宏定义或包含未知后缀，已自动清空: ${unresolvedMacros.map((m) => `$${m}$`).join(', ')}`
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

/** 内部后缀补全描述项 */
interface SuffixDescriptor {
    readonly key: string;
    readonly subLabel: string;
    readonly badge: string;
    readonly hasConfiguredValue: boolean;
    readonly isShortcut: boolean;
}

/** 编辑框内单个 $宏$ 调用诊断结果 */
export interface MacroTokenDiagnostic {
    /** 原始宏片段（含首尾 $，如 "$角色名-upper$"） */
    readonly rawToken: string;
    /** 去除首尾 $ 后的内部标识 */
    readonly innerToken: string;
    /** 宏调用细分状态：active（已激活生效）、inactive（已匹配但当前预设未启用）、invalid（未定义或后缀失效） */
    readonly status: 'active' | 'inactive' | 'invalid';
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
 * 切分已确认的前置后缀链与当前正在输入的末尾后缀片段。
 */
function splitSuffixRemainder(
    remainder: string,
    allKeys: string[],
): {
    consumedPrefix: string;
    partialQuery: string;
    usedKeys: Set<string>;
} {
    const usedKeys = new Set<string>();
    const consumedParts: string[] = [];

    const sortedKeys = [...allKeys].sort((a, b) => b.length - a.length);

    let cursor = remainder;
    while (cursor.length > 0) {
        const lowerCursor = cursor.toLowerCase();
        let matchedKey: string | undefined;

        for (const key of sortedKeys) {
            const lowerKey = key.toLowerCase();
            if (lowerCursor.startsWith(`${lowerKey}-`)) {
                matchedKey = key;
                cursor = cursor.slice(key.length + 1);
                break;
            }
        }

        if (matchedKey) {
            usedKeys.add(matchedKey.toLowerCase());
            consumedParts.push(matchedKey);
        } else {
            break;
        }
    }

    return {
        consumedPrefix: consumedParts.join('-'),
        partialQuery: cursor.trim(),
        usedKeys,
    };
}

/**
 * 构建 `$名称-后缀1-后缀2$` 链式宏规则与部位候选列表。
 */
function buildSuffixCandidates(
    entry: MacroPresetEntry,
    matchedAlias: string,
    remainder: string,
    limit: number,
    settings?: Partial<DrawAssistantSettings>,
): LexiconCandidateItem[] {
    const descriptors: SuffixDescriptor[] = [];

    const effectiveSettings = settings ?? settingsStore.getSettings();
    const fmtPresets = effectiveSettings?.presets?.material_formats || [];
    const activeFmtId = effectiveSettings?.materialConfig?.activeFormatPresetId;
    const activeFmtPreset = fmtPresets.find((p) => p.id === activeFmtId) || fmtPresets[0];
    const fmtData = activeFmtPreset?.data;
    const matCfg = effectiveSettings?.materialConfig;

    if (entry.kind === 'character') {
        const rules =
            matCfg?.characterMacros && matCfg.characterMacros.length > 0
                ? matCfg.characterMacros
                : fmtData?.characterMacros || [];
        for (const rule of rules) {
            descriptors.push({
                key: rule.name,
                subLabel: rule.description || `部位: ${rule.targetParts.join(', ')}`,
                badge: `${entry.name}·宏`,
                hasConfiguredValue: true,
                isShortcut: true,
            });
        }
        for (const def of CHARACTER_PART_DEFS) {
            const val = (entry.parts[def.key] || '').trim();
            descriptors.push({
                key: def.key,
                subLabel: `${def.label} · ${val || '未填写'}`,
                badge: `${entry.name}·部位`,
                hasConfiguredValue: Boolean(val),
                isShortcut: false,
            });
        }
    } else {
        const rules =
            matCfg?.outfitMacros && matCfg.outfitMacros.length > 0
                ? matCfg.outfitMacros
                : fmtData?.outfitMacros || [];
        for (const rule of rules) {
            descriptors.push({
                key: rule.name,
                subLabel: rule.description || `部位: ${rule.targetParts.join(', ')}`,
                badge: `${entry.name}·宏`,
                hasConfiguredValue: true,
                isShortcut: true,
            });
        }
        for (const def of OUTFIT_PART_DEFS) {
            const val = (entry.parts[def.key] || '').trim();
            descriptors.push({
                key: def.key,
                subLabel: `${def.label} · ${val || '未填写'}`,
                badge: `${entry.name}·部位`,
                hasConfiguredValue: Boolean(val),
                isShortcut: false,
            });
        }
    }

    const { consumedPrefix, partialQuery, usedKeys } = splitSuffixRemainder(
        remainder,
        descriptors.map((d) => d.key),
    );

    const q = partialQuery.toLowerCase();
    const prefixChain = consumedPrefix
        ? `${matchedAlias}-${consumedPrefix}`
        : matchedAlias;

    return descriptors
        .filter((desc) => {
            const keyLower = desc.key.toLowerCase();
            if (usedKeys.has(keyLower)) {
                return false;
            }
            if (!q) {
                return true;
            }
            return (
                keyLower.includes(q) ||
                desc.subLabel.toLowerCase().includes(q)
            );
        })
        .sort((a, b) => {
            if (a.isShortcut !== b.isShortcut) {
                return a.isShortcut ? -1 : 1;
            }
            if (a.hasConfiguredValue !== b.hasConfiguredValue) {
                return a.hasConfiguredValue ? -1 : 1;
            }
            return 0;
        })
        .slice(0, limit)
        .map((desc) => ({
            kind: 'material-suffix',
            insertText: `$${prefixChain}-${desc.key}$`,
            label: `-${desc.key}`,
            subLabel: desc.subLabel,
            badge: desc.badge,
        }));
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

    const settings = customSettings ?? settingsStore.getSettings();
    const inner = trimmed.replace(/^\$+/, '').replace(/\$+$/, '');
    const lowerInner = inner.toLowerCase();

    const entries = buildMacroPresetEntries(settings);
    if (entries.length === 0) {
        return [];
    }

    // 1. 检查是否处于 `$名称-...` 后缀输入阶段（选取匹配成功的最长名称/别名）
    let bestEntry: MacroPresetEntry | undefined;
    let bestAlias = '';
    let bestRemainder = '';

    for (const entry of entries) {
        for (const candidate of entry.matchNames) {
            const lowerCandidate = candidate.toLowerCase();
            if (
                lowerInner.startsWith(`${lowerCandidate}-`) &&
                lowerCandidate.length > bestAlias.length
            ) {
                bestEntry = entry;
                bestAlias = candidate;
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
        isActivated: boolean;
        matchTier: number;
    }> = [];

    for (const entry of entries) {
        const isActivated = entry.enabled;
        if (!lowerInner) {
            scored.push({ entry, isActivated, matchTier: 2 });
            continue;
        }

        let matchTier = 0;
        if (entry.matchNames.some((n) => n.toLowerCase().startsWith(lowerInner))) {
            matchTier = 3;
        } else if (
            entry.matchNames.some((n) => n.toLowerCase().includes(lowerInner)) ||
            entry.description.toLowerCase().includes(lowerInner)
        ) {
            matchTier = 2;
        }

        if (matchTier > 0) {
            scored.push({ entry, isActivated, matchTier });
        }
    }

    scored.sort((a, b) => {
        if (a.isActivated !== b.isActivated) {
            return a.isActivated ? -1 : 1;
        }
        if (b.matchTier !== a.matchTier) {
            return b.matchTier - a.matchTier;
        }
        if (a.entry.kind !== b.entry.kind) {
            return a.entry.kind === 'character' ? -1 : 1;
        }
        return a.entry.name.localeCompare(b.entry.name);
    });

    return scored.slice(0, limit).map(({ entry, isActivated }) => {
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
            badge: isActivated ? `${baseBadge}·已启用` : baseBadge,
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
    const fmtPresets = settings?.presets?.material_formats || [];
    const activeFmtId = settings?.materialConfig?.activeFormatPresetId;
    const activeFmtPreset = fmtPresets.find((p) => p.id === activeFmtId) || fmtPresets[0];
    const fmtData = activeFmtPreset?.data;

    const charRules =
        settings?.materialConfig?.characterMacros && settings.materialConfig.characterMacros.length > 0
            ? settings.materialConfig.characterMacros
            : fmtData?.characterMacros || [];
    const outfitRules =
        settings?.materialConfig?.outfitMacros && settings.materialConfig.outfitMacros.length > 0
            ? settings.materialConfig.outfitMacros
            : fmtData?.outfitMacros || [];

    const diagnostics: MacroTokenDiagnostic[] = [];

    const regex = /\$([^\s$,，;；:：!！?？]+?)\$/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const rawToken = match[0];
        const innerToken = (match[1] || '').trim();
        if (!innerToken || /^\d+(\.\d+)?$/.test(innerToken)) {
            continue;
        }

        const lowerToken = innerToken.toLowerCase();

        // 1. 尝试无后缀完整名称或别名匹配
        let exactEntry: MacroPresetEntry | undefined;
        for (const entry of entries) {
            if (entry.matchNames.some((n) => n.toLowerCase() === lowerToken)) {
                exactEntry = entry;
                break;
            }
        }

        if (exactEntry) {
            const status = exactEntry.enabled ? 'active' : 'inactive';
            diagnostics.push({
                rawToken,
                innerToken,
                status,
                valid: true,
                kind: exactEntry.kind,
                materialName: exactEntry.name,
                expandedTags: exactEntry.triggerTags,
                unknownSuffixes: [],
                reason: exactEntry.enabled
                    ? `已匹配${exactEntry.kind === 'character' ? '角色' : '服装'}「${exactEntry.name}」专属触发词`
                    : `已匹配${exactEntry.kind === 'character' ? '角色' : '服装'}「${exactEntry.name}」，但在当前启用预设中处于禁用状态（生图仍按全库展开）`,
            });
            continue;
        }

        // 2. 尝试带景别或部位后缀的最长名称匹配
        let bestEntry: MacroPresetEntry | undefined;
        let bestAliasLen = -1;
        let bestRemainder = '';

        for (const entry of entries) {
            for (const candidate of entry.matchNames) {
                const lowerCandidate = candidate.toLowerCase();
                if (
                    lowerToken.startsWith(`${lowerCandidate}-`) &&
                    lowerCandidate.length > bestAliasLen
                ) {
                    bestEntry = entry;
                    bestAliasLen = lowerCandidate.length;
                    bestRemainder = innerToken.slice(candidate.length + 1);
                }
            }
        }

        if (bestEntry) {
            const rules = bestEntry.kind === 'character' ? charRules : outfitRules;
            const analysis = analyzeMaterialSuffixes(
                bestEntry.kind,
                bestRemainder,
                bestEntry.parts,
                rules
            );

            const expandedTags = dedupeCommaTags([
                bestEntry.triggerTags,
                ...analysis.partSegments,
            ]);

            const valid =
                analysis.unknownSuffixes.length === 0 &&
                analysis.matchedTokens.length > 0;
            let status: 'active' | 'inactive' | 'invalid';
            let reason: string;
            if (!valid) {
                status = 'invalid';
                reason = `「${bestEntry.name}」包含未定义的宏规则或部位后缀: ${analysis.unknownSuffixes.join(', ')}（生图时将自动清空）`;
            } else if (bestEntry.enabled) {
                status = 'active';
                reason = `已匹配「${bestEntry.name}」+ 后缀 [${analysis.matchedTokens.join(', ')}]`;
            } else {
                status = 'inactive';
                reason = `已匹配「${bestEntry.name}」+ 后缀 [${analysis.matchedTokens.join(', ')}]，但在当前启用预设中处于禁用状态（生图仍按全库展开）`;
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
