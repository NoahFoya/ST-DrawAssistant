/**
 * ST-DrawAssistant 扩展入口（P0 完整版）
 *
 * 初始化模式：遵循 ST 宿主推荐的"顶层仅注册监听，APP_READY 内完成所有初始化"模式
 * 参考：.agents/Skills/sillytavern-extension-host/SKILL.md §4.2
 *
 * 关键约束：
 * - 模块顶层可安全调用 getContext() 获取 eventSource/event_types（宿主已挂载）
 * - extension_settings 访问必须在 APP_READY 后执行（此时设置已加载完毕）
 * - CHARACTER_MESSAGE_RENDERED 事件数据含 { message, element }，直接用 element
 */

import { MODULE_NAME, EXTENSION_DISPLAY_NAME, VERSION } from './core/constants';
import { getContext } from './core/context';
import { loadSettings } from './settings/manager';
import { createDriver } from './drivers/factory';
import { TaskManager } from './task/manager';
import { renderSettingsPanel } from './ui/settings-panel';
import { injectFloorButtons } from './ui/floor-button';
import type { DrawAssistantSettings } from './settings/types';
import type { ImageDriver } from './drivers/types';

// ─── 模块级状态 ────────────────────────────────────────────────────────────────

let settings: DrawAssistantSettings | null = null;
let driver: ImageDriver | null = null;
let taskManager: TaskManager | null = null;
let initialized = false;

// ─── 初始化 ───────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
    if (initialized) return;
    initialized = true;

    console.log(`[${MODULE_NAME}] Initializing ${EXTENSION_DISPLAY_NAME} v${VERSION}...`);

    try {
        // 1. 加载设置（必须在 APP_READY 后，此时 extension_settings 已就绪）
        settings = loadSettings();
        console.log(`[${MODULE_NAME}] Settings loaded, provider: ${settings.provider}, url: ${settings.serverUrl}`);

        // 2. 若 loadSettings 返回的是默认值（extension_settings 尚不可用时），
        //    尝试再次写入以确保持久化
        const ctx = getContext();
        if (ctx.extension_settings && !ctx.extension_settings[MODULE_NAME]) {
            ctx.extension_settings[MODULE_NAME] = settings;
            ctx.saveSettingsDebounced();
        }

        // 3. 实例化驱动
        driver = createDriver(settings.provider, settings);

        // 4. 实例化 TaskManager
        taskManager = new TaskManager();

        // 5. 渲染设置面板（非核心功能，失败不阻断生图功能）
        try {
            await renderSettingsPanel();
        } catch (panelErr) {
            console.warn(`[${MODULE_NAME}] Settings panel render failed (non-fatal):`, panelErr);
        }

        // 6. 对已有消息注入楼层按钮（刷新后恢复）
        injectExistingMessages();

        console.log(`[${MODULE_NAME}] Ready ✅ Trigger image generation with: ${settings.placeholderStart}prompt${settings.placeholderEnd}`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] Initialization failed:`, err);
        initialized = false; // 允许重试
    }
}

// ─── 消息渲染事件处理 ─────────────────────────────────────────────────────────

/**
 * CHARACTER_MESSAGE_RENDERED 事件处理器
 * 事件数据：{ message: ChatMessage, element: HTMLElement }
 * 或 ST 早期版本仅传 messageId: number
 */
function onCharacterMessageRendered(data: unknown): void {
    if (!settings || !driver || !taskManager) {
        console.debug('[draw-assistant] onCharacterMessageRendered: not initialized yet');
        return;
    }

    console.debug('[draw-assistant] CHARACTER_MESSAGE_RENDERED fired, data type:', typeof data, data);

    let messageElement: HTMLElement | null = null;
    let messageIndex = -1;

    if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;

        // 新版 ST：事件数据含 element（HTMLElement）
        if (d['element'] instanceof HTMLElement) {
            messageElement = d['element'];
            // 从 mesid 属性读取 index
            const mesId = messageElement.getAttribute('mesid');
            messageIndex = mesId ? parseInt(mesId, 10) : -1;
        }

        // 也可能携带 message 对象（含 swipe_id 用于区分楼层）
        if (messageIndex === -1 && d['messageId'] !== undefined) {
            messageIndex = d['messageId'] as number;
            messageElement = document.querySelector<HTMLElement>(`[mesid="${messageIndex}"]`);
        }
    } else if (typeof data === 'number') {
        // 旧版 ST：直接传 messageId number
        messageIndex = data;
        messageElement = document.querySelector<HTMLElement>(`[mesid="${messageIndex}"]`);
    }

    // 后备：取最后一条 AI 消息
    if (!messageElement) {
        const allMessages = document.querySelectorAll<HTMLElement>('.mes[is_user="false"]');
        const last = allMessages[allMessages.length - 1];
        if (last) {
            messageElement = last;
            const mesId = last.getAttribute('mesid');
            messageIndex = mesId ? parseInt(mesId, 10) : -1;
        }
    }

    if (messageElement && messageIndex >= 0) {
        injectFloorButtons(messageElement, messageIndex, taskManager, driver, settings);
    }
}

/** 对页面上已存在的所有消息补充注入（刷新页面/切换聊天/Swipe/消息编辑后恢复按钮） */
function injectExistingMessages(): void {
    if (!settings || !driver || !taskManager) return;

    // 扫描聊天面板中的所有消息楼层
    const allMessages = document.querySelectorAll<HTMLElement>('.mes');
    console.debug(`[draw-assistant] injectExistingMessages: scanning ${allMessages.length} message(s)`);

    allMessages.forEach((mesEl) => {
        const mesIdStr = mesEl.getAttribute('mesid');
        const messageIndex = mesIdStr ? parseInt(mesIdStr, 10) : -1;
        if (messageIndex >= 0) {
            injectFloorButtons(mesEl, messageIndex, taskManager!, driver!, settings!);
        }
    });
}

// ─── 顶层：注册宿主事件监听 ────────────────────────────────────────────────────

(function setup(): void {
    try {
        const ctx = getContext();
        const { eventSource, event_types } = ctx;

        // APP_READY 有"补触发"特性，注册时无需担心时机
        eventSource.on(event_types.APP_READY, () => {
            void init();
            // 延迟多段防抖兜底扫描
            setTimeout(injectExistingMessages, 200);
            setTimeout(injectExistingMessages, 800);
        });

        // 订阅消息渲染、Swipe 切换及开场白选择相关事件
        const renderEvents = [
            event_types.CHARACTER_MESSAGE_RENDERED,
            event_types.USER_MESSAGE_RENDERED,
            event_types.MESSAGE_SWIPED,
            'character_message_rendered',
            'user_message_rendered',
            'message_swiped',
            'message_updated',
            'message_edited',
            'character_first_message_selected',
            'chat_loaded',
        ];

        renderEvents.forEach((evtName) => {
            if (evtName && typeof evtName === 'string') {
                eventSource.on(evtName, (data: unknown) => {
                    // 50ms 延时防抖：等待 ST 宿主完成 DOM 节点更新与 swipe_id 数据绑定
                    setTimeout(() => {
                        onCharacterMessageRendered(data);
                        injectExistingMessages();
                    }, 50);
                });
            }
        });

        // CHAT_CHANGED：切换聊天时重新扫描楼层
        if (event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => {
                console.debug('[draw-assistant] CHAT_CHANGED event fired, re-scanning messages');
                setTimeout(injectExistingMessages, 100);
                setTimeout(injectExistingMessages, 500);
            });
        }

        // GENERATION_ENDED：LLM 生成结束时重新扫描楼层（流式输出结束兜底）
        if (event_types.GENERATION_ENDED) {
            eventSource.on(event_types.GENERATION_ENDED, () => {
                console.debug('[draw-assistant] GENERATION_ENDED event fired, re-scanning messages');
                setTimeout(injectExistingMessages, 100);
            });
        }

    } catch (err) {
        console.error(`[${MODULE_NAME}] Failed to register event listeners:`, err);
    }
})();
