/**
 * UI 层统一初始化与顶层装配总入口 (src/ui/index.ts)
 *
 * 功能：
 * 1. 组装 ThemeService，向根 DOM 动态注入 CSS 设计变量；
 * 2. 实例化 ModalShell，全量注册 10 大设置选项卡 (4 大引擎 + 6 大通用/扩展视图)；
 * 3. 挂载常驻 FabContainer 快捷悬浮球，绑定单击呼出主设置面板；
 * 4. 实例化 FloorManager，提供聊天楼层生图挂载与会话生命周期管理；
 * 5. 绑定快捷键 (Ctrl+Shift+D)，提供洁净的 dispose() 生命周期回收。
 *
 * Tips：
 * 1. 作为前端视图层唯一的门面装配工厂 (initUI)，向上层入口提供开箱即用的 UI 句柄；
 * 2. 插件禁用或重载时调用 dispose()，集中释放所有浮层、定时器与全局快捷键监听。
 */

export * from './theme';
export * from './components';
export * from './composite';
export * from './layout';
export * from './views';
export * from './media';

import { ThemeService } from './theme';
import { ModalShell } from './layout/modal-shell';
import { FabContainer } from './layout/fab-container';
import { createWorkflowModal } from './layout/workflow-modal';
import { createLightboxModal } from './media/lightbox-modal';
import { createImageInfoModal } from './media/image-info';
import { createInpaintModal } from './media/image-editor';
import { createImageActionPanel, type ImageActionData } from './media/image-action-panel';
import { FloorManager } from './media/floor-manager';
import { Toast } from './components/feedback';
import { getIconSvg } from './components/icons';
import { blobToBase64 } from '../util/image';
import { buildEngineParams } from '../function/params-builder';

import { renderGeneralTab } from './views/general-tab';
import { renderThemeTab } from './views/theme-tab';
import { renderFABSettingsTab } from './views/fab-settings-tab';
import { renderComfyUITab } from './views/comfyui-tab';
import { renderSDWebUITab } from './views/sdwebui-tab';
import { renderNovelAITab } from './views/novelai-tab';
import { renderOpenAITab } from './views/openai-tab';
import { renderGalleryTab } from './views/gallery-tab';
import { renderLogsAndStatsTab, LogsAndStatsTabHandle } from './views/logs-and-stats-tab';
import { renderAboutTab } from './views/about-tab';

import type { StoredImageRecord, MediaCardItemModel, UIServices, UIHandle } from '@types';
export type { UIServices, UIHandle };

export function initUI(services: UIServices): UIHandle {
    const { settingsStore, storage, orchestrator, taskQueue, containerEl, version = 'v0.2.0' } = services;
    const rootEl = containerEl || (typeof document !== 'undefined' ? document.documentElement : null);

    const disposers: (() => void)[] = [];

    // 1. 初始化主题系统 (ThemeService)
    if (rootEl) {
        ThemeService.getInstance().init(rootEl, settingsStore);
        disposers.push(() => ThemeService.getInstance().dispose());
    }

    // 2. 实例化独立模态弹窗
    const modalContainer = rootEl || undefined;
    const lightbox = createLightboxModal({
        containerEl: modalContainer,
        onViewInfo: (item) => {
            if (storage) {
                storage.getRecord(item.id).then((rec: StoredImageRecord | null) => {
                    if (rec) imageInfo.open(rec);
                });
            }
        }
    });
    disposers.push(() => lightbox.dispose());

    const imageInfo = createImageInfoModal({
        containerEl: modalContainer,
        onPreviewImage: (url) => {
            lightbox.open([{ id: 'preview', url, prompt: '' }], 0);
        }
    });
    disposers.push(() => imageInfo.dispose());

    const inpaintModal = createInpaintModal({
        containerEl: modalContainer,
        onConfirm: async (result) => {
            const activeEngine = (settingsStore.get('activeEngine') as any) || 'sdwebui';
            if (activeEngine !== 'sdwebui' && activeEngine !== 'comfyui') {
                Toast.warn(`当前生图引擎 [${activeEngine}] 暂未适配局部重绘，建议切换至 SD-WebUI`);
                return;
            }

            if (!taskQueue) {
                Toast.warn('生图任务队列未就绪');
                return;
            }

            try {
                const baseBase64 = await blobToBase64(result.baseBlob, false);
                const cleanMask = result.maskBase64.replace(/^data:image\/[a-z]+;base64,/, '');

                const inpaintParams = buildEngineParams({
                    engine: activeEngine,
                    prompt: 'inpaint restoration',
                    settingsStore
                });

                if (inpaintParams.engine === 'sdwebui') {
                    (inpaintParams as any).init_images = [baseBase64];
                    (inpaintParams as any).mask = cleanMask;
                    (inpaintParams as any).denoising_strength = 0.75;
                }

                let chatId = 'default';
                if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
                    chatId = window.SillyTavern.getContext().chatId || 'default';
                }

                taskQueue.submit(
                    inpaintParams,
                    { chatId },
                    inpaintParams.engine
                );
                Toast.success('局部重绘任务已加入队列');
            } catch (err: any) {
                Toast.error(`提交重绘任务失败: ${err?.message || err}`);
            }
        }
    });
    disposers.push(() => inpaintModal.dispose());

    // 图像快捷操作独立弹窗 (ImageActionPanel)
    const actionPanel = createImageActionPanel({
        containerEl: modalContainer,
        onInpaint: (data) => {
            if (data.imageBlob) {
                inpaintModal.open(data.imageBlob);
            } else {
                Toast.warn('无法获取原始图像资源用于重绘');
            }
        },
        onViewMetadata: (data) => {
            if (data.record) {
                imageInfo.open(data.record);
            } else {
                const meta = data.metadata;
                const recId = String(data.messageId ?? Date.now());
                const eng = (meta?.engine as any) || settingsStore.get('activeEngine') || 'sdwebui';
                const p = data.prompt || (meta?.prompt as string) || '';
                const np = data.negativePrompt || (meta?.negativePrompt as string) || '';
                const blob = data.imageBlob || new Blob([''], { type: 'image/png' });
                const fakeRec: StoredImageRecord = {
                    id: recId,
                    prompt: p,
                    originalBlob: blob,
                    metadata: {
                        id: recId,
                        engine: eng,
                        createdAt: Date.now(),
                        prompt: p,
                        negativePrompt: np,
                        rawResponse: meta
                    }
                };
                imageInfo.open(fakeRec);
            }
        },
        onDelete: async (data) => {
            if (storage && data.record?.id) {
                await storage.deleteRecord(data.record.id);
            }
            // 同步擦除宿主聊天记录中的 da_images 引用
            if (data.messageId !== undefined && typeof window !== 'undefined' && window.SillyTavern?.getContext) {
                try {
                    const ctx = window.SillyTavern.getContext();
                    const chat = ctx.chat;
                    const numId = typeof data.messageId === 'number' ? data.messageId : parseInt(String(data.messageId), 10);
                    const extra = chat[numId]?.extra as Record<string, any> | undefined;
                    if (Array.isArray(chat) && extra?.da_images) {
                        const rawSwipe = chat[numId].swipe_id ?? extra.swipe_id ?? 0;
                        const swipeId = (typeof rawSwipe === 'number' || typeof rawSwipe === 'string') ? rawSwipe : 0;
                        const btnIdx = data.buttonIndex ?? 0;
                        const daImages = extra.da_images as Record<string | number, any>;
                        if (daImages[swipeId]) {
                            delete daImages[swipeId][btnIdx];
                        }
                        ctx.eventSource?.emit?.(ctx.eventTypes?.MESSAGE_UPDATED, numId);
                        await ctx.saveChat?.();
                    }
                } catch (e) {
                    console.warn('[ImageActionPanel] 清理聊天记录图片引用异常:', e);
                }
            }
            return true;
        },
        onRegenerate: (newPrompt, newNegativePrompt, data) => {
            if (typeof document !== 'undefined' && data.messageId !== undefined) {
                const selector = `#chat .mes[mesid="${data.messageId}"], .mes[mesid="${data.messageId}"]`;
                const messageEl = document.querySelector<HTMLElement>(selector);
                if (messageEl) {
                    const btnIdx = data.buttonIndex ?? 0;
                    floorManager.triggerFloorGenerate(messageEl, data.messageId, newPrompt, newNegativePrompt, btnIdx);
                }
            }
        }
    });
    disposers.push(() => actionPanel.dispose());

    let activeWfCallback: ((newJson: string) => void) | undefined;
    const workflowModal = createWorkflowModal({
        workflowJson: '{}',
        containerEl: modalContainer,
        onSave: (json) => {
            if (activeWfCallback) {
                activeWfCallback(json);
            }
        }
    });
    disposers.push(() => workflowModal.dispose());

    // 3. 实例化主设置弹窗骨架 (ModalShell)
    const modalShell = new ModalShell({
        title: 'ST-DrawAssistant 绘画助手设置',
        version,
        initialTabId: 'general',
        settingsStore,
        onClose: () => {
            settingsStore.flush();
        }
    });
    disposers.push(() => modalShell.dispose());

    const paneHandles: { dispose?: () => void }[] = [];

    // 4. 注册全量 10 大设置选项卡 (系统与扩展视图)
    modalShell.registerTab({
        id: 'general',
        label: '通用设置',
        iconSvg: getIconSvg('settings'),
        group: 'system',
        render: () => {
            const h = renderGeneralTab(settingsStore);
            paneHandles.push(h);
            return h.element;
        }
    });

    modalShell.registerTab({
        id: 'theme',
        label: '主题外观',
        iconSvg: getIconSvg('palette'),
        group: 'system',
        render: () => {
            const h = renderThemeTab(settingsStore);
            paneHandles.push(h);
            return h.element;
        }
    });

    modalShell.registerTab({
        id: 'fab',
        label: '悬浮球',
        iconSvg: getIconSvg('zap'),
        group: 'system',
        render: () => {
            const h = renderFABSettingsTab(settingsStore, {
                onResetPosition: () => {
                    fabContainer.resetPosition();
                }
            });
            paneHandles.push(h);
            return h.element;
        }
    });

    modalShell.registerTab({
        id: 'gallery',
        label: '画廊画册',
        iconSvg: getIconSvg('image'),
        group: 'system',
        render: () => {
            const h = renderGalleryTab({
                storage,
                onPreview: (item) => {
                    lightbox.open([item], 0);
                },
                onViewInfo: (record) => {
                    imageInfo.open(record);
                }
            });
            paneHandles.push(h);
            return h.element;
        }
    });

    let logsTabHandle: LogsAndStatsTabHandle | null = null;
    modalShell.registerTab({
        id: 'logs',
        label: '日志统计',
        iconSvg: getIconSvg('star'),
        group: 'system',
        render: () => {
            const h = renderLogsAndStatsTab({
                settingsStore
            });
            logsTabHandle = h;
            paneHandles.push(h);
            return h.element;
        }
    });

    modalShell.registerTab({
        id: 'about',
        label: '关于支持',
        iconSvg: getIconSvg('help'),
        group: 'system',
        render: () => {
            const h = renderAboutTab({
                settingsStore,
                version
            });
            paneHandles.push(h);
            return h.element;
        }
    });

    // 后端引擎专属视窗 (ComfyUI / SD-WebUI / NovelAI / OpenAI)
    modalShell.registerTab({
        id: 'comfyui',
        label: 'ComfyUI',
        iconSvg: getIconSvg('sparkles'),
        group: 'engine',
        render: () => {
            const h = renderComfyUITab(settingsStore, {
                onOpenWorkflowBlueprint: (_wfId, json, onSave) => {
                    activeWfCallback = onSave;
                    workflowModal.setJson(json);
                    workflowModal.open();
                }
            });
            paneHandles.push(h);
            return h.element;
        }
    });

    modalShell.registerTab({
        id: 'sdwebui',
        label: 'SD-WebUI',
        iconSvg: getIconSvg('sparkles'),
        group: 'engine',
        render: () => {
            const h = renderSDWebUITab(settingsStore);
            paneHandles.push(h);
            return h.element;
        }
    });

    modalShell.registerTab({
        id: 'novelai',
        label: 'NovelAI',
        iconSvg: getIconSvg('sparkles'),
        group: 'engine',
        render: () => {
            const h = renderNovelAITab(settingsStore);
            paneHandles.push(h);
            return h.element;
        }
    });

    modalShell.registerTab({
        id: 'openai',
        label: 'OpenAI',
        iconSvg: getIconSvg('sparkles'),
        group: 'engine',
        render: () => {
            const h = renderOpenAITab(settingsStore);
            paneHandles.push(h);
            return h.element;
        }
    });

    // 5. 实例化常驻悬浮球 (FabContainer)
    const fabContainer = new FabContainer({
        settingsStore,
        onClick: () => {
            if (modalShell.isOpen()) {
                modalShell.close();
            } else {
                modalShell.open();
            }
        }
    });
    fabContainer.mount(containerEl);
    disposers.push(() => fabContainer.dispose());

    // 若接入任务队列，同步 FAB 悬浮球运行状态（运行中高亮发光与未决任务角标）
    if (taskQueue) {
        const updateFabState = () => {
            const active = taskQueue.getActiveTasks();
            fabContainer.setBadge(active.length);
            fabContainer.setGenerating(active.length > 0);
        };
        const unsubQueued = taskQueue.events.on('task:queued', updateFabState);
        const unsubCompleted = taskQueue.events.on('task:completed', updateFabState);
        const unsubFailed = taskQueue.events.on('task:failed', updateFabState);
        const unsubCancelled = taskQueue.events.on('task:cancelled', updateFabState);
        disposers.push(
            () => unsubQueued.dispose(),
            () => unsubCompleted.dispose(),
            () => unsubFailed.dispose(),
            () => unsubCancelled.dispose()
        );
    }

    // 6. 实例化楼层交互管理器 (FloorManager)
    const floorManager = new FloorManager({
        settingsStore,
        storage,
        orchestrator,
        taskQueue,
        onPreviewImage: (url) => {
            lightbox.open([{ id: 'floor_preview', url, prompt: '' }], 0);
        },
        onInpaintImage: (blob) => {
            inpaintModal.open(blob);
        },
        onOpenActionPanel: (data) => {
            actionPanel.open(data);
        }
    });
    disposers.push(() => floorManager.dispose());

    // 7. 注册快捷键 (Ctrl + Shift + D)
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
            e.preventDefault();
            if (modalShell.isOpen()) {
                modalShell.close();
            } else {
                modalShell.open();
            }
        }
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('keydown', onKeyDown);
        disposers.push(() => window.removeEventListener('keydown', onKeyDown));
    }

    return {
        modalShell,
        fabContainer,
        floorManager,
        lightbox,
        imageInfo,
        inpaintModal,
        actionPanel,
        workflowModal,
        openModal(tabId?: string): void {
            if (tabId) {
                modalShell.switchTab(tabId);
            }
            modalShell.open();
        },
        closeModal(): void {
            modalShell.close();
        },
        openWorkflowBlueprint(_workflowId: string, json: string, onSave?: (newJson: string) => void): void {
            activeWfCallback = onSave;
            workflowModal.setJson(json);
            workflowModal.open();
        },
        openLightbox(items: MediaCardItemModel[], startIndex = 0): void {
            lightbox.open(items, startIndex);
        },
        openImageInfo(record: StoredImageRecord): void {
            imageInfo.open(record);
        },
        openInpaint(blob: Blob): void {
            inpaintModal.open(blob);
        },
        openActionPanel(data: ImageActionData): void {
            actionPanel.open(data);
        },
        dispose(): void {
            if (logsTabHandle) {
                // logs tab disposed with paneHandles
            }
            for (const p of paneHandles) {
                p.dispose?.();
            }
            paneHandles.length = 0;
            for (const d of disposers) {
                d();
            }
        }
    };
}
