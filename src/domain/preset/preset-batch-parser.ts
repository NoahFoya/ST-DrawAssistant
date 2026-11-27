/**
 * 预设批量导入/导出纯解析与重名消歧模块。
 *
 * @remarks
 * 统一封装预设 JSON 的多格式嗅探（单预设 / 合集包 / 预设数组）、
 * 批量导出结构封装与非阻塞式重名消歧，校验异常统一抛出 {@link AppValidationError}。
 */

import type { PresetCategory, PresetItem, ProviderType } from '@types';
import { AppValidationError } from '../errors';
import {
    isPlainRecord,
    normalizePresetNameKey,
    sanitizeImportedObject,
    stripJsonExtension,
} from './preset-validation';

/** 批量导出预设合集文件标准结构 */
export interface PresetBundlePayload<TData = unknown> {
    readonly kind: 'st-da-preset-bundle';
    readonly version: 1;
    readonly exportedAt: number;
    readonly category: PresetCategory;
    readonly provider?: ProviderType;
    readonly presets: Array<{
        readonly id?: string;
        readonly name: string;
        readonly data: TData;
        readonly updatedAt?: number;
    }>;
}

/** 从导入文本中解析出的单条预设候选 */
export interface ParsedPresetCandidate {
    readonly name: string;
    readonly data: Record<string, unknown>;
}

/** 批量 JSON 解析结果 */
export interface ParsePresetBatchResult {
    readonly candidates: ParsedPresetCandidate[];
    readonly skippedErrors: AppValidationError[];
}

function extractSingleCandidate(
    entry: unknown,
    fallbackName: string
): ParsedPresetCandidate | null {
    if (!isPlainRecord(entry) || !isPlainRecord(entry.data)) {
        return null;
    }
    const rawName = typeof entry.name === 'string' ? entry.name.trim() : '';
    const sanitized = sanitizeImportedObject(entry.data);
    return {
        name: rawName || fallbackName,
        data: sanitized,
    };
}

/**
 * 解析单文件内的预设 JSON 文本。
 * 支持：
 * 1. 单条预设 `{ name, data }`；
 * 2. 合集格式 `{ presets: [...] }`；
 * 3. 纯数组格式 `[{ name, data }, ...]`。
 */
export function parsePresetBatchJson(
    rawText: string,
    fileName?: string
): ParsePresetBatchResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new AppValidationError('预设文件非有效 JSON 格式', msg);
    }

    const fileBaseName = stripJsonExtension(fileName) || '导入预设';

    // 1. 纯数组或合集对象
    const rawList: unknown[] | null = Array.isArray(parsed)
        ? parsed
        : isPlainRecord(parsed) && Array.isArray(parsed.presets)
          ? parsed.presets
          : null;

    if (rawList) {
        const candidates: ParsedPresetCandidate[] = [];
        const skippedErrors: AppValidationError[] = [];
        rawList.forEach((item, index) => {
            const candidate = extractSingleCandidate(item, `${fileBaseName} (${index + 1})`);
            if (candidate) {
                candidates.push(candidate);
            } else {
                skippedErrors.push(
                    new AppValidationError(`第 ${index + 1} 项缺少有效的 data 配置对象`)
                );
            }
        });
        if (candidates.length === 0 && skippedErrors.length === 0) {
            throw new AppValidationError('预设合集文件为空，不包含任何可导入的预设');
        }
        return { candidates, skippedErrors };
    }

    // 2. 单条预设对象
    const single = extractSingleCandidate(parsed, fileBaseName);
    if (!single) {
        throw new AppValidationError('预设文件格式错误：未包含有效的 data 配置对象或 presets 数组');
    }
    return {
        candidates: [single],
        skippedErrors: [],
    };
}

/**
 * 构建用于批量导出的合集 JSON 负载。
 */
export function buildPresetBundlePayload<TData>(
    category: PresetCategory,
    presets: ReadonlyArray<PresetItem<TData>>,
    provider?: ProviderType
): PresetBundlePayload<TData> {
    return {
        kind: 'st-da-preset-bundle',
        version: 1,
        exportedAt: Date.now(),
        category,
        ...(provider ? { provider } : {}),
        presets: presets.map((p) => ({
            id: p.id,
            name: p.name,
            data: structuredClone(p.data),
            updatedAt: p.updatedAt,
        })),
    };
}

/**
 * 为批量导入条目生成不与现有预设重名的唯一名称（非阻塞自动追加序号后缀）。
 */
export function resolveBatchUniquePresetName(
    baseName: string,
    existingNameKeys: Set<string>,
    fallbackName: string
): string {
    const trimmed = baseName.trim() || fallbackName.trim() || '导入预设';
    const baseKey = normalizePresetNameKey(trimmed);
    if (!existingNameKeys.has(baseKey)) {
        existingNameKeys.add(baseKey);
        return trimmed;
    }

    let suffix = 2;
    while (suffix < 10000) {
        const candidate = `${trimmed} (${suffix})`;
        const key = normalizePresetNameKey(candidate);
        if (!existingNameKeys.has(key)) {
            existingNameKeys.add(key);
            return candidate;
        }
        suffix += 1;
    }

    const fallback = `${trimmed} (${Date.now()})`;
    existingNameKeys.add(normalizePresetNameKey(fallback));
    return fallback;
}

/**
 * 格式化批量导入结果汇总文案。
 */
export function formatBatchImportSummary(
    importedCount: number,
    failedCount: number,
    firstError?: string
): string {
    if (importedCount > 0 && failedCount === 0) {
        return `批量导入完成：成功导入 ${importedCount} 项预设`;
    }
    if (importedCount > 0 && failedCount > 0) {
        return `导入完成：成功 ${importedCount} 项，跳过/失败 ${failedCount} 项`;
    }
    return firstError ? `导入失败: ${firstError}` : '导入失败：未找到有效的预设配置';
}
