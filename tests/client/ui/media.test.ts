/**
 * @module tests/client/ui/media.test
 * @description 批次 5: 媒体展现、局部重绘与楼层生图按钮测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigStore } from '../../../src/client/core/config/config-store';
import { HostClient } from '../../../src/client/core/host/host-client';
import { EventBus } from '../../../src/client/core/event-bus';
import { CoreEventMap } from '../../../src/client/core/types';
import { StorageService } from '../../../src/client/core/storage/storage-service';
import { TaskManager } from '../../../src/client/domain/task/task-manager';
import { PromptPipeline } from '../../../src/client/domain/pipeline/prompt-pipeline';
import { AdapterRegistry } from '../../../src/client/domain/drivers/adapter-registry';
import {
    openLightboxModal,
    openImageCropperModal,
    openInpaintCanvasModal,
    openImageActionPanel,
    renderImageToMessage,
    renderStorageBar,
    createGalleryManager
} from '../../../src/client/ui/media';
import { FloorButtonContainer } from '../../../src/client/ui/layout/floor-button-container';

describe('UI Media & Floor Button Injection', () => {
    let store: ConfigStore;
    let eventBus: EventBus<CoreEventMap>;
    let host: HostClient;
    let storage: StorageService;
    let taskManager: TaskManager;
    let pipeline: PromptPipeline;
    let adapterRegistry: AdapterRegistry;

    beforeEach(() => {
        document.body.innerHTML = '';
        store = new ConfigStore();
        eventBus = new EventBus<CoreEventMap>();
        storage = new StorageService();
        adapterRegistry = new AdapterRegistry();
        pipeline = new PromptPipeline();
        taskManager = new TaskManager({
            events: eventBus,
            adapters: adapterRegistry,
            getConfig: () => ({ activeProvider: 'comfyui' })
        });

        const stContext = {
            chat: [
                {
                    mes: 'Here is a photo: image###1girl, solo | bad hand###',
                    is_user: false,
                    swipe_id: 0
                }
            ],
            chatId: 'test_chat_1',
            eventSource: {
                on: vi.fn(),
                off: vi.fn(),
                emit: vi.fn()
            },
            event_types: {
                CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
                USER_MESSAGE_RENDERED: 'user_message_rendered',
                MESSAGE_SWIPED: 'message_swiped',
                MESSAGE_UPDATED: 'message_updated',
                MESSAGE_DELETED: 'message_deleted',
                CHAT_CHANGED: 'chat_changed'
            },
            saveChatDebounced: vi.fn()
        };
        (window as any).SillyTavern = {
            getContext: () => stContext
        };
        host = new HostClient();
    });

    afterEach(() => {
        taskManager.dispose();
        adapterRegistry.dispose();
        storage.dispose();
        store.dispose();
        eventBus.dispose();
        document.body.innerHTML = '';
    });

    describe('Lightbox & Editor Modals', () => {
        it('openLightboxModal 应正确挂载背景与图片并支持关闭', () => {
            const handle = openLightboxModal('data:image/png;base64,iVBORw0KGgo=');
            const backdrop = document.querySelector('.da-lightbox-backdrop');
            expect(backdrop).not.toBeNull();

            const closeBtn = backdrop?.querySelector<HTMLElement>('.da-lightbox-close');
            expect(closeBtn).not.toBeNull();
            closeBtn?.click();

            expect(document.querySelector('.da-lightbox-backdrop')).toBeNull();
            handle.dispose();
        });

        it('openImageCropperModal 应支持裁剪取消', () => {
            let cancelled = false;
            const handle = openImageCropperModal({
                imageSrc: 'data:image/png;base64,iVBORw0KGgo=',
                onCancel: () => {
                    cancelled = true;
                }
            });

            const backdrop = document.querySelector('.da-cropper-backdrop');
            expect(backdrop).not.toBeNull();

            const cancelBtn = backdrop?.querySelectorAll<HTMLButtonElement>('.da-dialog-actions button')[0];
            cancelBtn?.click();

            expect(cancelled).toBe(true);
            handle.dispose();
        });

        it('openInpaintCanvasModal 应支持涂抹模态框挂载与提交', () => {
            let submitted = false;
            const handle = openInpaintCanvasModal({
                imageSrc: 'data:image/png;base64,iVBORw0KGgo=',
                initialPrompt: 'masterpiece',
                onConfirm: () => {
                    submitted = true;
                }
            });

            const backdrop = document.querySelector('.da-inpaint-backdrop');
            expect(backdrop).not.toBeNull();

            const submitBtn = backdrop?.querySelectorAll<HTMLButtonElement>('.da-dialog-actions button')[1];
            submitBtn?.click();

            expect(submitted).toBe(true);
            handle.dispose();
        });
    });

    describe('Action Panel & Image Renderer', () => {
        it('renderImageToMessage 应在容器中渲染带有操作胶囊的图片', () => {
            const slot = document.createElement('div');
            document.body.appendChild(slot);

            const img = renderImageToMessage(slot, 'data:image/png;base64,iVBORw0KGgo=');
            expect(img).not.toBeNull();
            expect(slot.querySelector('.da-image-corner-trigger')).not.toBeNull();
        });

        it('openImageActionPanel 应正确展现正向提示词卡片与重新生成按钮', () => {
            let regenCalled = false;
            const handle = openImageActionPanel({ clientX: 100, clientY: 100 } as any, {
                promptText: 'a beautiful sunset',
                onRegenerate: () => {
                    regenCalled = true;
                }
            });

            const panel = document.querySelector('.da-action-panel');
            expect(panel).not.toBeNull();

            const primaryBtn = panel?.querySelector<HTMLButtonElement>('.da-btn--primary');
            expect(primaryBtn?.textContent).toBe('重新生成');
            primaryBtn?.click();

            expect(regenCalled).toBe(true);
            handle.dispose();
        });
    });

    describe('Gallery Components', () => {
        it('renderStorageBar 与 createGalleryManager 应正常初始化', () => {
            const bar = renderStorageBar(storage, host);
            expect(bar).not.toBeNull();
            bar.dispose();

            const manager = createGalleryManager(storage, host);
            expect(manager).not.toBeNull();
            manager.dispose();
        });

        it('createGalleryManager 在 reload 和 dispose 时应统一释放 trackedUrls', async () => {
            const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            vi.spyOn(storage, 'getAll').mockResolvedValue([
                {
                    id: 'img-1',
                    prompt: 'test',
                    originalBlob: new Blob(['123'], { type: 'image/png' }),
                    metadata: {} as any
                }
            ]);

            const manager = createGalleryManager(storage, host);
            await manager.reload();
            await manager.reload();
            expect(revokeSpy).toHaveBeenCalled();

            revokeSpy.mockClear();
            manager.dispose();
            expect(revokeSpy).toHaveBeenCalled();
            revokeSpy.mockRestore();
        });
    });

    describe('FloorButtonContainer', () => {
        it('应扫描消息并注入出图按钮，点击能触发提交', async () => {
            const msgNode = document.createElement('div');
            msgNode.className = 'mes';
            msgNode.setAttribute('mesid', '0');

            const textNode = document.createElement('div');
            textNode.className = 'mes_text';
            textNode.textContent = 'Here is: image###a cute cat | bad eyes###';
            msgNode.appendChild(textNode);
            document.body.appendChild(msgNode);

            const container = new FloorButtonContainer({
                host,
                events: eventBus,
                store,
                taskManager,
                pipeline,
                storage
            });

            container.scanAllMessages();

            const btn = msgNode.querySelector<HTMLButtonElement>('.da-floor-btn');
            expect(btn).not.toBeNull();
            expect(btn?.textContent).toBe('生成图像');

            container.dispose();
            expect(msgNode.querySelector('.da-floor-root')).toBeNull();
        });

        it('当切换到无图片的分支时，应清空插槽残留图片并重置按钮状态为 default', async () => {
            const msgNode = document.createElement('div');
            msgNode.className = 'mes';
            msgNode.setAttribute('mesid', '0');

            const textNode = document.createElement('div');
            textNode.className = 'mes_text';
            textNode.textContent = 'Prompt: image###test prompt###';
            msgNode.appendChild(textNode);
            document.body.appendChild(msgNode);

            // 模拟当前分支 swipe_id = 0，有持久化图片
            const mockChat = (window as any).SillyTavern.getContext().chat;
            mockChat[0].swipe_id = 0;
            host.writeChatMessageExtra(0, 'da_images', {
                0: {
                    0: {
                        storageStrategy: 'embedded',
                        base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                        prompt: 'test prompt'
                    }
                }
            });

            const container = new FloorButtonContainer({
                host,
                events: eventBus,
                store,
                taskManager,
                pipeline,
                storage
            });

            // 1. 扫描并渲染第 0 个分支图片
            await container.scanAndInjectMessage(0);
            const imgSlot = msgNode.querySelector<HTMLElement>('.da-floor-img-slot');
            const btn = msgNode.querySelector<HTMLButtonElement>('.da-floor-btn');
            expect(imgSlot?.innerHTML).not.toBe('');
            expect(btn?.textContent).toBe('重新生成');

            // 2. 模拟用户切换到分支 swipe_id = 1（无图片）
            mockChat[0].swipe_id = 1;
            await container.scanAndInjectMessage(0);

            // 验证残留图片被清空，按钮状态复位为默认
            expect(imgSlot?.innerHTML).toBe('');
            expect(btn?.textContent).toBe('生成图像');
            expect(btn?.style.display).toBe('inline-block');

            container.dispose();
        });
    });
});
