/**
 * xAI Grok 原生图像生成模型目录与能力表。
 */

export const GROK_OFFICIAL_SERVICE_ID = 'grok-official';
export const GROK_CUSTOM_SERVICE_ID = 'custom';
export const GROK_API_BASE = 'https://api.x.ai/v1';

export const GROK_ASPECT_RATIOS = [
    '1:1',
    '16:9',
    '9:16',
    '4:3',
    '3:4',
    '3:2',
    '2:3',
    '21:9',
    '2:1',
    '1:2',
] as const;

export const GROK_RESOLUTIONS = ['1k', '2k'] as const;

export const GROK_ASPECT_RATIO_OPTIONS: Array<{ label: string; value: string }> = [
    { label: '自动 (由模型决定)', value: 'auto' },
    ...GROK_ASPECT_RATIOS.map((ratio) => ({ label: ratio, value: ratio })),
];

export interface GrokModelCapabilities {
    /** 是否支持 aspect_ratio 参数 */
    readonly supportsAspectRatio: boolean;
    /** 是否支持 resolution 参数 ('1k' | '2k') */
    readonly supportsResolution: boolean;
    /** 支持的画幅比例列表 */
    readonly supportedAspectRatios: readonly string[];
    /** 支持的分辨率档位列表 */
    readonly supportedResolutions: readonly string[];
}

export const GROK_MODEL_OPTIONS: Array<{ label: string; value: string }> = [
    { label: 'grok-imagine-image', value: 'grok-imagine-image' },
    { label: 'grok-imagine-image-2.0', value: 'grok-imagine-image-2.0' },
    { label: 'grok-imagine-image-pro', value: 'grok-imagine-image-pro' },
    { label: 'grok-2-image-1212', value: 'grok-2-image-1212' },
];

const IMAGINE_CAPABILITIES: GrokModelCapabilities = {
    supportsAspectRatio: true,
    supportsResolution: true,
    supportedAspectRatios: GROK_ASPECT_RATIOS,
    supportedResolutions: GROK_RESOLUTIONS,
};

const LEGACY_GROK2_CAPABILITIES: GrokModelCapabilities = {
    supportsAspectRatio: false,
    supportsResolution: false,
    supportedAspectRatios: GROK_ASPECT_RATIOS,
    supportedResolutions: GROK_RESOLUTIONS,
};

/**
 * 按模型 ID 解析 xAI Grok 图像生成能力。
 */
export function resolveGrokModelCapabilities(modelId?: string): GrokModelCapabilities {
    const normalized = (modelId || '').trim().toLowerCase();
    if (normalized.startsWith('grok-2-image')) {
        return LEGACY_GROK2_CAPABILITIES;
    }
    return IMAGINE_CAPABILITIES;
}

/**
 * 过滤 xAI GET /models 响应中的图像生成模型。
 */
export function filterGrokImageModels(
    models: Array<{ id?: string } | null | undefined>
): string[] {
    return models
        .filter((m): m is { id: string } => typeof m?.id === 'string' && m.id.trim().length > 0)
        .map((m) => m.id.trim())
        .filter((id) => {
            const lower = id.toLowerCase();
            return lower.includes('grok') && (lower.includes('image') || lower.includes('imagine'));
        });
}
