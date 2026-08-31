/**
 * @module index
 * @description ST-DrawAssistant 前端扩展引导与生命周期入口 (Bootstrap)
 */

export const EXTENSION_NAME = 'ST-DrawAssistant';
export const EXTENSION_VERSION = '0.1.0';

let isInitialized = false;

/**
 * 插件全局引导入口函数 (Bootstrap Pipeline)
 */
export async function bootstrap(): Promise<void> {
    if (isInitialized) {
        console.warn(`[${EXTENSION_NAME}] 插件已处于初始化状态，跳过重复自启动。`);
        return;
    }
    isInitialized = true;

    console.info(`[${EXTENSION_NAME}] v${EXTENSION_VERSION} 插件正在启动初始化...`);

    // 宿主就绪检测与事件绑定
    if (typeof window !== 'undefined') {
        const checkContextReady = () => {
            const st = (window as unknown as { SillyTavern?: { getContext?: () => { eventSource?: { on: (event: string, fn: (...args: unknown[]) => void) => void }, event_types?: Record<string, string> } } }).SillyTavern;
            return Boolean(st?.getContext?.()?.eventSource && st?.getContext?.()?.event_types);
        };

        if (checkContextReady()) {
            setupLifecycleListeners();
        } else {
            const timer = setInterval(() => {
                if (checkContextReady()) {
                    clearInterval(timer);
                    setupLifecycleListeners();
                }
            }, 100);
        }

        // 页面卸载/刷新时的资源安全释放
        window.addEventListener(
            'pagehide',
            () => {
                dispose();
            },
            { once: true }
        );
    }
}

/**
 * 注册 SillyTavern 核心生命周期监听器
 */
function setupLifecycleListeners(): void {
    try {
        const st = (window as unknown as { SillyTavern: { getContext: () => { eventSource: { on: (event: string, fn: (...args: unknown[]) => void) => void }, event_types: Record<string, string> } } }).SillyTavern;
        const ctx = st.getContext();
        const { eventSource, event_types } = ctx;

        if (event_types?.APP_READY) {
            eventSource.on(event_types.APP_READY, () => {
                console.info(`[${EXTENSION_NAME}] 收到 APP_READY 事件，扩展进入运行态。`);
            });
        }

        if (event_types?.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => {
                console.debug(`[${EXTENSION_NAME}] 收到 CHAT_CHANGED 事件，重置上下文缓存。`);
            });
        }
    } catch (err) {
        console.error(`[${EXTENSION_NAME}] 注册宿主生命周期事件失败:`, err);
    }
}

/**
 * 释放插件持有的所有全局资源
 */
export function dispose(): void {
    if (!isInitialized) return;
    isInitialized = false;
    console.info(`[${EXTENSION_NAME}] 插件资源已释放。`);
}

// 浏览器环境自动引导自启动
if (typeof window !== 'undefined') {
    void bootstrap();
}
