/**
 * @module ui/views/fab-settings-tab
 * @description 悬浮快捷球 (FAB) 配置面板视图 (FABSettingsTabView)
 *
 * 架构范式：继承 BaseTabView，实现 ITabView 接口
 */

import { ObservableStore, DrawAssistantSettings } from '../../core';
import { FormRenderer, SectionCardSchema } from '../controls';
import { openImageCropperModal } from '../media';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { FAB_PRESET_ICONS } from '../layout/fab-container';

/**
 * 悬浮快捷球配置面板视图
 */
export class FABSettingsTabView extends BaseTabView {
    private readonly _renderer: FormRenderer<DrawAssistantSettings>;

    constructor(private readonly _store: ObservableStore<DrawAssistantSettings>) {
        super('da-fab-settings-tab');
        this._renderer = new FormRenderer<DrawAssistantSettings>(_store);
        this._disposables.add(this._renderer);
        this._root.appendChild(this._buildSettingsCard());
    }

    private _buildSettingsCard(): HTMLElement {
        const store = this._store;

        const cardSchema: SectionCardSchema<DrawAssistantSettings> = {
            title: '快捷悬浮球设置',
            description: '配置界面悬浮快捷球的显隐状态、透明度、图标样式与屏幕停靠位置',
            rows: [
                {
                    key: 'fabVisible',
                    type: 'toggle',
                    label: '显示快捷悬浮球'
                },
                {
                    key: 'fabOpacity',
                    type: 'number',
                    label: '透明度',
                    min: 30,
                    max: 100,
                    step: 5,
                    unit: '%',
                    fromStore: (v) => Math.round((Number(v ?? 0.95)) * 100),
                    toStore: (pct) => pct / 100
                },
                {
                    type: 'custom',
                    label: '预设图标',
                    isBlock: true,
                    renderCustom: () => {
                        const iconGridEl = document.createElement('div');
                        iconGridEl.className = 'da-fab-icon-grid';

                        const renderChips = () => {
                            const curSettings = store.getState();
                            const activeKey = curSettings.fabCustomIcon ? null : (curSettings.fabPresetIcon || 'palette');
                            iconGridEl.innerHTML = '';

                            Object.entries(FAB_PRESET_ICONS).forEach(([key, item]) => {
                                const chip = document.createElement('button');
                                chip.type = 'button';
                                chip.className = `da-fab-icon-chip ${activeKey === key ? 'is-active' : ''}`;
                                chip.title = `预设图标：${item.name}`;
                                chip.innerHTML = item.svg;
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
                    label: '自定义图标',
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
                        uploadBtn.className = 'da-btn da-btn--secondary da-btn--sm';
                        uploadBtn.textContent = '上传图标';
                        uploadBtn.onclick = () => fileInput.click();
                        customIconWrapper.appendChild(uploadBtn);

                        const resetBtn = document.createElement('button');
                        resetBtn.className = 'da-btn da-btn--danger da-btn--sm';
                        resetBtn.textContent = '恢复默认';
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
                    renderCustom: () => {
                        const resetPosBtn = document.createElement('button');
                        resetPosBtn.className = 'da-btn da-btn--secondary da-btn--sm';
                        resetPosBtn.textContent = '重置位置至默认位置';
                        resetPosBtn.onclick = () => {
                            store.set('fabPosition', undefined);
                            FeedbackService.toastSuccess('悬浮球已重置至屏幕默认位置！');
                        };
                        return resetPosBtn;
                    }
                }
            ]
        };

        return this._renderer.renderCard(cardSchema);
    }
}

