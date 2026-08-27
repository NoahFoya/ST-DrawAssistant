/**
 * @module ui/views/general-tab
 * @description 常规主要设置面板视图 (GeneralTabView)
 *
 * 架构范式：继承 BaseTabView，实现 ITabView 接口
 * - 每张卡片独立为私有方法，职责清晰
 * - dispose() 由 SettingsModal.switchTab 通过 render 返回值统一调用
 * - 扩展卡片通过 subscribeKey 精确订阅，无 refreshTab()
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    IExtensionRegistry,
    DEFAULT_PLACEHOLDER_START,
    DEFAULT_PLACEHOLDER_END,
    DEFAULT_TASK_TIMEOUT_MS,
    TASK_TIMEOUT_LIMITS,
    CONCURRENCY_LIMITS,
    PROVIDERS,
    REQUEST_MODES
} from '../../core';
import { FormRenderer, SectionCardSchema, createToggle } from '../controls';
import { BaseTabView } from '../foundation/tab-view';

/**
 * 通用主要设置面板视图
 *
 * 继承 BaseTabView，由 SettingsModal.switchTab 统一管理生命周期。
 * render 回调返回 view 实例本身（IDisposable），无需 DOM 补丁。
 */
export class GeneralTabView extends BaseTabView {
    private readonly _renderer: FormRenderer<DrawAssistantSettings>;

    constructor(
        private readonly _store: ObservableStore<DrawAssistantSettings>,
        private readonly _extensionRegistry?: IExtensionRegistry
    ) {
        // BaseTabView 负责创建 _root、_disposables、element getter
        super('da-general-tab');

        this._renderer = new FormRenderer<DrawAssistantSettings>(_store);
        this._disposables.add(this._renderer);

        // 按顺序装配各功能卡片
        this._root.appendChild(this._buildEngineCard());
        this._root.appendChild(this._buildTriggerCard());
        this._root.appendChild(this._buildDisplayCard());
        this._root.appendChild(this._buildStorageCard());
        this._root.appendChild(this._buildExtensionsCard());
    }

    // ── 卡片 1：生图引擎与基础设置 ─────────────────────────────────────────
    private _buildEngineCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '生图引擎与基础设置',
            description: '配置插件全局开关、生图后端服务、连接请求模式与并发控制',
            rows: [
                { key: 'enabled', type: 'toggle', label: '启用插件' },
                {
                    key: 'provider',
                    type: 'select',
                    label: '生图引擎',
                    options: [
                        { label: 'ComfyUI', value: PROVIDERS.COMFYUI },
                        { label: 'SD-WebUI', value: PROVIDERS.SDWEBUI },
                        { label: 'NovelAI', value: PROVIDERS.NOVELAI },
                        { label: 'OpenAI / Grok / Banana', value: PROVIDERS.OPENAI }
                    ]
                },
                {
                    key: 'requestMode',
                    type: 'select',
                    label: '请求模式',
                    helpTooltip: '【浏览器直连】由浏览器前端直接发起请求；【酒馆代理】由酒馆服务端转发，可避免跨域拦截。',
                    options: [
                        { label: '浏览器直连', value: REQUEST_MODES.BROWSER },
                        { label: '酒馆代理', value: REQUEST_MODES.SERVER }
                    ]
                },
                {
                    key: 'taskTimeout',
                    type: 'number',
                    label: '生图任务超时限制',
                    helpTooltip: '单次生图任务在后端的最大等待时间（秒，包含排队与采样计算），超时将自动取消并释放队列。底层网络通信超时已默认设为 5 秒。',
                    min: TASK_TIMEOUT_LIMITS.MIN_SEC,
                    max: TASK_TIMEOUT_LIMITS.MAX_SEC,
                    step: 5,
                    unit: 's',
                    fromStore: (v) => Math.round((Number(v ?? DEFAULT_TASK_TIMEOUT_MS)) / 1000),
                    toStore: (sec) => sec * 1000
                },
                {
                    key: 'maxConcurrent',
                    type: 'number',
                    label: '最大并发生图数量',
                    helpTooltip: '允许同时向引擎提交的最大并发任务数量。',
                    min: CONCURRENCY_LIMITS.MIN,
                    max: CONCURRENCY_LIMITS.MAX,
                    step: 1,
                    unit: '任务'
                },
                {
                    key: 'showHelp',
                    type: 'toggle',
                    label: '显示帮助说明图标',
                    helpTooltip: '开启后在各项设置旁显示问号提示图标，悬浮可查看详细操作说明。'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    // ── 卡片 2：会话指令与生图触发 ─────────────────────────────────────────
    private _buildTriggerCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '会话指令与生图触发',
            description: '配置聊天中触发绘图的起止标志符、自动生图与交互触发行为',
            rows: [
                {
                    key: 'placeholderStart',
                    type: 'input',
                    label: '指令起始标记',
                    helpTooltip: '识别触发绘图的起始标签，例如：image###正向提示词 | 负向提示词###',
                    placeholder: DEFAULT_PLACEHOLDER_START
                },
                {
                    key: 'placeholderEnd',
                    type: 'input',
                    label: '指令结束标记',
                    helpTooltip: '识别触发绘图的闭合标签，默认使用 ### 作为闭合。',
                    placeholder: DEFAULT_PLACEHOLDER_END
                },
                {
                    key: 'autoGenerate',
                    type: 'toggle',
                    label: 'AI 回复时自动生图',
                    helpTooltip: '当 AI 生成包含绘图指令的内容时，自动提交生图任务。'
                },
                {
                    key: 'cleanExtraSpacesAndLines',
                    type: 'toggle',
                    label: '自动精简提示词空行与空格',
                    helpTooltip: '在组装提示词并发送给引擎前，自动去除多余的首尾空格与连续空行。'
                },
                {
                    key: 'hideButtonOnDone',
                    type: 'toggle',
                    label: '出图完成后隐藏生成按钮',
                    helpTooltip: '单条消息下的全部图片生成完成后，自动隐藏消息底部的生成按钮。'
                },
                {
                    key: 'enableActionPanel',
                    type: 'toggle',
                    label: '图片长按/右键操作菜单',
                    helpTooltip: '开启后在聊天图片上长按或右键可唤出快捷操作菜单；关闭后仅保留单击查看大图。'
                },
                {
                    key: 'lightboxEnabled',
                    type: 'toggle',
                    label: '点击图片全屏预览',
                    helpTooltip: '开启后点击聊天中的图片可进入全屏灯箱预览大图。'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    // ── 卡片 3：消息内图片显示样式 ─────────────────────────────────────────
    private _buildDisplayCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '消息内图片显示样式',
            description: '设置聊天消息气泡中图片的对齐方向、裁剪适应与尺寸限制',
            rows: [
                {
                    keyPath: ['imageDisplay', 'align'],
                    type: 'select',
                    label: '图片水平对齐',
                    options: [
                        { label: '居中', value: 'center' },
                        { label: '左对齐', value: 'left' },
                        { label: '右对齐', value: 'right' }
                    ]
                },
                {
                    keyPath: ['imageDisplay', 'objectFit'],
                    type: 'select',
                    label: '图片填充模式',
                    options: [
                        { label: '等比缩放适应', value: 'contain' },
                        { label: '裁剪居中填充', value: 'cover' },
                        { label: '拉伸铺满', value: 'fill' },
                        { label: '原始尺寸', value: 'none' }
                    ]
                },
                {
                    keyPath: ['imageDisplay', 'maxHeight'],
                    type: 'number',
                    label: '最大显示高度',
                    min: 100, max: 1200, step: 20, unit: 'px'
                },
                {
                    keyPath: ['imageDisplay', 'maxWidthPct'],
                    type: 'number',
                    label: '最大显示宽度占比',
                    min: 10, max: 100, step: 5, unit: '%'
                },
                { keyPath: ['imageDisplay', 'rounded'], type: 'toggle', label: '图片圆角显示' },
                {
                    keyPath: ['imageDisplay', 'collapsed'],
                    type: 'toggle',
                    label: '生图默认折叠显示',
                    helpTooltip: '生成图片后默认以折叠预览条呈现，点击可展开查看完整图片。'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    // ── 卡片 4：图库存储策略与自动清理 ─────────────────────────────────────
    private _buildStorageCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '图库存储与清理策略',
            description: '管理图片缓存格式、压缩画质、保留上限与自动清理规则',
            rows: [
                {
                    key: 'imageFormat',
                    type: 'select',
                    label: '图片存储格式',
                    helpTooltip: 'WebP 体积小且画质高，推荐选用；PNG 保留无损画质；JPEG 通用兼容。',
                    options: [
                        { label: 'PNG (无损画质)', value: 'original' },
                        { label: 'WebP (体积小推荐)', value: 'webp' },
                        { label: 'JPEG (通用兼容)', value: 'jpeg' }
                    ]
                },
                {
                    key: 'imageQuality',
                    type: 'number',
                    label: '压缩画质',
                    helpTooltip: '仅对 WebP / JPEG 格式生效 (50% ~ 100%)，推荐 85%。当选择 PNG 格式时自动禁用。',
                    min: 50, max: 100, step: 5, unit: '%',
                    disabledWhen: (state) => state.imageFormat === 'original',
                    fromStore: (v) => Math.round((Number(v ?? 0.85)) * 100),
                    toStore: (pct) => pct / 100
                },
                {
                    key: 'maxStoredImages',
                    type: 'select',
                    label: '历史图片保留上限',
                    helpTooltip: '超出保留上限时将自动清理最旧的非收藏图片。',
                    options: [
                        { label: '100 张', value: '100' },
                        { label: '300 张', value: '300' },
                        { label: '500 张', value: '500' },
                        { label: '1000 张', value: '1000' },
                        { label: '无限制', value: '0' }
                    ],
                    fromStore: (v) => String(v ?? 500),
                    toStore: (valStr) => parseInt(valStr, 10) || 0
                },
                {
                    key: 'imageRetentionDays',
                    type: 'select',
                    label: '历史图片保留周期',
                    helpTooltip: '按生成时间自动清理指定天数前的非收藏图片；已标星收藏的图片受到永久保护。',
                    options: [
                        { label: '永久保留', value: '0' },
                        { label: '保留 7 天', value: '7' },
                        { label: '保留 15 天', value: '15' },
                        { label: '保留 30 天', value: '30' },
                        { label: '保留 90 天', value: '90' }
                    ],
                    fromStore: (v) => String(v ?? 0),
                    toStore: (valStr) => parseInt(valStr, 10) || 0
                },
                {
                    key: 'autoCleanupOnChatDelete',
                    type: 'toggle',
                    label: '删除会话时同步删除图片',
                    helpTooltip: '在酒馆中删除聊天记录时，自动清理本地数据库中属于该会话的非收藏图片。'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    // ── 卡片 5：扩展插件 ──────────────────────────────────────────────────
    /**
     * 每个扩展项使用 subscribeKey('extensions') 精确订阅，
     * 无需 refreshTab() 全量刷新。订阅由 _disposables 统一管理。
     */
    private _buildExtensionsCard(): HTMLElement {
        const store = this._store;
        const registeredExtensions = this._extensionRegistry ? this._extensionRegistry.getAll() : [];

        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '扩展插件',
            description: '管理扩展功能与高级组件的启用状态；未开启的功能将自动隐藏其导航界面',
            rows: registeredExtensions.length > 0
                ? registeredExtensions.map((ext) => ({
                    type: 'custom' as const,
                    label: ext.name,
                    helpTooltip: ext.description || `启用或停用【${ext.name}】扩展组件。`,
                    renderCustom: () => {
                        const extState = store.get('extensions')?.[ext.id];
                        const toggle = createToggle({
                            value: extState?.enabled !== false,
                            onChange: (val: boolean) => {
                                const currentExts = store.get('extensions') || {};
                                store.set('extensions', {
                                    ...currentExts,
                                    [ext.id]: {
                                        enabled: val,
                                        config: currentExts[ext.id]?.config
                                    }
                                });
                            }
                        });

                        // 精确订阅 extensions 键，无需全量 refreshTab()
                        this._disposables.add(
                            store.subscribeKey('extensions', (exts) => {
                                toggle.setValue(exts?.[ext.id]?.enabled !== false);
                            })
                        );
                        this._disposables.add(toggle);

                        return toggle;
                    }
                }))
                : [
                    {
                        type: 'custom' as const,
                        label: '扩展组件列表',
                        renderCustom: () => {
                            const tip = document.createElement('span');
                            tip.className = 'da-text-muted';
                            tip.textContent = '暂无已安装的独立扩展插件';
                            return tip;
                        }
                    }
                ]
        };
        return this._renderer.renderCard(schema);
    }
}

