/**
 * SillyTavern 扩展管理服务端 HTTP 接口适配层 (`host-extension-api.ts`)。
 *
 * @remarks
 * 封装 `/api/extensions/discover`、`/api/extensions/version` 与 `/api/extensions/update`
 * 的请求构造、目标查找与响应解包逻辑。
 */

import { getHostRequestHeaders } from './host-context';

export interface HostExtensionTarget {
    readonly extensionName: string;
    readonly global: boolean;
}

export const DEFAULT_HOST_EXTENSION_TARGETS: ReadonlyArray<HostExtensionTarget> = [
    { extensionName: 'third-party/ST-DrawAssistant', global: false },
    { extensionName: 'ST-DrawAssistant', global: false },
    { extensionName: 'third-party/ST-DrawAssistant', global: true },
    { extensionName: 'ST-DrawAssistant', global: true },
];

export interface HostExtensionVersionResponse {
    readonly currentCommitHash?: string;
    readonly currentBranchName?: string;
    readonly isUpToDate?: boolean;
    readonly remoteUrl?: string;
}

export interface HostExtensionUpdateResponse {
    readonly currentCommitHash?: string;
}

/** 提取宿主接口返回的错误信息文本 */
export async function extractHostApiError(resp: Response): Promise<string> {
    const text = await resp.text().catch(() => '');
    if (text) {
        try {
            const json = JSON.parse(text) as { error?: unknown; message?: unknown };
            if (typeof json.error === 'string' && json.error.trim()) {
                return json.error.trim();
            }
            if (typeof json.message === 'string' && json.message.trim()) {
                return json.message.trim();
            }
        } catch {
            return text.slice(0, 200).trim();
        }
    }
    return `HTTP ${resp.status}`;
}

/** 从宿主 `/api/extensions/discover` 发现插件实际目录名与安装作用域 */
export async function discoverHostExtensionTargets(
    cachedTarget?: HostExtensionTarget | null,
    signal?: AbortSignal
): Promise<HostExtensionTarget[]> {
    const dedupeTargets = (list: ReadonlyArray<HostExtensionTarget>): HostExtensionTarget[] => {
        const seen = new Set<string>();
        const result: HostExtensionTarget[] = [];
        for (const item of list) {
            const key = `${item.global ? 'g' : 'l'}:${item.extensionName}`;
            if (!seen.has(key)) {
                seen.add(key);
                result.push(item);
            }
        }
        return result;
    };

    if (cachedTarget) {
        return dedupeTargets([cachedTarget, ...DEFAULT_HOST_EXTENSION_TARGETS]);
    }

    const discovered: HostExtensionTarget[] = [];
    try {
        const resp = await fetch('/api/extensions/discover', {
            method: 'GET',
            headers: getHostRequestHeaders(),
            signal,
        });
        if (resp.ok) {
            const list = (await resp.json()) as unknown;
            if (Array.isArray(list)) {
                for (const entry of list) {
                    const rec = entry as { name?: unknown; type?: unknown };
                    const name = typeof rec?.name === 'string' ? rec.name.trim() : '';
                    if (
                        name &&
                        (name === 'ST-DrawAssistant' || name.endsWith('/ST-DrawAssistant'))
                    ) {
                        discovered.push({
                            extensionName: name,
                            global: rec.type === 'global',
                        });
                    }
                }
            }
        }
    } catch {
        // 宿主未提供 discover 接口或请求失败时回退默认候选清单
    }

    return dedupeTargets([...discovered, ...DEFAULT_HOST_EXTENSION_TARGETS]);
}

/** 调用 `/api/extensions/version` 查询宿主本地扩展 Git 状态 */
export async function postHostExtensionVersion(
    target: HostExtensionTarget,
    signal?: AbortSignal
): Promise<Response> {
    return fetch('/api/extensions/version', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getHostRequestHeaders(),
        },
        body: JSON.stringify(target),
        signal,
    });
}

/** 调用 `/api/extensions/update` 触发宿主服务端执行扩展拉取更新 */
export async function postHostExtensionUpdate(
    target: HostExtensionTarget,
    signal?: AbortSignal
): Promise<Response> {
    return fetch('/api/extensions/update', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getHostRequestHeaders(),
        },
        body: JSON.stringify(target),
        signal,
    });
}
