import { describe, it, expect } from 'vitest';
import {
    joinPromptParts,
    separatePromptByPipe,
    PromptPipeline,
    createPipelineHooks,
    AsyncPipelineHook
} from '../../../src/client/domain';

describe('Prompt Pipeline & Hooks', () => {
    describe('joinPromptParts', () => {
        it('应该安全过滤空值并使用逗号连接', () => {
            const result = joinPromptParts('masterpiece', '', null, '  1girl  ', undefined, 'solo');
            expect(result).toBe('masterpiece, 1girl, solo');
        });

        it('全空输入返回空字符串', () => {
            expect(joinPromptParts('', null, undefined)).toBe('');
        });
    });

    describe('separatePromptByPipe', () => {
        it('应该基于管道符正确分离正负向提示词', () => {
            const input = 'masterpiece, 1girl | worst quality, lowres, bad hands';
            const { positive, negative } = separatePromptByPipe(input);
            expect(positive).toBe('masterpiece, 1girl');
            expect(negative).toBe('worst quality, lowres, bad hands');
        });

        it('无管道符时负向词为空', () => {
            const input = 'masterpiece, 1girl, solo';
            const { positive, negative } = separatePromptByPipe(input);
            expect(positive).toBe('masterpiece, 1girl, solo');
            expect(negative).toBe('');
        });
    });

    describe('AsyncPipelineHook', () => {
        it('应该按优先级升序串行执行并允许修改值', async () => {
            const hook = new AsyncPipelineHook<string>();
            hook.register('second', (val) => `${val} -> 2nd`, 20);
            hook.register('first', (val) => `${val} -> 1st`, 10);

            const result = await hook.call('start', { rawPrompt: 'test' });
            expect(result).toBe('start -> 1st -> 2nd');
        });

        it('register 返回的 disposable 应该能正确注销', async () => {
            const hook = new AsyncPipelineHook<string>();
            const sub = hook.register('temp', (val) => `${val} + temp`);
            let res = await hook.call('base', { rawPrompt: 'test' });
            expect(res).toBe('base + temp');

            sub.dispose();
            res = await hook.call('base', { rawPrompt: 'test' });
            expect(res).toBe('base');
        });

        it('单个拦截器异常不应中断整体链路', async () => {
            const hook = new AsyncPipelineHook<string>();
            hook.register('failing', () => {
                throw new Error('hook error');
            });
            hook.register('succeed', (val) => `${val} ok`);

            const res = await hook.call('init', { rawPrompt: 'test' });
            expect(res).toBe('init ok');
        });

        it('关键拦截器 (critical: true) 异常应直接抛出并中断整体链路', async () => {
            const hook = new AsyncPipelineHook<string>();
            hook.register(
                'critical_failure',
                () => {
                    throw new Error('critical error');
                },
                50,
                true
            );
            hook.register('never_reached', (val) => `${val} unreachable`, 100);

            await expect(hook.call('init', { rawPrompt: 'test' })).rejects.toThrow('critical error');
        });
    });

    describe('PromptPipeline.process', () => {
        it('应该执行拦截器并组装符合架构规范的 GenerationRequest', async () => {
            const hooks = createPipelineHooks();
            const pipeline = new PromptPipeline(hooks);

            hooks.onRawInput.register('prefix-tag', (input) => {
                return `(prefixed) ${input}`;
            });

            hooks.beforePromptBuild.register('char-features', (prompt) => {
                return `${prompt}, silver hair, red eyes`;
            });

            hooks.beforeSubmit.register('audit-tag', (req) => {
                return {
                    ...req,
                    engineOptions: {
                        ...req.engineOptions,
                        audited: true
                    }
                };
            });

            const rawInput = 'A beautiful cinematic shot of a warrior in forest\nwith soft morning light';
            const result = await pipeline.process({
                rawPrompt: rawInput,
                targetEngine: 'comfyui',
                engineOptions: {
                    workflowId: 'default_wf',
                    customSteps: 35
                },
                contextInfo: {
                    characterName: 'Alice',
                    messageId: 42
                }
            });

            // 核心流水线原封不动保留换行与文本结构，结合拦截器输出
            expect(result.prompt).toBe(`(prefixed) ${rawInput}, silver hair, red eyes`);
            expect(result.request.targetEngine).toBe('comfyui');
            expect(result.request.prompt).toBe(`(prefixed) ${rawInput}, silver hair, red eyes`);
            expect(result.request.contextInfo?.characterName).toBe('Alice');
            expect(result.request.contextInfo?.messageId).toBe(42);
            expect(result.request.engineOptions.workflowId).toBe('default_wf');
            expect(result.request.engineOptions.customSteps).toBe(35);
            expect(result.request.engineOptions.audited).toBe(true);
        });

        it('应该通过插件原生功能以首个 | 分隔正负向提示词并保留内部换行结构', async () => {
            const hooks = createPipelineHooks();
            const pipeline = new PromptPipeline(hooks);

            const inputWithPipe = 'masterpiece, 1girl\ncinematic lighting | worst quality, bad hands\nblurry';
            const result = await pipeline.process({
                rawPrompt: inputWithPipe,
                targetEngine: 'sdwebui'
            });

            expect(result.request.prompt).toBe('masterpiece, 1girl\ncinematic lighting');
            expect(result.request.negativePrompt).toBe('worst quality, bad hands\nblurry');
            expect(result.request.targetEngine).toBe('sdwebui');
        });

        it('未注册任何外部拦截器时，纯净流水线应独立完成管道切分与请求组装', async () => {
            const pipeline = new PromptPipeline();

            const input = 'masterpiece, 1girl, standing in forest\ncinematic lighting | low quality, distorted';
            const result = await pipeline.process({
                rawPrompt: input,
                targetEngine: 'novelai',
                contextInfo: {
                    characterName: 'Megumin',
                    userName: 'Kazuma',
                    messageId: 100,
                    chatId: 'chat_abc'
                }
            });

            expect(result.prompt).toBe('masterpiece, 1girl, standing in forest\ncinematic lighting');
            expect(result.request.prompt).toBe('masterpiece, 1girl, standing in forest\ncinematic lighting');
            expect(result.request.negativePrompt).toBe('low quality, distorted');
            expect(result.request.targetEngine).toBe('novelai');
            expect(result.request.contextInfo?.characterName).toBe('Megumin');
            expect(result.request.contextInfo?.userName).toBe('Kazuma');
            expect(result.request.contextInfo?.messageId).toBe(100);

            pipeline.dispose();
        });



        it('流水线销毁后调用应抛错并清空所有已注册钩子', async () => {
            const hooks = createPipelineHooks();
            let hookCalled = false;
            hooks.onRawInput.register('test-hook', (val) => {
                hookCalled = true;
                return val;
            });

            const pipeline = new PromptPipeline(hooks);
            pipeline.dispose();

            await expect(
                pipeline.process({
                    rawPrompt: 'test',
                    targetEngine: 'sdwebui'
                })
            ).rejects.toThrow('已被销毁');

            // 钩子已被清空，直接调用 hook 也不应再执行之前注册的 handler
            await hooks.onRawInput.call('test', { rawPrompt: 'test' });
            expect(hookCalled).toBe(false);
        });
    });
});
