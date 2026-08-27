/**
 * @module index
 * @description 绘画助手扩展主入口
 *
 * 职责：
 * - 监听宿主 APP_READY 事件，在应用加载完成后执行全量初始化
 * - 初始化驱动实例与任务队列管理器，挂载快捷悬浮球与主设置面板
 * - 监听消息渲染、Swipe 切换及聊天文件切换事件，自动识别占位符并注入楼层生图按钮
 */

import { EXTENSION_DISPLAY_NAME, EXTENSION_PATH, VERSION } from './core/constants';
import { getContext, isContextReady } from './core/context';
import { logger } from './core/logger';
import { loadSettings } from './settings/manager';
import { createDriver } from './drivers/factory';
import { TaskManager } from './task/manager';
import { renderSettingsPanel } from './ui/settings-panel';
import { injectFloorButtons } from './ui/floor-button';
import { applyFABStylesFromSettings } from './ui/fab';
import { registerExtension, initEnabledExtensions } from './core/extension-registry';
import { settingsStore, driverStore, setDriverState, syncSettingsFromHost, patchSettings } from './state/app-store';
import type { ImageProvider } from './settings/types';

// ─── 进阶扩展模块注册 ──────────────────────────────────────────────────────────

registerExtension({
    id: 'character-manager',
    displayName: '角色与服装设定管理',
    description: '提供角色/服装预设管理、设定启用方案绑定、注入模板格式与树形动态提示词匹配引擎。',
    version: '1.0.0',
    init: async (ctx) => {
        const { processCharacterPrompt, registerCharacterEventListeners } = await import('./extensions/character-manager');
        ctx.registerPromptProcessor((raw) => {
            return processCharacterPrompt(raw);
        });

        if (typeof registerCharacterEventListeners === 'function') {
            registerCharacterEventListeners();
        }
    }
});

// ─── 初始化标志 ───────────────────────────────────────────────────────────────

let initialized = false;
let isPersistingLog = false;

// ─── 运行时驱动刷新 ────────────────────────────────────────────────────────────

/**
 * 重新加载扩展运行配置并更新后端驱动状态
 *
 * 当后端 Provider 类型或服务 URL 发生变更时，自动销毁旧 Driver 并安全创建新 Driver 实例；
 * 随后同步配置至全局 Store，并重载悬浮球与插件主题外观。
 */
function reloadRuntimeSettings(): void {
    const prevState = driverStore.getState();
    const settings = loadSettings();

    const providerChanged = settings.provider !== prevState.provider;
    const urlChanged = settings.serverUrl !== (prevState.driver as unknown as { serverUrl?: string } | null)?.serverUrl;

    if (!prevState.driver || providerChanged || urlChanged) {
        if (prevState.driver) {
            try {
                prevState.driver.dispose();
                logger.debug(`旧后端驱动实例 [${prevState.provider}] 资源已释放回收`);
            } catch (err) {
                logger.error('释放旧 Backend Driver 资源时抛出异常', err);
            }
        }
        const newDriver = createDriver(settings.provider, settings);
        setDriverState({
            driver: newDriver,
            provider: settings.provider as ImageProvider,
            isConnected: false,
        });
        logger.debug(`运行时驱动更新: provider=${settings.provider}, url=${settings.serverUrl}`);
    }

    syncSettingsFromHost();

    try {
        applyFABStylesFromSettings();
        import('./ui/tabs/theme-tab').then(({ applyPluginTheme }) => {
            const s = settingsStore.getState();
            if (s.themePreset) {
                applyPluginTheme(s.themePreset);
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
 * 扩展全量生命周期初始化
 *
 * 负责实例化全局驱动、日志持久化、任务调度队列、设置面板与悬浮球，
 * 并扫描已有聊天消息注入楼层生图按钮。
 */
async function init(): Promise<void> {
    if (initialized) return;
    initialized = true;

    logger.info(`正在初始化 ${EXTENSION_DISPLAY_NAME} v${VERSION}...`);

    try {
        reloadRuntimeSettings();
        const { saveLogToDB } = await import('./storage/log-storage');
        logger.setPersistHook((entry) => {
            if (isPersistingLog) return;
            if (entry.level === 'WARN' || entry.level === 'ERROR' || entry.level === 'FATAL') {
                isPersistingLog = true;
                saveLogToDB(entry)
                    .catch((err) => {
                        console.error('[ST-DrawAssistant] 写入 IndexedDB 日志发生错误:', err);
                    })
                    .finally(() => {
                        isPersistingLog = false;
                    });
            }
        });

        const taskManager = new TaskManager();
        setDriverState({ taskManager });

        const { StatisticsCollector } = await import('./statistics');
        void StatisticsCollector.getInstance().init(taskManager);

        try {
            const { initPresetsFromDistAsync } = await import('./settings/defaults');
            await initPresetsFromDistAsync();

            const { applyPluginTheme } = await import('./ui/tabs/theme-tab');
            const currentSettings = settingsStore.getState();
            applyPluginTheme(currentSettings.themePreset || '');

            settingsStore.subscribe((newSettings) => {
                if (newSettings.themePreset) {
                    void applyPluginTheme(newSettings.themePreset);
                }
            });

            await renderSettingsPanel();
            const { initFAB } = await import('./ui/fab');
            const { setMainModalVisible, bindNativeSettingsTemplateEvents } = await import('./ui/settings-panel');
            initFAB((open) => {
                setMainModalVisible(open);
            });

            const context = getContext();
            if (context && typeof context.renderExtensionTemplateAsync === 'function') {
                const templateHtml = await context.renderExtensionTemplateAsync(EXTENSION_PATH, 'templates/settings');
                if (templateHtml) {
                    const drawerContainer = document.getElementById('extensions_settings');
                    if (drawerContainer && !drawerContainer.querySelector('.da-st-settings-drawer')) {
                        drawerContainer.insertAdjacentHTML('beforeend', templateHtml);
                        bindNativeSettingsTemplateEvents();
                    }
                }
            }
        } catch (panelErr) {
            logger.warn('设置面板或原生抽屉模板渲染失败 (非致命中断)', panelErr);
        }

        injectExistingMessages();

        const { taskManager: tm } = driverStore.getState();
        await initEnabledExtensions(tm!);

        const s = settingsStore.getState();
        logger.info(`初始化就绪，触发生图占位符格式: ${s.placeholderStart}prompt${s.placeholderEnd}`);

        // 应用初始化完成，触发后台自动测试连接与预设资源一致性校验
        setTimeout(() => {
            void autoVerifyBackendAndPreset();
        }, 1000);

        // 异步触发过期日志自动清理 (保留近 7 天记录)
        import('./storage/log-storage').then(({ cleanExpiredLogsInDB }) => {
            void cleanExpiredLogsInDB(7);
        }).catch(err => {
            logger.warn('自动清理过期日志失败', err);
        });
    } catch (err) {
        logger.error('扩展初始化失败', err);
        initialized = false;
    }
}

/**
 * 插件启动时后台自动测试连接并校验预设资源的可用性
 * 若发现预设引用的模型/资源未在后端找到，弹出 Warning Toast
 */
async function autoVerifyBackendAndPreset(): Promise<void> {
    const settings = loadSettings();
    try {
        const driver = createDriver(settings.provider, settings);
        const res = await driver.checkConnection();
        if (res.connected) {
            const [models, clips, vaes, samplers, schedulers, loras] = await Promise.all([
                driver.getModels ? driver.getModels() : Promise.resolve([]),
                driver.getClips ? driver.getClips() : Promise.resolve([]),
                driver.getVaes ? driver.getVaes() : Promise.resolve([]),
                driver.getSamplers ? driver.getSamplers() : Promise.resolve([]),
                driver.getSchedulers ? driver.getSchedulers() : Promise.resolve([]),
                driver.getLoras ? driver.getLoras() : Promise.resolve([]),
            ]);

            const current = loadSettings();
            patchSettings({
                cachedModels: models.length > 0 ? models : current.cachedModels,
                cachedClips: clips.length > 0 ? clips : current.cachedClips,
                cachedVaes: vaes.length > 0 ? vaes : current.cachedVaes,
                cachedSamplers: samplers.length > 0 ? samplers : current.cachedSamplers,
                cachedSchedulers: schedulers.length > 0 ? schedulers : current.cachedSchedulers,
                cachedLoras: loras.length > 0 ? loras : current.cachedLoras,
            });

            verifyPresetIntegrity(loadSettings());
        }
    } catch (err) {
        logger.debug('启动自动后端连接测试失败 (非阻断警告)', err);
    }
}

/**
 * 校验当前已设定的模型/资源是否存在于最新拉取到的缓存列表中
 * 若有缺失资源，触发弹出警告 Toast
 */
function verifyPresetIntegrity(settings: ReturnType<typeof loadSettings>): void {
    const missingItems: string[] = [];

    const checkItem = (name: string | undefined, list: string[] | undefined, label: string) => {
        if (name && list && list.length > 0 && !list.includes(name)) {
            missingItems.push(`${label}: ${name}`);
        }
    };

    checkItem(settings.ckptName, settings.cachedModels, '主模型');
    checkItem(settings.clipName, settings.cachedClips, 'CLIP');
    checkItem(settings.vaeName, settings.cachedVaes, 'VAE');
    checkItem(settings.samplerName, settings.cachedSamplers, '采样算法');
    checkItem(settings.scheduler, settings.cachedSchedulers, '采样调度器');

    if (missingItems.length > 0) {
        import('./ui/feedback-service').then(({ FeedbackService }) => {
            FeedbackService.toastWarning(
                `⚠️ 预设引用的资源未在当前后端找到：\n${missingItems.join('\n')}\n对应下拉框已自动标红警示。`,
                '预设资源校验'
            );
        }).catch(err => {
            logger.warn('弹出预设资源校验警告失败', err);
        });
    }
}

// ─── 消息渲染事件处理 ─────────────────────────────────────────────────────────

/**
 * 响应单条消息渲染事件并为其中包含生图占位符的文本注入按钮
 *
 * 在 AI 流式输出期间自动跳过 DOM 操作，避免干扰打字机动画；
 * 解析消息节点与 mesid 后触发楼层按钮渲染。
 *
 * @param data 宿主发出的消息渲染事件对象或消息索引 ID
 */
function onCharacterMessageRendered(data: unknown): void {
    const { driver, taskManager } = driverStore.getState();
    const settings = settingsStore.getState();
    if (!driver || !taskManager) return;

    let messageElement: HTMLElement | null = null;
    let messageIndex = -1;

    // AI 流式生成中跳过注入，防止干扰文本打字机动画
    if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        const msg = d['message'] as Record<string, unknown> | undefined;
        if (d['is_streaming'] === true || msg?.is_streaming === true) {
            return;
        }
    }

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

    if (!messageElement) {
        const allMessages = document.querySelectorAll<HTMLElement>('.mes[is_user="false"]');
        const last = allMessages[allMessages.length - 1];
        if (last) {
            messageElement = last;
            const mesId = last.getAttribute('mesid');
            messageIndex = mesId ? parseInt(mesId, 10) : -1;
        }
    }

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

/**
 * 扫描聊天面板中当前所有的消息节点并批量补充注入按钮
 *
 * 用于初始化完成、切换聊天文件、切换 Swipe 变体以及编辑消息后的界面按钮恢复。
 */
function injectExistingMessages(): void {
    const { driver, taskManager } = driverStore.getState();
    const settings = settingsStore.getState();
    if (!driver || !taskManager) return;

    const allMessages = document.querySelectorAll<HTMLElement>('.mes');
    logger.debug(`injectExistingMessages: scanning ${allMessages.length} message(s)`);

    allMessages.forEach((mesEl) => {
        if (mesEl.classList.contains('is_streaming') || mesEl.getAttribute('is_streaming') === 'true') {
            return;
        }
        const mesIdStr = mesEl.getAttribute('mesid');
        const messageIndex = mesIdStr ? parseInt(mesIdStr, 10) : -1;
        if (messageIndex >= 0) {
            injectFloorButtons(mesEl, messageIndex, taskManager, driver, settings);
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

/** 最多轮询检查宿主上下文就绪状态次数 (30 次 x 100ms = 3 秒窗口) */
const MAX_BOOT_ATTEMPTS = 30;
const BOOT_RETRY_INTERVAL_MS = 100;

(function setupEventListeners(): void {
    let attempts = 0;

    function tryRegister(): void {
        if (!isContextReady()) {
            attempts++;
            if (attempts < MAX_BOOT_ATTEMPTS) {
                setTimeout(tryRegister, BOOT_RETRY_INTERVAL_MS);
            } else {
                logger.error(`宿主环境就绪超时 (${MAX_BOOT_ATTEMPTS * BOOT_RETRY_INTERVAL_MS}ms)，无法获取 getContext()，放弃注册宿主事件`);
            }
            return;
        }

        try {
            const ctx = getContext();
            const { eventSource, event_types } = ctx;

            // APP_READY 有"补触发"特性，触发即初始化扩展
            eventSource.on(event_types.APP_READY, () => {
                void init();
                // 宿主 DOM 慢渲染防抖兜底扫描
                setTimeout(injectExistingMessages, 1000);
            });

            // 监听设置更新事件 → 同步 Store
            if (event_types.EXTENSION_SETTINGS_UPDATED) {
                eventSource.on(event_types.EXTENSION_SETTINGS_UPDATED, () => {
                    reloadRuntimeSettings();
                });
            }
            eventSource.on('ST_DRAW_ASSISTANT_SETTINGS_CHANGED', () => {
                reloadRuntimeSettings();
            });

            // 订阅单条消息渲染与编辑事件 (统一路由至 600ms 防抖调度器，跳过流式中间态与高频重复触发)
            if (event_types.CHARACTER_MESSAGE_RENDERED) {
                eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (data: unknown) => {
                    debouncedCharacterRender(data);
                });
            }
            if (event_types.MESSAGE_EDITED) {
                eventSource.on(event_types.MESSAGE_EDITED, (data: unknown) => {
                    debouncedCharacterRender(data);
                });
            }
            if (event_types.MESSAGE_UPDATED) {
                eventSource.on(event_types.MESSAGE_UPDATED, (data: unknown) => {
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

            // CHAT_DELETED：删除聊天文件时尝试触发自动擦除 (当且仅当用户开启 autoCleanupOnChatDelete 配置)
            if (event_types.CHAT_DELETED) {
                eventSource.on(event_types.CHAT_DELETED, (data: unknown) => {
                    const chatData = data as { id?: string; messages?: unknown[] } | undefined;
                    if (chatData?.id) {
                        import('./storage/chat-scanner').then(({ handleChatDeleted }) => {
                            void handleChatDeleted(chatData.id!, chatData.messages);
                        }).catch(err => {
                            logger.error('处理 CHAT_DELETED 事件失败', err);
                        });
                    }
                });
            }

            // GENERATION_ENDED：LLM 生成彻底结束时触发一次全量完成注入，并处理自动生图
            if (event_types.GENERATION_ENDED) {
                eventSource.on(event_types.GENERATION_ENDED, () => {
                    logger.debug('GENERATION_ENDED event fired, re-scanning messages');
                    setTimeout(() => {
                        injectExistingMessages();
                        const currentSettings = settingsStore.getState();
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
            logger.error('注册宿主事件监听失败', err);
        }
    }

    tryRegister();
})();
