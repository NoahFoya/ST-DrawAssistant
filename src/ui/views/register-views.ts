/**
 * 核心设置面板视图注册器
 * 将所有内置 Tab 视图按顺序注册至 UIRegistry 插槽容器
 */

import { IDisposable, DisposableStore, CoreEventMap } from '../../types';
import { TypedEventBus } from '../../utils';
import { SettingsStore } from '../../state';
import { DriverRegistry } from '../../services/drivers';
import { StorageService } from '../../state';
import { HostClient } from '../../host';
import { IUIRegistry } from '../foundation/ui-registry';
import { GeneralTabView } from './general-tab';
import { ComfyUITabView } from './comfyui-tab';
import { SDWebUITabView } from './sdwebui-tab';
import { OpenAITabView } from './openai-tab';
import { NovelAITabView } from './novelai-tab';
import { ThemeTabView } from './theme-tab';
import { FABSettingsTabView } from './fab-settings-tab';
import { DiagnosticsTabView } from './diagnostics-tab';
import { AboutTabView } from './about-tab';
import { GalleryTabView } from './gallery-tab';

export interface RegisterViewsOptions {
    uiRegistry: IUIRegistry;
    store: SettingsStore;
    drivers?: DriverRegistry;
    storage?: StorageService;
    host?: HostClient;
    events?: TypedEventBus<CoreEventMap>;
}

/**
 * 向 UI 注册中心批量注册所有内置核心设置 Tab 面板
 */
export function registerCoreViews(options: RegisterViewsOptions): IDisposable {
    const { uiRegistry, store, drivers, storage, host, events } = options;
    const disposables = new DisposableStore();

    // 通用设置
    disposables.add(
        uiRegistry.registerTab({
            id: 'general',
            title: '通用设置',
            icon: '⚙️',
            order: 10,
            isBuiltIn: true,
            render: (container) => {
                const view = new GeneralTabView(store);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    // 生图引擎驱动 (ComfyUI / SD-WebUI / OpenAI / NovelAI)
    disposables.add(
        uiRegistry.registerTab({
            id: 'comfyui',
            title: 'ComfyUI',
            icon: '🧩',
            order: 20,
            isBuiltIn: true,
            render: (container) => {
                const view = new ComfyUITabView(store, drivers, events);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    disposables.add(
        uiRegistry.registerTab({
            id: 'sdwebui',
            title: 'SD-WebUI',
            icon: '🎨',
            order: 30,
            isBuiltIn: true,
            render: (container) => {
                const view = new SDWebUITabView(store, drivers, events);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    disposables.add(
        uiRegistry.registerTab({
            id: 'openai',
            title: 'OpenAI 兼容',
            icon: '☁️',
            order: 35,
            isBuiltIn: true,
            render: (container) => {
                const view = new OpenAITabView(store, drivers, events);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    disposables.add(
        uiRegistry.registerTab({
            id: 'novelai',
            title: 'NovelAI',
            icon: '📖',
            order: 38,
            isBuiltIn: true,
            render: (container) => {
                const view = new NovelAITabView(store, drivers, events);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    // 外观与交互
    disposables.add(
        uiRegistry.registerTab({
            id: 'theme',
            title: '外观主题',
            icon: '🎭',
            order: 40,
            isBuiltIn: true,
            render: (container) => {
                const view = new ThemeTabView(store, events);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    disposables.add(
        uiRegistry.registerTab({
            id: 'fab',
            title: '屏幕悬浮球',
            icon: '🔘',
            order: 50,
            isBuiltIn: true,
            render: (container) => {
                const view = new FABSettingsTabView(store);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    // 系统工具 (诊断 / 图库 / 关于)
    disposables.add(
        uiRegistry.registerTab({
            id: 'diagnostics',
            title: '运行诊断',
            icon: '🩺',
            order: 60,
            isBuiltIn: true,
            render: (container) => {
                const view = new DiagnosticsTabView(store, drivers);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    disposables.add(
        uiRegistry.registerTab({
            id: 'gallery',
            title: '历史图库',
            icon: '🖼️',
            order: 70,
            isBuiltIn: true,
            render: (container) => {
                const view = new GalleryTabView(storage, host);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    disposables.add(
        uiRegistry.registerTab({
            id: 'about',
            title: '关于',
            icon: 'ℹ️',
            order: 80,
            isBuiltIn: true,
            render: (container) => {
                const view = new AboutTabView(store, events);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    return disposables;
}
