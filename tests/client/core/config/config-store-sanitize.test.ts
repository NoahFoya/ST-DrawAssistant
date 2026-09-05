import { describe, it, expect, vi } from 'vitest';
import { ConfigStore, isSensitiveKey } from '../../../../src/client/core/config/config-store';
import { DrawAssistantSettings } from '../../../../src/client/core/types';

describe('ConfigStore 脱敏与凭据规范管理', () => {
    it('isSensitiveKey 应能精准识别常见命名的敏感凭据字段', () => {
        expect(isSensitiveKey('apiKey')).toBe(true);
        expect(isSensitiveKey('api_key')).toBe(true);
        expect(isSensitiveKey('myApiKey')).toBe(true);
        expect(isSensitiveKey('token')).toBe(true);
        expect(isSensitiveKey('secret')).toBe(true);
        expect(isSensitiveKey('serverUrl')).toBe(false);
        expect(isSensitiveKey('model')).toBe(false);
    });

    it('exportJson(sanitize = true) 应在导出时彻底脱敏敏感凭据', () => {
        const store = new ConfigStore();
        store.setEngineConfig('novelai', {
            model: 'nai-diffusion-4-full',
            apiKey: 'STD-ZiI50G8xVTcizlc0ABKo',
            serverUrl: 'https://image.novelai.net'
        });

        const sanitizedJson = store.exportJson(true);
        const parsed = JSON.parse(sanitizedJson);

        expect(parsed.engineConfigs.novelai.apiKey).toBe('');
        expect(parsed.engineConfigs.novelai.serverUrl).toBe('https://image.novelai.net');

        // exportJson(false) 应保留完整内容
        const rawJson = store.exportJson(false);
        const parsedRaw = JSON.parse(rawJson);
        expect(parsedRaw.engineConfigs.novelai.apiKey).toBe('STD-ZiI50G8xVTcizlc0ABKo');
    });

    it('ConfigStore 持久化保存时直接保存标准配置，使配置天然具备跨设备同步能力', () => {
        let savedState: any = null;
        const onSave = vi.fn((state: DrawAssistantSettings) => {
            savedState = state;
        });

        const store = new ConfigStore(undefined, { onSave });
        store.setEngineConfig('novelai', {
            model: 'nai-diffusion-4-full',
            apiKey: 'STD-ZiI50G8xVTcizlc0ABKo'
        });

        store.flush();

        expect(onSave).toHaveBeenCalled();
        expect(savedState).toBeDefined();
        expect(savedState.engineConfigs.novelai.apiKey).toBe('STD-ZiI50G8xVTcizlc0ABKo');
    });

    it('loadSettings 能无缝加载宿主配置，ready 立即就绪无异步阻塞', async () => {
        const store = new ConfigStore();
        await store.ready;

        const incomingSettings = {
            enabled: true,
            activeProvider: 'cloud',
            engineConfigs: {
                cloud: {
                    provider: 'google',
                    model: 'gemini-2.5-flash-image'
                }
            }
        };

        await store.loadSettings(incomingSettings);

        expect(store.get('activeProvider')).toBe('cloud');
        expect(store.getEngineConfig<any>('cloud').model).toBe('gemini-2.5-flash-image');
    });
});
