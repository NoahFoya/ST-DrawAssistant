/**
 * @module ui/tabs/general-tab
 * @description 通用参数与后端提供者设置 Tab 组件
 *
 * 核心职责：
 * - Card 1: 运行模式与请求控制 (插件开关、帮助说明图标显隐、生图模式、请求模式浏览器/酒馆、超时门限、最大并发数)
 * - Card 2: 楼层生图触发与交互行为 (起始/结束标志符分离设置、AI回复完成后自动点击生图、全屏 Lightbox)
 * - Card 3: 数据持久化与缓存清理 (酒馆聊天记录写入、Storage Quota 估计、缓存清理)
 */

import { createFieldRow, refreshFooterStatus } from '../components/controls';
import { loadSettings } from '../../settings/manager';
import { patchSettings } from '../../state/app-store';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import { refreshSidebarTabs } from '../settings-panel';
import { logger } from '../../core/logger';
import type { ImageProvider, ImageDisplayConfig } from '../../settings/types';
import { FeedbackService } from '../feedback-service';

/**
 * 渲染主要设置 Tab 页面
 *
 * @returns 主要设置 Tab 容器 HTMLElement
 */
export function renderGeneralTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-general-tab';

    const settings = loadSettings();

    // 即时自动保存策略：交互控制触发 patchSettings 成功保存后发出反馈通知
    const notifyChange = (): void => {
        FeedbackService.notifySaved('general');
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
        patchSettings({ enabled: enabledInput.checked });
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
        patchSettings({ showHelp: helpInput.checked });
        notifyChange();
    });

    cardMode.appendChild(createFieldRow({
        label: '显示帮助图标',
        helpTooltip: '控制是否在各个设置项标题旁显示 ❓ 详细说明帮助按钮。',
        control: helpToggleLabel,
    }));

    // 1.3 生图模式
    const providerSelect = document.createElement('select');
    providerSelect.className = 'da-select da-control-fixed-180';
    providerSelect.innerHTML = `
        <option value="comfyui">ComfyUI</option>
        <option value="sd-webui">SD WebUI</option>
    `;
    providerSelect.value = settings.provider ?? 'comfyui';
    providerSelect.addEventListener('change', () => {
        const selected = providerSelect.value as ImageProvider;
        if (selected === (loadSettings().provider ?? 'comfyui')) return; // 同值防重阻断
        patchSettings({ provider: selected });
        notifyChange();
        refreshSidebarTabs();
        refreshFooterStatus();
    });

    cardMode.appendChild(createFieldRow({
        label: '生图模式',
        helpTooltip: '选择生图后端引擎。支持 ComfyUI 工作流模式与 Stable Diffusion WebUI (A1111) 接口模式。',
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
        const val = reqModeSelect.value as 'browser' | 'server';
        if (val === (loadSettings().requestMode ?? 'browser')) return; // 同值防重阻断
        patchSettings({ requestMode: val });
        notifyChange();
    });

    cardMode.appendChild(createFieldRow({
        label: '请求模式',
        helpTooltip: '【浏览器直连】前端直接连接生图引擎服务；【酒馆代理】由酒馆 Node 服务端代理转发，可避开跨域 (CORS) 拦截。',
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
            const currentMs = loadSettings().requestTimeout ?? 120000;
            if (valSec * 1000 === currentMs) return;
            patchSettings({ requestTimeout: valSec * 1000 });
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
            const currentVal = loadSettings().maxConcurrent ?? 1;
            if (val === currentVal) return;
            patchSettings({ maxConcurrent: val });
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
            const currentVal = loadSettings().placeholderStart ?? 'image###';
            if (val === currentVal) return;
            patchSettings({ placeholderStart: val });
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
            const currentVal = loadSettings().placeholderEnd ?? '###';
            if (val === currentVal) return;
            patchSettings({ placeholderEnd: val });
            notifyChange();
        }
    };
    endPromptTagInput.addEventListener('change', saveEndPromptTag);
    endPromptTagInput.addEventListener('blur', saveEndPromptTag);

    cardFloor.appendChild(createFieldRow({
        label: '绘图结束标志符',
        control: endPromptTagInput,
    }));

    // 2.3 启用长按/右键快捷操作面板
    const actionPanelToggleLabel = document.createElement('label');
    actionPanelToggleLabel.className = 'da-toggle';
    const actionPanelInput = document.createElement('input');
    actionPanelInput.type = 'checkbox';
    actionPanelInput.checked = settings.enableActionPanel ?? true;
    const actionPanelSlider = document.createElement('span');
    actionPanelSlider.className = 'da-slider';
    actionPanelToggleLabel.appendChild(actionPanelInput);
    actionPanelToggleLabel.appendChild(actionPanelSlider);

    actionPanelInput.addEventListener('change', () => {
        patchSettings({ enableActionPanel: actionPanelInput.checked });
        notifyChange();
    });

    cardFloor.appendChild(createFieldRow({
        label: '启用长按/右键快捷操作面板',
        helpTooltip: '开启后在消息楼层图像上长按或右键可唤出快捷操作菜单（重新生图、临时修改 Tags、局部重绘等）；关闭后仅保留单击大图预览。',
        control: actionPanelToggleLabel,
    }));

    // 2.4 AI回复完成后自动点击生图
    const autoClickToggleLabel = document.createElement('label');
    autoClickToggleLabel.className = 'da-toggle';
    const autoClickInput = document.createElement('input');
    autoClickInput.type = 'checkbox';
    autoClickInput.checked = settings.autoGenerate ?? false;
    const autoClickSlider = document.createElement('span');
    autoClickSlider.className = 'da-slider';
    autoClickToggleLabel.appendChild(autoClickInput);
    autoClickToggleLabel.appendChild(autoClickSlider);

    autoClickInput.addEventListener('change', () => {
        patchSettings({ autoGenerate: autoClickInput.checked });
        notifyChange();
    });

    cardFloor.appendChild(createFieldRow({
        label: 'AI回复完成后自动点击生图',
        control: autoClickToggleLabel,
    }));

    // 2.5 全屏 Lightbox 预览
    const lightboxToggleLabel = document.createElement('label');
    lightboxToggleLabel.className = 'da-toggle';
    const lightboxInput = document.createElement('input');
    lightboxInput.type = 'checkbox';
    lightboxInput.checked = settings.lightboxEnabled ?? true;
    const lightboxSlider = document.createElement('span');
    lightboxSlider.className = 'da-slider';
    lightboxToggleLabel.appendChild(lightboxInput);
    lightboxToggleLabel.appendChild(lightboxSlider);

    lightboxInput.addEventListener('change', () => {
        patchSettings({ lightboxEnabled: lightboxInput.checked });
        notifyChange();
    });

    cardFloor.appendChild(createFieldRow({
        label: '点击大图唤出全屏 Lightbox 预览',
        control: lightboxToggleLabel,
    }));

    // 2.6 自动清洗多余空格与空行
    const cleanSpacesToggleLabel = document.createElement('label');
    cleanSpacesToggleLabel.className = 'da-toggle';
    const cleanSpacesInput = document.createElement('input');
    cleanSpacesInput.type = 'checkbox';
    cleanSpacesInput.checked = settings.cleanExtraSpacesAndLines ?? true;
    const cleanSpacesSlider = document.createElement('span');
    cleanSpacesSlider.className = 'da-slider';
    cleanSpacesToggleLabel.appendChild(cleanSpacesInput);
    cleanSpacesToggleLabel.appendChild(cleanSpacesSlider);

    cleanSpacesInput.addEventListener('change', () => {
        patchSettings({ cleanExtraSpacesAndLines: cleanSpacesInput.checked });
        notifyChange();
    });

    cardFloor.appendChild(createFieldRow({
        label: '自动清洗多余空格与空行',
        helpTooltip: '开启后自动过滤提示词中连续的多余空格、换行符及重复逗号，提高提交给生图引擎的提示词纯净度。',
        control: cleanSpacesToggleLabel,
    }));

    // 2.6 删除聊天记录时自动擦除关联图像
    const autoCleanToggleLabel = document.createElement('label');
    autoCleanToggleLabel.className = 'da-toggle';
    const autoCleanInput = document.createElement('input');
    autoCleanInput.type = 'checkbox';
    autoCleanInput.checked = settings.autoCleanupOnChatDelete ?? false;
    const autoCleanSlider = document.createElement('span');
    autoCleanSlider.className = 'da-slider';
    autoCleanToggleLabel.appendChild(autoCleanInput);
    autoCleanToggleLabel.appendChild(autoCleanSlider);

    autoCleanInput.addEventListener('change', () => {
        patchSettings({ autoCleanupOnChatDelete: autoCleanInput.checked });
        notifyChange();
    });

    cardFloor.appendChild(createFieldRow({
        label: '删除聊天记录时自动擦除关联图像',
        helpTooltip: '开启后，在酒馆删除聊天记录文件时同步清理该对话引用的本地图库缓存。',
        control: autoCleanToggleLabel,
    }));

    // ── 3. 进阶/扩展功能管理卡片 ───────────────────────────────────────────────
    const cardExt = document.createElement('div');
    cardExt.className = 'da-section-card';

    const headerExt = document.createElement('div');
    headerExt.className = 'da-section-header';
    headerExt.innerHTML = `
        <span class="da-section-title">进阶/扩展功能管理</span>
        <span class="da-section-desc">集中管理扩展功能与高级组件的启用状态；未开启的功能将自动隐藏其导航界面</span>
    `;
    cardExt.appendChild(headerExt);

    // 3.1 角色与服装设定管理扩展
    const charExtToggleLabel = document.createElement('label');
    charExtToggleLabel.className = 'da-toggle';
    const charExtInput = document.createElement('input');
    charExtInput.type = 'checkbox';
    const extState = settings.extensions?.['character-manager'];
    charExtInput.checked = extState?.enabled !== false;
    const charExtSlider = document.createElement('span');
    charExtSlider.className = 'da-slider';
    charExtToggleLabel.appendChild(charExtInput);
    charExtToggleLabel.appendChild(charExtSlider);

    charExtInput.addEventListener('change', () => {
        const currentExts = settings.extensions ?? {};
        patchSettings({
            extensions: {
                ...currentExts,
                'character-manager': {
                    enabled: charExtInput.checked,
                    config: currentExts['character-manager']?.config,
                },
            },
        });
        notifyChange();
        refreshSidebarTabs();
    });

    cardExt.appendChild(createFieldRow({
        label: '角色与服装设定管理',
        helpTooltip: '开启后在侧边栏显示【角色管理】Tab，支持为特定角色卡/Chat ID 绑定专属生图方案及世界书占位符注入。关闭后自动隐藏该 Tab。',
        control: charExtToggleLabel,
    }));

    // ── 3. 图像显示样式与对齐控制卡片 ─────────────────────────────────────────
    const cardDisplay = document.createElement('div');
    cardDisplay.className = 'da-section-card';

    const headerDisplay = document.createElement('div');
    headerDisplay.className = 'da-section-header';
    headerDisplay.innerHTML = `
        <span class="da-section-title">图像显示样式与对齐控制</span>
        <span class="da-section-desc">自定义生成图像在 AI 消息楼层中的对齐位置、缩放填充模式、尺寸限制与圆角边框</span>
    `;
    cardDisplay.appendChild(headerDisplay);

    const getLatestDisplay = (): ImageDisplayConfig => {
        return loadSettings().imageDisplay ?? DEFAULT_SETTINGS.imageDisplay!;
    };

    const currentDisplay = getLatestDisplay();

    // 3.1 对齐方式
    const alignSelect = document.createElement('select');
    alignSelect.className = 'da-select da-control-fixed-180';
    alignSelect.innerHTML = `
        <option value="left">左对齐 (居左)</option>
        <option value="center">居中对齐 (居中)</option>
        <option value="right">右对齐 (居右)</option>
    `;
    alignSelect.value = currentDisplay.align ?? 'left';
    alignSelect.addEventListener('change', () => {
        patchSettings({ imageDisplay: { ...getLatestDisplay(), align: alignSelect.value as 'left' | 'center' | 'right' } });
        notifyChange();
    });

    cardDisplay.appendChild(createFieldRow({
        label: '楼层对齐方式',
        control: alignSelect,
    }));

    // 3.2 缩放填充模式
    const fitSelect = document.createElement('select');
    fitSelect.className = 'da-select da-control-fixed-180';
    fitSelect.innerHTML = `
        <option value="contain">等比完整显示 (contain)</option>
        <option value="cover">裁剪裁剪填充 (cover)</option>
        <option value="fill">拉伸适应 (fill)</option>
        <option value="none">原始尺寸 (none)</option>
    `;
    fitSelect.value = currentDisplay.objectFit ?? 'contain';
    fitSelect.addEventListener('change', () => {
        patchSettings({ imageDisplay: { ...getLatestDisplay(), objectFit: fitSelect.value as 'contain' | 'cover' | 'fill' | 'none' } });
        notifyChange();
    });

    cardDisplay.appendChild(createFieldRow({
        label: '图像缩放模式 (object-fit)',
        control: fitSelect,
    }));

    // 3.3 最大显示高度 (px)
    const maxHeightInput = document.createElement('input');
    maxHeightInput.type = 'number';
    maxHeightInput.className = 'da-input da-control-fixed-180';
    maxHeightInput.min = '0';
    maxHeightInput.max = '2000';
    maxHeightInput.value = String(currentDisplay.maxHeight ?? 0);
    const saveMaxHeight = (): void => {
        const val = parseInt(maxHeightInput.value, 10);
        if (!isNaN(val) && val >= 0) {
            const currentVal = getLatestDisplay().maxHeight ?? 0;
            if (val === currentVal) return;
            patchSettings({ imageDisplay: { ...getLatestDisplay(), maxHeight: val } });
            notifyChange();
        }
    };
    maxHeightInput.addEventListener('change', saveMaxHeight);
    maxHeightInput.addEventListener('blur', saveMaxHeight);

    cardDisplay.appendChild(createFieldRow({
        label: '最大显示高度 (px)',
        helpTooltip: '设置为 0 时不限制显示高度；设置具体像素（如 400）时超高部分将自适应限制。',
        control: maxHeightInput,
    }));

    // 3.4 最大显示宽度 (%)
    const maxWidthInput = document.createElement('input');
    maxWidthInput.type = 'number';
    maxWidthInput.className = 'da-input da-control-fixed-180';
    maxWidthInput.min = '10';
    maxWidthInput.max = '100';
    maxWidthInput.value = String(currentDisplay.maxWidthPct ?? 100);
    const saveMaxWidth = (): void => {
        const val = parseInt(maxWidthInput.value, 10);
        if (!isNaN(val) && val >= 10 && val <= 100) {
            const currentVal = getLatestDisplay().maxWidthPct ?? 100;
            if (val === currentVal) return;
            patchSettings({ imageDisplay: { ...getLatestDisplay(), maxWidthPct: val } });
            notifyChange();
        }
    };
    maxWidthInput.addEventListener('change', saveMaxWidth);
    maxWidthInput.addEventListener('blur', saveMaxWidth);

    cardDisplay.appendChild(createFieldRow({
        label: '最大显示宽度百分比 (%)',
        control: maxWidthInput,
    }));

    // 3.5 圆角边框
    const roundedToggleLabel = document.createElement('label');
    roundedToggleLabel.className = 'da-toggle';
    const roundedInput = document.createElement('input');
    roundedInput.type = 'checkbox';
    roundedInput.checked = currentDisplay.rounded ?? true;
    const roundedSlider = document.createElement('span');
    roundedSlider.className = 'da-slider';
    roundedToggleLabel.appendChild(roundedInput);
    roundedToggleLabel.appendChild(roundedSlider);

    roundedInput.addEventListener('change', (): void => {
        patchSettings({ imageDisplay: { ...getLatestDisplay(), rounded: roundedInput.checked } });
        notifyChange();
    });

    cardDisplay.appendChild(createFieldRow({
        label: '启用现代圆角边框',
        control: roundedToggleLabel,
    }));

    // ── 4. 数据持久化与缓存清理卡片 ──────────────────────────────────────────
    const cardStorage = document.createElement('div');
    cardStorage.className = 'da-section-card';

    const headerStorage = document.createElement('div');
    headerStorage.className = 'da-section-header';
    headerStorage.innerHTML = `
        <span class="da-section-title">数据持久化与缓存清理</span>
        <span class="da-section-desc">配置酒馆聊天记录数据持久化策略与一键物理清空缓存数据库</span>
    `;
    cardStorage.appendChild(headerStorage);

    // 4.1 写入酒馆聊天记录
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
        patchSettings({ persistToChat: persistInput.checked });
        notifyChange();
    });

    cardStorage.appendChild(createFieldRow({
        label: '写入酒馆聊天记录',
        helpTooltip: '开启后生成的图片会自动关联写回对应 AI 消息楼层。物理图像与 WebP 缩略图全量在 IndexedDB 中独立存储，规避 chat.json 体积膨胀。',
        control: persistToggleLabel,
    }));

    // 4.2 缓存与存储数据库重置
    const clearStorageBtn = document.createElement('button');
    clearStorageBtn.className = 'da-btn danger';
    clearStorageBtn.textContent = '物理重置图库数据库';

    clearStorageBtn.addEventListener('click', async (): Promise<void> => {
        const ok = await FeedbackService.confirm(
            '物理重置图库确认',
            '确认重置并物理清空本地 IndexedDB 中的所有历史图片缓存与原图数据吗？此操作不可撤销！',
            '确定重置',
            true
        );
        if (ok) {
            try {
                const { galleryResetAllStorage } = await import('../../storage/image-db');
                await galleryResetAllStorage();
                notifyChange();
                FeedbackService.toastSuccess('已成功清空本地图库 IndexedDB 中的所有历史图片数据。', '数据重置成功');
            } catch (err) {
                logger.error('物理清空图库数据库失败', err);
                FeedbackService.toastError(`清空失败: ${err instanceof Error ? err.message : String(err)}`, '数据重置失败');
            }
        }
    });

    cardStorage.appendChild(createFieldRow({
        label: '物理重置图库数据库',
        control: clearStorageBtn,
    }));

    container.appendChild(cardMode);
    container.appendChild(cardDisplay);
    container.appendChild(cardFloor);
    container.appendChild(cardStorage);
    container.appendChild(cardExt);

    return container;
}
