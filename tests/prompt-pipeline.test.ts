import { describe, it, expect } from 'vitest';
import {
    cleanRenderedText,
    combinePrefixesWithDeduplication,
    buildFinalPrompt,
} from '../src/core/prompt-pipeline';
import { substituteWorkflowVariables } from '../src/drivers/comfyui';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';

describe('Prompt Pipeline Core', () => {
    describe('cleanRenderedText', () => {
        it('should strip HTML tags and decode standard HTML entities', () => {
            const raw = '<div>masterpiece</div> &amp; &lt;best quality&gt; &#39;hello&#39;';
            const cleaned = cleanRenderedText(raw);
            expect(cleaned).toBe('masterpiece & <best quality> \'hello\'');
        });

        it('should decode Unicode numeric entities, including non-BMP code points like Emojis', () => {
            const raw = '&#128514; &#x1F600; hello';
            const cleaned = cleanRenderedText(raw);
            expect(cleaned).toBe('😂 😀 hello');
        });

        it('should clean extra spaces and multiple commas', () => {
            const raw = 'masterpiece, , best quality,   1girl,  , ';
            const cleaned = cleanRenderedText(raw, true);
            expect(cleaned).toBe('masterpiece, best quality, 1girl');
        });
    });

    describe('combinePrefixesWithDeduplication', () => {
        it('should deduplicate tags across prefix layers while preserving first occurrence', () => {
            const layer1 = 'masterpiece, best quality, 1girl';
            const layer2 = 'best quality, solo, 1girl, detailed background';
            const combined = combinePrefixesWithDeduplication(layer1, layer2);
            expect(combined).toBe('masterpiece, best quality, 1girl, solo, detailed background');
        });

        it('should preserve LoRA syntax and not split pipe inside prompt syntax', () => {
            const prefix = '<lora:anime_style:0.8>, (masterpiece:1.2)';
            const combined = combinePrefixesWithDeduplication(prefix);
            expect(combined).toBe('<lora:anime_style:0.8>, (masterpiece:1.2)');
        });
    });

    describe('buildFinalPrompt', () => {
        it('should split promptText by | into positive and negative parts', async () => {
            const result = await buildFinalPrompt(
                '1girl, solo | bad hands, lowres',
                {
                    ...DEFAULT_SETTINGS,
                    promptPrefix: 'masterpiece',
                    negativePrefix: 'worst quality',
                },
                { messageIndex: 0, buttonIndex: 0, rawPrompt: '' }
            );

            expect(result.positive).toContain('masterpiece');
            expect(result.positive).toContain('1girl, solo');
            expect(result.negative).toContain('worst quality');
            expect(result.negative).toContain('bad hands, lowres');
        });

        it('should append LoRA suffixes cleanly for ComfyUI (wlr) and WebUI (lora)', async () => {
            const comfyResult = await buildFinalPrompt(
                'cyberpunk city',
                {
                    ...DEFAULT_SETTINGS,
                    provider: 'comfyui',
                    checkpointPositivePrefix: '',
                    checkpointNegativePrefix: '',
                    promptPrefix: '',
                    negativePrefix: '',
                    loras: [{ name: 'neon_glow', weight: 0.7 }],
                },
                { messageIndex: 0, buttonIndex: 0, rawPrompt: '' }
            );
            expect(comfyResult.positive).toContain('<wlr:neon_glow:0.7:0.7:1>');

            // 测试当预设中存储原名 "neon_glow.safetensors" 时，提示词生成过程动态切除后缀
            const comfyWithExtResult = await buildFinalPrompt(
                'cyberpunk city',
                {
                    ...DEFAULT_SETTINGS,
                    provider: 'comfyui',
                    checkpointPositivePrefix: '',
                    checkpointNegativePrefix: '',
                    promptPrefix: '',
                    negativePrefix: '',
                    loras: [{ name: 'neon_glow.safetensors', weight: 0.7 }],
                },
                { messageIndex: 0, buttonIndex: 0, rawPrompt: '' }
            );
            expect(comfyWithExtResult.positive).toContain('<wlr:neon_glow:0.7:0.7:1>');

            const webuiResult = await buildFinalPrompt(
                'cyberpunk city',
                {
                    ...DEFAULT_SETTINGS,
                    provider: 'sd-webui',
                    checkpointPositivePrefix: '',
                    checkpointNegativePrefix: '',
                    promptPrefix: '',
                    negativePrefix: '',
                    loras: [{ name: 'neon_glow', weight: 0.7 }],
                },
                { messageIndex: 0, buttonIndex: 0, rawPrompt: '' }
            );
            expect(webuiResult.positive).toContain('<lora:neon_glow:0.7>');

            const webuiWithExtResult = await buildFinalPrompt(
                'cyberpunk city',
                {
                    ...DEFAULT_SETTINGS,
                    provider: 'sd-webui',
                    checkpointPositivePrefix: '',
                    checkpointNegativePrefix: '',
                    promptPrefix: '',
                    negativePrefix: '',
                    loras: [{ name: 'neon_glow.safetensors', weight: 0.7 }],
                },
                { messageIndex: 0, buttonIndex: 0, rawPrompt: '' }
            );
            expect(webuiWithExtResult.positive).toContain('<lora:neon_glow:0.7>');
        });

        it('should handle empty or null prompt gracefully', async () => {
            const result = await buildFinalPrompt(
                null as any,
                {
                    ...DEFAULT_SETTINGS,
                    checkpointPositivePrefix: '',
                    checkpointNegativePrefix: '',
                    promptPrefix: 'masterpiece',
                },
                { messageIndex: 0, buttonIndex: 0, rawPrompt: '' }
            );

            expect(result.positive).toBe('masterpiece');
        });
    });

    describe('substituteWorkflowVariables', () => {
        it('should safely replace string and numeric variables in workflow JSON', () => {
            const template = JSON.stringify({
                "1": {
                    "class_type": "KSampler",
                    "inputs": {
                        "steps": "%steps%",
                        "seed": "%seed%",
                        "cfg": "%cfg%",
                        "sampler_name": "%sampler_name%"
                    }
                },
                "2": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "text": "%prompt%"
                    }
                }
            });

            const substituted = substituteWorkflowVariables(template, {
                prompt: 'masterpiece "quotes" $1 test',
                width: 1024,
                height: 1024,
                steps: 25,
                cfgScale: 7,
                samplerName: 'euler',
                seed: 12345,
            });

            expect(substituted['1'].inputs.steps).toBe(25);
            expect(substituted['1'].inputs.seed).toBe(12345);
            expect(substituted['2'].inputs.text).toBe('masterpiece "quotes" $1 test');
        });
    });
});
