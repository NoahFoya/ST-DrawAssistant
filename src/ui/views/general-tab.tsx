/**
 * 常规设置选项卡视图 (GeneralTabView)。
 *
 * @remarks
 * 基于 Preact JSX、SchemaForm 与 ReactiveSettingsBridge 声明式构建 4 大基础配置卡片：
 * 1. 基础配置：启用插件、绘图引擎、网络连接方式、请求超时、显示说明图标；
 * 2. 交互与触发：生图指令开头/结尾、角色回复后自动生图、生成后隐藏按钮、图片操作栏、大图预览、提示词自动去重；
 * 3. 图片显示：对齐方式、显示模式、最大宽度、最大高度、图片圆角、图片防窥；
 * 4. 存储设置：本地存储上限、生成缩略图、保存到酒馆服务器。
 */

import type { VNode } from 'preact';
import type { ProviderType, TransportMode } from '@types';
import { PreactSettingsView, SchemaForm, type CardSchema } from '../framework';
import { ReactiveSettingsBridge } from '../viewmodels';

interface GeneralFormModel {
    enabled: boolean;
    activeProvider: ProviderType;
    transport: TransportMode;
    timeoutSec: number;
    showHelp: boolean;
    placeholderStart: string;
    placeholderEnd: string;
    autoGenerate: boolean;
    hideButtonOnDone: boolean;
    actionPanelEnabled: boolean;
    lightboxEnabled: boolean;
    cleanPrompt: boolean;
    align: 'left' | 'center' | 'right';
    objectFit: 'contain' | 'cover';
    maxWidthPct: number;
    maxHeight: number;
    rounded: boolean;
    autoBlur: boolean;
    maxStoredImages: string;
    enableThumbnail: boolean;
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
                tooltip: '开启或关闭绘画助手扩展功能',
            },
            {
                key: 'activeProvider',
                label: '绘图引擎',
                type: 'select',
                width: 'w-240',
                tooltip: '选择当前用于生成图像的后端服务',
                options: [
                    { label: 'ComfyUI', value: 'comfyui' },
                    { label: 'SD-WebUI / Forge', value: 'sdwebui' },
                    { label: 'NovelAI', value: 'novelai' },
                    { label: 'OpenAI 兼容', value: 'openai' },
                ],
            },
            {
                key: 'transport',
                label: '网络连接方式',
                type: 'segmented',
                width: 'auto',
                tooltip:
                    '直连：由浏览器直接请求服务，延迟更低；酒馆代理：服务端中继转发，可解决跨域与混合内容限制',
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
                tooltip: '单次生图的最大等待秒数，超时后自动取消任务',
            },
            {
                key: 'showHelp',
                label: '显示说明图标',
                type: 'switch',
                width: 'w-toggle',
                tooltip: '在各设置项旁显示帮助问号图标，悬停或点击可查看功能说明',
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
                label: '生图指令开头',
                type: 'text',
                width: 'w-240',
                placeholder: '例如: image###',
                tooltip: '在 AI 回复正文中识别绘图提示词的前置起始标记',
            },
            {
                key: 'placeholderEnd',
                label: '生图指令结尾',
                type: 'text',
                width: 'w-240',
                placeholder: '例如: ###',
                tooltip: '在 AI 回复正文中识别绘图提示词的闭合结束标记',
            },
            {
                key: 'autoGenerate',
                label: '角色回复后自动生图',
                type: 'switch',
                width: 'w-toggle',
                tooltip: '检测到角色回复中包含生图指令时，无需手动点击自动排队生成',
            },
            {
                key: 'hideButtonOnDone',
                label: '生成后隐藏按钮',
                type: 'switch',
                width: 'w-toggle',
                tooltip: '当前楼层生图成功并展示图片后，自动隐藏该楼层的生图主按钮',
            },
            {
                key: 'actionPanelEnabled',
                label: '图片操作栏',
                type: 'switch',
                width: 'w-toggle',
                tooltip: '在楼层图片下方显示重试、复制提示词等快捷操作栏',
            },
            {
                key: 'lightboxEnabled',
                label: '大图预览',
                type: 'switch',
                width: 'w-toggle',
                tooltip: '点击聊天楼层或画廊中的图片时，在全屏窗口中查看大图',
            },
            {
                key: 'cleanPrompt',
                label: '提示词自动去重',
                type: 'switch',
                width: 'w-toggle',
                tooltip: '自动清理提示词中的多余换行与重复标签，规范逗号连接',
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
                tooltip: '图片在聊天消息楼层中的横向对齐位置',
                options: [
                    { label: '居中对齐', value: 'center' },
                    { label: '靠左对齐', value: 'flex-start' },
                    { label: '靠右对齐', value: 'flex-end' },
                ],
            },
            {
                key: 'objectFit',
                label: '显示模式',
                type: 'segmented',
                width: 'auto',
                tooltip: '图片适应规则：完整显示保持比例；裁剪填充铺满容器；原始尺寸不缩放',
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
                tooltip: '限制图片占聊天气泡宽度的最大百分比',
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
                tooltip: '限制聊天楼层中图片的最大显示高度',
            },
            {
                key: 'rounded',
                label: '图片圆角',
                type: 'switch',
                width: 'w-toggle',
                tooltip: '为聊天楼层生成的图片添加圆角显示',
            },
            {
                key: 'autoBlur',
                label: '图片防窥',
                type: 'switch',
                width: 'w-toggle',
                tooltip: '为图片添加模糊遮罩，鼠标悬停时清晰显示',
            },
        ],
    },
    {
        id: 'general-storage',
        title: '存储设置',
        collapsible: true,
        fields: [
            {
                key: 'maxStoredImages',
                label: '本地存储上限',
                type: 'select',
                width: 'w-240',
                tooltip: '本地数据库最多保存的图片数量，超出后自动清理较早且未收藏的图片',
                options: [
                    { label: '100 张', value: '100' },
                    { label: '300 张', value: '300' },
                    { label: '500 张', value: '500' },
                    { label: '1000 张', value: '1000' },
                    { label: '2000 张', value: '2000' },
                    { label: '不限制', value: '0' },
                ],
            },
            {
                key: 'enableThumbnail',
                label: '生成缩略图',
                type: 'switch',
                width: 'w-toggle',
                tooltip: '在本地生成缩略图，加快画廊浏览速度',
            },
            {
                key: 'saveToServer',
                label: '保存到酒馆服务器',
                type: 'switch',
                width: 'w-toggle',
                tooltip: '可选同步上传图片至酒馆服务端，便于跨设备访问',
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
        const actionPanel = ui?.actionPanel;
        const lightbox = ui?.lightbox;
        const img = ui?.imageDisplay;

        return {
            enabled: s.enabled ?? true,
            activeProvider: (s.activeProvider || 'comfyui') as ProviderType,
            transport: (s.transport || 'direct') as TransportMode,
            timeoutSec: Math.round((s.taskTimeoutMs || 120000) / 1000),
            showHelp: s.showHelp ?? true,
            placeholderStart: s.placeholderStart || 'image###',
            placeholderEnd: s.placeholderEnd || '###',
            autoGenerate: s.autoGenerate ?? false,
            hideButtonOnDone: actionPanel?.hideButtonOnDone ?? false,
            actionPanelEnabled: actionPanel?.enabled ?? true,
            lightboxEnabled: lightbox?.enabled ?? true,
            cleanPrompt: s.cleanPrompt ?? true,
            align: (img?.align || 'center') as GeneralFormModel['align'],
            objectFit: (img?.objectFit || 'contain') as GeneralFormModel['objectFit'],
            maxWidthPct: img?.maxWidthPct ?? 100,
            maxHeight: img?.maxHeight ?? 480,
            rounded: img?.rounded ?? true,
            autoBlur: Boolean(img?.autoBlur ?? img?.collapsed),
            maxStoredImages: String(s.maxStoredImages ?? 500),
            enableThumbnail: s.enableThumbnail ?? true,
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
            case 'showHelp':
                this.bridge.set('showHelp', Boolean(val));
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
                    actionPanel: {
                        ...(this.bridge.get('ui')?.actionPanel || { enabled: true }),
                        hideButtonOnDone: Boolean(val),
                    },
                });
                break;
            case 'actionPanelEnabled':
                this.bridge.updateUi({
                    actionPanel: {
                        ...(this.bridge.get('ui')?.actionPanel || { hideButtonOnDone: false }),
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
            case 'maxStoredImages':
                this.bridge.set('maxStoredImages', Number(val));
                break;
            case 'enableThumbnail':
                this.bridge.set('enableThumbnail', Boolean(val));
                break;
            case 'saveToServer':
                this.bridge.set('saveToServer', Boolean(val));
                break;
        }
    }

    private updateImageDisplay(patch: {
        align?: 'left' | 'center' | 'right';
        objectFit?: 'contain' | 'cover';
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
