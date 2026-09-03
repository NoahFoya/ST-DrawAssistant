import { describe, it, expect } from 'vitest';
import {
    validateTargetUrl,
    sanitizeRequestHeaders
} from '../../src/server/security';

describe('Server Security Guard', () => {
    describe('validateTargetUrl', () => {
        it('应允许合法外部与本地绘图端点', () => {
            expect(validateTargetUrl('http://127.0.0.1:8188/prompt').valid).toBe(true);
            expect(validateTargetUrl('http://localhost:7860/sdapi/v1/txt2img').valid).toBe(true);
            expect(validateTargetUrl('https://image.novelai.net/ai/generate-image').valid).toBe(true);
            expect(validateTargetUrl('http://192.168.31.20:8188').valid).toBe(true);
            expect(validateTargetUrl('https://api.openai.com/v1/images/generations').valid).toBe(true);
        });

        it('应拒绝非 http/https 协议', () => {
            expect(validateTargetUrl('file:///etc/passwd').valid).toBe(false);
            expect(validateTargetUrl('ftp://server/file').valid).toBe(false);
            expect(validateTargetUrl('javascript:void(0)').valid).toBe(false);
            expect(validateTargetUrl('').valid).toBe(false);
        });

        it('应拦截云服务元数据端点以防范 SSRF 访问', () => {
            expect(validateTargetUrl('http://169.254.169.254/latest/meta-data').valid).toBe(false);
            expect(validateTargetUrl('http://metadata.google.internal/computeMetadata').valid).toBe(false);
            expect(validateTargetUrl('http://100.100.100.200/latest/meta-data').valid).toBe(false);
            expect(validateTargetUrl('http://169.254.1.1/').valid).toBe(false);
        });

        it('应根据 allowedHosts 白名单限制目标，并支持网段与显式配置域名', () => {
            const allowed = ['127.0.0.1', 'localhost', '192.168.0.0/16', '172.16.0.0/12', 'api.deepseek.com'];

            // 白名单内私网主机、已知云端域名与显式允许的域名
            expect(validateTargetUrl('http://127.0.0.1:8188/prompt', allowed).valid).toBe(true);
            expect(validateTargetUrl('http://192.168.1.50:8188/prompt', allowed).valid).toBe(true);
            expect(validateTargetUrl('http://172.20.10.5:8188/prompt', allowed).valid).toBe(true);
            expect(validateTargetUrl('https://image.novelai.net/generate', allowed).valid).toBe(true);
            expect(validateTargetUrl('https://api.openai.com/v1/images/generations', allowed).valid).toBe(true);
            expect(validateTargetUrl('https://api.deepseek.com/v1/images/generations', allowed).valid).toBe(true);

            // 未在白名单的私网 IP 或未显式允许的外网目标
            expect(validateTargetUrl('http://10.0.0.1:8188/prompt', allowed).valid).toBe(false);
            expect(validateTargetUrl('http://8.8.8.8:80/evil', allowed).valid).toBe(false);
            expect(validateTargetUrl('http://malicious-site.com/exploit', allowed).valid).toBe(false);
        });

        it('当 allowedHosts 包含通配符 * 时应全局放行合法外部目标 (包含 DDNS、中转站与全网段)', () => {
            const wildcardAllowed = ['*'];
            expect(validateTargetUrl('http://myhome.ddns.net:8188/prompt', wildcardAllowed).valid).toBe(true);
            expect(validateTargetUrl('https://any-relay-api.com/v1/generate', wildcardAllowed).valid).toBe(true);
            expect(validateTargetUrl('http://10.0.0.1:8188/prompt', wildcardAllowed).valid).toBe(true);

            // 云服务元数据端点不受通配放行影响
            expect(validateTargetUrl('http://169.254.169.254/latest/meta-data', wildcardAllowed).valid).toBe(false);
            expect(validateTargetUrl('http://100.100.100.200/latest/meta-data', wildcardAllowed).valid).toBe(false);
        });

        it('当不传 allowedHosts 时应自动回退至默认配置 (放行合法目标)，传空数组 [] 时应严格拦截非已知域名', () => {
            // 未传 allowedHosts，默认按通配符放行
            expect(validateTargetUrl('http://192.168.1.100:8188/prompt').valid).toBe(true);

            // 显式传 [] 空数组，严格阻断任意自定义目标
            const emptyAllowed: string[] = [];
            expect(validateTargetUrl('http://192.168.1.100:8188/prompt', emptyAllowed).valid).toBe(false);
            expect(validateTargetUrl('http://localhost:8188/prompt', emptyAllowed).valid).toBe(false);
            // 即使传空数组，内置受信任云端域名仍有最低保障
            expect(validateTargetUrl('https://image.novelai.net/generate', emptyAllowed).valid).toBe(true);
        });
    });

    describe('sanitizeRequestHeaders', () => {
        it('应剥离酒馆内部敏感与传输控制标头，并保留业务标头', () => {
            const raw = {
                'X-CSRF-Token': 'secret-st-csrf',
                'Cookie': 'session=abc',
                'Host': 'localhost:8000',
                'Origin': 'http://localhost:8000',
                'Content-Type': 'application/json',
                'Authorization': 'Bearer external-key',
                'Accept': 'image/png'
            };

            const cleaned = sanitizeRequestHeaders(raw);

            expect(cleaned['X-CSRF-Token']).toBeUndefined();
            expect(cleaned['Cookie']).toBeUndefined();
            expect(cleaned['Host']).toBeUndefined();
            expect(cleaned['Origin']).toBeUndefined();
            expect(cleaned['Content-Type']).toBe('application/json');
            expect(cleaned['Authorization']).toBe('Bearer external-key');
            expect(cleaned['Accept']).toBe('image/png');
        });
    });
});
