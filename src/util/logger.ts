/**
 * 分级格式化日志工具与诊断缓冲区
 *
 * 功能：
 * 1. 提供带有统一插件前缀与模块命名空间的日志分级输出 (DEBUG, INFO, WARN, ERROR)；
 * 2. 维护固定容量的内存环形日志缓冲区 (LogBuffer)，记录近期诊断信息供 UI 运行日志查看；
 * 3. 支持全局日志级别动态调整，过滤不需要的低优先级日志。
 *
 * Tips：
 * 1. 环形缓冲区限制：内存缓冲区采用固定上限 (默认 200 条) 自动轮转，防止长期运行耗尽内存；
 * 2. 日志级别：生产环境默认使用 INFO 或 WARN，避免控制台产生冗余日志。
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

export interface LogEntry {
    timestamp: number;
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    namespace: string;
    message: string;
}

/**
 * 内存固定容量环形缓冲区，防止长期运行导致日志占用过多内存。
 */
export class LogBuffer {
    private readonly _capacity: number;
    private readonly _entries: LogEntry[] = [];

    constructor(capacity: number = 500) {
        this._capacity = Math.max(1, capacity);
    }

    public push(entry: LogEntry): void {
        if (this._entries.length >= this._capacity) {
            this._entries.shift();
        }
        this._entries.push(entry);
    }

    public getAll(): readonly LogEntry[] {
        return [...this._entries];
    }

    public clear(): void {
        this._entries.length = 0;
    }

    public get size(): number {
        return this._entries.length;
    }
}

export class Logger {
    private readonly _tag: string;
    private static _globalLevel: LogLevel = LogLevel.DEBUG;
    private static readonly _globalBuffer = new LogBuffer(500);
    private static readonly PREFIX = '[ST-DrawAssistant]';

    constructor(tag: string) {
        this._tag = tag;
    }

    public static setLogLevel(level: LogLevel): void {
        Logger._globalLevel = level;
    }

    public static getLogLevel(): LogLevel {
        return Logger._globalLevel;
    }

    public static getGlobalBuffer(): LogBuffer {
        return Logger._globalBuffer;
    }

    private formatMessage(message: string, args: unknown[]): string {
        if (args.length === 0) return message;
        const extra = args
            .map((arg) => {
                if (arg instanceof Error) {
                    return arg.stack || arg.message;
                }
                if (typeof arg === 'object' && arg !== null) {
                    try {
                        return JSON.stringify(arg);
                    } catch {
                        return String(arg);
                    }
                }
                return String(arg);
            })
            .join(' ');
        return `${message} ${extra}`;
    }

    private record(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, args: unknown[]): string {
        const fullMsg = this.formatMessage(message, args);
        Logger._globalBuffer.push({
            timestamp: Date.now(),
            level,
            namespace: this._tag,
            message: fullMsg
        });
        return fullMsg;
    }

    public debug(message: string, ...args: unknown[]): void {
        this.record('DEBUG', message, args);
        if (Logger._globalLevel <= LogLevel.DEBUG) {
            console.debug(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }

    public info(message: string, ...args: unknown[]): void {
        this.record('INFO', message, args);
        if (Logger._globalLevel <= LogLevel.INFO) {
            console.info(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }

    public warn(message: string, ...args: unknown[]): void {
        this.record('WARN', message, args);
        if (Logger._globalLevel <= LogLevel.WARN) {
            console.warn(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }

    public error(message: string, ...args: unknown[]): void {
        this.record('ERROR', message, args);
        if (Logger._globalLevel <= LogLevel.ERROR) {
            console.error(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }
}
