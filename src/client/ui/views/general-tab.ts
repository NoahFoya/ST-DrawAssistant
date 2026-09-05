/**
 * @module ui/views/general-tab
 * @description 常规主要设置面板视图 (GeneralTabView)
 */

import {
    DrawAssistantSettings,
    ConfigStore
} from '../../core';
import { FormRenderer, SectionCardSchema } from '../controls';
import { BaseTabView } from '../foundation/tab-view';

/**
 * 通用主要设置面板视图
 */
export class GeneralTabView extends BaseTabView {
    private readonly _renderer: FormRenderer<DrawAssistantSettings>;

    constructor(store: ConfigStore) {
        super('da-general-tab');

        this._renderer = new FormRenderer<DrawAssistantSettings>(store);
        this._disposables.add(this._renderer);

        this._root.appendChild(this._buildEngineCard());
        this._root.appendChild(this._buildInteractionCard());
        this._root.appendChild(this._buildStorageCard());
    }

    /** 卡片 1：基础设置 */
    private _buildEngineCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '基础设置',
            description: '配置插件运行状态、生图引擎与网络连接参数',
            rows: [
                { key: 'enabled', type: 'toggle', label: '启用插件' },
                {
                    key: 'activeProvider',
                    type: 'select',
                    label: '生图引擎',
                    options: [
                        { label: 'ComfyUI (本地节点图)', value: 'comfyui' },
                        { label: 'SD-WebUI / Forge', value: 'sdwebui' },
                        { label: 'NovelAI (动漫与二次元)', value: 'novelai' },
                        { label: '云端生图 (OpenAI / Grok / Gemini)', value: 'cloud' }
                    ]
                },
                {
                    key: 'requestMode',
                    type: 'select',
                    label: '请求模式',
                    helpTooltip: '【浏览器直连】由浏览器前端直接发起请求；【酒馆代理】由酒馆服务端网关转发，可解决跨域 (CORS) 与混合内容 (Mixed Content) 拦截。',
                    options: [
                        { label: '浏览器直连', value: 'browser' },
                        { label: '酒馆代理', value: 'server' }
                    ]
                },
                {
                    key: 'taskTimeoutMs',
                    type: 'number',
                    label: '生图任务超时限制',
                    helpTooltip: '单次生图任务在后端的最大等待时间（秒，包含排队与采样计算），超时将自动取消并释放队列。',
                    min: 10,
                    max: 1800,
                    step: 5,
                    unit: 's',
                    fromStore: (v) => Math.round(Number(v ?? 180000) / 1000),
                    toStore: (sec) => sec * 1000
                },
                {
                    key: 'maxConcurrentTasks',
                    type: 'number',
                    label: '最大并发生图数量',
                    helpTooltip: '允许同时向后端引擎提交的最大并发任务数量。',
                    min: 1,
                    max: 8,
                    step: 1,
                    unit: '任务'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    /** 卡片 2：交互设置 */
    private _buildInteractionCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '交互设置',
            description: '配置会话指令触发规则与图片交互行为',
            rows: [
                {
                    key: 'placeholderStart',
                    type: 'input',
                    label: '指令起始标记',
                    helpTooltip: '识别触发绘图的起始标签，例如：image###正向提示词 | 负向提示词###',
                    placeholder: 'image###'
                },
                {
                    key: 'placeholderEnd',
                    type: 'input',
                    label: '指令结束标记',
                    helpTooltip: '识别触发绘图的闭合标签，默认使用 ### 作为闭合。',
                    placeholder: '###'
                },
                {
                    key: 'autoGenerate',
                    type: 'toggle',
                    label: '收到角色消息时自动生图',
                    helpTooltip: '当 AI 生成包含绘图指令的内容时，自动提交生图任务。'
                },
                {
                    key: 'cleanExtraSpacesAndLines',
                    type: 'toggle',
                    label: '自动精简提示词空行与多余空格',
                    helpTooltip: '在组装提示词并发送给引擎前，自动去除多余的首尾空格与连续空行。'
                },
                {
                    key: 'hideButtonOnDone',
                    type: 'toggle',
                    label: '出图完成后隐藏生成按钮',
                    helpTooltip: '单条消息下的图片生成完成后，自动隐藏消息底部的生成按钮仅保留图片。'
                },
                {
                    key: 'lightboxEnabled',
                    type: 'toggle',
                    label: '点击图片全屏灯箱预览',
                    helpTooltip: '开启后点击聊天中的图片可进入全屏灯箱大图预览。'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }

    /** 卡片 3：本地存储与容量控制 */
    private _buildStorageCard(): HTMLElement {
        const schema: SectionCardSchema<DrawAssistantSettings> = {
            title: '本地存储与容量控制',
            description: '配置图片存储策略、哈希去重与自动清理周期',
            rows: [
                {
                    key: 'storageStrategy',
                    type: 'select',
                    label: '存储方案',
                    helpTooltip: '【分离存储】原图保存至 IndexedDB 本地数据库，聊天记录轻量；【内嵌存储】原图以 Base64 内嵌聊天记录中；【服务端存储】保存到酒馆插件服务端。',
                    options: [
                        { label: '分离存储 (推荐，高性能本地数据库)', value: 'split' },
                        { label: '内嵌存储 (聊天记录随身携带)', value: 'embedded' },
                        { label: '服务端存储 (服务端文件持久化)', value: 'server' }
                    ]
                },
                {
                    key: 'enableThumbnail',
                    type: 'toggle',
                    label: '自动生成 256x256 轻量缩略图',
                    helpTooltip: '出图后自动在后台 OffscreenCanvas 生成压缩缩略图，大幅加速历史图库与画廊滚动渲染。'
                },
                {
                    key: 'deduplicateHash',
                    type: 'toggle',
                    label: 'SHA-256 哈希二进制去重',
                    helpTooltip: '避免重复存入相同图片，节约本地磁盘空间。'
                },
                {
                    key: 'maxStoredImages',
                    type: 'number',
                    label: '本地最大图片保存数量',
                    helpTooltip: '超出此上限时将自动清理最久未访问的未收藏图片。设为 0 表示不限制。',
                    min: 0,
                    max: 10000,
                    step: 50,
                    unit: '张'
                },
                {
                    key: 'imageRetentionDays',
                    type: 'number',
                    label: '图片自动保留天数',
                    helpTooltip: '超过指定天数的未收藏图片将自动清理。设为 0 表示永久保存。',
                    min: 0,
                    max: 365,
                    step: 1,
                    unit: '天'
                }
            ]
        };
        return this._renderer.renderCard(schema);
    }
}
