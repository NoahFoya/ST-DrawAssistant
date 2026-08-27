/**
 * @module ui/views/fab-settings-tab
 * @description 悬浮球 (FAB) 专属配置面板视图 (包含显示开关、透明度滑块、预设/自定义图标选择与位置重置)
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { ControlFactory } from '../components/controls';

/**
 * 构建并渲染悬浮快捷球配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 悬浮球配置面板 DOM 根节点
 */
export function createFABSettingsTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement {
    const controls = new ControlFactory();
    const container = document.createElement('div');
    container.className = 'da-tab-pane';

    const card = controls.createCard('悬浮快捷球设置 (FAB Configuration)', (body) => {
        const settings = store.getState();

        body.appendChild(
            controls.createSwitch({
                label: '启用页面悬浮快捷球',
                description: '在 SillyTavern 界面右下角显示快捷调出面板的浮动图标',
                value: settings.fabVisible ?? true,
                onChange: (val) => store.set('fabVisible', val)
            })
        );

        body.appendChild(
            controls.createSlider({
                label: '悬浮球不透明度',
                value: settings.fabOpacity ?? 0.9,
                min: 0.2,
                max: 1.0,
                step: 0.05,
                onChange: (val) => store.set('fabOpacity', val)
            })
        );
    });

    container.appendChild(card);
    return container;
}
