/**
 * @module core/diagnostics/log-buffer
 * @description 内存循环日志缓冲实现 (支持定长环形队列与系统诊断包导出)
 */
export interface LogEntry {
    readonly timestamp: number;
    readonly level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    readonly namespace: string;
    readonly message: string;
    readonly data?: unknown;
}
/**
 * 内存环形日志缓冲器
 */
export declare class LogBuffer {
    private readonly _buffer;
    private readonly _maxSize;
    constructor(maxSize?: number);
    /**
     * 追加一条日志记录
     */
    push(entry: LogEntry): void;
    /**
     * 获取当前所有缓冲日志
     */
    getAll(): readonly LogEntry[];
    /**
     * 按命名空间或等级过滤日志
     */
    query(options?: {
        level?: string;
        namespace?: string;
        limit?: number;
    }): LogEntry[];
    /**
     * 清空缓冲区
     */
    clear(): void;
    /**
     * 导出为结构化诊断 JSON 文本
     */
    exportDiagnosticDump(): string;
}
//# sourceMappingURL=log-buffer.d.ts.map