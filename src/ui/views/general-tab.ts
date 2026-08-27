/**
 * @module ui/views/general-tab
 * @description 常规主要设置面板视图 (主要设置 Tab) - 声明式 Schema 架构重构版
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { FormRenderer, SectionCardSchema } from '../controls';
import { renderStorageBar } from '../media';
import { FeedbackService } from '../feedback/feedback';
import { IndexedDBStorageAdapter } from '../../core/state/storage-adapter';
import { IDisposable } from '../../core/foundation/disposable';
import { IExtensionRegistry } from '../../core/registry/extension-registry';
import {
    DEFAULT_PLACEHOLDER_START,
    DEFAULT_PLACEHOLDER_END,
    DEFAULT_TIMEOUT_MS,
    TIMEOUT_LIMITS,
    CONCURRENCY_LIMITS,
    PROVIDERS,
    REQUEST_MODES
} from '../../core/constants';

/**
 * 构建并渲染通用主要设置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @param _extensionRegistry 扩展注册中心
 * @returns 包含生命周期清理能力的设置面板 DOM 根节点
 */
export function createGeneralTabView(
    store: ObservableStore<DrawAssistantSettings>,
    _extensionRegistry?: IExtensionRegistry
): HTMLElement & IDisposable {
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-general-tab';

    const renderer = new FormRenderer<DrawAssistantSettings>(store);

    // ── 1. 运行模式与请求控制卡片 ────────────────────────────────────────────
    const cardModeSchema: SectionCardSchema<DrawAssistantSettings> = {
        title: '运行模式与请求控制',
        description: '配置插件响应状态、生图引擎、请求模式及并发超时门限',
        rows: [
            {
                key: 'enabled',
                type: 'toggle',
                label: '启用插件',
                helpTooltip: '插件总开关。开启后自动解析会话中的绘图指令并提交生图。'
            },
            {
                key: 'showHelp',
                type: 'toggle',
                label: '显示帮助说明图标',
                helpTooltip: '控制是否在各个设置项标题旁显示详细说明帮助按钮。'
            },
            {
                key: 'provider',
                type: 'select',
                label: '生图引擎',
                helpTooltip: '选择生图后端。支持 ComfyUI 工作流、SD-WebUI、NovelAI 及 OpenAI 兼容服务。',
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
                helpTooltip: '【浏览器直连】前端直连引擎服务；【酒馆代理】由酒馆服务端转发，避开跨域拦截。',
                options: [
                    { label: '浏览器直连', value: REQUEST_MODES.BROWSER },
                    { label: '酒馆代理', value: REQUEST_MODES.SERVER }
                ]
            },
            {
                key: 'requestTimeout',
                type: 'number',
                label: '请求超时时间',
                helpTooltip: '单次生图请求的最大等待超时门限（秒）。',
                min: TIMEOUT_LIMITS.MIN_SEC,
                max: TIMEOUT_LIMITS.MAX_SEC,
                step: 5,
                unit: 's',
                fromStore: (v) => Math.round((Number(v ?? DEFAULT_TIMEOUT_MS)) / 1000),
                toStore: (sec) => sec * 1000
            },
            {
                key: 'maxConcurrent',
                type: 'number',
                label: '最大并发生图数',
                helpTooltip: '允许同时提交至生图引擎的最大并发任务数。',
                min: CONCURRENCY_LIMITS.MIN,
                max: CONCURRENCY_LIMITS.MAX,
                step: 1,
                unit: '任务'
            }
        ]
    };
    container.appendChild(renderer.renderCard(cardModeSchema));


    // ── 2. 楼层生图触发与交互行为卡片 ──────────────────────────────────────────
    const cardFloorSchema: SectionCardSchema<DrawAssistantSettings> = {
        title: '楼层生图触发与交互行为',
        description: '配置会话中的生图标志符、自动生图机制与大图全屏预览',
        rows: [
            {
                key: 'placeholderStart',
                type: 'input',
                label: '绘图起始标志符',
                helpTooltip: '标识生图指令开始的特殊标记。范例：image###正向提示词 | 负向提示词###',
                placeholder: DEFAULT_PLACEHOLDER_START,
                fixedWidth: true
            },
            {
                key: 'placeholderEnd',
                type: 'input',
                label: '绘图结束标志符',
                helpTooltip: '标识生图指令结束的特殊标记。',
                placeholder: DEFAULT_PLACEHOLDER_END,
                fixedWidth: true
            },
            {
                key: 'enableActionPanel',
                type: 'toggle',
                label: '快捷操作面板 (长按/右键)',
                helpTooltip: '开启后在消息楼层图像上长按或右键可唤出快捷操作菜单；关闭后仅保留单击预览。'
            },
            {
                key: 'autoGenerate',
                type: 'toggle',
                label: 'AI回复后自动生图',
                helpTooltip: '当检测到 AI 生成的文本包含绘图指令时，自动触发任务提交与生图渲染。'
            },
            {
                key: 'lightboxEnabled',
                type: 'toggle',
                label: '大图全屏预览',
                helpTooltip: '开启后点击聊天窗口中的结果图可弹出沉浸式全屏 Lightbox 浮层。'
            },
            {
                key: 'cleanExtraSpacesAndLines',
                type: 'toggle',
                label: '自动清洗多余空格空行',
                helpTooltip: '自动过滤提示词中连续的多余空格、换行符及重复逗号。'
            },
            {
                key: 'autoCleanupOnChatDelete',
                type: 'toggle',
                label: '删除对话时清理关联图片',
                helpTooltip: '在酒馆删除会话记录文件时同步清理该对话引用的本地图库缓存。'
            }
        ]
    };
    container.appendChild(renderer.renderCard(cardFloorSchema));

    // ── 3. 图像展示样式与对齐排版卡片 ─────────────────────────────────────────
    const cardDisplaySchema: SectionCardSchema<DrawAssistantSettings> = {
        title: '图像展示样式与对齐排版',
        description: '定制聊天界面中生成图像的尺寸限制、排版对齐模式与圆角视觉风格',
        rows: [
            {
                keyPath: ['imageDisplay', 'align'],
                type: 'select',
                label: '楼层图像水平对齐方式',
                helpTooltip: '控制生成图片在消息楼层气泡中的水平对齐排列。',
                options: [
                    { label: '居中对齐 (Center)', value: 'center' },
                    { label: '居左对齐 (Left)', value: 'left' },
                    { label: '居右对齐 (Right)', value: 'right' }
                ]
            },
            {
                keyPath: ['imageDisplay', 'objectFit'],
                type: 'select',
                label: '图像缩放适应模式',
                helpTooltip: '控制图片在限定宽高内的裁剪与填充适应策略。',
                options: [
                    { label: '等比完整包含 (Contain)', value: 'contain' },
                    { label: '裁切填满容器 (Cover)', value: 'cover' },
                    { label: '拉伸填充 (Fill)', value: 'fill' },
                    { label: '原始尺寸 (None)', value: 'none' }
                ]
            },
            {
                keyPath: ['imageDisplay', 'maxHeight'],
                type: 'number',
                label: '最大展示高度限制',
                helpTooltip: '限制消息楼层图像的最大显示像素高度。',
                min: 100,
                max: 1200,
                step: 20,
                unit: 'px'
            },
            {
                keyPath: ['imageDisplay', 'maxWidthPct'],
                type: 'number',
                label: '最大展示宽度比例',
                helpTooltip: '限制消息楼层图像占聊天气泡的最大宽度百分比。',
                min: 10,
                max: 100,
                step: 5,
                unit: '%'
            },
            {
                keyPath: ['imageDisplay', 'rounded'],
                type: 'toggle',
                label: '图像圆角美化',
                helpTooltip: '为聊天楼层图像应用统一的圆角效果。'
            }
        ]
    };
    container.appendChild(renderer.renderCard(cardDisplaySchema));

    // ── 4. 数据持久化与存储管理卡片 ──────────────────────────────────────────
    const storageBarWrapper = document.createElement('div');
    storageBarWrapper.appendChild(renderStorageBar());

    const cardStorageSchema: SectionCardSchema<DrawAssistantSettings> = {
        title: '数据持久化与存储管理',
        description: '监控本地 IndexedDB 存储配额，管理聊天元数据写入与缓存清理',
        rows: [
            {
                type: 'custom',
                label: '本地数据库容量监控',
                helpTooltip: '实时监控 IndexedDB 占用的存储空间与配额占比。',
                renderCustom: () => storageBarWrapper
            },
            {
                key: 'imageFormat',
                type: 'select',
                label: '图像持久化存储格式',
                helpTooltip: 'WebP 体积小、加载快；PNG 保留原始画质；JPEG 通用兼容。',
                options: [
                    { label: '轻量 WebP (推荐)', value: 'webp' },
                    { label: '原始格式 (PNG)', value: 'original' },
                    { label: '标准 JPEG', value: 'jpeg' }
                ]
            },
            {
                key: 'imageQuality',
                type: 'number',
                label: '图像转码压缩画质',
                helpTooltip: '控制 WebP / JPEG 格式的压缩画质比率 (50% ~ 100%)。默认推荐 85%。',
                min: 50,
                max: 100,
                step: 5,
                unit: '%',
                fromStore: (v) => Math.round((Number(v ?? 0.85)) * 100),
                toStore: (pct) => pct / 100
            },
            {
                key: 'maxStoredImages',
                type: 'select',
                label: '本地图库最大保留上限',
                helpTooltip: '设置本地 IndexedDB 最多缓存的生成图片数量。超出上限时自动通过 LRU 淘汰最旧非收藏图片。',
                options: [
                    { label: '100 张', value: '100' },
                    { label: '300 张', value: '300' },
                    { label: '500 张 (推荐)', value: '500' },
                    { label: '1000 张', value: '1000' },
                    { label: '无限制 (仅受浏览器配额限制)', value: '0' }
                ],
                fromStore: (v) => String(v ?? 500),
                toStore: (valStr) => parseInt(valStr, 10) || 0
            },
            {
                key: 'persistToChat',
                type: 'toggle',
                label: '写入会话元数据',
                helpTooltip: '将图像 UUID 写入会话消息元数据中，确保跨会话重载时精准还原关联图片。'
            },
            {
                type: 'custom',
                label: '清空本地图库缓存',
                helpTooltip: '清空 IndexedDB 中缓存的所有生成图片及缩略图（不影响已写入酒馆元数据的记录）。',
                renderCustom: () => {
                    const clearBtn = document.createElement('button');
                    clearBtn.className = 'da-btn danger';
                    clearBtn.textContent = '清空本地图库缓存';
                    clearBtn.onclick = async () => {
                        const confirmed = await FeedbackService.confirm({
                            title: '清空图库缓存确认',
                            message: '确定要清空 IndexedDB 中缓存的所有生图记录与缩略图吗？此操作不可逆。',
                            confirmText: '确认清空',
                            isDangerous: true
                        });
                        if (confirmed) {
                            try {
                                const storage = new IndexedDBStorageAdapter();
                                await storage.init();
                                await storage.clear();
                                FeedbackService.toastSuccess('本地图库缓存已成功清空！');
                                storageBarWrapper.innerHTML = '';
                                storageBarWrapper.appendChild(renderStorageBar());
                            } catch (err: any) {
                                FeedbackService.toastError(`清理缓存失败: ${err?.message || err}`);
                            }
                        }
                    };
                    return clearBtn;
                }
            }
        ]
    };
    container.appendChild(renderer.renderCard(cardStorageSchema));

    // ── 5. 进阶/扩展功能管理卡片 ───────────────────────────────────────────────
    const cardExtSchema: SectionCardSchema<DrawAssistantSettings> = {
        title: '进阶/扩展功能管理',
        description: '集中管理扩展功能与高级组件的启用状态；未开启的功能将自动隐藏其导航界面',
        rows: [
            {
                type: 'custom',
                label: '角色与服装设定管理',
                helpTooltip: '开启后在侧边栏显示【角色管理】Tab，支持为特定角色卡/Chat ID 绑定专属生图方案及世界书占位符注入。关闭后自动隐藏该 Tab。',
                renderCustom: () => {
                    const labelWrapper = document.createElement('label');
                    labelWrapper.className = 'da-switch';

                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    const charExtState = store.get('extensions')?.['character-manager'];
                    input.checked = charExtState?.enabled !== false;

                    const slider = document.createElement('span');
                    slider.className = 'da-slider-round';

                    labelWrapper.appendChild(input);
                    labelWrapper.appendChild(slider);

                    input.addEventListener('change', () => {
                        const currentExts = store.get('extensions') || {};
                        store.set('extensions', {
                            ...currentExts,
                            'character-manager': {
                                enabled: input.checked,
                                config: currentExts['character-manager']?.config
                            }
                        });
                    });

                    const sub = store.subscribeKey('extensions', (exts) => {
                        input.checked = exts?.['character-manager']?.enabled !== false;
                    });
                    labelWrapper.addEventListener('remove', () => sub.dispose(), { once: true });

                    return labelWrapper;
                }
            }
        ]
    };
    container.appendChild(renderer.renderCard(cardExtSchema));

    container.dispose = () => {
        renderer.dispose();
    };

    return container;
}
