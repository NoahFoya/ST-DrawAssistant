/**
 * @module src/ui/views/general-tab
 * @description 基础与通用设置面板 (GeneralTab)
 *
 * 遵循规范 (UI_LAYOUT_PREVIEW.md 第六节第 1 条)：
 * 1. Card: 基础设置 (启用插件, 气泡帮助提示, 默认生图引擎, 请求超时时间, 最大并发任务数)；
 * 2. Card: 交互设置 (生图提取起始/结束标记, AI回复后自动生图, 成功后隐藏按钮, 快捷操作栏, 点击看全图)；
 * 3. Card: 图片显示 (图片对齐方式, 图片填充模式, 最大显示宽度, 最大显示高度, 开启图片圆角, 默认折叠图片)；
 * 4. Card: 存储设置 (保存至画廊, 内嵌至聊天记录, 历史图片保留上限)；
 * 5. Card: 扩展功能 (动态呈现已加载生态扩展开关)。
 */

import { createElement } from '../../util/dom';
import { createFormField, createCard } from '../components/form-field';
import { createToggle } from '../components/toggle';
import { createSelect } from '../components/select';
import { createNumberInput, createTextInput } from '../components/input';
import { getIconSvg } from '../components/icons';
import type { SettingsStore } from '../../store/settings';
import type { EngineType } from '@types';

export interface GeneralTabHandle {
    readonly element: HTMLElement;
    dispose(): void;
}

export function renderGeneralTab(settingsStore: SettingsStore): GeneralTabHandle {
    const root = createElement('div', { className: 'da-tab-pane' });
    const disposers: (() => void)[] = [];

    const regDisposer = (item: { dispose(): void }) => {
        disposers.push(() => item.dispose());
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
    const enableField = createFormField({
        label: '启用插件',
        helpText: 'ST-DrawAssistant 绘画助手插件全局总开关',
        control: enableToggle
    });
    basicCard.append(enableField);

    // 显示气泡帮助提示
    const helpToggle = createToggle({
        value: settingsStore.get('showHelp') ?? true,
        onChange: (val) => settingsStore.set('showHelp', val)
    });
    const helpField = createFormField({
        label: '显示气泡帮助提示',
        helpText: '在表单标题右侧展示小问号，悬停时展开详细释义气泡',
        control: helpToggle
    });
    basicCard.append(helpField);

    // 默认生图引擎
    const activeEngineSelect = createSelect({
        value: settingsStore.get('activeEngine') || 'comfyui',
        options: [
            { label: 'ComfyUI (工作流蓝图)', value: 'comfyui' },
            { label: 'SD-WebUI / Forge', value: 'sdwebui' },
            { label: 'NovelAI (官方直连)', value: 'novelai' },
            { label: 'OpenAI 兼容 (多模态)', value: 'openai' }
        ],
        onChange: (val) => settingsStore.set('activeEngine', val as EngineType)
    });
    const activeEngineField = createFormField({
        label: '默认生图引擎',
        helpText: '聊天楼层中快速生图默认派发的主生图后端驱动',
        control: activeEngineSelect
    });
    basicCard.append(activeEngineField);

    // 请求传输模式 (直连 / 宿主中继 / 自动协商)
    const requestModeSelect = createSelect({
        value: settingsStore.get('requestMode') || 'direct',
        options: [
            { label: '浏览器直连 (Direct · 推荐)', value: 'direct' },
            { label: '宿主代理中继 (Relay · 规避跨域)', value: 'relay' },
            { label: '智能自动协商 (Auto · 动态决策)', value: 'auto' }
        ],
        onChange: (val) => settingsStore.set('requestMode', val as any)
    });
    const requestModeField = createFormField({
        label: '请求传输模式',
        helpText: '控制与生图引擎的通信链路方式。直连 (Direct) 速度最快且支持实时流式进度；中继 (Relay) 由酒馆服务端代理转发，可规避浏览器跨域限制与 Mixed Content 阻断；自动 (Auto) 根据协议环境动态智能判定。',
        control: requestModeSelect
    });
    basicCard.append(requestModeField);

    // 请求超时时间
    const timeoutInput = createNumberInput({
        value: Math.round((settingsStore.get('taskTimeoutMs') || 180000) / 1000),
        min: 10,
        max: 1800,
        step: 10,
        unit: '秒',
        onChange: (val) => settingsStore.set('taskTimeoutMs', val * 1000)
    });
    const timeoutField = createFormField({
        label: '请求超时时间',
        helpText: '单个生图任务最长允许耗时，超过后自动中断取消并释放队列',
        control: timeoutInput
    });
    basicCard.append(timeoutField);

    // 最大并发任务数
    const concurrentInput = createNumberInput({
        value: settingsStore.get('maxConcurrentTasks') || 1,
        min: 1,
        max: 10,
        step: 1,
        unit: '个',
        onChange: (val) => settingsStore.set('maxConcurrentTasks', val)
    });
    const concurrentField = createFormField({
        label: '最大并发任务数',
        helpText: '同时允许排队执行的生图最大数量，建议保持为 1 防止本地显卡显存溢出',
        control: concurrentInput
    });
    basicCard.append(concurrentField);

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
        value: 'image###',
        placeholder: 'image###',
        variant: 'short'
    });
    const startTagField = createFormField({
        label: '生图提取起始标记',
        helpText: '在 AI 回复正文中识别生图指令的前导标记',
        control: startTagInput
    });
    interactCard.append(startTagField);

    // 生图提取结束标记
    const endTagInput = createTextInput({
        value: '###',
        placeholder: '###',
        variant: 'short'
    });
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
    const autoGenField = createFormField({
        label: 'AI 回复后自动生图',
        helpText: '当角色回复完毕且检测到包含生图标签时，无需手动点击自动触发排队生成',
        control: autoGenToggle
    });
    interactCard.append(autoGenField);

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
            { label: '完整显示 (不裁切)', value: 'contain' },
            { label: '等比填充 (cover)', value: 'cover' },
            { label: '原始尺寸 (none)', value: 'none' }
        ],
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const imgDisp = ui.imageDisplay || {};
            settingsStore.update({
                ui: { ...ui, imageDisplay: { ...imgDisp, objectFit: val } }
            });
        }
    });
    const fitField = createFormField({
        label: '图片填充模式',
        helpText: '图片在视窗容器内部的自适应拉伸与裁切方式',
        control: fitSelect
    });
    displayCard.append(fitField);

    // 最大显示宽度
    const maxWidthInput = createNumberInput({
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
    const maxWidthField = createFormField({
        label: '最大显示宽度',
        helpText: '图片占聊天气泡宽度的最大百分比限制',
        control: maxWidthInput
    });
    displayCard.append(maxWidthField);

    // 最大显示高度
    const maxHeightInput = createNumberInput({
        value: currentUi.imageDisplay?.maxHeight || 0,
        min: 0,
        max: 4000,
        step: 50,
        unit: 'px',
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const imgDisp = ui.imageDisplay || {};
            settingsStore.update({
                ui: { ...ui, imageDisplay: { ...imgDisp, maxHeight: val } }
            });
        }
    });
    const maxHeightField = createFormField({
        label: '最大显示高度',
        helpText: '限制图片在楼层的最大纵向高度，填 0 表示不限制高度',
        control: maxHeightInput
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
    const roundedField = createFormField({
        label: '开启图片圆角',
        helpText: '为楼层中生成的图片赋予精致的主题圆角与阴影修饰',
        control: roundedToggle
    });
    displayCard.append(roundedField);

    // 默认折叠图片
    const collapsedToggle = createToggle({
        value: currentUi.imageDisplay?.collapsed ?? false,
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const imgDisp = ui.imageDisplay || {};
            settingsStore.update({
                ui: { ...ui, imageDisplay: { ...imgDisp, collapsed: val } }
            });
        }
    });
    const collapsedField = createFormField({
        label: '默认折叠图片',
        helpText: '生成完成后默认以折叠胶囊呈现，点击后才展开展示图片，节省聊天篇幅',
        control: collapsedToggle
    });
    displayCard.append(collapsedField);

    root.appendChild(displayCard.element);

    // 4. 存储设置卡片
    const storageCard = createCard({
        title: '存储设置',
        iconSvg: getIconSvg('download'),
        collapsible: true
    });
    regDisposer(storageCard);

    // 保存至画廊
    const idbToggle = createToggle({
        value: settingsStore.get('saveToIndexedDB') ?? true,
        onChange: (val) => settingsStore.set('saveToIndexedDB', val)
    });
    const idbField = createFormField({
        label: '保存至画廊',
        helpText: '将生成的原图与元数据存入浏览器本地持久化 IndexedDB 数据库中',
        control: idbToggle
    });
    storageCard.append(idbField);

    // 内嵌至聊天记录
    const serverToggle = createToggle({
        value: settingsStore.get('saveToServer') ?? false,
        onChange: (val) => settingsStore.set('saveToServer', val)
    });
    const serverField = createFormField({
        label: '内嵌至聊天记录',
        helpText: '将图片转换为 Base64 或上传至宿主服务端静态路径，便于聊天记录跨设备导出分享',
        control: serverToggle
    });
    storageCard.append(serverField);

    // 历史图片保留上限
    const maxStoredSelect = createSelect({
        value: String(settingsStore.get('maxStoredImages') || 500),
        options: [
            { label: '100 张', value: '100' },
            { label: '300 张', value: '300' },
            { label: '500 张 (推荐)', value: '500' },
            { label: '1000 张', value: '1000' },
            { label: '2000 张 (注意配额)', value: '2000' }
        ],
        onChange: (val) => settingsStore.set('maxStoredImages', Number(val))
    });
    const maxStoredField = createFormField({
        label: '历史图片保留上限',
        helpText: '本地 IndexedDB 允许保留的最大生图记录数，超过后自动清理未标星的无引用老旧图片',
        control: maxStoredSelect
    });
    storageCard.append(maxStoredField);

    root.appendChild(storageCard.element);

    // 5. 扩展功能卡片
    const extCard = createCard({
        title: '扩展功能',
        iconSvg: getIconSvg('star'),
        collapsible: true
    });
    regDisposer(extCard);

    // 提示词自动清洗扩展
    const cleanPromptToggle = createToggle({
        value: true,
        onChange: () => {}
    });
    const cleanPromptField = createFormField({
        label: '提示词自动安全清洗与排重',
        helpText: '自动滤除提示词中的换行冗余符与非法标记，并执行逗号标准化清洗',
        control: cleanPromptToggle
    });
    extCard.append(cleanPromptField);

    root.appendChild(extCard.element);

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
