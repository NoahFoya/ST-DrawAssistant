/**
 * ST-DrawAssistant 插件核心主入口 (Plugin Entrypoint)
 *
 * 功能：
 * 1. 负责 SillyTavern 插件环境的就绪探测与生命周期编排；
 * 2. 初始化核心服务单例（设置存储、任务队列、持久化与生图编排器）；
 * 3. 注册宿主事件监听（消息接收、会话变更等）并驱动自动生图与楼层注入；
 * 4. 挂载悬浮球与主设置弹窗等 UI 交互组件。
 *
 * Tips：
 * 1. 防重入保护：具备严格的单例初始化防护，避免重复加载导致事件重复绑定；
 * 2. 会话清理：CHAT_CHANGED 触发时需主动废弃未完成任务并回收临时内存。
 */

import type { SillyTavernContext } from '@types';
import { SettingsStore } from '@store/settings';
import { PersistentStorage } from '@store/storage';
import { TaskQueueManager } from '@store/task';
import { ResultIntegrator } from '@store/integrator';
import { GenerationOrchestrator } from '@function/orchestrator';
import { ExtensionRegistry } from '@extension/registry';
import { initUI, type UIHandle } from './ui';

/** 插件初始化状态标志 */
let initialized = false;
let isAppReady = false;

/** 核心服务单例引用 */
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

/** 获取当前扩展注册中心单例引用 */
export function getExtensionRegistry(): ExtensionRegistry {
    return ExtensionRegistry.getInstance();
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
 * 负责楼层 DOM 挂载与历史图片恢复；自动生图由 GENERATION_ENDED 事件驱动。
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
 * 获取当前聊天中最新一条角色（非用户）消息楼层 ID
 */
export function getLatestCharacterMessageId(): number | string | null {
    if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
        const chat = window.SillyTavern.getContext().chat;
        if (Array.isArray(chat) && chat.length > 0) {
            for (let i = chat.length - 1; i >= 0; i--) {
                if (!chat[i].is_user) {
                    return i;
                }
            }
        }
    }
    // DOM 降级探测
    if (typeof document !== 'undefined') {
        const charMessages = document.querySelectorAll<HTMLElement>('#chat .mes:not(.is_user)[mesid], .mes:not(.is_user)[mesid]');
        if (charMessages.length > 0) {
            const lastEl = charMessages[charMessages.length - 1];
            const mesId = lastEl.getAttribute('mesid');
            return mesId !== null ? (parseInt(mesId, 10) || mesId) : null;
        }
    }
    return null;
}

/**
 * 响应宿主 AI 文本生成完成生命周期事件 (GENERATION_ENDED)
 * 仅在 AI 完成回复时触发最新角色楼层的自动生图，避免在切换会话、滚动加载历史或重绘时误触发。
 */
export function handleGenerationEnded(): void {
    if (!uiHandle || typeof window === 'undefined') return;
    if (settingsStore?.get('enabled') === false || !settingsStore?.get('autoGenerate')) {
        return;
    }
    const latestId = getLatestCharacterMessageId();
    if (latestId !== null) {
        uiHandle.floorManager.triggerAutoGenerate(latestId);
    }
}

/**
 * 响应宿主滑动切换分支事件 (MESSAGE_SWIPED)
 */
export function handleMessageSwiped(messageId: number | string): void {
    if (!uiHandle || typeof document === 'undefined') return;
    uiHandle.floorManager.handleMessageSwiped(messageId);
}

/**
 * 宿主应用初始化完成回调 (APP_INITIALIZED)
 * SillyTavern 完成 DOM 骨架与基础设置加载后触发 APP_INITIALIZED，此时挂载悬浮球、楼层按钮与设置面板。
 */
export async function handleAppInitialized(): Promise<void> {
    if (isAppReady) return;
    isAppReady = true;

    // 确保底层服务单例就绪
    if (!settingsStore) {
        settingsStore = new SettingsStore();
        ExtensionRegistry.getInstance().bindSettingsStore(settingsStore);
    }
    if (!storage) {
        storage = new PersistentStorage();
        await storage.init();
    }
    if (!integrator) {
        integrator = new ResultIntegrator({ storage, settingsStore });
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
 * 当用户切换聊天会话时，取消当前会话未决的生图任务，并释放已分配的临时资源。
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
    ExtensionRegistry.getInstance().bindSettingsStore(settingsStore);
    storage = new PersistentStorage();
    await storage.init();

    integrator = new ResultIntegrator({ storage, settingsStore });
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
    const onGenEnded = () => handleGenerationEnded();
    const onMsgSwiped = (id: any) => handleMessageSwiped(id);

    eventSource.on(eventTypes.APP_INITIALIZED, onAppInit);
    eventSource.on(eventTypes.CHAT_CHANGED, onChatChange);

    if (eventTypes.USER_MESSAGE_RENDERED) {
        eventSource.on(eventTypes.USER_MESSAGE_RENDERED, onUserMsg);
    }
    if (eventTypes.CHARACTER_MESSAGE_RENDERED) {
        eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, onCharMsg);
    }
    if (eventTypes.GENERATION_ENDED) {
        eventSource.on(eventTypes.GENERATION_ENDED, onGenEnded);
    }
    if (eventTypes.MESSAGE_SWIPED) {
        eventSource.on(eventTypes.MESSAGE_SWIPED, onMsgSwiped);
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
        if (eventTypes.GENERATION_ENDED) {
            removeHostListener(eventTypes.GENERATION_ENDED, onGenEnded);
        }
        if (eventTypes.MESSAGE_SWIPED) {
            removeHostListener(eventTypes.MESSAGE_SWIPED, onMsgSwiped);
        }
    });

    // 5. 若宿主已完成初始化或已有聊天容器，直接装配 UI
    const chatContainer = typeof document !== 'undefined' ? document.getElementById('chat') : null;
    if (chatContainer || (context as any).isInitialized) {
        await handleAppInitialized();
    }

    // 6. 初始化已启用的扩展功能
    await ExtensionRegistry.getInstance().initAll(context);
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
    ExtensionRegistry.getInstance().clear();
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
