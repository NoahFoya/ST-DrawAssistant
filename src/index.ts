/**
 * @module index
 * @description ST-DrawAssistant 绘画助手扩展主入口文件
 *
 * 初始化模式：遵循 ST 宿主推荐的"顶层仅注册监听，APP_READY 内完成所有初始化"模式
 *
 * 关键约束：
 * - 模块顶层调用 getContext() 存在时序风险（若扩展加载较早，宿主可能尚未初始化），
 *   因此顶层的 getContext() 调用应始终包裹在 try-catch 中，
 *   真正的初始化逻辑应在 APP_READY 事件回调内执行
 * - extension_settings 访问必须在 APP_READY 后执行（此时设置已加载完毕）
 * - CHARACTER_MESSAGE_RENDERED 事件数据含 { message, element }，直接用 element
 *
 * 规范参考：
 * - .agents/Skills/sillytavern-extension-host/SKILL.md §4.2 (扩展入口生命周期与事件总线)
 */

import { EXTENSION_DISPLAY_NAME, EXTENSION_PATH, VERSION } from './core/constants';
import { getContext } from './core/context';
import { logger } from './core/logger';
import { loadSettings } from './settings/manager';
import { createDriver } from './drivers/factory';
import { TaskManager } from './task/manager';
import { renderSettingsPanel } from './ui/settings-panel';
import { injectFloorButtons } from './ui/floor-button';
import { applyFABStylesFromSettings } from './ui/fab';
import type { DrawAssistantSettings } from './settings/types';
import type { ImageDriver } from './drivers/types';

// ─── 模块级状态 ────────────────────────────────────────────────────────────────

let settings: DrawAssistantSettings | null = null;
let driver: ImageDriver | null = null;
let taskManager: TaskManager | null = null;
let initialized = false;

let lastProvider: string | null = null;
let lastServerUrl: string | null = null;

// ─── 运行时配置与驱动加载 ─────────────────────────────────────────────────────────

/**
 * 重新加载宿主 extension_settings 配置并初始化生图驱动
 * 仅在后端 Provider 或 服务地址发生改变时才重建 Driver 实例，避免销毁进行中的任务连接
 */
function reloadRuntimeSettings(): void {
    settings = loadSettings();

    if (!driver || settings.provider !== lastProvider || settings.serverUrl !== lastServerUrl) {
        lastProvider = settings.provider;
        lastServerUrl = settings.serverUrl;
        driver = createDriver(settings.provider, settings);
        logger.debug(`运行时驱动初始化/更新成功: provider=${settings.provider}, url=${settings.serverUrl}`);
    }

    try {
        applyFABStylesFromSettings();
        import('./ui/tabs/theme-tab').then(({ applyPluginTheme }) => {
            if (settings?.themePreset) {
                applyPluginTheme(settings.themePreset);
            }
        }).catch(err => {
            logger.error('动态刷新插件主题样式失败', err);
        });
    } catch (err) {
        logger.error('应用 FAB 悬浮球样式或主题样式时捕获到异常', err);
    }
}

// ─── 扩展生命周期初始化 ─────────────────────────────────────────────────────────

/**
 * SillyTavern APP_READY 后的全量生命周期初始化
 */
async function init(): Promise<void> {
    if (initialized) return;
    initialized = true;

    logger.info(`正在初始化 ${EXTENSION_DISPLAY_NAME} v${VERSION}...`);

    try {
        // 1. 加载运行时设置并完成驱动初始化与日志持久化钩子挂载
        reloadRuntimeSettings();
        const { saveLogToDB } = await import('./storage/log-storage');
        logger.setPersistHook((entry) => {
            if (entry.level === 'WARN' || entry.level === 'ERROR' || entry.level === 'FATAL') {
                void saveLogToDB(entry);
            }
        });

        // 2. 实例化并发任务管理器 TaskManager 并挂载统计采集器
        taskManager = new TaskManager();
        const { StatisticsCollector } = await import('./statistics');
        void StatisticsCollector.getInstance().init(taskManager);

        // 3. 渲染主设置面板模态框与挂载 FAB 悬浮球
        try {
            const { applyPluginTheme } = await import('./ui/tabs/theme-tab');
            applyPluginTheme(settings!.themePreset || '');

            await renderSettingsPanel();
            const { initFAB } = await import('./ui/fab');
            const { setMainModalVisible, bindNativeSettingsTemplateEvents } = await import('./ui/settings-panel');
            initFAB((open) => {
                setMainModalVisible(open);
            });

            // 3.5 渲染并挂载 ST 原生侧边栏抽屉设置模板 (templates/settings.html)
            const context = getContext();
            if (context && typeof context.renderExtensionTemplateAsync === 'function') {
                const templateHtml = await context.renderExtensionTemplateAsync(EXTENSION_PATH, 'templates/settings');
                if (templateHtml) {
                    const drawerContainer = document.getElementById('extensions_settings');
                    if (drawerContainer) {
                        drawerContainer.insertAdjacentHTML('beforeend', templateHtml);
                        bindNativeSettingsTemplateEvents();
                    }
                }
            }
        } catch (panelErr) {
            logger.warn('设置面板或原生抽屉模板渲染失败 (非致命中断)', panelErr);
        }

        // 4. 扫描现有聊天消息并注入楼层生图按钮
        injectExistingMessages();

        // 5. 挂载角色管理事件监听与新角色卡智能提示
        const { registerCharacterEventListeners } = await import('./core/character-event-listener');
        registerCharacterEventListeners();

        logger.info(`初始化就绪 ✅ 触发生图占位符格式: ${settings!.placeholderStart}prompt${settings!.placeholderEnd}`);
    } catch (err) {
        logger.error('扩展初始化失败', err);
        initialized = false; // 允许异常后重试
    }
}

// ─── 消息渲染事件处理 ─────────────────────────────────────────────────────────

/**
 * CHARACTER_MESSAGE_RENDERED 事件处理器
 * 事件数据：{ message: ChatMessage, element: HTMLElement }
 * 或 ST 早期版本仅传 messageId: number
 */
function onCharacterMessageRendered(data: unknown): void {
    reloadRuntimeSettings();
    if (!settings || !driver || !taskManager) return;

    let messageElement: HTMLElement | null = null;
    let messageIndex = -1;

    // 1. 流式打字保护：若处于 AI 流式生成中 (is_streaming)，直接跳过 DOM 注入与扫描
    if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        const msg = d['message'] as Record<string, unknown> | undefined;
        if (d['is_streaming'] === true || msg?.is_streaming === true) {
            return;
        }
    }

    // 2. 规范 ST 视角：解析事件负载中的 element 或 messageId
    if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        if (d['element'] instanceof HTMLElement) {
            messageElement = d['element'];
            const mesId = messageElement.getAttribute('mesid');
            messageIndex = mesId ? parseInt(mesId, 10) : -1;
        } else if (typeof d['messageId'] === 'number') {
            messageIndex = d['messageId'];
            messageElement = document.querySelector<HTMLElement>(`[mesid="${messageIndex}"]`);
        }
    } else if (typeof data === 'number') {
        messageIndex = data;
        messageElement = document.querySelector<HTMLElement>(`[mesid="${messageIndex}"]`);
    }

    // 3. 兜底防护：定位最后一条 AI 消息
    if (!messageElement) {
        const allMessages = document.querySelectorAll<HTMLElement>('.mes[is_user="false"]');
        const last = allMessages[allMessages.length - 1];
        if (last) {
            messageElement = last;
            const mesId = last.getAttribute('mesid');
            messageIndex = mesId ? parseInt(mesId, 10) : -1;
        }
    }

    // 4. 再次校验 DOM 节点上的 is_streaming 标记
    if (messageElement) {
        if (
            messageElement.classList.contains('is_streaming') ||
            messageElement.getAttribute('is_streaming') === 'true'
        ) {
            return;
        }
    }

    if (messageElement && messageIndex >= 0) {
        injectFloorButtons(messageElement, messageIndex, taskManager, driver, settings);
    }
}

/** 对页面上已存在的所有消息补充注入（刷新页面/切换聊天/Swipe/消息编辑后恢复按钮） */
function injectExistingMessages(): void {
    reloadRuntimeSettings();
    if (!settings || !driver || !taskManager) return;

    // 扫描聊天面板中的所有消息楼层
    const allMessages = document.querySelectorAll<HTMLElement>('.mes');
    logger.debug(`injectExistingMessages: scanning ${allMessages.length} message(s)`);

    allMessages.forEach((mesEl) => {
        // 若该消息正处于流式生成状态，跳过
        if (mesEl.classList.contains('is_streaming') || mesEl.getAttribute('is_streaming') === 'true') {
            return;
        }
        const mesIdStr = mesEl.getAttribute('mesid');
        const messageIndex = mesIdStr ? parseInt(mesIdStr, 10) : -1;
        if (messageIndex >= 0) {
            injectFloorButtons(mesEl, messageIndex, taskManager!, driver!, settings!);
        }
    });
}

// ─── 顶层：注册宿主事件监听 ────────────────────────────────────────────────────

let renderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 消息渲染防抖调度器 (600ms 窗口期，带全量楼层扫描兜底) */
function debouncedCharacterRender(data: unknown): void {
    if (renderDebounceTimer) {
        clearTimeout(renderDebounceTimer);
    }
    renderDebounceTimer = setTimeout(() => {
        renderDebounceTimer = null;
        onCharacterMessageRendered(data);
        // 防抖触发时同步扫描现有楼层，防止窗口期内其他并发渲染被遗漏
        injectExistingMessages();
    }, 600);
}

(function setup(): void {
    try {
        const ctx = getContext();
        const { eventSource, event_types } = ctx;

        // APP_READY 有"补触发"特性，触发即初始化扩展
        eventSource.on(event_types.APP_READY, () => {
            void init();
            // 延迟多段防抖兜底扫描
            setTimeout(injectExistingMessages, 300);
            setTimeout(injectExistingMessages, 1000);
        });

        // 监听设置更新事件
        if (event_types.EXTENSION_SETTINGS_UPDATED) {
            eventSource.on(event_types.EXTENSION_SETTINGS_UPDATED, () => {
                reloadRuntimeSettings();
            });
        }
        eventSource.on('ST_DRAW_ASSISTANT_SETTINGS_CHANGED', () => {
            reloadRuntimeSettings();
        });

        // 订阅单条消息渲染事件 (使用 debounce 防抖，跳过流式中间态)
        if (event_types.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (data: unknown) => {
                debouncedCharacterRender(data);
            });
        }

        // 订阅消息 Swipe 事件
        if (event_types.MESSAGE_SWIPED) {
            eventSource.on(event_types.MESSAGE_SWIPED, () => {
                setTimeout(injectExistingMessages, 100);
            });
        }

        // CHAT_CHANGED：切换聊天时重新扫描楼层
        if (event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => {
                logger.debug('CHAT_CHANGED event fired, re-scanning messages');
                setTimeout(injectExistingMessages, 150);
            });
        }

        // GENERATION_ENDED：LLM 生成彻底结束时触发一次全量完成注入，并处理自动生图
        if (event_types.GENERATION_ENDED) {
            eventSource.on(event_types.GENERATION_ENDED, () => {
                logger.debug('GENERATION_ENDED event fired, re-scanning messages');
                setTimeout(() => {
                    injectExistingMessages();
                    const currentSettings = loadSettings();
                    if (currentSettings.autoGenerate) {
                        // 用 querySelectorAll('.mes') 取最后一条消息：
                        // '#chat .mes:last-child' 会因 #chat 容器含非消息 DOM 节点而选错元素
                        const allMsgEls = document.querySelectorAll<HTMLElement>('.mes');
                        const lastMsgEl = allMsgEls[allMsgEls.length - 1];
                        if (lastMsgEl && !lastMsgEl.classList.contains('is_system')) {
                            // 用 CSS 状态类判断按钮是否为"待生成"状态（而非文本内容字面量），
                            // 避免 BUTTON_LABELS 变更导致自动生图静默失效
                            const defaultBtns = lastMsgEl.querySelectorAll<HTMLButtonElement>('.da-floor-btn--default');
                            if (defaultBtns.length > 0) {
                                logger.info(`autoGenerate: 自动触发最后一条消息的 ${defaultBtns.length} 个生图按钮`);
                                defaultBtns.forEach(btn => btn.click());
                            }
                        }
                    }
                }, 200);
            });
        }

    } catch (err) {
        logger.error('Failed to register event listeners', err);
    }
})();
