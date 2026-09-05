import {
    validateTargetUrl,
    sanitizeRequestHeaders,
    filterSafeResponseHeaders
} from '../../src/server/security';

describe('Server Security Guard', () => {
    describe('validateTargetUrl', () => {
        it('应允许在白名单内的外部与本地绘图端点', () => {
            const allowed = ['127.0.0.1', 'localhost', '192.168.31.20'];
            expect(validateTargetUrl('http://127.0.0.1:8188/prompt', allowed).valid).toBe(true);
            expect(validateTargetUrl('http://localhost:7860/sdapi/v1/txt2img', allowed).valid).toBe(true);
            expect(validateTargetUrl('https://image.novelai.net/ai/generate-image', allowed).valid).toBe(true);
            expect(validateTargetUrl('http://192.168.31.20:8188', allowed).valid).toBe(true);
            expect(validateTargetUrl('https://api.openai.com/v1/images/generations', allowed).valid).toBe(true);
        });

        it('应拒绝非 http/https 协议', () => {
            expect(validateTargetUrl('file:///etc/passwd').valid).toBe(false);
            expect(validateTargetUrl('ftp://server/file').valid).toBe(false);
            expect(validateTargetUrl('javascript:void(0)').valid).toBe(false);
            expect(validateTargetUrl('').valid).toBe(false);
        });

        it('当不配置白名单时，默认非过度防御策略应放行局域网与合法外部端点', () => {
            // 默认允许局域网 IP 与自建中转端点，免受繁琐白名单拦截
            expect(validateTargetUrl('http://localhost:8188/prompt').valid).toBe(true);
            expect(validateTargetUrl('http://127.0.0.1:7860/sdapi/v1/txt2img').valid).toBe(true);
            expect(validateTargetUrl('http://192.168.1.100:8188/prompt').valid).toBe(true);
            expect(validateTargetUrl('http://10.0.0.5:8188/prompt').valid).toBe(true);
            expect(validateTargetUrl('https://image.novelai.net/generate').valid).toBe(true);
            expect(validateTargetUrl('https://api.openai.com/v1/images/generations').valid).toBe(true);
            expect(validateTargetUrl('https://my-relay-api.com/v1/generate').valid).toBe(true);
        });

        it('若显式配置了 allowedHosts，则严格遵循白名单规则限制', () => {
            const allowed = ['127.0.0.1', 'localhost', '192.168.0.0/16', 'api.openai.com'];

            // 白名单内主机
            expect(validateTargetUrl('http://127.0.0.1:8188/prompt', allowed).valid).toBe(true);
            expect(validateTargetUrl('http://192.168.1.50:8188/prompt', allowed).valid).toBe(true);
            expect(validateTargetUrl('https://api.openai.com/v1/images/generations', allowed).valid).toBe(true);

            // 未在显式白名单中的目标
            expect(validateTargetUrl('http://10.0.0.1:8188/prompt', allowed).valid).toBe(false);
            expect(validateTargetUrl('https://api.deepseek.com/v1/images/generations', allowed).valid).toBe(false);
        });

        it('必须硬阻断云厂商元数据端点 (169.254.169.254 / metadata.google.internal)，无论白名单如何配置', () => {
            expect(validateTargetUrl('http://169.254.169.254/latest/meta-data/').valid).toBe(false);
            expect(validateTargetUrl('http://169.254.169.254:8080/').valid).toBe(false);
            expect(validateTargetUrl('http://metadata.google.internal/computeMetadata/v1/').valid).toBe(false);
            expect(validateTargetUrl('http://169.254.1.1/test').valid).toBe(false);
            // 即使传入了 ['*'] 或显式白名单，也必须被硬阻断
            expect(validateTargetUrl('http://169.254.169.254/', ['*']).valid).toBe(false);
            expect(validateTargetUrl('http://169.254.169.254/', ['169.254.169.254']).valid).toBe(false);
        });

        it('当显式传入空白名单 allowedHosts: [] 时，严格拒绝自定义/未授权外部端点，但安全放行本地回环与内置云服务', () => {
            const emptyAllowed: string[] = [];
            // 自定义第三方端点必须被拒绝
            expect(validateTargetUrl('http://10.0.0.1:8188/prompt', emptyAllowed).valid).toBe(false);
            expect(validateTargetUrl('https://custom-proxy.example.com/v1', emptyAllowed).valid).toBe(false);
            // 本地回环与内置云服务域名始终放行
            expect(validateTargetUrl('http://127.0.0.1:8188/prompt', emptyAllowed).valid).toBe(true);
            expect(validateTargetUrl('https://api.openai.com/v1/images/generations', emptyAllowed).valid).toBe(true);
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

    describe('filterSafeResponseHeaders', () => {
        it('应成功过滤 set-cookie、content-length 及逐跳传输头，并保留安全业务标头', () => {
            const mockHeaders = new Headers();
            mockHeaders.set('content-type', 'image/png');
            mockHeaders.set('set-cookie', 'session=injected_val; Path=/; HttpOnly');
            mockHeaders.set('content-length', '102400');
            mockHeaders.set('connection', 'keep-alive');
            mockHeaders.set('x-request-id', 'req-test-123');

            const setHeaders: Record<string, string> = {};
            const mockRes: any = {
                setHeader: (key: string, val: string) => {
                    setHeaders[key.toLowerCase()] = val;
                }
            };

            filterSafeResponseHeaders(mockHeaders, mockRes);

            expect(setHeaders['content-type']).toBe('image/png');
            expect(setHeaders['x-request-id']).toBe('req-test-123');
            expect(setHeaders['set-cookie']).toBeUndefined();
            expect(setHeaders['content-length']).toBeUndefined();
            expect(setHeaders['connection']).toBeUndefined();
        });
    });
});
