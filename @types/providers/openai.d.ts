/**
 * OpenAI 兼容绘图服务提供方私有配置模型。
 *
 * @remarks
 * 包含兼容 OpenAI `/v1/images/generations` 规范的第三方云端与自建服务的专有配置。
 */

import type { CommonServiceProfile, ProviderAssetCache } from '../provider';

/** OpenAI 兼容绘图服务提供方私有配置 */
export interface OpenAIProviderConfig {
    /** 服务端基础接口地址 */
    readonly serverUrl: string;
    /** 访问认证密钥 */
    readonly apiKey: string;
    /** 选用的具体上游服务商标识 */
    readonly serviceId?: string;
    /** 当前激活的绘图预设标识符 */
    readonly activeDrawingPresetId?: string;
    /** 当前生效的服务端模型列表缓存 */
    readonly assetCache?: ProviderAssetCache;
    /** 各服务商切换时暂存的连接信息与模型缓存映射字典 */
    readonly serviceProfiles?: Record<string, CommonServiceProfile>;
}
