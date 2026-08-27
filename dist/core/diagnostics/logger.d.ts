/**
 * @module core/diagnostics/logger
 * @description 命名空间分级日志器 (DEBUG / INFO / WARN / ERROR) 与诊断集成
 */
import { LogBuffer } from './log-buffer';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
/**
 * 结构化日志器接口
 */
export interface ILogger {
    /** 当前日志器命名空间 */
    readonly namespace: string;
    /** 创建挂载于当前命名空间下的子日志器 */
    child(subNamespace: string): ILogger;
    /** 输出 DEBUG 级别调试日志 */
    debug(message: string, data?: unknown): void;
    /** 输出 INFO 级别信息日志 */
    info(message: string, data?: unknown): void;
    /** 输出 WARN 级别告警日志 */
    warn(message: string, data?: unknown): void;
    /** 输出 ERROR 级别错误日志 */
    error(message: string, data?: unknown): void;
    /** 获取关联的日志环形缓冲池 */
    readonly buffer?: LogBuffer;
}
/**
 * 命名空间分级日志器实现
 */
export declare class Logger implements ILogger {
    private static _globalBuffer;
    private static _globalMinLevel;
    readonly namespace: string;
    readonly buffer: LogBuffer;
    constructor(namespace?: string, buffer?: LogBuffer);
    /**
     * 设置全局最低日志打印级别
     */
    static setMinLogLevel(level: LogLevel): void;
    /**
     * 获取全局共享的日志缓冲区
     */
    static getGlobalBuffer(): LogBuffer;
    /**
     * 创建子日志器
     */
    child(subNamespace: string): ILogger;
    private log;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
}
//# sourceMappingURL=logger.d.ts.map