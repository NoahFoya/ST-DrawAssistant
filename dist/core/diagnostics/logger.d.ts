/**
 * @module core/diagnostics/logger
 * @description 命名空间分级日志器 (DEBUG / INFO / WARN / ERROR)
 */
import { LogBuffer } from './log-buffer';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
/** 结构化日志输出接口 */
export interface ILogger {
    readonly namespace: string;
    readonly buffer?: LogBuffer;
    child(subNamespace: string): ILogger;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
}
/** 分级日志记录器实现 (控制台输出与内存日志缓冲记录) */
export declare class Logger implements ILogger {
    private static _globalBuffer;
    private static _globalMinLevel;
    readonly namespace: string;
    readonly buffer: LogBuffer;
    constructor(namespace?: string, buffer?: LogBuffer);
    static setMinLogLevel(level: LogLevel): void;
    static getGlobalBuffer(): LogBuffer;
    child(subNamespace: string): ILogger;
    private log;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
}
//# sourceMappingURL=logger.d.ts.map