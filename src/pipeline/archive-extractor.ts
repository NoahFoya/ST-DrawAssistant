/**
 * 楼层角色与服装档案提取与冲突比对模块 (ArchiveExtractor)。
 *
 * @remarks
 * 负责从聊天消息文本中检测并解析指定标记块（默认 `<角色>...</角色>` 与 `<服装>...</服装>`）：
 * 1. 基础属性提取：识别名称 (`NAME`)、别名 (`ALIASES`)、角色触发词 (`TRIGGER`)、服装专属标识、角色描述与说明 (`DESCRIPTION`)、体貌特征与服饰风格 (`APPEARANCE`/`STYLE`) 及专属服装 (`OUTFITS`)；
 * 2. 预置部位提取：按 `CHARACTER_PART_DEFS` 与 `OUTFIT_PART_DEFS` 的英文键及提取别名解析各部位标签，
 *    支持 `head(头面部): tags` 或 `head: tags` 写法，整行以首个冒号切分以保留 `(tag:1.2)` 等权重语法；
 * 3. 同名冲突检测与 Diff：按名称或别名交集检索现有库，生成逐字段差异对比并支持「覆盖更新」与「仅填补空字段」合并策略。
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
    normalizeCharacterData,
    normalizeOutfitData,
    dedupeCommaTags,
} from './material-definitions';

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
    /** 基础特征：角色对应体貌特征 appearance，服装对应服饰风格 style */
    baseTrait: string;
    /** 预置部位 Tags（按英文部位键存储非空内容） */
    parts: Record<string, string>;
}

/** 单个字段的差异对比状态 */
export type FieldDiffStatus = 'unchanged' | 'added' | 'modified';

/** 预置部位字段差异对比明细 */
export interface PartFieldDiffItem {
    readonly key: string;
    readonly label: string;
    readonly status: FieldDiffStatus;
    readonly oldValue?: string;
    readonly newValue: string;
}

/** 提取档案与库中现有档案的冲突与差异详情 */
export interface ArchiveConflictDiff {
    /** 是否命中库中已有同名档案 */
    readonly hasConflict: boolean;
    /** 命中的现有预设 ID */
    readonly existingPresetId?: string;
    /** 命中的现有预设展示名称 */
    readonly existingPresetName?: string;
    /** 触发词差异（角色触发词 / 服装专属标识） */
    readonly triggerDiff?: {
        readonly status: FieldDiffStatus;
        readonly oldValue: string;
        readonly newValue: string;
    };
    /** 描述信息差异 */
    readonly descriptionDiff?: {
        readonly status: FieldDiffStatus;
        readonly oldValue: string;
        readonly newValue: string;
    };
    /** 基础特征差异（角色对应体貌特征，服装对应服饰风格） */
    readonly baseTraitDiff: {
        readonly status: FieldDiffStatus;
        readonly oldValue: string;
        readonly newValue: string;
    };
    /** 部位字段逐项差异列表 */
    readonly partDiffs: PartFieldDiffItem[];
}

/** 导入合并策略（包含用户前端选择的跳过项） */
export type ArchiveImportStrategy = 'import_new' | 'overwrite' | 'fill_empty' | 'skip';

/** 针对持久化预设执行数据合并的有效策略（排除跳过） */
export type ArchiveMergeStrategy = Exclude<ArchiveImportStrategy, 'skip'>;

/** 默认提取配置 */
export const DEFAULT_EXTRACTION_CONFIG: CharacterExtractionConfig = {
    enabled: true,
    autoDetect: true,
    collapseInFloor: true,
    charStartTag: '<角色>',
    charEndTag: '</角色>',
    outfitStartTag: '<服装>',
    outfitEndTag: '</服装>',
    nameKeys: 'NAME|名称|角色名|服装名|CN_NAME|中文名',
    aliasesKeys: 'ALIASES|ALIAS|别名|EN_NAME|英文名',
    triggerKeys: 'TRIGGER|IDENTITY|IDENTITY_TAG|TAGS|触发词|触发标签|身份标识|身份标签|服装标识|服饰标识',
    descriptionKeys: 'DESCRIPTION|DESC|SUMMARY|角色描述|说明|简介',
    baseTraitKeys: 'APPEARANCE|STYLE|OVERALL|体貌|风格|整体|整体基调|BASE|固有',
    outfitKeys: 'OUTFITS|OUTFIT|服装|绑定服装',
};

/** 预编译的大写属性键名集合容器 */
interface CompiledExtractionKeys {
    readonly nameKeys: Set<string>;
    readonly aliasesKeys: Set<string>;
    readonly triggerKeys: Set<string>;
    readonly descriptionKeys: Set<string>;
    readonly baseTraitKeys: Set<string>;
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
    map.set('TORSO', 'upper_body');
    map.set('UPPER', 'upper_body');
    map.set('ACC', 'accessories');
    map.set('FOOT', 'feet');
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
    map.set('ACC', 'accessories');
    map.set('LEGWEAR', 'socks');
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
        baseTraitKeys: buildKeySet(cfg.baseTraitKeys || DEFAULT_EXTRACTION_CONFIG.baseTraitKeys),
        outfitKeys: buildKeySet(cfg.outfitKeys || DEFAULT_EXTRACTION_CONFIG.outfitKeys),
    };
}

/**
 * 剥离键名右侧可选的括号备注（如 `head(头面部)`、`NAME（名称）` 或 `top[上装]`）。
 */
function stripKeyBracketNote(rawKey: string): string {
    return rawKey
        .trim()
        .replace(/\s*(?:\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】)\s*$/, '')
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
        baseTraitKeys,
        outfitKeys,
    } = compiledKeys;

    let name = '';
    const aliasSet: string[] = [];
    let trigger = '';
    let description = '';
    let baseTrait = '';
    const boundOutfitIds: string[] = [];
    const parts: Record<string, string> = {};

    const partAliasMap = kind === 'character' ? CHAR_PART_ALIAS_MAP : OUTFIT_PART_ALIAS_MAP;

    const pushAlias = (rawAlias: string) => {
        const cleaned = rawAlias.trim();
        if (!cleaned) return;
        if (!aliasSet.some((a) => a.toLowerCase() === cleaned.toLowerCase())) {
            aliasSet.push(cleaned);
        }
    };

    const lines = bodyText
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter(Boolean);

    for (const line of lines) {
        const cleanedLine = line.replace(/^[-*•]\s*/, '').trim();
        const colonIdx = cleanedLine.search(/[:：]/);
        if (colonIdx === -1) {
            continue;
        }

        const rawKey = cleanedLine.slice(0, colonIdx).trim();
        const rawVal = cleanedLine.slice(colonIdx + 1).trim();
        if (!rawKey || !rawVal) {
            continue;
        }

        const normalizedKey = stripKeyBracketNote(rawKey);
        const upperKey = normalizedKey.toUpperCase();

        if (nameKeys.has(upperKey)) {
            const segments = rawVal
                .split(/[|,，/、]+/)
                .map((s) => s.trim())
                .filter(Boolean);
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
            const items = rawVal
                .split(/[|,，/、]+/)
                .map((s) => s.trim())
                .filter(Boolean);
            for (const item of items) {
                pushAlias(item);
            }
        } else if (triggerKeys.has(upperKey)) {
            trigger = rawVal;
        } else if (descriptionKeys.has(upperKey)) {
            description = rawVal;
        } else if (baseTraitKeys.has(upperKey)) {
            baseTrait = baseTrait ? dedupeCommaTags([baseTrait, rawVal]) : rawVal;
        } else if (kind === 'character' && outfitKeys.has(upperKey)) {
            const ids = rawVal
                .split(/[|,，]+/)
                .map((s) => s.trim())
                .filter(Boolean);
            for (const id of ids) {
                if (!boundOutfitIds.includes(id)) {
                    boundOutfitIds.push(id);
                }
            }
        } else {
            const matchedPartKey = partAliasMap.get(upperKey);
            if (matchedPartKey) {
                parts[matchedPartKey] = parts[matchedPartKey]
                    ? dedupeCommaTags([parts[matchedPartKey], rawVal])
                    : rawVal;
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
        baseTrait,
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

        const regex = new RegExp(
            `${escapeRegExp(s)}([\\s\\S]*?)${escapeRegExp(e)}`,
            'gi'
        );

        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
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
 * 对比提取出的档案与现有预设库，检测同名冲突并生成逐字段 Diff。
 */
export function computeArchiveDiff(
    extracted: ExtractedArchiveItem,
    existingPresets: Array<PresetItem<CharacterPresetData | OutfitPresetData>>
): ArchiveConflictDiff {
    const targetName = extracted.name.trim().toLowerCase();
    const targetCandidateSet = new Set(
        [extracted.name, ...extracted.aliases.split('|')]
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
    );

    const matchedPreset =
        existingPresets.find(
            (p) => (p.data?.name || p.name || '').trim().toLowerCase() === targetName
        ) ||
        existingPresets.find((p) => {
            const existingNames = [
                p.data?.name || p.name || '',
                ...((p.data?.aliases || '').split('|')),
            ]
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            return existingNames.some((n) => targetCandidateSet.has(n));
        });

    const partDefs = extracted.kind === 'character' ? CHARACTER_PART_DEFS : OUTFIT_PART_DEFS;

    if (!matchedPreset) {
        const partDiffs: PartFieldDiffItem[] = [];
        for (const def of partDefs) {
            const incomingVal = (extracted.parts[def.key] || '').trim();
            if (incomingVal) {
                partDiffs.push({
                    key: def.key,
                    label: def.label,
                    status: 'added',
                    newValue: incomingVal,
                });
            }
        }
        const rawTriggerVal = extracted.trigger;
        const rawBaseTraitVal = extracted.baseTrait;
        const triggerDiffItem = {
            status: 'added' as FieldDiffStatus,
            oldValue: '',
            newValue: rawTriggerVal,
        };
        const baseTraitDiffItem = {
            status: 'added' as FieldDiffStatus,
            oldValue: '',
            newValue: rawBaseTraitVal,
        };

        return {
            hasConflict: false,
            triggerDiff: triggerDiffItem,
            descriptionDiff: {
                status: 'added',
                oldValue: '',
                newValue: extracted.description,
            },
            baseTraitDiff: baseTraitDiffItem,
            partDiffs,
        };
    }

    const oldData =
        extracted.kind === 'character'
            ? normalizeCharacterData(matchedPreset.data as Partial<CharacterPresetData>)
            : normalizeOutfitData(matchedPreset.data as Partial<OutfitPresetData>);

    const oldTrigger = (oldData.trigger || '').trim();
    const newTrigger = (extracted.trigger || '').trim();
    const triggerStatus: FieldDiffStatus =
        !newTrigger || oldTrigger === newTrigger
            ? 'unchanged'
            : oldTrigger
              ? 'modified'
              : 'added';

    const oldDesc = (oldData.description || '').trim();
    const newDesc = (extracted.description || '').trim();
    const descStatus: FieldDiffStatus =
        !newDesc || oldDesc === newDesc
            ? 'unchanged'
            : oldDesc
              ? 'modified'
              : 'added';

    const oldBaseTrait = (
        extracted.kind === 'character'
            ? (oldData as CharacterPresetData).parts.appearance
            : (oldData as OutfitPresetData).parts.style
    ).trim();
    const newBaseTrait = (extracted.baseTrait || '').trim();
    const baseTraitStatus: FieldDiffStatus =
        !newBaseTrait || oldBaseTrait === newBaseTrait
            ? 'unchanged'
            : oldBaseTrait
              ? 'modified'
              : 'added';

    const oldParts = oldData.parts;
    const partDiffs: PartFieldDiffItem[] = [];

    for (const def of partDefs) {
        const incomingVal = (extracted.parts[def.key] || '').trim();
        if (!incomingVal) {
            continue;
        }
        const existingVal = (oldParts[def.key] || '').trim();
        if (!existingVal) {
            partDiffs.push({
                key: def.key,
                label: def.label,
                status: 'added',
                newValue: incomingVal,
            });
        } else {
            partDiffs.push({
                key: def.key,
                label: def.label,
                status: existingVal === incomingVal ? 'unchanged' : 'modified',
                oldValue: existingVal,
                newValue: incomingVal,
            });
        }
    }

    const triggerDiffItem = {
        status: triggerStatus,
        oldValue: oldTrigger,
        newValue: newTrigger,
    };
    const baseTraitDiffItem = {
        status: baseTraitStatus,
        oldValue: oldBaseTrait,
        newValue: newBaseTrait,
    };

    return {
        hasConflict: true,
        existingPresetId: matchedPreset.id,
        existingPresetName: matchedPreset.name,
        triggerDiff: triggerDiffItem,
        descriptionDiff: {
            status: descStatus,
            oldValue: oldDesc,
            newValue: newDesc,
        },
        baseTraitDiff: baseTraitDiffItem,
        partDiffs,
    };
}

/**
 * 按选定合并策略将提取档案与已有预设合并为可持久化的 PresetItem。
 *
 * @remarks
 * 合并策略约束：
 * 1. `import_new`：无视同名冲突，派生新预设 ID 并新建入库；
 * 2. `overwrite`：以提取档案非空字段覆盖触发词、体貌/风格、说明与对应部位字段；
 * 3. `fill_empty`：仅填补已有档案中为空的说明、触发词、体貌/风格与部位字段，保留用户已手动填写的内容；
 * 4. 别名列表无论何种合并策略均执行并集去重。
 */
export function buildMergedArchivePreset(
    extracted: ExtractedArchiveItem,
    existingPreset: PresetItem<CharacterPresetData | OutfitPresetData> | undefined,
    strategy: ArchiveMergeStrategy
): PresetItem<CharacterPresetData | OutfitPresetData> {
    const cleanName = extracted.name.trim();

    if (!existingPreset || strategy === 'import_new') {
        const idPrefix = extracted.kind === 'character' ? 'char_' : 'outfit_';
        const asciiSlug = cleanName.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24);
        const safeId = `${idPrefix}${asciiSlug ? `${asciiSlug}_` : ''}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

        const incomingTrigger = (extracted.trigger || '').trim();
        const incomingBaseTrait = (extracted.baseTrait || '').trim();

        if (extracted.kind === 'character') {
            const data = normalizeCharacterData({
                name: cleanName,
                aliases: extracted.aliases,
                trigger: incomingTrigger,
                description: extracted.description,
                avatarId: '',
                boundOutfitIds: [...extracted.boundOutfitIds],
                appearance: incomingBaseTrait,
                parts: extracted.parts,
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
            style: incomingBaseTrait,
            parts: extracted.parts,
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

        const mergedAliasesList: string[] = [];
        const addAliasIfValid = (s: string) => {
            const t = s.trim();
            if (!t || t.toLowerCase() === finalName.toLowerCase()) return;
            if (!mergedAliasesList.some((x) => x.toLowerCase() === t.toLowerCase())) {
                mergedAliasesList.push(t);
            }
        };
        for (const a of oldChar.aliases.split('|')) addAliasIfValid(a);
        if (cleanName.toLowerCase() !== finalName.toLowerCase()) addAliasIfValid(cleanName);
        for (const a of extracted.aliases.split('|')) addAliasIfValid(a);

        const mergedParts: Record<string, string> = { ...oldChar.parts };
        for (const def of CHARACTER_PART_DEFS) {
            const incomingVal = (extracted.parts[def.key] || '').trim();
            if (!incomingVal) continue;
            if (strategy === 'overwrite') {
                mergedParts[def.key] = incomingVal;
            } else if (!mergedParts[def.key]?.trim()) {
                mergedParts[def.key] = incomingVal;
            }
        }

        const incomingTrigger = (extracted.trigger || '').trim();
        const incomingBaseTrait = (extracted.baseTrait || '').trim();

        const oldCharAppearance = oldChar.parts.appearance;
        const finalAppearance =
            strategy === 'overwrite'
                ? incomingBaseTrait || oldCharAppearance
                : oldCharAppearance.trim()
                  ? oldCharAppearance
                  : incomingBaseTrait;
        mergedParts.appearance = finalAppearance;

        const finalDescription =
            strategy === 'overwrite'
                ? extracted.description.trim() || oldChar.description
                : oldChar.description.trim()
                  ? oldChar.description
                  : extracted.description.trim();

        const finalTrigger =
            strategy === 'overwrite'
                ? incomingTrigger || oldChar.trigger
                : oldChar.trigger.trim()
                  ? oldChar.trigger
                  : incomingTrigger;

        const mergedOutfits = Array.from(
            new Set([...oldChar.boundOutfitIds, ...extracted.boundOutfitIds])
        );

        const nextCharData = normalizeCharacterData({
            ...oldChar,
            name: finalName,
            aliases: mergedAliasesList.join('|'),
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

    const mergedAliasesList: string[] = [];
    const addAliasIfValid = (s: string) => {
        const t = s.trim();
        if (!t || t.toLowerCase() === finalName.toLowerCase()) return;
        if (!mergedAliasesList.some((x) => x.toLowerCase() === t.toLowerCase())) {
            mergedAliasesList.push(t);
        }
    };
    for (const a of oldOutfit.aliases.split('|')) addAliasIfValid(a);
    if (cleanName.toLowerCase() !== finalName.toLowerCase()) addAliasIfValid(cleanName);
    for (const a of extracted.aliases.split('|')) addAliasIfValid(a);

    const mergedParts: Record<string, string> = { ...oldOutfit.parts };
    for (const def of OUTFIT_PART_DEFS) {
        const incomingVal = (extracted.parts[def.key] || '').trim();
        if (!incomingVal) continue;
        if (strategy === 'overwrite') {
            mergedParts[def.key] = incomingVal;
        } else if (!mergedParts[def.key]?.trim()) {
            mergedParts[def.key] = incomingVal;
        }
    }

    const incomingOutfitTrigger = (extracted.trigger || '').trim();
    const incomingOutfitBaseTrait = (extracted.baseTrait || '').trim();

    const oldOutfitStyle = oldOutfit.parts.style;
    const finalStyle =
        strategy === 'overwrite'
            ? incomingOutfitBaseTrait || oldOutfitStyle
            : oldOutfitStyle.trim()
              ? oldOutfitStyle
              : incomingOutfitBaseTrait;
    mergedParts.style = finalStyle;

    const finalDescription =
        strategy === 'overwrite'
            ? extracted.description.trim() || oldOutfit.description
            : oldOutfit.description.trim()
              ? oldOutfit.description
              : extracted.description.trim();

    const finalTrigger =
        strategy === 'overwrite'
            ? incomingOutfitTrigger || oldOutfit.trigger
            : oldOutfit.trigger.trim()
              ? oldOutfit.trigger
              : incomingOutfitTrigger;

    const nextOutfitData = normalizeOutfitData({
        ...oldOutfit,
        name: finalName,
        aliases: mergedAliasesList.join('|'),
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
