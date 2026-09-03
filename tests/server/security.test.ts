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

        it('应严密拦截云元数据 SSRF 攻击端点', () => {
            expect(validateTargetUrl('http://169.254.169.254/latest/meta-data').valid).toBe(false);
            expect(validateTargetUrl('http://metadata.google.internal/computeMetadata').valid).toBe(false);
            expect(validateTargetUrl('http://100.100.100.200/latest/meta-data').valid).toBe(false);
            expect(validateTargetUrl('http://169.254.1.1/').valid).toBe(false);
        });

        it('应根据 allowedHosts 白名单严格限制非允许目标主机', () => {
            const allowed = ['127.0.0.1', 'localhost', '192.168.0.0/16'];

            // 白名单内或已知云端域名
            expect(validateTargetUrl('http://127.0.0.1:8188/prompt', allowed).valid).toBe(true);
            expect(validateTargetUrl('http://192.168.1.50:8188/prompt', allowed).valid).toBe(true);
            expect(validateTargetUrl('https://image.novelai.net/generate', allowed).valid).toBe(true);
            expect(validateTargetUrl('https://api.openai.com/v1/images/generations', allowed).valid).toBe(true);

            // 非白名单内的主机或公网 IP
            expect(validateTargetUrl('http://10.0.0.1:8188/prompt', allowed).valid).toBe(false);
            expect(validateTargetUrl('http://8.8.8.8:80/evil', allowed).valid).toBe(false);
            expect(validateTargetUrl('https://malicious-site.com/exploit', allowed).valid).toBe(false);
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
