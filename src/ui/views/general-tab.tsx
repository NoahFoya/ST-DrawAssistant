/**
 * 插件设置选项卡视图 (GeneralTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 SchemaForm 声明式构建常规配置卡片，
 * 涵盖基础运行参数、交互触发逻辑、楼层图像显示规则以及存储策略。
 * 当插件总开关处于关闭状态时，从属配置项自动联动置灰。
 */

import type { VNode } from 'preact';
import type {
    ImageDisplayMode,
    ImageStorageQuality,
    ProviderType,
    ThinkingDisplayMode,
    TransportMode,
} from '@types';
import { PreactSettingsView, SchemaForm, type CardSchema } from '../framework';
import { TauriRelayNotice } from '../components';
import { ReactiveSettingsBridge } from '../viewmodels';
import { promptInjector } from '../../pipeline/prompt-injector';
import { hostRegexService } from '../../pipeline/host-regex-service';
import {
    detectHostRuntime,
    getTransportModeTooltip,
    TRANSPORT_MODE_OPTIONS,
} from '../../util/http-client';

interface GeneralFormModel {
    enabled: boolean;
    activeProvider: ProviderType;
    transport: TransportMode;
    timeoutSec: number;
    cancelOnChatChange: boolean;
    cancelOnSwipe: boolean;
    promptStartTag: string;
    promptEndTag: string;
    autoGenerate: boolean;
    hideButtonOnDone: boolean;
    imageActionPanelEnabled: boolean;
    lightboxEnabled: boolean;
    cleanPrompt: boolean;
    cleanPromptPunctuation: boolean;
    normalizeChinesePunctuation: boolean;
    thinkingDisplayMode: ThinkingDisplayMode;
    cleanHistoryThinking: boolean;
    cleanHistoryMarkup: boolean;
    align: 'center' | 'flex-start' | 'flex-end';
    objectFit: 'contain' | 'cover' | 'none';
    maxWidthPct: number;
    maxHeight: number;
    rounded: boolean;
    displayMode: ImageDisplayMode;
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
                    { label: 'Google Gemini', value: 'gemini' },
                    { label: 'xAI Grok', value: 'grok' },
                ],
            },
            {
                key: 'transport',
                label: '连接方式',
                type: 'segmented',
                width: 'w-240',
                disabledWhen: (m) => !m.enabled,
                isInvalidWhen: (_, m) => m.transport === 'relay' && !detectHostRuntime().supportsRelayProxy,
                tooltip: getTransportModeTooltip(),
                options: [...TRANSPORT_MODE_OPTIONS],
            },
            {
                key: 'transportNotice',
                type: 'custom',
                bare: true,
                visibleWhen: (m) => m.transport === 'relay' && !detectHostRuntime().supportsRelayProxy,
                renderCustom: (ctx) => (
                    <TauriRelayNotice
                        disabled={ctx.disabled || !ctx.model.enabled}
                        onSwitchToDirect={() => ctx.updateField('transport', 'direct')}
                    />
                ),
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
            {
                key: 'cancelOnSwipe',
                label: '重 roll 时取消旧分支任务',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '默认开启，右滑重 roll 生成全新候选分支时自动取消旧分支尚未完成的生图任务，优先处理新版队列；左右翻看已有分支时保留后台队列，关闭后允许旧分支继续完成。',
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
                label: '提示词 Tags 自动去重',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后仅对英文逗号分隔的纯英文标签按首次出现保序去重，保留中英文自然句式与 <lora:...> / <wlr:...> 语法。',
            },
            {
                key: 'cleanPromptPunctuation',
                label: '标点与空行自动整理',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后自动合并连续重复的同类标点、清理多余逗号分隔，并去除多余空白行（保留单次有效换行）；关闭后保留原始标点与空行。',
            },
            {
                key: 'normalizeChinesePunctuation',
                label: '中文标点转英文逗号',
                type: 'switch',
                width: 'w-toggle',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '开启后将中文全角逗号「，」与顿号「、」转为英文半角逗号「, 」，兼容仅按英文逗号分割的标签模型；默认关闭以保留中文自然语义。',
            },
            {
                key: 'thinkingDisplayMode',
                label: '绘图与设计思考',
                type: 'segmented',
                width: 'w-240',
                tooltip:
                    '设置对话中 <imagethink> 与 <designthink> 标签块的前端展示方式，不影响通用思考链 <think>（若所用提示词模板不生成这两类标签则无额外变化）。选择「折叠」或「隐藏」时将同步写入酒馆全局正则，停用插件后仍保留生效。',
                options: [
                    { label: '显示', value: 'show' },
                    { label: '折叠', value: 'collapse' },
                    { label: '隐藏', value: 'hide' },
                ],
            },
            {
                key: 'cleanHistoryThinking',
                label: '清理历史绘图与设计思考',
                type: 'switch',
                width: 'w-toggle',
                tooltip:
                    '同步写入酒馆全局正则：发送对话上下文前自动剥离历史消息中的 <imagethink> 与 <designthink> 标签块（不影响通用 <think>；若当前模板未生成这两类标签则无额外效果），节省上下文 Token，停用插件后仍保持生效。',
            },
            {
                key: 'cleanHistoryMarkup',
                label: '清理历史生图与档案标记',
                type: 'switch',
                width: 'w-toggle',
                tooltip:
                    '同步写入酒馆全局正则：发送对话上下文前自动剥离历史消息中的生图指令与角色/服装档案标记，节省 Token 且不影响楼层已出图片，停用插件后仍保持生效。',
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
                    { label: '靠左对齐', value: 'flex-start' },
                    { label: '居中对齐', value: 'center' },
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
                type: 'number',
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
                type: 'number',
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
                key: 'displayMode',
                label: '显示模式',
                type: 'segmented',
                width: 'w-240',
                disabledWhen: (m) => !m.enabled,
                tooltip:
                    '正常：直接展示完整图片；模糊：图片默认高斯模糊遮罩，鼠标悬停或点击查看大图后清晰；折叠：默认收起图片，点击折叠栏按需展开或收起。',
                options: [
                    { label: '正常', value: 'normal' },
                    { label: '模糊', value: 'blur' },
                    { label: '折叠', value: 'collapse' },
                ],
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
                    '原始格式保留完整像素与 EXIF 绘图参数信息；WebP 格式可明显减少浏览器本地存储占用。',
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
    public readonly title = '插件设置';

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
            cancelOnSwipe: s.cancelOnSwipe ?? true,
            promptStartTag: s.promptStartTag || 'image###',
            promptEndTag: s.promptEndTag || '###',
            autoGenerate: s.autoGenerate ?? false,
            hideButtonOnDone: floorButton?.hideOnDone ?? false,
            imageActionPanelEnabled: imageActionPanel?.enabled ?? true,
            lightboxEnabled: lightbox?.enabled ?? true,
            cleanPrompt: s.cleanPrompt ?? true,
            cleanPromptPunctuation: s.cleanPromptPunctuation ?? true,
            normalizeChinesePunctuation: Boolean(s.normalizeChinesePunctuation),
            thinkingDisplayMode: (s.thinkingDisplayMode || 'show') as ThinkingDisplayMode,
            cleanHistoryThinking: Boolean(s.cleanHistoryThinking),
            cleanHistoryMarkup: Boolean(s.cleanHistoryMarkup),
            align: (img?.align || 'center') as GeneralFormModel['align'],
            objectFit: (img?.objectFit || 'contain') as GeneralFormModel['objectFit'],
            maxWidthPct: img?.maxWidthPct ?? 100,
            maxHeight: img?.maxHeight ?? 480,
            rounded: img?.rounded ?? true,
            displayMode: (img?.displayMode || 'normal') as ImageDisplayMode,
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
            case 'cancelOnSwipe':
                this.bridge.set('cancelOnSwipe', Boolean(val));
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
            case 'cleanPromptPunctuation':
                this.bridge.set('cleanPromptPunctuation', Boolean(val));
                break;
            case 'normalizeChinesePunctuation':
                this.bridge.set('normalizeChinesePunctuation', Boolean(val));
                break;
            case 'thinkingDisplayMode':
                this.bridge.set('thinkingDisplayMode', val as ThinkingDisplayMode);
                hostRegexService.syncToHost({ reloadChatOnDisplayChange: true });
                break;
            case 'cleanHistoryThinking':
                this.bridge.set('cleanHistoryThinking', Boolean(val));
                hostRegexService.syncToHost();
                break;
            case 'cleanHistoryMarkup':
                this.bridge.set('cleanHistoryMarkup', Boolean(val));
                hostRegexService.syncToHost();
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
            case 'displayMode':
                this.updateImageDisplay({
                    displayMode: val as ImageDisplayMode,
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
        displayMode?: ImageDisplayMode;
    }): void {
        const current = this.bridge.get('ui')?.imageDisplay ?? {
            align: 'center' as const,
            objectFit: 'contain' as const,
            maxWidthPct: 100,
            maxHeight: 480,
            rounded: true,
            displayMode: 'normal' as const,
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
        const hostRuntime = detectHostRuntime();
        const cards = GENERAL_CARDS_SCHEMA.map((card) => {
            if (card.id !== 'general-basic') {
                return card;
            }
            return {
                ...card,
                fields: card.fields.map((field) =>
                    field.key === 'transport'
                        ? { ...field, tooltip: getTransportModeTooltip(hostRuntime) }
                        : field
                ),
            };
        });
        return (
            <SchemaForm
                cards={cards}
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
