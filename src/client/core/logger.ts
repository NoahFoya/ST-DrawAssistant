/**
 * @module core/logger
 * @description 统一分级格式化日志工具
 */

import { LogLevel } from './types';

/**
 * 统一带前缀与模块标识的调试日志输出工具
 * 规范化格式为 `[ST-DrawAssistant][ModuleTag] message`
 */
export class Logger {
    private readonly _tag: string;
    private static _globalLevel: LogLevel = LogLevel.DEBUG;
    private static readonly PREFIX = '[ST-DrawAssistant]';

    constructor(tag: string) {
        this._tag = tag;
    }

    /** 动态调整全局日志过滤级别 */
    public static setLogLevel(level: LogLevel): void {
        Logger._globalLevel = level;
    }

    public debug(message: string, ...args: unknown[]): void {
        if (Logger._globalLevel <= LogLevel.DEBUG) {
            console.debug(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }

    public info(message: string, ...args: unknown[]): void {
        if (Logger._globalLevel <= LogLevel.INFO) {
            console.info(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }

    public warn(message: string, ...args: unknown[]): void {
        if (Logger._globalLevel <= LogLevel.WARN) {
            console.warn(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }

    public error(message: string, ...args: unknown[]): void {
        if (Logger._globalLevel <= LogLevel.ERROR) {
            console.error(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }
}
