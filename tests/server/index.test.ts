import { describe, it, expect, vi } from 'vitest';
import { init, exit, info } from '../../src/server/index';
import { PLUGIN_ID, EXTENSION_NAME, EXTENSION_VERSION } from '../../src/common';

describe('Server Plugin Entry (init & routes)', () => {
    function createMockRouter() {
        const routes: Record<string, Record<string, (req: any, res: any) => void>> = {
            GET: {},
            POST: {}
        };
        return {
            get: (path: string, handler: (req: any, res: any) => void) => {
                routes.GET[path] = handler;
            },
            post: (path: string, handler: (req: any, res: any) => void) => {
                routes.POST[path] = handler;
            },
            routes
        };
    }

    it('info 应声明正确的插件标识与名称', () => {
        expect(info.id).toBe(PLUGIN_ID);
        expect(info.name).toContain(EXTENSION_NAME);
    });

    it('init 应挂载 /health, /proxy, /credentials 路由', async () => {
        const mockRouter = createMockRouter();
        await init(mockRouter as any);

        expect(mockRouter.routes.GET['/health']).toBeDefined();
        expect(mockRouter.routes.POST['/proxy']).toBeDefined();
        expect(mockRouter.routes.POST['/credentials']).toBeDefined();
    });

    it('/health 路由应返回正确的插件健康状态与版本', async () => {
        const mockRouter = createMockRouter();
        await init(mockRouter as any);

        let statusCode = 200;
        let responseJson: any = null;
        const res = {
            status: (code: number) => { statusCode = code; return res; },
            json: (data: any) => { responseJson = data; return res; }
        };

        mockRouter.routes.GET['/health']({} as any, res as any);
        expect(responseJson.status).toBe('ok');
        expect(responseJson.plugin).toBe(PLUGIN_ID);
        expect(responseJson.version).toBe(EXTENSION_VERSION);
    });

    it('/credentials 路由未携带 x-csrf-token 时应返回 403 Forbidden', async () => {
        const mockRouter = createMockRouter();
        await init(mockRouter as any);

        let statusCode = 200;
        let responseJson: any = null;
        const res = {
            status: (code: number) => { statusCode = code; return res; },
            json: (data: any) => { responseJson = data; return res; }
        };

        const req = {
            headers: {},
            body: { apiKeys: { novelai: 'test-key' } }
        };

        mockRouter.routes.POST['/credentials'](req as any, res as any);
        expect(statusCode).toBe(403);
        expect(responseJson.success).toBe(false);
        expect(responseJson.error).toContain('CSRF');
    });

    it('/credentials 路由携带合法 x-csrf-token 时应允许更新凭据', async () => {
        const mockRouter = createMockRouter();
        await init(mockRouter as any);

        let statusCode = 200;
        let responseJson: any = null;
        const res = {
            status: (code: number) => { statusCode = code; return res; },
            json: (data: any) => { responseJson = data; return res; }
        };

        const req = {
            headers: {
                'x-csrf-token': 'valid-csrf-token-123'
            },
            body: {
                apiKeys: { novelai: 'test-key' }
            }
        };

        mockRouter.routes.POST['/credentials'](req as any, res as any);
        expect(statusCode).toBe(200);
        expect(responseJson.success).toBe(true);
        expect(responseJson.configuredKeys).toBeDefined();
    });

    it('exit 应能安全执行无异常', async () => {
        await expect(exit()).resolves.toBeUndefined();
    });
});
