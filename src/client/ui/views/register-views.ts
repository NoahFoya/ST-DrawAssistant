/**
 * @module ui/views/register-views
 * @description 核心设置面板视图注册器 (Core Tab Views Registration)
 */

import { IDisposable, DisposableStore, ConfigStore } from '../../core';
import { AdapterRegistry } from '../../domain/drivers/adapter-registry';
import { StorageService } from '../../core/storage';
import { HostClient } from '../../core/host';
import { IUIRegistry } from '../foundation/ui-registry';
import { GeneralTabView } from './general-tab';
import { ComfyUITabView } from './comfyui-tab';
import { SDWebUITabView } from './sdwebui-tab';
import { CloudTabView } from './cloud-tab';
import { NovelAITabView } from './novelai-tab';
import { ThemeTabView } from './theme-tab';
import { FABSettingsTabView } from './fab-settings-tab';
import { DiagnosticsTabView } from './diagnostics-tab';
import { AboutTabView } from './about-tab';
import { GalleryTabView } from './gallery-tab';

export interface RegisterViewsOptions {
    uiRegistry: IUIRegistry;
    store: ConfigStore;
    adapters?: AdapterRegistry;
    storage?: StorageService;
    host?: HostClient;
}

/**
 * 向 UI 注册中心批量注册所有内置核心设置 Tab 面板
 */
export function registerCoreViews(options: RegisterViewsOptions): IDisposable {
    const { uiRegistry, store, adapters, storage, host } = options;
    const disposables = new DisposableStore();

    // 1. 通用设置
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

    // 2. ComfyUI
    disposables.add(
        uiRegistry.registerTab({
            id: 'comfyui',
            title: 'ComfyUI',
            icon: '🧩',
            order: 20,
            isBuiltIn: true,
            render: (container) => {
                const view = new ComfyUITabView(store, adapters);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    // 3. SD-WebUI
    disposables.add(
        uiRegistry.registerTab({
            id: 'sdwebui',
            title: 'SD-WebUI',
            icon: '🎨',
            order: 30,
            isBuiltIn: true,
            render: (container) => {
                const view = new SDWebUITabView(store, adapters);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    // 4. 云端生图 (OpenAI / Grok / Gemini)
    disposables.add(
        uiRegistry.registerTab({
            id: 'cloud',
            title: '云端生图',
            icon: '☁️',
            order: 35,
            isBuiltIn: true,
            render: (container) => {
                const view = new CloudTabView(store, adapters);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    // 5. NovelAI
    disposables.add(
        uiRegistry.registerTab({
            id: 'novelai',
            title: 'NovelAI',
            icon: '📖',
            order: 38,
            isBuiltIn: true,
            render: (container) => {
                const view = new NovelAITabView(store, adapters);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    // 6. 外观主题
    disposables.add(
        uiRegistry.registerTab({
            id: 'theme',
            title: '外观主题',
            icon: '🎭',
            order: 40,
            isBuiltIn: true,
            render: (container) => {
                const view = new ThemeTabView(store);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    // 7. 屏幕悬浮球
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

    // 8. 运行诊断
    disposables.add(
        uiRegistry.registerTab({
            id: 'diagnostics',
            title: '运行诊断',
            icon: '🩺',
            order: 60,
            isBuiltIn: true,
            render: (container) => {
                const view = new DiagnosticsTabView(store, adapters);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    // 9. 历史图库
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

    // 10. 关于与帮助
    disposables.add(
        uiRegistry.registerTab({
            id: 'about',
            title: '关于',
            icon: 'ℹ️',
            order: 80,
            isBuiltIn: true,
            render: (container) => {
                const view = new AboutTabView(store);
                container.appendChild(view.element);
                return view;
            }
        })
    );

    return disposables;
}
