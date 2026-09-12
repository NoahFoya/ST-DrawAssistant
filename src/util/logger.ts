/**
 * 分级格式化日志工具与诊断缓冲区
 * 提供带命名空间的前缀输出，并在内存中保留近期日志用于故障排查。
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
