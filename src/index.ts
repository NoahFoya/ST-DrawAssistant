/**
 * ST-DrawAssistant 插件核心入口
 * 职责：插件生命周期管理、单例防重初始化、宿主事件监听装配
 */

import type { SillyTavernContext } from '@types';

/** 初始化完成标志，防止重复挂载 */
let initialized = false;

/**
 * 宿主会话切换事件回调
 * 关键技术原因：当用户切换聊天会话时，必须中止当前会话正在执行中的生图任务，
 * 并释放已创建的临时 Object URL 内存，防止跨会话串楼与内存泄漏。
 */
function handleChatChanged(): void {
    // 后续批次在此调用任务调度器的 cancelAllActiveTasks 与 Object URL 释放池
}

/**
 * 宿主应用初始化完成回调
 * 关键技术原因：SillyTavern 完成 DOM 骨架与基础设置加载后触发 APP_INITIALIZED，
 * 这是挂载悬浮球、楼层按钮与斜杠命令的最佳安全时机。
 */
function handleAppInitialized(): void {
    // 后续批次在此装配悬浮球 (trigger)、楼层按钮 (floor) 与斜杠命令 (slash_command)
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

    // 注册核心生命周期事件监听
    eventSource.on(eventTypes.APP_INITIALIZED, handleAppInitialized);
    eventSource.on(eventTypes.CHAT_CHANGED, handleChatChanged);
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
