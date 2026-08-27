import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ComfyUIDriver,
    substituteWorkflowVariables,
    loadWorkflow,
    extractFirstOutputImage,
} from '../src/drivers/comfyui';
import { createDriver } from '../src/drivers/factory';
import type { DrawAssistantSettings } from '../src/settings/types';

const mockSettings: DrawAssistantSettings = {
    provider: 'comfyui',
    serverUrl: 'http://127.0.0.1:8188',
    requestTimeout: 10000,
    width: 512,
    height: 512,
    steps: 20,
    cfgScale: 7.0,
    samplerName: 'euler',
} as DrawAssistantSettings;

describe('ComfyUIDriver & Workflow Helpers', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    describe('Factory Integration', () => {
        it('should create ComfyUIDriver instance via createDriver', () => {
            const driver = createDriver('comfyui', mockSettings);
            expect(driver).toBeInstanceOf(ComfyUIDriver);
            expect(driver.name).toBe('comfyui');
        });
    });

    describe('Workflow Helper Functions', () => {
        it('loadWorkflow should parse valid JSON string', () => {
            const sampleJson = JSON.stringify({
                '1': { inputs: { text: 'hello' }, class_type: 'CLIPTextEncode' },
            });
            const result = loadWorkflow(sampleJson);
            expect(result['1'].class_type).toBe('CLIPTextEncode');
        });

        it('substituteWorkflowVariables should correctly replace %prompt%, %width%, %steps%, %seed%', () => {
            const template = JSON.stringify({
                '1': {
                    inputs: {
                        text: '%prompt%',
                        negative: '%negative_prompt%',
                        width: '%width%',
                        height: '%height%',
                        steps: '%steps%',
                        seed: '%seed%',
                    },
                    class_type: 'KSampler',
                },
            });

            const options = {
                prompt: 'a vibrant sunset',
                negativePrompt: 'low quality',
                width: 1024,
                height: 768,
                steps: 25,
                cfgScale: 7.5,
                samplerName: 'euler',
                seed: 123456,
            };

            const result = substituteWorkflowVariables(template, options);
            expect(result['1'].inputs.text).toBe('a vibrant sunset');
            expect(result['1'].inputs.negative).toBe('low quality');
            expect(result['1'].inputs.width).toBe(1024);
            expect(result['1'].inputs.height).toBe(768);
            expect(result['1'].inputs.steps).toBe(25);
            expect(result['1'].inputs.seed).toBe(123456);
        });

        it('extractFirstOutputImage should extract image filename from outputs', () => {
            const outputs = {
                '99': {
                    images: [
                        { filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' },
                    ],
                },
            };

            const result = extractFirstOutputImage(outputs, '99');
            expect(result).toEqual({
                filename: 'ComfyUI_00001_.png',
                subfolder: '',
                type: 'output',
            });
        });
    });

    describe('Driver API Methods', () => {
        it('checkConnection should return connected: true when /system_stats returns ok', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ system: {} }),
            });

            const driver = new ComfyUIDriver(mockSettings);
            const result = await driver.checkConnection();
            expect(result.connected).toBe(true);
            expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:8188/system_stats', expect.anything());
        });

        it('checkConnection should return connected: false on fetch failure', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

            const driver = new ComfyUIDriver(mockSettings);
            const result = await driver.checkConnection();
            expect(result.connected).toBe(false);
            expect(result.error).toContain('Connection refused');
        });
    });

    describe('Micro-Reset Preset Profiles', () => {
        beforeEach(() => {
            (global as any).window = {
                SillyTavern: {
                    getContext: () => ({
                        extensionSettings: { 'st-drawassistant': {} },
                        saveSettingsDebounced: () => {},
                        eventSource: { emit: () => {} },
                    }),
                },
            };
        });

        it('resetModelProfilesToDefault should restore comfyModelProfiles to default without affecting other settings', async () => {
            const { resetModelProfilesToDefault } = await import('../src/settings/manager');
            const settings = resetModelProfilesToDefault();
            expect(Array.isArray(settings.comfyModelProfiles)).toBe(true);
            expect(settings.comfyModelProfiles.length).toBeGreaterThan(0);
            expect(settings.comfyModelProfileId).toBeDefined();
        });

        it('resetPromptProfilesToDefault should restore comfyPromptProfiles to default', async () => {
            const { resetPromptProfilesToDefault } = await import('../src/settings/manager');
            const settings = resetPromptProfilesToDefault();
            expect(Array.isArray(settings.comfyPromptProfiles)).toBe(true);
            expect(settings.comfyPromptProfiles.length).toBeGreaterThan(0);
            expect(settings.comfyPromptProfileId).toBeDefined();
        });

        it('resetWorkflowProfilesToDefault should restore comfyTxt2ImgWorkflows and comfyInpaintWorkflows to default', async () => {
            const { resetWorkflowProfilesToDefault } = await import('../src/settings/manager');
            const settings = resetWorkflowProfilesToDefault();
            expect(Array.isArray(settings.comfyTxt2ImgWorkflows)).toBe(true);
            expect(settings.comfyTxt2ImgWorkflows.length).toBeGreaterThan(0);
            expect(Array.isArray(settings.comfyInpaintWorkflows)).toBe(true);
            expect(settings.comfyInpaintWorkflows.length).toBeGreaterThan(0);
            expect(settings.comfyTxt2ImgWorkflowId).toBeDefined();
            expect(settings.comfyInpaintWorkflowId).toBeDefined();
        });
    });
});
