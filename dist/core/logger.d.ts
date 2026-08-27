/**
 * @module core/logger
 * @description ST-DrawAssistant 全局结构化日志系统 (Structured Logger)
 *
 * 职责：
 * - 提供 TRACE / DEBUG / INFO / WARN / ERROR / FATAL 6 级结构化日志
 * - 标准 JSON 数据结构对象记录，支持双模格式（控制台单行输出 + 内存环形缓冲区完整对象）
 * - 动态日志级别控制与控制台 window.__DA.setLogLevel() 临时覆盖能力
 * - 提供 JSON 与纯文本格式导出及持久化钩子
 */
export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export interface LogErrorDetails {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
}
export interface StructuredLogEntry {
    id: string;
    timestamp: string;
    level: LogLevel;
    module: string;
    message: string;
    taskId?: string;
    sessionId: string;
    context?: Record<string, unknown>;
    error?: LogErrorDetails;
}
export type LogListener = (entry: StructuredLogEntry) => void;
export type LogPersistHook = (entry: StructuredLogEntry) => void;
declare class Logger {
    private logs;
    private maxCapacity;
    private listeners;
    private persistHook;
    private currentLogLevel;
    constructor();
    /**
     * 挂载日志持久化钩子回调（依赖注入，保持 Core 模块纯洁性）
     */
    setPersistHook(hook: LogPersistHook | null): void;
    /**
     * 动态设定运行期日志级别
     */
    setLogLevel(level: LogLevel): void;
    /**
     * 获取当前系统生效的日志级别
     */
    getLogLevel(): LogLevel;
    /** TRACE 细粒度协议追溯 */
    trace(message: string, context?: unknown, moduleName?: string, taskId?: string): void;
    /** DEBUG 调试信息 */
    debug(message: string, context?: unknown, moduleName?: string, taskId?: string): void;
    /** INFO 运行状态信息 */
    info(message: string, context?: unknown, moduleName?: string, taskId?: string): void;
    /** WARN 业务警告信息 */
    warn(message: string, context?: unknown, moduleName?: string, taskId?: string): void;
    /** ERROR 异常与操作失败 */
    error(message: string, context?: unknown, moduleName?: string, taskId?: string): void;
    /** FATAL 致命错误 */
    fatal(message: string, context?: unknown, moduleName?: string, taskId?: string): void;
    /**
     * 核心日志记录入口
     */
    private log;
    /**
     * 控制台日志渲染
     */
    private printConsole;
    /**
     * 按条件获取结构化日志数组
     */
    getLogs(levelFilter?: LogLevel | 'ALL', limit?: number): StructuredLogEntry[];
    /** 清空内存日志 */
    clear(): void;
    /** 订阅日志推流 */
    subscribe(listener: LogListener): () => void;
    /** 导出纯文本人类可读日志 */
    exportToText(): string;
    /** 导出完整 JSON 结构化日志 */
    exportToJson(): string;
    /**
     * 挂载 __DA 到 window 对象，方便控制台直接输入命令调试
     */
    private mountGlobalHelper;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map