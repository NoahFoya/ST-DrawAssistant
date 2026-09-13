/**
 * ST-DrawAssistant 插件核心入口
 * 职责：SillyTavern 插件生命周期管理、单例防重初始化、宿主事件监听装配与跨会话状态回收。
 * 遵循 st-extension 与 st-image-gen 规范。
 */

import type { SillyTavernContext } from '@types';
import { SettingsStore } from './store/settings';
import { PersistentStorage } from './store/storage';
import { TaskQueueManager } from './store/task';
import { ResultIntegrator } from './store/integrator';
import { GenerationOrchestrator } from './function/orchestrator';
import { initUI, type UIHandle } from './ui';

/** 插件初始化状态标志 */
let initialized = false;
let isAppReady = false;

/** 全局核心服务单例引用 */
let settingsStore: SettingsStore | null = null;
let storage: PersistentStorage | null = null;
let taskQueue: TaskQueueManager | null = null;
let integrator: ResultIntegrator | null = null;
let orchestrator: GenerationOrchestrator | null = null;
let uiHandle: UIHandle | null = null;
let cleanups: (() => void)[] = [];

/** 获取当前活跃的 UI 句柄引用 */
export function getUIHandle(): UIHandle | null {
    return uiHandle;
}

/** 获取当前任务调度队列引用 */
export function getTaskQueue(): TaskQueueManager | null {
    return taskQueue;
}

/** 获取当前任务编排器引用 */
export function getOrchestrator(): GenerationOrchestrator | null {
    return orchestrator;
}

/** 获取当前配置存储引用 */
export function getSettingsStore(): SettingsStore | null {
    return settingsStore;
}

/** 获取当前本地持久化存储服务引用 */
export function getStorage(): PersistentStorage | null {
    return storage;
}

/**
 * 扫描当前聊天容器中的所有历史消息楼层并挂载生图插槽
 */
export function scanAndMountExistingMessages(): void {
    if (!uiHandle || typeof document === 'undefined') return;

    const messageElements = document.querySelectorAll<HTMLElement>('#chat .mes[mesid], .mes[mesid]');
    messageElements.forEach((el) => {
        const mesId = el.getAttribute('mesid');
        if (mesId !== null) {
            const isUser = el.classList.contains('is_user');
            uiHandle?.floorManager.mountToMessage(el, mesId, isUser);
        }
    });
}

/**
 * 响应单个消息楼层渲染事件
 */
export function handleMessageRendered(messageId: number | string, isUser = false): void {
    if (!uiHandle || typeof document === 'undefined') return;

    const selector = `#chat .mes[mesid="${messageId}"], .mes[mesid="${messageId}"]`;
    const messageEl = document.querySelector<HTMLElement>(selector);
    if (messageEl) {
        uiHandle.floorManager.mountToMessage(messageEl, messageId, isUser);
    }
}

/**
 * 宿主应用初始化完成回调 (APP_INITIALIZED)
 * 关键技术原因：SillyTavern 完成 DOM 骨架与基础设置加载后触发 APP_INITIALIZED，
 * 这是安全挂载悬浮球、楼层按钮与设置面板的最佳时机。
 */
export async function handleAppInitialized(): Promise<void> {
    if (isAppReady) return;
    isAppReady = true;

    // 确保底层服务单例就绪
    if (!settingsStore) {
        settingsStore = new SettingsStore();
    }
    if (!storage) {
        storage = new PersistentStorage();
        await storage.init();
    }
    if (!integrator) {
        integrator = new ResultIntegrator({ storage });
    }
    if (!taskQueue) {
        taskQueue = new TaskQueueManager({
            taskTimeoutMs: settingsStore.get('taskTimeoutMs'),
            maxConcurrent: settingsStore.get('maxConcurrentTasks')
        });
    }
    if (!orchestrator) {
        orchestrator = new GenerationOrchestrator({
            taskQueue,
            integrator,
            settingsStore
        });
    }

    if (!uiHandle) {
        uiHandle = initUI({
            settingsStore,
            storage,
            orchestrator,
            taskQueue
        });
    }

    scanAndMountExistingMessages();
}

/**
 * 宿主会话切换事件回调 (CHAT_CHANGED)
 * 关键技术原因：当用户切换聊天会话时，必须中止当前会话正在执行中的生图任务，
 * 并释放已创建的临时 Object URL 内存，防止跨会话串楼与内存泄漏。
 */
export async function handleChatChanged(): Promise<void> {
    // 1. 中止未决的生图任务
    if (taskQueue) {
        await taskQueue.cancelAllActiveTasks('会话已切换，旧任务自动取消');
    }

    // 2. 清理当前会话的楼层插槽与已分配的临时 Object URL
    if (uiHandle) {
        uiHandle.floorManager.clearSessionState();
    }

    // 3. 延时等待 DOM 重渲染后重新扫描当前新会话的聊天楼层
    if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
            scanAndMountExistingMessages();
        });
    }
}

/**
 * 插件单例初始化核心函数
 */
export async function initOnce(): Promise<void> {
    if (initialized) {
        return;
    }

    if (typeof window === 'undefined' || !window.SillyTavern?.getContext) {
        return;
    }

    const context: SillyTavernContext = window.SillyTavern.getContext();
    const { eventSource, eventTypes } = context;

    if (!eventSource || !eventTypes) {
        return;
    }

    initialized = true;

    // 1. 初始化核心状态与持久化服务
    settingsStore = new SettingsStore();
    storage = new PersistentStorage();
    await storage.init();

    integrator = new ResultIntegrator({ storage });
    taskQueue = new TaskQueueManager({
        taskTimeoutMs: settingsStore.get('taskTimeoutMs'),
        maxConcurrent: settingsStore.get('maxConcurrentTasks')
    });

    // 2. 响应配置中超时与并发数的动态变更
    const unsubTimeout = settingsStore.onKeyChange('taskTimeoutMs', (val) => {
        if (taskQueue && typeof val === 'number') {
            taskQueue.setTaskTimeoutMs(val);
        }
    });
    const unsubConcurrent = settingsStore.onKeyChange('maxConcurrentTasks', (val) => {
        if (taskQueue && typeof val === 'number') {
            taskQueue.setMaxConcurrent(val);
        }
    });
    cleanups.push(() => {
        unsubTimeout.dispose();
        unsubConcurrent.dispose();
    });

    // 3. 实例化任务编排器
    orchestrator = new GenerationOrchestrator({
        taskQueue,
        integrator,
        settingsStore
    });

    // 4. 注册核心宿主生命周期事件
    const onAppInit = () => void handleAppInitialized();
    const onChatChange = () => void handleChatChanged();
    const onUserMsg = (id: any) => handleMessageRendered(id, true);
    const onCharMsg = (id: any) => handleMessageRendered(id, false);

    eventSource.on(eventTypes.APP_INITIALIZED, onAppInit);
    eventSource.on(eventTypes.CHAT_CHANGED, onChatChange);

    if (eventTypes.USER_MESSAGE_RENDERED) {
        eventSource.on(eventTypes.USER_MESSAGE_RENDERED, onUserMsg);
    }
    if (eventTypes.CHARACTER_MESSAGE_RENDERED) {
        eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, onCharMsg);
    }

    cleanups.push(() => {
        const removeHostListener = (event: string, handler: (...args: any[]) => void) => {
            const es = eventSource as any;
            if (typeof es?.off === 'function') {
                es.off(event, handler);
            } else if (typeof es?.removeListener === 'function') {
                es.removeListener(event, handler);
            }
        };

        removeHostListener(eventTypes.APP_INITIALIZED, onAppInit);
        removeHostListener(eventTypes.CHAT_CHANGED, onChatChange);
        if (eventTypes.USER_MESSAGE_RENDERED) {
            removeHostListener(eventTypes.USER_MESSAGE_RENDERED, onUserMsg);
        }
        if (eventTypes.CHARACTER_MESSAGE_RENDERED) {
            removeHostListener(eventTypes.CHARACTER_MESSAGE_RENDERED, onCharMsg);
        }
    });

    // 5. 若宿主已完成初始化或已有聊天容器，直接装配 UI
    const chatContainer = typeof document !== 'undefined' ? document.getElementById('chat') : null;
    if (chatContainer || (context as any).isInitialized) {
        await handleAppInitialized();
    }
}

/**
 * 完整卸载扩展插件资源
 * 用于单元测试与热重载场景
 */
export async function disposeExtension(): Promise<void> {
    if (taskQueue) {
        await taskQueue.cancelAllActiveTasks('插件已卸载');
        taskQueue.dispose();
    }
    if (orchestrator) {
        orchestrator.dispose();
    }
    if (integrator) {
        integrator.dispose();
    }
    if (uiHandle) {
        uiHandle.dispose();
    }
    if (storage) {
        storage.dispose();
    }
    if (settingsStore) {
        settingsStore.dispose();
    }

    for (const cleanup of cleanups) {
        try {
            cleanup();
        } catch (err) {
            console.error('[ST-DrawAssistant] 释放事件监听器异常:', err);
        }
    }

    cleanups = [];
    settingsStore = null;
    storage = null;
    taskQueue = null;
    integrator = null;
    orchestrator = null;
    uiHandle = null;
    isAppReady = false;
    initialized = false;
}

/**
 * 扩展激活入口钩子
 * 符合 SillyTavern 官方 manifest hooks 规范
 */
export async function onActivate(): Promise<void> {
    await initOnce();
}

// 浏览器环境中直接加载时的自启动引导
if (typeof window !== 'undefined' && window.SillyTavern) {
    void initOnce();
}
