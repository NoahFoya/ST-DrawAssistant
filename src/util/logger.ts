/**
 * 分级日志记录器与只读调试缓冲区 (Logger)。
 *
 * @remarks
 * 架构规范与内存占用保护：
 * 1. 控制台分级规范输出：统一携带 `[ST-DrawAssistant]` 前缀，依据 minLevel 路由至 console.debug / info / warn / error；
 * 2. 内存环形缓冲区 (Circular Buffer)：限制最大保留条目（默认 200 条），超出容量自动先进先出丢弃最旧记录，
 *    既支持设置面板调试视图实时查看与划词导出，又避免长期运行导致内存持续占用；
 * 3. 实时响应式订阅：提供 onLog 监听订阅，方便 UI 诊断组件挂载与实时日志流展示。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 单条日志记录数据结构 */
export interface LogEntry {
    /** 日志生成时间戳，单位毫秒 */
    readonly timestamp: number;
    /** 日志级别 */
    readonly level: LogLevel;
    /** 日志描述信息 */
    readonly message: string;
    /** 附加详情数据 */
    readonly details?: unknown[];
}

/** 日志记录器配置项 */
export interface LoggerOptions {
    /** 控制台输出最低可见级别，默认为 'info' */
    minLevel?: LogLevel;
    /** 环形缓冲区最大保留条目数，默认为 200 */
    maxBufferSize?: number;
    /** 控制台日志前缀，默认为 '[ST-DrawAssistant]' */
    prefix?: string;
}

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

/**
 * 分级日志记录器实现类。
 */
export class Logger {
    private _minLevel: LogLevel;
    private readonly _maxBufferSize: number;
    private readonly _prefix: string;
    private readonly _buffer: LogEntry[] = [];
    private readonly _listeners = new Set<(entry: LogEntry) => void>();

    public constructor(options: LoggerOptions = {}) {
        this._minLevel = options.minLevel ?? 'info';
        this._maxBufferSize = options.maxBufferSize ?? 200;
        this._prefix = options.prefix ?? '[ST-DrawAssistant]';
    }

    /** 设置控制台输出的最低日志级别 */
    public setLogLevel(level: LogLevel): void {
        this._minLevel = level;
    }

    /** 获取当前生效的最低日志级别 */
    public getLogLevel(): LogLevel {
        return this._minLevel;
    }

    /**
     * 订阅实时日志产生事件。
     * @param listener 单条日志回调
     * @returns 解绑函数
     */
    public onLog(listener: (entry: LogEntry) => void): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** 输出调试级别日志 */
    public debug(message: string, ...details: unknown[]): void {
        this._log('debug', message, details);
    }

    /** 输出信息级别日志 */
    public info(message: string, ...details: unknown[]): void {
        this._log('info', message, details);
    }

    /** 输出警告级别日志 */
    public warn(message: string, ...details: unknown[]): void {
        this._log('warn', message, details);
    }

    /** 输出错误级别日志 */
    public error(message: string, ...details: unknown[]): void {
        this._log('error', message, details);
    }

    /**
     * 按时间升序获取最近记录的日志条目。
     * @param limit 返回的最大条数，缺省返回全部缓冲条目
     */
    public getRecentLogs(limit?: number): LogEntry[] {
        if (typeof limit === 'number' && limit > 0) {
            return this._buffer.slice(-limit);
        }
        return [...this._buffer];
    }

    /** 清空内存中的日志缓冲区 */
    public clearLogs(): void {
        this._buffer.length = 0;
    }

    private _log(level: LogLevel, message: string, details: unknown[]): void {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            message,
            details: details.length > 0 ? details : undefined,
        };

        // 维护内存环形缓冲区容量上限
        if (this._buffer.length >= this._maxBufferSize) {
            this._buffer.shift();
        }
        this._buffer.push(entry);

        // 广播至实时日志流监听器
        for (const listener of this._listeners) {
            try {
                listener(entry);
            } catch (listenerErr) {
                console.error('[Logger] 监听器执行异常:', listenerErr);
            }
        }

        // 控制台级别过滤
        if (LEVEL_WEIGHTS[level] < LEVEL_WEIGHTS[this._minLevel]) {
            return;
        }

        const formatted = `${this._prefix} [${level.toUpperCase()}] ${message}`;
        switch (level) {
            case 'debug':
                console.debug(formatted, ...details);
                break;
            case 'info':
                console.info(formatted, ...details);
                break;
            case 'warn':
                console.warn(formatted, ...details);
                break;
            case 'error':
                console.error(formatted, ...details);
                break;
        }
    }
}

/** 全局默认单例日志记录器 */
export const logger = new Logger();
