/**
 * 离线采样算法、调度规则与模型架构参数区间规范。
 */

/** 参数区间边界定义 */
export interface RangeConfigItem {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly defaultValue?: number;
}

/** 采样参数区间配置集合 */
export interface SamplerRangeConfig {
    readonly steps?: RangeConfigItem;
    readonly cfgScale?: RangeConfigItem;
}

/** 离线内置推荐采样算法列表 */
export const DEFAULT_OFFLINE_SAMPLERS: Array<{ value: string; label: string }> = [
    { value: 'euler', label: 'Euler' },
    { value: 'euler_ancestral', label: 'Euler a' },
    { value: 'dpmpp_2m', label: 'DPM++ 2M' },
    { value: 'dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
    { value: 'dpmpp_sde', label: 'DPM++ SDE' },
    { value: 'ddim', label: 'DDIM' },
    { value: 'uni_pc', label: 'UniPC' },
];

/** 离线内置推荐调度规则列表 */
export const DEFAULT_OFFLINE_SCHEDULERS: Array<{ value: string; label: string }> = [
    { value: 'normal', label: 'Normal' },
    { value: 'karras', label: 'Karras' },
    { value: 'exponential', label: 'Exponential' },
    { value: 'sgm_uniform', label: 'SGM Uniform' },
    { value: 'simple', label: 'Simple' },
    { value: 'ddim_uniform', label: 'DDIM Uniform' },
    { value: 'beta', label: 'Beta' },
];

/** SD 1.5 / SDXL 传统架构参数范围配置 */
export const SD_RANGE_CONFIG: SamplerRangeConfig = {
    steps: { min: 1, max: 100, step: 1, defaultValue: 25 },
    cfgScale: { min: 0.0, max: 20.0, step: 0.1, defaultValue: 7.0 },
};

/** Flux / 蒸馏 Turbo 架构参数范围配置 */
export const FLUX_RANGE_CONFIG: SamplerRangeConfig = {
    steps: { min: 1, max: 50, step: 1, defaultValue: 4 },
    cfgScale: { min: 0.0, max: 10.0, step: 0.1, defaultValue: 1.0 },
};

/** 插件支持的生图服务商基础选项 */
export const PROVIDER_SELECT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { label: 'ComfyUI', value: 'comfyui' },
    { label: 'SD-WebUI / Forge', value: 'sdwebui' },
    { label: 'NovelAI', value: 'novelai' },
    { label: 'OpenAI 兼容', value: 'openai' },
    { label: 'Google Gemini', value: 'gemini' },
    { label: 'xAI Grok', value: 'grok' },
];

/** ComfyUI 默认采样算法候选 */
export const COMFY_DEFAULT_SAMPLERS: ReadonlyArray<{ value: string; label: string }> = [
    { label: 'euler', value: 'euler' },
    { label: 'euler_ancestral', value: 'euler_ancestral' },
    { label: 'dpmpp_2m', value: 'dpmpp_2m' },
    { label: 'dpmpp_2m_sde', value: 'dpmpp_2m_sde' },
    { label: 'dpmpp_sde', value: 'dpmpp_sde' },
    { label: 'uni_pc', value: 'uni_pc' },
    { label: 'ddim', value: 'ddim' },
];

/** ComfyUI 默认调度器候选 */
export const COMFY_DEFAULT_SCHEDULERS: ReadonlyArray<{ value: string; label: string }> = [
    { label: 'normal', value: 'normal' },
    { label: 'karras', value: 'karras' },
    { label: 'exponential', value: 'exponential' },
    { label: 'sgm_uniform', value: 'sgm_uniform' },
    { label: 'simple', value: 'simple' },
    { label: 'ddim_uniform', value: 'ddim_uniform' },
    { label: 'beta', value: 'beta' },
];

/** SD-WebUI / Forge 默认采样算法候选 */
export const SDWEBUI_DEFAULT_SAMPLERS: ReadonlyArray<{ value: string; label: string }> = [
    { label: 'DPM++ 2M Karras', value: 'DPM++ 2M Karras' },
    { label: 'DPM++ SDE Karras', value: 'DPM++ SDE Karras' },
    { label: 'DPM++ 2S a Karras', value: 'DPM++ 2S a Karras' },
    { label: 'Euler a', value: 'Euler a' },
    { label: 'Euler', value: 'Euler' },
    { label: 'DDIM', value: 'DDIM' },
    { label: 'UniPC', value: 'UniPC' },
];

/** SD-WebUI / Forge 默认调度器候选 */
export const SDWEBUI_DEFAULT_SCHEDULERS: ReadonlyArray<{ value: string; label: string }> = [
    { label: 'Automatic', value: 'Automatic' },
    { label: 'Karras', value: 'Karras' },
    { label: 'Exponential', value: 'Exponential' },
    { label: 'Polyexponential', value: 'Polyexponential' },
    { label: 'SGM Uniform', value: 'SGM Uniform' },
];

/** SD-WebUI 高清修复放大算法候选 */
export const HIRES_UPSCALER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { label: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
    { label: 'R-ESRGAN 4x+', value: 'R-ESRGAN 4x+' },
    { label: 'Latent', value: 'Latent' },
    { label: 'Latent (antialiased)', value: 'Latent (antialiased)' },
    { label: 'Latent (bicubic)', value: 'Latent (bicubic)' },
    { label: '4x-UltraSharp', value: '4x-UltraSharp' },
    { label: 'ESRGAN_4x', value: 'ESRGAN_4x' },
];

/** NovelAI 官方规范参数范围配置 (普通账号上限 28，Opus 顶级订阅上限 50) */
export const NOVELAI_RANGE_CONFIG: SamplerRangeConfig = {
    steps: { min: 1, max: 50, step: 1, defaultValue: 28 },
    cfgScale: { min: 0.0, max: 10.0, step: 0.1, defaultValue: 5.0 },
};
