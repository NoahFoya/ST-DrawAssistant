/**
 * 基础与通用设置面板 (GeneralTab)
 *
 * 功能：
 * 1. 基础设置：插件总开关、生图引擎切换、请求传输模式、超时与并发数；
 * 2. 交互设置：占位符标记提取、AI 回复自动生图、提示词清洗排重与点击看大图；
 * 3. 图片显示：对齐方式、填充模式、尺寸限制、圆角与默认折叠；
 * 4. 存储设置：宿主存储保存、聊天记录内嵌与历史图片上限；
 * 5. 扩展功能：动态呈现已注册扩展插件并提供独立启用开关。
 *
 * Tips：
 * 1. 变更项即时同步写入 SettingsStore；
 * 2. 扩展卡片在无注册扩展时完全隐去，保持界面整洁。
 */

import { createElement } from '../../util/dom';
import { createFormField, createCard } from '../components/form-field';
import { createToggle } from '../components/toggle';
import { createSelect } from '../components/select';
import { createSlider } from '../components/slider';
import { createTextInput } from '../components/input';
import { getIconSvg } from '../components/icons';
import { ExtensionRegistry } from '../../extension';
import type { SettingsStore } from '../../store/settings';
import type { EngineType, TransportMode } from '@types';

export interface GeneralTabHandle {
    readonly element: HTMLElement;
    dispose(): void;
}

export function renderGeneralTab(settingsStore: SettingsStore): GeneralTabHandle {
    const root = createElement('div', { className: 'da-tab-pane' });
    const disposers: (() => void)[] = [];

    const regDisposer = (item: { dispose?(): void } | undefined | null) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    // 1. 基础设置卡片
    const basicCard = createCard({
        title: '基础设置',
        iconSvg: getIconSvg('settings'),
        collapsible: true
    });
    regDisposer(basicCard);

    // 启用插件
    const enableToggle = createToggle({
        value: settingsStore.get('enabled') ?? true,
        onChange: (val) => settingsStore.set('enabled', val)
    });
    regDisposer(enableToggle);
    const enableField = createFormField({
        label: '启用插件',
        helpText: '启用或停用绘画助手插件功能',
        control: enableToggle
    });
    basicCard.append(enableField);

    // 显示气泡帮助提示
    const helpToggle = createToggle({
        value: settingsStore.get('showHelp') ?? true,
        onChange: (val) => settingsStore.set('showHelp', val)
    });
    regDisposer(helpToggle);
    const helpField = createFormField({
        label: '显示气泡帮助提示',
        helpText: '在表单标题右侧展示问号图标，悬停时展开详细释义气泡',
        control: helpToggle
    });
    basicCard.append(helpField);

    // 默认生图引擎
    const activeEngineSelect = createSelect({
        value: settingsStore.get('activeEngine') || 'comfyui',
        options: [
            { label: 'ComfyUI', value: 'comfyui' },
            { label: 'SD-WebUI / Forge', value: 'sdwebui' },
            { label: 'NovelAI', value: 'novelai' },
            { label: 'OpenAI 兼容', value: 'openai' }
        ],
        onChange: (val) => settingsStore.set('activeEngine', val as EngineType)
    });
    regDisposer(activeEngineSelect);
    const activeEngineField = createFormField({
        label: '默认生图引擎',
        helpText: '聊天楼层中快速生图默认派发的主生图后端驱动',
        control: activeEngineSelect
    });
    basicCard.append(activeEngineField);

    // 请求传输模式 (浏览器直连 / 酒馆代理 / 自动)
    const requestModeSelect = createSelect({
        value: settingsStore.get('requestMode') || 'direct',
        options: [
            { label: '浏览器直连', value: 'direct' },
            { label: '酒馆代理', value: 'relay' },
            { label: '自动', value: 'auto' }
        ],
        onChange: (val) => settingsStore.set('requestMode', val as TransportMode)
    });
    regDisposer(requestModeSelect);
    const requestModeField = createFormField({
        label: '请求传输模式',
        helpText: '控制与生图引擎的网络传输模式。直连速度快且支持实时流式进度；酒馆代理转发可规避跨域与 Mixed Content 阻断；自动模式根据协议环境动态智能判定。',
        control: requestModeSelect
    });
    basicCard.append(requestModeField);


    root.appendChild(basicCard.element);

    // 2. 交互设置卡片
    const interactCard = createCard({
        title: '交互设置',
        iconSvg: getIconSvg('sparkles'),
        collapsible: true
    });
    regDisposer(interactCard);

    // 生图提取起始标记
    const startTagInput = createTextInput({
        value: settingsStore.get('placeholderStart') || 'image###',
        placeholder: 'image###',
        variant: 'short',
        onChange: (val) => settingsStore.set('placeholderStart', val.trim() || 'image###')
    });
    regDisposer(startTagInput);
    const startTagField = createFormField({
        label: '生图提取起始标记',
        helpText: '在 AI 回复正文中识别生图指令的前导标记',
        control: startTagInput
    });
    interactCard.append(startTagField);

    // 生图提取结束标记
    const endTagInput = createTextInput({
        value: settingsStore.get('placeholderEnd') || '###',
        placeholder: '###',
        variant: 'short',
        onChange: (val) => settingsStore.set('placeholderEnd', val.trim() || '###')
    });
    regDisposer(endTagInput);
    const endTagField = createFormField({
        label: '生图提取结束标记',
        helpText: '在 AI 回复正文中识别生图指令的结束闭合标记',
        control: endTagInput
    });
    interactCard.append(endTagField);

    // AI 回复后自动生图
    const autoGenToggle = createToggle({
        value: settingsStore.get('autoGenerate') ?? false,
        onChange: (val) => settingsStore.set('autoGenerate', val)
    });
    regDisposer(autoGenToggle);
    const autoGenField = createFormField({
        label: 'AI 回复后自动生图',
        helpText: '当角色回复完毕且检测到包含生图标签时，无需手动点击自动触发排队生成',
        control: autoGenToggle
    });
    interactCard.append(autoGenField);

    // 提示词清洗与排重 (回归交互设置)
    const cleanPromptToggle = createToggle({
        value: settingsStore.get('cleanPrompt') ?? true,
        onChange: (val) => settingsStore.set('cleanPrompt', val)
    });
    regDisposer(cleanPromptToggle);
    const cleanPromptField = createFormField({
        label: '提示词清洗与排重',
        helpText: '自动滤除提示词中的换行与冗余标记，并执行逗号标准化清洗',
        control: cleanPromptToggle
    });
    interactCard.append(cleanPromptField);

    // 出图成功后隐藏生成按钮
    const currentUi = settingsStore.get('ui') || {};
    const hideBtnToggle = createToggle({
        value: currentUi.actionPanel?.hideButtonOnDone ?? false,
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            settingsStore.update({
                ui: {
                    ...ui,
                    actionPanel: {
                        enabled: ui.actionPanel?.enabled ?? true,
                        hideButtonOnDone: val
                    }
                }
            });
        }
    });
    regDisposer(hideBtnToggle);
    const hideBtnField = createFormField({
        label: '出图成功后隐藏生成按钮',
        helpText: '当前消息楼层生图成功并展示后，自动收起该楼层的生图触发按钮',
        control: hideBtnToggle
    });
    interactCard.append(hideBtnField);

    // 启用图片快捷操作栏
    const actionPanelToggle = createToggle({
        value: currentUi.actionPanel?.enabled ?? true,
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            settingsStore.update({
                ui: {
                    ...ui,
                    actionPanel: {
                        hideButtonOnDone: ui.actionPanel?.hideButtonOnDone ?? false,
                        enabled: val
                    }
                }
            });
        }
    });
    regDisposer(actionPanelToggle);
    const actionPanelField = createFormField({
        label: '启用图片快捷操作栏',
        helpText: '在聊天楼层生成的图片正下方挂载重新生成、复制提示词、保存等快捷操作条',
        control: actionPanelToggle
    });
    interactCard.append(actionPanelField);

    // 点击图片查看全图
    const lightboxToggle = createToggle({
        value: currentUi.lightbox?.enabled ?? true,
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            settingsStore.update({
                ui: {
                    ...ui,
                    lightbox: { enabled: val }
                }
            });
        }
    });
    regDisposer(lightboxToggle);
    const lightboxField = createFormField({
        label: '点击图片查看全图',
        helpText: '点击楼层或画廊中的图片时，打开全屏深色毛玻璃灯箱高保真浏览',
        control: lightboxToggle
    });
    interactCard.append(lightboxField);

    root.appendChild(interactCard.element);

    // 3. 图片显示卡片
    const displayCard = createCard({
        title: '图片显示',
        iconSvg: getIconSvg('image'),
        collapsible: true
    });
    regDisposer(displayCard);

    // 图片对齐方式
    const alignSelect = createSelect({
        value: currentUi.imageDisplay?.align || 'center',
        options: [
            { label: '居中对齐', value: 'center' },
            { label: '靠左对齐', value: 'flex-start' },
            { label: '靠右对齐', value: 'flex-end' }
        ],
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const imgDisp = ui.imageDisplay || {};
            settingsStore.update({
                ui: { ...ui, imageDisplay: { ...imgDisp, align: val } }
            });
        }
    });
    regDisposer(alignSelect);
    const alignField = createFormField({
        label: '图片对齐方式',
        helpText: '图片在酒馆聊天楼层中的横向对齐位置',
        control: alignSelect
    });
    displayCard.append(alignField);

    // 图片填充模式
    const fitSelect = createSelect({
        value: currentUi.imageDisplay?.objectFit || 'contain',
        options: [
            { label: '完整自适应', value: 'contain' },
            { label: '裁剪填充', value: 'cover' },
            { label: '原始尺寸', value: 'none' }
        ],
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const imgDisp = ui.imageDisplay || {};
            settingsStore.update({
                ui: { ...ui, imageDisplay: { ...imgDisp, objectFit: val } }
            });
        }
    });
    regDisposer(fitSelect);
    const fitField = createFormField({
        label: '图片填充模式',
        helpText: '图片在视窗容器内部的自适应拉伸与裁切方式',
        control: fitSelect
    });
    displayCard.append(fitField);

    // 最大显示宽度 (升级为复合滑块)
    const maxWidthSlider = createSlider({
        value: currentUi.imageDisplay?.maxWidthPct || 100,
        min: 10,
        max: 100,
        step: 5,
        unit: '%',
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const imgDisp = ui.imageDisplay || {};
            settingsStore.update({
                ui: { ...ui, imageDisplay: { ...imgDisp, maxWidthPct: val } }
            });
        }
    });
    regDisposer(maxWidthSlider);
    const maxWidthField = createFormField({
        label: '最大显示宽度',
        helpText: '图片占聊天气泡宽度的最大百分比限制',
        control: maxWidthSlider
    });
    displayCard.append(maxWidthField);

    // 最大显示高度 (升级为复合滑块，默认 480px)
    const maxHeightSlider = createSlider({
        value: currentUi.imageDisplay?.maxHeight ?? 480,
        min: 100,
        max: 2000,
        step: 20,
        unit: 'px',
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const imgDisp = ui.imageDisplay || {};
            settingsStore.update({
                ui: { ...ui, imageDisplay: { ...imgDisp, maxHeight: val } }
            });
        }
    });
    regDisposer(maxHeightSlider);
    const maxHeightField = createFormField({
        label: '最大显示高度',
        helpText: '限制聊天楼层中生成图片的最大显示高度，避免长图占据过多会话空间',
        control: maxHeightSlider
    });
    displayCard.append(maxHeightField);

    // 开启图片圆角
    const roundedToggle = createToggle({
        value: currentUi.imageDisplay?.rounded ?? true,
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const imgDisp = ui.imageDisplay || {};
            settingsStore.update({
                ui: { ...ui, imageDisplay: { ...imgDisp, rounded: val } }
            });
        }
    });
    regDisposer(roundedToggle);
    const roundedField = createFormField({
        label: '开启图片圆角',
        helpText: '为楼层中生成的图片赋予精致的主题圆角与阴影修饰',
        control: roundedToggle
    });
    displayCard.append(roundedField);

    // 自动遮罩图片
    const autoBlurToggle = createToggle({
        value: currentUi.imageDisplay?.autoBlur ?? currentUi.imageDisplay?.collapsed ?? false,
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const imgDisp = ui.imageDisplay || {};
            settingsStore.update({
                ui: { ...ui, imageDisplay: { ...imgDisp, autoBlur: val, collapsed: val } }
            });
        }
    });
    regDisposer(autoBlurToggle);
    const autoBlurField = createFormField({
        label: '自动遮罩图片',
        helpText: '生成完成后对图片进行高斯模糊遮罩处理，鼠标悬停时自动清晰显现，防止旁人窥视敏感画面',
        control: autoBlurToggle
    });
    displayCard.append(autoBlurField);

    root.appendChild(displayCard.element);

    // 4. 存储设置卡片 (本地 IndexedDB 基础存储始终保留，提供两个叠加存储选项)
    const storageCard = createCard({
        title: '存储设置',
        iconSvg: getIconSvg('download'),
        collapsible: true
    });
    regDisposer(storageCard);

    // 保存至酒馆服务器 (叠加选项 1)
    const serverToggle = createToggle({
        value: settingsStore.get('saveToServer') ?? false,
        onChange: (val) => settingsStore.set('saveToServer', val)
    });
    regDisposer(serverToggle);
    const serverField = createFormField({
        label: '保存至酒馆服务器',
        helpText: '将生成的图片同步上传并保存至酒馆服务端静态目录，便于在多设备或终端间共享访问（本地画廊默认始终保留）',
        control: serverToggle
    });
    storageCard.append(serverField);

    // 内嵌至聊天记录 (叠加选项 2)
    const embedToggle = createToggle({
        value: settingsStore.get('embedToBase64') ?? false,
        onChange: (val) => settingsStore.set('embedToBase64', val)
    });
    regDisposer(embedToggle);
    const embedField = createFormField({
        label: '内嵌至聊天记录',
        helpText: '将图片以 Base64 编码直接嵌入聊天记录文件，便于导出分享会话；图片较多时会导致聊天记录文件体积增大（本地画廊默认始终保留）',
        control: embedToggle
    });
    storageCard.append(embedField);

    // 历史图片保留上限
    const maxStoredSelect = createSelect({
        value: String(settingsStore.get('maxStoredImages') ?? 500),
        options: [
            { label: '100 张', value: '100' },
            { label: '300 张', value: '300' },
            { label: '500 张', value: '500' },
            { label: '1000 张', value: '1000' },
            { label: '2000 张', value: '2000' },
            { label: '不限制', value: '0' }
        ],
        onChange: (val) => settingsStore.set('maxStoredImages', Number(val))
    });
    regDisposer(maxStoredSelect);
    const maxStoredField = createFormField({
        label: '历史图片保留上限',
        helpText: '画廊最多保存的图片数量。超出上限后自动清理较早且未收藏的图片；已收藏的图片不会被清理',
        control: maxStoredSelect
    });
    storageCard.append(maxStoredField);

    // 生成缩略图缓存
    const thumbToggle = createToggle({
        value: settingsStore.get('enableThumbnail') ?? true,
        onChange: (val) => settingsStore.set('enableThumbnail', val)
    });
    regDisposer(thumbToggle);
    const thumbField = createFormField({
        label: '生成缩略图缓存',
        helpText: '在本地数据库为已生成图像创建轻量缩略图，大幅加速画廊多图列表与历史加载性能',
        control: thumbToggle
    });
    storageCard.append(thumbField);

    // 内容哈希去重存储
    const dedupToggle = createToggle({
        value: settingsStore.get('deduplicateHash') ?? true,
        onChange: (val) => settingsStore.set('deduplicateHash', val)
    });
    regDisposer(dedupToggle);
    const dedupField = createFormField({
        label: '内容哈希去重存储',
        helpText: '对生成图片内容计算哈希指纹，相同图片在本地持久化时不重复占据存储配额',
        control: dedupToggle
    });
    storageCard.append(dedupField);

    root.appendChild(storageCard.element);

    // 5. 扩展功能卡片 (仅当存在已注册扩展时动态呈现)
    const registry = ExtensionRegistry.getInstance();
    const registeredExts = registry.getAll();
    if (registeredExts.length > 0) {
        const extCard = createCard({
            title: '扩展功能',
            iconSvg: getIconSvg('star'),
            collapsible: true
        });
        regDisposer(extCard);

        for (const ext of registeredExts) {
            const isEnabled = registry.isEnabled(ext.id);
            const extToggle = createToggle({
                value: isEnabled,
                onChange: (val) => {
                    registry.setEnabled(ext.id, val);
                }
            });
            regDisposer(extToggle);

            const extField = createFormField({
                label: ext.name,
                helpText: ext.description,
                control: extToggle
            });
            extCard.append(extField);
        }

        root.appendChild(extCard.element);
    }

    return {
        element: root,
        dispose(): void {
            for (const fn of disposers) {
                try {
                    fn();
                } catch {
                    // 异常隔离
                }
            }
            root.remove();
        }
    };
}
