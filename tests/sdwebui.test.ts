import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SDWebUIDriver } from '../src/drivers/sdwebui';
import { createDriver } from '../src/drivers/factory';
import type { DrawAssistantSettings } from '../src/settings/types';

const mockSettings: DrawAssistantSettings = {
    provider: 'sd-webui',
    serverUrl: 'http://127.0.0.1:7860',
    requestTimeout: 10000,
    width: 512,
    height: 512,
    steps: 20,
    cfgScale: 7.0,
    samplerName: 'Euler a',
} as DrawAssistantSettings;

describe('SDWebUIDriver', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('should create SDWebUIDriver instance via factory when provider is sd-webui', () => {
        const driver = createDriver('sd-webui', mockSettings);
        expect(driver).toBeInstanceOf(SDWebUIDriver);
        expect(driver.name).toBe('sd-webui');
    });

    it('checkConnection should return connected: true when API returns ok', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({}),
        });

        const driver = new SDWebUIDriver(mockSettings);
        const result = await driver.checkConnection();
        expect(result.connected).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:7860/sdapi/v1/options', expect.anything());
    });

    it('generate should format payload and return GenerateResult', async () => {
        const mockResponse = {
            images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
            info: JSON.stringify({ seed: 9999 }),
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockResponse,
        });

        const driver = new SDWebUIDriver(mockSettings);
        const result = await driver.generate({
            prompt: 'masterpiece, 1girl',
            width: 512,
            height: 512,
            steps: 20,
            cfgScale: 7.0,
            samplerName: 'Euler a',
            seed: 9999,
        });

        expect(result.imageData).toBe(mockResponse.images[0]);
        expect(result.mimeType).toBe('image/png');
        expect(result.seed).toBe(9999);
    });

    it('getSamplers should return sampler list', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [{ name: 'Euler a' }, { name: 'DPM++ 2M Karras' }],
        });

        const driver = new SDWebUIDriver(mockSettings);
        const samplers = await driver.getSamplers();
        expect(samplers).toEqual(['Euler a', 'DPM++ 2M Karras']);
    });
});
