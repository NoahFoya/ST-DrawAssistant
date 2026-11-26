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

/** NovelAI 官方规范参数范围配置 (普通账号上限 28，Opus 顶级订阅上限 50) */
export const NOVELAI_RANGE_CONFIG: SamplerRangeConfig = {
    steps: { min: 1, max: 50, step: 1, defaultValue: 28 },
    cfgScale: { min: 0.0, max: 10.0, step: 0.1, defaultValue: 5.0 },
};
