/**
 * 数据归一化与反序列化清洗器 (DataNormalizer)
 *
 * 核心功能：
 * 1. 在外部持久化数据反序列化与导入解析入口，一次性将历史旧字段规整为标准领域模型；
 * 2. 杜绝在各业务调用处编写多处补丁式的字段降级判断逻辑；
 * 3. 保证领域模型在内存中保持权威属性命名的一致性与纯净度。
 *
 * 注意事项：
 * 1. 本模块所有函数均为无副作用纯函数，不依赖 DOM、网络或全局持久化状态；
 * 2. 对缺失字段做合理的防御性默认赋值。
 */

import type { ChatImageEntry, StorageStrategy, PromptPresetData } from '@types';

/**
 * 规整并标准化聊天记录中的单张图片条目
 * 自动将历史旧格式（uuid, mime, format, timestamp）映射规整为权威标准字段
 *
 * @param raw 原始反序列化未校验对象
 * @returns 规范化的 ChatImageEntry 对象
 */
export function normalizeChatImageEntry(raw: unknown): ChatImageEntry {
    if (!raw || typeof raw !== 'object') {
        throw new Error('无效的聊天图片条目数据');
    }

    const data = raw as Record<string, unknown>;

    // 1. 唯一标识归一化：优先使用标准 id，兼容历史 uuid
    const id = String(data.id || data.uuid || '');

    // 2. MIME 与拓展名归一化：优先使用标准 mimeType 与 extension
    const mimeType = String(data.mimeType || data.mime || 'image/png');
    const extension = String(data.extension || data.format || 'png');

    // 3. 时间戳归一化：优先使用 createdAt，兼容历史 timestamp
    const createdAt = typeof data.createdAt === 'number'
        ? data.createdAt
        : (typeof data.timestamp === 'number' ? data.timestamp : Date.now());

    // 4. 存储策略归一化
    let storageStrategy: StorageStrategy = 'split';
    if (data.storageStrategy === 'server' || data.storageStrategy === 'embedded' || data.storageStrategy === 'split') {
        storageStrategy = data.storageStrategy;
    }

    return {
        id,
        mimeType,
        extension,
        engine: String(data.engine || 'unknown'),
        prompt: String(data.prompt || ''),
        negativePrompt: typeof data.negativePrompt === 'string' ? data.negativePrompt : undefined,
        createdAt,
        storageStrategy,
        url: typeof data.url === 'string' ? data.url : undefined,
        base64: typeof data.base64 === 'string' ? data.base64 : undefined,
        metadata: data.metadata && typeof data.metadata === 'object'
            ? (data.metadata as Record<string, unknown>)
            : undefined
    };
}

/**
 * 规整并标准化提示词预设数据模型
 * 在预设文件读取或导入解析入口，一次性将历史别名映射规整为权威属性，
 * 避免在业务层出现诸如 activePreset.prefix || activePreset.promptPrefix 的补丁式代码。
 *
 * @param raw 原始反序列化预设对象
 * @returns 规范化的 PromptPresetData 数据对象
 */
export function normalizePromptPresetData(raw: unknown): PromptPresetData {
    if (!raw || typeof raw !== 'object') {
        return {};
    }

    const data = raw as Record<string, unknown>;

    // 1. 前缀规整：优先使用 prefix，兼容 promptPrefix
    const prefix = typeof data.prefix === 'string'
        ? data.prefix
        : (typeof data.promptPrefix === 'string' ? data.promptPrefix : undefined);

    // 2. 后缀规整：优先使用 suffix，兼容 promptSuffix
    const suffix = typeof data.suffix === 'string'
        ? data.suffix
        : (typeof data.promptSuffix === 'string' ? data.promptSuffix : undefined);

    // 3. 负向词规整：优先使用 defaultNegative，兼容 negativePrompt
    const defaultNegative = typeof data.defaultNegative === 'string'
        ? data.defaultNegative
        : (typeof data.negativePrompt === 'string' ? data.negativePrompt : undefined);

    // 4. 宏替换字典规整：优先使用 macroReplacements，兼容 replacements
    let macroReplacements: Record<string, string> | undefined;
    const rawReplacements = data.macroReplacements || data.replacements;
    if (rawReplacements && typeof rawReplacements === 'object') {
        macroReplacements = rawReplacements as Record<string, string>;
    }

    // 5. 正则规则规整：优先使用 regexRules，兼容 macroRules
    let regexRules: unknown[] | undefined;
    const rawRules = data.regexRules || data.macroRules;
    if (Array.isArray(rawRules)) {
        regexRules = rawRules;
    }

    // 6. LoRA 列表
    const loras = Array.isArray(data.loras) ? data.loras : undefined;

    return {
        prefix,
        suffix,
        defaultNegative,
        macroReplacements,
        regexRules,
        loras
    };
}

