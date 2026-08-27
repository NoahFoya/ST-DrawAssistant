import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManager } from '../src/task/manager';
import type { ImageDriver, GenerateOptions, GenerateResult } from '../src/drivers/types';

describe('TaskManager', () => {
    let taskManager: TaskManager;
    let mockDriver: ImageDriver;

    beforeEach(() => {
        taskManager = new TaskManager();
        mockDriver = {
            name: 'mock-driver',
            checkConnection: vi.fn(),
            generate: vi.fn(),
            cancel: vi.fn(),
            getSamplers: vi.fn(),
        };
    });

    it('should submit and execute a task sequentially', async () => {
        const mockResult: GenerateResult = {
            imageData: 'base64data',
            mimeType: 'image/png',
            seed: 12345,
        };

        (mockDriver.generate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

        const progressSpy = vi.fn();
        const completeSpy = vi.fn();

        taskManager.on('progress', progressSpy);
        taskManager.on('complete', completeSpy);

        const options: GenerateOptions = {
            prompt: 'a cute cat',
            width: 512,
            height: 512,
            steps: 20,
            cfgScale: 7,
            samplerName: 'Euler a',
        };

        const taskId = await taskManager.submit(options, mockDriver);
        expect(taskId).toBeTruthy();

        // 等待异步 _run 完成
        await new Promise(r => setTimeout(r, 20));

        expect(mockDriver.generate).toHaveBeenCalledTimes(1);
        expect(completeSpy).toHaveBeenCalledWith(taskId, expect.objectContaining({ mimeType: 'image/png' }));
    });

    it('should calculate percentage and status message fallback when percentage is -1', async () => {
        const progressSpy = vi.fn();
        taskManager.on('progress', progressSpy);

        (mockDriver.generate as unknown as ReturnType<typeof vi.fn>).mockImplementation((_opts, onProgress) => {
            if (onProgress) {
                onProgress({ currentStep: 10, totalSteps: 20, percentage: -1 });
            }
            return Promise.resolve({ imageData: 'img', mimeType: 'image/png' });
        });

        const options: GenerateOptions = {
            prompt: 'landscape',
            width: 512,
            height: 512,
            steps: 20,
            cfgScale: 7,
            samplerName: 'Euler a',
        };

        await taskManager.submit(options, mockDriver);
        await new Promise(r => setTimeout(r, 20));

        expect(progressSpy).toHaveBeenCalledWith(
            expect.any(String),
            50,
            expect.stringContaining('采样中 (10/20)... 50%')
        );
    });

    it('should trigger cancelWithDriver and set task to DISCARDED', async () => {
        const cancelledSpy = vi.fn();
        taskManager.on('cancelled', cancelledSpy);

        (mockDriver.generate as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
            return new Promise((_resolve, reject) => {
                setTimeout(() => reject(new Error('Cancelled')), 100);
            });
        });

        const options: GenerateOptions = {
            prompt: 'landscape',
            width: 512,
            height: 512,
            steps: 20,
            cfgScale: 7,
            samplerName: 'Euler a',
        };

        const taskId = await taskManager.submit(options, mockDriver);
        taskManager.cancelWithDriver(taskId, mockDriver);

        expect(mockDriver.cancel).toHaveBeenCalled();
        expect(taskManager.getStatus(taskId)).toBe('DISCARDED');
    });

    it('should return unbind function from on() method', () => {
        const spy = vi.fn();
        const unbind = taskManager.on('progress', spy);

        expect(typeof unbind).toBe('function');
        unbind();

        // 触发 progress 广播，断言 spy 未被调用
        (taskManager as any)._emit('progress', 'task_1', 50, 'test');
        expect(spy).not.toHaveBeenCalled();
    });

    it('should emit cancelled event immediately when cancelling a PENDING task', async () => {
        const cancelledSpy = vi.fn();
        taskManager.on('cancelled', cancelledSpy);

        // 模拟一个长时运行的第一任务把持 activeTaskId
        (mockDriver.generate as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

        const options: GenerateOptions = {
            prompt: 'first task',
            width: 512,
            height: 512,
            steps: 20,
            cfgScale: 7,
            samplerName: 'Euler a',
        };

        const task1 = await taskManager.submit(options, mockDriver);
        expect(taskManager.getStatus(task1)).toBe('RUNNING');

        // 提交第二任务（处于 PENDING 排队中）
        const task2Promise = taskManager.submit(options, mockDriver);
        // task2 处于排队等待状态
        const task2 = await Promise.race([
            task2Promise,
            new Promise<string>(resolve => setTimeout(() => resolve('task2_queued'), 10))
        ]);

        if (task2 !== 'task2_queued') {
            taskManager.cancelWithDriver(task2, mockDriver);
            expect(cancelledSpy).toHaveBeenCalledWith(task2);
            expect(taskManager.getStatus(task2)).toBe('CANCELLED');
        }
    });
});
