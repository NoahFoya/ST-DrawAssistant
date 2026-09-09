/**
 * 通用设置面板视图。
 * 负责基础设置、交互设置、图片显示、存储设置与扩展功能卡片的装配与表单渲染。
 */

import { DrawAssistantSettings } from '../../types';
import { SettingsStore } from '../../state';
import { FormRenderer, SectionCardSchema, createToggle } from '../components';
import { BaseTabView } from '../foundation';

/**
 * 通用设置面板视图
 */
export class GeneralTabView extends BaseTabView {
    private readonly _renderer: FormRenderer<DrawAssistantSettings>;

    constructor(
        private readonly _store: SettingsStore
    ) {
        super('da-general-tab');

        this._renderer = new FormRenderer<DrawAssistantSettings>(_store);
        this._disposables.add(this._renderer);

        this._root.appendChild(this._buildEngineCard());
        this._root.appendChild(this._buildInteractionCard());
        this._root.appendChild(this._buildDisplayCard());
        this._root.appendChild(this._buildStorageCard());

        // 扩展功能卡片：仅当 store.extensions 存在已注册项时展示
        const extensionsCard = this._buildExtensionsCard();
        if (extensionsCard) {
            this._root.appendChild(extensionsCard);
        }
    }

    /** 卡片 1：基础设置 */
    private _buildEngineCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '基础设置',
            rows: [
                {
                    key: 'enabled',
                    type: 'toggle',
                    label: '启用插件'
                },
                {
                    key: 'showHelp',
                    type: 'toggle',
                    label: '显示提示说明'
                },
                {
                    key: 'activeProvider',
                    type: 'select',
                    label: '默认生图引擎',
                    options: [
                        { label: 'ComfyUI', value: 'comfyui' },
                        { label: 'SD-WebUI / Forge', value: 'sdwebui' },
                        { label: 'NovelAI', value: 'novelai' },
                        { label: 'OpenAI 兼容', value: 'openai' }
                    ]
                },
                {
                    key: 'taskTimeoutMs',
                    type: 'number',
                    label: '请求超时时间',
                    helpTooltip: '单次生图请求的最大等待秒数。若常用高清修复或排队耗时较长，建议适当调大以防任务过早超时。',
                    min: 10,
                    max: 1800,
                    step: 5,
                    unit: '秒',
                    fromStore: (v) => Math.round(Number(v ?? 180000) / 1000),
                    toStore: (sec) => sec * 1000
                },
                {
                    key: 'maxConcurrentTasks',
                    type: 'number',
                    label: '最大并发任务数',
                    helpTooltip: '允许同时提交至后端的生图数量。本地单显卡生图建议保持为 1，避免显存溢出导致报错。',
                    min: 1,
                    max: 8,
                    step: 1,
                    unit: '个'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    /** 卡片 2：交互设置 */
    private _buildInteractionCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '交互设置',
            rows: [
                {
                    key: 'placeholderStart',
                    type: 'input',
                    label: '生图指令前缀',
                    helpTooltip: '用于从 AI 回复中截取提示词。支持在前后缀包裹的内容中使用竖线“|”分隔正向与反向提示词，例如：image### 1girl, cute | bad hands ###',
                    placeholder: 'image###',
                    align: 'center',
                    variant: 'short'
                },
                {
                    key: 'placeholderEnd',
                    type: 'input',
                    label: '生图指令后缀',
                    placeholder: '###',
                    align: 'center',
                    variant: 'short'
                },
                {
                    key: 'autoGenerate',
                    type: 'toggle',
                    label: 'AI 回复后自动生图',
                    helpTooltip: '开启后只要检测到消息中包含有效生图指令，立即自动发起生图；关闭后将仅在消息下方提供生图按钮，由您手动点击触发。'
                },
                {
                    key: 'hideButtonOnDone',
                    type: 'toggle',
                    label: '出图成功后隐藏生成按钮'
                },
                {
                    key: 'enableActionPanel',
                    type: 'toggle',
                    label: '启用图片快捷操作栏',
                    helpTooltip: '鼠标悬停于生成图右上角或长按图片时显示操作条，支持快捷重绘、复制提示词与查看生成参数。'
                },
                {
                    key: 'imagePreviewEnabled',
                    type: 'toggle',
                    label: '点击图片查看全图'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    /** 卡片 3：图片显示 */
    private _buildDisplayCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '图片显示',
            rows: [
                {
                    keyPath: ['imageDisplay', 'align'] as const,
                    type: 'select',
                    label: '图片对齐方式',
                    options: [
                        { label: '居中对齐', value: 'center' },
                        { label: '靠左对齐', value: 'left' },
                        { label: '靠右对齐', value: 'right' }
                    ]
                },
                {
                    keyPath: ['imageDisplay', 'objectFit'] as const,
                    type: 'select',
                    label: '图片填充模式',
                    helpTooltip: '控制图片在指定区域内的适配方式。推荐“完整显示 (不裁切)”，保持原始比例且不裁切边缘。',
                    options: [
                        { label: '完整显示 (不裁切)', value: 'contain' },
                        { label: '裁剪填满 (居中裁剪)', value: 'cover' },
                        { label: '拉伸铺满', value: 'fill' },
                        { label: '原始尺寸', value: 'none' }
                    ]
                },
                {
                    keyPath: ['imageDisplay', 'maxWidthPct'] as const,
                    type: 'number',
                    label: '最大显示宽度',
                    min: 10,
                    max: 100,
                    step: 5,
                    unit: '%'
                },
                {
                    keyPath: ['imageDisplay', 'maxHeight'] as const,
                    type: 'number',
                    label: '最大显示高度',
                    min: 0,
                    max: 2000,
                    step: 20,
                    unit: 'px',
                    helpTooltip: '限制单张图片在消息内的最大像素高度。设为 0 表示不限制高度，按原始比例自适应。'
                },
                {
                    keyPath: ['imageDisplay', 'rounded'] as const,
                    type: 'toggle',
                    label: '图片圆角'
                },
                {
                    keyPath: ['imageDisplay', 'collapsed'] as const,
                    type: 'toggle',
                    label: '默认折叠图片',
                    helpTooltip: '生成后默认折叠为小条，点击可展开大图，避免大图影响聊天阅读体验。'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    /** 卡片 4：存储设置 */
    private _buildStorageCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '存储设置',
            rows: [
                {
                    key: 'saveToIndexedDB',
                    type: 'toggle',
                    label: '保存至画廊',
                    helpTooltip: '（推荐开启）保存在当前浏览器的本地数据库 (IndexedDB) 中，供画廊浏览，不增加聊天记录体积。'
                },
                {
                    key: 'embedToBase64',
                    type: 'toggle',
                    label: '内嵌至聊天记录',
                    helpTooltip: '将图片以 Base64 编码嵌入聊天记录。适合导出分享会话，但图片较多时会导致聊天记录文件体积明显变大。'
                },
                {
                    key: 'maxStoredImages',
                    type: 'select',
                    label: '历史图片保留上限',
                    helpTooltip: '画廊最多保存的图片数量。超出上限后自动清理较早且未收藏的图片；已收藏的图片不会被清理。',
                    options: [
                        { label: '100 张', value: '100' },
                        { label: '300 张', value: '300' },
                        { label: '500 张', value: '500' },
                        { label: '1000 张', value: '1000' },
                        { label: '不限制', value: '0' }
                    ],
                    fromStore: (v) => String(v ?? 500),
                    toStore: (v) => Number(v)
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    /**
     * 卡片 5：扩展功能。
     * 仅当 store.extensions 存在已注册扩展项时渲染对应开关；
     * 若当前无任何注册扩展则返回 null，避免在界面渲染空卡片。
     */
    private _buildExtensionsCard(): HTMLElement | null {
        const extensions = this._store.get('extensions') || {};
        const extEntries = Object.entries(extensions);

        if (extEntries.length === 0) {
            return null;
        }

        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '扩展功能',
            rows: extEntries.map(([extId]) => ({
                type: 'custom' as const,
                label: extId,
                renderCustom: () => {
                    const extState = this._store.get('extensions')?.[extId];
                    const toggle = createToggle({
                        value: extState?.enabled !== false,
                        onChange: (val: boolean) => {
                            const current = this._store.get('extensions') || {};
                            this._store.set('extensions', {
                                ...current,
                                [extId]: { ...current[extId], enabled: val }
                            });
                        }
                    });
                    this._disposables.add(
                        this._store.subscribeKey('extensions', (exts) => {
                            toggle.setValue(exts?.[extId]?.enabled !== false);
                        })
                    );
                    this._disposables.add(toggle);
                    return toggle;
                }
            }))
        };
        return this._renderer.renderCard(schema);
    }
}


