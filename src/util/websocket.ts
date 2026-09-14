/**
 * WebSocket 长连接客户端 (WebSocketClient)
 *
 * 核心功能：
 * 1. 建立与远端长连接信道（如 ComfyUI 进度推送），支持文本与二进制帧数据解析；
 * 2. 提供可配置的心跳检测与半开连接主动断开与资源清理机制；
 * 3. 实现带有随机抖动 (Jitter) 的指数退避断线自动重连；
 * 4. 维护连接就绪状态，阻断非法连接态下的消息发送。
 *
 * 注意事项：
 * 1. 主动关闭连接或组件销毁时必须彻底清理所有心跳计时器与内部回调，防止内存泄漏；
 * 2. 避免在不可恢复的握手失败场景中持续死循环重连。
 */

import { Logger } from './logger';

export interface WebSocketClientOptions {
    url: string;
    /** 心跳发送间隔毫秒数，默认 15000ms */
    heartbeatIntervalMs?: number;
    /** 心跳响应等待超时毫秒数，超出后判定半开并强制断开，默认 5000ms */
    pongTimeoutMs?: number;
    /** 心跳消息内容，若为空则不发送数据仅做静默连接检测 */
    pingPayload?: string;
    /** 最大自动重连次数，默认 10 */
    reconnectMaxAttempts?: number;
    /** 重连初始基准退避时间毫秒数，默认 1000ms */
    reconnectBaseDelayMs?: number;
    /** 重连最大退避时间毫秒数，默认 15000ms */
    reconnectMaxDelayMs?: number;
}

export type WebSocketMessageHandler = (data: unknown, raw: MessageEvent) => void;
export type WebSocketStateChangeHandler = (isOpen: boolean) => void;

export class ResilientWebSocket {
    private readonly _logger = new Logger('ResilientWebSocket');
    private readonly _options: Required<WebSocketClientOptions>;

    private _ws: WebSocket | null = null;
    private _isExplicitDisconnect = false;
    private _reconnectAttempt = 0;
    private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private _heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    private _pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly _messageHandlers = new Set<WebSocketMessageHandler>();
    private readonly _stateHandlers = new Set<WebSocketStateChangeHandler>();

    constructor(options: WebSocketClientOptions) {
        this._options = {
            url: options.url,
            heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15000,
            pongTimeoutMs: options.pongTimeoutMs ?? 5000,
            pingPayload: options.pingPayload ?? '{"type":"ping"}',
            reconnectMaxAttempts: options.reconnectMaxAttempts ?? 10,
            reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? 1000,
            reconnectMaxDelayMs: options.reconnectMaxDelayMs ?? 15000
        };
    }

    public get isOpen(): boolean {
        const openState = typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number' ? WebSocket.OPEN : 1;
        return this._ws !== null && this._ws.readyState === openState;
    }

    public get readyState(): number {
        const closedState = typeof WebSocket !== 'undefined' && typeof WebSocket.CLOSED === 'number' ? WebSocket.CLOSED : 3;
        return this._ws ? this._ws.readyState : closedState;
    }

    /**
     * 建立连接。返回 Promise，首次成功连接或重试耗尽时 resolve / reject。
     */
    public connect(): Promise<void> {
        this._isExplicitDisconnect = false;
        return new Promise<void>((resolve, reject) => {
            let settled = false;

            const handleFirstOpen = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };

            const handleFirstError = (_ev: unknown) => {
                if (!settled) {
                    settled = true;
                    reject(new Error(`WebSocket 连接失败 [${this._options.url}]`));
                }
            };

            this.internalConnect(handleFirstOpen, handleFirstError);
        });
    }

    private internalConnect(onFirstOpen?: () => void, onFirstError?: (ev: unknown) => void): void {
        this.clearTimers();

        try {
            this._ws = new WebSocket(this._options.url);
        } catch (err) {
            this._logger.error(`创建底层 WebSocket 实例失败 [${this._options.url}]`, err);
            onFirstError?.(err);
            this.scheduleReconnect();
            return;
        }

        this._ws.onopen = () => {
            this._logger.info(`WebSocket 连接成功 [${this._options.url}]`);
            this._reconnectAttempt = 0;
            this.startHeartbeat();
            this.notifyStateChange(true);
            onFirstOpen?.();
        };

        this._ws.onmessage = (event: MessageEvent) => {
            this.resetPongTimeout();

            let parsed: unknown = event.data;
            if (typeof event.data === 'string') {
                try {
                    parsed = JSON.parse(event.data);
                } catch {
                    parsed = event.data;
                }
            }

            for (const handler of this._messageHandlers) {
                try {
                    handler(parsed, event);
                } catch (handlerErr) {
                    this._logger.error('消息回调执行异常', handlerErr);
                }
            }
        };

        this._ws.onerror = (event: Event) => {
            this._logger.warn(`WebSocket 传输层异常 [${this._options.url}]`);
            onFirstError?.(event);
        };

        this._ws.onclose = (event: CloseEvent) => {
            this._logger.info(`WebSocket 连接关闭 (code: ${event.code}, reason: ${event.reason || '无'})`);
            this.cleanupCurrentSocket();
            this.notifyStateChange(false);

            if (!this._isExplicitDisconnect) {
                this.scheduleReconnect();
            }
        };
    }

    /**
     * 发送数据。严格检验 readyState，非 OPEN 状态拒绝发送并抛出异常。
     */
    public send(data: string | ArrayBuffer | Blob): void {
        if (!this.isOpen || !this._ws) {
            throw new Error(`无法发送消息: WebSocket 处于未就绪状态 (readyState=${this.readyState})`);
        }
        this._ws.send(data);
    }

    /**
     * 订阅消息分发。返回注销函数。
     */
    public onMessage(handler: WebSocketMessageHandler): () => void {
        this._messageHandlers.add(handler);
        return () => {
            this._messageHandlers.delete(handler);
        };
    }

    /**
     * 订阅连接状态切换。返回注销函数。
     */
    public onStateChange(handler: WebSocketStateChangeHandler): () => void {
        this._stateHandlers.add(handler);
        return () => {
            this._stateHandlers.delete(handler);
        };
    }

    /**
     * 启动应用层心跳检测。
     */
    private startHeartbeat(): void {
        if (this._options.heartbeatIntervalMs <= 0) return;

        this._heartbeatTimer = setTimeout(() => {
            if (!this.isOpen) return;

            if (this._options.pingPayload) {
                try {
                    this.send(this._options.pingPayload);
                } catch {
                    // 若发送失败，等待后续 close 处理
                }
            }

            // 启动 pong 超时等待计时器，若在指定时间内未收到任何服务端响应，强断半开连接
            this._pongTimeoutTimer = setTimeout(() => {
                this._logger.warn(`心跳响应超时 (${this._options.pongTimeoutMs}ms)，判定为半开连接，强制重连`);
                if (this._ws) {
                    this._ws.close();
                }
            }, this._options.pongTimeoutMs);

            // 递归调度下一次心跳
            this.startHeartbeat();
        }, this._options.heartbeatIntervalMs);
    }

    private resetPongTimeout(): void {
        if (this._pongTimeoutTimer) {
            clearTimeout(this._pongTimeoutTimer);
            this._pongTimeoutTimer = null;
        }
    }

    /**
     * 调度断线指数退避重连。
     */
    private scheduleReconnect(): void {
        if (this._isExplicitDisconnect) return;

        if (this._reconnectAttempt >= this._options.reconnectMaxAttempts) {
            this._logger.error(`已达到最大重连次数 (${this._options.reconnectMaxAttempts})，停止自动重连 [${this._options.url}]`);
            return;
        }

        this._reconnectAttempt++;
        const expDelay = this._options.reconnectBaseDelayMs * Math.pow(2, this._reconnectAttempt - 1);
        const jitter = Math.random() * 300;
        const delay = Math.min(this._options.reconnectMaxDelayMs, expDelay) + jitter;

        this._logger.info(`将在 ${Math.round(delay)}ms 后执行第 ${this._reconnectAttempt}/${this._options.reconnectMaxAttempts} 次重连...`);

        this._reconnectTimer = setTimeout(() => {
            this.internalConnect();
        }, delay);
    }

    private notifyStateChange(isOpen: boolean): void {
        for (const handler of this._stateHandlers) {
            try {
                handler(isOpen);
            } catch (err) {
                this._logger.error('状态变化回调执行异常', err);
            }
        }
    }

    private clearTimers(): void {
        if (this._heartbeatTimer) {
            clearTimeout(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        if (this._pongTimeoutTimer) {
            clearTimeout(this._pongTimeoutTimer);
            this._pongTimeoutTimer = null;
        }
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    private cleanupCurrentSocket(): void {
        this.clearTimers();
        if (this._ws) {
            this._ws.onopen = null;
            this._ws.onmessage = null;
            this._ws.onerror = null;
            this._ws.onclose = null;
            this._ws = null;
        }
    }

    /**
     * 主动断开连接并释放所有内部资源。
     */
    public disconnect(): void {
        this._isExplicitDisconnect = true;
        this.clearTimers();

        if (this._ws) {
            try {
                this._ws.close(1000, 'Normal Closure');
            } catch {}
            this.cleanupCurrentSocket();
        }

        this.notifyStateChange(false);
        this._messageHandlers.clear();
        this._stateHandlers.clear();
        this._logger.info(`WebSocket 已主动断开并清理所有资源 [${this._options.url}]`);
    }
}
