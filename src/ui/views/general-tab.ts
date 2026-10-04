/**
 * 常规设置选项卡视图 (GeneralTabView)。
 *
 * @remarks
 * 基于原子控件库装配 4 大基础卡片：
 * 1. 基础设置：启用插件、默认绘图引擎、网络连接方式、任务超时时间、显示帮助说明；
 * 2. 生图与交互：生图指令开头/结尾、AI 回复后自动生图、完成隐藏按钮、图片操作栏、全屏灯箱、提示词去重；
 * 3. 图片显示：对齐方式、显示模式、最大宽度、最大高度、图片圆角、防窥模糊；
 * 4. 存储与备份：本地存储上限、生成缩略图、备份至酒馆服务器、图片保存格式与压缩质量。
 */

import type { SettingsView, Disposable } from '../types';
import { Card } from '../components/card';
import { FormField } from '../components/form-field';
import { Switch } from '../components/switch';
import { Select } from '../components/select';
import { TextInput } from '../components/text-input';
import { NumberInput } from '../components/number-input';
import { Slider } from '../components/slider';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { logger } from '../../util/logger';
import type { ProviderType, TransportMode } from '@types';

export class GeneralTabView implements SettingsView {
    public readonly id = 'general';
    public readonly title = '常规设置';
    public readonly element: HTMLElement;

    // 内部持有的子组件与资源列表
    private readonly disposables: Disposable[] = [];

    // 1. 基础设置卡片控件
    private enabledSwitch!: Switch;
    private activeProviderSelect!: Select;
    private transportSelect!: Select;
    private timeoutInput!: NumberInput;
    private showHelpSwitch!: Switch;

    // 2. 生图与交互卡片控件
    private startTagInput!: TextInput;
    private endTagInput!: TextInput;
    private autoGenSwitch!: Switch;
    private hideBtnSwitch!: Switch;
    private actionPanelSwitch!: Switch;
    private lightboxSwitch!: Switch;
    private cleanPromptSwitch!: Switch;

    // 3. 图片显示卡片控件
    private alignSelect!: Select;
    private fitSelect!: Select;
    private maxWidthSlider!: Slider;
    private maxHeightSlider!: Slider;
    private roundedSwitch!: Switch;
    private autoBlurSwitch!: Switch;

    // 4. 存储与备份卡片控件
    private maxStoredSelect!: Select;
    private thumbSwitch!: Switch;
    private serverSwitch!: Switch;

    // 活跃时配置变更解绑函数
    private unlistenSettings: (() => void) | null = null;

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'da-tab-pane';

        // 组装四大卡片
        const basicCard = this.buildBasicCard();
        const interactCard = this.buildInteractCard();
        const displayCard = this.buildDisplayCard();
        const storageCard = this.buildStorageCard();

        this.element.appendChild(basicCard.element);
        this.element.appendChild(interactCard.element);
        this.element.appendChild(displayCard.element);
        this.element.appendChild(storageCard.element);

        this.disposables.push(basicCard, interactCard, displayCard, storageCard);
    }

    /**
     * 激活选项卡时拉取配置填充表单并监听外部变更。
     */
    public activate(): void {
        this.syncFormWithSettings();

        // 订阅配置变更，支持多视图联动与预设恢复响应
        if (!this.unlistenSettings) {
            this.unlistenSettings = eventBus.on('settings:updated', () => {
                this.syncFormWithSettings();
            });
        }
    }

    /**
     * 离开选项卡时解除事件监听。
     */
    public deactivate(): void {
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
    }

    /**
     * 从配置快照静默校准全部控件显示值。
     */
    private syncFormWithSettings(): void {
        const s = settingsStore.getSettings();
        const ui = s.ui ?? ({} as typeof s.ui);
        const actionPanel = ui.actionPanel ?? { enabled: true, hideButtonOnDone: false };
        const lightbox = ui.lightbox ?? { enabled: true };
        const img = ui.imageDisplay ?? {
            align: 'center',
            objectFit: 'contain',
            maxHeight: 480,
            maxWidthPct: 100,
            rounded: true,
            autoBlur: false,
            collapsed: false,
        };

        // 1. 基础设置
        this.enabledSwitch.setValue(s.enabled ?? true, { silent: true });
        this.activeProviderSelect.setValue(s.activeProvider || 'comfyui', { silent: true });
        this.transportSelect.setValue(s.transport || 'direct', { silent: true });
        this.timeoutInput.setValue(Math.round((s.taskTimeoutMs || 120000) / 1000), { silent: true });
        this.showHelpSwitch.setValue(s.showHelp ?? true, { silent: true });

        // 2. 生图与交互
        this.startTagInput.setValue(s.placeholderStart || 'image###', { silent: true });
        this.endTagInput.setValue(s.placeholderEnd || '###', { silent: true });
        this.autoGenSwitch.setValue(s.autoGenerate ?? false, { silent: true });
        this.hideBtnSwitch.setValue(actionPanel.hideButtonOnDone ?? false, { silent: true });
        this.actionPanelSwitch.setValue(actionPanel.enabled ?? true, { silent: true });
        this.lightboxSwitch.setValue(lightbox.enabled ?? true, { silent: true });
        this.cleanPromptSwitch.setValue(s.cleanPrompt ?? true, { silent: true });

        // 3. 图片显示
        this.alignSelect.setValue(img.align || 'center', { silent: true });
        this.fitSelect.setValue(img.objectFit || 'contain', { silent: true });
        this.maxWidthSlider.setValue(img.maxWidthPct ?? 100, { silent: true });
        this.maxHeightSlider.setValue(img.maxHeight ?? 480, { silent: true });
        this.roundedSwitch.setValue(img.rounded ?? true, { silent: true });
        this.autoBlurSwitch.setValue(Boolean(img.autoBlur ?? img.collapsed), { silent: true });

        // 4. 存储与备份
        this.maxStoredSelect.setValue(String(s.maxStoredImages ?? 500), { silent: true });
        this.thumbSwitch.setValue(s.enableThumbnail ?? true, { silent: true });
        this.serverSwitch.setValue(s.saveToServer ?? false, { silent: true });
    }

    /**
     * 释放所有卡片、表单行与控件资源。
     */
    public dispose(): void {
        this.deactivate();
        for (const item of this.disposables) {
            try {
                item.dispose();
            } catch (err) {
                logger.warn('释放常规设置选项卡控件异常:', err);
            }
        }
        this.disposables.length = 0;
        this.element.remove();
    }

    // 1. 基础设置卡片装配
    private buildBasicCard(): Card {
        const card = new Card({
            title: '基础设置',
            subtitle: '插件核心运行开关、默认生效引擎与网络连接模式',
            collapsible: true,
        });

        const s = settingsStore.getSettings();

        // 启用插件
        this.enabledSwitch = new Switch({
            value: s.enabled ?? true,
            onChange: (val) => {
                settingsStore.set('enabled', val);
            },
        });
        const enabledField = new FormField({
            label: '启用插件',
            tooltip: '开启或关闭绘画助手扩展功能',
            control: this.enabledSwitch,
            width: 'w-toggle',
        });

        // 默认绘图引擎
        this.activeProviderSelect = new Select({
            value: s.activeProvider || 'comfyui',
            options: [
                { label: 'ComfyUI', value: 'comfyui' },
                { label: 'SD-WebUI / Forge', value: 'sdwebui' },
                { label: 'NovelAI', value: 'novelai' },
                { label: 'OpenAI 兼容', value: 'openai' },
            ],
            onChange: (val) => {
                settingsStore.set('activeProvider', val as ProviderType);
            },
        });
        const providerField = new FormField({
            label: '默认绘图引擎',
            tooltip: '聊天楼层快速生图默认派发调用的主生图后端',
            control: this.activeProviderSelect,
            width: 'w-240',
        });

        // 网络连接方式
        this.transportSelect = new Select({
            value: s.transport || 'direct',
            options: [
                { label: '浏览器直连', value: 'direct' },
                { label: '酒馆代理', value: 'relay' },
            ],
            onChange: (val) => {
                settingsStore.set('transport', val as TransportMode);
            },
        });
        const transportField = new FormField({
            label: '网络连接方式',
            tooltip: '直连由浏览器直接请求绘图服务，具备更低延迟并支持流式进度推送；酒馆代理通过服务端中继转发，可解决跨域与 HTTPS 混合内容限制。若请求异常将直接显式抛出错误提示，不执行隐性降级',
            control: this.transportSelect,
            width: 'w-240',
        });

        // 任务超时时间
        this.timeoutInput = new NumberInput({
            value: Math.round((s.taskTimeoutMs || 120000) / 1000),
            min: 30,
            max: 600,
            step: 10,
            unit: '秒',
            onChange: (val) => {
                settingsStore.set('taskTimeoutMs', Math.max(30, val) * 1000);
            },
        });
        const timeoutField = new FormField({
            label: '任务超时时间',
            tooltip: '单次生图请求的最大等待秒数，超时后自动终止任务并释放资源',
            control: this.timeoutInput,
            width: 'w-120',
        });

        // 显示帮助说明
        this.showHelpSwitch = new Switch({
            value: s.showHelp ?? true,
            onChange: (val) => {
                settingsStore.set('showHelp', val);
            },
        });
        const showHelpField = new FormField({
            label: '显示帮助说明',
            tooltip: '在表单标题右侧展示问号图标，鼠标悬停时提示功能用法说明',
            control: this.showHelpSwitch,
            width: 'w-toggle',
        });

        card.appendContent([
            enabledField.element,
            providerField.element,
            transportField.element,
            timeoutField.element,
            showHelpField.element,
        ]);

        this.disposables.push(
            this.enabledSwitch,
            enabledField,
            this.activeProviderSelect,
            providerField,
            this.transportSelect,
            transportField,
            this.timeoutInput,
            timeoutField,
            this.showHelpSwitch,
            showHelpField
        );

        return card;
    }

    // 2. 生图与交互卡片装配
    private buildInteractCard(): Card {
        const card = new Card({
            title: '生图与交互',
            subtitle: '提示词提取指令标记、自动化生成与楼层按钮响应',
            collapsible: true,
        });

        const s = settingsStore.getSettings();
        const actionPanel = s.ui?.actionPanel;
        const lightbox = s.ui?.lightbox;

        // 生图指令开头
        this.startTagInput = new TextInput({
            value: s.placeholderStart || 'image###',
            placeholder: '例如: image###',
            onChange: (val) => {
                const trimmed = val.trim();
                settingsStore.set('placeholderStart', trimmed || 'image###');
            },
        });
        const startTagField = new FormField({
            label: '生图指令开头',
            tooltip: '在 AI 回复正文中识别绘图提示词的前置起始标记',
            control: this.startTagInput,
            width: 'w-240',
        });

        // 生图指令结尾
        this.endTagInput = new TextInput({
            value: s.placeholderEnd || '###',
            placeholder: '例如: ###',
            onChange: (val) => {
                const trimmed = val.trim();
                settingsStore.set('placeholderEnd', trimmed || '###');
            },
        });
        const endTagField = new FormField({
            label: '生图指令结尾',
            tooltip: '在 AI 回复正文中识别绘图提示词的闭合结束标记',
            control: this.endTagInput,
            width: 'w-240',
        });

        // AI 回复后自动生图
        this.autoGenSwitch = new Switch({
            value: s.autoGenerate ?? false,
            onChange: (val) => {
                settingsStore.set('autoGenerate', val);
            },
        });
        const autoGenField = new FormField({
            label: 'AI 回复后自动生图',
            tooltip: '当角色回复完毕且检测到包含生图指令时，无需手动点击自动排队生成',
            control: this.autoGenSwitch,
            width: 'w-toggle',
        });

        // 生成完成后隐藏按钮
        this.hideBtnSwitch = new Switch({
            value: actionPanel?.hideButtonOnDone ?? false,
            onChange: (val) => {
                const currentUi = settingsStore.get('ui') || {};
                settingsStore.update({
                    ui: {
                        ...currentUi,
                        actionPanel: {
                            ...(currentUi.actionPanel || {}),
                            hideButtonOnDone: val,
                        },
                    },
                });
            },
        });
        const hideBtnField = new FormField({
            label: '生成完成后隐藏按钮',
            tooltip: '当前楼层生图成功并展示图片后，自动隐藏该楼层的生图触发主按钮',
            control: this.hideBtnSwitch,
            width: 'w-toggle',
        });

        // 显示图片操作栏
        this.actionPanelSwitch = new Switch({
            value: actionPanel?.enabled ?? true,
            onChange: (val) => {
                const currentUi = settingsStore.get('ui') || {};
                settingsStore.update({
                    ui: {
                        ...currentUi,
                        actionPanel: {
                            ...(currentUi.actionPanel || {}),
                            enabled: val,
                        },
                    },
                });
            },
        });
        const actionPanelField = new FormField({
            label: '显示图片操作栏',
            tooltip: '在楼层图片下方挂载重新生成、复制提示词、看大图等快捷按钮条',
            control: this.actionPanelSwitch,
            width: 'w-toggle',
        });

        // 点击图片看大图
        this.lightboxSwitch = new Switch({
            value: lightbox?.enabled ?? true,
            onChange: (val) => {
                const currentUi = settingsStore.get('ui') || {};
                settingsStore.update({
                    ui: {
                        ...currentUi,
                        lightbox: {
                            ...(currentUi.lightbox || {}),
                            enabled: val,
                        },
                    },
                });
            },
        });
        const lightboxField = new FormField({
            label: '点击图片看大图',
            tooltip: '点击楼层或画廊中的图片时，打开全屏深色灯箱进行沉浸放大浏览',
            control: this.lightboxSwitch,
            width: 'w-toggle',
        });

        // 提示词自动去重
        this.cleanPromptSwitch = new Switch({
            value: s.cleanPrompt ?? true,
            onChange: (val) => {
                settingsStore.set('cleanPrompt', val);
            },
        });
        const cleanPromptField = new FormField({
            label: '提示词自动去重',
            tooltip: '自动滤除多余换行与重复标签，规范逗号连接格式',
            control: this.cleanPromptSwitch,
            width: 'w-toggle',
        });

        card.appendContent([
            startTagField.element,
            endTagField.element,
            autoGenField.element,
            hideBtnField.element,
            actionPanelField.element,
            lightboxField.element,
            cleanPromptField.element,
        ]);

        this.disposables.push(
            this.startTagInput,
            startTagField,
            this.endTagInput,
            endTagField,
            this.autoGenSwitch,
            autoGenField,
            this.hideBtnSwitch,
            hideBtnField,
            this.actionPanelSwitch,
            actionPanelField,
            this.lightboxSwitch,
            lightboxField,
            this.cleanPromptSwitch,
            cleanPromptField
        );

        return card;
    }

    // 3. 图片显示卡片装配
    private buildDisplayCard(): Card {
        const card = new Card({
            title: '图片显示',
            subtitle: '楼层生成图片的对齐位置、尺寸约束与视觉遮罩样式',
            collapsible: true,
        });

        const s = settingsStore.getSettings();
        const img = s.ui?.imageDisplay;

        // 对齐方式
        this.alignSelect = new Select({
            value: img?.align || 'center',
            options: [
                { label: '居中对齐', value: 'center' },
                { label: '靠左对齐', value: 'flex-start' },
                { label: '靠右对齐', value: 'flex-end' },
            ],
            onChange: (val) => {
                const ui = settingsStore.get('ui') || {};
                settingsStore.update({
                    ui: {
                        ...ui,
                        imageDisplay: {
                            ...(ui.imageDisplay || {}),
                            align: val,
                        },
                    },
                });
            },
        });
        const alignField = new FormField({
            label: '对齐方式',
            tooltip: '图片在聊天消息楼层中的横向对齐位置',
            control: this.alignSelect,
            width: 'w-240',
        });

        // 显示模式
        this.fitSelect = new Select({
            value: img?.objectFit || 'contain',
            options: [
                { label: '完整显示', value: 'contain' },
                { label: '裁剪填充', value: 'cover' },
                { label: '原始尺寸', value: 'none' },
            ],
            onChange: (val) => {
                const ui = settingsStore.get('ui') || {};
                settingsStore.update({
                    ui: {
                        ...ui,
                        imageDisplay: {
                            ...(ui.imageDisplay || {}),
                            objectFit: val,
                        },
                    },
                });
            },
        });
        const fitField = new FormField({
            label: '显示模式',
            tooltip: '图片在视窗容器内部的自适应规则：完整显示保持比例完整展现；裁剪填充铺满容器并裁切溢出部分；原始尺寸保持原图物理像素不缩放',
            control: this.fitSelect,
            width: 'w-240',
        });

        // 最大宽度
        this.maxWidthSlider = new Slider({
            value: img?.maxWidthPct ?? 100,
            min: 10,
            max: 100,
            step: 5,
            unit: '%',
            onChange: (val) => {
                const ui = settingsStore.get('ui') || {};
                settingsStore.update({
                    ui: {
                        ...ui,
                        imageDisplay: {
                            ...(ui.imageDisplay || {}),
                            maxWidthPct: val,
                        },
                    },
                });
            },
        });
        const maxWidthField = new FormField({
            label: '最大宽度',
            tooltip: '限制图片占聊天气泡宽度的最大百分比',
            control: this.maxWidthSlider,
            width: 'w-240',
        });

        // 最大高度
        this.maxHeightSlider = new Slider({
            value: img?.maxHeight ?? 480,
            min: 100,
            max: 1200,
            step: 20,
            unit: 'px',
            onChange: (val) => {
                const ui = settingsStore.get('ui') || {};
                settingsStore.update({
                    ui: {
                        ...ui,
                        imageDisplay: {
                            ...(ui.imageDisplay || {}),
                            maxHeight: val,
                        },
                    },
                });
            },
        });
        const maxHeightField = new FormField({
            label: '最大高度',
            tooltip: '限制聊天楼层中生成图片的最大显示高度，避免长图占据过多屏幕空间',
            control: this.maxHeightSlider,
            width: 'w-240',
        });

        // 图片圆角
        this.roundedSwitch = new Switch({
            value: img?.rounded ?? true,
            onChange: (val) => {
                const ui = settingsStore.get('ui') || {};
                settingsStore.update({
                    ui: {
                        ...ui,
                        imageDisplay: {
                            ...(ui.imageDisplay || {}),
                            rounded: val,
                        },
                    },
                });
            },
        });
        const roundedField = new FormField({
            label: '图片圆角',
            tooltip: '为聊天楼层生成的图片添加精致的主题圆角修饰',
            control: this.roundedSwitch,
            width: 'w-toggle',
        });

        // 防窥模糊
        this.autoBlurSwitch = new Switch({
            value: Boolean(img?.autoBlur ?? img?.collapsed),
            onChange: (val) => {
                const ui = settingsStore.get('ui') || {};
                settingsStore.update({
                    ui: {
                        ...ui,
                        imageDisplay: {
                            ...(ui.imageDisplay || {}),
                            autoBlur: val,
                            collapsed: val,
                        },
                    },
                });
            },
        });
        const autoBlurField = new FormField({
            label: '防窥模糊',
            tooltip: '生成完成后图片默认高斯模糊遮罩，鼠标悬停时自动清晰显示，防止旁人窥屏',
            control: this.autoBlurSwitch,
            width: 'w-toggle',
        });

        card.appendContent([
            alignField.element,
            fitField.element,
            maxWidthField.element,
            maxHeightField.element,
            roundedField.element,
            autoBlurField.element,
        ]);

        this.disposables.push(
            this.alignSelect,
            alignField,
            this.fitSelect,
            fitField,
            this.maxWidthSlider,
            maxWidthField,
            this.maxHeightSlider,
            maxHeightField,
            this.roundedSwitch,
            roundedField,
            this.autoBlurSwitch,
            autoBlurField
        );

        return card;
    }

    // 4. 存储与备份卡片装配
    private buildStorageCard(): Card {
        const card = new Card({
            title: '存储与备份',
            subtitle: '本地数据库配额上限、缩略图加速与异地备份选项',
            collapsible: true,
        });

        const s = settingsStore.getSettings();

        // 本地存储上限
        this.maxStoredSelect = new Select({
            value: String(s.maxStoredImages ?? 500),
            options: [
                { label: '100 张', value: '100' },
                { label: '300 张', value: '300' },
                { label: '500 张', value: '500' },
                { label: '1000 张', value: '1000' },
                { label: '2000 张', value: '2000' },
                { label: '不限制', value: '0' },
            ],
            onChange: (val) => {
                settingsStore.set('maxStoredImages', Number(val));
            },
        });
        const maxStoredField = new FormField({
            label: '本地存储上限',
            tooltip: '本地浏览器数据库最多保存的图片数量，推荐设为 500 张。超出上限后自动清理较早且未收藏的图片',
            control: this.maxStoredSelect,
            width: 'w-240',
        });

        // 生成缩略图
        this.thumbSwitch = new Switch({
            value: s.enableThumbnail ?? true,
            onChange: (val) => {
                settingsStore.set('enableThumbnail', val);
            },
        });
        const thumbField = new FormField({
            label: '生成缩略图',
            tooltip: '在本地数据库生成小分辨率缩略图，大幅提升画廊与历史记录多图滚动的加载速度',
            control: this.thumbSwitch,
            width: 'w-toggle',
        });

        // 备份到酒馆服务器
        this.serverSwitch = new Switch({
            value: s.saveToServer ?? false,
            onChange: (val) => {
                settingsStore.set('saveToServer', val);
            },
        });
        const serverField = new FormField({
            label: '备份到酒馆服务器',
            tooltip: '将生成的图片同步上传备份到酒馆服务端静态目录中，便于多端与跨设备共享访问',
            control: this.serverSwitch,
            width: 'w-toggle',
        });

        // 重新加载自动补齐提示 Banner
        const tipBanner = document.createElement('div');
        tipBanner.style.margin = '4px 0 10px 0';
        tipBanner.style.padding = '8px 12px';
        tipBanner.style.fontSize = '12px';
        tipBanner.style.borderRadius = 'var(--da-radius-sm, 6px)';
        tipBanner.style.background = 'var(--da-bg-subtle, rgba(255, 255, 255, 0.04))';
        tipBanner.style.border = '1px solid var(--da-border-color)';
        tipBanner.style.color = 'var(--da-text-secondary)';
        tipBanner.style.lineHeight = '1.5';
        tipBanner.textContent = '💡 提示：插件默认将所有图片安全保存在浏览器本地数据库中。若开启备份到酒馆服务器，当在聊天中重新加载对应图片时，若检测到未曾转存，会自动执行补齐备份，支持多端与跨设备共享访问。';

        card.appendContent([
            maxStoredField.element,
            thumbField.element,
            serverField.element,
            tipBanner,
        ]);

        this.disposables.push(
            this.maxStoredSelect,
            maxStoredField,
            this.thumbSwitch,
            thumbField,
            this.serverSwitch,
            serverField
        );

        return card;
    }
}
