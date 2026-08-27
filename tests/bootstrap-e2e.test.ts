// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { bootstrap } from '../src/index';
import { VERSION } from '../src/core/constants';

describe('Batch 5: Bootstrap & Full Architecture Assembly E2E Tests', () => {
    it('should bootstrap entire microkernel system with all layers and extensions', async () => {
        const kernel = await bootstrap();

        // 1. 验证微内核基座
        expect(kernel).toBeDefined();
        expect(kernel.version).toBe(VERSION);
        expect(kernel.host).toBeDefined();
        expect(kernel.store).toBeDefined();
        expect(kernel.events).toBeDefined();

        // 2. 验证驱动注册
        expect(kernel.drivers.get('comfyui')).toBeDefined();
        expect(kernel.drivers.get('sdwebui')).toBeDefined();

        // 3. 验证 UI Tab 插槽动态装配（内置 Tab + 独立扩展 Tab）
        const tabs = kernel.ui.getTabs();
        const tabIds = tabs.map((t) => t.id);

        expect(tabIds).toContain('general');
        expect(tabIds).toContain('comfyui');
        expect(tabIds).toContain('sdwebui');
        expect(tabIds).toContain('theme');
        expect(tabIds).toContain('gallery');
        expect(tabIds).toContain('fab-settings');
        expect(tabIds).toContain('diagnostics');
        expect(tabIds).toContain('about');
        expect(tabIds).toContain('character-manager');

        // 4. 验证独立扩展生命周期状态
        const ext = kernel.extensions.get('character-manager');
        expect(ext).toBeDefined();
        expect(ext?.name).toBe('角色与服装预设管理');

        // 5. 安全卸载释放
        kernel.dispose();
    });
});
