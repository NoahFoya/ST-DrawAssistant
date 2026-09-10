/**
 * 悬浮球设置面板视图 (FABSettingsTabView)
 * 控制悬浮球启用状态、透明度、预设与自定义图标及停靠位置
 */

import { DrawAssistantSettings } from '../../types';
import { SettingsStore } from '../../state';
import { FormRenderer, SectionCardSchema } from '../components';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { FAB_PRESET_ICONS, getPresetSvg } from '../layout/fab-container';

export class FABSettingsTabView extends BaseTabView {
    private readonly _renderer: FormRenderer<DrawAssistantSettings>;

    constructor(private readonly _store: SettingsStore) {
        super();
        this._renderer = new FormRenderer<DrawAssistantSettings>(_store);
        this._disposables.add(this._renderer);
        this._root.appendChild(this._buildSettingsCard());
    }

    private _buildSettingsCard(): HTMLElement {
        const store = this._store;

        const cardSchema: SectionCardSchema<DrawAssistantSettings> = {
            title: '悬浮球设置',
            description: '配置悬浮球的启用状态、透明度、图标与停靠位置',
            rows: [
                {
                    key: 'fabVisible',
                    type: 'toggle',
                    label: '启用悬浮球'
                },
                {
                    key: 'fabOpacity',
                    type: 'slider',
                    label: '悬浮球透明度',
                    min: 20,
                    max: 100,
                    step: 5,
                    unit: '%',
                    fromStore: (v) => Math.round(Number(v ?? 0.95) * 100),
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
                    isBlock: true,
                    renderCustom: () => {
                        const container = document.createElement('div');
                        container.className = 'da-flex-col da-gap-sm da-w-full';

                        // 上方操作行：微缩预览 + 本地上传按钮 + 还原默认按钮
                        const actionRow = document.createElement('div');
                        actionRow.className = 'da-fab-custom-icon-wrapper';

                        const previewEl = document.createElement('div');
                        previewEl.className = 'da-fab-preview-avatar';
                        previewEl.title = '当前生效的悬浮球图标预览';

                        const fileInput = document.createElement('input');
                        fileInput.type = 'file';
                        fileInput.accept = 'image/*';
                        fileInput.className = 'da-hidden';

                        const uploadBtn = document.createElement('button');
                        uploadBtn.type = 'button';
                        uploadBtn.className = 'da-btn da-btn--secondary da-btn--sm';
                        uploadBtn.textContent = '选择本地图片';

                        const resetBtn = document.createElement('button');
                        resetBtn.type = 'button';
                        resetBtn.className = 'da-btn da-btn--secondary da-btn--sm';
                        resetBtn.textContent = '还原预设图标';

                        const textInput = document.createElement('input');
                        textInput.type = 'text';
                        textInput.className = 'da-input';
                        textInput.placeholder = '或填入网络图片链接: https://...';
                        textInput.value = store.get('fabCustomIcon') || '';

                        const updatePreview = () => {
                            const customIcon = store.get('fabCustomIcon');
                            if (customIcon) {
                                previewEl.innerHTML = `<img src="${customIcon}" alt="Icon Preview" />`;
                                textInput.value = customIcon;
                            } else {
                                const presetKey = store.get('fabPresetIcon');
                                previewEl.innerHTML = getPresetSvg(presetKey);
                                textInput.value = '';
                            }
                        };

                        fileInput.addEventListener('change', () => {
                            const file = fileInput.files?.[0];
                            if (!file) return;

                            const reader = new FileReader();
                            reader.onload = (e) => {
                                const dataUrl = e.target?.result as string;
                                if (dataUrl) {
                                    store.set('fabCustomIcon', dataUrl);
                                    updatePreview();
                                    FeedbackService.toastSuccess('已设置自定义悬浮球图标');
                                }
                            };
                            reader.readAsDataURL(file);
                            fileInput.value = '';
                        });

                        uploadBtn.onclick = () => fileInput.click();

                        resetBtn.onclick = () => {
                            store.set('fabCustomIcon', undefined);
                            updatePreview();
                            FeedbackService.toastSuccess('已还原为预设图标');
                        };

                        textInput.addEventListener('change', () => {
                            const val = textInput.value.trim();
                            store.set('fabCustomIcon', val || undefined);
                            updatePreview();
                            if (val) {
                                FeedbackService.toastSuccess('已更新悬浮球图标链接');
                            }
                        });

                        actionRow.appendChild(previewEl);
                        actionRow.appendChild(fileInput);
                        actionRow.appendChild(uploadBtn);
                        actionRow.appendChild(resetBtn);

                        container.appendChild(actionRow);
                        container.appendChild(textInput);

                        updatePreview();
                        return container;
                    }
                },
                {
                    type: 'custom',
                    label: '重置位置',
                    renderCustom: () => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'da-btn da-btn--secondary';
                        btn.textContent = '重置为默认位置';
                        btn.onclick = () => {
                            if (typeof window !== 'undefined' && window.localStorage) {
                                localStorage.removeItem('da_fab_position');
                            }
                            if (store.get('fabPosition') !== undefined) {
                                store.set('fabPosition', undefined);
                            }
                            if (typeof window !== 'undefined') {
                                window.dispatchEvent(new CustomEvent('da:reset_fab_position'));
                            }
                            FeedbackService.toastSuccess('已将悬浮球恢复至屏幕默认位置');
                        };
                        return btn;
                    }
                }
            ]
        };

        return this._renderer.renderCard(cardSchema);
    }
}
