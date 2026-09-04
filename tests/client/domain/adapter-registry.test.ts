import { describe, it, expect, vi } from 'vitest';
import { AdapterRegistry } from '../../../src/client/domain/drivers/adapter-registry';
import { ImageEngineAdapter, EngineCapabilities } from '../../../src/client/domain/types';

describe('AdapterRegistry (驱动适配器注册中心)', () => {
    const createMockAdapter = (id: string, name: string): ImageEngineAdapter => ({
        id,
        name,
        capabilities: {
            txt2img: true,
            img2img: false
        } as EngineCapabilities,
        checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 15 }),
        generate: vi.fn().mockResolvedValue({ taskId: 't1', engine: id, images: [], durationMs: 100 }),
        dispose: vi.fn()
    });

    it('应该成功注册适配器并能正确检索', () => {
        const registry = new AdapterRegistry();
        const comfyAdapter = createMockAdapter('comfyui', 'ComfyUI Backend');

        const disposable = registry.register(comfyAdapter);
        expect(registry.has('comfyui')).toBe(true);
        expect(registry.has('COMFYUI')).toBe(true); // 大小写不敏感
        expect(registry.get('comfyui')).toBe(comfyAdapter);
        expect(registry.getIds()).toEqual(['comfyui']);
        expect(registry.getAll()).toHaveLength(1);

        disposable.dispose();
        expect(registry.has('comfyui')).toBe(false);
        expect(registry.get('comfyui')).toBeUndefined();
    });

    it('注册同名适配器时应替换并释放旧实例', () => {
        const registry = new AdapterRegistry();
        const oldAdapter = createMockAdapter('sdwebui', 'SD WebUI v1');
        const newAdapter = createMockAdapter('sdwebui', 'SD WebUI v2');

        registry.register(oldAdapter);
        expect(registry.get('sdwebui')?.name).toBe('SD WebUI v1');

        registry.register(newAdapter);
        expect(registry.get('sdwebui')?.name).toBe('SD WebUI v2');
        expect(oldAdapter.dispose).toHaveBeenCalled();
    });

    it('dispose 应安全清理并释放所有适配器', () => {
        const registry = new AdapterRegistry();
        const a1 = createMockAdapter('a1', 'Adapter 1');
        const a2 = createMockAdapter('a2', 'Adapter 2');

        registry.register(a1);
        registry.register(a2);
        expect(registry.getAll()).toHaveLength(2);

        registry.dispose();
        expect(registry.getAll()).toHaveLength(0);
        expect(a1.dispose).toHaveBeenCalled();
        expect(a2.dispose).toHaveBeenCalled();
    });
});
