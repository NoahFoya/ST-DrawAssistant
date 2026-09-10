/**
 * 语义版本工具函数
 * 提供轻量、精准的版本号比较能力，不引入冗余外部依赖
 */

import { EXTENSION_NAME } from '../constants';

/**
 * 比较远端版本与本地版本
 * @param remote 远端版本号字符串（例如 'v0.2.0', '0.2.0'）
 * @param local 本地版本号字符串（例如 'v0.1.0', '0.1.0'）
 * @returns 1: 远端版本较新（有可用更新）; 0: 两者版本一致（已是最新）; -1: 本地版本较新（开发测试版本）
 */
export function compareVersions(remote: string, local: string): number {
    const parse = (v: string): number[] =>
        v.replace(/^v/i, '')
            .trim()
            .split('.')
            .map((part) => parseInt(part, 10) || 0);

    const rParts = parse(remote);
    const lParts = parse(local);
    const maxLen = Math.max(rParts.length, lParts.length, 3);

    for (let i = 0; i < maxLen; i++) {
        const r = rParts[i] ?? 0;
        const l = lParts[i] ?? 0;
        if (r > l) return 1;
        if (r < l) return -1;
    }
    return 0;
}

/**
 * 触发 SillyTavern 宿主原生端点拉取最新 Git 代码更新扩展
 * @param extensionName 扩展标识名称，默认为 EXTENSION_NAME ('ST-DrawAssistant')
 * @returns 服务端 Fetch Response
 */
export async function pullExtensionUpdate(extensionName: string = EXTENSION_NAME): Promise<Response> {
    let headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };

    // 1. 优先提取 SillyTavern 上下文封装的 CSRF 认证头；若不在正常酒馆生命周期则尝试获取 /csrf-token
    const stContext = typeof window !== 'undefined' ? (window as any).SillyTavern?.getContext?.() : undefined;
    if (typeof stContext?.getRequestHeaders === 'function') {
        headers = { ...headers, ...stContext.getRequestHeaders() };
    } else {
        try {
            const tokenRes = await fetch('/csrf-token');
            if (tokenRes.ok) {
                const data = await tokenRes.json();
                if (data?.token) {
                    headers['X-CSRF-Token'] = data.token;
                }
            }
        } catch {
            // 忽略独立测试或离线状态下的探测异常
        }
    }

    // 2. 匹配当前扩展是安装在全局扩展目录 (global) 还是用户独立目录 (local)
    const extTypes = typeof window !== 'undefined' ? (window as any).extensionTypes || {} : {};
    const matchedId = Object.keys(extTypes).find(
        (id) => id === extensionName || (id.startsWith('third-party') && id.endsWith(extensionName))
    );
    const isGlobal = (matchedId ? extTypes[matchedId] : 'local') === 'global';

    // 3. 提交酒馆原生更新任务，设置 60 秒网络拉取超时防御
    return fetch('/api/extensions/update', {
        method: 'POST',
        headers,
        body: JSON.stringify({ extensionName, global: isGlobal }),
        signal: AbortSignal.timeout(60000)
    });
}

