/**
 * 浏览器本地持久化存储端口 (`storage-port.ts`)。
 *
 * @remarks
 * 统一管理全仓库对 `localStorage` 的访问，提供空安全、隐私模式异常容错处理及 JSON 读写封装。
 */

export interface StoragePort {
    getItem(key: string): string | null;
    setItem(key: string, value: string): boolean;
    removeItem(key: string): boolean;
    getJson<T>(key: string): T | null;
    setJson(key: string, value: unknown): boolean;
}

function resolveNativeLocalStorage(): Storage | undefined {
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

/** 浏览器 localStorage 安全适配器单例 */
export const browserStorage: StoragePort = {
    getItem(key: string): string | null {
        try {
            return resolveNativeLocalStorage()?.getItem(key) ?? null;
        } catch {
            return null;
        }
    },

    setItem(key: string, value: string): boolean {
        try {
            const storage = resolveNativeLocalStorage();
            if (!storage) return false;
            storage.setItem(key, value);
            return true;
        } catch {
            return false;
        }
    },

    removeItem(key: string): boolean {
        try {
            const storage = resolveNativeLocalStorage();
            if (!storage) return false;
            storage.removeItem(key);
            return true;
        } catch {
            return false;
        }
    },

    getJson<T>(key: string): T | null {
        const raw = this.getItem(key);
        if (!raw) return null;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return null;
        }
    },

    setJson(key: string, value: unknown): boolean {
        try {
            return this.setItem(key, JSON.stringify(value));
        } catch {
            return false;
        }
    },
};
