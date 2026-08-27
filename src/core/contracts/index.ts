/**
 * @module core/contracts
 * @description 核心服务与调度接口定义
 */

import { IDisposable } from '../foundation/disposable';
import type { ObservableStore } from '../state/store';
import type { DrawAssistantSettings, LoraItem } from '../state/store-types';

/** 外观主题色彩与毛玻璃配置 */
export interface ThemeData {
    accentColor: string;
    bgPrimary: string;
    bgSecondary: string;
    bgGradientEnd: string;
    bgGradientAngle: number;
    bgOpacity: number;
    textPrimary: string;
    textSecondary: string;
    borderColor: string;
    borderRadius: number;
    blurRadius: number;
    [key: string]: unknown;
}

/** 外观主题服务接口 */
export interface IThemeService extends IDisposable {
    /** 注入主题配色变量至指定 DOM 节点或根节点 */
    applyTheme(themeData?: Partial<ThemeData>, targetNode?: HTMLElement): void;
    /** 获取当前生效的主题数据 */
    getCurrentTheme(): ThemeData;
    /** 切换并应用指定预设主题 */
    setThemePreset(presetId: string): void;
}
export type IThemeContract = IThemeService;

/** 提示词流水线上下文 */
export interface PipelineHookContext {
    /** 楼层消息索引 */
    readonly messageId: number;
    /** 当前会话 ID */
    readonly chatId: string;
    /** 未经处理的原始提示词文本 */
    readonly rawPrompt: string;
    /** 阶段间传递的扩展元数据 */
    readonly metadata?: Record<string, unknown>;
}

/**
 * 提示词流水线钩子注册接口
 * priority 越大越早触发，默认为 50
 */
export interface IPipelineHookRegistration<T, C = PipelineHookContext> {
    /**
     * 注册一个处理函数加入生图流水线
     * @param name 唯一标识名称，用于注销时定位
     * @param fn 处理函数，接收当前数据并返回处理后的数据
     * @param priority 优先级，数字越大越早执行，默认 50
     * @returns 取消注册的销毁句柄
     */
    tap(name: string, fn: (input: T, context?: C) => T | Promise<T>, priority?: number): IDisposable;
}

/** 通用生图参数模型 */
export interface CommonGenParams {
    seed: number;
    steps: number;
    cfgScale: number;
    samplerName: string;
    scheduler?: string;
    width: number;
    height: number;
    model?: string;
    clipSkip?: number;
    enableHires?: boolean;
    hiresScale?: number;
    hiresUpscaler?: string;
    hiresSteps?: number;
    hiresDenoise?: number;
    [key: string]: unknown;
}

/** 统一生图请求数据 (文生图 txt2img / 局部重绘 inpaint) */
export type GenerationPayload =
    | {
          mode: 'txt2img';
          prompt: string;
          negativePrompt: string;
          params: CommonGenParams;
      }
    | {
          mode: 'inpaint';
          prompt: string;
          negativePrompt: string;
          params: CommonGenParams;
          initImageBlob: Blob;
          maskImageBlob: Blob;
          denoiseStrength: number;
      };

/** 提示词流水线钩子接口 */
export interface IPipelineHooks {
    /** 阶段 1：文本基础清洗前钩子 */
    readonly beforeClean: IPipelineHookRegistration<string, PipelineHookContext>;
    /** 阶段 2：提示词组装前钩子 (通用扩展挂载点) */
    readonly beforePromptBuild: IPipelineHookRegistration<string, PipelineHookContext>;
    /** 阶段 3：提交生图驱动前的请求数据拦截钩子 */
    readonly beforeSubmit: IPipelineHookRegistration<GenerationPayload, PipelineHookContext>;
}
export type IPipelineHooksContract = IPipelineHooks;

/** 任务状态枚举 */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'DISCARDED' | 'ERROR';

/** 任务上下文标识 */
export interface TaskContextIdentity {
    readonly taskId: string;
    readonly chatId: string;
    readonly messageId: number;
    readonly swipeId?: number;
}

/** 生图任务快照状态 */
export interface TaskState {
    readonly identity: TaskContextIdentity;
    readonly status: TaskStatus;
    readonly payload?: GenerationPayload;
    readonly createdAt: number;
    readonly resultBlobs?: Blob[];
    readonly error?: string;
}

/** 生图任务管理器接口 */
export interface ITaskManager extends IDisposable {
    /** 提交异步生图任务 */
    submit(options: {
        chatId: string;
        messageId: number;
        swipeId?: number;
        payload: GenerationPayload;
    }): Promise<string>;

    /** 取消指定任务 */
    cancelTask(taskId: string): Promise<void>;

    /** 获取任务当前状态与结果 */
    getTask(taskId: string): TaskState | undefined;

    /** 获取指定楼层的所有任务 */
    getTasksByMessage(chatId: string, messageId: number): TaskState[];
}
export type ITaskContract = ITaskManager;

/** 驱动后端特性配置声明 */
export interface DriverCapabilities {
    /** 是否支持即时打断生图任务 */
    readonly supportsInterrupt: boolean;
    /** 是否支持局部重绘模式 (Inpaint) */
    readonly supportsInpaint: boolean;
    /** 是否支持从后端拉取模型与采样器列表 (资产同步) */
    readonly supportsAssetSync: boolean;
    /** 提示词与权重格式 ('wlr' ComfyUI格式 | 'parentheses' SD括号格式 | 'plain' 纯文本) */
    readonly promptSyntax: 'wlr' | 'parentheses' | 'plain';
}

/** 驱动后端资产同步结果 */
export interface DriverAssetSyncResult {
    /** 成功拉取到的总资产项数量 */
    updatedCount: number;
    /** 用户可读的同步结果摘要文案 */
    summary: string;
    /** 各细分资产项的数量字典 */
    details: Record<string, number>;
}

/** 驱动组装生图参数选项 */
export interface DriverBuildPayloadOptions {
    cleanPositive: string;
    cleanNegative: string;
    mode?: 'txt2img' | 'inpaint';
    initImageBlob?: Blob;
    maskImageBlob?: Blob;
    denoiseStrength?: number;
    settings: DrawAssistantSettings;
    overrides?: Record<string, unknown>;
}

/**
 * 生图后端驱动统一接口
 * 供驱动注册中心（DriverRegistry）、调度器与 UI 视图层统一使用
 */
export interface IDrawDriver {
    readonly id: string;
    readonly name: string;
    readonly capabilities: DriverCapabilities;
    ping(): Promise<boolean>;
    checkConnection(): Promise<{ connected: boolean; latencyMs?: number; error?: string }>;
    syncAssets(store: ObservableStore<DrawAssistantSettings>): Promise<DriverAssetSyncResult>;
    formatPrompt(rawPrompt: string): string;
    formatLoraTag(lora: LoraItem): string;
    buildPayload(options: DriverBuildPayloadOptions): GenerationPayload;
    /**
     * 执行生图流程并返回生成的图片与元数据
     *
     * @param payload 统一生图请求数据
     */
    generate(
        payload: GenerationPayload
    ): Promise<{ imageBlobs: Blob[]; metadata: Record<string, unknown> }>;
    interrupt(): Promise<void>;
}
