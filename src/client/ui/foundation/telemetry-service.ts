/**
 * @module ui/foundation/telemetry-service
 * @description 插件实时遥测与通信监控服务 (TelemetryService)
 */

import { ConfigStore } from '../../core';
import { AdapterRegistry } from '../../domain/drivers/adapter-registry';

export class TelemetryService {
    private static heartbeatTimer: number | null = null;
    private static memoryTimer: number | null = null;
    private static activeFooterEl: HTMLElement | null = null;
    private static currentStore: ConfigStore | null = null;
    private static adapterRegistry: AdapterRegistry | null = null;

    /**
     * 启动底部状态栏遥测监控
     */
    public static start(
        footerElement: HTMLElement,
        store: ConfigStore,
        adapters?: AdapterRegistry
    ): void {
        this.stop();
        this.activeFooterEl = footerElement;
        this.currentStore = store;
        this.adapterRegistry = adapters || null;

        void this.probeServer();
        this.updateMemory();

        if (typeof window !== 'undefined') {
            this.heartbeatTimer = window.setInterval(() => {
                void this.probeServer();
            }, 10000);

            this.memoryTimer = window.setInterval(() => {
                this.updateMemory();
            }, 3000);
        }
    }

    /**
     * 停止并注销所有遥测定时器
     */
    public static stop(): void {
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.memoryTimer !== null) {
            clearInterval(this.memoryTimer);
            this.memoryTimer = null;
        }
        this.activeFooterEl = null;
        this.currentStore = null;
        this.adapterRegistry = null;
    }

    /**
     * 执行当前激活生图后端的连通性与往返延迟探测
     */
    public static async probeServer(): Promise<void> {
        if (!this.activeFooterEl || !this.currentStore) return;

        const dotEl = this.activeFooterEl.querySelector<HTMLElement>('#da-server-status-dot');
        const textEl = this.activeFooterEl.querySelector<HTMLElement>('#da-server-status-text');
        if (!textEl) return;

        const activeProvider = this.currentStore.get('activeProvider') || 'comfyui';
        const adapter = this.adapterRegistry?.get(activeProvider);

        if (!adapter) {
            if (dotEl) dotEl.className = 'da-status-dot da-status-error';
            textEl.textContent = `未挂载 [${activeProvider}]`;
            return;
        }

        if (dotEl) dotEl.className = 'da-status-dot da-status-checking';
        textEl.textContent = `检测 ${adapter.name} 连接中...`;

        try {
            const res = await adapter.checkHealth();

            if (res.ok) {
                const latency = res.latencyMs ?? 0;
                if (dotEl) dotEl.className = 'da-status-dot da-status-ok';
                textEl.textContent = `${adapter.name} 运行正常 (${latency}ms)`;
            } else {
                if (dotEl) dotEl.className = 'da-status-dot da-status-error';
                textEl.textContent = `${adapter.name} (${res.message || '离线或无响应'})`;
            }
        } catch {
            if (dotEl) dotEl.className = 'da-status-dot da-status-error';
            textEl.textContent = `${adapter.name} (通信异常)`;
        }
    }

    /**
     * 刷新 JS Heap 内存占用指标
     */
    private static updateMemory(): void {
        if (!this.activeFooterEl) return;

        const memEl = this.activeFooterEl.querySelector<HTMLElement>('#da-memory-status-text');
        if (!memEl) return;

        const perf = typeof performance !== 'undefined'
            ? (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } })
            : undefined;

        if (perf && perf.memory) {
            const usedMB = (perf.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
            const totalMB = (perf.memory.totalJSHeapSize / (1024 * 1024)).toFixed(1);
            memEl.textContent = `JS Heap: ${usedMB} / ${totalMB} MB`;
        } else {
            memEl.textContent = 'JS Heap: 正常';
        }
    }
}
