/**
 * Google Gemini 原生绘图服务提供方私有配置模型。
 */

import type { CommonServiceProfile, ProviderAssetCache } from '../provider';

/** Google Gemini 原生绘图服务提供方私有配置 */
export interface GeminiProviderConfig {
    /** 服务端基础接口地址（默认官方 https://generativelanguage.googleapis.com/v1beta） */
    readonly serverUrl: string;
    /** 访问认证密钥 (x-goog-api-key) */
    readonly apiKey: string;
    /** 选用的具体上游服务商标识 */
    readonly serviceId?: string;
    /** 当前激活的生图参数预设标识符 */
    readonly activeDrawingPresetId?: string;
    /** 当前生效的服务端模型列表缓存 */
    readonly assetCache?: ProviderAssetCache;
    /** 各服务商切换时暂存的连接信息与模型缓存映射字典 */
    readonly serviceProfiles?: Record<string, CommonServiceProfile>;
}
