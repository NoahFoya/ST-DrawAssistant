/**
 * Google Gemini 原生图像生成模型目录与能力表。
 *
 * @remarks
 * 仅覆盖支持 `:generateContent` + `responseModalities: ["IMAGE"]` 的 Gemini 图像模型；
 * `imagen-*` 系列使用 `:predict` 接口，不在本表范围内。
 */

export const GEMINI_OFFICIAL_SERVICE_ID = 'gemini-official';
export const GEMINI_CUSTOM_SERVICE_ID = 'custom';
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_ASPECT_RATIOS = [
    '1:1',
    '9:16',
    '16:9',
    '3:4',
    '4:3',
    '2:3',
    '3:2',
    '4:5',
    '5:4',
    '21:9',
] as const;

export const GEMINI_IMAGE_SIZES = ['512', '1K', '2K', '4K'] as const;
export const GEMINI_PRO_IMAGE_SIZES = ['1K', '2K', '4K'] as const;

export const GEMINI_ASPECT_RATIO_OPTIONS: Array<{ label: string; value: string }> = [
    { label: '自动 (由模型决定)', value: 'auto' },
    ...GEMINI_ASPECT_RATIOS.map((ratio) => ({ label: ratio, value: ratio })),
];

/** 构建 Gemini 分辨率档位选项（含显式「自动」以省略 imageSize） */
export function buildGeminiImageSizeOptions(
    capabilities: GeminiModelCapabilities
): Array<{ label: string; value: string }> {
    const sizes = capabilities.supportedImageSizes.map((size) => ({
        label: size === '512' ? '512px' : size,
        value: size,
    }));
    return [{ label: '自动', value: 'auto' }, ...sizes];
}

export interface GeminiModelCapabilities {
    /** 是否支持 generationConfig.imageConfig.imageSize (512 / 1K / 2K / 4K) */
    readonly supportsImageSize: boolean;
    /** 未显式配置分辨率档位时是否允许「默认（不传 imageSize）」 */
    readonly allowsDefaultEmptyImageSize: boolean;
    /** 支持的画幅比例列表 */
    readonly supportedAspectRatios: readonly string[];
    /** 支持的分辨率档位列表 */
    readonly supportedImageSizes: readonly string[];
}

export const GEMINI_MODEL_OPTIONS: Array<{ label: string; value: string }> = [
    { label: 'gemini-2.5-flash-image (Nano Banana)', value: 'gemini-2.5-flash-image' },
    { label: 'gemini-nano-banana-2.1', value: 'gemini-nano-banana-2.1' },
    { label: 'gemini-3-pro-image-preview (Nano Banana Pro)', value: 'gemini-3-pro-image-preview' },
    { label: 'gemini-3.1-flash-image-preview (Nano Banana 2)', value: 'gemini-3.1-flash-image-preview' },
];

const DEFAULT_CAPABILITIES: GeminiModelCapabilities = {
    supportsImageSize: true,
    allowsDefaultEmptyImageSize: true,
    supportedAspectRatios: GEMINI_ASPECT_RATIOS,
    supportedImageSizes: GEMINI_IMAGE_SIZES,
};

const FLASH_25_CAPABILITIES: GeminiModelCapabilities = {
    supportsImageSize: false,
    allowsDefaultEmptyImageSize: true,
    supportedAspectRatios: GEMINI_ASPECT_RATIOS,
    supportedImageSizes: [],
};

/**
 * 按模型 ID 前缀解析 Gemini 图像生成能力。
 * 明确不支持 imageSize 的模型（gemini-2.5-flash-image）予以关闭；
 * 未知自定义模型默认开放 imageSize（用户未选时不发送），避免阻碍新模型或中转别名使用。
 */
export function resolveGeminiModelCapabilities(modelId?: string): GeminiModelCapabilities {
    const normalized = (modelId || '').trim().toLowerCase().replace(/^models\//, '');
    if (!normalized) {
        return DEFAULT_CAPABILITIES;
    }

    if (normalized.startsWith('gemini-2.5-flash-image')) {
        return FLASH_25_CAPABILITIES;
    }

    if (normalized.startsWith('gemini-3.1-flash-image')) {
        return {
            supportsImageSize: true,
            allowsDefaultEmptyImageSize: false,
            supportedAspectRatios: GEMINI_ASPECT_RATIOS,
            supportedImageSizes: GEMINI_IMAGE_SIZES,
        };
    }

    if (normalized.startsWith('gemini-3-pro-image')) {
        return {
            supportsImageSize: true,
            allowsDefaultEmptyImageSize: false,
            supportedAspectRatios: GEMINI_ASPECT_RATIOS,
            supportedImageSizes: GEMINI_PRO_IMAGE_SIZES,
        };
    }

    return DEFAULT_CAPABILITIES;
}

export interface GeminiModelListItem {
    name?: string;
    id?: string;
    displayName?: string;
    description?: string;
    supportedGenerationMethods?: string[];
}

/**
 * 过滤 Gemini GET /models 响应，保留支持 generateContent 的图像生成模型。
 *
 * @remarks
 * 官方 Model 资源不含 outputModalities 字段，因此结合 supportedGenerationMethods（须含 generateContent）
 * 与模型标识/显示名/描述中的 image、banana 关键字共同过滤，兼顾 gemini-*-image* 与 nano-banana 系列。
 */
export function filterGeminiImageModels(
    models: Array<GeminiModelListItem | null | undefined>
): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const m of models) {
        if (!m) continue;
        const id = (m.name || m.id || '').trim().replace(/^models\//, '');
        if (!id || seen.has(id)) continue;

        const methods = m.supportedGenerationMethods;
        if (Array.isArray(methods) && methods.length > 0 && !methods.includes('generateContent')) {
            continue;
        }

        const lowerId = id.toLowerCase();
        if (lowerId.startsWith('imagen-')) {
            continue;
        }

        const lowerMeta = `${m.displayName || ''} ${m.description || ''}`.toLowerCase();
        const isImageModel =
            lowerId.includes('image') ||
            lowerId.includes('banana') ||
            lowerMeta.includes('nano banana') ||
            lowerMeta.includes('image generation');
        if (!isImageModel) {
            continue;
        }

        seen.add(id);
        result.push(id);
    }

    return result;
}
