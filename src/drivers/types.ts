/**
 * ImageDriver 统一接口定义
 *
 * 所有图像生成后端驱动必须实现此接口。
 * 通过接口隔离，上层业务逻辑无需关心具体的后端协议差异。
 *
 * 参考：.agents/Skills/st-image-generation-patterns/SKILL.md §2.1
 */

// ─── 生成参数 ─────────────────────────────────────────────────────────────────

/**
 * 图像生成请求参数
 * 统一表达所有后端共同支持的基础参数
 */
export interface GenerateOptions {
    /** 正向提示词（已完成宏展开，直接传递给后端） */
    prompt: string;
    /** 负向提示词 */
    negativePrompt?: string;
    /** 图像宽度（像素） */
    width: number;
    /** 图像高度（像素） */
    height: number;
    /** 采样步数 */
    steps: number;
    /** CFG Scale */
    cfgScale: number;
    /** 采样器名称 */
    samplerName: string;
    /** 调度器名称（如 normal、karras） */
    scheduler?: string;
    /** 随机种子（-1 表示随机） */
    seed?: number;
    /** 后端特有的扩展参数（透传给驱动，不做类型约束） */
    extra?: Record<string, unknown>;
}

// ─── 生成结果 ─────────────────────────────────────────────────────────────────

/**
 * 图像生成结果
 * 统一表达为 base64 编码的图像数据
 */
export interface GenerateResult {
    /** base64 编码的图像数据（不含 data: 前缀） */
    imageData: string;
    /** MIME 类型（如 image/png, image/webp） */
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    /** 实际使用的随机种子（来自后端响应） */
    seed?: number;
    /** 实际生成耗时（毫秒） */
    durationMs?: number;
}

// ─── 进度回调 ─────────────────────────────────────────────────────────────────

/**
 * 生成进度信息
 * 驱动通过 onProgress 回调实时上报
 */
export interface GenerateProgress {
    /** 当前步骤（0-based） */
    currentStep: number;
    /** 总步骤数 */
    totalSteps: number;
    /** 进度百分比（0-100） */
    percentage: number;
    /** 人类可读的状态描述 */
    statusMessage?: string;
    /** 预览图（base64，仅部分后端支持） */
    previewImage?: string;
}

/** 进度回调函数类型 */
export type ProgressCallback = (progress: GenerateProgress) => void;

// ─── 连接信息 ─────────────────────────────────────────────────────────────────

/**
 * 后端连接状态信息
 */
export interface ConnectionInfo {
    /** 是否连通 */
    connected: boolean;
    /** 后端服务版本（可选） */
    version?: string;
    /** 连接延迟（毫秒，可选） */
    latencyMs?: number;
    /** 连接失败原因（仅 connected=false 时有值） */
    error?: string;
}

// ─── 驱动接口 ─────────────────────────────────────────────────────────────────

/**
 * 图像生成驱动统一接口
 *
 * 所有后端驱动（ComfyUI、SD WebUI、NovelAI 等）必须实现此接口。
 * 通过驱动工厂（factory.ts）获取实例，上层代码不应直接 new 驱动类。
 *
 * @example
 * const driver = createDriver('comfyui', settings);
 * const info = await driver.checkConnection();
 * if (info.connected) {
 *   const result = await driver.generate(options, progressCallback);
 * }
 */
export interface ImageDriver {
    /** 驱动标识名（与 ImageProvider 类型对应） */
    readonly name: string;

    /**
     * 检查与后端的连接状态
     * 应发起轻量级请求（如 /system_stats 或 /ping），不触发生成
     */
    checkConnection(): Promise<ConnectionInfo>;

    /**
     * 生成图像
     *
     * @param options 生成参数
     * @param onProgress 进度回调（可选）
     * @returns 生成结果
     * @throws {DriverError} 网络错误、后端错误、超时等
     */
    generate(options: GenerateOptions, onProgress?: ProgressCallback): Promise<GenerateResult>;

    /**
     * 取消当前进行中的生成任务
     *
     * 注意：部分后端（如 ComfyUI）不支持精确取消正在执行的任务，
     * 此时驱动应实现"客户端丢弃模式"——标记取消状态并忽略后续结果。
     */
    cancel(): void;

    /**
     * 获取后端支持的采样器列表
     * 用于设置面板动态填充下拉选项
     */
    getSamplers(): Promise<string[]>;
}

// ─── 驱动错误 ─────────────────────────────────────────────────────────────────

/** 驱动错误类型枚举 */
export enum DriverErrorType {
    /** 网络连接失败 */
    NETWORK_ERROR = 'NETWORK_ERROR',
    /** 请求超时 */
    TIMEOUT = 'TIMEOUT',
    /** 后端返回错误响应 */
    BACKEND_ERROR = 'BACKEND_ERROR',
    /** 任务被取消 */
    CANCELLED = 'CANCELLED',
    /** 参数无效 */
    INVALID_PARAMS = 'INVALID_PARAMS',
    /** 未知错误 */
    UNKNOWN = 'UNKNOWN',
}

/**
 * 驱动统一错误类
 * 所有驱动抛出的错误都应使用此类，便于上层统一处理
 */
export class DriverError extends Error {
    constructor(
        public readonly type: DriverErrorType,
        message: string,
        public readonly cause?: unknown
    ) {
        super(message);
        this.name = 'DriverError';
    }
}
