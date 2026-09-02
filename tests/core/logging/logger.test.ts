import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../../../src/core/logging/logger';
import { LogLevel } from '../../../src/core/types';

describe('Logger', () => {
    beforeEach(() => {
        Logger.setLogLevel(LogLevel.DEBUG);
    });

    it('输出包含标准前缀与模块标识', () => {
        const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const logger = new Logger('TestModule');

        logger.info('信息输出测试', { foo: 'bar' });
        expect(consoleInfoSpy).toHaveBeenCalledWith(
            '[ST-DrawAssistant][TestModule]',
            '信息输出测试',
            { foo: 'bar' }
        );
        consoleInfoSpy.mockRestore();
    });

    it('日志级别过滤应正常生效', () => {
        const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        Logger.setLogLevel(LogLevel.WARN);
        const logger = new Logger('FilterModule');

        logger.debug('这应该被忽略');
        expect(consoleDebugSpy).not.toHaveBeenCalled();

        logger.warn('这应该被记录');
        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

        consoleDebugSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });
});
