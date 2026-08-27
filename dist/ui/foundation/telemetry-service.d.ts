/**
 * @module ui/foundation/telemetry-service
 * @description 插件实时遥测与通信监控服务 (TelemetryService)
 */
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import type { IDriverRegistry } from '../../core/registry/driver-registry';
export declare class TelemetryService {
    private static heartbeatTimer;
    private static memoryTimer;
    private static activeFooterEl;
    private static currentStore;
    private static driverRegistry;
    /**
     * 启动底部状态栏遥测监控
     */
    static start(footerElement: HTMLElement, store: ObservableStore<DrawAssistantSettings>, drivers?: IDriverRegistry): void;
    /**
     * 停止并注销所有遥测定时器
     */
    static stop(): void;
    /**
     * 执行当前激活生图后端的连通性与往返延迟探测
     */
    static probeServer(): Promise<void>;
    /**
     * 刷新 JS Heap 内存占用指标
     */
    private static updateMemory;
}
//# sourceMappingURL=telemetry-service.d.ts.map