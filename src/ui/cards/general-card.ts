/**
 * ST-DrawAssistant 常规与运行配置卡片。
 *
 * @remarks
 * 组织任务超时、图像持久化存储策略、压缩格式与质量等核心系统参数，
 * 统一与 settingsStore 保持双向状态同步。
 */

import { CardBase } from './card-base';
import {
    createFormField,
    createTextInput,
    createSelect,
    createToggle,
    createSlider,
} from '../components';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';

export class GeneralCard extends CardBase {
    private unbindSettingsListener: (() => void) | null = null;

    constructor() {
        super({
            title: '常规与运行设置',
            badge: '系统参数',
        });

        this.buildFields();
        this.listenSettingsUpdates();
    }

    private buildFields(): void {
        const settings = settingsStore.getSettings();

        // 1. 插件总开关
        const enabledToggle = this.registerChild(
            createToggle({
                checked: settings.enabled,
                onChange: (checked) => {
                    settingsStore.update({ enabled: checked });
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '启用绘画助手',
                description: '全局开启或关闭绘图扩展全部监听与注入功能',
                control: enabledToggle,
                slotWidth: 'toggle',
            }).element
        );

        // 2. 单任务超时时限 (秒)
        const timeoutInput = this.registerChild(
            createTextInput({
                type: 'number',
                value: Math.round(settings.taskTimeoutMs / 1000),
                variant: 'number',
                min: 10,
                max: 3600,
                step: 10,
                onChange: (val) => {
                    const sec = parseInt(val, 10);
                    if (!Number.isNaN(sec) && sec >= 10) {
                        settingsStore.update({ taskTimeoutMs: sec * 1000 });
                    }
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '任务超时时间 (秒)',
                description: '单次生图网络请求与轮询最大等待时间',
                tooltip: '默认 120 秒，复杂工作流或高分辨率生成可适当调大',
                control: timeoutInput,
                slotWidth: '80',
            }).element
        );

        // 3. 图像存储格式
        const formatSelect = this.registerChild(
            createSelect<'original' | 'webp' | 'png'>({
                value: settings.imageFormat || 'original',
                options: [
                    { label: '原始格式 (Original)', value: 'original' },
                    { label: 'WebP 压缩格式', value: 'webp' },
                    { label: 'PNG 无损格式', value: 'png' },
                ],
                onChange: (format) => {
                    settingsStore.update({ imageFormat: format });
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '图像存储格式',
                description: '保存在本地 IndexedDB 中的图像编码规范',
                control: formatSelect,
                slotWidth: '240',
            }).element
        );

        // 4. 图像压缩质量
        const qualitySlider = this.registerChild(
            createSlider({
                min: 0.1,
                max: 1.0,
                step: 0.05,
                value: settings.imageQuality ?? 0.85,
                onChange: (quality) => {
                    settingsStore.update({ imageQuality: quality });
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: 'WebP 压缩质量',
                description: '仅在选择 WebP 格式时生效 (0.1 ~ 1.0)',
                control: qualitySlider,
                slotWidth: '240',
            }).element
        );

        // 5. 存储至 IndexedDB
        const idbToggle = this.registerChild(
            createToggle({
                checked: settings.saveToIndexedDB,
                onChange: (checked) => {
                    settingsStore.update({ saveToIndexedDB: checked });
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '本地持久化缓存',
                description: '将生成的高清图像完整留存于浏览器端 IndexedDB 数据库中',
                control: idbToggle,
                slotWidth: 'toggle',
            }).element
        );

        // 6. 最大本地缓存张数
        const maxImagesInput = this.registerChild(
            createTextInput({
                type: 'number',
                value: settings.maxStoredImages ?? 200,
                variant: 'number',
                min: 10,
                max: 5000,
                step: 50,
                onChange: (val) => {
                    const count = parseInt(val, 10);
                    if (!Number.isNaN(count) && count >= 10) {
                        settingsStore.update({ maxStoredImages: count });
                    }
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '最大本地图像缓存数',
                description: '超出配额时自动清理最旧的历史生成资产',
                control: maxImagesInput,
                slotWidth: '80',
            }).element
        );

        // 7. 自动触发绘图
        const autoGenToggle = this.registerChild(
            createToggle({
                checked: settings.autoGenerate,
                onChange: (checked) => {
                    settingsStore.update({ autoGenerate: checked });
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '自动检测并生图',
                description: '捕获到消息文本包含指定绘图指令时直接派发生图任务',
                control: autoGenToggle,
                slotWidth: 'toggle',
            }).element
        );
    }

    private listenSettingsUpdates(): void {
        this.unbindSettingsListener = eventBus.on('settings:updated', () => {
            // 当配置由外部导入或恢复默认时刷新整个卡片字段
            this.bodyElement.innerHTML = '';
            this.buildFields();
        });
    }

    public override dispose(): void {
        if (this.unbindSettingsListener) {
            this.unbindSettingsListener();
            this.unbindSettingsListener = null;
        }
        super.dispose();
    }
}
