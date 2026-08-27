/**
 * @module core/diagnostics/log-buffer
 * @description 内存定长环形日志缓冲器
 */

export interface LogEntry {
    readonly timestamp: number;
    readonly level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    readonly namespace: string;
    readonly message: string;
    readonly data?: unknown;
}

/** 内存环形日志缓冲器 (用于排障分析与诊断包导出) */
export class LogBuffer {
    private readonly _buffer: LogEntry[] = [];
    private readonly _maxSize: number;

    constructor(maxSize = 1000) {
        this._maxSize = maxSize;
    }

    public push(entry: LogEntry): void {
        if (this._buffer.length >= this._maxSize) {
            this._buffer.shift();
        }
        this._buffer.push(entry);
    }

    public getAll(): readonly LogEntry[] {
        return this._buffer;
    }

    public query(options?: { level?: string; namespace?: string; limit?: number }): LogEntry[] {
        let list = this._buffer;
        if (options?.level) {
            list = list.filter((e) => e.level === options.level);
        }
        if (options?.namespace) {
            list = list.filter((e) => e.namespace.startsWith(options.namespace!));
        }
        if (options?.limit && options.limit > 0) {
            list = list.slice(-options.limit);
        }
        return list;
    }

    public clear(): void {
        this._buffer.length = 0;
    }

    /** 导出为结构化诊断快照 JSON 文本 */
    public exportDiagnosticDump(): string {
        const payload = {
            exportTime: new Date().toISOString(),
            totalLogs: this._buffer.length,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js',
            logs: this._buffer
        };
        return JSON.stringify(payload, null, 2);
    }
}
