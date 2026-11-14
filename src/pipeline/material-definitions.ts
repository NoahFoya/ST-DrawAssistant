/**
 * 角色与服装素材预置部位定义、Token 统计工具及内置宏规则。
 *
 * @remarks
 * 作为宏解析器、素材库表单、词库自动补全与楼层档案提取器的共享配置来源：
 * 1. 部位键采用简洁英文单词，UI 展示中文社区常用标签；
 * 2. 结构清晰的人物身体部位与穿戴层级规范；
 * 3. 宏规则与素材彻底解耦，提供可自由配置与增删改查的宏规则映射器；
 * 4. 规范对齐 Danbooru 与 Stable Diffusion 常用词条规范。
 */

import type {
    CharacterPartKey,
    CharacterParts,
    CharacterPresetData,
    OutfitPartKey,
    OutfitParts,
    OutfitPresetData,
    MaterialMacroRule,
} from '@types';

/** 部位字段定义项 */
export interface MaterialPartDef<K extends string> {
    /** 宏后缀调用英文键名 */
    readonly key: K;
    /** 界面展示中文标签 */
    readonly label: string;
    /** 填写范围说明 */
    readonly hint: string;
    /** 输入框占位示例 */
    readonly placeholder: string;
    /** 楼层档案提取支持的键别名（如英文大写或中文） */
    readonly extractAliases: readonly string[];
}

/** Token 用量统计汇总结构 */
export interface MaterialTokenSummary {
    /** 仅专属触发词（trigger） */
    readonly trigger: number;
    /** 半身构图宏（upper）估算 Token */
    readonly upper: number;
    /** 全身构图宏（full）估算 Token */
    readonly full: number;
    /** 全量预设标签 Token 合计 */
    readonly total: number;
}

/** 角色全部 13 个标准生理部位定义（按自然生理结构自顶向下排列） */
export const CHARACTER_PART_DEFS: readonly MaterialPartDef<CharacterPartKey>[] = [
    {
        key: 'appearance',
        label: '外貌体态',
        hint: '身材体型、种族、肤色、整体身型基调（如 slender, fair_skin, elf, tall）',
        placeholder: '例如: slender, fair_skin, elf, tall',
        extractAliases: ['APPEARANCE', 'PHYSIQUE', 'GENERAL', 'OVERALL', '外貌体态', '外貌', '体态', '身材'],
    },
    {
        key: 'hair',
        label: '发型发色',
        hint: '发色、发长、发型、刘海、呆毛特征（如 silver_hair, long_hair, twintails, bangs, ahoge）',
        placeholder: '例如: silver_hair, long_hair, twintails, blunt_bangs, ahoge',
        extractAliases: ['HAIR', 'HAIRSTYLE', '发型发色', '发型', '发貌', '发色'],
    },
    {
        key: 'face',
        label: '容貌五官',
        hint: '瞳色、眼型、表情神态、妆容、泪痣/面印（如 blue_eyes, tsundere, gentle_smile, mole_under_eye）',
        placeholder: '例如: blue_eyes, tsundere, smile, mole_under_eye',
        extractAliases: ['FACE', 'EYES', 'EXPRESSION', 'HEAD', '容貌五官', '面容', '五官', '瞳色', '表情'],
    },
    {
        key: 'features',
        label: '特异特征',
        hint: '兽耳、兽尾、羽翼、犄角、光环等非人/标志生物特征（如 cat_ears, cat_tail, angel_wings, horns）',
        placeholder: '例如: cat_ears, cat_tail, angel_wings, horns',
        extractAliases: ['FEATURES', 'APPENDAGES', 'TRAITS', 'TAIL', 'WINGS', 'HORNS', '特异特征', '特征附肢', '附肢', '兽耳', '尾巴', '羽翼', '犄角'],
    },
    {
        key: 'chest',
        label: '胸部特征',
        hint: '胸围罩杯、胸型轮廓、乳首等胸部特征（如 large_breasts, cleavage, pink_nipples）',
        placeholder: '例如: medium_breasts（或 flat_chest / large_breasts, cleavage）',
        extractAliases: ['CHEST', 'BREASTS', 'BUST', 'NIPPLES', '胸部特征', '胸部', '胸围', '胸型'],
    },
    {
        key: 'upper_body',
        label: '上身肩颈',
        hint: '肩颈线条、锁骨、手臂肌理线条、上躯干（如 slender_arms, collarbone, bare_shoulders）',
        placeholder: '例如: slender_arms, collarbone, bare_shoulders',
        extractAliases: ['UPPER_BODY', 'UPPER', 'SHOULDERS', 'ARMS', '上身肩颈', '上半身', '肩颈', '锁骨', '手臂'],
    },
    {
        key: 'waist',
        label: '腰腹曲线',
        hint: '腰线、小腹、肚脐、马甲线或腹部印记（如 narrow_waist, flat_stomach, navel）',
        placeholder: '例如: narrow_waist, flat_stomach, navel',
        extractAliases: ['WAIST', 'STOMACH', 'BELLY', 'NAVEL', '腰腹曲线', '腰腹', '腰部', '小腹', '肚脐'],
    },
    {
        key: 'hips',
        label: '臀胯轮廓',
        hint: '臀胯比例、腰臀比、臀部曲线轮廓（如 wide_hips, curvy_hips）',
        placeholder: '例如: wide_hips, curvy_hips',
        extractAliases: ['HIPS', 'BUTT', 'PELVIS', '臀胯轮廓', '臀部', '臀胯'],
    },
    {
        key: 'legs',
        label: '腿部轮廓',
        hint: '大腿、小腿线条、肉腿、修长美腿（如 slender_legs, thick_thighs）',
        placeholder: '例如: slender_legs, thick_thighs',
        extractAliases: ['LEGS', 'THIGHS', '腿部轮廓', '腿部', '大腿', '小腿'],
    },
    {
        key: 'feet',
        label: '足部细节',
        hint: '脚踝、脚掌、足底、脚趾、赤足细节（如 bare_feet, soles, delicate_toes）',
        placeholder: '例如: bare_feet, soles, delicate_toes, ankle',
        extractAliases: ['FEET', 'FOOT', 'BARE_FEET', 'SOLES', '足部细节', '足部', '赤足', '脚掌', '足底'],
    },
    {
        key: 'hands',
        label: '手部指掌',
        hint: '手指修长度、手腕、指甲色彩（如 slender_fingers, pink_nails）',
        placeholder: '例如: slender_fingers, pink_nails',
        extractAliases: ['HANDS', 'FINGERS', 'NAILS', '手部指掌', '手部', '手指', '指掌'],
    },
    {
        key: 'accessories',
        label: '随身配饰',
        hint: '不随换装摘除的随身标志物（如 glasses, earrings, choker, ribbon）',
        placeholder: '例如: glasses, earrings, choker, ribbon',
        extractAliases: ['ACCESSORIES', 'ACC', '随身配饰', '配饰', '常驻饰品'],
    },
    {
        key: 'privates',
        label: '生殖性征',
        hint: '私密身体特征与性征细节（如 pubic_hair, pussy, penis, cameltoe）',
        placeholder: '例如: pubic_hair, pussy, penis, cameltoe（按需填写）',
        extractAliases: ['PRIVATES', 'GENITALS', 'REPRODUCTIVE', '生殖性征', '生殖构造', '性征特征', '性征', '生殖'],
    },
];

/** 服装全部 9 个标准穿戴部位定义（按穿戴层级顺序排列） */
export const OUTFIT_PART_DEFS: readonly MaterialPartDef<OutfitPartKey>[] = [
    {
        key: 'style',
        label: '整体风格',
        hint: '版型剪裁、设计主题、主色调、纹样质感（如 gothic_lolita, monochrome, frills, elegant）',
        placeholder: '例如: maid_dress, monochrome, frills, elegant',
        extractAliases: ['STYLE', 'THEME', 'OVERALL', '整体风格', '风格', '款式'],
    },
    {
        key: 'headwear',
        label: '头饰发饰',
        hint: '女仆发箍、帽子、头纱、配套发带等头部服饰（如 maid_headdress, beret, ribbon_trim）',
        placeholder: '例如: maid_headdress, white_headband, beret',
        extractAliases: ['HEADWEAR', 'HAT', 'HEADDRESS', '头饰发饰', '头饰', '帽子', '发饰'],
    },
    {
        key: 'top',
        label: '上装',
        hint: '衬衫、外套、连衣裙、连体衣、领口袖型、围裙上半部等（如 white_shirt, dress, puffy_sleeves）',
        placeholder: '例如: white_shirt, puffy_short_sleeves, frilled_collar',
        extractAliases: ['TOP', 'SHIRT', 'DRESS', 'UPPER_WEAR', '上装', '上衣', '连衣裙', '连身服'],
    },
    {
        key: 'bottom',
        label: '下装',
        hint: '半身裙装、裤装、短裤、百褶裙摆、围裙下摆等分体下装（如 pleated_skirt, denim_shorts）',
        placeholder: '例如: pleated_skirt, long_skirt, shorts',
        extractAliases: ['BOTTOM', 'SKIRT', 'PANTS', 'SHORTS', '下装', '裙裤', '半身裙', '裤装'],
    },
    {
        key: 'handwear',
        label: '手饰袖套',
        hint: '手套、蕾丝腕套、分离袖、手链等（如 white_gloves, wrist_cuffs）',
        placeholder: '例如: white_gloves, wrist_cuffs',
        extractAliases: ['HANDWEAR', 'GLOVES', 'CUFFS', '手饰袖套', '手套', '腕饰', '袖套'],
    },
    {
        key: 'socks',
        label: '腿饰袜类',
        hint: '过膝袜、连裤袜、吊带袜、短袜、丝袜、网袜等（如 black_pantyhose, white_thighhighs）',
        placeholder: '例如: black_pantyhose, white_thighhighs, garter_straps',
        extractAliases: ['SOCKS', 'STOCKINGS', 'PANTYHOSE', 'LEGWEAR', '腿饰袜类', '袜类', '丝袜', '连裤袜', '过膝袜', '袜'],
    },
    {
        key: 'shoes',
        label: '鞋履鞋靴',
        hint: '高跟鞋、皮鞋、运动鞋、靴子、玛丽珍鞋、凉鞋等（如 high_heels, mary_janes, boots）',
        placeholder: '例如: high_heels, mary_janes, boots, sneakers',
        extractAliases: ['SHOES', 'FOOTWEAR', 'BOOTS', '鞋履鞋靴', '鞋履', '鞋靴', '鞋子', '鞋'],
    },
    {
        key: 'accessories',
        label: '服饰配件',
        hint: '领结、胸针、丝带蝴蝶结、披肩斗篷、腰带挂饰等（如 red_bowtie, capelet, leather_belt）',
        placeholder: '例如: red_bowtie, capelet, leather_belt',
        extractAliases: ['ACCESSORIES', 'ACC', 'OUTFIT_ACC', '服饰配件', '配件', '挂饰'],
    },
    {
        key: 'underwear',
        label: '贴身内衣',
        hint: '文胸、内裤款式、花纹与颜色、打底内衬等（如 white_bra, lace_panties）',
        placeholder: '例如: white_bra, lace_panties',
        extractAliases: ['UNDERWEAR', 'LINGERIE', '贴身内衣', '内衣裤', '内衣'],
    },
];

/**
 * 校验宏规则调用 Key 的合法性。
 *
 * @remarks
 * 1. 必须符合 ^[a-z0-9_]+$ 格式；
 * 2. 严禁与同分类下其他宏规则重名；
 * 3. 严禁与该类别已有的原生保留部位键冲突。
 */
export function validateMacroKey(
    key: string,
    currentRuleId: string,
    allRules: MaterialMacroRule[],
    isCharacter: boolean
): { valid: boolean; error?: string } {
    const trimmed = (key || '').trim();
    if (!trimmed) {
        return { valid: false, error: '宏调用名不能为空' };
    }
    if (!/^[a-z0-9_]+$/.test(trimmed)) {
        return { valid: false, error: '仅允许小写英文、数字与下划线 (a-z0-9_)' };
    }
    const duplicate = allRules.find(
        (r) => r.id !== currentRuleId && r.name?.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
        return { valid: false, error: `已存在同名宏指令: ${trimmed}` };
    }
    const reservedParts: ReadonlySet<string> = isCharacter
        ? new Set<string>(CHARACTER_PART_DEFS.map((d) => d.key))
        : new Set<string>(OUTFIT_PART_DEFS.map((d) => d.key));
    if (reservedParts.has(trimmed)) {
        return { valid: false, error: `不能与原生保留部位名冲突: ${trimmed}` };
    }
    return { valid: true };
}

/** 创建空的角色部位对象 */
export function createEmptyCharacterParts(): CharacterParts {
    return {
        appearance: '',
        hair: '',
        face: '',
        features: '',
        chest: '',
        upper_body: '',
        waist: '',
        hips: '',
        legs: '',
        feet: '',
        hands: '',
        accessories: '',
        privates: '',
    };
}

/** 创建空的服装部位对象 */
export function createEmptyOutfitParts(): OutfitParts {
    return {
        style: '',
        headwear: '',
        top: '',
        bottom: '',
        handwear: '',
        socks: '',
        shoes: '',
        accessories: '',
        underwear: '',
    };
}

/** 创建默认角色预设数据模板 */
export function createEmptyCharacterData(name = '新角色'): CharacterPresetData {
    const parts = createEmptyCharacterParts();
    return {
        name,
        aliases: '',
        description: '',
        avatarId: '',
        boundOutfitIds: [],
        trigger: '',
        parts,
    };
}

/** 创建默认服装预设数据模板 */
export function createEmptyOutfitData(name = '新服装'): OutfitPresetData {
    const parts = createEmptyOutfitParts();
    return {
        name,
        aliases: '',
        description: '',
        trigger: '',
        avatarId: '',
        parts,
    };
}

/** 规范化角色预设数据，补齐缺省字段并确保各部位键始终为字符串 */
export function normalizeCharacterData(
    raw?:
        | (Partial<Omit<CharacterPresetData, 'parts'>> & {
              parts?: Record<string, unknown>;
          })
        | Record<string, unknown>
): CharacterPresetData {
    const empty = createEmptyCharacterData('');
    if (!raw || typeof raw !== 'object') {
        return empty;
    }
    const r = raw as Record<string, unknown>;
    const rawParts =
        r.parts && typeof r.parts === 'object' && !Array.isArray(r.parts)
            ? (r.parts as Record<string, unknown>)
            : {};
    const parts = createEmptyCharacterParts();
    for (const def of CHARACTER_PART_DEFS) {
        const val = rawParts[def.key];
        parts[def.key] = typeof val === 'string' ? val : '';
    }

    const resolvedName = typeof r.name === 'string' ? r.name.trim() : '';
    const resolvedAliases = typeof r.aliases === 'string' ? r.aliases.trim() : '';
    const resolvedTrigger = typeof r.trigger === 'string' ? r.trigger.trim() : '';

    return {
        name: resolvedName,
        aliases: resolvedAliases,
        description: typeof r.description === 'string' ? r.description : '',
        avatarId: typeof r.avatarId === 'string' ? r.avatarId : '',
        boundOutfitIds: Array.isArray(r.boundOutfitIds)
            ? r.boundOutfitIds.map((v) => String(v ?? '').trim()).filter(Boolean)
            : [],
        trigger: resolvedTrigger,
        parts,
    };
}

/** 规范化服装预设数据，补齐缺省字段并确保各部位键始终为字符串 */
export function normalizeOutfitData(
    raw?:
        | (Partial<Omit<OutfitPresetData, 'parts'>> & {
              parts?: Record<string, unknown>;
          })
        | Record<string, unknown>
): OutfitPresetData {
    const empty = createEmptyOutfitData('');
    if (!raw || typeof raw !== 'object') {
        return empty;
    }
    const r = raw as Record<string, unknown>;
    const rawParts =
        r.parts && typeof r.parts === 'object' && !Array.isArray(r.parts)
            ? (r.parts as Record<string, unknown>)
            : {};
    const parts = createEmptyOutfitParts();
    for (const def of OUTFIT_PART_DEFS) {
        const val = rawParts[def.key];
        parts[def.key] = typeof val === 'string' ? val : '';
    }

    const resolvedName = typeof r.name === 'string' ? r.name.trim() : '';
    const resolvedAliases = typeof r.aliases === 'string' ? r.aliases.trim() : '';
    const resolvedTrigger = typeof r.trigger === 'string' ? r.trigger.trim() : '';

    return {
        name: resolvedName,
        aliases: resolvedAliases,
        description: typeof r.description === 'string' ? r.description : '',
        trigger: resolvedTrigger,
        avatarId: typeof r.avatarId === 'string' ? r.avatarId : '',
        parts,
    };
}

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

function isKeywordSeparatorChar(ch: string | undefined): boolean {
    return (
        ch === undefined ||
        ch === '|' ||
        ch === ',' ||
        ch === '，' ||
        ch === '\n' ||
        ch === '\r' ||
        /\s/.test(ch)
    );
}

/**
 * 解析以 `|` / `,` / `，` / 换行分隔的关键词或别名列表，完整保留合法 `/pattern/flags` 正则字面量。
 */
export function splitKeywordTokens(rawKeywords?: string): string[] {
    const src = (rawKeywords || '').trim();
    if (!src) {
        return [];
    }

    const tokens: string[] = [];
    let current = '';
    let i = 0;

    while (i < src.length) {
        const ch = src[i];
        // 仅当闭合 `/` 后到分隔符之间全为合法且不重复的标志时，才按 /pattern/flags 整体提取
        if (ch === '/' && !current.trim()) {
            let j = i + 1;
            let escaped = false;
            let closedAt = -1;
            while (j < src.length) {
                const inner = src[j];
                if (escaped) {
                    escaped = false;
                } else if (inner === '\\') {
                    escaped = true;
                } else if (inner === '/') {
                    closedAt = j;
                    break;
                }
                j++;
            }
            if (closedAt > i + 1) {
                let flagEnd = closedAt + 1;
                while (
                    flagEnd < src.length &&
                    src[flagEnd] !== '|' &&
                    src[flagEnd] !== ',' &&
                    src[flagEnd] !== '，' &&
                    src[flagEnd] !== '\n' &&
                    src[flagEnd] !== '\r' &&
                    !/\s/.test(src[flagEnd])
                ) {
                    flagEnd++;
                }
                const flagsPart = src.slice(closedAt + 1, flagEnd);
                if (hasValidUniqueRegexFlags(flagsPart) && isKeywordSeparatorChar(src[flagEnd])) {
                    tokens.push(src.slice(i, flagEnd).trim());
                    current = '';
                    i = flagEnd;
                    while (
                        i < src.length &&
                        (src[i] === '|' || src[i] === ',' || src[i] === '，' || /\s/.test(src[i]))
                    ) {
                        i++;
                    }
                    continue;
                }
            }
        }

        if (ch === '|' || ch === ',' || ch === '，' || ch === '\n' || ch === '\r') {
            const trimmed = current.trim();
            if (trimmed) {
                tokens.push(trimmed);
            }
            current = '';
            i++;
            continue;
        }

        current += ch;
        i++;
    }

    const tail = current.trim();
    if (tail) {
        tokens.push(tail);
    }
    return tokens;
}

/**
 * 严格按预设 ID 判断服装是否被角色 boundOutfitIds 绑定。
 */
export function matchesOutfitId(
    boundIds: readonly string[] | undefined,
    outfitId: string
): boolean {
    const cleanTarget = (outfitId || '').trim();
    if (!cleanTarget || !Array.isArray(boundIds) || boundIds.length === 0) {
        return false;
    }
    return boundIds.some((id) => (id || '').trim() === cleanTarget);
}

/**
 * 在档案导入/提取保存阶段，将服装引用（预设 id、服装名称或别名）解析映射为标准服装预设 id。
 * 未匹配到既有服装时保留原修剪后引用值，确保数据不丢失。
 */
export function resolveOutfitIdsFromRefs(
    refs: readonly string[] | undefined,
    allOutfits: ReadonlyArray<{
        id: string;
        name?: string;
        data?: { name?: string; aliases?: string };
    }>
): string[] {
    if (!Array.isArray(refs) || refs.length === 0) {
        return [];
    }

    const out: string[] = [];
    const seen = new Set<string>();

    for (const rawRef of refs) {
        const clean = (rawRef || '').trim();
        if (!clean) continue;
        const lower = clean.toLowerCase();

        const matched = allOutfits.find((o) => {
            if (o.id === clean) return true;
            const oName = (o.data?.name || o.name || '').trim().toLowerCase();
            if (oName && oName === lower) return true;
            return splitKeywordTokens(o.data?.aliases).some(
                (alias) => alias.trim().toLowerCase() === lower
            );
        });

        const resolvedId = matched ? matched.id : clean;
        if (!seen.has(resolvedId)) {
            seen.add(resolvedId);
            out.push(resolvedId);
        }
    }

    return out;
}

/**
 * 规范化标签文本：统一中文逗号与顿号为半角逗号，拆分换行与逗号分隔词条并支持保序去重（保留 `<...>` 语法标签大小写）。
 */
export function cleanTagSegments(
    rawText: string,
    options?: { readonly deduplicate?: boolean }
): string {
    if (!rawText || typeof rawText !== 'string') {
        return '';
    }

    const deduplicate = Boolean(options?.deduplicate);
    const normalized = rawText.replace(/[，、]/g, ',');
    const segments = normalized
        .split(/[\r\n]+/)
        .map((seg) => seg.trim())
        .filter(Boolean);

    const tags: string[] = [];
    const seenTags = new Set<string>();

    for (const seg of segments) {
        for (const part of seg.split(',')) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            if (deduplicate) {
                const isSpecialTag = trimmed.startsWith('<') && trimmed.endsWith('>');
                const lookupKey = isSpecialTag ? trimmed : trimmed.toLowerCase();
                if (seenTags.has(lookupKey)) {
                    continue;
                }
                seenTags.add(lookupKey);
            }

            tags.push(trimmed);
        }
    }

    return tags.join(', ');
}

/**
 * 合并多段逗号分隔的标签字符串，按首次出现顺序不区分大小写去重。
 */
export function dedupeCommaTags(segments: readonly string[]): string {
    const joined = segments
        .filter((seg): seg is string => typeof seg === 'string' && Boolean(seg.trim()))
        .join(',');
    return cleanTagSegments(joined, { deduplicate: true });
}

/**
 * 估算提示词标签文本的 Token 用量（兼容英文 Danbooru 标签、权重括号与中文字符）。
 */
export function estimateTagTokens(text: string): number {
    const trimmed = (text || '').trim();
    if (!trimmed) {
        return 0;
    }

    let cjkCount = 0;
    const nonCjkText = trimmed.replace(/[\u4e00-\u9fa5\u3040-\u30ff]/g, () => {
        cjkCount++;
        return ' ';
    });

    const asciiWords = nonCjkText
        .split(/[\s,，_():：[\]{}|/\\-]+/)
        .filter((w) => w.length > 0);
    const punctCount = (nonCjkText.match(/[,():[\]{}]/g) || []).length;

    let wordTokens = 0;
    for (const w of asciiWords) {
        wordTokens += Math.max(1, Math.ceil(w.length / 5));
    }

    return Math.ceil(cjkCount * 1.2) + wordTokens + Math.ceil(punctCount * 0.5);
}

/** 构建角色专属触发词标签数组 */
export function getCharacterTriggerSegments(data: CharacterPresetData): string[] {
    const segments: string[] = [];
    if (data.trigger?.trim()) {
        segments.push(data.trigger.trim());
    }
    return segments;
}

/** 计算角色在触发词、半身、全身与全量下的预估 Token 统计 */
export function computeCharacterTokenStats(raw: Partial<CharacterPresetData>): MaterialTokenSummary {
    const data = normalizeCharacterData(raw);
    const baseSegs = getCharacterTriggerSegments(data);

    const triggerText = dedupeCommaTags(baseSegs);
    const upperParts: CharacterPartKey[] = ['hair', 'face', 'chest', 'upper_body', 'hands', 'accessories'];
    const fullParts: CharacterPartKey[] = [
        'appearance',
        'hair',
        'face',
        'features',
        'chest',
        'upper_body',
        'waist',
        'hips',
        'legs',
        'feet',
        'hands',
        'accessories',
    ];
    const allParts = CHARACTER_PART_DEFS.map((d) => d.key);

    const upperText = dedupeCommaTags([...baseSegs, ...upperParts.map((k) => data.parts[k])]);
    const fullText = dedupeCommaTags([...baseSegs, ...fullParts.map((k) => data.parts[k])]);
    const totalText = dedupeCommaTags([...baseSegs, ...allParts.map((k) => data.parts[k])]);

    return {
        trigger: estimateTagTokens(triggerText),
        upper: estimateTagTokens(upperText),
        full: estimateTagTokens(fullText),
        total: estimateTagTokens(totalText),
    };
}

/** 构建服装专属触发词标签数组 */
export function getOutfitTriggerSegments(data: OutfitPresetData): string[] {
    const segments: string[] = [];
    if (data.trigger?.trim()) {
        segments.push(data.trigger.trim());
    }
    return segments;
}

/** 计算服装在触发词、半身、全身与全量下的预估 Token 统计 */
export function computeOutfitTokenStats(raw: Partial<OutfitPresetData>): MaterialTokenSummary {
    const data = normalizeOutfitData(raw);
    const baseSegs = getOutfitTriggerSegments(data);

    const triggerText = dedupeCommaTags(baseSegs);
    const upperParts: OutfitPartKey[] = ['headwear', 'top', 'handwear', 'accessories'];
    const fullParts: OutfitPartKey[] = [
        'style',
        'headwear',
        'top',
        'bottom',
        'handwear',
        'socks',
        'shoes',
        'accessories',
    ];
    const allParts = OUTFIT_PART_DEFS.map((d) => d.key);

    const upperText = dedupeCommaTags([...baseSegs, ...upperParts.map((k) => data.parts[k])]);
    const fullText = dedupeCommaTags([...baseSegs, ...fullParts.map((k) => data.parts[k])]);
    const totalText = dedupeCommaTags([...baseSegs, ...allParts.map((k) => data.parts[k])]);

    return {
        trigger: estimateTagTokens(triggerText),
        upper: estimateTagTokens(upperText),
        full: estimateTagTokens(fullText),
        total: estimateTagTokens(totalText),
    };
}
