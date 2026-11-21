/**
 * 云端图像服务 Provider 共用工具函数。
 */

import type { DrawingPresetData } from '@types';
import { HttpError } from '../util/http-client';
import { logger } from '../util/logger';

/**
 * 计算 API Key 的 FNV-1a 短指纹，用于在内存缓存键中区分不同凭据而不保存明文。
 */
export function hashKeyFingerprint(apiKey?: string): string {
    if (!apiKey) return 'anon';
    let hash = 2166136261;
    for (let i = 0; i < apiKey.length; i++) {
        hash ^= apiKey.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `${apiKey.length}:${(hash >>> 0).toString(16)}`;
}

/**
 * 从 HttpError 提取可读的上游错误信息。
 */
export function extractHttpErrorMessage(err: HttpError): string {
    let errorDetail = `HTTP ${err.status}`;
    const details = err.details;
    if (details && typeof details === 'object') {
        const record = details as Record<string, unknown>;
        const nestedError =
            typeof record.error === 'object' && record.error !== null
                ? (record.error as Record<string, unknown>)
                : undefined;
        const errorMsg =
            typeof record.error === 'string' ? record.error : nestedError?.message;
        if (typeof errorMsg === 'string' && errorMsg.trim()) {
            errorDetail = errorMsg.trim();
        } else if (typeof record.message === 'string' && record.message.trim()) {
            errorDetail = record.message.trim();
        } else if (typeof record.detail === 'string' && record.detail.trim()) {
            errorDetail = record.detail.trim();
        }
    } else if (typeof details === 'string' && details.trim()) {
        errorDetail = details.trim();
    }
    return errorDetail;
}

/**
 * 安全解析自定义 JSON 请求体扩展字符串，仅接受非数组对象。
 */
export function parseCustomBodyObject(
    rawJson: unknown,
    logPrefix: string
): Record<string, unknown> | undefined {
    if (typeof rawJson !== 'string' || !rawJson.trim()) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(rawJson.trim());
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch (err) {
        logger.warn(`${logPrefix} 自定义请求体 JSON 解析失败，跳过附加参数:`, err);
    }
    return undefined;
}

/**
 * 解析云端生图服务最终使用的模型 ID。
 * 优先级：parameters.model > parameters.customModel > preset.customModel > preset.baseModel > fallback。
 */
export function resolveCloudModelId(
    parameters?: Record<string, unknown>,
    preset?: DrawingPresetData,
    fallback = ''
): string {
    const readTrimmed = (val: unknown): string =>
        typeof val === 'string' ? val.trim() : '';

    return (
        readTrimmed(parameters?.model) ||
        readTrimmed(parameters?.customModel) ||
        readTrimmed(preset?.customModel) ||
        readTrimmed(preset?.baseModel) ||
        fallback
    );
}
