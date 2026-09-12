/**
 * 通用设置面板视图。
 * 负责基础设置、交互设置、图片显示、存储设置与扩展功能卡片的装配与表单渲染。
 */

import { DrawAssistantSettings } from '../../types';
import { SettingsStore } from '../../state';
import { FormRenderer, SectionCardSchema } from '../components';

import { BaseTabView } from '../foundation';

/**
 * 通用设置面板视图
 */
export class GeneralTabView extends BaseTabView {
    private readonly _renderer: FormRenderer<DrawAssistantSettings>;

    constructor(
        store: SettingsStore
    ) {
        super();

        this._renderer = new FormRenderer<DrawAssistantSettings>(store);
        this._disposables.add(this._renderer);

        this._root.appendChild(this._buildEngineCard());
        this._root.appendChild(this._buildInteractionCard());
        this._root.appendChild(this._buildDisplayCard());
        this._root.appendChild(this._buildStorageCard());
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
                    label: '显示气泡帮助提示'
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
                    label: '生图提取起始标记',
                    helpTooltip: '用于从 AI 回复中截取提示词。支持在标记包裹的内容中使用竖线“|”分隔正向与反向提示词，例如：image### 1girl, cute | bad hands ###',
                    placeholder: 'image###',
                    align: 'center',
                    variant: 'short'
                },
                {
                    key: 'placeholderEnd',
                    type: 'input',
                    label: '生图提取结束标记',
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
                    label: '开启图片圆角'
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
                    key: 'saveToServer',
                    type: 'toggle',
                    label: '保存至酒馆服务器',
                    helpTooltip: '（可选叠加存储）将生成的图片上传并保存至 SillyTavern 服务端静态目录，便于在多设备或终端间共享访问。'
                },
                {
                    key: 'embedToBase64',
                    type: 'toggle',
                    label: '内嵌至聊天记录',
                    helpTooltip: '（可选叠加存储）将图片以 Base64 编码直接嵌入聊天记录。适合导出分享会话，但图片较多时会导致聊天记录文件体积明显变大。'
                },
                {
                    key: 'maxStoredImages',
                    type: 'select',
                    label: '历史图片保留上限',
                    helpTooltip: '画廊基础存储 (IndexedDB) 最多保存的图片数量。超出上限后自动清理较早且未收藏的图片；已收藏的图片不会被清理。',
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
}


