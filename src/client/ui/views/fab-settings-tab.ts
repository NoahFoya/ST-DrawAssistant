/**
 * @module ui/views/fab-settings-tab
 * @description 悬浮快捷球 (FAB) 配置面板视图 (FABSettingsTabView)
 */

import { ConfigStore, DrawAssistantSettings } from '../../core';
import { FormRenderer, SectionCardSchema } from '../controls';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { FAB_PRESET_ICONS } from '../layout/fab-container';

export class FABSettingsTabView extends BaseTabView {
    private readonly _renderer: FormRenderer<DrawAssistantSettings>;

    constructor(private readonly _store: ConfigStore) {
        super('da-fab-settings-tab');
        this._renderer = new FormRenderer<DrawAssistantSettings>(_store);
        this._disposables.add(this._renderer);
        this._root.appendChild(this._buildSettingsCard());
    }

    private _buildSettingsCard(): HTMLElement {
        const store = this._store;

        const cardSchema: SectionCardSchema<DrawAssistantSettings> = {
            title: '悬浮球显示与外观',
            description: '配置屏幕快捷悬浮球的显隐状态、不透明度与图标造型',
            rows: [
                {
                    key: 'fabVisible',
                    type: 'toggle',
                    label: '启用屏幕悬浮球'
                },
                {
                    key: 'fabOpacity',
                    type: 'number',
                    label: '悬浮球不透明度',
                    min: 20,
                    max: 100,
                    step: 5,
                    unit: '%',
                    fromStore: (v) => Math.round(Number(v ?? 0.95) * 100),
                    toStore: (pct) => pct / 100
                },
                {
                    type: 'custom',
                    label: '内置预设图标',
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
                    key: 'fabCustomIcon',
                    type: 'input',
                    label: '自定义图标 URL / Base64',
                    placeholder: 'https://... 或 data:image/png;base64,...',
                    helpTooltip: '填写图片直链或 Base64 编码，留空则使用上方选中的预设图标。'
                },
                {
                    type: 'custom',
                    label: '位置重置',
                    renderCustom: () => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'da-btn da-btn--secondary';
                        btn.textContent = '重置悬浮球停靠位置';
                        btn.onclick = () => {
                            store.set('fabPosition', undefined);
                            FeedbackService.toastSuccess('已将悬浮球坐标重置为屏幕右侧默认位置');
                        };
                        return btn;
                    }
                }
            ]
        };

        return this._renderer.renderCard(cardSchema);
    }
}
