/**
 * 内存环形日志缓冲器
 * 限制最大保留条数，超出上限时丢弃最旧记录，防止内存持续膨胀。
 */

export interface LogEntry {
    readonly timestamp: number;
    readonly level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    readonly namespace: string;
    readonly message: string;
    readonly data?: unknown;
}

export interface LogInputEntry {
    readonly timestamp: number;
    readonly level?: string;
    readonly namespace?: string;
    readonly module?: string;
    readonly message: string;
    readonly data?: unknown;
}

export class LogBuffer {
    private readonly _buffer: LogEntry[] = [];
    private readonly _maxSize: number;
    private readonly _subscribers = new Set<(entry: LogEntry) => void>();

    constructor(maxSize = 500) {
        this._maxSize = maxSize;
    }

    public get size(): number {
        return this._buffer.length;
    }

    public push(entry: LogInputEntry): void {
        const normalizedLevel = (entry.level || 'INFO').toUpperCase() as LogEntry['level'];
        const normalizedEntry: LogEntry = {
            timestamp: entry.timestamp,
            level: normalizedLevel,
            namespace: entry.namespace || entry.module || 'System',
            message: entry.message,
            data: entry.data
        };

        if (this._buffer.length >= this._maxSize) {
            this._buffer.shift();
        }
        this._buffer.push(normalizedEntry);

        for (const listener of this._subscribers) {
            try {
                listener(normalizedEntry);
            } catch {
                // 忽略单个监听器的异常，避免影响其他监听器接收日志
            }
        }
    }

    public getAll(): readonly LogEntry[] {
        return this._buffer;
    }

    public query(options?: { level?: string; keyword?: string; namespace?: string; module?: string; limit?: number }): LogEntry[] {
        let list = this._buffer;
        if (options?.level && options.level.toUpperCase() !== 'ALL') {
            const targetLevel = options.level.toUpperCase();
            list = list.filter((e) => e.level === targetLevel);
        }
        const targetModule = options?.namespace || options?.module;
        if (targetModule) {
            const modLower = targetModule.toLowerCase();
            list = list.filter((e) => e.namespace.toLowerCase() === modLower);
        }
        if (options?.keyword) {
            const kw = options.keyword.toLowerCase();
            list = list.filter((e) => {
                const text = `${e.namespace} ${e.message} ${e.level}`.toLowerCase();
                return text.includes(kw);
            });
        }
        if (options?.limit && options.limit > 0) {
            list = list.slice(-options.limit);
        }
        return list;
    }

    public subscribe(listener: (entry: LogEntry) => void): () => void {
        this._subscribers.add(listener);
        return () => {
            this._subscribers.delete(listener);
        };
    }

    public clear(): void {
        this._buffer.length = 0;
    }
}
