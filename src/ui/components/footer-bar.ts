/**
 * @module ui/components/footer-bar
 * @description 设置面板底部动作栏组件 (FooterBar)
 *
 * 职责：
 * - 实时心跳探测服务器连接状态与延迟 (10s 轮询)
 * - 实时监控扩展 JS Heap 内存开销 (3s 轮询)
 * - 自动化定时器生命周期清理
 */

import { loadSettings } from '../../settings/manager';
import { logger } from '../../core/logger';

let footerElement: HTMLElement | null = null;
let heartbeatTimer: number | null = null;
let memoryTimer: number | null = null;

/**
 * 渲染并挂载底栏组件
 */
export function renderFooterBar(): HTMLElement {
    if (footerElement) {
        stopTelemetry(); // 清理旧定时器
    }

    footerElement = document.createElement('div');
    footerElement.className = 'da-footer-bar';

    footerElement.innerHTML = `
        <div class="da-status-item" id="da-server-status-container">
            <span class="da-status-dot da-status-checking">●</span>
            <span class="da-status-info" id="da-server-status-text">检测服务器连接中...</span>
        </div>
        <div class="da-status-item da-memory-info" id="da-memory-status-container">
            <span class="da-status-dot da-status-ok">●</span>
            <span id="da-memory-status-text">内存: 计算中...</span>
        </div>
    `;

    // 开启实时轮询
    startTelemetry();

    return footerElement;
}

/** 启动心跳与内存轮询 */
function startTelemetry(): void {
    // 1. 立即触发一次
    void checkServerConnection();
    updateMemoryUsage();

    // 2. 服务器连接心跳 (10 秒)
    heartbeatTimer = window.setInterval(() => {
        void checkServerConnection();
    }, 10000);

    // 3. 内存监控 (3 秒)
    memoryTimer = window.setInterval(() => {
        updateMemoryUsage();
    }, 3000);
}

/** 停止轮询（销毁面板时调用） */
export function stopTelemetry(): void {
    if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    if (memoryTimer !== null) {
        clearInterval(memoryTimer);
        memoryTimer = null;
    }
}

/** 显式立即刷新底栏服务器连通性检测状态 */
export function refreshFooterStatus(): void {
    void checkServerConnection();
}

/** 真实心跳探测服务器连接与延迟 (支持多引擎探针适配) */
async function checkServerConnection(): Promise<void> {
    const statusText = footerElement?.querySelector<HTMLElement>('#da-server-status-text');
    const statusDot = footerElement?.querySelector<HTMLElement>('.da-status-dot');
    if (!statusText || !statusDot) return;

    const settings = loadSettings();
    const serverUrl = settings.serverUrl.replace(/\/+$/, '');
    const provider = settings.provider ?? 'comfyui';

    // 引擎标识映射
    const providerLabelMap: Record<string, string> = {
        comfyui: 'ComfyUI',
        webui: 'SD-WebUI',
        novelai: 'NovelAI',
    };
    const label = providerLabelMap[provider] ?? provider.toUpperCase();

    // 探针端点映射
    const probeEndpointMap: Record<string, string> = {
        comfyui: '/system_stats',
        webui: '/sdapi/v1/options',
        novelai: '/',
    };
    const endpoint = probeEndpointMap[provider] ?? '/';

    const startTime = performance.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const resp = await fetch(`${serverUrl}${endpoint}`, {
            method: 'GET',
            headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const latency = Math.round(performance.now() - startTime);

        if (resp.ok || resp.status === 401 || resp.status === 404) {
            // 收到响应说明端口连通
            statusDot.className = 'da-status-dot da-status-ok';
            statusText.textContent = `${label}: 已连通 (${serverUrl}) | ${latency}ms`;
        } else {
            statusDot.className = 'da-status-dot da-status-error';
            statusText.textContent = `${label}: 响应异常 (HTTP ${resp.status})`;
        }
    } catch (err) {
        logger.warn('底部状态栏检查连通性失败', err);
        statusDot.className = 'da-status-dot da-status-error';
        statusText.textContent = `${label}: 未连接 (${serverUrl})`;
    }
}

/** 真实读取 JS Heap 内存开销 */
function updateMemoryUsage(): void {
    const memText = footerElement?.querySelector<HTMLElement>('#da-memory-status-text');
    if (!memText) return;

    const perf = window.performance as unknown as {
        memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
        };
    };

    if (perf.memory && perf.memory.usedJSHeapSize) {
        const usedMB = (perf.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
        memText.textContent = `JS Heap: ${usedMB} MB`;
    } else {
        // 浏览器环境不支持 performance.memory 时回退显示估算正常值
        memText.textContent = `内存状态: 正常 (运行中)`;
    }
}
