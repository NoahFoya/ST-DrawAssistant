/**
 * 角色与服装素材预置部位定义、Token 统计工具及内置宏规则。
 *
 * @remarks
 * 作为宏解析器、素材库表单、词库自动补全与楼层档案提取器的共享配置来源：
 * 1. 部位键采用简洁英文单词，UI 展示中文社区常用标签；
 * 2. 结构清晰的人物身体部位与穿戴层级规范；
 * 3. 宏规则与素材条目独立存储，提供可增删改查的宏规则映射器；
 * 4. 规范对齐 Danbooru 与 Stable Diffusion 常用词条规范。
 */

import type {
    CharacterExtractionConfig,
    CharacterPartKey,
    CharacterParts,
    CharacterPartState,
    CharacterPresetData,
    MaterialFormatPresetData,
    OutfitPartKey,
    OutfitParts,
    OutfitPartState,
    OutfitPresetData,
    MaterialMacroRule,
} from '@types';
import type { DrawAssistantSettings } from '../store/settings-store';
import defaultMaterialExtractionsJson from '../../config/presets/material-extractions.json';
import defaultMaterialFormatsJson from '../../config/presets/material-formats.json';

/** 默认楼层档案解析提取配置 */
export const DEFAULT_MATERIAL_EXTRACTION_CONFIG: CharacterExtractionConfig = structuredClone(
    (defaultMaterialExtractionsJson as Array<{ data: CharacterExtractionConfig }>)[0].data
);

/** 默认素材文本格式化与宏规则配置 */
export const DEFAULT_MATERIAL_FORMAT_DATA: MaterialFormatPresetData = structuredClone(
    (defaultMaterialFormatsJson as Array<{ data: MaterialFormatPresetData }>)[0].data
);

/**
 * 解析当前生效的楼层档案解析与提取配置（从预设库按 activeExtractionPresetId 读取）。
 */
export function resolveActiveMaterialExtractionConfig(
    settings?: DrawAssistantSettings | null
): CharacterExtractionConfig {
    const list = settings?.presets?.material_extractions || [];
    const activeId = settings?.materialConfig?.activeExtractionPresetId;
    const matched = (activeId ? list.find((p) => p.id === activeId) : undefined) || list[0];
    return {
        ...DEFAULT_MATERIAL_EXTRACTION_CONFIG,
        ...(matched?.data || {}),
    };
}

/**
 * 解析当前生效的素材格式化模板与宏规则配置（从预设库按 activeFormatPresetId 读取）。
 */
export function resolveActiveMaterialFormatConfig(
    settings?: Partial<DrawAssistantSettings> | null
): Required<MaterialFormatPresetData> {
    const list = settings?.presets?.material_formats || [];
    const activeId = settings?.materialConfig?.activeFormatPresetId;
    const matched = (activeId ? list.find((p) => p.id === activeId) : undefined) || list[0];
    const data = matched?.data;
    return {
        characterTemplate: data?.characterTemplate ?? DEFAULT_MATERIAL_FORMAT_DATA.characterTemplate,
        outfitTemplate: data?.outfitTemplate ?? DEFAULT_MATERIAL_FORMAT_DATA.outfitTemplate,
        macroTemplate:
            data?.macroTemplate ??
            DEFAULT_MATERIAL_FORMAT_DATA.macroTemplate ??
            '- {{macro}}: {{description}}',
        characterMacros: Array.isArray(data?.characterMacros)
            ? data.characterMacros
            : DEFAULT_MATERIAL_FORMAT_DATA.characterMacros ?? [],
        outfitMacros: Array.isArray(data?.outfitMacros)
            ? data.outfitMacros
            : DEFAULT_MATERIAL_FORMAT_DATA.outfitMacros ?? [],
    };
}

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

/** 部位分组定义项 */
export interface MaterialPartGroup<K extends string> {
    readonly id: string;
    readonly label: string;
    readonly keys: readonly K[];
    readonly defaultExpanded: boolean;
}

/** 角色部位固定状态后缀集合 */
export const CHARACTER_PART_STATES: readonly CharacterPartState[] = ['clothed', 'exposed', 'nude'];

/** 服装部位固定状态后缀集合 */
export const OUTFIT_PART_STATES: readonly OutfitPartState[] = ['intact', 'disheveled'];

/** 角色状态后缀展示说明 */
export const CHARACTER_PART_STATE_LABELS: Readonly<Record<CharacterPartState, string>> = {
    clothed: '穿衣状态（遮挡部位不展开）',
    exposed: '半裸/走光状态',
    nude: '无遮挡全裸状态',
};

/** 服装状态后缀展示说明 */
export const OUTFIT_PART_STATE_LABELS: Readonly<Record<OutfitPartState, string>> = {
    intact: '穿戴完整规整状态',
    disheveled: '凌乱/敞开/半褪状态',
};

/** 角色部位 3 组自然划分 */
export const CHAR_PART_GROUPS: ReadonlyArray<MaterialPartGroup<CharacterPartKey>> = [
    {
        id: 'head_appearance',
        label: '头部与外貌',
        keys: ['appearance', 'hair', 'face', 'features', 'accessories'],
        defaultExpanded: true,
    },
    {
        id: 'upper_body',
        label: '上身与躯干',
        keys: ['neck_shoulders', 'breasts', 'upper_back', 'abdomen', 'arms', 'hands'],
        defaultExpanded: false,
    },
    {
        id: 'lower_body',
        label: '下身与局部',
        keys: ['hips', 'genitals', 'anus', 'legs', 'feet'],
        defaultExpanded: false,
    },
];

/** 服装部位 2 组自然划分 */
export const OUTFIT_PART_GROUPS: ReadonlyArray<MaterialPartGroup<OutfitPartKey>> = [
    {
        id: 'main_clothing',
        label: '主要服装',
        keys: ['style', 'headwear', 'outerwear', 'top', 'bottom'],
        defaultExpanded: true,
    },
    {
        id: 'inner_footwear_acc',
        label: '内衣、鞋袜与配饰',
        keys: ['bra', 'panties', 'legwear', 'shoes', 'accessories'],
        defaultExpanded: false,
    },
];

/** 角色全部 16 个标准部位定义（支持 通用tags|[clothed]tags|[exposed]tags|[nude]tags 分层） */
export const CHARACTER_PART_DEFS: readonly MaterialPartDef<CharacterPartKey>[] = [
    {
        key: 'appearance',
        label: '外貌与体型',
        hint: '整体体型、身高感、肤色与种族（如 fair_skin, slender, elf）',
        placeholder: '例如: fair_skin, slender, petite',
        extractAliases: ['APPEARANCE', 'PHYSIQUE', 'GENERAL', 'OVERALL', '外貌与身材', '外貌与体型', '外貌', '身材'],
    },
    {
        key: 'hair',
        label: '发型与发色',
        hint: '发色、发长、发型、刘海与呆毛（支持状态分层，如 blonde_hair, long_hair|[nude]messy_hair）',
        placeholder: '例如: blonde_hair, long_hair, twintails, bangs',
        extractAliases: ['HAIR', 'HAIRSTYLE', '发型与发色', '发型', '发色'],
    },
    {
        key: 'face',
        label: '面部五官',
        hint: '瞳色、眼型、眉唇与泪痣、面部疤痕等固有特征（如 blue_eyes, tareme, mole_under_eye）',
        placeholder: '例如: blue_eyes, tareme, long_eyelashes, mole_under_eye',
        extractAliases: ['FACE', 'EYES', 'HEAD', '面部五官', '面容', '五官', '瞳色'],
    },
    {
        key: 'features',
        label: '特殊特征',
        hint: '兽耳、尾巴、翅膀、角、光环或永久体表纹身（如 cat_ears, cat_tail, angel_wings）',
        placeholder: '例如: cat_ears, cat_tail, wings|[exposed]body_tattoo',
        extractAliases: ['FEATURES', 'APPENDAGES', 'TRAITS', '特殊特征', '兽耳', '尾巴', '翅膀'],
    },
    {
        key: 'accessories',
        label: '常驻配饰',
        hint: '不随换装取下的随身物品（如 glasses, choker, earrings）',
        placeholder: '例如: glasses, earrings, gold_pendant',
        extractAliases: ['ACCESSORIES', 'ACC', '常驻配饰', '配饰', '常驻饰品'],
    },
    {
        key: 'neck_shoulders',
        label: '颈肩与锁骨',
        hint: '脖颈、锁骨、肩部线条；[clothed] 仅填外露锁骨，[exposed]/[nude] 补全裸肩（如 |[clothed]collarbone|[nude]bare_shoulders, collarbone）',
        placeholder: '例如: |[clothed]collarbone|[nude]bare_shoulders, collarbone',
        extractAliases: ['NECK_SHOULDERS', 'NECK', 'SHOULDERS', 'COLLARBONE', '颈肩与锁骨', '颈肩', '锁骨', '肩膀'],
    },
    {
        key: 'breasts',
        label: '胸部/乳房',
        hint: '胸围体型置前；[exposed]/[nude] 补充乳头与乳晕细节（如 medium_breasts|[exposed]cleavage, nipples|[nude]nipples, areolae）',
        placeholder: '例如: medium_breasts|[exposed]cleavage, nipples|[nude]nipples, puffy_nipples, areolae',
        extractAliases: ['BREASTS', 'CHEST', 'BUST', 'NIPPLES', '胸部/乳房', '胸部', '乳房', '胸围', '胸型'],
    },
    {
        key: 'upper_back',
        label: '背部',
        hint: '肩胛、脊背线条、背部纹身或伤疤，仅用于背面视角（如 |[exposed]bare_back|[nude]bare_back, back_tattoo）',
        placeholder: '例如: |[exposed]bare_back|[nude]bare_back, spine',
        extractAliases: ['UPPER_BACK', 'BACK', 'SPINE', '背部', '后背', '脊背'],
    },
    {
        key: 'abdomen',
        label: '腰腹与肚脐',
        hint: '腰线、小腹、马甲线与肚脐；[exposed]/[nude] 填写外露腰腹特征（如 |[exposed]midriff, navel|[nude]narrow_waist, flat_stomach, navel）',
        placeholder: '例如: |[exposed]midriff, navel|[nude]narrow_waist, flat_stomach, navel',
        extractAliases: ['ABDOMEN', 'WAIST', 'STOMACH', 'BELLY', 'NAVEL', 'MIDRIFF', '腰腹与肚脐', '腰腹', '腹部', '腰身', '肚脐'],
    },
    {
        key: 'arms',
        label: '手臂',
        hint: '大臂、小臂线条与上肢轮廓（如 slender_arms|[nude]bare_arms）',
        placeholder: '例如: slender_arms|[nude]bare_arms',
        extractAliases: ['ARMS', 'UPPER_ARMS', 'FOREARMS', '手臂', '胳膊'],
    },
    {
        key: 'hands',
        label: '手部',
        hint: '手型比例、手指与固定美甲（如 slender_fingers, pink_nails）',
        placeholder: '例如: slender_fingers, pink_nails',
        extractAliases: ['HANDS', 'FINGERS', 'NAILS', '手部', '手指'],
    },
    {
        key: 'hips',
        label: '臀部',
        hint: '臀部比例与曲线；[clothed] 通常留空，[exposed]/[nude] 填写详细臀型特征',
        placeholder: '例如: |[exposed]wide_hips|[nude]wide_hips, round_ass',
        extractAliases: ['HIPS', 'BUTT', 'ASS', 'PELVIS', '臀部', '臀胯'],
    },
    {
        key: 'genitals',
        label: '生殖器',
        hint: '静态生殖构造与阴毛形态，仅填写于 [exposed]/[nude] 层（如 |[nude]pussy, trimmed_pubic_hair）',
        placeholder: '例如: |[nude]pussy, trimmed_pubic_hair（或 |[nude]penis, testicles）',
        extractAliases: ['GENITALS', 'PUSSY', 'PENIS', 'REPRODUCTIVE', '生殖器', '阴部'],
    },
    {
        key: 'anus',
        label: '肛门/后庭',
        hint: '后庭与肛周特征，仅填写于 [exposed]/[nude] 层，供特写视角按需调用（如 |[nude]anus）',
        placeholder: '例如: |[nude]anus',
        extractAliases: ['ANUS', 'ANAL', '肛门/后庭', '肛门', '后庭'],
    },
    {
        key: 'legs',
        label: '腿部',
        hint: '大腿、小腿线条与肌理（如 slender_legs, thick_thighs）',
        placeholder: '例如: slender_legs|[nude]bare_legs, slender_thighs',
        extractAliases: ['LEGS', 'THIGHS', '腿部', '大腿', '小腿'],
    },
    {
        key: 'feet',
        label: '足部',
        hint: '脚踝、足弓与脚趾形态；日常穿鞋在 [clothed] 可留空，[exposed]/[nude] 填赤足细节',
        placeholder: '例如: |[exposed]barefoot, slender_ankles, toes|[nude]barefoot, slender_ankles, toes',
        extractAliases: ['FEET', 'FOOT', 'BARE_FEET', 'SOLES', '足部', '赤足', '脚掌'],
    },
];

/** 服装全部 10 个标准穿戴部位定义（支持 通用tags|[intact]tags|[disheveled]tags 分层） */
export const OUTFIT_PART_DEFS: readonly MaterialPartDef<OutfitPartKey>[] = [
    {
        key: 'style',
        label: '整体风格',
        hint: '高权重套装主题标签与主配色（如 school_uniform, serafuku；无固定套装风格可留空）',
        placeholder: '例如: school_uniform, serafuku',
        extractAliases: ['STYLE', 'THEME', 'OVERALL', '整体风格', '风格', '套装主题'],
    },
    {
        key: 'headwear',
        label: '头饰',
        hint: '帽子、发箍、发带、头纱与配套耳饰（如 white_headband, beret）',
        placeholder: '例如: white_headband|[disheveled]askew_headwear',
        extractAliases: ['HEADWEAR', 'HAT', 'HEADDRESS', '头饰', '帽子', '发饰'],
    },
    {
        key: 'outerwear',
        label: '外套',
        hint: '大衣、夹克、开衫、披肩等外搭服饰（支持 [intact] 穿好与 [disheveled] 敞开滑落）',
        placeholder: '例如: black_cardigan|[intact]buttoned|[disheveled]open_cardigan, off_shoulder',
        extractAliases: ['OUTERWEAR', 'JACKET', 'COAT', 'CARDIGAN', '外套', '外衣', '大衣'],
    },
    {
        key: 'top',
        label: '上衣与连体衣',
        hint: '衬衫、T恤或连衣裙/连体泳衣/连体衣主件（穿连体服时下装留空）',
        placeholder: '例如: white_shirt, sailor_collar|[intact]shirt_tucked_in|[disheveled]open_shirt, shirt_lift',
        extractAliases: ['TOP', 'SHIRT', 'DRESS', 'UPPER_WEAR', '上衣与连体衣', '上装', '上衣', '连衣裙', '连体衣'],
    },
    {
        key: 'bottom',
        label: '下装',
        hint: '半身裙、短裙、长裤、热裤（连衣裙或连体服时留空）',
        placeholder: '例如: blue_skirt, pleated_skirt|[disheveled]skirt_lift',
        extractAliases: ['BOTTOM', 'SKIRT', 'PANTS', 'SHORTS', '下装', '裙子', '裤装'],
    },
    {
        key: 'bra',
        label: '文胸/内衣上装',
        hint: '文胸、抹胸、吊带内衬与乳贴（如 white_bra|[disheveled]bra_pulled_down）',
        placeholder: '例如: white_bra|[disheveled]bra_pulled_down',
        extractAliases: ['BRA', 'BRASSIERE', 'PASTIES', '文胸/内衣上装', '文胸', '胸罩', '抹胸'],
    },
    {
        key: 'panties',
        label: '内裤/底裤',
        hint: '内裤、丁字裤、安全裤与吊袜带（如 white_panties|[disheveled]panties_aside）',
        placeholder: '例如: white_panties|[disheveled]panties_aside',
        extractAliases: ['PANTIES', 'BRIEFS', 'THONG', 'UNDERPANTS', '内裤/底裤', '内裤', '底裤'],
    },
    {
        key: 'legwear',
        label: '袜子',
        hint: '短袜、过膝袜、连裤袜、丝袜与腿环（如 white_socks, black_thighhighs）',
        placeholder: '例如: white_socks|[disheveled]socks_pulled_down',
        extractAliases: ['LEGWEAR', 'STOCKINGS', 'PANTYHOSE', '袜子', '袜类', '丝袜', '过膝袜'],
    },
    {
        key: 'shoes',
        label: '鞋子',
        hint: '皮鞋、运动鞋、高跟鞋、靴子与凉鞋（如 brown_loafers, high_heels）',
        placeholder: '例如: brown_loafers|[disheveled]one_shoe_off',
        extractAliases: ['SHOES', 'FOOTWEAR', 'BOOTS', '鞋子', '鞋'],
    },
    {
        key: 'accessories',
        label: '配饰',
        hint: '手套、袖套、腕饰、领结、腰带、胸针与包袋（如 red_neckerchief, white_gloves）',
        placeholder: '例如: red_neckerchief, wrist_cuffs|[disheveled]loose_necktie',
        extractAliases: ['ACCESSORIES', 'GLOVES', 'CUFFS', 'ACC', 'OUTFIT_ACC', '配饰', '手套', '腕饰', '配件'],
    },
];

/**
 * 校验宏规则调用 Key 的合法性。
 *
 * @remarks
 * 1. 必须符合 ^[a-z0-9_]+$ 格式；
 * 2. 不可与同分类下其他宏规则重名；
 * 3. 不可与原生部位名或固定状态保留字冲突。
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
        return { valid: false, error: `不能与原生部位名冲突: ${trimmed}` };
    }
    const reservedStates: ReadonlySet<string> = isCharacter
        ? new Set<string>(CHARACTER_PART_STATES)
        : new Set<string>(OUTFIT_PART_STATES);
    if (reservedStates.has(trimmed)) {
        return { valid: false, error: `不能与固定状态后缀冲突: ${trimmed}` };
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
        accessories: '',
        neck_shoulders: '',
        breasts: '',
        upper_back: '',
        abdomen: '',
        arms: '',
        hands: '',
        hips: '',
        genitals: '',
        anus: '',
        legs: '',
        feet: '',
    };
}

/** 创建空的服装部位对象 */
function createEmptyOutfitParts(): OutfitParts {
    return {
        style: '',
        headwear: '',
        outerwear: '',
        top: '',
        bottom: '',
        bra: '',
        panties: '',
        legwear: '',
        shoes: '',
        accessories: '',
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

export function hasValidUniqueRegexFlags(flags: string): boolean {
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

/** 扫描位于 startIdx 处的 `/pattern/` 正则结束斜杠位置（跳过转义斜杠与 `[...]` 字符类内斜杠） */
function findRegexLiteralClosingSlash(src: string, startIdx: number): number {
    let j = startIdx + 1;
    let escaped = false;
    let inCharClass = false;
    while (j < src.length) {
        const inner = src[j];
        if (escaped) {
            escaped = false;
        } else if (inner === '\\') {
            escaped = true;
        } else if (inner === '[' && !inCharClass) {
            inCharClass = true;
        } else if (inner === ']' && inCharClass) {
            inCharClass = false;
        } else if (inner === '/' && !inCharClass) {
            return j;
        }
        j++;
    }
    return -1;
}

/**
 * 若 token 为 `/pattern/flags` 格式则拆出主体与标志串（未校验 flags 合法性）。
 */
export function parseKeywordRegexLiteral(
    rawToken: string
): { pattern: string; flags: string } | null {
    const token = rawToken.trim();
    if (!token.startsWith('/')) {
        return null;
    }
    const closedAt = findRegexLiteralClosingSlash(token, 0);
    if (closedAt <= 1) {
        return null;
    }
    const pattern = token.slice(1, closedAt);
    const flags = token.slice(closedAt + 1);
    return { pattern, flags };
}

/**
 * 校验关键词是否为合法 `/pattern/flags` 正则字面量；非法时返回错误信息。
 */
export function validateKeywordRegexToken(rawToken: string): string | null {
    const token = rawToken.trim();
    if (!token.startsWith('/')) {
        return null;
    }
    const parsed = parseKeywordRegexLiteral(token);
    if (!parsed || !/^[a-zA-Z]*$/.test(parsed.flags)) {
        return `正则字面量格式无效: ${token}`;
    }
    if (!hasValidUniqueRegexFlags(parsed.flags)) {
        return `正则标志无效或重复: ${token}`;
    }
    try {
        new RegExp(parsed.pattern, parsed.flags.replace(/[gy]/g, ''));
        return null;
    } catch (err: unknown) {
        return err instanceof Error ? err.message : `无效正则: ${token}`;
    }
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
 * 解析以 `|` / `,` / `，` / 换行分隔的关键词或别名列表，完整保留合法 `/pattern/flags` 正则字面量（含 `[...]` 字符类内 `/` 与 `,`）。
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
            const closedAt = findRegexLiteralClosingSlash(src, i);
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
 * 两趟优先级匹配：第一趟严格按预设 id 或主名称精确匹配，未命中时第二趟才回退匹配别名。
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

        const matched =
            allOutfits.find((o) => {
                if (o.id === clean) return true;
                const oName = (o.data?.name || o.name || '').trim().toLowerCase();
                return Boolean(oName && oName === lower);
            }) ||
            allOutfits.find((o) =>
                splitKeywordTokens(o.data?.aliases).some(
                    (alias) => alias.trim().toLowerCase() === lower
                )
            );

        const resolvedId = matched ? matched.id : clean;
        if (!seen.has(resolvedId)) {
            seen.add(resolvedId);
            out.push(resolvedId);
        }
    }

    return out;
}

/** 按顶层逗号切分标签段，完整保留 `()` / `[]` / `{}` / `<>` 及 NovelAI `w::...::` 内部逗号 */
function splitTopLevelTags(line: string): string[] {
    const parts: string[] = [];
    let current = '';
    let paren = 0;
    let square = 0;
    let curly = 0;
    let angle = 0;
    let inWeightColon = false;
    let escaped = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            current += ch;
            escaped = true;
            continue;
        }

        // 检测 NovelAI 数值权重定界符 `1.2::tag1, tag2::`（同时兼容 `1.4::a::1.2::b::` 连写）
        if (ch === ':' && line[i + 1] === ':') {
            if (!inWeightColon && /(?:^|[,\s]|::)[-+]?\d+(?:\.\d+)?$/.test(current)) {
                inWeightColon = true;
            } else if (inWeightColon) {
                inWeightColon = false;
            }
            current += '::';
            i++;
            continue;
        }

        if (ch === '(') paren++;
        else if (ch === ')') paren = Math.max(0, paren - 1);
        else if (ch === '[') square++;
        else if (ch === ']') square = Math.max(0, square - 1);
        else if (ch === '{') curly++;
        else if (ch === '}') curly = Math.max(0, curly - 1);
        else if (ch === '<') angle++;
        else if (ch === '>') angle = Math.max(0, angle - 1);

        if (
            (ch === ',' || ch === '，' || ch === '、') &&
            paren === 0 &&
            square === 0 &&
            curly === 0 &&
            angle === 0 &&
            !inWeightColon
        ) {
            const trimmed = current.trim();
            if (trimmed) parts.push(trimmed);
            current = '';
            continue;
        }

        current += ch;
    }

    const tail = current.trim();
    if (tail) parts.push(tail);
    return parts;
}

/**
 * 规范化标签文本：拆分换行与顶层逗号分隔词条，支持保序去重（保留 `<...>` 语法标签并对 LoRA 路径统一斜杠大小写比较）。
 */
export function cleanTagSegments(
    rawText: string,
    options?: { readonly deduplicate?: boolean }
): string {
    if (!rawText || typeof rawText !== 'string') {
        return '';
    }

    const deduplicate = Boolean(options?.deduplicate);
    const segments = rawText
        .split(/[\r\n]+/)
        .map((seg) => seg.trim())
        .filter(Boolean);

    const tags: string[] = [];
    const seenTags = new Set<string>();

    for (const seg of segments) {
        for (const trimmed of splitTopLevelTags(seg)) {
            if (!trimmed) continue;

            if (deduplicate) {
                const isLoraTag = /^<(?:lora|wlr):/i.test(trimmed) && trimmed.endsWith('>');
                const isSpecialTag = trimmed.startsWith('<') && trimmed.endsWith('>');
                const lookupKey = isLoraTag
                    ? trimmed.replace(/\\/g, '/').toLowerCase()
                    : isSpecialTag
                      ? trimmed
                      : trimmed.toLowerCase();
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

/** 部位字段状态分层解析结果 */
export interface LayeredPartTags {
    /** 全状态共享的前导通用 Tags */
    readonly commonTags: string;
    /** 各显式状态对应的独立 Tags 字典 */
    readonly stateTags: Readonly<Record<string, string>>;
}

const KNOWN_LAYER_STATE_SET = new Set<string>([
    ...CHARACTER_PART_STATES,
    ...OUTFIT_PART_STATES,
]);

/** 按顶层 `|` 切分字段，保留 `(...)` / `[...]` / `<...>` 内部嵌套语法 */
function splitTopLevelPipes(rawText: string): string[] {
    if (!rawText) return [];
    const segments: string[] = [];
    let current = '';
    let paren = 0;
    let square = 0;
    let angle = 0;

    for (let i = 0; i < rawText.length; i++) {
        const ch = rawText[i];
        if (ch === '(') paren++;
        else if (ch === ')') paren = Math.max(0, paren - 1);
        else if (ch === '[') square++;
        else if (ch === ']') square = Math.max(0, square - 1);
        else if (ch === '<') angle++;
        else if (ch === '>') angle = Math.max(0, angle - 1);

        if (ch === '|' && paren === 0 && square === 0 && angle === 0) {
            segments.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    segments.push(current.trim());
    return segments;
}

/**
 * 解析单部位 `通用tags|[状态1]tags|[状态2]tags` 分层写法。
 */
export function parseLayeredPartTags(rawValue: string): LayeredPartTags {
    const src = (rawValue || '').trim();
    if (!src) {
        return { commonTags: '', stateTags: {} };
    }

    const commonSegments: string[] = [];
    const stateBuckets = new Map<string, string[]>();

    for (const seg of splitTopLevelPipes(src)) {
        if (!seg) continue;
        const match = seg.match(/^\[([a-zA-Z0-9_-]+)\]\s*(?:[:：]\s*)?([\s\S]*)$/);
        if (match) {
            const stateKey = match[1].toLowerCase();
            if (KNOWN_LAYER_STATE_SET.has(stateKey)) {
                const body = cleanTagSegments(match[2] || '', { deduplicate: true });
                if (body) {
                    const list = stateBuckets.get(stateKey) || [];
                    list.push(body);
                    stateBuckets.set(stateKey, list);
                }
                continue;
            }
        }
        const cleaned = cleanTagSegments(seg, { deduplicate: true });
        if (cleaned) {
            commonSegments.push(cleaned);
        }
    }

    const stateTags: Record<string, string> = {};
    for (const [k, list] of stateBuckets.entries()) {
        stateTags[k] = dedupeCommaTags(list);
    }

    return {
        commonTags: dedupeCommaTags(commonSegments),
        stateTags,
    };
}

/**
 * 按指定状态展开单部位标签：
 * - 指定状态时：优先加载通用 Tags，随后附加目标状态 Tags 并去重；
 * - 未指定状态（降级回退）时：仅输出通用 Tags。
 */
export function resolvePartTagsForState(rawValue: string, state?: string): string {
    const parsed = parseLayeredPartTags(rawValue);
    if (!state) {
        return parsed.commonTags;
    }
    const normalizedState = state.trim().toLowerCase();
    const stateVal = parsed.stateTags[normalizedState] || '';
    return dedupeCommaTags([parsed.commonTags, stateVal]);
}

/**
 * 合并同一部位的两段分层标签文本，按通用层与各状态层分别去重重组。
 */
export function mergeLayeredPartTags(existingRaw: string, incomingRaw: string): string {
    const left = parseLayeredPartTags(existingRaw);
    const right = parseLayeredPartTags(incomingRaw);

    const commonMerged = dedupeCommaTags([left.commonTags, right.commonTags]);
    const allStates = new Set<string>([
        ...Object.keys(left.stateTags),
        ...Object.keys(right.stateTags),
    ]);

    const parts: string[] = [];
    if (commonMerged || allStates.size > 0) {
        parts.push(commonMerged);
    }
    for (const state of [...CHARACTER_PART_STATES, ...OUTFIT_PART_STATES]) {
        if (!allStates.has(state)) continue;
        const mergedState = dedupeCommaTags([
            left.stateTags[state] || '',
            right.stateTags[state] || '',
        ]);
        if (mergedState) {
            parts.push(`[${state}]${mergedState}`);
        }
    }

    return parts.join('|').replace(/^\|+$/, '');
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
function getCharacterTriggerSegments(data: CharacterPresetData): string[] {
    const segments: string[] = [];
    if (data.trigger?.trim()) {
        segments.push(data.trigger.trim());
    }
    return segments;
}

/** 从默认宏预设按宏名读取目标部位列表，供 Token 统计复用单一事实源 */
function getDefaultMacroTargetParts<K extends string>(
    rules: readonly MaterialMacroRule[] | undefined,
    macroName: string,
    validKeys: ReadonlySet<K>,
    fallback: readonly K[]
): readonly K[] {
    const matched = rules?.find((r) => r.name?.trim().toLowerCase() === macroName);
    const filtered = (matched?.targetParts || []).filter((p): p is K =>
        validKeys.has(p as K)
    );
    return filtered.length > 0 ? filtered : fallback;
}

/** 计算角色在触发词、半身、全身与全量下的预估 Token 统计 */
export function computeCharacterTokenStats(raw: Partial<CharacterPresetData>): MaterialTokenSummary {
    const data = normalizeCharacterData(raw);
    const baseSegs = getCharacterTriggerSegments(data);

    const triggerText = dedupeCommaTags(baseSegs);
    const allParts = CHARACTER_PART_DEFS.map((d) => d.key);
    const validKeySet = new Set<CharacterPartKey>(allParts);
    const upperParts = getDefaultMacroTargetParts<CharacterPartKey>(
        DEFAULT_MATERIAL_FORMAT_DATA.characterMacros,
        'upper',
        validKeySet,
        ['appearance', 'hair', 'face', 'features', 'accessories', 'neck_shoulders', 'breasts', 'abdomen', 'arms', 'hands']
    );
    const fullParts = getDefaultMacroTargetParts<CharacterPartKey>(
        DEFAULT_MATERIAL_FORMAT_DATA.characterMacros,
        'full',
        validKeySet,
        allParts
    );

    const upperText = dedupeCommaTags([
        ...baseSegs,
        ...upperParts.map((k) => resolvePartTagsForState(data.parts[k], 'clothed')),
    ]);
    const fullText = dedupeCommaTags([
        ...baseSegs,
        ...fullParts.map((k) => resolvePartTagsForState(data.parts[k], 'clothed')),
    ]);
    const totalText = dedupeCommaTags([...baseSegs, ...allParts.map((k) => data.parts[k])]);

    return {
        trigger: estimateTagTokens(triggerText),
        upper: estimateTagTokens(upperText),
        full: estimateTagTokens(fullText),
        total: estimateTagTokens(totalText),
    };
}

/** 构建服装专属触发词标签数组 */
function getOutfitTriggerSegments(data: OutfitPresetData): string[] {
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
    const allParts = OUTFIT_PART_DEFS.map((d) => d.key);
    const validKeySet = new Set<OutfitPartKey>(allParts);
    const upperParts = getDefaultMacroTargetParts<OutfitPartKey>(
        DEFAULT_MATERIAL_FORMAT_DATA.outfitMacros,
        'upper',
        validKeySet,
        ['style', 'headwear', 'outerwear', 'top', 'accessories']
    );
    const fullParts = getDefaultMacroTargetParts<OutfitPartKey>(
        DEFAULT_MATERIAL_FORMAT_DATA.outfitMacros,
        'full',
        validKeySet,
        ['style', 'headwear', 'outerwear', 'top', 'bottom', 'legwear', 'shoes', 'accessories']
    );

    const upperText = dedupeCommaTags([
        ...baseSegs,
        ...upperParts.map((k) => resolvePartTagsForState(data.parts[k], 'intact')),
    ]);
    const fullText = dedupeCommaTags([
        ...baseSegs,
        ...fullParts.map((k) => resolvePartTagsForState(data.parts[k], 'intact')),
    ]);
    const totalText = dedupeCommaTags([...baseSegs, ...allParts.map((k) => data.parts[k])]);

    return {
        trigger: estimateTagTokens(triggerText),
        upper: estimateTagTokens(upperText),
        full: estimateTagTokens(fullText),
        total: estimateTagTokens(totalText),
    };
}
