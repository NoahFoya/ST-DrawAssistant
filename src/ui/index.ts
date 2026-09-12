/**
 * @module src/ui
 * @description ST-DrawAssistant UI 层统一初始化与顶层装配总入口
 *
 * 职责：
 * 1. 组装 ThemeService，向根 DOM 动态注入 CSS Design Tokens；
 * 2. 实例化 ModalShell，全量注册 10 大设置选项卡（4 大引擎 + 6 大通用/扩展视图）；
 * 3. 挂载常驻 FabContainer（48px 正圆形毛玻璃悬浮球），绑定单击呼出主设置面板；
 * 4. 实例化 FloorManager，提供聊天楼层生图挂载与会话切换防泄漏控制；
 * 5. 绑定全局热键 (Ctrl+Shift+D)，提供洁净的 dispose() 生命周期回收。
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
import { createWorkflowModal, WorkflowModalHandle } from './layout/workflow-modal';
import { createLightboxModal, LightboxModalHandle } from './media/lightbox-modal';
import { createImageInfoModal, ImageInfoModalHandle } from './media/image-info';
import { createInpaintModal, InpaintModalHandle } from './media/image-editor';
import { FloorManager } from './media/floor-manager';
import { getIconSvg } from './components/icons';

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

import type { SettingsStore } from '../store/settings';
import type { PersistentStorage } from '../store/storage';
import type { GenerationOrchestrator } from '../function/orchestrator';
import type { TaskQueueManager } from '../store/task';
import type { StoredImageRecord } from '@types';
import type { MediaCardItemModel } from './composite/types';

export interface UIServices {
    settingsStore: SettingsStore;
    storage?: PersistentStorage;
    orchestrator?: GenerationOrchestrator;
    taskQueue?: TaskQueueManager;
    containerEl?: HTMLElement;
    version?: string;
}

export interface UIHandle {
    readonly modalShell: ModalShell;
    readonly fabContainer: FabContainer;
    readonly floorManager: FloorManager;
    readonly lightbox: LightboxModalHandle;
    readonly imageInfo: ImageInfoModalHandle;
    readonly inpaintModal: InpaintModalHandle;
    readonly workflowModal: WorkflowModalHandle;
    openModal(tabId?: string): void;
    closeModal(): void;
    openWorkflowBlueprint(workflowId: string, json: string, onSave?: (newJson: string) => void): void;
    openLightbox(items: MediaCardItemModel[], startIndex?: number): void;
    openImageInfo(record: StoredImageRecord): void;
    openInpaint(blob: Blob): void;
    dispose(): void;
}

export function initUI(services: UIServices): UIHandle {
    const { settingsStore, storage, orchestrator, taskQueue, containerEl, version = 'v0.2.0' } = services;
    const rootEl = containerEl || (typeof document !== 'undefined' ? document.documentElement : null);

    const disposers: (() => void)[] = [];

    // 1. 初始化主题系统 (ThemeService)
    if (rootEl) {
        ThemeService.getInstance().init(rootEl, settingsStore);
        disposers.push(() => ThemeService.getInstance().dispose());
    }

    // 2. 实例化全局独立模态弹窗
    const modalContainer = rootEl || undefined;
    const lightbox = createLightboxModal({
        containerEl: modalContainer,
        onViewInfo: (item) => {
            if (storage) {
                storage.getRecord(item.id).then((rec) => {
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
        containerEl: modalContainer
    });
    disposers.push(() => inpaintModal.dispose());

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
        orchestrator,
        taskQueue,
        onPreviewImage: (url) => {
            lightbox.open([{ id: 'floor_preview', url, prompt: '' }], 0);
        },
        onInpaintImage: (blob) => {
            inpaintModal.open(blob);
        }
    });
    disposers.push(() => floorManager.dispose());

    // 7. 注册全局快捷键 (Ctrl + Shift + D)
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
