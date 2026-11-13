/**
 * 常规设置选项卡视图 (GeneralTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 SchemaForm 声明式构建常规配置卡片，
 * 涵盖基础运行参数、交互触发逻辑、楼层图像显示规则以及存储策略。
 * 当插件总开关处于关闭状态时，从属配置项自动联动置灰。
 */

import type { VNode } from 'preact';
import type { ProviderType, TransportMode } from '@types';
import type { ImageStorageQuality } from '@store';
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
                tooltip:
                    '控制绘画助手的全局运行状态。关闭时将暂停所有自动生图、提示词注入与楼层交互按钮，从属设置项自动联动置灰。',
            },
            {
                key: 'activeProvider',
                label: '生图服务',
                type: 'select',
                width: 'w-240',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '当前执行生图任务的目标后端服务。不同后端支持的参数调节范围与工作流能力各不相同，切换后可在对应的后端设置标签页中配置专属连接与模型参数。',
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
                    '默认由浏览器直接向生图服务发起网络请求；若遇到跨域 (CORS) 拦截或远程 HTTPS 酒馆无法直接访问本地 HTTP 服务时，请切换为「酒馆代理」由酒馆服务端中转请求（需在酒馆 config.yaml 中开启 enableCorsProxy: true）。',
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
                tooltip:
                    '向生图服务发起请求的最长等待时间（秒）。若后端显卡排队或生成耗时超过该设定，将自动终止当前等待并提示超时，避免任务因后端无响应而无限期停滞。',
            },
            {
                key: 'cancelOnChatChange',
                label: '切换聊天时取消任务',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后，在生图过程中切换至其他酒馆会话将立即中断并取消当前任务；若保持关闭，任务将在后台继续生成并保存至「本地图库」，仅跳过向离开的会话楼层回写图片。',
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
                    '用于在 AI 回复正文中识别生图指令的起始标记。支持在指令内使用“|”字符同时输入正向与负向提示词（例如: image### 1girl, masterpiece | lowres, blurry ###）。',
            },
            {
                key: 'promptEndTag',
                label: '生图结束标记',
                type: 'text',
                width: 'w-240',
                placeholder: '例如: ###',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '用于在 AI 回复正文中识别生图指令的结束闭合标记，与开始标记成对使用以精准提取提示词内容（例如: ###）。',
            },
            {
                key: 'autoGenerate',
                label: 'AI 回复后自动出图',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后，当 AI 回复中包含成对的生图指令标记时，将立即自动加入生成队列并开始生图，无需每次手动点击聊天气泡下方的生图按钮。',
            },
            {
                key: 'hideButtonOnDone',
                label: '出图后隐藏按钮',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后，当单张图片成功生成并上屏显示后，自动隐藏该楼层下方的生图触发按钮，使聊天记录保持清爽；如需重新生成，可随时通过右键菜单或大图预览中的操作重试。',
            },
            {
                key: 'imageActionPanelEnabled',
                label: '图片编辑面板',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后可在聊天楼层便捷打开图片操作菜单（桌面端右键图片、移动端长按图片 500ms，或在大图预览视窗中点击菜单），支持修改提示词重新生成、进入局部重绘或查看生成参数信息。',
            },
            {
                key: 'lightboxEnabled',
                label: '点击查看大图',
                tooltip:
                    '开启后，在聊天楼层中轻点生成图片即可唤起全屏大图预览视窗，支持滚轮缩放、拖拽平移、键盘快捷翻页以及一键保存下载原图。',
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
                    '在向后端提交生图前，自动清理提示词中连续重复的逗号、多余空格以及完全相同的重复标签，并保持 <lora:...> 语法完整。',
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
                tooltip:
                    '设置生成图片在消息气泡内的水平摆放位置，可选居中对齐、靠左对齐或靠右对齐。',
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
                    '设置图片在楼层显示区域内的自适应填充规则：完整显示（保持宽高比完整可见，两边留空）、裁剪填充（铺满设定尺寸，局部居中裁切）或原始尺寸（不主动缩放，按原图实际像素呈现）。',
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
                tooltip:
                    '限制图片在聊天消息气泡内占用的最大宽度百分比（默认 100% 占满宽度，调小后可以让单张图片更加精致紧凑）。',
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
                tooltip:
                    '限制图片在聊天楼层内展示的最大像素高度。超出高度限制时将按缩放模式自适应，防止超长竖图单张占据过多屏幕空间。',
            },
            {
                key: 'rounded',
                label: '圆角显示',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后为楼层中的图片应用平滑的圆角边框，与主题卡片风格自然融合；关闭后图片保持直角边缘。',
            },
            {
                key: 'autoBlur',
                label: '防窥模糊',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后，楼层中生成完成的图片默认施加高斯模糊遮罩；鼠标悬停或触控点击图片时即时解除模糊，适合在公共场合或多人环境下保护隐私。',
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
                    '原图格式无损保存原始 PNG/JPEG 像素及 EXIF 绘图参数元数据；WebP 格式可大幅节省 50%~80% 磁盘存储占用，显著降低本地 IndexedDB 配额压力并提升多图加载流畅度。',
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
            cancelOnChatChange: s.cancelOnChatChange ?? false,
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
            maxHeight: 512,
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
