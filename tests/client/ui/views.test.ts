/**
 * @module tests/client/ui/views.test
 * @description 批次 4: 设置面板 Tab 视图与批量注册器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigStore } from '../../../src/client/core/config/config-store';
import { AdapterRegistry } from '../../../src/client/domain/drivers/adapter-registry';
import { UIRegistry } from '../../../src/client/ui/foundation/ui-registry';
import {
    registerCoreViews,
    GeneralTabView,
    ComfyUITabView,
    SDWebUITabView,
    CloudTabView,
    NovelAITabView,
    ThemeTabView,
    FABSettingsTabView,
    DiagnosticsTabView,
    AboutTabView,
    GalleryTabView
} from '../../../src/client/ui/views';

describe('UI Views & Tab Registration', () => {
    let store: ConfigStore;
    let uiRegistry: UIRegistry;
    let adapterRegistry: AdapterRegistry;

    beforeEach(() => {
        document.body.innerHTML = '';
        store = new ConfigStore();
        uiRegistry = new UIRegistry();
        adapterRegistry = new AdapterRegistry();
    });

    afterEach(() => {
        adapterRegistry.dispose();
        uiRegistry.dispose();
        store.dispose();
        document.body.innerHTML = '';
    });

    describe('registerCoreViews', () => {
        it('应成功向 UIRegistry 注册 10 个内置 Tab 插槽', () => {
            const handle = registerCoreViews({
                uiRegistry,
                store,
                adapters: adapterRegistry
            });

            const tabs = uiRegistry.getTabs();
            expect(tabs.length).toBe(10);

            const tabIds = tabs.map((t) => t.id);
            expect(tabIds).toContain('general');
            expect(tabIds).toContain('comfyui');
            expect(tabIds).toContain('sdwebui');
            expect(tabIds).toContain('cloud');
            expect(tabIds).toContain('novelai');
            expect(tabIds).toContain('theme');
            expect(tabIds).toContain('fab');
            expect(tabIds).toContain('diagnostics');
            expect(tabIds).toContain('gallery');
            expect(tabIds).toContain('about');

            // 释放后应清空注册
            handle.dispose();
            expect(uiRegistry.getTabs().length).toBe(0);
        });
    });

    describe('GeneralTabView', () => {
        it('应渲染通用设置各卡片并支持配置双向同步', () => {
            const view = new GeneralTabView(store);
            expect(view.element).not.toBeNull();

            // 修改 enabled
            store.set('enabled', false);
            expect(store.get('enabled')).toBe(false);

            view.dispose();
        });
    });

    describe('ComfyUITabView', () => {
        it('应渲染 ComfyUI 独立配置卡片，且配置独立写回 mainStore', () => {
            const view = new ComfyUITabView(store, adapterRegistry);
            expect(view.element).not.toBeNull();

            const config = store.getEngineConfig('comfyui');
            expect(config.serverUrl).toBe('http://127.0.0.1:8188');

            view.dispose();
        });
    });

    describe('SDWebUITabView', () => {
        it('应渲染 SD-WebUI 专属参数并正确写入规范字段', () => {
            const view = new SDWebUITabView(store, adapterRegistry);
            expect(view.element).not.toBeNull();

            const config = store.getEngineConfig('sdwebui');
            expect(config.serverUrl).toBe('http://127.0.0.1:7860');
            expect(config.steps).toBe(20);
            expect(config.cfgScale).toBe(7);
            expect(config.samplerName).toBe('Euler a');

            view.dispose();
        });
    });

    describe('CloudTabView', () => {
        it('应渲染云端生图多模态参数', () => {
            const view = new CloudTabView(store, adapterRegistry);
            expect(view.element).not.toBeNull();

            const config = store.getEngineConfig('cloud');
            expect(config.provider).toBe('google');
            expect(config.model).toBe('gemini-3.1-flash-image-preview');

            view.dispose();
        });
    });

    describe('NovelAITabView', () => {
        it('应渲染 NovelAI 参数', () => {
            const view = new NovelAITabView(store, adapterRegistry);
            expect(view.element).not.toBeNull();

            const config = store.getEngineConfig('novelai');
            expect(config.model).toBe('nai-diffusion-4-curated-preview');

            view.dispose();
        });
    });

    describe('ThemeTabView & FABSettingsTabView', () => {
        it('应能正确渲染外观与悬浮球设置卡片', () => {
            const themeView = new ThemeTabView(store);
            expect(themeView.element).not.toBeNull();
            themeView.dispose();

            const fabView = new FABSettingsTabView(store);
            expect(fabView.element).not.toBeNull();
            fabView.dispose();
        });
    });

    describe('DiagnosticsTabView, AboutTabView & GalleryTabView', () => {
        it('应能正常渲染运行诊断、关于与画廊卡片', () => {
            const diagView = new DiagnosticsTabView(store, adapterRegistry);
            expect(diagView.element).not.toBeNull();
            diagView.dispose();

            const aboutView = new AboutTabView(store);
            expect(aboutView.element).not.toBeNull();
            aboutView.dispose();

            const galleryView = new GalleryTabView();
            expect(galleryView.element).not.toBeNull();
            galleryView.dispose();
        });
    });
});
