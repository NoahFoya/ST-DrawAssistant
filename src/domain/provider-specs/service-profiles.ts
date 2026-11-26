/**
 * 生图服务商档位配置与切换纯规则目录 (`service-profiles.ts`)。
 *
 * @remarks
 * 作为 OpenAI 兼容、NovelAI、Google Gemini 与 xAI Grok 服务商预设列表及
 * `serviceProfiles` 切换补丁的单一数据源，供设置选项卡视图与悬浮球快捷面板共同消费。
 */

import type {
    ImageStorageQuality,
    ProviderAssetCache,
    ProviderStoredConfig,
    ProviderType,
} from '@types';
import {
    NOVELAI_CUSTOM_SERVICE_ID,
    NOVELAI_IMAGE_HOST,
    NOVELAI_OFFICIAL_SERVICE_ID,
} from './novelai-specs';
import {
    OPENAI_API_BASE,
    OPENAI_CUSTOM_SERVICE_ID,
    OPENAI_OFFICIAL_SERVICE_ID,
    OPENAI_SILICONFLOW_SERVICE_ID,
    SILICONFLOW_API_BASE,
} from './openai-specs';
import {
    GEMINI_API_BASE,
    GEMINI_CUSTOM_SERVICE_ID,
    GEMINI_OFFICIAL_SERVICE_ID,
} from './gemini-specs';
import {
    GROK_API_BASE,
    GROK_CUSTOM_SERVICE_ID,
    GROK_OFFICIAL_SERVICE_ID,
} from './grok-specs';

/** 服务商连接模板项规范 */
export interface ProviderServiceProfileSpec {
    readonly id: string;
    readonly label: string;
    readonly defaultUrl: string;
    /** 地址是否允许用户编辑（默认 true；为 false 时固定使用 defaultUrl） */
    readonly urlEditable?: boolean;
}

/** 单类提供方的服务商档位规则集合 */
export interface ProviderServiceProfileRules {
    readonly defaultServiceId: string;
    readonly presets: readonly ProviderServiceProfileSpec[];
    readonly fixedUrls?: Readonly<Record<string, string>>;
    readonly defaultUrls?: Readonly<Record<string, string>>;
}

/** 调用方可选覆盖的服务商档位切换参数 */
export interface ProviderServiceSwitchOverrides {
    readonly defaultServiceId?: string;
    readonly fixedUrls?: Readonly<Record<string, string>>;
    readonly defaultUrls?: Readonly<Record<string, string>>;
}

/** 服务商档位切换结果 */
export interface ProviderServiceSwitchResult {
    readonly switched: boolean;
    readonly prevServiceId: string;
    readonly nextServiceId: string;
    readonly nextUrl: string;
    readonly nextApiKey: string;
    readonly nextAssetCache: ProviderAssetCache;
    readonly patch: Partial<ProviderStoredConfig>;
}

/** 空资产缓存基准对象（显式将 updatedAt 设为 0 以覆盖前一次同步时间戳） */
export const EMPTY_PROVIDER_ASSET_CACHE: ProviderAssetCache = Object.freeze({
    checkpoints: [],
    unets: [],
    vaes: [],
    clips: [],
    loras: [],
    samplers: [],
    schedulers: [],
    updatedAt: 0,
});

/** 补全资产缓存结构，确保各数组字段存在且缺失时间戳默认归零 */
export function completeProviderAssetCache(cache?: ProviderAssetCache): ProviderAssetCache {
    return {
        checkpoints: cache?.checkpoints ? [...cache.checkpoints] : [],
        unets: cache?.unets ? [...cache.unets] : [],
        vaes: cache?.vaes ? [...cache.vaes] : [],
        clips: cache?.clips ? [...cache.clips] : [],
        loras: cache?.loras ? [...cache.loras] : [],
        samplers: cache?.samplers ? [...cache.samplers] : [],
        schedulers: cache?.schedulers ? [...cache.schedulers] : [],
        updatedAt: cache?.updatedAt ?? 0,
    };
}

/** 具备多服务商档位切换能力的提供方规则表 */
export const PROVIDER_SERVICE_PROFILE_RULES: Readonly<
    Partial<Record<ProviderType, ProviderServiceProfileRules>>
> = Object.freeze({
    novelai: {
        defaultServiceId: NOVELAI_OFFICIAL_SERVICE_ID,
        presets: [
            {
                id: NOVELAI_OFFICIAL_SERVICE_ID,
                label: 'NovelAI 官方',
                defaultUrl: NOVELAI_IMAGE_HOST,
                urlEditable: false,
            },
            {
                id: NOVELAI_CUSTOM_SERVICE_ID,
                label: '自定义服务',
                defaultUrl: '',
                urlEditable: true,
            },
        ],
        fixedUrls: {
            [NOVELAI_OFFICIAL_SERVICE_ID]: NOVELAI_IMAGE_HOST,
        },
    },
    openai: {
        defaultServiceId: OPENAI_OFFICIAL_SERVICE_ID,
        presets: [
            {
                id: OPENAI_OFFICIAL_SERVICE_ID,
                label: 'OpenAI 官方',
                defaultUrl: OPENAI_API_BASE,
            },
            {
                id: OPENAI_SILICONFLOW_SERVICE_ID,
                label: 'SiliconFlow 硅基流动',
                defaultUrl: SILICONFLOW_API_BASE,
            },
            {
                id: OPENAI_CUSTOM_SERVICE_ID,
                label: '自定义服务',
                defaultUrl: '',
            },
        ],
        defaultUrls: {
            [OPENAI_OFFICIAL_SERVICE_ID]: OPENAI_API_BASE,
            [OPENAI_SILICONFLOW_SERVICE_ID]: SILICONFLOW_API_BASE,
        },
    },
    gemini: {
        defaultServiceId: GEMINI_OFFICIAL_SERVICE_ID,
        presets: [
            {
                id: GEMINI_OFFICIAL_SERVICE_ID,
                label: 'Google Gemini 官方',
                defaultUrl: GEMINI_API_BASE,
            },
            {
                id: GEMINI_CUSTOM_SERVICE_ID,
                label: '自定义中转 / 代理',
                defaultUrl: '',
            },
        ],
        defaultUrls: {
            [GEMINI_OFFICIAL_SERVICE_ID]: GEMINI_API_BASE,
        },
    },
    grok: {
        defaultServiceId: GROK_OFFICIAL_SERVICE_ID,
        presets: [
            {
                id: GROK_OFFICIAL_SERVICE_ID,
                label: 'xAI Grok 官方',
                defaultUrl: GROK_API_BASE,
            },
            {
                id: GROK_CUSTOM_SERVICE_ID,
                label: '自定义中转 / 代理',
                defaultUrl: '',
            },
        ],
        defaultUrls: {
            [GROK_OFFICIAL_SERVICE_ID]: GROK_API_BASE,
        },
    },
});

/** 获取指定生图服务提供方的档位规则定义（无多档位的本地引擎返回 null） */
export function getProviderServiceProfileRules(
    provider: ProviderType
): ProviderServiceProfileRules | null {
    return PROVIDER_SERVICE_PROFILE_RULES[provider] ?? null;
}

/** 获取指定生图服务提供方的服务商模板列表 */
export function getProviderServiceProfiles(
    provider: ProviderType
): readonly ProviderServiceProfileSpec[] {
    return PROVIDER_SERVICE_PROFILE_RULES[provider]?.presets ?? [];
}

/**
 * 纯函数计算切换服务商时的一致性配置补丁：
 * 1. 将切出档位的 `serverUrl` / `apiKey` / `assetCache` 存档至 `serviceProfiles[prevId]`；
 * 2. 按 `fixedUrls` > 已存 `serviceProfiles[nextId]` > `defaultUrls` > 空值顺序解析目标连接参数。
 */
export function resolveProviderServiceSwitchPatch(
    provider: ProviderType,
    currentConfig: ProviderStoredConfig | undefined,
    nextServiceId: string,
    overrides?: ProviderServiceSwitchOverrides
): ProviderServiceSwitchResult {
    const rules = getProviderServiceProfileRules(provider);
    const prevServiceId =
        (currentConfig?.serviceId || '').trim() ||
        overrides?.defaultServiceId ||
        rules?.defaultServiceId ||
        '';
    const currentCache = completeProviderAssetCache(currentConfig?.assetCache);

    if (!prevServiceId || !nextServiceId || nextServiceId === prevServiceId) {
        return {
            switched: false,
            prevServiceId,
            nextServiceId,
            nextUrl: currentConfig?.serverUrl ?? '',
            nextApiKey: currentConfig?.apiKey ?? '',
            nextAssetCache: currentCache,
            patch: {},
        };
    }

    const nextSavedProfile = currentConfig?.serviceProfiles?.[nextServiceId];
    const fixedUrl = overrides?.fixedUrls?.[nextServiceId] ?? rules?.fixedUrls?.[nextServiceId];
    const defaultUrl =
        overrides?.defaultUrls?.[nextServiceId] ?? rules?.defaultUrls?.[nextServiceId];
    const nextUrl = fixedUrl ?? (nextSavedProfile?.serverUrl || defaultUrl) ?? '';
    const nextApiKey = nextSavedProfile?.apiKey ?? '';
    const nextAssetCache = completeProviderAssetCache(nextSavedProfile?.assetCache);

    return {
        switched: true,
        prevServiceId,
        nextServiceId,
        nextUrl,
        nextApiKey,
        nextAssetCache,
        patch: {
            serviceId: nextServiceId,
            serverUrl: nextUrl,
            apiKey: nextApiKey,
            assetCache: nextAssetCache,
            serviceProfiles: {
                [prevServiceId]: {
                    serverUrl: currentConfig?.serverUrl ?? '',
                    apiKey: currentConfig?.apiKey ?? '',
                    assetCache: currentCache,
                },
            },
        },
    };
}

/** 本地图像存储格式下拉选项（供常规设置与悬浮球快捷面板共同消费） */
export const IMAGE_STORAGE_QUALITY_OPTIONS: ReadonlyArray<{
    readonly value: ImageStorageQuality;
    readonly label: string;
}> = [
    { value: 'original', label: '原图' },
    { value: 'png', label: '无损 PNG' },
    { value: 'webp-high', label: 'WebP 高画质 (90%)' },
    { value: 'webp-medium', label: 'WebP 标准 (80%)' },
    { value: 'jpeg-high', label: 'JPEG 高画质 (92%)' },
    { value: 'jpeg-medium', label: 'JPEG 标准 (85%)' },
];

export const IMAGE_STORAGE_QUALITY_TOOLTIP =
    '「原图」保留服务直出格式并补充缺失的绘图参数；「无损 PNG」适合下载后导入 ComfyUI，WebP 与 JPEG 体积更小且同样支持写入参数。';
