/**
 * @file tests/client/ui/foundation.test.ts
 * @description UI Foundation 基础组件与生命周期测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    DisposableStore,
    toDisposable,
    ConfigStore,
    DEFAULT_SETTINGS
} from '../../../src/client/core';
import {
    FormBinder,
    DraftBridge,
    ThemeService,
    UIRegistry,
    OverlayHost,
    escapeHtml,
    formatBytes,
    normalizeHex
} from '../../../src/client/ui/foundation';

describe('UI Foundation 基础工具与生命周期', () => {
    describe('DisposableStore', () => {
        it('应该收集并在 dispose 时按注册逆序释放所有资源', () => {
            const store = new DisposableStore();
            const order: number[] = [];

            store.add(toDisposable(() => order.push(1)));
            store.add(toDisposable(() => order.push(2)));
            store.add(toDisposable(() => order.push(3)));

            expect(store.isDisposed).toBe(false);
            store.dispose();
            expect(store.isDisposed).toBe(true);

            expect(order).toEqual([3, 2, 1]);
        });

        it('向已销毁的 store 添加资源时应立即触发 dispose', () => {
            const store = new DisposableStore();
            store.dispose();

            const fn = vi.fn();
            store.add(toDisposable(fn));
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('clear 应该清空资源但保持 store 未销毁状态', () => {
            const store = new DisposableStore();
            const fn = vi.fn();
            store.add(toDisposable(fn));

            store.clear();
            expect(fn).toHaveBeenCalledTimes(1);
            expect(store.isDisposed).toBe(false);

            // 之后仍可添加
            const fn2 = vi.fn();
            store.add(toDisposable(fn2));
            store.dispose();
            expect(fn2).toHaveBeenCalledTimes(1);
        });
    });

    describe('FormBinder', () => {
        it('应能正确初始化 UI 并在 store 变更时驱动 UI 更新', () => {
            const configStore = new ConfigStore();
            const binder = new FormBinder(configStore);

            let currentUIValue = '';
            const updateUI = vi.fn((val: string) => {
                currentUIValue = val;
            });

            const writeToStore = binder.bind({
                key: 'activeProvider',
                updateUI
            });

            // 1. 初始化被调用
            expect(updateUI).toHaveBeenCalledWith('comfyui');
            expect(currentUIValue).toBe('comfyui');

            // 2. UI 写入 Store
            writeToStore('novelai');
            expect(configStore.get('activeProvider')).toBe('novelai');
            expect(currentUIValue).toBe('novelai');

            // 3. Store 变更驱动 UI
            configStore.set('activeProvider', 'sdwebui');
            expect(currentUIValue).toBe('sdwebui');

            binder.dispose();
        });
    });

    describe('DraftBridge', () => {
        it('应在草稿变更时将指定字段同步至主 Store', () => {
            const draftStore = new ConfigStore({ defaultSettings: { ...DEFAULT_SETTINGS } });
            const mainStore = new ConfigStore({ defaultSettings: { ...DEFAULT_SETTINGS } });

            const bridge = new DraftBridge(draftStore, mainStore, ['activeProvider', 'maxStoredImages']);

            draftStore.set('activeProvider', 'novelai');
            draftStore.set('maxStoredImages', 1000);
            draftStore.set('enabled', false); // 不在 bridge keys 中

            expect(mainStore.get('activeProvider')).toBe('novelai');
            expect(mainStore.get('maxStoredImages')).toBe(1000);
            expect(mainStore.get('enabled')).toBe(true); // 未被同步

            bridge.dispose();
        });
    });

    describe('UIRegistry', () => {
        it('应支持 Tab 插槽的注册与注销', () => {
            const registry = new UIRegistry();

            const sub = registry.registerTab({
                id: 'custom-tab',
                title: '自定义',
                order: 15,
                render: vi.fn()
            });

            expect(registry.getTab('custom-tab')?.title).toBe('自定义');
            expect(registry.getTabs().length).toBe(1);

            sub.dispose();
            expect(registry.getTab('custom-tab')).toBeUndefined();
            expect(registry.getTabs().length).toBe(0);

            registry.dispose();
        });
    });

    describe('UI Utils', () => {
        it('escapeHtml 应正确转义 HTML 实体', () => {
            expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
            expect(escapeHtml(null)).toBe('');
        });

        it('formatBytes 应正确格式化字节', () => {
            expect(formatBytes(0)).toBe('0 B');
            expect(formatBytes(1024)).toBe('1 KB');
            expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
        });

        it('normalizeHex 应正确规范化颜色值', () => {
            expect(normalizeHex('#fff')).toBe('#ffffff');
            expect(normalizeHex('38bdf8')).toBe('#38bdf8');
            expect(normalizeHex('invalid')).toBeNull();
        });
    });
});
