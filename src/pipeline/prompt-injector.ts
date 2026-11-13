/**
 * 多预设多深度提示词组装与宿主注入服务 (PromptInjector)。
 *
 * @remarks
 * 负责将「故事插画」、「素材创作」、「词汇指导」、「素材注入」四类提示词预设动态计算，
 * 按 `(position, depth, role)` 聚合段落并按 `order` 升序拼接，通过宿主
 * `SillyTavern.getContext().setExtensionPrompt` 写入生成上下文：
 * 1. 素材单层列表渲染：根据当前启用预设与 `materialConfig.format` 行模板生成
 *    `{{角色启用列表}}` 与 `{{服装启用列表}}`；
 * 2. 空素材跳过与注释剥离：投递前剥离 `{{//...}}` 酒馆注释，开启 `skipWhenEmpty` 且引用的素材列表均为空时静默跳过整条条目；
 * 3. 失效注入项自动清理：追踪已注册的 `st_da_inj_*` 键集合，当预设关闭或条目深度变更时自动清空旧项。
 */

import type {
    PresetCategory,
    PromptChannelId,
    PromptInjectionEntry,
    PromptChannelPresetData,
    CharacterPresetData,
    OutfitPresetData,
    MaterialActivationPresetData,
    MaterialItemActivationRule,
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
} from './material-definitions';
import { logger } from '../util/logger';

/** 宿主扩展提示词注入键名前缀 */
export const PROMPT_EXTENSION_KEY_PREFIX = 'st_da_inj_';

const PROMPT_CHANNEL_DEFS: ReadonlyArray<{
    readonly id: PromptChannelId;
    readonly category: PresetCategory;
}> = [
    { id: 'story', category: 'prompt_story' },
    { id: 'vocab', category: 'prompt_vocab' },
    { id: 'character', category: 'prompt_character' },
    { id: 'material', category: 'prompt_material' },
];

/** 默认多层角色、服装与宏单项渲染模板 */
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
 * 提取最近 N 条聊天消息与当前角色卡名称的小写拼接文本。
 */
function extractRecentChatText(
    chatMessages: Array<{ mes?: string }> | undefined,
    scanDepth: number,
    activeCardKey?: string
): string {
    const parts: string[] = [];
    if (activeCardKey?.trim()) {
        parts.push(activeCardKey.trim());
    }
    if (Array.isArray(chatMessages) && chatMessages.length > 0 && scanDepth > 0) {
        const slice = chatMessages.slice(-Math.max(1, scanDepth));
        for (const msg of slice) {
            if (typeof msg?.mes === 'string' && msg.mes.trim()) {
                parts.push(msg.mes);
            }
        }
    }
    return parts.join('\n').toLowerCase();
}

/**
 * 判断素材条目（角色或服装）的主名称或任一别名是否出现在上下文文本中。
 */
function isArchiveNameMatchedInText(
    name: string,
    aliases: string,
    lowerContextText: string
): boolean {
    if (!lowerContextText) {
        return false;
    }

    const candidates = [
        (name || '').trim(),
        ...(aliases || '')
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean),
    ].filter(Boolean);

    for (const token of candidates) {
        if (lowerContextText.includes(token.toLowerCase())) {
            return true;
        }
    }
    return false;
}

/**
 * 将角色绑定的服装标识列表（可为服装预设 id 或服装名称）解析为服装预设数据数组。
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

    for (const rawRef of boundOutfitIds) {
        const ref = (rawRef || '').trim();
        if (!ref) continue;
        const lowerRef = ref.toLowerCase();
        const hit = allOutfitPresets.find((o) => {
            if (o.id.toLowerCase() === lowerRef) return true;
            if ((o.data?.name || o.name || '').trim().toLowerCase() === lowerRef) return true;
            const aliasList = (o.data?.aliases || '')
                .split('|')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            return aliasList.includes(lowerRef);
        });
        if (hit && !seenIds.has(hit.id)) {
            seenIds.add(hit.id);
            resolved.push(hit.data);
        }
    }
    return resolved;
}

/**
 * 将角色绑定的服装标识列表（可为服装预设 id 或服装名称）解析为展示名称数组。
 */
export function resolveBoundOutfitNames(
    boundOutfitIds: readonly string[],
    allOutfitPresets: ReadonlyArray<{ id: string; name: string; data: OutfitPresetData }>
): string[] {
    return resolveBoundOutfitPresets(boundOutfitIds, allOutfitPresets)
        .map((o) => (o.name || '').trim())
        .filter(Boolean);
}

/**
 * 渲染单条角色或服装行模板，支持全字段与景别变量展开。
 *
 * @remarks
 * 服装启用列表展示通用服装；角色绑定的服装为角色专属服装，
 * 在角色模板中通过 {{outfits}} 展开时使用相同的服装行模板渲染。
 */
function renderArchiveRowTemplate(
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

        // 格式化专属服装子树：严格遵循 4 格相对缩进，确保与角色属性对齐且不产生同行错位
        if (boundOutfits.length === 0) {
            // 无专属服装时，将专属服装引导词收拢为单行呈现（如 "- 专属服装: 无"）
            const emptyLabelRegex = /(\r?\n)([ \t]*)(?:-\s*)?(?:专属服装列表|专属服装|绑定服装):\s*(?:\r?\n[ \t]*)?\{\{\s*outfits\s*\}\}/g;
            if (emptyLabelRegex.test(result)) {
                result = result.replace(emptyLabelRegex, '$1$2- 专属服装: 无');
            } else {
                result = result
                    .replace(/(?:专属服装列表|专属服装|绑定服装):\s*\{\{\s*outfits\s*\}\}/g, '- 专属服装: 无')
                    .replace(/\{\{\s*outfits\s*\}\}/g, '无');
            }
        } else {
            // 每套专属服装整体逐行追加 4 格缩进，形成标准的 Markdown/YAML 子列表树
            const renderedOutfits = boundOutfits
                .map((bo) => {
                    const single = renderArchiveRowTemplate(rowTpl, bo, allOutfitPresets);
                    return single
                        .split('\n')
                        .map((line) => (line.trim() ? `    ${line}` : ''))
                        .join('\n');
                })
                .join('\n');

            const labeledRegex = /(\r?\n)([ \t]*)(?:-\s*)?(?:专属服装列表|专属服装|绑定服装):\s*(?:\r?\n[ \t]*)?\{\{\s*outfits\s*\}\}/g;
            if (labeledRegex.test(result)) {
                result = result.replace(
                    labeledRegex,
                    (_match, newline, indent) => `${newline}${indent}- 专属服装:\n${renderedOutfits}`
                );
            } else {
                const multilineRegex = /(\r?\n)([ \t]*)\{\{\s*outfits\s*\}\}/g;
                if (multilineRegex.test(result)) {
                    result = result.replace(
                        multilineRegex,
                        (_match, _newline, _indent) => `\n${renderedOutfits}`
                    );
                } else {
                    result = result.replace(/\{\{\s*outfits\s*\}\}/g, `\n${renderedOutfits}`);
                }
            }
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
 * 在激活规则字典中按预设 `id` 优先查找，未命中时按素材 `name` 不区分大小写匹配。
 */
function lookupActivationRule(
    rulesMap: Record<string, MaterialItemActivationRule> | undefined,
    presetId: string,
    materialName: string
): MaterialItemActivationRule | undefined {
    if (!rulesMap) {
        return undefined;
    }
    if (rulesMap[presetId]) {
        return rulesMap[presetId];
    }
    const lowerName = (materialName || '').trim().toLowerCase();
    if (!lowerName) {
        return undefined;
    }
    for (const [k, rule] of Object.entries(rulesMap)) {
        if (k.trim().toLowerCase() === lowerName) {
            return rule;
        }
    }
    return undefined;
}

/**
 * 解析当前生效的素材启用预设（支持跟随酒馆角色卡自动匹配切换）。
 */
export function resolveActiveMaterialActivationPreset(
    settings: DrawAssistantSettings,
    activeCardKey?: string
): PresetItem<MaterialActivationPresetData> | undefined {
    const actList = settings.presets.material_activations || [];
    if (actList.length === 0) {
        return undefined;
    }

    const matCfg = settings.materialConfig;
    const trimmedCard = (activeCardKey || '').trim().toLowerCase();

    if (matCfg?.autoSwitchByCard && trimmedCard) {
        const cardMatched = actList.find((preset) => {
            const names = preset.data?.boundCardNames;
            return (
                Array.isArray(names) &&
                names.some((n) => (n || '').trim().toLowerCase() === trimmedCard)
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
    const activeCardKey =
        options.activeCardKey ??
        (typeof hostContext?.name2 === 'string' ? hostContext.name2 : '');

    const activeActivationPreset = resolveActiveMaterialActivationPreset(
        settings,
        activeCardKey
    );
    const actData = activeActivationPreset?.data;

    const allCharPresets = (settings.presets.characters || [])
        .map((p) => ({
            id: p.id,
            name: p.name,
            data: normalizeCharacterData(p.data),
        }))
        .filter((p) => Boolean(p.data.name.trim()));

    const allOutfitPresets = (settings.presets.outfits || [])
        .map((p) => ({
            id: p.id,
            name: p.name,
            data: normalizeOutfitData(p.data),
        }))
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
        typeof actData.scanDepth === 'number' && actData.scanDepth > 0
            ? actData.scanDepth
            : 5;
    const includeBoundOutfits = actData.includeBoundOutfits !== false;
    const recentText = extractRecentChatText(chatMessages, scanDepth, activeCardKey);

    const triggeredCharacters: CharacterPresetData[] = [];
    const matchedCharacterNames: string[] = [];
    const matchedOutfitNames: string[] = [];

    for (const charPreset of allCharPresets) {
        const charData = charPreset.data;
        const rule = lookupActivationRule(
            actData.characterRules,
            charPreset.id,
            charData.name
        );
        if (!rule?.enabled) {
            continue;
        }

        if (rule.bindCharacterCard && rule.boundCharacterCardName) {
            const cardKey = (activeCardKey || '').trim().toLowerCase();
            const target = rule.boundCharacterCardName.trim().toLowerCase();
            if (cardKey && target && !cardKey.includes(target) && !target.includes(cardKey)) {
                continue;
            }
        }

        const isTriggered =
            rule.triggerMode === 'always' ||
            isArchiveNameMatchedInText(charData.name, charData.aliases, recentText);

        if (isTriggered) {
            triggeredCharacters.push(charData);
            matchedCharacterNames.push(charData.name);
        }
    }

    // 角色专属服装列表和通用服装列表不共享服装池：收集所有已被角色绑定的专属服装 ID 与名称
    const boundOutfitIdSet = new Set<string>();
    for (const charPreset of allCharPresets) {
        if (Array.isArray(charPreset.data.boundOutfitIds)) {
            for (const rawId of charPreset.data.boundOutfitIds) {
                const id = (rawId || '').trim();
                if (id) {
                    boundOutfitIdSet.add(id);
                    // 允许按服装名称或 ID 比对已绑定的专属服装
                    const matchedByName = allOutfitPresets.find(
                        (o) => o.name.trim().toLowerCase() === id.toLowerCase()
                    );
                    if (matchedByName) {
                        boundOutfitIdSet.add(matchedByName.id);
                    }
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

        const rule = lookupActivationRule(
            actData.outfitRules,
            outfitPreset.id,
            outfitData.name
        );

        if (!rule?.enabled) {
            continue;
        }

        if (rule.bindCharacterCard && rule.boundCharacterCardName) {
            const cardKey = (activeCardKey || '').trim().toLowerCase();
            const target = rule.boundCharacterCardName.trim().toLowerCase();
            if (cardKey && target && !cardKey.includes(target) && !target.includes(cardKey)) {
                continue;
            }
        }

        const isTriggered =
            rule.triggerMode === 'always' ||
            isArchiveNameMatchedInText(outfitData.name, outfitData.aliases, recentText);

        if (isTriggered) {
            triggeredOutfits.push(outfitData);
            matchedOutfitNames.push(outfitData.name);
        }
    }

    const effectiveOutfitTemplate =
        format.outfitTemplate || DEFAULT_FORMAT_TEMPLATES.outfitTemplate;
    const effectiveCharTemplate =
        format.characterTemplate || DEFAULT_FORMAT_TEMPLATES.characterTemplate;

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
        matchedCharacterNames,
        matchedOutfitNames,
    };
}

/**
 * 判断包含素材列表变量的条目是否因所引用的素材列表全部为空而应当静默跳过。
 */
function shouldSkipEntryForEmptyMaterials(
    strippedContent: string,
    materialLists: MaterialRenderedListsResult,
    skipWhenEmpty?: boolean
): boolean {
    if (!skipWhenEmpty) {
        return false;
    }
    const refsCharacters = /\{\{\s*角色(?:启用|可用宏)列表\s*\}\}/.test(strippedContent);
    const refsOutfits = /\{\{\s*(?:通用)?服装(?:启用|可用宏)列表\s*\}\}/.test(strippedContent);

    if (!refsCharacters && !refsOutfits) {
        return false;
    }

    const hasAnyNonEmptyList =
        (refsCharacters && materialLists.charactersCount > 0) ||
        (refsOutfits && materialLists.outfitsCount > 0);

    return !hasAnyNonEmptyList;
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
    const valueToInsert = replacementText.trim() ? replacementText : emptyFallback;
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
 */
function applyMaterialVariablesToEntryContent(
    strippedContent: string,
    materialLists: MaterialRenderedListsResult
): string {
    if (!strippedContent.includes('{{')) {
        return strippedContent;
    }
    let result = replaceMaterialPlaceholderWithIndent(
        strippedContent,
        '角色启用列表',
        materialLists.charactersText,
        '(当前无激活角色)'
    );
    result = replaceMaterialPlaceholderWithIndent(
        result,
        '服装启用列表',
        materialLists.outfitsText,
        '(当前无激活服装)'
    );
    result = replaceMaterialPlaceholderWithIndent(
        result,
        '角色可用宏列表',
        materialLists.characterMacrosText,
        '(当前无可用角色宏)'
    );
    result = replaceMaterialPlaceholderWithIndent(
        result,
        '服装可用宏列表',
        materialLists.outfitMacrosText,
        '(当前无可用服装宏)'
    );
    result = result.replace(/\{\{\s*通用角色启用列表\s*\}\}/g, '');
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
    const activeCardKey =
        options.activeCardKey ??
        (typeof hostContext?.name2 === 'string' ? hostContext.name2 : '');
    const ignoreChannelEnabled = Boolean(options.ignoreChannelEnabled);

    const materialLists = computeMaterialRenderedLists({
        settings,
        chatMessages,
        activeCardKey,
    });

    if (!ignoreChannelEnabled && !settings.enabled) {
        return {
            buckets: [],
            matchedEntries: [],
            materialLists,
        };
    }

    const allowedChannels = options.channels ? new Set(options.channels) : null;
    const recentTextCache = new Map<number, string>();
    const getRecentText = (depth: number): string => {
        const normalizedDepth = depth > 0 ? Math.floor(depth) : 5;
        let cached = recentTextCache.get(normalizedDepth);
        if (cached === undefined) {
            cached = extractRecentChatText(chatMessages, normalizedDepth, activeCardKey);
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

            let isTriggered = entry.triggerMode === 'always';
            if (!isTriggered) {
                const caseSensitive = Boolean(entry.caseSensitive);
                const rawText = getRecentText(entry.scanDepth || 5);
                const recentText = caseSensitive ? rawText : rawText.toLowerCase();

                const parseKwList = (str?: string) =>
                    (str || '')
                        .split(/[|,，]+/)
                        .map((k) => (caseSensitive ? k.trim() : k.trim().toLowerCase()))
                        .filter(Boolean);

                const primaryKws = parseKwList(entry.keywords);
                if (primaryKws.length === 0) {
                    continue;
                }

                const logic = entry.logicType || 'and_any';
                let primaryMatched = false;
                if (logic === 'and_all') {
                    primaryMatched = primaryKws.every((kw) => recentText.includes(kw));
                } else if (logic === 'not_any') {
                    primaryMatched = !primaryKws.some((kw) => recentText.includes(kw));
                } else {
                    primaryMatched = primaryKws.some((kw) => recentText.includes(kw));
                }

                if (!primaryMatched) {
                    continue;
                }

                const secondaryKws = parseKwList(entry.secondaryKeywords);
                if (secondaryKws.length > 0) {
                    const secondaryMatched = secondaryKws.some((kw) => recentText.includes(kw));
                    if (!secondaryMatched) {
                        continue;
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

            if (
                shouldSkipEntryForEmptyMaterials(
                    stripped,
                    materialLists,
                    entry.skipWhenEmpty
                )
            ) {
                continue;
            }

            const rendered = applyMaterialVariablesToEntryContent(
                stripped,
                materialLists
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
    private readonly _registeredKeys = new Set<string>();
    private _pendingMicrotaskPromise: Promise<PromptComputedResult> | null = null;

    public constructor(storeInstance?: SettingsStore) {
        this._store = storeInstance ?? settingsStore;
    }

    /**
     * 微任务合批调度提示词同步注入。
     *
     * @remarks
     * 在同一个事件循环/宏任务周期内多次调用时自动合批为微任务末尾的单次全量计算与注入，
     * 消除短时间内的密集重复正则与素材匹配计算。
     *
     * @returns 最终合批执行的计算结果 Promise
     */
    public scheduleSyncToHost(): Promise<PromptComputedResult> {
        if (!this._pendingMicrotaskPromise) {
            this._pendingMicrotaskPromise = Promise.resolve().then(() => {
                this._pendingMicrotaskPromise = null;
                return this.syncToHost();
            });
        }
        return this._pendingMicrotaskPromise;
    }

    /**
     * 计算当前激活的所有提示词段落并同步写入 SillyTavern 宿主 `setExtensionPrompt`。
     */
    public syncToHost(): PromptComputedResult {
        const settings = this._store.getSettings();
        const hostContext =
            typeof window !== 'undefined' ? window.SillyTavern?.getContext?.() : undefined;
        const setPromptFn = hostContext?.setExtensionPrompt;

        const computed = computePromptInjections({ settings });

        if (typeof setPromptFn !== 'function') {
            return computed;
        }

        const staleCandidates = new Set<string>(this._registeredKeys);
        const hostPrompts = hostContext?.extensionPrompts;
        if (isPlainObject(hostPrompts)) {
            for (const existingKey of Object.keys(hostPrompts)) {
                if (existingKey.startsWith(PROMPT_EXTENSION_KEY_PREFIX)) {
                    staleCandidates.add(existingKey);
                }
            }
        }

        const nextActiveKeys = new Set<string>();

        if (settings.enabled) {
            for (const bucket of computed.buckets) {
                nextActiveKeys.add(bucket.key);
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
        }

        for (const staleKey of staleCandidates) {
            try {
                setPromptFn(staleKey, '', 1, 0, false, 0);
            } catch (err) {
                logger.warn(
                    `[PromptInjector] 清理宿主失效提示词注入项 (${staleKey}) 异常:`,
                    err
                );
            }
        }

        this._registeredKeys.clear();
        for (const k of nextActiveKeys) {
            this._registeredKeys.add(k);
        }

        return computed;
    }

    /**
     * 主动清空本扩展在宿主中注册的全部提示词注入项（供插件停用卸载时调用）。
     */
    public clearAllFromHost(): void {
        this._pendingMicrotaskPromise = null;
        const hostContext =
            typeof window !== 'undefined' ? window.SillyTavern?.getContext?.() : undefined;
        const setPromptFn = hostContext?.setExtensionPrompt;
        if (typeof setPromptFn !== 'function') {
            this._registeredKeys.clear();
            return;
        }

        const keysToClear = new Set<string>(this._registeredKeys);
        const hostPrompts = hostContext?.extensionPrompts;
        if (isPlainObject(hostPrompts)) {
            for (const existingKey of Object.keys(hostPrompts)) {
                if (existingKey.startsWith(PROMPT_EXTENSION_KEY_PREFIX)) {
                    keysToClear.add(existingKey);
                }
            }
        }

        for (const key of keysToClear) {
            try {
                setPromptFn(key, '', 1, 0, false, 0);
            } catch {
                // 忽略卸载阶段异常
            }
        }
        this._registeredKeys.clear();
    }
}

/** 全局提示词注入管理器单例 */
export const promptInjector = new PromptInjector();
