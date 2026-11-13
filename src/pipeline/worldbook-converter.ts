/**
 * 酒馆原生世界书 JSON 与插件提示词预设双向转换模块 (WorldbookConverter)。
 *
 * @remarks
 * 处理 SillyTavern 原生 World Info JSON 格式与插件 `PromptChannelPresetData` 的格式识别及字段映射：
 * 1. 位置枚举转换：
 *    - 酒馆原生世界书中 `position: 4` 代表聊天指定深度 `@D`（对应宿主 `setExtensionPrompt` 的 `IN_CHAT = 1`）；
 *    - `position: 0 / 2 / 5` 映射为 `BEFORE_PROMPT = 2`；其余 `1 / 3 / 6 / 7` 映射为 `IN_PROMPT = 0`；
 *    - 导出至酒馆原生世界书时反向映射 `1 -> 4`、`2 -> 0`、`0 -> 1`；
 * 2. 原文完整性：导入解析时按原书 `displayIndex` 与 `uid` 排序并保留全部分隔线条目与 `{{//...}}` 注释块，不做隐式删减。
 */

import type {
    ActivationTriggerMode,
    PromptInjectionEntry,
    PromptChannelPresetData,
} from '@types';

/** 导入 JSON 文件结构识别结果 */
export type PromptImportFormat = 'plugin-preset' | 'st-worldbook' | 'invalid';

/** 附带原始 uid 的单条原生世界书解析项 */
export interface ParsedStWorldbookItem {
    /** 原始世界书条目 uid */
    readonly uid: number;
    /** 转换后的插件提示词注入条目 */
    readonly entry: PromptInjectionEntry;
}

/** 酒馆原生世界书整体解析结果 */
export interface ParsedStWorldbookResult {
    /** 原世界书名称 */
    readonly name: string;
    /** 转换后的提示词条目列表（按原书 displayIndex / uid 排列，完整保留分隔线） */
    readonly entries: PromptInjectionEntry[];
    /** 附带原始 uid 的解析明细 */
    readonly items: ParsedStWorldbookItem[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * 检测文本是否包含素材启用列表变量。
 */
export function hasMaterialListPlaceholder(content: string): boolean {
    if (!content) {
        return false;
    }
    return /\{\{\s*(?:角色启用列表|通用角色启用列表|(?:通用)?服装启用列表)\s*\}\}/.test(content);
}

/**
 * 将酒馆原生世界书条目的 `position` 映射为 `setExtensionPrompt` 的 `position` 参数。
 *
 * @remarks
 * 酒馆 World Info 定义：0 = Before Char, 1 = After Char, 2 = AN Top, 3 = AN Bottom, 4 = @D (In-Chat), 5 = EM Top, 6 = EM Bottom, 7 = Outlet。
 * `setExtensionPrompt` 定义：0 = IN_PROMPT, 1 = IN_CHAT (@D), 2 = BEFORE_PROMPT。
 */
export function mapStPositionToExtensionPosition(stPosition: unknown): 0 | 1 | 2 {
    const pos = typeof stPosition === 'number' && Number.isFinite(stPosition) ? stPosition : 4;
    if (pos === 4) {
        return 1;
    }
    if (pos === 0 || pos === 2 || pos === 5) {
        return 2;
    }
    return 0;
}

/**
 * 将插件条目的 `position` 反向映射为酒馆原生世界书 `position` 字段值。
 */
export function mapExtensionPositionToStPosition(extPosition: 0 | 1 | 2): number {
    if (extPosition === 1) {
        return 4;
    }
    if (extPosition === 2) {
        return 0;
    }
    return 1;
}

/**
 * 识别外部导入的 JSON 对象属于插件提示词预设还是酒馆原生世界书。
 */
export function detectPromptImportFormat(raw: unknown): PromptImportFormat {
    if (!isPlainObject(raw)) {
        return 'invalid';
    }

    // 1. 标准插件预设包装结构：{ id?, name?, data: { entries: [...] } }
    if (isPlainObject(raw.data) && Array.isArray(raw.data.entries)) {
        return 'plugin-preset';
    }

    // 2. 酒馆原生世界书标准字典结构：{ name?, entries: { "0": { uid, ... } } }
    if (isPlainObject(raw.entries)) {
        return 'st-worldbook';
    }

    // 3. 数组形式 entries：根据内部元素特征区分酒馆条目与插件条目
    if (Array.isArray(raw.entries)) {
        const firstObj = raw.entries.find((item) => isPlainObject(item)) as
            | Record<string, unknown>
            | undefined;
        if (!firstObj) {
            return 'originalData' in raw ? 'st-worldbook' : 'plugin-preset';
        }
        if (firstObj.triggerMode === 'always' || firstObj.triggerMode === 'keyword') {
            return 'plugin-preset';
        }
        if (
            'uid' in firstObj ||
            'constant' in firstObj ||
            'disable' in firstObj ||
            Array.isArray(firstObj.key)
        ) {
            return 'st-worldbook';
        }
        return 'plugin-preset';
    }

    return 'invalid';
}

/**
 * 规范化单条插件提示词注入条目字段，补齐缺省属性。
 */
export function normalizePromptInjectionEntry(
    raw: Record<string, unknown>,
    fallbackIndex = 0
): PromptInjectionEntry {
    const id =
        typeof raw.id === 'string' && raw.id.trim()
            ? raw.id.trim()
            : `entry_${Date.now().toString(36)}_${fallbackIndex}`;
    const name =
        typeof raw.name === 'string' && raw.name.trim()
            ? raw.name.trim()
            : `提示词条目 #${fallbackIndex + 1}`;
    const enabled = raw.enabled !== undefined ? Boolean(raw.enabled) : true;
    const triggerMode: ActivationTriggerMode =
        raw.triggerMode === 'keyword' ? 'keyword' : 'always';
    const keywords = typeof raw.keywords === 'string' ? raw.keywords.trim() : '';
    const scanDepth =
        typeof raw.scanDepth === 'number' && Number.isFinite(raw.scanDepth) && raw.scanDepth > 0
            ? Math.floor(raw.scanDepth)
            : 5;
    const position: 0 | 1 | 2 =
        raw.position === 0 || raw.position === 1 || raw.position === 2 ? raw.position : 1;
    const depth =
        typeof raw.depth === 'number' && Number.isFinite(raw.depth)
            ? Math.max(0, Math.floor(raw.depth))
            : 0;
    const role: 0 | 1 | 2 = raw.role === 1 || raw.role === 2 ? raw.role : 0;
    const order =
        typeof raw.order === 'number' && Number.isFinite(raw.order) ? Math.floor(raw.order) : 100;
    const content = typeof raw.content === 'string' ? raw.content : '';
    const skipWhenEmpty =
        typeof raw.skipWhenEmpty === 'boolean'
            ? raw.skipWhenEmpty
            : hasMaterialListPlaceholder(content)
              ? true
              : undefined;

    return {
        id,
        name,
        enabled,
        triggerMode,
        keywords,
        scanDepth,
        position,
        depth,
        role,
        order,
        ...(skipWhenEmpty !== undefined ? { skipWhenEmpty } : {}),
        content,
    };
}

/**
 * 解析并规范化插件自身的提示词预设 JSON（支持包装态 PresetItem 或直接的 `{ entries }`）。
 */
export function normalizePluginPromptChannelPreset(
    raw: Record<string, unknown>,
    fallbackName = '导入提示词预设'
): { name: string; data: PromptChannelPresetData } | null {
    const rawEntries =
        isPlainObject(raw.data) && Array.isArray(raw.data.entries)
            ? raw.data.entries
            : Array.isArray(raw.entries)
              ? raw.entries
              : null;

    if (!rawEntries) {
        return null;
    }

    const name =
        typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName;
    const entries = rawEntries
        .filter((item): item is Record<string, unknown> => isPlainObject(item))
        .map((item, idx) => normalizePromptInjectionEntry(item, idx));

    return {
        name,
        data: { entries },
    };
}

/**
 * 将酒馆原生世界书 JSON 解析为插件 `PromptInjectionEntry` 列表。
 *
 * @param raw 酒馆原生世界书 JSON 对象
 * @param idPrefix 生成条目 ID 的前缀
 */
export function parseStWorldbookEntries(
    raw: Record<string, unknown>,
    idPrefix = 'wb_uid_'
): ParsedStWorldbookResult {
    const bookName =
        typeof raw.name === 'string' && raw.name.trim()
            ? raw.name.trim()
            : '导入的世界书预设';

    const collected: Array<{
        keyOrder: number;
        uid: number;
        displayIndex: number;
        rawEntry: Record<string, unknown>;
    }> = [];

    if (isPlainObject(raw.entries)) {
        let seq = 0;
        for (const [k, val] of Object.entries(raw.entries)) {
            if (!isPlainObject(val)) continue;
            const parsedKeyNum = Number(k);
            const uid =
                typeof val.uid === 'number' && Number.isFinite(val.uid)
                    ? Math.floor(val.uid)
                    : Number.isFinite(parsedKeyNum)
                      ? Math.floor(parsedKeyNum)
                      : seq;
            const displayIndex =
                typeof val.displayIndex === 'number' && Number.isFinite(val.displayIndex)
                    ? val.displayIndex
                    : Number.MAX_SAFE_INTEGER;
            collected.push({
                keyOrder: seq++,
                uid,
                displayIndex,
                rawEntry: val,
            });
        }
    } else if (Array.isArray(raw.entries)) {
        raw.entries.forEach((val, idx) => {
            if (!isPlainObject(val)) return;
            const uid =
                typeof val.uid === 'number' && Number.isFinite(val.uid)
                    ? Math.floor(val.uid)
                    : idx;
            const displayIndex =
                typeof val.displayIndex === 'number' && Number.isFinite(val.displayIndex)
                    ? val.displayIndex
                    : Number.MAX_SAFE_INTEGER;
            collected.push({
                keyOrder: idx,
                uid,
                displayIndex,
                rawEntry: val,
            });
        });
    }

    // 按原世界书界面展示顺序 displayIndex -> uid -> 原始键序排列，保留全部分隔线与注释项
    collected.sort((a, b) => {
        if (a.displayIndex !== b.displayIndex) {
            return a.displayIndex - b.displayIndex;
        }
        if (a.uid !== b.uid) {
            return a.uid - b.uid;
        }
        return a.keyOrder - b.keyOrder;
    });

    const items: ParsedStWorldbookItem[] = collected.map(({ uid, rawEntry }, idx) => {
        const commentStr = typeof rawEntry.comment === 'string' ? rawEntry.comment.trim() : '';
        const nameStr = typeof rawEntry.name === 'string' ? rawEntry.name.trim() : '';
        // 优先保留更具辨识度的标题（若 name 与 comment 同时存在且 name 更完整则优先，否则取非空项）
        const resolvedName = nameStr || commentStr || `条目 #${uid}`;

        const enabled = !Boolean(rawEntry.disable);
        const triggerMode: ActivationTriggerMode = Boolean(rawEntry.constant)
            ? 'always'
            : 'keyword';

        let keywords = '';
        if (Array.isArray(rawEntry.key)) {
            keywords = rawEntry.key
                .map((k) => String(k ?? '').trim())
                .filter(Boolean)
                .join('|');
        } else if (typeof rawEntry.key === 'string') {
            keywords = rawEntry.key
                .split(/[|,，]+/)
                .map((k) => k.trim())
                .filter(Boolean)
                .join('|');
        }

        const scanDepth =
            typeof rawEntry.scanDepth === 'number' &&
            Number.isFinite(rawEntry.scanDepth) &&
            rawEntry.scanDepth > 0
                ? Math.floor(rawEntry.scanDepth)
                : 5;

        const position = mapStPositionToExtensionPosition(rawEntry.position);
        const depth =
            typeof rawEntry.depth === 'number' && Number.isFinite(rawEntry.depth)
                ? Math.max(0, Math.floor(rawEntry.depth))
                : 4;
        const role: 0 | 1 | 2 =
            rawEntry.role === 1 || rawEntry.role === 2 ? rawEntry.role : 0;
        const order =
            typeof rawEntry.order === 'number' && Number.isFinite(rawEntry.order)
                ? Math.floor(rawEntry.order)
                : 100;
        const content = typeof rawEntry.content === 'string' ? rawEntry.content : '';
        const hasMatPlaceholder = hasMaterialListPlaceholder(content);

        const entry: PromptInjectionEntry = {
            id: `${idPrefix}${uid}_${idx}`,
            name: resolvedName,
            enabled,
            triggerMode,
            keywords,
            scanDepth,
            position,
            depth,
            role,
            order,
            ...(hasMatPlaceholder ? { skipWhenEmpty: true } : {}),
            content,
        };

        return { uid, entry };
    });

    return {
        name: bookName,
        entries: items.map((item) => item.entry),
        items,
    };
}

/**
 * 将插件提示词条目列表导出为符合 SillyTavern World Info 规范的原生世界书 JSON 对象。
 */
export function exportToStWorldbookJson(
    presetName: string,
    entries: PromptInjectionEntry[]
): Record<string, unknown> {
    const resolvedBookName = (presetName || '').trim() || 'ST-DrawAssistant 提示词预设';
    const entriesMap: Record<string, Record<string, unknown>> = {};

    (entries || []).forEach((entry, idx) => {
        const keys = (entry.keywords || '')
            .split(/[|,，]+/)
            .map((k) => k.trim())
            .filter(Boolean);
        const title = (entry.name || '').trim() || `条目 #${idx}`;
        const stPosition = mapExtensionPositionToStPosition(entry.position ?? 1);
        const depth =
            typeof entry.depth === 'number' && Number.isFinite(entry.depth)
                ? Math.max(0, Math.floor(entry.depth))
                : 0;
        const order =
            typeof entry.order === 'number' && Number.isFinite(entry.order)
                ? Math.floor(entry.order)
                : 100;
        const role: 0 | 1 | 2 = entry.role === 1 || entry.role === 2 ? entry.role : 0;
        const scanDepth =
            entry.triggerMode === 'keyword' &&
            typeof entry.scanDepth === 'number' &&
            entry.scanDepth > 0
                ? Math.floor(entry.scanDepth)
                : null;

        entriesMap[String(idx)] = {
            uid: idx,
            name: title,
            comment: title,
            constant: entry.triggerMode === 'always',
            selective: true,
            selectiveLogic: 0,
            addMemo: true,
            disable: !entry.enabled,
            order,
            position: stPosition,
            depth,
            role,
            key: keys,
            keysecondary: [],
            matchWholeWords: false,
            excludeRecursion: true,
            preventRecursion: true,
            delayUntilRecursion: false,
            content: entry.content || '',
            displayIndex: idx,
            vectorized: false,
            ignoreBudget: false,
            matchPersonaDescription: false,
            matchCharacterDescription: false,
            matchCharacterPersonality: false,
            matchCharacterDepthPrompt: false,
            matchScenario: false,
            matchCreatorNotes: false,
            probability: 100,
            useProbability: true,
            outletName: '',
            group: '',
            groupOverride: false,
            groupWeight: 100,
            scanDepth,
            caseSensitive: null,
            useGroupScoring: null,
            automationId: '',
            sticky: 0,
            cooldown: 0,
            delay: 0,
            triggers: [],
            characterFilter: {
                isExclude: false,
                names: [],
                tags: [],
            },
        };
    });

    return {
        name: resolvedBookName,
        entries: entriesMap,
    };
}
