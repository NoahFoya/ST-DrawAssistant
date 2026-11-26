/**
 * 预设名称归一化、导入对象安全清洗与分类校验纯函数。
 */

import type { PresetCategory } from '@types';
import { AppValidationError } from '../errors';

const FORBIDDEN_IMPORT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 判断值是否为普通键值对象（非 null / 数组） */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 预设名称归一化键（用于 UI 判重与存储写入保持一致） */
export function normalizePresetNameKey(name: string): string {
    return name.trim().toLowerCase();
}

/** 剥离文件名末尾 `.json` 扩展名作为导入预设的默认名称 */
export function stripJsonExtension(fileName?: string): string {
    return typeof fileName === 'string' ? fileName.replace(/\.json$/i, '').trim() : '';
}

/** 递归剔除 `__proto__` / `constructor` / `prototype` 等危险原型键，防止导入外部 JSON 时引入原型污染属性 */
export function sanitizeImportedObject<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeImportedObject(item)) as unknown as T;
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
        if (FORBIDDEN_IMPORT_KEYS.has(key)) continue;
        result[key] = sanitizeImportedObject((value as Record<string, unknown>)[key]);
    }
    return result as T;
}

/**
 * 按预设分类校验导入 `data` 对象的结构特征，返回结构化 {@link AppValidationError}；合法时返回 `null`。
 */
export function validatePresetPayloadError(
    category: PresetCategory,
    data: Record<string, unknown>
): AppValidationError | null {
    if (category === 'themes') {
        if (typeof data.accent !== 'string' || !data.accent.trim()) {
            return new AppValidationError('主题预设格式错误：缺少有效的 accent 主强调色字段');
        }
        return null;
    }
    if (category === 'prompts') {
        if (
            'workflow' in data ||
            Array.isArray(data.entries) ||
            'parts' in data ||
            'characterRules' in data ||
            'characterTemplate' in data ||
            'charStartTag' in data ||
            ('accent' in data && 'bgPrimary' in data)
        ) {
            return new AppValidationError(
                '导入文件属于其他类别预设，与当前「提示词预设」不兼容'
            );
        }
        if (data.loras !== undefined && !Array.isArray(data.loras)) {
            return new AppValidationError('提示词预设格式错误：loras 字段必须为数组');
        }
        return null;
    }
    if (category === 'characters' || category === 'outfits') {
        if (
            'workflow' in data ||
            Array.isArray(data.entries) ||
            'characterRules' in data ||
            'characterTemplate' in data ||
            'charStartTag' in data ||
            ('accent' in data && 'bgPrimary' in data) ||
            (data.parts !== undefined && !isPlainRecord(data.parts))
        ) {
            return new AppValidationError(
                `导入文件与当前「${category === 'characters' ? '角色' : '服装'}档案」预设格式不兼容`
            );
        }
        return null;
    }
    if (category === 'material_activations') {
        if (
            (data.characterRules !== undefined && !isPlainRecord(data.characterRules)) ||
            (data.outfitRules !== undefined && !isPlainRecord(data.outfitRules)) ||
            (!('characterRules' in data) && !('outfitRules' in data))
        ) {
            return new AppValidationError(
                '素材启用预设格式错误：缺少有效的 characterRules / outfitRules 规则字典'
            );
        }
        return null;
    }
    if (category === 'material_extractions') {
        if (
            !('charStartTag' in data) &&
            !('outfitStartTag' in data) &&
            !('enabled' in data)
        ) {
            return new AppValidationError('解析设置预设格式错误：未包含有效的档案提取规则字段');
        }
        return null;
    }
    if (category === 'material_formats') {
        if (!('characterTemplate' in data) && !('outfitTemplate' in data)) {
            return new AppValidationError('变量与宏预设格式错误：缺少有效的渲染模板字段');
        }
        return null;
    }
    if (category === 'drawing') {
        if (
            'workflow' in data ||
            Array.isArray(data.entries) ||
            'parts' in data ||
            'characterRules' in data ||
            'characterTemplate' in data ||
            'charStartTag' in data ||
            ('accent' in data && 'bgPrimary' in data)
        ) {
            return new AppValidationError(
                '导入文件属于其他类别预设，与当前「生图参数预设」不兼容'
            );
        }
    }
    return null;
}

/**
 * 按预设分类校验导入 `data` 对象的结构特征，返回错误提示文案或 `null`。
 */
export function validatePresetPayloadForCategory(
    category: PresetCategory,
    data: Record<string, unknown>
): string | null {
    return validatePresetPayloadError(category, data)?.userMessage ?? null;
}
