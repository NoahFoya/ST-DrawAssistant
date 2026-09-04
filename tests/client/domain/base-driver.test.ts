import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    BaseDriver,
    DriverError,
    DriverErrorType,
    EngineCapabilities,
    GenerationRequest,
    GenerationResult
} from '../../../src/client/domain';
import { NetworkClient } from '../../../src/client/core/network/client';
import { NetworkError } from '../../../src/client/core/network/error';

class TestDriver extends BaseDriver {
    public readonly id = 'test-driver';
    public readonly name = 'Test Driver';
    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: false
    };

    public pingResult = true;
    public syncCount = 0;

    public async ping(): Promise<boolean> {
        if (!this.pingResult) {
            throw new Error('Ping connection failed');
        }
        return true;
    }

    protected async doGenerate(request: GenerationRequest): Promise<GenerationResult> {
        this.checkCancelled();
        return {
            taskId: request.taskId,
            engine: this.id,
            images: [{ blob: new Blob(['fake-image'], { type: 'image/png' }), format: 'image/png' }],
            durationMs: 10
        };
    }

    protected override async doSyncAssets() {
        this.syncCount++;
        await new Promise((r) => setTimeout(r, 20));
        return {
            models: ['model1', 'model2']
        };
    }

    public testBuildUrl(path: string) {
        return this.buildUrl(path);
    }

    public testGetJson<T>(path: string, options?: any) {
        return this.getJson<T>(path, options);
    }

    public testPostJson<T>(path: string, body: unknown, options?: any) {
        return this.postJson<T>(path, body, options);
    }

    public testGetBlob(path: string, options?: any) {
        return this.getBlob(path, options);
    }

    public testUploadFormData<T>(path: string, fd: FormData, options?: any) {
        return this.uploadFormData<T>(path, fd, options);
    }

    public testCheckCancelled() {
        this.checkCancelled();
    }
}

describe('BaseDriver', () => {
    let mockNetwork: Partial<NetworkClient>;
    let driver: TestDriver;

    beforeEach(() => {
        mockNetwork = {
            fetchExternal: vi.fn()
        };
        driver = new TestDriver({
            network: mockNetwork as NetworkClient,
            driverName: 'TestDriver',
            getEndpointUrl: () => 'http://127.0.0.1:7860/'
        });
    });

    describe('URL 构建与路径规范化', () => {
        it('应该规范化去除基础 URL 的尾部斜杠并拼接相对路径', () => {
            expect(driver.testBuildUrl('/api/v1/txt2img')).toBe('http://127.0.0.1:7860/api/v1/txt2img');
            expect(driver.testBuildUrl('api/v1/txt2img')).toBe('http://127.0.0.1:7860/api/v1/txt2img');
        });

        it('绝对路径应该原样返回', () => {
            expect(driver.testBuildUrl('https://api.example.com/generate')).toBe('https://api.example.com/generate');
        });
    });

    describe('checkHealth', () => {
        it('服务正常时应返回 ok: true 与耗时', async () => {
            driver.pingResult = true;
            const res = await driver.checkHealth();
            expect(res.ok).toBe(true);
            expect(typeof res.latencyMs).toBe('number');
            expect(res.latencyMs).toBeGreaterThanOrEqual(0);
        });

        it('服务异常时应捕获错误并返回 ok: false', async () => {
            driver.pingResult = false;
            const res = await driver.checkHealth();
            expect(res.ok).toBe(false);
            expect(res.message).toBe('Ping connection failed');
        });
    });

    describe('网络请求方法封装与错误归一化', () => {
        it('getJson / postJson 正常解析返回', async () => {
            (mockNetwork.fetchExternal as any).mockResolvedValueOnce(
                new Response(JSON.stringify({ success: true, count: 10 }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            );

            const data = await driver.testGetJson<{ success: boolean; count: number }>('/info');
            expect(data.success).toBe(true);
            expect(data.count).toBe(10);
            expect(mockNetwork.fetchExternal).toHaveBeenCalledWith(
                'http://127.0.0.1:7860/info',
                expect.objectContaining({ method: 'GET' })
            );
        });

        it('getBlob 成功返回 Blob', async () => {
            const blobData = new Blob(['image-content'], { type: 'image/png' });
            (mockNetwork.fetchExternal as any).mockResolvedValueOnce(
                new Response(blobData, { status: 200 })
            );

            const blob = await driver.testGetBlob('/view?id=123');
            expect(blob).toBeInstanceOf(Blob);
        });

        it('后端返回 404 时应抛出 NOT_FOUND 类型的 DriverError', async () => {
            (mockNetwork.fetchExternal as any).mockResolvedValueOnce(
                new Response(JSON.stringify({ error: 'Endpoint not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                })
            );

            let caught: any = null;
            try {
                await driver.testGetJson('/unknown');
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeInstanceOf(DriverError);
            expect(caught?.type).toBe(DriverErrorType.NOT_FOUND);
            expect(caught?.statusCode).toBe(404);
        });

        it('网络超时时归一化为 TIMEOUT DriverError', async () => {
            (mockNetwork.fetchExternal as any).mockRejectedValueOnce(
                new NetworkError({
                    message: 'Direct timeout 60000ms',
                    code: 'TIMEOUT',
                    targetUrl: 'http://127.0.0.1:7860/generate'
                })
            );

            let caught: any = null;
            try {
                await driver.testGetJson('/generate');
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeInstanceOf(DriverError);
            expect(caught?.type).toBe(DriverErrorType.TIMEOUT);
        });
    });

    describe('任务中断与取消', () => {
        it('调用 interrupt 后 checkCancelled 应抛出 CANCELLED 错误', async () => {
            expect(() => driver.testCheckCancelled()).not.toThrow();

            await driver.interrupt();
            expect(() => driver.testCheckCancelled()).toThrowError(DriverError);
            try {
                driver.testCheckCancelled();
            } catch (err: any) {
                expect(err.type).toBe(DriverErrorType.CANCELLED);
            }
        });

        it('generate 会在开始时重置取消态', async () => {
            await driver.interrupt();
            expect(() => driver.testCheckCancelled()).toThrow();

            const result = await driver.generate({
                taskId: 'test-gen',
                targetEngine: 'test-driver',
                prompt: 'a girl',
                engineOptions: {}
            });
            expect(result.images.length).toBe(1);
        });
    });

    describe('syncAssets 在途请求复用', () => {
        it('并发调用 syncAssets 时只应发起一次实际拉取', async () => {
            const p1 = driver.syncAssets();
            const p2 = driver.syncAssets();
            const p3 = driver.syncAssets();

            const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
            expect(r1.models).toEqual(['model1', 'model2']);
            expect(r2.models).toEqual(['model1', 'model2']);
            expect(r3.models).toEqual(['model1', 'model2']);
            expect(driver.syncCount).toBe(1);
        });
    });
});
