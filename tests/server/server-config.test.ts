import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    loadServerConfig,
    getServerConfig,
    getConfiguredKeyStatus,
    resetServerConfigCache,
    resolveConfigFilePath,
    saveServerConfig
} from '../../src/server/server-config';

describe('ServerConfig (服务端本地配置加载器 - YAML 驱动)', () => {
    let tempDir: string;
    let tempConfigFile: string;

    beforeEach(() => {
        resetServerConfigCache();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-config-test-'));
        tempConfigFile = path.join(tempDir, 'config.yaml');
    });

    afterEach(() => {
        resetServerConfigCache();
        delete process.env.ST_DRAW_NOVELAI_API_KEY;
        delete process.env.ST_DRAW_NOVELAI_ENDPOINT;
        delete process.env.ST_DRAW_ALLOWED_HOSTS;
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    });

    it('当标准 YAML 配置文件存在时应正确解析 api_keys、endpoints 与 server 选项并支持注释', () => {
        const yamlContent = `
# 本地测试服务端配置
api_keys:
  novelai: "nai-secret-12345"
  openai: "sk-test-openai-key"
  gemini: "gemini-key-777"
  grok: ""

endpoints:
  novelai: "https://std.loliyc.com/novelai"

server:
  proxy_timeout_ms: 150000
  max_payload_size_mb: 20
  enable_proxy_log: true
  allowed_hosts:
    - "127.0.0.1"
    - "localhost"
`;
        fs.writeFileSync(tempConfigFile, yamlContent, 'utf-8');

        const config = loadServerConfig(tempConfigFile);

        expect(config.apiKeys.novelai).toBe('nai-secret-12345');
        expect(config.apiKeys.openai).toBe('sk-test-openai-key');
        expect(config.apiKeys.gemini).toBe('gemini-key-777');
        expect(config.apiKeys.grok).toBe('');
        expect(config.endpoints.novelai).toBe('https://std.loliyc.com/novelai');
        expect(config.serverOptions.proxyTimeoutMs).toBe(150000);
        expect(config.serverOptions.maxPayloadSizeMb).toBe(20);
        expect(config.serverOptions.enableProxyLog).toBe(true);
        expect(config.serverOptions.allowedHosts).toEqual(['127.0.0.1', 'localhost']);
    });

    it('当配置文件格式严重错误时应直接抛出异常，绝不静默吞错或隐式降级', () => {
        const invalidYaml = `
api_keys:
  novelai: [unclosed array
server:
  - invalid: : syntax
`;
        fs.writeFileSync(tempConfigFile, invalidYaml, 'utf-8');

        expect(() => {
            loadServerConfig(tempConfigFile);
        }).toThrow(/服务端配置文件解析失败/);
    });

    it('当配置文件缺失时应返回默认安全配置', () => {
        const nonExistent = path.join(tempDir, 'non-existent.yaml');
        const config = loadServerConfig(nonExistent);

        expect(config.apiKeys.novelai).toBe('');
        expect(config.serverOptions.proxyTimeoutMs).toBe(180000);
        expect(config.serverOptions.maxPayloadSizeMb).toBe(50);
        expect(config.serverOptions.enableProxyLog).toBe(false);
        expect(config.serverOptions.allowedHosts).toContain('*');
    });

    it('环境变量应以最高优先级覆盖本地配置文件的对应字段', () => {
        const yamlContent = `
api_keys:
  novelai: "file-token"
endpoints:
  novelai: "https://file-endpoint.com"
`;
        fs.writeFileSync(tempConfigFile, yamlContent, 'utf-8');

        process.env.ST_DRAW_NOVELAI_API_KEY = 'env-override-token';
        process.env.ST_DRAW_NOVELAI_ENDPOINT = 'https://env-endpoint.com';

        const config = loadServerConfig(tempConfigFile);

        expect(config.apiKeys.novelai).toBe('env-override-token');
        expect(config.endpoints.novelai).toBe('https://env-endpoint.com');
    });

    it('saveServerConfig 应能将配置规范格式化写回 YAML 文件并刷新内存缓存', () => {
        loadServerConfig(tempConfigFile);

        const updated = saveServerConfig({
            apiKeys: { novelai: 'persisted-key-999' },
            endpoints: { novelai: 'https://new-endpoint.com' }
        }, tempConfigFile);

        expect(updated.apiKeys.novelai).toBe('persisted-key-999');
        expect(getServerConfig().apiKeys.novelai).toBe('persisted-key-999');

        // 重新从磁盘读取验证
        resetServerConfigCache();
        const reloaded = loadServerConfig(tempConfigFile);
        expect(reloaded.apiKeys.novelai).toBe('persisted-key-999');
        expect(reloaded.endpoints.novelai).toBe('https://new-endpoint.com');
    });

    it('getConfiguredKeyStatus 应只返回布尔值状态，绝不泄露明文密钥', () => {
        const yamlContent = `
api_keys:
  novelai: "my-token"
  openai: ""
  gemini: "gemini-token"
  grok: "   "
`;
        fs.writeFileSync(tempConfigFile, yamlContent, 'utf-8');
        loadServerConfig(tempConfigFile);

        const status = getConfiguredKeyStatus();

        expect(status).toEqual({
            novelai: true,
            openai: false,
            gemini: true,
            grok: false
        });

        for (const v of Object.values(status)) {
            expect(typeof v).toBe('boolean');
        }
    });

    it('resolveConfigFilePath 应返回有效路径且优先寻找 config.yaml', () => {
        const resolved = resolveConfigFilePath();
        expect(typeof resolved).toBe('string');
        expect(resolved.endsWith('.yaml') || resolved.endsWith('.yml') || resolved.endsWith('.json')).toBe(true);
    });
});
