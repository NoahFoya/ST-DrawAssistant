/**
 * @module core/context
 * @description 基础设施层核心服务容器
 */

import { IDisposable, CoreEventMap } from './types';
import { Logger } from './logging/logger';
import { TypedEventBus } from './events/event-bus';
import { ConfigStore } from './config/config-store';
import { ConfigSyncService } from './config/config-sync';
import { StorageService } from './storage/storage-service';
import { HostFacade } from './host/host-facade';
import { TransportService } from './transport/transport-service';

/**
 * 基础设施层服务容器
 * 集中装配底层各服务单例，并在扩展卸载时按反向依赖顺序安全释放资源
 */
export class CoreContext implements IDisposable {
    public readonly host: HostFacade;
    public readonly events: TypedEventBus<CoreEventMap>;
    public readonly store: ConfigStore;
    public readonly configSync: ConfigSyncService;
    public readonly storage: StorageService;
    public readonly transport: TransportService;
    public readonly logger = new Logger('CoreContext');

    private readonly _disposables: IDisposable[] = [];
    private _isDisposed = false;

    constructor() {
        this.host = new HostFacade();
        this.events = new TypedEventBus<CoreEventMap>();

        // 从宿主读取初始设置并绑定 300ms 防抖保存
        const initialSettings = this.host.getExtensionSettings();
        this.store = new ConfigStore(initialSettings, {
            onSave: (state) => {
                this.host.saveExtensionSettings(state as unknown as Record<string, unknown>);
                this.events.emit('settings:changed', { settings: state });
            }
        });

        this.configSync = new ConfigSyncService(this.store);
        this.storage = new StorageService();

        this.transport = new TransportService({
            csrfHeadersProvider: () => this.host.getRequestHeaders(),
            getProxyMode: () => this.store.get('requestMode')
        });

        // 注册到资源销毁链
        this.addDisposable(this.host);
        this.addDisposable(this.events);
        this.addDisposable(this.store);
        this.addDisposable(this.storage);

        // 监听宿主会话切换事件并转发内部总线
        this.addDisposable(
            this.host.onChatChanged((chatId) => {
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

    /** 释放整个基础设施层资源树 */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this.logger.info('正在释放 Core 基础设施层资源树...');

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
export function createCoreContext(): CoreContext {
    return new CoreContext();
}
