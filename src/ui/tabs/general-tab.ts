/**
 * @module ui/tabs/general-tab
 * @description 通用参数与后端提供者设置 Tab 组件
 *
 * 职责：
 * - Card 1: 运行模式与请求控制 (插件开关、帮助说明图标显隐、生图模式、请求模式浏览器/酒馆、超时门限、最大并发数)
 * - Card 2: 楼层生图触发与交互行为 (起始/结束标志符分离设置、AI回复完成后自动点击生图、全屏 Lightbox)
 * - Card 3: 数据持久化与缓存清理 (酒馆聊天记录写入、Storage Quota 估计、缓存清理)
 */

import { createFieldRow } from '../components/field-row';
import { loadSettings, updateSettings } from '../../settings/manager';
import { refreshSidebarTabs } from '../settings-panel';
import { refreshFooterStatus } from '../components/footer-bar';
import { logger } from '../../core/logger';
import type { ImageProvider } from '../../settings/types';

/**
 * 渲染主要设置 Tab 面板节点
 *
 * @returns 主要设置 Tab 容器 HTMLElement
 */
export function renderGeneralTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-general-tab';

    const settings = loadSettings();

    // 💡 顶部轻量参数修改反馈提示条
    const hintCard = document.createElement('div');
    hintCard.className = 'da-tab-change-hint';
    hintCard.style.display = 'none';
    hintCard.innerHTML = '<span>配置已即时自动保存并生效</span>';
    container.appendChild(hintCard);

    let changeHintTimer: number | null = null;
    const notifyChange = (): void => {
        if (changeHintTimer !== null) window.clearTimeout(changeHintTimer);
        hintCard.style.display = 'flex';
        changeHintTimer = window.setTimeout(() => {
            hintCard.style.display = 'none';
            changeHintTimer = null;
        }, 2500);
    };

    // ── 1. 运行模式与请求控制卡片 ────────────────────────────────────────────
    const cardMode = document.createElement('div');
    cardMode.className = 'da-section-card';

    const headerMode = document.createElement('div');
    headerMode.className = 'da-section-header';
    headerMode.innerHTML = `
        <span class="da-section-title">运行模式与请求控制</span>
        <span class="da-section-desc">配置插件全局响应状态、帮助图标、生图模式、请求模式与并发超时门限</span>
    `;
    cardMode.appendChild(headerMode);

    // 1.1 启用插件
    const enabledToggleLabel = document.createElement('label');
    enabledToggleLabel.className = 'da-toggle';
    const enabledInput = document.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.checked = settings.enabled ?? true;
    const enabledSlider = document.createElement('span');
    enabledSlider.className = 'da-slider';
    enabledToggleLabel.appendChild(enabledInput);
    enabledToggleLabel.appendChild(enabledSlider);

    enabledInput.addEventListener('change', () => {
        updateSettings({ enabled: enabledInput.checked });
        notifyChange();
    });

    cardMode.appendChild(createFieldRow({
        label: '启用插件',
        helpTooltip: '插件全局总开关。开启后可自动解析 AI 楼层文本中的生图指令并驱动后端渲染。',
        control: enabledToggleLabel,
    }));

    // 1.2 显示帮助图标
    const helpToggleLabel = document.createElement('label');
    helpToggleLabel.className = 'da-toggle';
    const helpInput = document.createElement('input');
    helpInput.type = 'checkbox';
    helpInput.checked = settings.showHelp ?? true;
    const helpSlider = document.createElement('span');
    helpSlider.className = 'da-slider';
    helpToggleLabel.appendChild(helpInput);
    helpToggleLabel.appendChild(helpSlider);

    helpInput.addEventListener('change', () => {
        updateSettings({ showHelp: helpInput.checked });
        notifyChange();
    });

    cardMode.appendChild(createFieldRow({
        label: '显示帮助图标',
        control: helpToggleLabel,
    }));

    // 1.3 生图模式
    const providerSelect = document.createElement('select');
    providerSelect.className = 'da-select da-control-fixed-180';
    providerSelect.innerHTML = `
        <option value="comfyui">ComfyUI 引擎</option>
        <option value="webui">SD WebUI (已归档)</option>
    `;
    providerSelect.value = settings.provider ?? 'comfyui';
    providerSelect.addEventListener('change', () => {
        const selected = providerSelect.value as ImageProvider;
        updateSettings({ provider: selected });
        notifyChange();
        refreshSidebarTabs();
        refreshFooterStatus();
    });

    cardMode.appendChild(createFieldRow({
        label: '生图模式',
        control: providerSelect,
    }));

    // 1.4 请求模式
    const reqModeSelect = document.createElement('select');
    reqModeSelect.className = 'da-select da-control-fixed-180';
    reqModeSelect.innerHTML = `
        <option value="browser">浏览器直连</option>
        <option value="server">酒馆代理</option>
    `;
    reqModeSelect.value = settings.requestMode ?? 'browser';
    reqModeSelect.addEventListener('change', () => {
        updateSettings({ requestMode: reqModeSelect.value as 'browser' | 'server' });
        notifyChange();
    });

    cardMode.appendChild(createFieldRow({
        label: '请求模式',
        helpTooltip: '【浏览器直连】由前端直接向 ComfyUI 发起 HTTP/WS 连接；【酒馆代理】由 SillyTavern Node 服务端代理转发，可避开跨域 CORS 拦截。',
        control: reqModeSelect,
    }));

    // 1.5 请求超时时间
    const timeoutInput = document.createElement('input');
    timeoutInput.type = 'number';
    timeoutInput.className = 'da-input da-control-fixed-180';
    timeoutInput.min = '5';
    timeoutInput.max = '600';
    timeoutInput.value = String(Math.round((settings.requestTimeout ?? 120000) / 1000));
    const saveTimeout = (): void => {
        const valSec = parseInt(timeoutInput.value, 10);
        if (valSec > 0) {
            updateSettings({ requestTimeout: valSec * 1000 });
            notifyChange();
        }
    };
    timeoutInput.addEventListener('change', saveTimeout);
    timeoutInput.addEventListener('blur', saveTimeout);

    cardMode.appendChild(createFieldRow({
        label: '请求超时时间 (秒)',
        control: timeoutInput,
    }));

    // 1.6 最大并发生图数
    const maxConcurrencyInput = document.createElement('input');
    maxConcurrencyInput.type = 'number';
    maxConcurrencyInput.className = 'da-input da-control-fixed-180';
    maxConcurrencyInput.min = '1';
    maxConcurrencyInput.max = '10';
    maxConcurrencyInput.value = String(settings.maxConcurrent ?? 1);
    const saveConcurrency = (): void => {
        const val = parseInt(maxConcurrencyInput.value, 10);
        if (val > 0) {
            updateSettings({ maxConcurrent: val });
            notifyChange();
        }
    };
    maxConcurrencyInput.addEventListener('change', saveConcurrency);
    maxConcurrencyInput.addEventListener('blur', saveConcurrency);

    cardMode.appendChild(createFieldRow({
        label: '最大并发生图数 (任务)',
        control: maxConcurrencyInput,
    }));

    container.appendChild(cardMode);

    // ── 2. 楼层生图触发与交互行为卡片 ──────────────────────────────────────────
    const cardFloor = document.createElement('div');
    cardFloor.className = 'da-section-card';

    const headerFloor = document.createElement('div');
    headerFloor.className = 'da-section-header';
    headerFloor.innerHTML = `
        <span class="da-section-title">楼层生图触发与交互行为</span>
        <span class="da-section-desc">配置聊天文本中的生图标志符、AI 回复自动生图触发机制与大图全屏预览</span>
    `;
    cardFloor.appendChild(headerFloor);

    // 2.1 绘图起始标志符
    const promptTagInput = document.createElement('input');
    promptTagInput.type = 'text';
    promptTagInput.className = 'da-input da-control-fixed-180';
    promptTagInput.value = settings.placeholderStart ?? 'image###';
    const savePromptTag = (): void => {
        const val = promptTagInput.value.trim();
        if (val) {
            updateSettings({ placeholderStart: val });
            notifyChange();
        }
    };
    promptTagInput.addEventListener('change', savePromptTag);
    promptTagInput.addEventListener('blur', savePromptTag);

    cardFloor.appendChild(createFieldRow({
        label: '绘图起始标志符',
        helpTooltip: '格式范例：image###正向提示词 | 负向提示词###（支持使用 | 符号分割正向与负向提示词）',
        control: promptTagInput,
    }));

    // 2.2 绘图结束标志符
    const endPromptTagInput = document.createElement('input');
    endPromptTagInput.type = 'text';
    endPromptTagInput.className = 'da-input da-control-fixed-180';
    endPromptTagInput.value = settings.placeholderEnd ?? '###';
    const saveEndPromptTag = (): void => {
        const val = endPromptTagInput.value.trim();
        if (val) {
            updateSettings({ placeholderEnd: val });
            notifyChange();
        }
    };
    endPromptTagInput.addEventListener('change', saveEndPromptTag);
    endPromptTagInput.addEventListener('blur', saveEndPromptTag);

    cardFloor.appendChild(createFieldRow({
        label: '绘图结束标志符',
        control: endPromptTagInput,
    }));

    // 2.3 AI回复完成后自动点击生图
    const autoClickToggleLabel = document.createElement('label');
    autoClickToggleLabel.className = 'da-toggle';
    const autoClickInput = document.createElement('input');
    autoClickInput.type = 'checkbox';
    autoClickInput.checked = settings.autoGenerate ?? false;
    const autoClickSlider = document.createElement('span');
    autoClickSlider.className = 'da-slider';
    autoClickToggleLabel.appendChild(autoClickInput);
    autoClickToggleLabel.appendChild(autoClickSlider);

    autoClickInput.addEventListener('change', (): void => {
        updateSettings({ autoGenerate: autoClickInput.checked });
        notifyChange();
    });

    cardFloor.appendChild(createFieldRow({
        label: 'AI回复完成后自动点击生图',
        control: autoClickToggleLabel,
    }));

    // 2.4 全屏 Lightbox 预览
    const lightboxToggleLabel = document.createElement('label');
    lightboxToggleLabel.className = 'da-toggle';
    const lightboxInput = document.createElement('input');
    lightboxInput.type = 'checkbox';
    lightboxInput.checked = settings.lightboxEnabled ?? true;
    const lightboxSlider = document.createElement('span');
    lightboxSlider.className = 'da-slider';
    lightboxToggleLabel.appendChild(lightboxInput);
    lightboxToggleLabel.appendChild(lightboxSlider);

    lightboxInput.addEventListener('change', (): void => {
        updateSettings({ lightboxEnabled: lightboxInput.checked });
        notifyChange();
    });

    cardFloor.appendChild(createFieldRow({
        label: '点击图片全屏 Lightbox 预览',
        control: lightboxToggleLabel,
    }));

    container.appendChild(cardFloor);

    // ── 3. 数据持久化与缓存清理卡片 ──────────────────────────────────────────
    const cardStorage = document.createElement('div');
    cardStorage.className = 'da-section-card';

    const headerStorage = document.createElement('div');
    headerStorage.className = 'da-section-header';
    headerStorage.innerHTML = `
        <span class="da-section-title">数据持久化与缓存清理</span>
        <span class="da-section-desc">配置酒馆聊天记录数据持久化策略与一键物理清空缓存数据库</span>
    `;
    cardStorage.appendChild(headerStorage);

    // 3.1 写入酒馆聊天记录
    const persistToggleLabel = document.createElement('label');
    persistToggleLabel.className = 'da-toggle';
    const persistInput = document.createElement('input');
    persistInput.type = 'checkbox';
    persistInput.checked = settings.persistToChat ?? true;
    const persistSlider = document.createElement('span');
    persistSlider.className = 'da-slider';
    persistToggleLabel.appendChild(persistInput);
    persistToggleLabel.appendChild(persistSlider);

    persistInput.addEventListener('change', (): void => {
        updateSettings({ persistToChat: persistInput.checked });
        notifyChange();
    });

    cardStorage.appendChild(createFieldRow({
        label: '写入酒馆聊天记录',
        helpTooltip: '开启后生成的图片会自动关联写回对应 AI 消息楼层。物理图像与 WebP 缩略图全量在 IndexedDB 中独立存储，规避 chat.json 体积膨胀。',
        control: persistToggleLabel,
    }));

    // 3.2 缓存与存储数据库重置
    const clearStorageBtn = document.createElement('button');
    clearStorageBtn.className = 'da-btn danger';
    clearStorageBtn.textContent = '物理重置图库数据库';

    clearStorageBtn.addEventListener('click', async (): Promise<void> => {
        if (confirm('警告：确认要永久清空本地所有已保存的生成图片与缓存索引吗？此操作不可撤销！')) {
            try {
                const { clearAllImagesFromDB } = await import('../../storage/image-db');
                await clearAllImagesFromDB();
                notifyChange();
                showToastNotice('本地图库数据库已成功彻底清空。', true);
            } catch (err) {
                logger.error('物理清空图库数据库失败', err);
                showToastNotice(`清空失败: ${err instanceof Error ? err.message : String(err)}`, false);
            }
        }
    });

    cardStorage.appendChild(createFieldRow({
        label: '物理重置图库数据库',
        control: clearStorageBtn,
    }));

    container.appendChild(cardStorage);

    return container;
}

/** 辅助函数：显示 ST 全局 Toast 通知 */
function showToastNotice(message: string, isSuccess: boolean): void {
    const win = window as unknown as { toastr?: { success?: (m: string, t?: string) => void; error?: (m: string, t?: string) => void } };
    if (win.toastr) {
        if (isSuccess && typeof win.toastr.success === 'function') {
            win.toastr.success(message, 'Starlight DrawAssistant');
        } else if (!isSuccess && typeof win.toastr.error === 'function') {
            win.toastr.error(message, 'Starlight DrawAssistant');
        }
    }
}
