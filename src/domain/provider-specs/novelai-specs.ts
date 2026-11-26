/**
 * NovelAI 服务商常量与模型标识规范。
 */

/** NovelAI 官方图像服务地址 */
export const NOVELAI_IMAGE_HOST = 'https://image.novelai.net';

/** NovelAI 官方服务商标识 */
export const NOVELAI_OFFICIAL_SERVICE_ID = 'novelai-official';

/** 第三方服务商标识 */
export const NOVELAI_CUSTOM_SERVICE_ID = 'custom';

/**
 * NovelAI 官方图像模型标识。
 *
 * NovelAI 官方及常规兼容反代均不提供模型枚举接口，此表为界面下拉的静态模型目录，
 * 非标准模型由预设中的 customModel 字段覆盖。
 */
export const OFFICIAL_NOVELAI_MODELS: readonly string[] = [
    'nai-diffusion-5-full',
    'nai-diffusion-5-curated',
    'nai-diffusion-4-5-full',
    'nai-diffusion-4-5-curated',
    'nai-diffusion-4-full',
    'nai-diffusion-4-curated-preview',
    'nai-diffusion-3',
    'nai-diffusion-furry-3',
];

const NOVELAI_MODEL_LABELS: Readonly<Record<string, string>> = {
    'nai-diffusion-5-full': 'NAI Diffusion V5 (Full)',
    'nai-diffusion-5-curated': 'NAI Diffusion V5 (Curated)',
    'nai-diffusion-4-5-full': 'NAI Diffusion V4.5 (Full)',
    'nai-diffusion-4-5-curated': 'NAI Diffusion V4.5 (Curated)',
    'nai-diffusion-4-full': 'NAI Diffusion V4 (Full)',
    'nai-diffusion-4-curated-preview': 'NAI Diffusion V4 (Curated)',
    'nai-diffusion-3': 'NAI Diffusion V3',
    'nai-diffusion-furry-3': 'NAI Diffusion Furry V3',
};

/**
 * 获取已知官方模型的友好显示名称，其余模型（如第三方接口自定义标识）原样返回。
 */
export function formatNovelAIModelLabel(modelId: string): string {
    return NOVELAI_MODEL_LABELS[modelId] ?? modelId;
}

/** NovelAI 默认回退模型标识 */
const DEFAULT_NOVELAI_MODEL = 'nai-diffusion-4-5-full';

/** NovelAI 模型架构族：V3 使用扁平参数，V4 / V5 使用结构化 v4_prompt */
export type NovelAIModelFamily = 'v3' | 'v4' | 'v5';

/**
 * 统一解析 NovelAI 实际生效的模型标识。
 *
 * @remarks
 * 按以下优先级解析最终模型：
 * `params.customModel` > `preset.customModel` > `params.baseModel` > `preset.baseModel` > {@link DEFAULT_NOVELAI_MODEL}。
 */
export function resolveNovelAIModelName(
    params?: Record<string, unknown>,
    preset?: { customModel?: unknown; baseModel?: unknown }
): string {
    const readTrimmed = (value: unknown): string =>
        typeof value === 'string' ? value.trim() : '';

    return (
        readTrimmed(params?.customModel) ||
        readTrimmed(preset?.customModel) ||
        readTrimmed(params?.baseModel) ||
        readTrimmed(preset?.baseModel) ||
        DEFAULT_NOVELAI_MODEL
    );
}

/**
 * 依据模型标识判定架构族（按 V4/V4.5 -> V3/V3.5 -> V5/V5.5 顺序判定）。
 */
export function resolveNovelAIModelFamily(modelId: string): NovelAIModelFamily {
    const id = (modelId || '').toLowerCase();
    // 先匹配 4.5 / 4 与 3.5 / 3，避免 `-4-5` 或 `-3-5` 中的 `-5` 误命中 V5
    if (/4[-._]5/.test(id) || /(?:^|[-_ v])4(?:$|[-_ ])/.test(id)) return 'v4';
    if (/(?:^|[-_ v])3(?:[._]5)?(?:$|[-_ ])/.test(id)) return 'v3';
    if (/(?:^|[-_ v])5(?:[._]5)?(?:$|[-_ ])/.test(id)) return 'v5';
    return 'v4';
}
