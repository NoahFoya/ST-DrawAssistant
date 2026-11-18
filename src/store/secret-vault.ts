/**
 * 本地私密凭据隔离存储与脱敏工具 (SecretVault)。
 *
 * @remarks
 * 负责将 API Key / Secret / Token / Password 等敏感凭据与宿主配置隔离：
 * 1. 导出或同步给宿主前递归置空敏感字段，防止密钥随配置备份泄露；
 * 2. 将敏感字段按服务商键路径独立持久化至浏览器 `localStorage`；
 * 3. 导入或初始化时按路径恢复本地凭据，并保留空字段对应的既有密钥。
 */

import { logger } from '../util/logger';

/** 浏览器本地隔离存储键名 */
export const LOCAL_SECRETS_KEY = 'st_da_local_secrets';

/** 敏感凭据字段名匹配规则 */
export const SECRET_FIELD_PATTERN = /^(?:apiKey|secret|token|password)$/i;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainRecord(item: unknown): item is Record<string, unknown> {
    return Boolean(item) && typeof item === 'object' && !Array.isArray(item);
}

function resolveBrowserStorage(): Storage | undefined {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage;
        }
        if (typeof localStorage !== 'undefined') {
            return localStorage;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

/**
 * 递归复制对象，并将命中敏感字段名的字符串值置空。
 *
 * 提供方配置中存在嵌套结构（如按服务商暂存的 serviceProfiles.*.apiKey），
 * 仅处理第一层会使嵌套密钥随宿主配置或导出文件泄露。
 */
export function stripSecretsDeep<T>(value: T, pattern: RegExp = SECRET_FIELD_PATTERN): T {
    if (Array.isArray(value)) {
        return value.map((item) => stripSecretsDeep(item, pattern)) as unknown as T;
    }
    if (!isPlainRecord(value)) {
        return value;
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        result[key] =
            pattern.test(key) && typeof val === 'string' ? '' : stripSecretsDeep(val, pattern);
    }
    return result as T;
}

/** 递归提取对象中非空的敏感字段，保持原有嵌套路径；无敏感值时返回 undefined */
export function collectSecretsDeep(
    value: unknown,
    pattern: RegExp = SECRET_FIELD_PATTERN
): Record<string, unknown> | undefined {
    if (!isPlainRecord(value)) {
        return undefined;
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        if (pattern.test(key) && typeof val === 'string') {
            if (val.trim()) result[key] = val;
        } else {
            const nested = collectSecretsDeep(val, pattern);
            if (nested) result[key] = nested;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

/** 将 collectSecretsDeep 产出的敏感字段按路径递归写回目标对象，目标缺少中间节点时跳过 */
export function restoreSecretsDeep(
    target: Record<string, unknown>,
    secrets: Record<string, unknown>
): void {
    for (const [key, val] of Object.entries(secrets)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        if (isPlainRecord(val)) {
            const node = target[key];
            if (isPlainRecord(node)) {
                restoreSecretsDeep(node, val);
            }
        } else {
            target[key] = val;
        }
    }
}

/** 导入配置时，对传入对象中被置空的敏感字段递归保留本地已有的有效值 */
export function preserveBlankSecretsDeep(
    incoming: Record<string, unknown>,
    local: Record<string, unknown>,
    pattern: RegExp = SECRET_FIELD_PATTERN
): void {
    for (const [key, val] of Object.entries(incoming)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        if (pattern.test(key)) {
            if (val === '' && typeof local[key] === 'string' && local[key]) {
                incoming[key] = local[key];
            }
        } else if (isPlainRecord(val) && isPlainRecord(local[key])) {
            preserveBlankSecretsDeep(val, local[key] as Record<string, unknown>, pattern);
        }
    }
}

/** 从浏览器本地隔离存储载入敏感凭据并写回 providers 配置对象 */
export function restoreProviderSecretsFromStorage(
    providers: unknown,
    storageKey = LOCAL_SECRETS_KEY
): void {
    if (!isPlainRecord(providers)) return;
    try {
        const storage = resolveBrowserStorage();
        if (!storage) return;
        const raw = storage.getItem(storageKey);
        if (!raw) return;
        const secrets = JSON.parse(raw) as Record<string, Record<string, unknown>>;
        if (secrets && typeof secrets === 'object') {
            for (const [pKey, secObj] of Object.entries(secrets)) {
                if (FORBIDDEN_KEYS.has(pKey)) continue;
                if (isPlainRecord(secObj)) {
                    const provider = providers[pKey];
                    if (isPlainRecord(provider)) {
                        restoreSecretsDeep(provider, secObj);
                    }
                }
            }
        }
    } catch (err) {
        logger.warn('从本地隔离存储载入私密凭据异常:', err);
    }
}

/** 将 providers 配置中的非空敏感凭据提取并持久化至浏览器本地隔离存储 */
export function persistProviderSecretsToStorage(
    providers: unknown,
    storageKey = LOCAL_SECRETS_KEY
): void {
    if (!isPlainRecord(providers)) return;
    try {
        const storage = resolveBrowserStorage();
        if (!storage) return;
        const secrets: Record<string, Record<string, unknown>> = {};
        for (const [pKey, pCfg] of Object.entries(providers)) {
            if (FORBIDDEN_KEYS.has(pKey)) continue;
            const collected = collectSecretsDeep(pCfg, SECRET_FIELD_PATTERN);
            if (collected) secrets[pKey] = collected;
        }
        storage.setItem(storageKey, JSON.stringify(secrets));
    } catch (err) {
        logger.warn('持久化私密凭据至本地隔离存储异常:', err);
    }
}
