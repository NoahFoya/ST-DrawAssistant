import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    ConfigStore,
    DEFAULT_SETTINGS,
    mergeSettingsWithDefaults
} from '../../../../src/client/core/config/config-store';

describe('ConfigStore & mergeSettingsWithDefaults', () => {
    describe('mergeSettingsWithDefaults', () => {
        it('空对象或非对象输入应返回默认配置副本', () => {
            const result1 = mergeSettingsWithDefaults(null);
            expect(result1.enabled).toBe(true);
            expect(result1.activeProvider).toBe('comfyui');

            const result2 = mergeSettingsWithDefaults('invalid');
            expect(result2.requestMode).toBe('browser');
        });

        it('部分字段应正确覆盖默认配置，未提供字段使用默认值补齐', () => {
            const userConfig = {
                enabled: false,
                activeProvider: 'novelai',
                themePreset: 'custom-dark'
            };
            const merged = mergeSettingsWithDefaults(userConfig);
            expect(merged.enabled).toBe(false);
            expect(merged.activeProvider).toBe('novelai');
            expect(merged.themePreset).toBe('custom-dark');
            expect(merged.requestMode).toBe('browser');
            expect(merged.storageStrategy).toBe('split');
        });

        it('数组类型应以用户配置优先，不强制合并默认数组项', () => {
            const userConfig = {
                customThemes: [
                    {
                        id: 'my-theme',
                        name: '我的专属主题',
                        tokens: { '--da-primary': '#ff0000' }
                    }
                ]
            };
            const merged = mergeSettingsWithDefaults(userConfig);
            expect(merged.customThemes.length).toBe(1);
            expect(merged.customThemes[0].id).toBe('my-theme');
        });

        it('引擎独立配置空间应正确保留', () => {
            const userConfig = {
                engineConfigs: {
                    comfyui: { serverUrl: 'http://127.0.0.1:8188' }
                }
            };
            const merged = mergeSettingsWithDefaults(userConfig);
            expect(merged.engineConfigs.comfyui).toEqual({ serverUrl: 'http://127.0.0.1:8188' });
        });

        it('修改合并后的配置对象不应污染 DEFAULT_SETTINGS 全局默认对象', () => {
            const merged = mergeSettingsWithDefaults({});
            (merged.engineConfigs as any)['polluteKey'] = { test: true };
            merged.customThemes.push({ id: 'pollute', name: 'pollute', tokens: {} });

            expect((DEFAULT_SETTINGS.engineConfigs as any)['polluteKey']).toBeUndefined();
            expect(DEFAULT_SETTINGS.customThemes.some(t => t.id === 'pollute')).toBe(false);
        });
    });

    describe('ConfigStore 状态管理与监听', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        it('基础 get 与 set 操作应正常更新状态', () => {
            const store = new ConfigStore();
            expect(store.get('enabled')).toBe(true);

            store.set('enabled', false);
            expect(store.get('enabled')).toBe(false);
            expect(store.getState().enabled).toBe(false);
        });

        it('键级监听器 (subscribeKey) 应在特定键变动时精准触发', () => {
            const store = new ConfigStore();
            const mockListener = vi.fn();

            const sub = store.subscribeKey('activeProvider', mockListener);

            store.set('activeProvider', 'sdwebui');
            expect(mockListener).toHaveBeenCalledTimes(1);
            expect(mockListener).toHaveBeenCalledWith('sdwebui', 'comfyui');

            // 修改其他键不应触发该监听器
            store.set('enabled', false);
            expect(mockListener).toHaveBeenCalledTimes(1);

            // 注销监听后不应再触发
            sub.dispose();
            store.set('activeProvider', 'novelai');
            expect(mockListener).toHaveBeenCalledTimes(1);
        });

        it('批量更新 (update) 应一次性更新并触发全局与对应键级监听', () => {
            const store = new ConfigStore();
            const globalListener = vi.fn();
            const providerListener = vi.fn();

            store.subscribe(globalListener);
            store.subscribeKey('activeProvider', providerListener);

            store.update({
                activeProvider: 'cloud',
                autoGenerate: true
            });

            expect(store.get('activeProvider')).toBe('cloud');
            expect(store.get('autoGenerate')).toBe(true);
            expect(globalListener).toHaveBeenCalledTimes(1);
            expect(providerListener).toHaveBeenCalledWith('cloud', 'comfyui');
        });

        it('防抖保存调度应在指定延迟后触发', () => {
            const onSave = vi.fn();
            const store = new ConfigStore(DEFAULT_SETTINGS, {
                onSave,
                debounceMs: 300
            });

            store.set('themePreset', 'light');
            store.set('themePreset', 'dark');

            expect(onSave).not.toHaveBeenCalled();

            vi.advanceTimersByTime(299);
            expect(onSave).not.toHaveBeenCalled();

            vi.advanceTimersByTime(2);
            expect(onSave).toHaveBeenCalledTimes(1);
            expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ themePreset: 'dark' }));
        });

        it('flush 应立即执行尚未执行的持久化保存', () => {
            const onSave = vi.fn();
            const store = new ConfigStore(DEFAULT_SETTINGS, {
                onSave,
                debounceMs: 300
            });

            store.set('themePreset', 'neon');
            expect(onSave).not.toHaveBeenCalled();

            store.flush();
            expect(onSave).toHaveBeenCalledTimes(1);
        });

        it('getEngineConfig 与 setEngineConfig 应正确存取引擎独立配置', () => {
            const store = new ConfigStore();
            expect(store.getEngineConfig('novelai')).toBeUndefined();

            store.setEngineConfig('novelai', { model: 'nai-diffusion-3', ucPreset: 'heavy' });
            expect(store.getEngineConfig('novelai')).toEqual({
                model: 'nai-diffusion-3',
                ucPreset: 'heavy'
            });
            expect(store.getState().engineConfigs.novelai).toEqual({
                model: 'nai-diffusion-3',
                ucPreset: 'heavy'
            });
        });

        it('exportJson 与 importJson 应支持配置序列化与反序列化导入', () => {
            const store = new ConfigStore();
            store.set('themePreset', 'custom-dark');
            const jsonText = store.exportJson();
            expect(jsonText).toContain('"themePreset": "custom-dark"');

            const targetStore = new ConfigStore();
            expect(targetStore.get('themePreset')).toBe('dark');
            const success = targetStore.importJson(jsonText);
            expect(success).toBe(true);
            expect(targetStore.get('themePreset')).toBe('custom-dark');

            // 非法 JSON 导入应优雅失败返回 false
            const fail = targetStore.importJson('invalid json string');
            expect(fail).toBe(false);
        });
    });
});
