/**
 * @module core/diagnostics/logger
 * @description 命名空间分级日志器 (DEBUG / INFO / WARN / ERROR) 与诊断集成
 */

import { LogBuffer, LogEntry } from './log-buffer';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

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
export class Logger implements ILogger {
    private static _globalBuffer = new LogBuffer(1500);
    private static _globalMinLevel: LogLevel = 'INFO';

    public readonly namespace: string;
    public readonly buffer: LogBuffer;

    constructor(namespace = 'Kernel', buffer?: LogBuffer) {
        this.namespace = namespace;
        this.buffer = buffer || Logger._globalBuffer;
    }

    /**
     * 设置全局最低日志打印级别
     */
    public static setMinLogLevel(level: LogLevel): void {
        Logger._globalMinLevel = level;
    }

    /**
     * 获取全局共享的日志缓冲区
     */
    public static getGlobalBuffer(): LogBuffer {
        return Logger._globalBuffer;
    }

    /**
     * 创建子日志器
     */
    public child(subNamespace: string): ILogger {
        return new Logger(`${this.namespace}:${subNamespace}`, this.buffer);
    }

    private log(level: LogLevel, message: string, data?: unknown): void {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            namespace: this.namespace,
            message,
            data
        };

        // 写入内存环形缓冲区
        this.buffer.push(entry);

        // 控制台过滤输出
        if (LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[Logger._globalMinLevel]) {
            const timeStr = new Date(entry.timestamp).toLocaleTimeString();
            const prefix = `[ST-DA] [${timeStr}] [${level}] [${this.namespace}] ${message}`;

            if (level === 'ERROR') {
                data !== undefined ? console.error(prefix, data) : console.error(prefix);
            } else if (level === 'WARN') {
                data !== undefined ? console.warn(prefix, data) : console.warn(prefix);
            } else if (level === 'INFO') {
                data !== undefined ? console.info(prefix, data) : console.info(prefix);
            } else {
                data !== undefined ? console.debug(prefix, data) : console.debug(prefix);
            }
        }
    }

    public debug(message: string, data?: unknown): void {
        this.log('DEBUG', message, data);
    }

    public info(message: string, data?: unknown): void {
        this.log('INFO', message, data);
    }

    public warn(message: string, data?: unknown): void {
        this.log('WARN', message, data);
    }

    public error(message: string, data?: unknown): void {
        this.log('ERROR', message, data);
    }
}
