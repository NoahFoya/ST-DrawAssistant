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
export declare class LogBuffer {
    private readonly _buffer;
    private readonly _maxSize;
    constructor(maxSize?: number);
    push(entry: LogEntry): void;
    getAll(): readonly LogEntry[];
    query(options?: {
        level?: string;
        namespace?: string;
        limit?: number;
    }): LogEntry[];
    clear(): void;
    /** 导出为结构化诊断快照 JSON 文本 */
    exportDiagnosticDump(): string;
}
//# sourceMappingURL=log-buffer.d.ts.map