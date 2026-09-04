import { describe, it, expect } from 'vitest';
import { blobToBase64, base64ToBlob } from '../../src/common/utils/binary';

describe('Common Utils: binary', () => {
    it('base64ToBlob 应该能将 Base64 编码解码为 Blob 并保持长度一致', () => {
        const sampleText = 'Hello World SillyTavern';
        const base64 = Buffer.from(sampleText).toString('base64');

        const blob = base64ToBlob(base64, 'text/plain');
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.size).toBe(sampleText.length);
        expect(blob.type).toBe('text/plain');
    });

    it('base64ToBlob 应该支持剥离 data: URL 前缀', () => {
        const sampleText = 'prefix test';
        const rawBase64 = Buffer.from(sampleText).toString('base64');
        const dataUrl = `data:image/png;base64,${rawBase64}`;

        const blob = base64ToBlob(dataUrl, 'image/png');
        expect(blob.size).toBe(sampleText.length);
    });

    it('blobToBase64 应该将 Blob 准确转换为 Base64 文本', async () => {
        const sample = 'binary-test-data';
        const blob = new Blob([sample], { type: 'text/plain' });

        const base64 = await blobToBase64(blob);
        const decoded = Buffer.from(base64, 'base64').toString();
        expect(decoded).toBe(sample);
    });
});
