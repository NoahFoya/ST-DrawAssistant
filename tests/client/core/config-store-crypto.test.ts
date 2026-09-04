import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigStore, encryptSettingsCredentials, decryptSettingsCredentials } from '../../../src/client/core/config/config-store';
import { resetDeviceKeyCache } from '../../../src/client/core/crypto/cipher';
import { DrawAssistantSettings } from '../../../src/client/core/types';

describe('ConfigStore & Crypto (前端凭据落盘加密与加载解密全链路)', () => {
    beforeEach(() => {
        resetDeviceKeyCache();
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.clear();
            }
        } catch {}
    });

    it('encryptSettingsCredentials 应将 engineConfigs 中所有敏感 apiKey 转换为密文', async () => {
        const rawSettings: any = {
            enabled: true,
            engineConfigs: {
                novelai: {
                    model: 'nai-diffusion-4-full',
                    apiKey: 'STD-ZiI50G8xVTcizlc0ABKo'
                },
                cloud: {
                    apiKey: 'sk-my-cloud-secret'
                }
            }
        };

        const encrypted = await encryptSettingsCredentials(rawSettings as DrawAssistantSettings);

        expect(encrypted.engineConfigs.novelai.apiKey.startsWith('enc:v1:')).toBe(true);
        expect(encrypted.engineConfigs.novelai.apiKey).not.toContain('STD-ZiI50G8xVTcizlc0ABKo');
        expect(encrypted.engineConfigs.cloud.apiKey.startsWith('enc:v1:')).toBe(true);
        expect(encrypted.engineConfigs.cloud.apiKey).not.toContain('sk-my-cloud-secret');

        // 解密还原验证
        const decrypted = await decryptSettingsCredentials(encrypted);
        expect(decrypted.engineConfigs.novelai.apiKey).toBe('STD-ZiI50G8xVTcizlc0ABKo');
        expect(decrypted.engineConfigs.cloud.apiKey).toBe('sk-my-cloud-secret');
    });

    it('ConfigStore 持久化保存时应将敏感凭据以密文形式交付宿主，杜绝明文落盘', async () => {
        let savedState: any = null;
        const onSave = vi.fn((state: DrawAssistantSettings) => {
            savedState = state;
        });

        const store = new ConfigStore(undefined, { onSave });
        await store.ready;

        store.setEngineConfig('novelai', {
            model: 'nai-diffusion-4-full',
            apiKey: 'STD-ZiI50G8xVTcizlc0ABKo'
        });

        // 立即触发保存
        store.flush();

        // 等待微任务异步加密落盘
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(onSave).toHaveBeenCalled();
        expect(savedState).toBeDefined();
        const persistedApiKey = savedState.engineConfigs.novelai.apiKey;

        expect(persistedApiKey.startsWith('enc:v1:')).toBe(true);
        expect(persistedApiKey).not.toContain('STD-ZiI50G8xVTcizlc0ABKo');

        // 验证内存中持有的仍然是明文供适配器直接使用
        expect(store.getEngineConfig<any>('novelai').apiKey).toBe('STD-ZiI50G8xVTcizlc0ABKo');
    });

    it('使用已加密密文初始化 ConfigStore 时，await ready 应能在内存中透明恢复明文', async () => {
        const secretKey = 'STD-ZiI50G8xVTcizlc0ABKo';
        const rawSettings: any = {
            enabled: true,
            engineConfigs: {
                novelai: {
                    model: 'nai-diffusion-4-full',
                    apiKey: secretKey
                }
            }
        };

        const encryptedSettings = await encryptSettingsCredentials(rawSettings as DrawAssistantSettings);
        expect(encryptedSettings.engineConfigs.novelai.apiKey.startsWith('enc:v1:')).toBe(true);

        // 使用密文初始化全新的 ConfigStore 实例
        const newStore = new ConfigStore(encryptedSettings);
        await newStore.ready;

        // 断言内存中已自动完成透明解密
        const engineConfig = newStore.getEngineConfig<any>('novelai');
        expect(engineConfig.apiKey).toBe(secretKey);
    });
});
