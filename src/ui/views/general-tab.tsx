/**
 * 常规设置选项卡视图 (GeneralTabView)。
 *
 * @remarks
 * 基于 Preact JSX、SchemaForm 与 ReactiveSettingsBridge 声明式构建 4 大基础配置卡片：
 * 1. 基础配置：插件总开关、生图引擎、网络连接方式、请求超时；
 * 2. 交互与触发：指令起始/结束标记、回复后自动生图、出图后隐藏按钮、图片操作栏、大图预览、提示词标签去重；
 * 3. 图片显示：楼层对齐方式、缩放模式、最大宽度、最大高度、圆角显示、防窥模糊；
 * 4. 存储设置：存储画质、同步到酒馆服务端。
 *
 * 架构规范：
 * - 纯净排版：简单开关项彻底剔除冗余同义反复说明，仅对关键机制提供技术依据说明；
 * - 领域解耦：出图后隐藏按钮 (ui.floorButton) 与图片操作栏 (ui.imageActionPanel) 独立建模，互不侵扰；
 * - 级联禁用：当插件总开关关闭时，从属配置项自动联动置灰，提供直观的系统状态反馈。
 */

import type { VNode } from 'preact';
import type { ProviderType, TransportMode } from '@types';
import type { ImageStorageQuality } from '@store';
import { PreactSettingsView, SchemaForm, type CardSchema } from '../framework';
import { ReactiveSettingsBridge } from '../viewmodels';

interface GeneralFormModel {
    enabled: boolean;
    activeProvider: ProviderType;
    transport: TransportMode;
    timeoutSec: number;
    placeholderStart: string;
    placeholderEnd: string;
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
        collapsible: true,
        fields: [
            {
                key: 'enabled',
                label: '启用插件',
                type: 'switch',
                width: 'w-toggle',
            },
            {
                key: 'activeProvider',
                label: '生图引擎',
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
                width: 'auto',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '直连由浏览器直接请求绘图服务；代理经由酒馆服务端中继，可解决 HTTPS 访问本地服务时的跨域 (CORS) 与混合内容阻断',
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
                tooltip: '单次生图的最大等待秒数，超时后自动中止网络请求',
            },
        ],
    },
    {
        id: 'general-interact',
        title: '交互与触发',
        collapsible: true,
        fields: [
            {
                key: 'placeholderStart',
                label: '指令起始标记',
                type: 'text',
                width: 'w-240',
                placeholder: '例如: image###',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '识别正文绘图指令的前置标识。支持使用英文竖线“|”分隔正向与负向提示词（示例：image### 1girl, masterpiece | lowres, blurry ###）',
            },
            {
                key: 'placeholderEnd',
                label: '指令结束标记',
                type: 'text',
                width: 'w-240',
                placeholder: '例如: ###',
                disabledWhen: (m) => !m.enabled,
            },
            {
                key: 'autoGenerate',
                label: '回复后自动生图',
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
            },
            {
                key: 'imageActionPanelEnabled',
                label: '图片操作栏',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '允许通过鼠标右键或长按楼层图片，打开图像提示词微调与原位重绘操作面板',
            },
            {
                key: 'lightboxEnabled',
                label: '大图预览',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
            },
            {
                key: 'cleanPrompt',
                label: '提示词标签去重',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '按逗号拆分并剔除重复标签（严格保留 <lora:...> 语法），规整标点符号',
            },
        ],
    },
    {
        id: 'general-display',
        title: '图片显示',
        collapsible: true,
        fields: [
            {
                key: 'align',
                label: '对齐方式',
                type: 'segmented',
                width: 'auto',
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
                width: 'auto',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '图片在楼层中的适应规则：完整显示保持比例、裁剪填充铺满容器或以原始尺寸呈现',
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
                tooltip: '限制图片相对聊天气泡的最大宽度比例',
            },
            {
                key: 'maxHeight',
                label: '最大高度',
                type: 'slider',
                width: 'w-240',
                min: 100,
                max: 1200,
                step: 20,
                unit: 'px',
                disabledWhen: (m) => !m.enabled,
                tooltip: '限制聊天楼层中图片的最大显示高度',
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
                tooltip: '默认模糊遮罩图片，鼠标悬停时揭示清晰原图',
            },
        ],
    },
    {
        id: 'general-storage',
        title: '存储设置',
        collapsible: true,
        fields: [
            {
                key: 'imageQuality',
                label: '存储画质',
                type: 'select',
                width: 'w-240',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '存入本地数据库与酒馆服务端的图像画质策略。原图保留原始尺寸与质量；WebP 格式可大幅压缩体积并加快多图加载',
                options: [
                    { label: '原始无损 (默认)', value: 'original' },
                    { label: 'WebP 高画质 (90%)', value: 'webp-high' },
                    { label: 'WebP 平衡 (80%)', value: 'webp-medium' },
                ],
            },
            {
                key: 'saveToServer',
                label: '同步到酒馆服务端',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '自动将图片转存至酒馆服务端静态目录，便于多设备访问与外部引用',
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
            placeholderStart: s.placeholderStart || 'image###',
            placeholderEnd: s.placeholderEnd || '###',
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
            autoBlur: Boolean(img?.autoBlur ?? img?.collapsed),
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
            case 'placeholderStart':
                this.bridge.set('placeholderStart', String(val).trim() || 'image###');
                break;
            case 'placeholderEnd':
                this.bridge.set('placeholderEnd', String(val).trim() || '###');
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
                    collapsed: Boolean(val),
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
        collapsed?: boolean;
    }): void {
        const current = this.bridge.get('ui')?.imageDisplay ?? {
            align: 'center' as const,
            objectFit: 'contain' as const,
            maxWidthPct: 100,
            maxHeight: 512,
            rounded: true,
            autoBlur: false,
            collapsed: false,
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
        this.bridge.activate();
    }

    public override deactivate(): void {
        this.bridge.deactivate();
    }

    public override dispose(): void {
        this.bridge.dispose();
        super.dispose();
    }
}
