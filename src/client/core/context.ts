/**
 * @module core/context
 * @description 客户端基础设施层服务容器
 */

import { IDisposable, CoreEventMap } from './types';
import { Logger } from './logger';
import { TypedEventBus } from './event-bus';
import { ConfigStore } from './config';
import { StorageService } from './storage';
import { HostClient } from './host';
import { NetworkClient } from './network';

/**
 * 基础设施层服务容器
 * 集中装配底层各服务单例，并在扩展卸载时按反向依赖顺序安全释放资源
 */
export class CoreContext implements IDisposable {
    public readonly host: HostClient;
    public readonly events: TypedEventBus<CoreEventMap>;
    public readonly store: ConfigStore;
    public readonly storage: StorageService;
    public readonly network: NetworkClient;
    public readonly logger = new Logger('CoreContext');

    private readonly _disposables: IDisposable[] = [];
    private _isDisposed = false;

    constructor(initialSettingsOverride?: unknown) {
        this.host = new HostClient();
        this.events = new TypedEventBus<CoreEventMap>();

        // 建立配置持久化与广播通道：变更时经由宿主上下文防抖写入并派发总线事件
        const initialSettings = initialSettingsOverride ?? this.host.getExtensionSettings();
        this.store = new ConfigStore(initialSettings, {
            onSave: (state) => {
                this.host.saveExtensionSettings(state as unknown as Record<string, unknown>);
                this.events.emit('settings:changed', { settings: state });
            }
        });

        this.storage = new StorageService();

        this.network = new NetworkClient({
            csrfHeadersProvider: () => this.host.getRequestHeaders(),
            getProxyMode: () => this.store.get('requestMode')
        });

        this.addDisposable(this.host);
        this.addDisposable(this.events);
        this.addDisposable(this.store);
        this.addDisposable(this.storage);

        this.addDisposable(
            this.host.onChatChanged((chatId) => {
                // 会话切换时释放临时图片 Object URL 资源
                this.storage.revokeAllUrls();
                this.events.emit('chat:changed', { chatId });
            })
        );
    }

    /** 向上下文注册受管的 IDisposable 实例 */
    public addDisposable<T extends IDisposable>(disposable: T): T {
        if (this._isDisposed) {
            disposable.dispose();
        } else {
            this._disposables.push(disposable);
        }
        return disposable;
    }

    /** 释放基础设施层所有托管服务与资源 */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this.logger.info('正在释放 Core 基础设施层资源...');

        for (const d of this._disposables.reverse()) {
            try {
                d.dispose();
            } catch (err) {
                this.logger.error('释放资源项异常', err);
            }
        }
        this._disposables.length = 0;
    }
}

/** 创建并初始化基础设施层上下文实例 */
export function createCoreContext(initialSettings?: unknown): CoreContext {
    return new CoreContext(initialSettings);
}
