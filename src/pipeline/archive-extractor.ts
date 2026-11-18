/**
 * 楼层角色与服装档案提取与合并模块 (ArchiveExtractor)。
 *
 * @remarks
 * 负责从聊天消息文本中检测并解析指定标记块（默认 `<character>...</character>` 与 `<outfit>...</outfit>`）：
 * 1. 基础属性提取：识别名称 (`NAME`)、别名 (`ALIASES`)、角色触发词 / 服装触发词 (`TRIGGER`)、描述说明 (`DESCRIPTION`) 与绑定服装 (`OUTFITS`)；
 * 2. 预置部位提取：按 `CHARACTER_PART_DEFS`（含 `appearance`）与 `OUTFIT_PART_DEFS`（含 `style`）的英文键、配置映射与提取别名解析各部位标签，
 *    支持 `face(面部五官): tags` 或 `face: tags` 写法，按顶层首个冒号切分以保留 `(tag:1.2)` 等权重语法与括号备注内冒号；
 * 3. 同名冲突匹配与合并：严格按唯一主名称 (`NAME`) 检索现有预设库，支持「新增导入 / 覆盖更新 / 仅填补空字段」合并策略。
 */

import type {
    CharacterPresetData,
    OutfitPresetData,
    CharacterExtractionConfig,
    PresetItem,
} from '@types';
import {
    CHARACTER_PART_DEFS,
    OUTFIT_PART_DEFS,
    DEFAULT_MATERIAL_EXTRACTION_CONFIG,
    normalizeCharacterData,
    normalizeOutfitData,
    mergeLayeredPartTags,
    resolveOutfitIdsFromRefs,
    splitKeywordTokens,
} from './material-definitions';
import { stripThinkingAndComments } from './prompt-injector';

/** 提取出的单条原始档案结构 */
export interface ExtractedArchiveItem {
    /** 档案类型：角色或服装 */
    readonly kind: 'character' | 'outfit';
    /** 在消息原文中完整匹配的块文本（含起止符） */
    readonly rawBlock: string;
    /** 块在消息原文中的起始偏移量 */
    readonly startIndex: number;
    /** 唯一名称（主调用名及列表展示名） */
    name: string;
    /** 以 | 分隔的别名列表 */
    aliases: string;
    /** 触发词：特定角色与作品出处英文标签（原创角色留空）；服装为专属标识（通用或自设服装留空） */
    trigger: string;
    /** 角色描述或服装描述 */
    description: string;
    /** 绑定的服装预设 ID 或名称列表（仅 kind === 'character' 有效） */
    boundOutfitIds: string[];
    /** 预置部位 Tags（角色含 12 项，服装含 9 项） */
    parts: Record<string, string>;
}

/** 导入合并策略（包含用户前端选择的跳过项） */
export type ArchiveImportStrategy = 'import_new' | 'overwrite' | 'fill_empty' | 'skip';

/** 针对持久化预设执行数据合并的有效策略（排除跳过） */
export type ArchiveMergeStrategy = Exclude<ArchiveImportStrategy, 'skip'>;

/** 默认提取配置 */
export const DEFAULT_EXTRACTION_CONFIG: CharacterExtractionConfig = DEFAULT_MATERIAL_EXTRACTION_CONFIG;

/** 预编译的大写属性键名集合容器 */
interface CompiledExtractionKeys {
    readonly nameKeys: Set<string>;
    readonly aliasesKeys: Set<string>;
    readonly triggerKeys: Set<string>;
    readonly descriptionKeys: Set<string>;
    readonly appearanceStyleKeys: Set<string>;
    readonly outfitKeys: Set<string>;
}

const CHAR_PART_ALIAS_MAP: ReadonlyMap<string, string> = (() => {
    const map = new Map<string, string>();
    for (const def of CHARACTER_PART_DEFS) {
        map.set(def.key.toUpperCase(), def.key);
        for (const alias of def.extractAliases) {
            map.set(alias.toUpperCase(), def.key);
        }
    }
    return map;
})();

const OUTFIT_PART_ALIAS_MAP: ReadonlyMap<string, string> = (() => {
    const map = new Map<string, string>();
    for (const def of OUTFIT_PART_DEFS) {
        map.set(def.key.toUpperCase(), def.key);
        for (const alias of def.extractAliases) {
            map.set(alias.toUpperCase(), def.key);
        }
    }
    return map;
})();

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKeySet(pipeSeparated: string): Set<string> {
    return new Set(
        (pipeSeparated || '')
            .split('|')
            .map((k) => k.trim().toUpperCase())
            .filter(Boolean)
    );
}

/**
 * 预编译单次提取流程中的全部属性键名集合，避免解析多行块时重复切分字符串。
 */
function compileExtractionKeys(cfg: CharacterExtractionConfig): CompiledExtractionKeys {
    return {
        nameKeys: buildKeySet(cfg.nameKeys || DEFAULT_EXTRACTION_CONFIG.nameKeys),
        aliasesKeys: buildKeySet(cfg.aliasesKeys || DEFAULT_EXTRACTION_CONFIG.aliasesKeys),
        triggerKeys: buildKeySet(cfg.triggerKeys || DEFAULT_EXTRACTION_CONFIG.triggerKeys),
        descriptionKeys: buildKeySet(cfg.descriptionKeys || DEFAULT_EXTRACTION_CONFIG.descriptionKeys),
        appearanceStyleKeys: buildKeySet(
            cfg.appearanceStyleKeys || DEFAULT_EXTRACTION_CONFIG.appearanceStyleKeys
        ),
        outfitKeys: buildKeySet(cfg.outfitKeys || DEFAULT_EXTRACTION_CONFIG.outfitKeys),
    };
}

/**
 * 判断字段值是否为表示“空/无”的占位符词条。
 */
function isEmptyArchivePlaceholder(val: string): boolean {
    const trimmed = val.trim();
    if (!trimmed) return true;
    return /^(?:无|无绑定|无专属服装|暂无|留空|none|null|n\/a|-+|—+|\/)$/i.test(trimmed);
}

/**
 * 查找处于 `()` / `（）` / `[]` / `【】` 外部的首个键值冒号索引，避免误截断备注内的冒号。
 */
function findKeyColonIndex(line: string): number {
    let paren = 0;
    let square = 0;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '(' || ch === '（') paren++;
        else if (ch === ')' || ch === '）') paren = Math.max(0, paren - 1);
        else if (ch === '[' || ch === '【') square++;
        else if (ch === ']' || ch === '】') square = Math.max(0, square - 1);
        else if ((ch === ':' || ch === '：') && paren === 0 && square === 0) {
            return i;
        }
    }
    return -1;
}

/**
 * 剥离键名右侧可选的括号备注（如 `face(容貌)`、`NAME（名称）` 或 `top[上装]`）。
 */
function stripKeyBracketNote(rawKey: string): string {
    return rawKey
        .trim()
        .replace(/[`*]/g, '')
        .replace(/^_+|_+$/g, '')
        .replace(/\s*(?:\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】)\s*$/, '')
        .trim();
}

/**
 * 清理行首 Markdown 列表符、序号与按键名加粗标记，并剥离值的外层代码块反引号。
 */
function preprocessArchiveLine(line: string): string {
    return line
        .replace(/^(?:[-*•]+|\d+[.)、])\s+/, '')
        .replace(/^\*{2}([^*\r\n]+?)\*{2}(?=\s*[:：])/, '$1')
        .replace(/^\*{2}([^*\r\n]+?[:：])\*{2}/, '$1')
        .replace(/^__(.+?)__(?=\s*[:：])/, '$1')
        .trim();
}

/**
 * 解析单个块内部的多行键值对文本。
 */
function parseBlockBody(
    kind: 'character' | 'outfit',
    bodyText: string,
    rawBlock: string,
    startIndex: number,
    compiledKeys: CompiledExtractionKeys
): ExtractedArchiveItem | null {
    const {
        nameKeys,
        aliasesKeys,
        triggerKeys,
        descriptionKeys,
        appearanceStyleKeys,
        outfitKeys,
    } = compiledKeys;

    let name = '';
    const aliasSet: string[] = [];
    let trigger = '';
    let description = '';
    const boundOutfitIds: string[] = [];
    const parts: Record<string, string> = {};

    const partAliasMap = kind === 'character' ? CHAR_PART_ALIAS_MAP : OUTFIT_PART_ALIAS_MAP;
    const primaryPartKey = kind === 'character' ? 'appearance' : 'style';

    const appendPartTags = (targetKey: string, val: string) => {
        parts[targetKey] = parts[targetKey]
            ? mergeLayeredPartTags(parts[targetKey], val)
            : val;
    };

    const pushAlias = (rawAlias: string) => {
        const cleaned = rawAlias.trim();
        if (!cleaned || isEmptyArchivePlaceholder(cleaned)) return;
        if (!aliasSet.some((a) => a.toLowerCase() === cleaned.toLowerCase())) {
            aliasSet.push(cleaned);
        }
    };

    const unwrappedBody = bodyText
        .replace(/^\s*```[a-zA-Z0-9_-]*\s*(?:[\r\n]+|$)/, '')
        .replace(/(?:^|[\r\n]+)\s*```\s*$/, '');

    const lines = unwrappedBody
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter(Boolean);

    for (const line of lines) {
        const cleanedLine = preprocessArchiveLine(line);
        const colonIdx = findKeyColonIndex(cleanedLine);
        if (colonIdx === -1) {
            continue;
        }

        const rawKey = cleanedLine.slice(0, colonIdx).trim();
        let rawVal = cleanedLine.slice(colonIdx + 1).trim();
        if (rawVal.length >= 2 && rawVal.startsWith('`') && rawVal.endsWith('`')) {
            rawVal = rawVal.slice(1, -1).trim();
        }
        if (!rawKey || !rawVal || isEmptyArchivePlaceholder(rawVal)) {
            continue;
        }

        const normalizedKey = stripKeyBracketNote(rawKey);
        const upperKey = normalizedKey.toUpperCase();

        if (nameKeys.has(upperKey)) {
            const segments = rawVal
                .split(/[|,，、]+/)
                .map((s) => s.trim())
                .filter((s) => s && !isEmptyArchivePlaceholder(s));
            if (segments.length > 0) {
                if (!name) {
                    name = segments[0];
                    for (const extra of segments.slice(1)) {
                        pushAlias(extra);
                    }
                } else {
                    for (const extra of segments) {
                        pushAlias(extra);
                    }
                }
            }
        } else if (aliasesKeys.has(upperKey)) {
            for (const item of splitKeywordTokens(rawVal)) {
                pushAlias(item);
            }
        } else if (triggerKeys.has(upperKey)) {
            trigger = rawVal;
        } else if (descriptionKeys.has(upperKey)) {
            description = rawVal;
        } else if (appearanceStyleKeys.has(upperKey)) {
            appendPartTags(primaryPartKey, rawVal);
        } else if (kind === 'character' && outfitKeys.has(upperKey)) {
            const ids = rawVal
                .split(/[|,，、]+/)
                .map((s) => s.trim())
                .filter((s) => s && !isEmptyArchivePlaceholder(s));
            for (const id of ids) {
                if (!boundOutfitIds.some((existing) => existing.toLowerCase() === id.toLowerCase())) {
                    boundOutfitIds.push(id);
                }
            }
        } else {
            const matchedPartKey = partAliasMap.get(upperKey);
            if (matchedPartKey) {
                appendPartTags(matchedPartKey, rawVal);
            }
        }
    }

    // 若仅提供了别名而未提供主名称，则提升首个别名为名称
    if (!name && aliasSet.length > 0) {
        name = aliasSet.shift()!;
    }

    if (!name) {
        return null;
    }

    const filteredAliases = aliasSet
        .filter((a) => a.toLowerCase() !== name.toLowerCase())
        .join('|');

    return {
        kind,
        rawBlock,
        startIndex,
        name,
        aliases: filteredAliases,
        trigger,
        description,
        boundOutfitIds,
        parts,
    };
}

/**
 * 从消息文本中提取所有符合规则的角色与服装档案。
 *
 * @param text 消息原文
 * @param config 提取规则配置（缺省使用默认配置）
 * @returns 按原文出现顺序排列的档案条目数组
 */
export function extractArchivesFromText(
    text: string,
    config?: Partial<CharacterExtractionConfig>
): ExtractedArchiveItem[] {
    if (!text || typeof text !== 'string') {
        return [];
    }

    // 仅剥离思考链与 HTML 注释，保留模型可能用于包裹档案块的代码围栏或反引号
    const sanitizedText = stripThinkingAndComments(text);
    if (!sanitizedText) {
        return [];
    }

    const cfg: CharacterExtractionConfig = {
        ...DEFAULT_EXTRACTION_CONFIG,
        ...(config || {}),
    };

    const compiledKeys = compileExtractionKeys(cfg);
    const results: ExtractedArchiveItem[] = [];

    const extractByKind = (
        kind: 'character' | 'outfit',
        startTag: string,
        endTag: string
    ) => {
        const s = (startTag || '').trim();
        const e = (endTag || '').trim();
        if (!s || !e || s.toLowerCase() === e.toLowerCase()) return;

        const escapedStart = escapeRegExp(s);
        const escapedEnd = escapeRegExp(e);
        const regex = new RegExp(
            `${escapedStart}((?:(?!${escapedStart})[\\s\\S])*?)${escapedEnd}`,
            'gi'
        );

        let match: RegExpExecArray | null;
        while ((match = regex.exec(sanitizedText)) !== null) {
            if (match.index === regex.lastIndex) {
                regex.lastIndex++;
            }
            const parsed = parseBlockBody(
                kind,
                match[1],
                match[0],
                match.index,
                compiledKeys
            );
            if (parsed) {
                results.push(parsed);
            }
        }
    };

    extractByKind('character', cfg.charStartTag, cfg.charEndTag);
    extractByKind('outfit', cfg.outfitStartTag, cfg.outfitEndTag);

    results.sort((a, b) => a.startIndex - b.startIndex);
    return results;
}

/**
 * 严格按唯一主名称 (`NAME`，忽略大小写与首尾空白) 检索现有预设库中命中的同名档案。
 * 别名仅用于上下文关键词检索或宽松引用，不作为档案唯一键判重依据。
 */
export function findConflictingArchivePreset<T extends CharacterPresetData | OutfitPresetData>(
    extracted: ExtractedArchiveItem,
    existingPresets: ReadonlyArray<PresetItem<T>>
): PresetItem<T> | undefined {
    const targetName = extracted.name.trim().toLowerCase();
    if (!targetName) {
        return undefined;
    }

    return existingPresets.find(
        (p) => (p.data?.name || p.name || '').trim().toLowerCase() === targetName
    );
}

function mergeAliasString(
    finalName: string,
    oldAliases: string,
    incomingName: string,
    incomingAliases: string
): string {
    const merged: string[] = [];
    const appendIfValid = (raw: string) => {
        const cleaned = raw.trim();
        if (
            !cleaned ||
            isEmptyArchivePlaceholder(cleaned) ||
            cleaned.toLowerCase() === finalName.toLowerCase()
        ) {
            return;
        }
        if (!merged.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
            merged.push(cleaned);
        }
    };

    for (const a of splitKeywordTokens(oldAliases)) appendIfValid(a);
    if (incomingName.toLowerCase() !== finalName.toLowerCase()) {
        appendIfValid(incomingName);
    }
    for (const a of splitKeywordTokens(incomingAliases)) appendIfValid(a);
    return merged.join('|');
}

function mergeTextField(existingVal: string, incomingVal: string, strategy: ArchiveMergeStrategy): string {
    const cleanIncoming = (incomingVal || '').trim();
    if (strategy === 'overwrite') {
        return cleanIncoming || existingVal;
    }
    return existingVal.trim() ? existingVal : cleanIncoming;
}

/**
 * 按选定合并策略将提取档案与已有预设合并为可持久化的 PresetItem。
 *
 * @remarks
 * 合并策略约束：
 * 1. `import_new`：无视同名冲突，派生新预设 ID 并新建入库；
 * 2. `overwrite`：以提取档案非空字段覆盖触发词、说明与对应部位字段；
 * 3. `fill_empty`：仅填补已有档案中为空的说明、触发词与部位字段，保留用户已手动填写的内容；
 * 4. 别名列表无论何种合并策略均执行并集去重。
 */
export function buildMergedArchivePreset(
    extracted: ExtractedArchiveItem,
    existingPreset: PresetItem<CharacterPresetData | OutfitPresetData> | undefined,
    strategy: ArchiveMergeStrategy,
    existingOutfits?: ReadonlyArray<PresetItem<OutfitPresetData>>
): PresetItem<CharacterPresetData | OutfitPresetData> {
    const cleanName = extracted.name.trim();
    const resolvedIncomingOutfitIds = existingOutfits
        ? resolveOutfitIdsFromRefs(extracted.boundOutfitIds, existingOutfits)
        : [...extracted.boundOutfitIds];

    if (!existingPreset || strategy === 'import_new') {
        const idPrefix = extracted.kind === 'character' ? 'char_' : 'outfit_';
        const asciiSlug = cleanName.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24);
        const safeId = `${idPrefix}${asciiSlug ? `${asciiSlug}_` : ''}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const incomingTrigger = (extracted.trigger || '').trim();

        if (extracted.kind === 'character') {
            const data = normalizeCharacterData({
                name: cleanName,
                aliases: extracted.aliases,
                trigger: incomingTrigger,
                description: extracted.description,
                avatarId: '',
                boundOutfitIds: resolvedIncomingOutfitIds,
                parts: { ...extracted.parts },
            });
            return {
                id: safeId,
                name: cleanName,
                description: data.description,
                data,
                updatedAt: Date.now(),
            };
        }

        const data = normalizeOutfitData({
            name: cleanName,
            aliases: extracted.aliases,
            description: extracted.description,
            trigger: incomingTrigger,
            avatarId: '',
            parts: { ...extracted.parts },
        });
        return {
            id: safeId,
            name: cleanName,
            description: data.description,
            data,
            updatedAt: Date.now(),
        };
    }

    if (extracted.kind === 'character') {
        const oldChar = normalizeCharacterData(
            existingPreset.data as Partial<CharacterPresetData>
        );
        const finalName = oldChar.name.trim() || cleanName;
        const mergedParts: Record<string, string> = { ...oldChar.parts };
        for (const def of CHARACTER_PART_DEFS) {
            const incomingVal = (extracted.parts[def.key] || '').trim();
            if (!incomingVal) continue;
            if (strategy === 'overwrite' || !mergedParts[def.key]?.trim()) {
                mergedParts[def.key] = incomingVal;
            }
        }

        const finalDescription = mergeTextField(oldChar.description, extracted.description, strategy);
        const finalTrigger = mergeTextField(oldChar.trigger, extracted.trigger, strategy);

        const baseOutfits = existingOutfits
            ? resolveOutfitIdsFromRefs(oldChar.boundOutfitIds, existingOutfits)
            : oldChar.boundOutfitIds;
        const mergedOutfits = Array.from(
            new Set([...baseOutfits, ...resolvedIncomingOutfitIds])
        );

        const nextCharData = normalizeCharacterData({
            ...oldChar,
            name: finalName,
            aliases: mergeAliasString(finalName, oldChar.aliases, cleanName, extracted.aliases),
            trigger: finalTrigger,
            description: finalDescription,
            boundOutfitIds: mergedOutfits,
            parts: mergedParts,
        });

        return {
            ...existingPreset,
            name: finalName,
            description: finalDescription,
            data: nextCharData,
            updatedAt: Date.now(),
        };
    }

    const oldOutfit = normalizeOutfitData(existingPreset.data as Partial<OutfitPresetData>);
    const finalName = oldOutfit.name.trim() || cleanName;
    const mergedParts: Record<string, string> = { ...oldOutfit.parts };
    for (const def of OUTFIT_PART_DEFS) {
        const incomingVal = (extracted.parts[def.key] || '').trim();
        if (!incomingVal) continue;
        if (strategy === 'overwrite' || !mergedParts[def.key]?.trim()) {
            mergedParts[def.key] = incomingVal;
        }
    }

    const finalDescription = mergeTextField(oldOutfit.description, extracted.description, strategy);
    const finalTrigger = mergeTextField(oldOutfit.trigger, extracted.trigger, strategy);

    const nextOutfitData = normalizeOutfitData({
        ...oldOutfit,
        name: finalName,
        aliases: mergeAliasString(finalName, oldOutfit.aliases, cleanName, extracted.aliases),
        description: finalDescription,
        trigger: finalTrigger,
        parts: mergedParts,
    });

    return {
        ...existingPreset,
        name: finalName,
        description: finalDescription,
        data: nextOutfitData,
        updatedAt: Date.now(),
    };
}
