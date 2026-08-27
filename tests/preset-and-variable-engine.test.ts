import { describe, it, expect, beforeEach } from 'vitest';
import { ObservableStore } from '../src/core/state/store';
import { DrawAssistantSettings } from '../src/core/state/store-types';
import { ProfileService } from '../src/core/presets/profile-service';
import { cleanPromptFormatting, PARAMETER_VARIABLES } from '../src/core/variables/macro-variables';

describe('Batch 1: Preset Management & Macro Variables Tests', () => {
    let store: ObservableStore<DrawAssistantSettings>;
    let profileService: ProfileService;

    beforeEach(() => {
        store = new ObservableStore<DrawAssistantSettings>({
            version: '0.3.4',
            enabled: true,
            provider: 'comfyui',
            comfyModelProfiles: [],
            comfyModelProfileId: ''
        });
        profileService = new ProfileService(store);
    });

    it('should return built-in profiles when store list is empty', () => {
        const models = profileService.getEffectiveList('model');
        expect(models.length).toBeGreaterThan(0);
        expect(models[0].name).toContain('SDXL');
    });

    it('should create, rename, save and delete model profiles', () => {
        // 1. 新建
        const id = profileService.createProfile('model', '测试模型预设', {
            ckptName: 'my_model.safetensors',
            width: 768,
            height: 1024
        });
        expect(id).toBeDefined();
        expect(profileService.getActiveId('model')).toBe(id);

        // 2. 重命名
        profileService.renameProfile('model', id, '重命名后的模型预设');
        const listAfterRename = profileService.getEffectiveList<any>('model');
        const target = listAfterRename.find((p) => p.id === id);
        expect(target?.name).toBe('重命名后的模型预设');

        // 3. 覆盖保存
        profileService.saveProfile('model', id, {
            ckptName: 'updated_model.safetensors',
            width: 1024,
            height: 1024
        });
        const updated = profileService.getEffectiveList<any>('model').find((p) => p.id === id);
        expect(updated?.data?.ckptName).toBe('updated_model.safetensors');

        // 4. 应用方案到 store
        profileService.applyProfile('model', id);
        expect(store.get('ckptName')).toBe('updated_model.safetensors');
        expect(store.get('width')).toBe(1024);

        // 5. 删除方案
        profileService.deleteProfile('model', id);
        const listAfterDel = profileService.getEffectiveList('model');
        expect(listAfterDel.find((p) => p.id === id)).toBeUndefined();
    });

    it('should clean extra spaces, lines, and duplicate commas correctly', () => {
        const messy = `
            masterpiece, best quality,  
            1girl, solo, , ,
            outdoor, sunny day,
        `;
        const cleaned = cleanPromptFormatting(messy);
        expect(cleaned).toBe('masterpiece, best quality, 1girl, solo, outdoor, sunny day');
    });

    it('should have complete PARAMETER_VARIABLES definition', () => {
        expect(PARAMETER_VARIABLES.length).toBeGreaterThan(10);
        const keys = PARAMETER_VARIABLES.map((v) => v.key);
        expect(keys).toContain('%prompt%');
        expect(keys).toContain('%ckpt_name%');
        expect(keys).toContain('%sampler_name%');
    });
});
