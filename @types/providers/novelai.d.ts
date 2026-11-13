/**
 * NovelAI 绘图服务提供方私有配置模型。
 *
 * @remarks
 * 包含 NovelAI 官方云端与第三方兼容端点的专有连接、API 密钥与绘图预设配置。
 */

import type { ProviderAssetCache } from '../provider';

/** NovelAI 服务商标识：官方服务或用户自填地址的第三方端点 */
export type NovelAIServiceId = 'novelai-official' | 'custom';

/** 单个服务商独立保存的连接信息与模型缓存 */
export interface NovelAIServiceProfile {
    /** 服务端基础接口地址 */
    readonly serverUrl?: string;
    /** 访问认证密钥 */
    readonly apiKey?: string;
    /** 该服务商最近一次拉取的模型资产缓存 */
    readonly assetCache?: ProviderAssetCache;
}

/** NovelAI 绘图服务提供方私有配置 */
export interface NovelAIProviderConfig {
    /** 当前服务商生效的基础接口地址（官方服务商时恒为官方地址） */
    readonly serverUrl: string;
    /** 当前服务商生效的访问认证密钥 */
    readonly apiKey: string;
    /** 当前选用的服务商标识 */
    readonly serviceId?: NovelAIServiceId;
    /** 当前服务商生效的模型资产缓存 */
    readonly assetCache?: ProviderAssetCache;
    /** 各服务商切换时暂存的连接信息与模型缓存 */
    readonly serviceProfiles?: Partial<Record<NovelAIServiceId, NovelAIServiceProfile>>;
    /** 当前激活的绘图预设标识符 */
    readonly activeDrawingPresetId?: string;
}
