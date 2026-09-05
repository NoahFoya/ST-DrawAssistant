/**
 * @module server/server-config
 * @description 服务端配置文件加载与管理
 */

import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export interface ServerApiKeys {
    novelai?: string;
    openai?: string;
    gemini?: string;
    grok?: string;
}

export interface ServerEndpoints {
    novelai?: string;
    openai?: string;
    gemini?: string;
    grok?: string;
}

export interface ServerOptions {
    proxyTimeoutMs: number;
    maxPayloadSizeMb: number;
    enableProxyLog: boolean;
    allowedHosts: string[];
}

export interface ServerConfig {
    apiKeys: ServerApiKeys;
    endpoints: ServerEndpoints;
    serverOptions: ServerOptions;
}

export const DEFAULT_SERVER_OPTIONS: ServerOptions = {
    proxyTimeoutMs: 180000,
    maxPayloadSizeMb: 50,
    enableProxyLog: false,
    allowedHosts: []
};

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
    apiKeys: {
        novelai: '',
        openai: '',
        gemini: '',
        grok: ''
    },
    endpoints: {
        novelai: '',
        openai: '',
        gemini: '',
        grok: ''
    },
    serverOptions: { ...DEFAULT_SERVER_OPTIONS }
};

let _cachedConfig: ServerConfig | null = null;

/**
 * 获取服务端配置文件的绝对路径
 * 以 config/config.yaml (或 config.yml) 为准
 */
export function resolveConfigFilePath(): string {
    const searchDirs = [
        path.resolve(__dirname, '..', 'config'),
        path.resolve(process.cwd(), 'config')
    ];

    const fileNames = ['config.yaml', 'config.yml'];

    for (const dir of searchDirs) {
        for (const name of fileNames) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }

    // 默认创建/读取路径
    return path.resolve(__dirname, '..', 'config', 'config.yaml');
}

/**
 * 校验并规范化标准 YAML 配置对象
 */
function normalizeServerConfig(raw: any): ServerConfig {
    if (!raw || typeof raw !== 'object') {
        throw new Error('配置文件根节点必须为对象');
    }

    const rawKeys = raw.api_keys || {};
    const rawEndpoints = raw.endpoints || {};
    const rawServer = raw.server || {};

    const apiKeys: ServerApiKeys = {
        novelai: typeof rawKeys.novelai === 'string' ? rawKeys.novelai.trim() : '',
        openai: typeof rawKeys.openai === 'string' ? rawKeys.openai.trim() : '',
        gemini: typeof rawKeys.gemini === 'string' ? rawKeys.gemini.trim() : '',
        grok: typeof rawKeys.grok === 'string' ? rawKeys.grok.trim() : ''
    };

    const endpoints: ServerEndpoints = {
        novelai: typeof rawEndpoints.novelai === 'string' ? rawEndpoints.novelai.trim() : '',
        openai: typeof rawEndpoints.openai === 'string' ? rawEndpoints.openai.trim() : '',
        gemini: typeof rawEndpoints.gemini === 'string' ? rawEndpoints.gemini.trim() : '',
        grok: typeof rawEndpoints.grok === 'string' ? rawEndpoints.grok.trim() : ''
    };

    const serverOptions: ServerOptions = {
        proxyTimeoutMs: typeof rawServer.proxy_timeout_ms === 'number'
            ? rawServer.proxy_timeout_ms
            : DEFAULT_SERVER_OPTIONS.proxyTimeoutMs,
        maxPayloadSizeMb: typeof rawServer.max_payload_size_mb === 'number'
            ? rawServer.max_payload_size_mb
            : DEFAULT_SERVER_OPTIONS.maxPayloadSizeMb,
        enableProxyLog: typeof rawServer.enable_proxy_log === 'boolean'
            ? rawServer.enable_proxy_log
            : DEFAULT_SERVER_OPTIONS.enableProxyLog,
        allowedHosts: Array.isArray(rawServer.allowed_hosts)
            ? rawServer.allowed_hosts
            : DEFAULT_SERVER_OPTIONS.allowedHosts
    };

    return { apiKeys, endpoints, serverOptions };
}

/**
 * 应用环境变量覆盖
 * 支持直接从宿主或容器环境变量读取敏感 API Key 与端点，便于无文件部署与免重启调试
 */
function applyEnvironmentOverrides(config: ServerConfig): ServerConfig {
    const env = process.env;

    if (env.ST_DRAW_NOVELAI_API_KEY) config.apiKeys.novelai = env.ST_DRAW_NOVELAI_API_KEY.trim();
    if (env.ST_DRAW_OPENAI_API_KEY) config.apiKeys.openai = env.ST_DRAW_OPENAI_API_KEY.trim();
    if (env.ST_DRAW_GEMINI_API_KEY) config.apiKeys.gemini = env.ST_DRAW_GEMINI_API_KEY.trim();
    if (env.ST_DRAW_GROK_API_KEY) config.apiKeys.grok = env.ST_DRAW_GROK_API_KEY.trim();

    if (env.ST_DRAW_NOVELAI_ENDPOINT) config.endpoints.novelai = env.ST_DRAW_NOVELAI_ENDPOINT.trim();
    if (env.ST_DRAW_OPENAI_ENDPOINT) config.endpoints.openai = env.ST_DRAW_OPENAI_ENDPOINT.trim();

    if (env.ST_DRAW_ALLOWED_HOSTS) {
        config.serverOptions.allowedHosts = env.ST_DRAW_ALLOWED_HOSTS.split(',').map(s => s.trim()).filter(Boolean);
    }

    return config;
}

/**
 * 读取并解析本地配置文件
 * 遇到文件内容语法错误时直接抛出异常，不静默吞错
 *
 * @param customPath 自定义配置文件路径 (主要用于单元测试注入)
 */
export function loadServerConfig(customPath?: string): ServerConfig {
    const filePath = customPath || resolveConfigFilePath();

    if (!fs.existsSync(filePath)) {
        const baseConfig: ServerConfig = JSON.parse(JSON.stringify(DEFAULT_SERVER_CONFIG));
        _cachedConfig = applyEnvironmentOverrides(baseConfig);
        return _cachedConfig;
    }

    try {
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const parsed = YAML.parse(rawContent);
        const normalized = normalizeServerConfig(parsed);
        _cachedConfig = applyEnvironmentOverrides(normalized);
        return _cachedConfig;
    } catch (err: any) {
        console.error(`[ST-DrawAssistant][ServerConfig] 解析服务端配置文件失败 [${filePath}]:`, err.message || err);
        throw new Error(`服务端配置文件解析失败 [${path.basename(filePath)}]: ${err.message || String(err)}`);
    }
}

/**
 * 获取已缓存的服务端配置 (若未加载则自动加载)
 */
export function getServerConfig(): ServerConfig {
    if (!_cachedConfig) {
        return loadServerConfig();
    }
    return _cachedConfig;
}

/**
 * 保存并更新服务端本地配置文件 (写回标准 YAML 格式)
 *
 * @param updates 需要增量更新的配置项
 * @param customPath 自定义文件路径
 */
export function saveServerConfig(
    updates: {
        apiKeys?: Partial<ServerApiKeys>;
        endpoints?: Partial<ServerEndpoints>;
        serverOptions?: Partial<ServerOptions>;
    },
    customPath?: string
): ServerConfig {
    const current = getServerConfig();

    const merged: ServerConfig = {
        apiKeys: {
            ...current.apiKeys,
            ...updates.apiKeys
        },
        endpoints: {
            ...current.endpoints,
            ...updates.endpoints
        },
        serverOptions: {
            ...current.serverOptions,
            ...updates.serverOptions
        }
    };

    const filePath = customPath || resolveConfigFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // 格式化为整洁的 YAML 输出结构
    const yamlDoc = {
        api_keys: merged.apiKeys,
        endpoints: merged.endpoints,
        server: {
            proxy_timeout_ms: merged.serverOptions.proxyTimeoutMs,
            max_payload_size_mb: merged.serverOptions.maxPayloadSizeMb,
            enable_proxy_log: merged.serverOptions.enableProxyLog,
            allowed_hosts: merged.serverOptions.allowedHosts
        }
    };

    const serialized = YAML.stringify(yamlDoc, { indent: 2 });
    fs.writeFileSync(filePath, serialized, 'utf-8');

    _cachedConfig = merged;
    return _cachedConfig;
}

/**
 * 获取当前各生图服务的密钥配置状态 (仅返回布尔值，用于前端状态感知)
 */
export function getConfiguredKeyStatus(): Record<string, boolean> {
    const config = getServerConfig();
    return {
        novelai: Boolean(config.apiKeys.novelai),
        openai: Boolean(config.apiKeys.openai),
        gemini: Boolean(config.apiKeys.gemini),
        grok: Boolean(config.apiKeys.grok)
    };
}

/**
 * 重置配置缓存 (主要用于单元测试隔离)
 */
export function resetServerConfigCache(): void {
    _cachedConfig = null;
}
