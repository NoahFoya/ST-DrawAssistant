// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    CharacterManagerExtension,
    CharacterStorage
} from '../src/extensions/character-manager';
import { createKernelContext } from '../src/core';
import { createPipelineHooks, PromptPipeline } from '../src/domain';
import { VERSION } from '../src/core/constants';

describe('Batch 5: Character Manager Extension Tests (Specification Aligned)', () => {
    it('should implement IExtension contract and register hooks and tabs upon activation', async () => {
        const context = createKernelContext(VERSION);
        context.hooks = createPipelineHooks();

        const ext = new CharacterManagerExtension();
        expect(ext.id).toBe('character-manager');
        expect(ext.name).toBe('角色与服装预设管理');
        expect(ext.version).toBe(VERSION);

        // 保存测试角色数据
        const mockStorage = new CharacterStorage(context.host);
        mockStorage.saveCharacters([
            {
                id: 'char_1',
                nameCN: '刻晴',
                nameEN: 'keqing (genshin impact)',
                bodyTraits: 'purple hair, twin braids',
                facialFeatures: 'purple eyes',
                facialFeaturesBack: '',
                upperBodySFW: '',
                upperBodySFWBack: '',
                sideBodySFW: '',
                lowerBodySFW: '',
                lowerBodySFWBack: '',
                upperBodyNSFW: '',
                upperBodyNSFWBack: '',
                lowerBodyNSFW: '',
                lowerBodyNSFWBack: '',
                negativePrompt: '',
                outfitList: []
            }
        ]);

        ext.activate(context);

        // 验证 Tab 已注册
        const tab = context.ui.getTab('character-manager');
        expect(tab).toBeDefined();
        expect(tab?.title).toBe('角色管理');

        const pipeline = new PromptPipeline(context.hooks);
        const result = await pipeline.process(
            {
                rawPrompt: '1girl, $刻晴$',
                messageId: 1,
                chatId: 'chat_1'
            },
            context.store.getState()
        );

        expect(result.payload.prompt).toContain('keqing (genshin impact)');
        expect(result.payload.prompt).toContain('purple hair, twin braids');

        ext.deactivate();
        context.dispose();
    });
});
