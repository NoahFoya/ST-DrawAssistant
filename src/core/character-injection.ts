/**
 * @module core/character-injection
 * @description 角色与服装提示词注入与生图 Prompt 编译核心引擎
 *
 * 核心逻辑区块架构：
 * - BLOCK 1: 【路径 A - 世界书只读注入路径】 (响应 WORLDINFO_ENTRIES_LOADED 钩子只读替换 globalLore 占位符)
 * - BLOCK 2: 【路径 B-1 - 动态设定提取与居中 Toast 提示】 (扫描 <人物>/<服装> 结构化标签，去重弹窗存档/覆盖更新/启用)
 * - BLOCK 3: 【路径 B-2 - 动态提示词 $...$ 宏解包与二次清洗】 (在生图多段拼接前优先解包动态 Tag，二次正则清洗)
 */

import {
    getCharacterProfiles,
    getOutfitProfiles,
    getEnableSchemes,
    getInjectionTemplates,
    getMacroTreeScheme,
    upsertCharacterProfile,
    upsertOutfitProfile,
    upsertEnableScheme
} from '../storage/character-store';
import type {
    CharacterProfile,
    OutfitProfile,
    EnableSchemeProfile,
    InjectionTemplateScheme,
    MacroRuleNode
} from '../types/character';
import { getContext } from './context';
import { logger } from './logger';

// ============================================================================
// BLOCK 1: 【路径 A - 世界书只读注入路径 (Worldbook Injection Path)】
// 职责：响应 WORLDINFO_ENTRIES_LOADED 钩子，按绑定方案与注入模板解包世界书占位符
// ============================================================================

/**
 * 根据当前角色卡名称与 chatId 获取活动的设定启用方案 (匹配第一个符合条件的方案，无匹配或未选中角色卡时返回 null)
 */
export function resolveActiveEnableScheme(characterCardName?: string, chatId?: string): EnableSchemeProfile | null {
    const schemes = getEnableSchemes();
    if (schemes.length === 0) {
        return null;
    }

    let targetCard = characterCardName;
    let targetChatId = chatId;

    if (!targetCard) {
        try {
            const ctx = getContext();
            const win = window as unknown as { SillyTavern?: { getContext?: () => { name2?: string; chatId?: string; characterId?: number } } };
            const stCtx = win.SillyTavern?.getContext?.();
            const charId = stCtx?.characterId ?? (ctx as unknown as { characterId?: number })?.characterId;

            // 未选择任何角色卡（characterId 未定义或无效）时直接返回 null
            if (typeof charId === 'undefined' || charId < 0) {
                return null;
            }

            targetCard = stCtx?.name2 || (ctx as unknown as { name2?: string })?.name2 || '';
            targetChatId = targetChatId || stCtx?.chatId || (ctx as unknown as { chatId?: string })?.chatId || '';
        } catch {
            return null;
        }
    }

    if (!targetCard || !targetCard.trim()) {
        return null;
    }

    const normTargetCard = targetCard.trim().toLowerCase();
    const normTargetChatId = (targetChatId || '').trim();

    const matched = schemes.find(s => {
        if (!s.boundCharacterCards) return false;
        const lines = s.boundCharacterCards
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean);

        for (const line of lines) {
            if (line.includes('|')) {
                const [card, cid] = line.split('|').map(p => p.trim());
                if (card.toLowerCase() === normTargetCard && cid === normTargetChatId) {
                    return true;
                }
            } else if (line.toLowerCase() === normTargetCard) {
                return true;
            }
        }
        return false;
    });

    return matched || null;
}

/**
 * 筛选符合规则且启用的角色实体 (仅当 rule.enabled === true 时为启用)
 */
export function filterEnabledCharacters(
    scheme: EnableSchemeProfile | null,
    textContent: string
): CharacterProfile[] {
    if (!scheme) return [];
    const allChars = getCharacterProfiles();
    const rules = scheme.characterRules || {};
    const normText = (textContent || '').toLowerCase();

    return allChars.filter(char => {
        const config = rules[char.id];
        // 默认新建方案时所有卡全禁用，仅存储了 enabled: true 的为启用
        if (!config || config.enabled !== true) return false;

        const rule = config.rule || 'ALL';
        if (rule === 'ALL') return true;

        // match 规则：检索姓名或以 "|" 分隔的别名
        if (char.nameCN) {
            const aliasesCN = char.nameCN.split('|').map(a => a.trim().toLowerCase()).filter(Boolean);
            if (aliasesCN.some(alias => normText.includes(alias))) return true;
        }
        if (char.nameEN) {
            const aliasesEN = char.nameEN.split('|').map(a => a.trim().toLowerCase()).filter(Boolean);
            if (aliasesEN.some(alias => normText.includes(alias))) return true;
        }

        return false;
    });
}

/**
 * 筛选符合规则且启用的通用服装实体 (仅当 rule.enabled === true 时为启用)
 */
export function filterEnabledOutfits(
    scheme: EnableSchemeProfile | null,
    textContent: string
): OutfitProfile[] {
    if (!scheme) return [];
    const allOutfits = getOutfitProfiles();
    const rules = scheme.outfitRules || {};
    const normText = (textContent || '').toLowerCase();

    return allOutfits.filter(outfit => {
        const config = rules[outfit.id];
        if (!config || config.enabled !== true) return false;

        const rule = config.rule || 'match';
        if (rule === 'ALL') return true;

        // match 规则：检索服装中文名或英文名
        if (outfit.nameCN) {
            const aliasesCN = outfit.nameCN.split('|').map(a => a.trim().toLowerCase()).filter(Boolean);
            if (aliasesCN.some(alias => normText.includes(alias))) return true;
        }
        if (outfit.nameEN) {
            const aliasesEN = outfit.nameEN.split('|').map(a => a.trim().toLowerCase()).filter(Boolean);
            if (aliasesEN.some(alias => normText.includes(alias))) return true;
        }

        return false;
    });
}

/**
 * 展开角色专属服装列表 {outfits}
 */
export function resolveInnerOutfits(
    char: CharacterProfile,
    tplScheme: InjectionTemplateScheme
): string {
    const activeOutfits = char.outfitList || [];
    const innerTpl = tplScheme.innerOutfitTemplate || '';

    const allOutfits = getOutfitProfiles();
    const renderedList = activeOutfits.map(outfitName => {
        const outfit = allOutfits.find(o => 
            (o.nameCN && o.nameCN.toLowerCase() === outfitName.toLowerCase()) ||
            (o.nameEN && o.nameEN.toLowerCase() === outfitName.toLowerCase())
        );
        if (!outfit) return '';

        return innerTpl
            .replace(/{nameCN}/g, outfit.nameCN || '')
            .replace(/{nameEN}/g, outfit.nameEN || '')
            .replace(/{upperBody}/g, outfit.upperBody || '')
            .replace(/{upperBodyBack}/g, outfit.upperBodyBack || '')
            .replace(/{fullBody}/g, outfit.fullBody || '')
            .replace(/{lowerBody}/g, outfit.fullBody || '')
            .replace(/{fullBodyBack}/g, outfit.fullBodyBack || '')
            .replace(/{lowerBodyBack}/g, outfit.fullBodyBack || '');
    });

    return renderedList.map(t => cleanRenderedText(t)).filter(Boolean).join('\n');
}

/**
 * 清洗模板渲染后的多余空行与全空占位符行
 */
export function cleanRenderedText(text: string): string {
    if (!text) return '';
    const lines = text.split('\n');
    const cleaned = lines.filter(line => {
        if (/{[a-zA-Z0-9_]+}/.test(line)) return false;
        return line.trim() !== '';
    });
    return cleaned.join('\n');
}

/**
 * 渲染角色与服装的结构化注入文本
 */
export function renderCharacterAndOutfitInjection(textContent: string): {
    characterListText: string;
    outfitListText: string;
} {
    const scheme = resolveActiveEnableScheme();
    if (!scheme) {
        return { characterListText: '', outfitListText: '' };
    }

    const tplScheme = getInjectionTemplates()[0];
    if (!tplScheme) {
        return { characterListText: '', outfitListText: '' };
    }

    const activeChars = filterEnabledCharacters(scheme, textContent);
    const activeOutfits = filterEnabledOutfits(scheme, textContent);

    // 1. 渲染角色启用列表
    const charRenderedList: string[] = [];
    const charTpl = tplScheme.characterListTemplate || '';

    activeChars.forEach(char => {
        const innerOutfitsText = resolveInnerOutfits(char, tplScheme);
        const itemText = charTpl
            .replace(/{nameCN}/g, char.nameCN || '')
            .replace(/{nameEN}/g, char.nameEN || '')
            .replace(/{traits}/g, char.characterTraits || '')
            .replace(/{facial}/g, char.facialFeatures || '')
            .replace(/{facialBack}/g, char.facialFeaturesBack || '')
            .replace(/{upperSFW}/g, char.upperBodySFW || '')
            .replace(/{upperSFWBack}/g, char.upperBodySFWBack || '')
            .replace(/{lowerSFW}/g, char.fullBodySFW || '')
            .replace(/{lowerSFWBack}/g, char.fullBodySFWBack || '')
            .replace(/{upperNSFW}/g, char.upperBodyNSFW || '')
            .replace(/{upperNSFWBack}/g, char.upperBodyNSFWBack || '')
            .replace(/{lowerNSFW}/g, char.fullBodyNSFW || '')
            .replace(/{lowerNSFWBack}/g, char.fullBodyNSFWBack || '')
            .replace(/{negative}/g, char.negativePrompt || '')
            .replace(/{outfits}/g, innerOutfitsText);

        charRenderedList.push(cleanRenderedText(itemText));
    });

    // 2. 渲染服装启用列表
    const outfitRenderedList: string[] = [];
    const outfitTpl = tplScheme.enableOutfitListTemplate || '';

    activeOutfits.forEach(outfit => {
        const itemText = outfitTpl
            .replace(/{nameCN}/g, outfit.nameCN || '')
            .replace(/{nameEN}/g, outfit.nameEN || '')
            .replace(/{upperBody}/g, outfit.upperBody || '')
            .replace(/{upperBodyBack}/g, outfit.upperBodyBack || '')
            .replace(/{fullBody}/g, outfit.fullBody || '')
            .replace(/{lowerBody}/g, outfit.fullBody || '')
            .replace(/{fullBodyBack}/g, outfit.fullBodyBack || '')
            .replace(/{lowerBodyBack}/g, outfit.fullBodyBack || '');

        outfitRenderedList.push(cleanRenderedText(itemText));
    });

    const characterListText = charRenderedList.filter(Boolean).join('\n\n');
    const outfitListText = outfitRenderedList.filter(Boolean).join('\n\n');

    logger.debug('[CharacterInjection] 动态解析结果:', {
        scheme: scheme ? scheme.name : '无绑定方案',
        matchedChars: activeChars.map(c => c.nameCN),
        matchedOutfits: activeOutfits.map(o => o.nameCN)
    });

    return { characterListText, outfitListText };
}

/**
 * 在 Prompt / 文本中容错替换角色与服装占位符
 */
export function injectCharacterPlaceholders(promptText: string, textContent?: string): string {
    if (!promptText) return '';

    const matchText = textContent || promptText;
    const { characterListText, outfitListText } = renderCharacterAndOutfitInjection(matchText);

    let result = promptText;

    const charRegex = /{{(角色启用列表|角色列表|通用角色启用列表)}}/gi;
    result = result.replace(charRegex, characterListText);

    const outfitRegex = /{{(服装启用列表|服装列表|通用服装启用列表)}}/gi;
    result = result.replace(outfitRegex, outfitListText);

    return result;
}

/**
 * 动态刷新全局世界书 (window.world_info) 中的 {{角色启用列表}} 与 {{服装启用列表}} 占位符
 * 使酒馆原生的 Prompt 预发送视窗 (Inspect Prompt / 提示词预览) 能够直接展示解包渲染后的最新 Tag 实体
 */
export function updateGlobalWorldbookPlaceholders(textContent?: string): void {
    try {
        const win = window as unknown as {
            world_info?: { entries?: Record<string, { content?: string; _rawContent?: string }> };
            world_info_data?: { entries?: Record<string, { content?: string; _rawContent?: string }> };
        };
        const wiEntries = win.world_info?.entries || win.world_info_data?.entries;
        if (!wiEntries) return;

        const { characterListText, outfitListText } = renderCharacterAndOutfitInjection(textContent || '');

        const charRegex = /{{(角色启用列表|角色列表|通用角色启用列表)}}/gi;
        const outfitRegex = /{{(服装启用列表|服装列表|通用服装启用列表)}}/gi;

        Object.values(wiEntries).forEach(entry => {
            if (!entry) return;
            if (typeof entry._rawContent === 'undefined') {
                entry._rawContent = entry.content || '';
            }

            const raw = entry._rawContent;
            if (charRegex.test(raw) || outfitRegex.test(raw)) {
                let updated = raw.replace(charRegex, characterListText);
                updated = updated.replace(outfitRegex, outfitListText);
                entry.content = cleanRenderedText(updated);
            }
        });

        logger.debug('[CharacterInjection] 动态刷新全局世界书预发送文本缓冲区成功');
    } catch (err) {
        logger.warn('[CharacterInjection] 动态刷新全局世界书失败:', err);
    }
}

/**
 * 响应 SillyTavern 官方 WORLDINFO_ENTRIES_LOADED 事件，只读解包替换 globalLore
 */
export function processWorldInfoLoadedData(
    data?: { globalLore?: Array<{ content?: string; _rawContent?: string }> },
    textContent?: string
): void {
    if (!data || !Array.isArray(data.globalLore)) return;

    try {
        const { characterListText, outfitListText } = renderCharacterAndOutfitInjection(textContent || '');

        const charRegex = /{{(角色启用列表|角色列表|通用角色启用列表)}}/gi;
        const outfitRegex = /{{(服装启用列表|服装列表|通用服装启用列表)}}/gi;

        for (const entry of data.globalLore) {
            if (!entry || typeof entry.content !== 'string') continue;
            if (typeof entry._rawContent === 'undefined') {
                entry._rawContent = entry.content;
            }

            const raw = entry._rawContent;
            if (charRegex.test(raw) || outfitRegex.test(raw)) {
                let updated = raw.replace(charRegex, characterListText);
                updated = updated.replace(outfitRegex, outfitListText);
                entry.content = cleanRenderedText(updated);
            }
        }

        logger.debug('[CharacterInjection] 已通过 WORLDINFO_ENTRIES_LOADED 动态处理 globalLore 条目');
    } catch (err) {
        logger.warn('[CharacterInjection] 处理 WORLDINFO_ENTRIES_LOADED 失败:', err);
    }
}

// ============================================================================
// BLOCK 2: 【路径 B-1 - 动态设定提取与居中 Toast 提示 (Tag Extraction & Toast)】
// 职责：扫描 AI 消息中 <人物> 与 <服装> 标签，去重弹窗存档/覆盖更新/启用
// ============================================================================

/**
 * 从预处理后的文本块中解析人物参数字典 (对齐 st-chatu8 标准字段映射)
 */
export function parseCharacterData(content: string): CharacterProfile | null {
    if (!content) return null;

    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const data: Partial<CharacterProfile> = {
        nameCN: '',
        nameEN: '',
        characterTraits: '',
        facialFeatures: '',
        facialFeaturesBack: '',
        upperBodySFW: '',
        upperBodySFWBack: '',
        fullBodySFW: '',
        fullBodySFWBack: '',
        upperBodyNSFW: '',
        upperBodyNSFWBack: '',
        fullBodyNSFW: '',
        fullBodyNSFWBack: '',
        negativePrompt: '',
        outfitList: []
    };

    const fieldMap: Record<string, keyof CharacterProfile> = {
        '中文名称': 'nameCN',
        '英文名称': 'nameEN',
        '角色特征': 'characterTraits',
        '五官外貌': 'facialFeatures',
        '五官外貌背面': 'facialFeaturesBack',
        '上半身SFW': 'upperBodySFW',
        '上半身SFW背面': 'upperBodySFWBack',
        '下半身SFW': 'fullBodySFW',
        '下半身SFW背面': 'fullBodySFWBack',
        '上半身NSFW': 'upperBodyNSFW',
        '上半身NSFW背面': 'upperBodyNSFWBack',
        '下半身NSFW': 'fullBodyNSFW',
        '下半身NSFW背面': 'fullBodyNSFWBack',
        '负面': 'negativePrompt'
    };

    for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();

        if (fieldMap[key]) {
            const prop = fieldMap[key];
            (data as Record<string, unknown>)[prop] = value;
        }
    }

    if (!data.nameCN) return null;

    return {
        id: `char-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        nameCN: data.nameCN || '',
        nameEN: data.nameEN || '',
        characterTraits: data.characterTraits || '',
        facialFeatures: data.facialFeatures || '',
        facialFeaturesBack: data.facialFeaturesBack || '',
        upperBodySFW: data.upperBodySFW || '',
        upperBodySFWBack: data.upperBodySFWBack || '',
        fullBodySFW: data.fullBodySFW || '',
        fullBodySFWBack: data.fullBodySFWBack || '',
        upperBodyNSFW: data.upperBodyNSFW || '',
        upperBodyNSFWBack: data.upperBodyNSFWBack || '',
        fullBodyNSFW: data.fullBodyNSFW || '',
        fullBodyNSFWBack: data.fullBodyNSFWBack || '',
        negativePrompt: data.negativePrompt || '',
        outfitList: []
    };
}

/**
 * 从预处理后的文本块中解析服装参数字典 (对齐 st-chatu8 标准字段映射)
 */
export function parseOutfitData(content: string): OutfitProfile | null {
    if (!content) return null;

    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const data: Partial<OutfitProfile> = {
        nameCN: '',
        nameEN: '',
        upperBody: '',
        upperBodyBack: '',
        fullBody: '',
        fullBodyBack: ''
    };

    const fieldMap: Record<string, keyof OutfitProfile> = {
        '中文名称': 'nameCN',
        '英文名称': 'nameEN',
        '上半身': 'upperBody',
        '上半身背面': 'upperBodyBack',
        '下半身': 'fullBody',
        '下半身背面': 'fullBodyBack'
    };

    for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();

        if (fieldMap[key]) {
            const prop = fieldMap[key];
            (data as Record<string, unknown>)[prop] = value;
        }
    }

    if (!data.nameCN) return null;

    return {
        id: `outfit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        nameCN: data.nameCN || '',
        nameEN: data.nameEN || '',
        upperBody: data.upperBody || '',
        upperBodyBack: data.upperBodyBack || '',
        fullBody: data.fullBody || '',
        fullBodyBack: data.fullBodyBack || ''
    };
}

/**
 * 从 AI 消息文本或测试文本中自动提取 <人物> 与 <服装> 实体结构
 */
export function extractCharacterAndOutfitTags(messageText: string): {
    characters: Array<CharacterProfile & { matchedOutfits: OutfitProfile[] }>;
    outfits: OutfitProfile[];
} {
    if (!messageText) return { characters: [], outfits: [] };

    // 清除 <thinking> 思考块
    const textWithoutThinking = messageText.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    const tagRegex = /<(人物|服装)>([\s\S]*?)<\/\1>/g;

    const items: Array<{
        type: 'character' | 'outfit';
        data: CharacterProfile | OutfitProfile;
        position: number;
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(textWithoutThinking)) !== null) {
        const type = match[1];
        const content = match[2];
        const position = match.index;

        if (type === '人物') {
            const parsed = parseCharacterData(content);
            if (parsed) items.push({ type: 'character', data: parsed, position });
        } else if (type === '服装') {
            const parsed = parseOutfitData(content);
            if (parsed) items.push({ type: 'outfit', data: parsed, position });
        }
    }

    items.sort((a, b) => a.position - b.position);

    let currentCharItem: { data: CharacterProfile; matchedOutfits: OutfitProfile[] } | null = null;
    const characters: Array<CharacterProfile & { matchedOutfits: OutfitProfile[] }> = [];
    const orphanOutfits: OutfitProfile[] = [];

    for (const item of items) {
        if (item.type === 'character') {
            const charData = item.data as CharacterProfile;
            currentCharItem = { data: charData, matchedOutfits: [] };
            characters.push({ ...charData, matchedOutfits: currentCharItem.matchedOutfits });
        } else if (item.type === 'outfit') {
            const outfitData = item.data as OutfitProfile;
            if (currentCharItem) {
                currentCharItem.matchedOutfits.push(outfitData);
            } else {
                orphanOutfits.push(outfitData);
            }
        }
    }

    return { characters, outfits: orphanOutfits };
}

/**
 * 非阻塞式角色与服装设定提取确认浮层 UI (顶部居中 18% 定位，主题自适应 CSS Tokens，绝不阻塞 JS 主线程)
 */
export function showExtractionToast(
    title: string,
    badgeText: string,
    isOverwrite: boolean,
    detailsHtml: string,
    confirmText: string,
    onConfirm: () => void
): void {
    try {
        let container = document.getElementById('da-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'da-toast-container';
            container.style.position = 'fixed';
            container.style.top = '18%';
            container.style.left = '50%';
            container.style.transform = 'translateX(-50%)';
            container.style.zIndex = '999999';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '12px';
            container.style.alignItems = 'center';
            container.style.pointerEvents = 'none';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'da-section-card';
        toast.style.pointerEvents = 'auto';
        toast.style.background = 'var(--da-bg-secondary, rgba(18, 18, 28, 0.96))';
        toast.style.backdropFilter = 'blur(14px)';
        (toast.style as unknown as Record<string, string>).webkitBackdropFilter = 'blur(14px)';
        toast.style.border = `1px solid ${isOverwrite ? 'var(--da-warning-color, rgba(245, 158, 11, 0.6))' : 'var(--da-border-color, rgba(168, 85, 247, 0.6))'}`;
        toast.style.borderRadius = '12px';
        toast.style.padding = '16px 20px';
        toast.style.boxShadow = 'var(--da-shadow-lg, 0 12px 36px rgba(0, 0, 0, 0.5))';
        toast.style.color = 'var(--da-text-primary, #ffffff)';
        toast.style.minWidth = '320px';
        toast.style.maxWidth = '440px';
        toast.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.alignItems = 'center';
        headerRow.style.justifyContent = 'space-between';
        headerRow.style.marginBottom = '10px';

        const titleDiv = document.createElement('div');
        titleDiv.style.fontWeight = 'bold';
        titleDiv.style.fontSize = '0.98em';
        titleDiv.style.color = isOverwrite ? 'var(--da-warning-color, #f59e0b)' : 'var(--da-primary-color, #a855f7)';
        titleDiv.innerHTML = title;

        const badgeSpan = document.createElement('span');
        badgeSpan.style.fontSize = '0.75em';
        badgeSpan.style.padding = '2px 9px';
        badgeSpan.style.borderRadius = '12px';
        badgeSpan.style.background = isOverwrite ? 'rgba(245, 158, 11, 0.2)' : 'var(--da-primary-transparent, rgba(168, 85, 247, 0.2))';
        badgeSpan.style.color = isOverwrite ? '#fbbf24' : 'var(--da-primary-color, #c084fc)';
        badgeSpan.style.border = `1px solid ${isOverwrite ? 'rgba(245, 158, 11, 0.4)' : 'var(--da-border-color, rgba(168, 85, 247, 0.4))'}`;
        badgeSpan.textContent = badgeText;

        headerRow.appendChild(titleDiv);
        headerRow.appendChild(badgeSpan);

        const bodyDiv = document.createElement('div');
        bodyDiv.style.fontSize = '0.86em';
        bodyDiv.style.opacity = '0.95';
        bodyDiv.style.marginBottom = '14px';
        bodyDiv.style.lineHeight = '1.5';
        bodyDiv.style.color = 'var(--da-text-secondary, rgba(255, 255, 255, 0.85))';
        bodyDiv.innerHTML = detailsHtml;

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.justifyContent = 'flex-end';
        btnRow.style.gap = '10px';

        const btnCancel = document.createElement('button');
        btnCancel.className = 'da-btn secondary';
        btnCancel.style.padding = '4px 14px';
        btnCancel.style.fontSize = '0.8em';
        btnCancel.textContent = '忽略';

        const btnConfirm = document.createElement('button');
        btnConfirm.className = isOverwrite ? 'da-btn secondary' : 'da-btn primary';
        btnConfirm.style.padding = '4px 14px';
        btnConfirm.style.fontSize = '0.8em';
        if (isOverwrite) {
            btnConfirm.style.background = 'rgba(245, 158, 11, 0.2)';
            btnConfirm.style.color = '#fbbf24';
            btnConfirm.style.border = '1px solid #f59e0b';
        }
        btnConfirm.textContent = confirmText;

        btnRow.appendChild(btnCancel);
        btnRow.appendChild(btnConfirm);

        toast.appendChild(headerRow);
        toast.appendChild(bodyDiv);
        toast.appendChild(btnRow);

        const removeToast = () => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(() => toast.remove(), 300);
        };

        btnCancel.addEventListener('click', removeToast);
        btnConfirm.addEventListener('click', () => {
            onConfirm();
            removeToast();
        });

        // 15 秒无人操作自动淡出离开，绝不阻塞 UI 主线程
        setTimeout(() => {
            if (document.body.contains(toast)) removeToast();
        }, 15000);

        container.appendChild(toast);
    } catch {
        // 静默保护
    }
}

/** 已去重处理过的消息文本哈希集合 */
const processedMessageHashes = new Set<string>();

/**
 * 监听 AI 回复/编辑消息自动提取角色与服装标签，智能提示存档、同名覆盖更新与方案启用 (哈希去重 + 居中自适应 UI)
 */
export function processExtractedCharacterTags(messageText: string): void {
    if (!messageText) return;

    // 哈希去重校验，防止同条消息触发多个事件时重复弹框
    const hash = `${messageText.length}_${messageText.substring(0, 100)}`;
    if (processedMessageHashes.has(hash)) return;
    processedMessageHashes.add(hash);

    const { characters, outfits } = extractCharacterAndOutfitTags(messageText);
    if (characters.length === 0 && outfits.length === 0) return;

    const existingChars = getCharacterProfiles();
    const existingOutfits = getOutfitProfiles();
    const activeScheme = resolveActiveEnableScheme();

    // 1. 处理所有提取出的角色 (含挂载的专属服装明细)
    characters.forEach(extractedChar => {
        const matchedExisting = existingChars.find(
            c => (c.nameCN && c.nameCN.trim() === extractedChar.nameCN.trim()) ||
                 (c.nameEN && extractedChar.nameEN && c.nameEN.trim().toLowerCase() === extractedChar.nameEN.trim().toLowerCase())
        );

        const isOverwrite = !!matchedExisting;
        const title = isOverwrite ? '<i class="fa-solid fa-pen-to-square"></i> 发现同名角色设定' : '<i class="fa-solid fa-user-plus"></i> 发现新角色设定';
        const badgeText = isOverwrite ? '覆盖更新' : '新建预设';

        let detailsHtml = `<div><strong>👤 角色名称：</strong>${extractedChar.nameCN}${extractedChar.nameEN ? ` (${extractedChar.nameEN})` : ''}</div>`;
        if (extractedChar.characterTraits) {
            detailsHtml += `<div style="font-size:0.9em; opacity:0.85; margin-top:2px;">特征: ${extractedChar.characterTraits.substring(0, 60)}${extractedChar.characterTraits.length > 60 ? '...' : ''}</div>`;
        }

        if (extractedChar.matchedOutfits && extractedChar.matchedOutfits.length > 0) {
            const outfitNames = extractedChar.matchedOutfits.map(o => o.nameCN || o.nameEN).filter(Boolean).join(', ');
            detailsHtml += `<div style="margin-top:4px; color:var(--da-primary-color, #c084fc);"><strong>👕 包含专属服装 (${extractedChar.matchedOutfits.length})：</strong>${outfitNames}</div>`;
        }

        const confirmBtnLabel = isOverwrite ? '覆盖更新设定' : '保存并启用设定';

        showExtractionToast(title, badgeText, isOverwrite, detailsHtml, confirmBtnLabel, () => {
            // 保存专属服装
            const savedOutfitNames: string[] = [];
            extractedChar.matchedOutfits.forEach(outfit => {
                const matchedOutfit = existingOutfits.find(o => o.nameCN === outfit.nameCN);
                if (matchedOutfit) {
                    upsertOutfitProfile({ ...matchedOutfit, ...outfit, id: matchedOutfit.id });
                    savedOutfitNames.push(matchedOutfit.nameCN);
                } else {
                    upsertOutfitProfile(outfit);
                    savedOutfitNames.push(outfit.nameCN);
                }
            });

            // 保存/更新角色
            const charToSave: CharacterProfile = matchedExisting
                ? { ...matchedExisting, ...extractedChar, id: matchedExisting.id, outfitList: Array.from(new Set([...(matchedExisting.outfitList || []), ...savedOutfitNames])) }
                : { ...extractedChar, outfitList: savedOutfitNames };

            upsertCharacterProfile(charToSave);

            // 启用至当前活动方案
            if (activeScheme) {
                activeScheme.characterRules = activeScheme.characterRules || {};
                activeScheme.characterRules[charToSave.id] = { enabled: true, rule: 'ALL' };
                upsertEnableScheme(activeScheme);
            }

            updateGlobalWorldbookPlaceholders();
            logger.info(`[CharacterInjection] 成功存档并启用角色设定 "${charToSave.nameCN}"`);
        });
    });

    // 2. 处理独立提取出的通用服装 (Orphan Outfits)
    outfits.forEach(extractedOutfit => {
        const matchedOutfit = existingOutfits.find(o => o.nameCN === extractedOutfit.nameCN);
        const isOverwrite = !!matchedOutfit;
        const title = isOverwrite ? '<i class="fa-solid fa-pen-to-square"></i> 发现同名通用服装' : '<i class="fa-solid fa-shirt"></i> 发现新通用服装';
        const badgeText = isOverwrite ? '覆盖更新' : '新建服装';

        let detailsHtml = `<div><strong>👕 服装名称：</strong>${extractedOutfit.nameCN}${extractedOutfit.nameEN ? ` (${extractedOutfit.nameEN})` : ''}</div>`;
        if (extractedOutfit.upperBody || extractedOutfit.fullBody) {
            const desc = [extractedOutfit.upperBody, extractedOutfit.fullBody].filter(Boolean).join(' | ');
            detailsHtml += `<div style="font-size:0.9em; opacity:0.85; margin-top:2px;">内容: ${desc.substring(0, 60)}${desc.length > 60 ? '...' : ''}</div>`;
        }

        const confirmBtnLabel = isOverwrite ? '覆盖更新服装' : '保存并启用服装';

        showExtractionToast(title, badgeText, isOverwrite, detailsHtml, confirmBtnLabel, () => {
            const outfitToSave: OutfitProfile = matchedOutfit
                ? { ...matchedOutfit, ...extractedOutfit, id: matchedOutfit.id }
                : extractedOutfit;

            upsertOutfitProfile(outfitToSave);

            if (activeScheme) {
                activeScheme.outfitRules = activeScheme.outfitRules || {};
                activeScheme.outfitRules[outfitToSave.id] = { enabled: true, rule: 'match' };
                upsertEnableScheme(activeScheme);
            }

            updateGlobalWorldbookPlaceholders();
            logger.info(`[CharacterInjection] 成功存档并启用通用服装 "${outfitToSave.nameCN}"`);
        });
    });
}

// ============================================================================
// BLOCK 3: 【路径 B-2 - 动态提示词 $...$ 宏解包与二次清洗 (Prompt Compiler & Cleaning)】
// 职责：在生图多段拼接前优先解包 $...$ 动态标记，二次正则清洗空白宏与多余逗号
// ============================================================================

/**
 * 变量解析器：根据变量名从实体对象中提取对应的 Tag 内容 (含 Back 属性自动 Fallback 回退)
 */
function resolveVarValue(
    varName: string,
    entity: CharacterProfile | OutfitProfile,
    customTag?: string
): string {
    if (!varName) return '';
    if (varName === 'customTag') return customTag || '';

    if (varName in entity) {
        const directVal = (entity as unknown as Record<string, unknown>)[varName];
        if (typeof directVal === 'string' && directVal.trim()) {
            return directVal.trim();
        }
    }

    // 常用属性 Fallback 映射
    const char = entity as Partial<CharacterProfile>;
    const outfit = entity as Partial<OutfitProfile>;

    switch (varName) {
        case 'facialFeaturesBack':
            return char.facialFeaturesBack || char.facialFeatures || '';
        case 'upperBodySFWBack':
            return char.upperBodySFWBack || char.upperBodySFW || outfit.upperBodyBack || outfit.upperBody || '';
        case 'fullBodySFWBack':
            return char.fullBodySFWBack || char.fullBodySFW || outfit.fullBodyBack || outfit.fullBody || '';
        case 'upperBodyNSFWBack':
            return char.upperBodyNSFWBack || char.upperBodyNSFW || '';
        case 'fullBodyNSFWBack':
            return char.fullBodyNSFWBack || char.fullBodyNSFW || '';
        case 'upperBodyBack':
            return outfit.upperBodyBack || outfit.upperBody || '';
        case 'fullBodyBack':
            return outfit.fullBodyBack || outfit.fullBody || '';
        default:
            return '';
    }
}

/**
 * 2 层树形求值例程：支持 2 层嵌套与互斥约束，收集命中叶子节点绑定的 variables 列表
 */
function evaluate2LevelNodes(
    nodes: MacroRuleNode[],
    lowerContent: string,
    entity: CharacterProfile | OutfitProfile,
    tagList: string[]
): void {
    if (!Array.isArray(nodes) || nodes.length === 0) return;

    for (const node of nodes) {
        if (!node.enabled || !node.pattern) continue;

        // 校验匹配关键词 (如 "-from_behind", "-sfw-upperbody")
        if (lowerContent.includes(node.pattern.toLowerCase())) {
            // 约束 3：互斥约束! 若节点包含 children，则递归求值子分支；若无 children，则展开 variables 列表
            if (Array.isArray(node.children) && node.children.length > 0) {
                evaluate2LevelNodes(node.children, lowerContent, entity, tagList);
            } else if (Array.isArray(node.variables) && node.variables.length > 0) {
                for (const vName of node.variables) {
                    const val = resolveVarValue(vName, entity, node.customTag);
                    if (val && !tagList.includes(val)) {
                        tagList.push(val);
                    }
                }
            }
        }
    }
}

/**
 * 动态提示词预处理与 2 层树形宏解包引擎
 * 严格执行步骤时序性：
 * Step 1: 精准匹配实体 Name；未匹配则返回 0 字符空字符串 "" (绝不出引双引号)
 * Step 2: 先处理【固定注入内容】 (fixedVariables, 如 nameEN, characterTraits)
 * Step 3: 再处理【条件分支内容】 (2 层树形多分支 variables 求值)
 */
export function processCharacterPrompt(promptText: string): string {
    if (!promptText || typeof promptText !== 'string') return promptText;

    const tagRegex = /\$([^$]+)\$/g;
    if (!tagRegex.test(promptText)) return promptText;

    tagRegex.lastIndex = 0;

    const existingChars = getCharacterProfiles();
    const existingOutfits = getOutfitProfiles();
    const treeScheme = getMacroTreeScheme();

    const processed = promptText.replace(tagRegex, (_fullMatch, innerStr: string) => {
        const rawContent = innerStr.trim();
        if (!rawContent) return '';

        const lowerContent = rawContent.toLowerCase();

        // 收集规则树中的所有关键词用于名字切割剥离
        const collectPatterns = (nodes?: MacroRuleNode[]): string[] => {
            if (!Array.isArray(nodes)) return [];
            let res: string[] = [];
            for (const n of nodes) {
                if (n.pattern) res.push(n.pattern);
                if (n.children) res = res.concat(collectPatterns(n.children));
            }
            return res;
        };

        const charNodes = treeScheme.characterRootNodes || treeScheme.rootNodes || [];
        const outfitNodes = treeScheme.outfitRootNodes || treeScheme.rootNodes || [];

        const suffixes = Array.from(new Set([
            ...collectPatterns(charNodes),
            ...collectPatterns(outfitNodes)
        ]));

        let normName = rawContent;
        for (const s of suffixes) {
            const idx = normName.toLowerCase().lastIndexOf(s.toLowerCase());
            if (idx !== -1 && idx === normName.length - s.length) {
                normName = normName.substring(0, idx).trim();
            }
        }

        const matchKey = normName.toLowerCase();
        const matchKeyNoTag = matchKey.replace(/_\([^\)]+\)/g, '').trim();

        // 1. 优先匹配角色实体
        const matchedChar = existingChars.find(c => {
            const cCN = (c.nameCN || '').trim().toLowerCase();
            const cEN = (c.nameEN || '').trim().toLowerCase();
            const cENBase = cEN.replace(/_\([^\)]+\)/g, '').trim();
            return (cCN && (cCN === matchKey || cCN === matchKeyNoTag)) ||
                   (cEN && (cEN === matchKey || cEN === matchKeyNoTag || cENBase === matchKeyNoTag));
        });

        if (matchedChar) {
            const collectedTags: string[] = [];

            // 【Step 2：先处理固定匹配内容 (Fixed Injections FIRST)】
            const fixedVars = treeScheme.characterFixedVariables || ['nameEN', 'characterTraits'];
            for (const fVar of fixedVars) {
                const fVal = resolveVarValue(fVar, matchedChar);
                if (fVal && !collectedTags.includes(fVal)) {
                    collectedTags.push(fVal);
                }
            }

            // 【Step 3：再处理角色条件分支内容 (Conditional Branch Injections SECOND)】
            evaluate2LevelNodes(charNodes, lowerContent, matchedChar, collectedTags);

            return collectedTags.join(', ');
        }

        // 2. 匹配服装实体
        const matchedOutfit = existingOutfits.find(o => {
            const oCN = (o.nameCN || '').trim().toLowerCase();
            const oEN = (o.nameEN || '').trim().toLowerCase();
            const oENBase = oEN.replace(/_\([^\)]+\)/g, '').trim();
            return (oCN && (oCN === matchKey || oCN === matchKeyNoTag)) ||
                   (oEN && (oEN === matchKey || oEN === matchKeyNoTag || oENBase === matchKeyNoTag));
        });

        if (matchedOutfit) {
            const collectedTags: string[] = [];

            // 【Step 2：先处理固定匹配内容 (Fixed Injections FIRST)】
            const fixedVars = treeScheme.outfitFixedVariables || ['nameEN'];
            for (const fVar of fixedVars) {
                const fVal = resolveVarValue(fVar, matchedOutfit);
                if (fVal && !collectedTags.includes(fVal)) {
                    collectedTags.push(fVal);
                }
            }

            // 【Step 3：再处理服装条件分支内容 (Conditional Branch Injections SECOND)】
            evaluate2LevelNodes(outfitNodes, lowerContent, matchedOutfit, collectedTags);

            return collectedTags.join(', ');
        }

        // 3. ⚠️ 未找到任何匹配实体 / 无效占位符 ➔ 擦除替换为 0 字符空字符串 "" (绝不出双引号)
        return '';
    });

    // 格式二次清洗：擦除任何混入的 <xml> 标签并清洗多余逗号与空空格
    const strippedXml = processed.replace(/<[^>]+>/g, ' ');
    return cleanRenderedText(strippedXml);
}


