/**
 * @module server/server-config
 * @description 服务端本地私密配置文件加载与访问模块
 */

import fs from 'fs';
import path from 'path';

export interface ServerApiKeys {
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

export interface ServerConfigFile {
    version?: string;
    description?: string;
    apiKeys?: ServerApiKeys;
    serverOptions?: Partial<ServerOptions>;
}

export interface ServerConfig {
    apiKeys: ServerApiKeys;
    serverOptions: ServerOptions;
}

export const DEFAULT_SERVER_OPTIONS: ServerOptions = {
    proxyTimeoutMs: 180000,
    maxPayloadSizeMb: 50,
    enableProxyLog: false,
    allowedHosts: ['*'] // 默认放行所有合法生图端点 (包含局域网、DDNS、云端与第三方中转站)，用户可按需在 config.json 中收紧白名单
};

let _cachedConfig: ServerConfig | null = null;

/**
 * 确定 config/config.json 的物理绝对路径
 */
export function resolveConfigFilePath(): string {
    // 优先读取插件自身目录下的配置文件
    const pluginConfig = path.resolve(__dirname, '..', 'config', 'config.json');
    if (fs.existsSync(pluginConfig)) {
        return pluginConfig;
    }
    // 调试与独立运行环境下尝试当前工作目录
    const cwdConfig = path.resolve(process.cwd(), 'config', 'config.json');
    if (fs.existsSync(cwdConfig)) {
        return cwdConfig;
    }
    return pluginConfig;
}

/**
 * 读取并解析本地配置文件
 * @param customPath 自定义配置文件路径 (主要用于单元测试注入)
 */
export function loadServerConfig(customPath?: string): ServerConfig {
    const filePath = customPath || resolveConfigFilePath();

    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw) as ServerConfigFile;

            _cachedConfig = {
                apiKeys: {
                    novelai: (parsed.apiKeys?.novelai || '').trim(),
                    openai: (parsed.apiKeys?.openai || '').trim(),
                    gemini: (parsed.apiKeys?.gemini || '').trim(),
                    grok: (parsed.apiKeys?.grok || '').trim()
                },
                serverOptions: {
                    proxyTimeoutMs: parsed.serverOptions?.proxyTimeoutMs ?? DEFAULT_SERVER_OPTIONS.proxyTimeoutMs,
                    maxPayloadSizeMb: parsed.serverOptions?.maxPayloadSizeMb ?? DEFAULT_SERVER_OPTIONS.maxPayloadSizeMb,
                    enableProxyLog: parsed.serverOptions?.enableProxyLog ?? DEFAULT_SERVER_OPTIONS.enableProxyLog,
                    allowedHosts: Array.isArray(parsed.serverOptions?.allowedHosts)
                        ? parsed.serverOptions.allowedHosts
                        : DEFAULT_SERVER_OPTIONS.allowedHosts
                }
            };
            return _cachedConfig;
        }
    } catch (err) {
        console.warn(`[ST-DrawAssistant][ServerConfig] 读取本地配置文件失败 [${filePath}]，将使用默认配置。原因:`, err);
    }

    _cachedConfig = {
        apiKeys: {},
        serverOptions: { ...DEFAULT_SERVER_OPTIONS }
    };
    return _cachedConfig;
}

/**
 * 获取当前已缓存的服务端配置 (若未加载则自动加载)
 */
export function getServerConfig(): ServerConfig {
    if (!_cachedConfig) {
        return loadServerConfig();
    }
    return _cachedConfig;
}

/**
 * 获取各服务端密钥的配置就绪状态 (返回布尔值字典，用于前端状态感知)
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
 * 重置配置缓存 (用于测试或配置重载)
 */
export function resetServerConfigCache(): void {
    _cachedConfig = null;
}
