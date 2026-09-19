/**
 * ST-DrawAssistant 插件核心导出与全系统生命周期激活入口。
 *
 * @remarks
 * 聚合导出领域类型、基础工具、存储中心、服务提供方、任务流水线及 UI 设计系统，
 * 并在 onActivate 阶段挂载主题、常驻悬浮操作球、设置面板弹窗与楼层消息装饰器。
 */

import { sessionLifecycle } from './pipeline/session-lifecycle';
import { urlPool } from './store/url-pool';
import { settingsStore } from './store/settings-store';
import { themeService } from './ui/theme';
import { SettingsModal } from './ui/modal/settings-modal';
import { FloatingActionButton } from './ui/modal/fab';
import { toastService } from './ui/feedback/toast';
import { messageDecorator } from './ui/floor/message-decorator';
import { logger } from './util/logger';
import type { ThemePresetData } from '@types';

export type * from '@types';
export * from './util';
export * from './store';
export * from './provider';
export * from './pipeline';
export * from './ui';

let isInitialized = false;
let settingsModalInstance: SettingsModal | null = null;
let fabInstance: FloatingActionButton | null = null;
const hostEventCleanups: Array<() => void> = [];

/**
 * 获取当前全局设置弹窗实例
 */
export function getSettingsModal(): SettingsModal | null {
    return settingsModalInstance;
}

/**
 * 获取当前全局悬浮球实例
 */
export function getFloatingActionButton(): FloatingActionButton | null {
    return fabInstance;
}

/**
 * 插件单例初始化函数。
 *
 * @remarks
 * 负责检测 SillyTavern 宿主环境并挂载全局生命周期事件监听器、UI 设计系统与悬浮操作球。
 * 具备幂等性保护，重复调用直接安全返回。
 */
export async function initOnce(): Promise<void> {
    if (isInitialized) {
        return;
    }

    if (typeof window === 'undefined') {
        return;
    }

    const hostContext = window.SillyTavern?.getContext?.();
    if (!hostContext) {
        logger.info('未检测到 SillyTavern 宿主上下文，跳过生命周期挂载');
        return;
    }

    // 1. 从宿主初始化配置存储
    settingsStore.initializeFromHost();

    // 2. 初始化设计系统与主题注入
    themeService.bindTarget();
    const activeThemeId = settingsStore.getSettings().themePreset || 'dark';
    const themes = settingsStore.getPresets<ThemePresetData>('themes');
    const matchedTheme = themes.find((t) => t.id === activeThemeId) || themes[0];
    if (matchedTheme) {
        themeService.applyTheme(matchedTheme);
    }
    themeService.listenSettings();

    // 3. 实例化主设置弹窗与常驻悬浮球
    settingsModalInstance = new SettingsModal();
    fabInstance = new FloatingActionButton({
        onClick: () => {
            settingsModalInstance?.open();
        },
    });
    if (document.body) {
        document.body.appendChild(fabInstance.element);
    }

    // 4. 绑定宿主会话生命周期监听器
    sessionLifecycle.bindHostEvents();

    // 5. 绑定宿主消息渲染与会话切换事件
    const eventSource = hostContext.eventSource;
    const eventTypes = hostContext.eventTypes || {};

    if (eventSource) {
        // 监听楼层消息渲染
        const charRenderedEvent = eventTypes.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered';
        const onCharRendered = (messageId: number) => {
            void messageDecorator.decorateMessage(messageId);
        };
        eventSource.on(charRenderedEvent, onCharRendered);
        hostEventCleanups.push(() => {
            eventSource.off(charRenderedEvent, onCharRendered);
        });

        // 监听会话变更
        const chatChangedEvent = eventTypes.CHAT_CHANGED || 'chat_id_changed';
        const onChatChanged = () => {
            messageDecorator.clearCurrentButtons();
        };
        eventSource.on(chatChangedEvent, onChatChanged);
        hostEventCleanups.push(() => {
            eventSource.off(chatChangedEvent, onChatChanged);
        });
    }

    isInitialized = true;
    logger.info('ST-DrawAssistant 扩展核心生命周期与 UI 系统已就绪');
}

/**
 * SillyTavern 扩展清单规范激活钩子。
 *
 * @remarks
 * 由 manifest.json 中的 hooks.activate 配置项指定调用。
 */
export async function onActivate(): Promise<void> {
    await initOnce();
}

/**
 * 插件全局资源卸载与监听器清理函数。
 *
 * @remarks
 * 解绑全部宿主事件，注销 UI 弹窗与悬浮球，释放临时图片资源，重置初始化状态。
 */
export function disposeExtension(): void {
    // 1. 解绑宿主全局事件
    for (const cleanup of hostEventCleanups) {
        try {
            cleanup();
        } catch {
            // 忽略清理异常
        }
    }
    hostEventCleanups.length = 0;

    sessionLifecycle.unbindHostEvents();

    // 2. 销毁 UI 组件
    if (fabInstance) {
        fabInstance.dispose();
        fabInstance = null;
    }

    if (settingsModalInstance) {
        settingsModalInstance.dispose();
        settingsModalInstance = null;
    }

    messageDecorator.dispose();
    toastService.dispose();
    themeService.dispose();

    // 3. 释放临时图片资源
    urlPool.revokeAll();

    isInitialized = false;
    logger.info('ST-DrawAssistant 扩展已安全卸载');
}

// 浏览器环境下自动检测并尝试自激活
if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
    void initOnce();
}
