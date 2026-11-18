/**
 * 常规设置选项卡视图 (GeneralTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 SchemaForm 声明式构建常规配置卡片，
 * 涵盖基础运行参数、交互触发逻辑、楼层图像显示规则以及存储策略。
 * 当插件总开关处于关闭状态时，从属配置项自动联动置灰。
 */

import type { VNode } from 'preact';
import type { ImageStorageQuality, ProviderType, TransportMode } from '@types';
import { PreactSettingsView, SchemaForm, type CardSchema } from '../framework';
import { ReactiveSettingsBridge } from '../viewmodels';
import { promptInjector } from '../../pipeline/prompt-injector';

interface GeneralFormModel {
    enabled: boolean;
    activeProvider: ProviderType;
    transport: TransportMode;
    timeoutSec: number;
    cancelOnChatChange: boolean;
    promptStartTag: string;
    promptEndTag: string;
    autoGenerate: boolean;
    hideButtonOnDone: boolean;
    imageActionPanelEnabled: boolean;
    lightboxEnabled: boolean;
    cleanPrompt: boolean;
    align: 'center' | 'flex-start' | 'flex-end';
    objectFit: 'contain' | 'cover' | 'none';
    maxWidthPct: number;
    maxHeight: number;
    rounded: boolean;
    autoBlur: boolean;
    imageQuality: ImageStorageQuality;
    saveToServer: boolean;
}

const GENERAL_CARDS_SCHEMA: CardSchema<GeneralFormModel>[] = [
    {
        id: 'general-basic',
        title: '基础配置',
        fields: [
            {
                key: 'enabled',
                label: '启用插件',
                type: 'switch',
                width: 'w-toggle',
            },
            {
                key: 'activeProvider',
                label: '生图服务',
                type: 'select',
                width: 'w-240',
                disabledWhen: (m) => !m.enabled,
                options: [
                    { label: 'ComfyUI', value: 'comfyui' },
                    { label: 'SD-WebUI / Forge', value: 'sdwebui' },
                    { label: 'NovelAI', value: 'novelai' },
                    { label: 'OpenAI 兼容', value: 'openai' },
                ],
            },
            {
                key: 'transport',
                label: '连接方式',
                type: 'segmented',
                width: 'w-240',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '默认由浏览器直连生图服务；遇到跨域 (CORS) 拦截或远程 HTTPS 酒馆访问本地 HTTP 服务时，请切换为「酒馆代理」（需在酒馆 config.yaml 开启 enableCorsProxy: true）。',
                options: [
                    { label: '浏览器直连', value: 'direct' },
                    { label: '酒馆代理', value: 'relay' },
                ],
            },
            {
                key: 'timeoutSec',
                label: '请求超时',
                type: 'number',
                width: 'w-120',
                min: 30,
                max: 600,
                step: 10,
                unit: '秒',
                disabledWhen: (m) => !m.enabled,
            },
            {
                key: 'cancelOnChatChange',
                label: '切换聊天时取消任务',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '默认开启，切换至其他酒馆会话时将取消未完成任务；关闭后任务继续在后台完成并仅保存至「本地图库」。',
            },
        ],
    },
    {
        id: 'general-interact',
        title: '交互与触发',
        fields: [
            {
                key: 'promptStartTag',
                label: '生图开始标记',
                type: 'text',
                width: 'w-240',
                placeholder: '例如: image###',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '用于在 AI 回复正文中成对识别生图指令，支持使用“|”同时填写正负向提示词（如 image### 1girl | lowres ###）。',
            },
            {
                key: 'promptEndTag',
                label: '生图结束标记',
                type: 'text',
                width: 'w-240',
                placeholder: '例如: ###',
                disabledWhen: (m) => !m.enabled,
            },
            {
                key: 'autoGenerate',
                label: 'AI 回复后自动出图',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
            },
            {
                key: 'hideButtonOnDone',
                label: '出图后隐藏按钮',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后，出图完成将隐藏该楼层下方的生图按钮；如需重绘，可通过右键、长按或大图预览菜单操作。',
            },
            {
                key: 'imageActionPanelEnabled',
                label: '图片编辑面板',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后，桌面端右键图片、移动端长按图片（500ms）或在大图预览菜单中可打开编辑与重绘面板。',
            },
            {
                key: 'lightboxEnabled',
                label: '点击查看大图',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
            },
            {
                key: 'cleanPrompt',
                label: '提示词自动去重整理',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '提交生成前自动清理多余逗号、空格及重复标签，同时保留 <lora:...> 语法。',
            },
        ],
    },
    {
        id: 'general-display',
        title: '图片显示',
        fields: [
            {
                key: 'align',
                label: '对齐方式',
                type: 'segmented',
                width: 'w-240',
                disabledWhen: (m) => !m.enabled,
                options: [
                    { label: '居中对齐', value: 'center' },
                    { label: '靠左对齐', value: 'flex-start' },
                    { label: '靠右对齐', value: 'flex-end' },
                ],
            },
            {
                key: 'objectFit',
                label: '缩放模式',
                type: 'segmented',
                width: 'w-240',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '完整显示：保持比例完整展示；裁剪填充：铺满容器并裁切多余部分；原始尺寸：按原图像素呈现。',
                options: [
                    { label: '完整显示', value: 'contain' },
                    { label: '裁剪填充', value: 'cover' },
                    { label: '原始尺寸', value: 'none' },
                ],
            },
            {
                key: 'maxWidthPct',
                label: '最大宽度',
                type: 'slider',
                width: 'w-240',
                min: 10,
                max: 100,
                step: 5,
                unit: '%',
                disabledWhen: (m) => !m.enabled,
            },
            {
                key: 'maxHeight',
                label: '最大高度',
                type: 'slider',
                width: 'w-240',
                min: 100,
                max: 2048,
                step: 20,
                unit: 'px',
                disabledWhen: (m) => !m.enabled,
            },
            {
                key: 'rounded',
                label: '圆角显示',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
            },
            {
                key: 'autoBlur',
                label: '防窥模糊',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '生成图片默认呈模糊遮罩，鼠标悬停或点击查看大图后显示清晰画面。',
            },
        ],
    },
    {
        id: 'general-storage',
        title: '存储设置',
        fields: [
            {
                key: 'imageQuality',
                label: '图片存储格式',
                type: 'select',
                width: 'w-240',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '原始格式保留完整像素与 EXIF 绘图参数元数据；WebP 格式可明显减少本地 IndexedDB 存储占用。',
                options: [
                    { label: '原始格式 (无损)', value: 'original' },
                    { label: 'WebP 高质量 (90%)', value: 'webp-high' },
                    { label: 'WebP 均衡压缩 (80%)', value: 'webp-medium' },
                ],
            },
            {
                key: 'saveToServer',
                label: '同步转存至酒馆',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '生成成功后，通过酒馆宿主 API 将图片文件同步上传转存至酒馆服务端存储目录，便于在多设备漫游或备份酒馆数据时直接保留完整图片资产。',
            },
        ],
    },
];

export class GeneralTabView extends PreactSettingsView {
    public readonly id = 'general';
    public readonly title = '常规设置';

    private readonly bridge: ReactiveSettingsBridge;

    public constructor() {
        super('da-tab-pane');
        this.bridge = new ReactiveSettingsBridge(false);
        this.mountPreact();
    }

    private buildViewModel(): GeneralFormModel {
        const s = this.bridge.settings.value;
        const ui = s.ui;
        const floorButton = ui?.floorButton;
        const imageActionPanel = ui?.imageActionPanel;
        const lightbox = ui?.lightbox;
        const img = ui?.imageDisplay;

        return {
            enabled: s.enabled ?? true,
            activeProvider: (s.activeProvider || 'comfyui') as ProviderType,
            transport: (s.transport || 'direct') as TransportMode,
            timeoutSec: Math.round((s.taskTimeoutMs || 120000) / 1000),
            cancelOnChatChange: s.cancelOnChatChange ?? true,
            promptStartTag: s.promptStartTag || 'image###',
            promptEndTag: s.promptEndTag || '###',
            autoGenerate: s.autoGenerate ?? false,
            hideButtonOnDone: floorButton?.hideOnDone ?? false,
            imageActionPanelEnabled: imageActionPanel?.enabled ?? true,
            lightboxEnabled: lightbox?.enabled ?? true,
            cleanPrompt: s.cleanPrompt ?? true,
            align: (img?.align || 'center') as GeneralFormModel['align'],
            objectFit: (img?.objectFit || 'contain') as GeneralFormModel['objectFit'],
            maxWidthPct: img?.maxWidthPct ?? 100,
            maxHeight: img?.maxHeight ?? 480,
            rounded: img?.rounded ?? true,
            autoBlur: Boolean(img?.autoBlur),
            imageQuality: (s.imageQuality || 'original') as ImageStorageQuality,
            saveToServer: s.saveToServer ?? false,
        };
    }

    private handleFieldChange<K extends keyof GeneralFormModel>(
        key: K,
        val: GeneralFormModel[K]
    ): void {
        switch (key) {
            case 'enabled':
                this.bridge.set('enabled', Boolean(val));
                void promptInjector.scheduleSyncToHost();
                break;
            case 'activeProvider':
                this.bridge.set('activeProvider', val as ProviderType);
                break;
            case 'transport':
                this.bridge.set('transport', val as TransportMode);
                break;
            case 'timeoutSec':
                this.bridge.set('taskTimeoutMs', Math.max(30, Number(val)) * 1000);
                break;
            case 'cancelOnChatChange':
                this.bridge.set('cancelOnChatChange', Boolean(val));
                break;
            case 'promptStartTag':
                this.bridge.set('promptStartTag', String(val).trim() || 'image###');
                break;
            case 'promptEndTag':
                this.bridge.set('promptEndTag', String(val).trim() || '###');
                break;
            case 'autoGenerate':
                this.bridge.set('autoGenerate', Boolean(val));
                break;
            case 'hideButtonOnDone':
                this.bridge.updateUi({
                    floorButton: {
                        hideOnDone: Boolean(val),
                    },
                });
                break;
            case 'imageActionPanelEnabled':
                this.bridge.updateUi({
                    imageActionPanel: {
                        enabled: Boolean(val),
                    },
                });
                break;
            case 'lightboxEnabled':
                this.bridge.updateUi({
                    lightbox: {
                        enabled: Boolean(val),
                    },
                });
                break;
            case 'cleanPrompt':
                this.bridge.set('cleanPrompt', Boolean(val));
                break;
            case 'align':
                this.updateImageDisplay({
                    align: val as GeneralFormModel['align'],
                });
                break;
            case 'objectFit':
                this.updateImageDisplay({
                    objectFit: val as GeneralFormModel['objectFit'],
                });
                break;
            case 'maxWidthPct':
                this.updateImageDisplay({
                    maxWidthPct: Number(val),
                });
                break;
            case 'maxHeight':
                this.updateImageDisplay({
                    maxHeight: Number(val),
                });
                break;
            case 'rounded':
                this.updateImageDisplay({
                    rounded: Boolean(val),
                });
                break;
            case 'autoBlur':
                this.updateImageDisplay({
                    autoBlur: Boolean(val),
                });
                break;
            case 'imageQuality':
                this.bridge.set('imageQuality', val as ImageStorageQuality);
                break;
            case 'saveToServer':
                this.bridge.set('saveToServer', Boolean(val));
                break;
        }
    }

    private updateImageDisplay(patch: {
        align?: 'center' | 'flex-start' | 'flex-end';
        objectFit?: 'contain' | 'cover' | 'none';
        maxWidthPct?: number;
        maxHeight?: number;
        rounded?: boolean;
        autoBlur?: boolean;
    }): void {
        const current = this.bridge.get('ui')?.imageDisplay ?? {
            align: 'center' as const,
            objectFit: 'contain' as const,
            maxWidthPct: 100,
            maxHeight: 480,
            rounded: true,
            autoBlur: false,
        };
        this.bridge.updateUi({
            imageDisplay: {
                ...current,
                ...patch,
            },
        });
    }

    protected renderContent(): VNode {
        const model = this.buildViewModel();
        return (
            <SchemaForm
                cards={GENERAL_CARDS_SCHEMA}
                model={model}
                onFieldChange={(key, val) => this.handleFieldChange(key, val)}
            />
        );
    }

    public override activate(): void {
        super.activate();
        this.bridge.activate();
    }

    public override deactivate(): void {
        super.deactivate();
        this.bridge.deactivate();
    }

    public override dispose(): void {
        this.bridge.dispose();
        super.dispose();
    }
}
