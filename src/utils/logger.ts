/**
 * 分级格式化日志工具
 */

import { LogLevel } from '../types/common';
import { LogBuffer } from './log-buffer';

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

    public static getGlobalBuffer(): LogBuffer {
        return Logger._globalBuffer;
    }

    private formatArgs(message: string, args: unknown[]): string {
        if (args.length === 0) return message;
        const extra = args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        return `${message} ${extra}`;
    }

    public debug(message: string, ...args: unknown[]): void {
        const fullMsg = this.formatArgs(message, args);
        Logger._globalBuffer.push({
            timestamp: Date.now(),
            level: 'DEBUG',
            namespace: this._tag,
            message: fullMsg
        });

        if (Logger._globalLevel <= LogLevel.DEBUG) {
            console.debug(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }

    public info(message: string, ...args: unknown[]): void {
        const fullMsg = this.formatArgs(message, args);
        Logger._globalBuffer.push({
            timestamp: Date.now(),
            level: 'INFO',
            namespace: this._tag,
            message: fullMsg
        });

        if (Logger._globalLevel <= LogLevel.INFO) {
            console.info(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }

    public warn(message: string, ...args: unknown[]): void {
        const fullMsg = this.formatArgs(message, args);
        Logger._globalBuffer.push({
            timestamp: Date.now(),
            level: 'WARN',
            namespace: this._tag,
            message: fullMsg
        });

        if (Logger._globalLevel <= LogLevel.WARN) {
            console.warn(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }

    public error(message: string, ...args: unknown[]): void {
        const fullMsg = this.formatArgs(message, args);
        Logger._globalBuffer.push({
            timestamp: Date.now(),
            level: 'ERROR',
            namespace: this._tag,
            message: fullMsg
        });

        if (Logger._globalLevel <= LogLevel.ERROR) {
            console.error(`${Logger.PREFIX}[${this._tag}]`, message, ...args);
        }
    }
}
