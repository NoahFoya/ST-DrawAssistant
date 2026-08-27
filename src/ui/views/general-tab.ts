/**
 * @module ui/views/general-tab
 * @description 常规生图设置面板视图 (基础生图参数、行为控制、图像显示与存储设置)
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings, ImageDisplayConfig } from '../../core/state/store-types';
import { ControlFactory, createFieldRow } from '../components/controls';
import { FeedbackService } from '../feedback-service';
import { IDisposable } from '../../core/foundation/disposable';
import { DB_NAME } from '../../core/constants';

/**
 * 构建并渲染通用常规设置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的设置面板 DOM 根节点
 */
export function createGeneralTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable {
    const controls = new ControlFactory();
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-general-tab';

    const settings = store.getState();

    // ── 1. 运行模式与请求控制卡片 ────────────────────────────────────────────
    const cardMode = controls.createCard(
        '运行模式与请求控制',
        (body) => {
            // 1.1 启用插件
            body.appendChild(
                controls.createToggle({
                    label: '启用插件',
                    helpTooltip: '插件全局总开关。开启后可自动解析 AI 楼层文本中的生图指令并驱动后端渲染。',
                    value: settings.enabled ?? true,
                    onChange: (val: boolean) => store.set('enabled', val)
                })
            );

            // 1.2 显示帮助图标
            body.appendChild(
                controls.createToggle({
                    label: '显示帮助图标',
                    helpTooltip: '控制是否在各个设置项标题旁显示 ❓ 详细说明帮助按钮。',
                    value: settings.showHelp ?? true,
                    onChange: (val: boolean) => store.set('showHelp', val)
                })
            );

            // 1.3 生图模式
            body.appendChild(
                controls.createSelect({
                    label: '生图模式',
                    helpTooltip: '选择生图后端引擎。支持 ComfyUI 工作流模式与 Stable Diffusion WebUI (A1111) 接口模式。',
                    value: settings.provider ?? 'comfyui',
                    items: [
                        { value: 'comfyui', label: 'ComfyUI' },
                        { value: 'sdwebui', label: 'SD-WebUI' }
                    ],
                    onChange: (val: string) => store.set('provider', val as any)
                })
            );

            // 1.4 请求模式
            body.appendChild(
                controls.createSelect({
                    label: '请求模式',
                    helpTooltip: '【浏览器直连】前端直接连接生图引擎服务；【酒馆代理】由酒馆 Node 服务端代理转发，避开跨域 (CORS) 拦截。',
                    value: settings.requestMode ?? 'browser',
                    items: [
                        { value: 'browser', label: '浏览器直连' },
                        { value: 'server', label: '酒馆代理' }
                    ],
                    onChange: (val: string) => store.set('requestMode', val as any)
                })
            );

            // 1.5 请求超时时间 (秒)
            body.appendChild(
                controls.createInput({
                    label: '请求超时时间 (秒)',
                    type: 'number',
                    value: String(Math.round((settings.requestTimeout ?? 120000) / 1000)),
                    onChange: (val: string) => {
                        const sec = parseInt(val, 10);
                        if (sec > 0) store.set('requestTimeout', sec * 1000);
                    }
                })
            );

            // 1.6 最大并发生图数
            body.appendChild(
                controls.createInput({
                    label: '最大并发生图数 (任务)',
                    type: 'number',
                    value: String(settings.maxConcurrent ?? 1),
                    onChange: (val: string) => {
                        const count = parseInt(val, 10);
                        if (count > 0) store.set('maxConcurrent', count);
                    }
                })
            );
        },
        '配置插件全局响应状态、帮助图标、生图模式、请求模式与并发超时门限'
    );

    // ── 2. 楼层生图触发与交互行为卡片 ──────────────────────────────────────────
    const cardFloor = controls.createCard(
        '楼层生图触发与交互行为',
        (body) => {
            // 2.1 绘图起始标志符
            body.appendChild(
                controls.createInput({
                    label: '绘图起始标志符',
                    helpTooltip: '格式范例：image###正向提示词 | 负向提示词###（支持使用 | 符号分割正向与负向提示词）',
                    value: settings.placeholderStart ?? 'image###',
                    onChange: (val: string) => store.set('placeholderStart', val.trim() || 'image###')
                })
            );

            // 2.2 绘图结束标志符
            body.appendChild(
                controls.createInput({
                    label: '绘图结束标志符',
                    value: settings.placeholderEnd ?? '###',
                    onChange: (val: string) => store.set('placeholderEnd', val.trim() || '###')
                })
            );

            // 2.3 启用长按/右键快捷操作面板
            body.appendChild(
                controls.createToggle({
                    label: '启用长按/右键快捷操作面板',
                    helpTooltip: '开启后在消息楼层图像上长按或右键可唤出快捷操作菜单（重新生图、临时修改 Tags、局部重绘等）；关闭后仅保留单击大图预览。',
                    value: settings.enableActionPanel ?? true,
                    onChange: (val: boolean) => store.set('enableActionPanel', val)
                })
            );

            // 2.4 AI回复完成后自动点击生图
            body.appendChild(
                controls.createToggle({
                    label: 'AI回复完成后自动点击生图',
                    value: settings.autoGenerate ?? false,
                    onChange: (val: boolean) => store.set('autoGenerate', val)
                })
            );

            // 2.5 点击大图唤出全屏 Lightbox 预览
            body.appendChild(
                controls.createToggle({
                    label: '点击大图唤出全屏 Lightbox 预览',
                    value: settings.lightboxEnabled ?? true,
                    onChange: (val: boolean) => store.set('lightboxEnabled', val)
                })
            );

            // 2.6 自动清洗多余空格与空行
            body.appendChild(
                controls.createToggle({
                    label: '自动清洗多余空格与空行',
                    helpTooltip: '开启后自动过滤提示词中连续的多余空格、换行符及重复逗号，提高提交给生图引擎的提示词纯净度。',
                    value: settings.cleanExtraSpacesAndLines ?? true,
                    onChange: (val: boolean) => store.set('cleanExtraSpacesAndLines', val)
                })
            );

            // 2.7 删除聊天记录时自动擦除关联图像
            body.appendChild(
                controls.createToggle({
                    label: '删除聊天记录时自动擦除关联图像',
                    helpTooltip: '开启后，在酒馆删除聊天记录文件时同步清理该对话引用的本地图库缓存。',
                    value: settings.autoCleanupOnChatDelete ?? false,
                    onChange: (val: boolean) => store.set('autoCleanupOnChatDelete', val)
                })
            );
        },
        '配置聊天文本中的生图标志符、AI 回复自动生图触发机制与大图全屏预览'
    );

    // ── 3. 图像显示样式与对齐控制卡片 ─────────────────────────────────────────
    const cardDisplay = controls.createCard(
        '图像显示样式与对齐控制',
        (body) => {
            const getLatestDisplay = (): ImageDisplayConfig => {
                return (
                    store.get('imageDisplay') || {
                        align: 'left',
                        objectFit: 'contain',
                        maxHeight: 0,
                        maxWidthPct: 100,
                        rounded: true
                    }
                );
            };

            const currentDisplay = getLatestDisplay();

            // 3.1 楼层对齐方式
            body.appendChild(
                controls.createSelect({
                    label: '楼层对齐方式',
                    value: currentDisplay.align ?? 'left',
                    items: [
                        { value: 'left', label: '左对齐 (居左)' },
                        { value: 'center', label: '居中对齐 (居中)' },
                        { value: 'right', label: '右对齐 (居右)' }
                    ],
                    onChange: (val: string) => {
                        store.set('imageDisplay', { ...getLatestDisplay(), align: val as 'left' | 'center' | 'right' });
                    }
                })
            );

            // 3.2 图像缩放模式 (object-fit)
            body.appendChild(
                controls.createSelect({
                    label: '图像缩放模式 (object-fit)',
                    value: currentDisplay.objectFit ?? 'contain',
                    items: [
                        { value: 'contain', label: '等比完整显示 (contain)' },
                        { value: 'cover', label: '裁剪填充 (cover)' },
                        { value: 'fill', label: '拉伸适应 (fill)' },
                        { value: 'none', label: '原始尺寸 (none)' }
                    ],
                    onChange: (val: string) => {
                        store.set('imageDisplay', { ...getLatestDisplay(), objectFit: val as 'contain' | 'cover' | 'fill' | 'none' });
                    }
                })
            );

            // 3.3 最大显示高度 (px)
            body.appendChild(
                controls.createSlider({
                    label: '最大显示高度 (px，0 为不限制)',
                    value: currentDisplay.maxHeight ?? 0,
                    min: 0,
                    max: 2000,
                    step: 50,
                    onChange: (val: number) => {
                        store.set('imageDisplay', { ...getLatestDisplay(), maxHeight: val });
                    }
                })
            );

            // 3.4 最大显示宽度百分比 (%)
            body.appendChild(
                controls.createSlider({
                    label: '最大显示宽度百分比 (%)',
                    value: currentDisplay.maxWidthPct ?? 100,
                    min: 10,
                    max: 100,
                    step: 5,
                    onChange: (val: number) => {
                        store.set('imageDisplay', { ...getLatestDisplay(), maxWidthPct: val });
                    }
                })
            );

            // 3.5 启用现代圆角边框
            body.appendChild(
                controls.createToggle({
                    label: '启用现代圆角边框',
                    value: currentDisplay.rounded ?? true,
                    onChange: (val: boolean) => {
                        store.set('imageDisplay', { ...getLatestDisplay(), rounded: val });
                    }
                })
            );
        },
        '自定义生成图像在 AI 消息楼层中的对齐位置、缩放填充模式、尺寸限制与圆角边框'
    );

    // ── 4. 进阶/扩展功能管理卡片 ───────────────────────────────────────────────
    const cardExt = controls.createCard(
        '进阶/扩展功能管理',
        (body) => {
            const extState = settings.extensions?.['character-manager'];
            body.appendChild(
                controls.createToggle({
                    label: '角色与服装设定管理',
                    helpTooltip: '开启后在侧边栏显示【角色管理】Tab，支持为特定角色卡/Chat ID 绑定专属生图方案及世界书占位符注入。关闭后自动隐藏该 Tab。',
                    value: extState?.enabled !== false,
                    onChange: (val: boolean) => {
                        const currentExts = store.get('extensions') || {};
                        store.set('extensions', {
                            ...currentExts,
                            'character-manager': {
                                enabled: val,
                                config: currentExts['character-manager']?.config
                            }
                        });
                    }
                })
            );
        },
        '集中管理扩展功能与高级组件的启用状态；未开启的功能将自动隐藏其导航界面'
    );

    // ── 5. 数据持久化与缓存清理卡片 ──────────────────────────────────────────
    const cardStorage = controls.createCard(
        '数据持久化与缓存清理',
        (body) => {
            // 5.1 写入酒馆聊天记录
            body.appendChild(
                controls.createToggle({
                    label: '写入酒馆聊天记录',
                    helpTooltip: '开启后生成的图片会自动关联写回对应 AI 消息楼层。物理图像全量在 IndexedDB 中独立存储，规避 chat.json 体积膨胀。',
                    value: settings.persistToChat ?? true,
                    onChange: (val: boolean) => store.set('persistToChat', val)
                })
            );

            // 5.2 物理重置图库数据库
            const clearBtn = document.createElement('button');
            clearBtn.className = 'da-btn danger';
            clearBtn.textContent = '物理重置图库数据库';
            clearBtn.onclick = async () => {
                const confirmed = await FeedbackService.confirm({
                    title: '物理重置图库数据库',
                    message: '确认重置并物理清空本地 IndexedDB 中的所有历史图片缓存与原图数据吗？此操作不可撤销！',
                    confirmText: '确认清空',
                    isDangerous: true
                });
                if (confirmed) {
                    indexedDB.deleteDatabase(DB_NAME);
                    FeedbackService.toast('已清空本地图库 IndexedDB 缓存数据库');
                }
            };

            body.appendChild(
                createFieldRow({
                    label: '物理重置图库数据库',
                    control: clearBtn
                })
            );
        },
        '配置酒馆聊天记录数据持久化策略与一键物理清空缓存数据库'
    );

    container.appendChild(cardMode);
    container.appendChild(cardFloor);
    container.appendChild(cardDisplay);
    container.appendChild(cardExt);
    container.appendChild(cardStorage);

    container.dispose = () => {
        // 资源安全解绑
    };

    return container;
}
