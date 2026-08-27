/**
 * @module ui/views/fab-settings-tab
 * @description 悬浮快捷球 (FAB) 配置面板视图 (FABSettingsTab) - 声明式 Schema 架构重构版
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { FormRenderer, SectionCardSchema } from '../controls';
import { openImageCropperModal } from '../media';
import { FeedbackService } from '../feedback/feedback';
import { IDisposable } from '../../core/foundation/disposable';

export const FAB_TAB_PRESET_ICONS: Record<string, { name: string; emoji: string }> = {
    palette: { name: '艺术调色盘', emoji: '🎨' },
    sparkles: { name: '闪烁灵感', emoji: '✨' },
    wand: { name: '魔法棒', emoji: '🪄' },
    image: { name: '艺术画框', emoji: '🖼️' },
    brush: { name: '绘图画笔', emoji: '🖌️' }
};

/**
 * 构建并渲染悬浮快捷球配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的悬浮球配置面板 DOM 根节点
 */
export function createFABSettingsTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable {
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-fab-settings-tab';

    const renderer = new FormRenderer<DrawAssistantSettings>(store);

    const cardSchema: SectionCardSchema<DrawAssistantSettings> = {
        title: '快捷悬浮球设置',
        description: '配置界面悬浮快捷球的显隐状态、半透明不透明度、矢量图标样式与屏幕显示位置',
        rows: [
            {
                key: 'fabVisible',
                type: 'toggle',
                label: '启用页面悬浮快捷球',
                helpTooltip: '在 SillyTavern 界面常驻显示快捷调出面板的浮动球。'
            },
            {
                key: 'fabOpacity',
                type: 'slider',
                label: '悬浮球未激活透明度',
                helpTooltip: '调节悬浮球在未交互闲置时的半透明程度 (30% ~ 100%)。',
                min: 30,
                max: 100,
                step: 5,
                unit: '%',
                fromStore: (v) => Math.round((Number(v ?? 0.95)) * 100),
                toStore: (pct) => pct / 100
            },
            {
                type: 'custom',
                label: '预设矢量图标',
                helpTooltip: '选择悬浮球内置的主题矢量图标风格。',
                renderCustom: () => {
                    const iconGridEl = document.createElement('div');
                    iconGridEl.className = 'da-fab-icon-grid';

                    const renderChips = () => {
                        const curSettings = store.getState();
                        const activeKey = curSettings.fabCustomIcon ? null : (curSettings.fabPresetIcon || 'palette');
                        iconGridEl.innerHTML = '';

                        Object.entries(FAB_TAB_PRESET_ICONS).forEach(([key, item]) => {
                            const chip = document.createElement('div');
                            chip.className = `da-fab-icon-chip ${activeKey === key ? 'is-active' : ''}`;
                            chip.textContent = `${item.emoji} ${item.name}`;
                            chip.onclick = () => {
                                store.set('fabPresetIcon', key);
                                store.set('fabCustomIcon', undefined);
                                renderChips();
                                FeedbackService.toastSuccess(`已切换悬浮球图标为：${item.name}`);
                            };
                            iconGridEl.appendChild(chip);
                        });
                    };

                    renderChips();
                    return iconGridEl;
                }
            },
            {
                type: 'custom',
                label: '自定义图片图标',
                helpTooltip: '上传并裁切自定义图像作为悬浮球头像。',
                renderCustom: () => {
                    const customIconWrapper = document.createElement('div');
                    customIconWrapper.className = 'da-fab-custom-icon-wrapper';

                    const previewImgEl = document.createElement('img');
                    previewImgEl.className = 'da-fab-preview-avatar';

                    const updatePreview = () => {
                        const customIcon = store.get('fabCustomIcon');
                        if (customIcon) {
                            previewImgEl.src = customIcon;
                            previewImgEl.style.display = 'inline-block';
                        } else {
                            previewImgEl.style.display = 'none';
                        }
                    };

                    updatePreview();
                    customIconWrapper.appendChild(previewImgEl);

                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = 'image/*';
                    fileInput.style.display = 'none';
                    fileInput.onchange = () => {
                        const file = fileInput.files?.[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                const base64 = e.target?.result as string;
                                openImageCropperModal({
                                    imageSrc: base64,
                                    onCrop: (croppedDataUrl: string) => {
                                        store.set('fabCustomIcon', croppedDataUrl);
                                        updatePreview();
                                        FeedbackService.toastSuccess('自定义悬浮球图标已生效！');
                                    }
                                });

                            };
                            reader.readAsDataURL(file);
                        }
                    };

                    const uploadBtn = document.createElement('button');
                    uploadBtn.className = 'da-btn secondary da-btn-sm';
                    uploadBtn.textContent = '🖼️ 上传图标';
                    uploadBtn.onclick = () => fileInput.click();
                    customIconWrapper.appendChild(uploadBtn);

                    const resetBtn = document.createElement('button');
                    resetBtn.className = 'da-btn danger da-btn-sm';
                    resetBtn.textContent = '🗑️ 恢复默认';
                    resetBtn.onclick = () => {
                        store.set('fabCustomIcon', undefined);
                        updatePreview();
                        FeedbackService.toastSuccess('已恢复为预设图标');
                    };
                    customIconWrapper.appendChild(resetBtn);

                    return customIconWrapper;
                }
            },
            {
                type: 'custom',
                label: '重置悬浮球位置',
                helpTooltip: '将悬浮球停靠坐标恢复至屏幕右下角默认锚点。',
                renderCustom: () => {
                    const resetPosBtn = document.createElement('button');
                    resetPosBtn.className = 'da-btn secondary da-btn-sm';
                    resetPosBtn.textContent = '📍 重置位置至默认右下角';
                    resetPosBtn.onclick = () => {
                        store.set('fabPosition', { x: 20, y: 100 });
                        FeedbackService.toastSuccess('悬浮球位置已重置至屏幕右下角！');
                    };
                    return resetPosBtn;
                }
            }
        ]
    };

    container.appendChild(renderer.renderCard(cardSchema));

    container.dispose = () => {
        renderer.dispose();
    };

    return container;
}
