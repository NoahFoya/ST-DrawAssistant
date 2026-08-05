/**
 * @module core/logger
 * @description ST-DrawAssistant 全局结构化日志系统 (Structured Logger)
 *
 * 职责：
 * - 提供 TRACE / DEBUG / INFO / WARN / ERROR / FATAL 6 级结构化日志
 * - 标准 JSON 数据结构对象记录，支持双模格式（控制台单行输出 + 内存环形缓冲区完整对象）
 * - 动态日志级别控制与控制台 window.__DA.setLogLevel() 临时覆盖能力
 * - 提供 JSON 与纯文本格式导出及持久化钩子
 */

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    TRACE: 0,
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4,
    FATAL: 5,
};


export interface LogErrorDetails {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
}

export interface StructuredLogEntry {
    id: string;
    timestamp: string; // ISO 8601
    level: LogLevel;
    module: string;
    message: string;
    taskId?: string;
    sessionId: string;
    context?: Record<string, unknown>;
    error?: LogErrorDetails;
}

export type LogListener = (entry: StructuredLogEntry) => void;
export type LogPersistHook = (entry: StructuredLogEntry) => void;

const SESSION_ID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : `sess_${Date.now().toString(36).slice(-4)}`;

class Logger {
    private logs: StructuredLogEntry[] = [];
    private maxCapacity = 500;
    private listeners: Set<LogListener> = new Set();
    private persistHook: LogPersistHook | null = null;
    private currentLogLevel: LogLevel = 'WARN';

    constructor() {
        this.mountGlobalHelper();
    }

    /**
     * 挂载日志持久化钩子回调（依赖注入，保持 Core 模块纯洁性）
     */
    public setPersistHook(hook: LogPersistHook | null): void {
        this.persistHook = hook;
    }

    /**
     * 动态设定运行期日志级别
     */
    public setLogLevel(level: LogLevel): void {
        this.currentLogLevel = level;
        this.info(`日志级别已动态调整为: ${level}`, { level }, 'Logger');
    }

    /**
     * 获取当前系统生效的日志级别
     */
    public getLogLevel(): LogLevel {
        return this.currentLogLevel;
    }

    /** TRACE 细粒度协议追溯 */
    public trace(message: string, context?: unknown, moduleName = 'App', taskId?: string): void {
        this.log('TRACE', message, context, moduleName, taskId);
    }

    /** DEBUG 调试信息 */
    public debug(message: string, context?: unknown, moduleName = 'App', taskId?: string): void {
        this.log('DEBUG', message, context, moduleName, taskId);
    }

    /** INFO 运行状态信息 */
    public info(message: string, context?: unknown, moduleName = 'App', taskId?: string): void {
        this.log('INFO', message, context, moduleName, taskId);
    }

    /** WARN 业务警告信息 */
    public warn(message: string, context?: unknown, moduleName = 'App', taskId?: string): void {
        this.log('WARN', message, context, moduleName, taskId);
    }

    /** ERROR 异常与操作失败 */
    public error(message: string, context?: unknown, moduleName = 'App', taskId?: string): void {
        this.log('ERROR', message, context, moduleName, taskId);
    }

    /** FATAL 致命错误 */
    public fatal(message: string, context?: unknown, moduleName = 'App', taskId?: string): void {
        this.log('FATAL', message, context, moduleName, taskId);
    }

    /**
     * 核心日志记录入口
     */
    private log(
        level: LogLevel,
        message: string,
        rawContext?: unknown,
        moduleName = 'App',
        taskId?: string
    ): void {
        // 1. 日志级别过滤校验
        if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.currentLogLevel]) {
            return;
        }

        // 2. 解析上下文与 Error 对象
        let contextObj: Record<string, unknown> | undefined;
        let errorObj: LogErrorDetails | undefined;

        if (rawContext instanceof Error) {
            errorObj = {
                name: rawContext.name,
                message: rawContext.message,
                stack: rawContext.stack,
            };
        } else if (typeof rawContext === 'object' && rawContext !== null) {
            contextObj = rawContext as Record<string, unknown>;
            if (rawContext instanceof Error || (rawContext as { stack?: string }).stack) {
                const err = rawContext as Error;
                errorObj = {
                    name: err.name || 'Error',
                    message: err.message || String(rawContext),
                    stack: err.stack,
                };
            }
        } else if (rawContext !== undefined) {
            contextObj = { details: rawContext };
        }

        const entry: StructuredLogEntry = {
            id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            level,
            module: moduleName,
            message,
            taskId,
            sessionId: SESSION_ID,
            context: contextObj,
            error: errorObj,
        };

        // 3. 入推内存环形缓冲区
        this.logs.push(entry);
        if (this.logs.length > this.maxCapacity) {
            this.logs.shift();
        }

        // 4. 控制台双模格式化输出
        this.printConsole(entry);

        // 5. 推送给订阅 listener（ Diagnostics 选项卡等）
        this.listeners.forEach(cb => {
            try {
                cb(entry);
            } catch {
                // 忽略推流回调异常
            }
        });

        // 6. 若配置了持久化钩子，触发异步保存
        if (this.persistHook) {
            try {
                this.persistHook(entry);
            } catch {
                // 忽略持久化回调异常
            }
        }
    }

    /**
     * 控制台日志渲染
     */
    private printConsole(entry: StructuredLogEntry): void {
        const timeStr = entry.timestamp.substring(11, 19);
        const taskTag = entry.taskId ? ` | taskId=${entry.taskId}` : '';
        const prefix = `[ST-DA] [${timeStr}] [${entry.level}] [${entry.module}] ${entry.message}${taskTag}`;

        const payload = entry.error || entry.context || '';

        switch (entry.level) {
            case 'TRACE':
            case 'DEBUG':
                console.debug(prefix, payload);
                break;
            case 'INFO':
                console.log(prefix, payload);
                break;
            case 'WARN':
                console.warn(prefix, payload);
                break;
            case 'ERROR':
            case 'FATAL':
                console.error(prefix, payload);
                break;
        }
    }

    /**
     * 按条件获取结构化日志数组
     */
    public getLogs(levelFilter?: LogLevel | 'ALL', limit?: number): StructuredLogEntry[] {
        let result = this.logs;
        if (levelFilter && levelFilter !== 'ALL') {
            const minPriority = LOG_LEVEL_PRIORITY[levelFilter];
            result = this.logs.filter(l => LOG_LEVEL_PRIORITY[l.level] >= minPriority);
        }
        if (limit && limit > 0) {
            return result.slice(-limit);
        }
        return [...result];
    }

    /** 清空内存日志 */
    public clear(): void {
        this.logs = [];
    }

    /** 订阅日志推流 */
    public subscribe(listener: LogListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** 导出纯文本人类可读日志 */
    public exportToText(): string {
        const header = `====================================================\nST-DrawAssistant Structured Log Export\nExported At: ${new Date().toISOString()}\nSession ID: ${SESSION_ID}\nTotal Entries: ${this.logs.length}\n====================================================\n\n`;
        const lines = this.logs.map(l => {
            const ctxStr = l.context ? ` | Context: ${JSON.stringify(l.context)}` : '';
            const errStr = l.error ? ` | Error: ${l.error.name}: ${l.error.message}` : '';
            return `[${l.timestamp}] [${l.level.padEnd(5)}] [${l.module}] ${l.message}${ctxStr}${errStr}`;
        });
        return header + lines.join('\n');
    }

    /** 导出完整 JSON 结构化日志 */
    public exportToJson(): string {
        return JSON.stringify(this.logs, null, 2);
    }

    /**
     * 挂载 __DA 到 window 对象，方便控制台直接输入命令调试
     */
    private mountGlobalHelper(): void {
        if (typeof window !== 'undefined') {
            (window as unknown as { __DA?: Record<string, unknown> }).__DA = {
                setLogLevel: (level: LogLevel) => this.setLogLevel(level),
                getLogLevel: () => this.getLogLevel(),
                getLogs: (filter?: LogLevel | 'ALL') => this.getLogs(filter),
                clearLogs: () => this.clear(),
                exportLogs: () => this.exportToJson(),
            };
        }
    }
}

export const logger = new Logger();
