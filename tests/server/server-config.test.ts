import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    loadServerConfig,
    getServerConfig,
    getConfiguredKeyStatus,
    resetServerConfigCache
} from '../../src/server/server-config';

describe('ServerConfig (服务端本地配置加载器)', () => {
    let tempDir: string;
    let tempConfigFile: string;

    beforeEach(() => {
        resetServerConfigCache();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-config-test-'));
        tempConfigFile = path.join(tempDir, 'config.json');
    });

    afterEach(() => {
        resetServerConfigCache();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    });

    it('当配置文件存在时应正确解析 apiKeys 与 serverOptions', () => {
        const mockConfig = {
            apiKeys: {
                novelai: 'nai-secret-12345',
                openai: 'sk-test-openai-key',
                gemini: 'gemini-key-777',
                grok: ''
            },
            serverOptions: {
                proxyTimeoutMs: 150000,
                maxPayloadSizeMb: 20,
                enableProxyLog: true,
                allowedHosts: ['127.0.0.1', 'localhost']
            }
        };

        fs.writeFileSync(tempConfigFile, JSON.stringify(mockConfig), 'utf-8');

        const config = loadServerConfig(tempConfigFile);

        expect(config.apiKeys.novelai).toBe('nai-secret-12345');
        expect(config.apiKeys.openai).toBe('sk-test-openai-key');
        expect(config.apiKeys.gemini).toBe('gemini-key-777');
        expect(config.apiKeys.grok).toBe('');
        expect(config.serverOptions.proxyTimeoutMs).toBe(150000);
        expect(config.serverOptions.maxPayloadSizeMb).toBe(20);
        expect(config.serverOptions.enableProxyLog).toBe(true);
    });

    it('当配置文件缺失或损坏时应安全回退至出厂默认配置', () => {
        const config = loadServerConfig(path.join(tempDir, 'non-existent.json'));

        expect(config.apiKeys).toEqual({});
        expect(config.serverOptions.proxyTimeoutMs).toBe(180000);
        expect(config.serverOptions.maxPayloadSizeMb).toBe(10);
        expect(config.serverOptions.enableProxyLog).toBe(false);
    });

    it('getConfiguredKeyStatus 应只返回布尔值状态，绝不泄露明文密钥', () => {
        const mockConfig = {
            apiKeys: {
                novelai: 'my-token',
                openai: '',
                gemini: 'gemini-token',
                grok: '   '
            }
        };

        fs.writeFileSync(tempConfigFile, JSON.stringify(mockConfig), 'utf-8');
        loadServerConfig(tempConfigFile);

        const status = getConfiguredKeyStatus();

        expect(status).toEqual({
            novelai: true,
            openai: false,
            gemini: true,
            grok: false
        });

        // 确保返回值中不包含任何密钥字符串
        const values = Object.values(status);
        for (const v of values) {
            expect(typeof v).toBe('boolean');
        }
    });
});
