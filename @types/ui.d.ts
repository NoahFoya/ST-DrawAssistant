/**
 * UI 层复合组件与数据展示通用类型定义
 * 适用于 composite/、media/、views/ 各子层之间的共享数据模型
 */

import type { HealthCheckResult } from './adapter';

/** 连接卡片当前状态 */
export type ConnectionCardStatus = 'idle' | 'checking' | 'online' | 'offline';

/** 连通性测试执行函数 */
export type HealthCheckFn = (signal?: AbortSignal) => Promise<HealthCheckResult>;

/** 预设工具栏操作类型 */
export type PresetActionType = 'select' | 'new' | 'save' | 'saveAs' | 'import' | 'export' | 'reset' | 'delete';

/** 单个 LoRA 项展示与编辑模型 */
export interface LoraItemModel {
    id: string;
    name: string;
    enabled: boolean;
    modelWeight: number;
    clipWeight: number;
    triggerWeight?: number;
    isMissing?: boolean;
}

/** 工作流模板展示与诊断数据模型 */
export interface WorkflowCardModel {
    id: string;
    title: string;
    description?: string;
    version?: string;
    author?: string;
    nodesCount?: number;
    variables: {
        prompt: boolean;
        negativePrompt: boolean;
        seed: boolean;
        width: boolean;
        height: boolean;
        steps: boolean;
        cfg: boolean;
        sampler: boolean;
        scheduler: boolean;
        modelName: boolean;
    };
    rawJson?: Record<string, any>;
}

/** 统计卡片条目数据模型 */
export interface StatItemModel {
    label: string;
    value: string | number;
    unit?: string;
    variant?: 'success' | 'warn' | 'error' | 'info';
    hint?: string;
}

/** 本地存储配额监控数据模型 */
export interface StorageQuotaInfo {
    usedBytes: number;
    totalBytes: number;
    imageCount: number;
}

/** 画幅尺寸与分辨率数据模型 */
export interface DimensionValue {
    width: number;
    height: number;
    aspectRatio?: string;
}

/** 常用采样生成超参数模型 */
export interface SamplerParamsModel {
    sampler: string;
    scheduler: string;
    steps: number;
    cfgScale: number;
    seed: number;
}

/** 终端日志级别 */
export type TerminalLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 终端日志条目模型 */
export interface TerminalLogEntry {
    level: TerminalLogLevel;
    message: string;
    namespace?: string;
    timestamp?: number;
}

/** 画廊媒体单张卡片模型 */
export interface MediaCardItemModel {
    id: string;
    url: string;
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    isFavorite?: boolean;
    createdAt?: number;
}
