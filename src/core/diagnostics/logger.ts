/**
 * @module core/diagnostics/logger
 * @description 命名空间分级日志器 (DEBUG / INFO / WARN / ERROR)
 */

import { LogBuffer, LogEntry } from './log-buffer';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

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
export class Logger implements ILogger {
    private static _globalBuffer = new LogBuffer(1500);
    private static _globalMinLevel: LogLevel = 'INFO';

    public readonly namespace: string;
    public readonly buffer: LogBuffer;

    constructor(namespace = 'Core', buffer?: LogBuffer) {
        this.namespace = namespace;
        this.buffer = buffer || Logger._globalBuffer;
    }

    public static setMinLogLevel(level: LogLevel): void {
        Logger._globalMinLevel = level;
    }

    public static getGlobalBuffer(): LogBuffer {
        return Logger._globalBuffer;
    }

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

        this.buffer.push(entry);

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
