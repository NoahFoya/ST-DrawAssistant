// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderImageToMessage } from '../src/ui/image-renderer';
import { DrawAssistantSettings } from '../src/core/state/store-types';

describe('Batch 4: Image Renderer & Gesture Action Tests', () => {
    beforeEach(() => {
        if (!globalThis.URL.createObjectURL) {
            globalThis.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/fake-uuid');
        }
    });
    it('should render image into slot according to imageDisplay settings', () => {
        const slot = document.createElement('div');
        const fakeBlob = new Blob(['fake-image-bytes'], { type: 'image/png' });

        const settings: Partial<DrawAssistantSettings> = {
            imageDisplay: {
                align: 'center',
                objectFit: 'cover',
                maxHeight: 400,
                maxWidthPct: 80,
                rounded: true
            }
        };

        const img = renderImageToMessage(slot, fakeBlob, settings as DrawAssistantSettings);

        expect(slot.style.justifyContent).toBe('center');
        expect(img.style.objectFit).toBe('cover');
        expect(img.style.maxHeight).toBe('400px');
        expect(img.style.maxWidth).toBe('80%');
        expect(img.style.borderRadius).toBe('8px');
        expect(slot.contains(img)).toBe(true);
    });

    it('should attach contextmenu listener and open action menu on right-click', () => {
        const slot = document.createElement('div');
        const fakeBlob = new Blob(['fake'], { type: 'image/png' });
        const onInpaintSpy = vi.fn();

        const img = renderImageToMessage(slot, fakeBlob, {} as DrawAssistantSettings, {
            onInpaint: onInpaintSpy
        });

        // 模拟右键 contextmenu 事件
        const contextEvent = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 100,
            clientY: 200
        });

        img.dispatchEvent(contextEvent);

        const menu = document.querySelector('.da-action-menu');
        expect(menu).not.toBeNull();
        expect(menu?.textContent).toContain('查看大图');
        expect(menu?.textContent).toContain('局部重绘');

        menu?.remove();
    });
});
