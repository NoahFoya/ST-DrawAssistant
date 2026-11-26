/**
 * 楼层插槽图片、骨架屏与交互动作按钮渲染器 (`slot-renderer.ts`)。
 *
 * @remarks
 * 集中承载阶段 B（幂等 DOM 修补）与交互控件生命周期：
 * - 骨架屏挂载与移除；
 * - 生成图像首次挂载与后台预载平滑替换（含 8s 超时安全释放）；
 * - IndexedDB 损坏/缺失 URL 回退重建与右键/长按操作菜单；
 * - Lightbox 历史图片翻页对照与设为当前回调；
 * - 动作按钮状态同步（ready / pending / generating / done / error）与重新生成。
 */

import type { DrawingTask, ImageDisplayMode, ProviderType, SlotMountTarget } from '@types';
import {
    buildFloorSlotKey,
    floorCoordinator,
    matchesFloorSlotMessage,
    type ExtractedFloorCommand,
} from '../../pipeline/floor-coordinator';
import { generationOrchestrator } from '../../pipeline/generation-orchestrator';
import { sessionLifecycle } from '../../pipeline/session-lifecycle';
import { imageStorage } from '../../store/image-storage';
import { settingsStore } from '../../store/settings-store';
import { urlPool } from '../../store/url-pool';
import {
    attachImageDragFile,
    copyImageBlobToClipboard,
    downloadImageAsset,
} from '../../util/browser-io';
import { logger } from '../../util/logger';
import { renderIcon } from '../components/icons';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { Toast } from '../feedback/toast';
import { imageInfoModal } from '../media/image-info-modal';
import { lightboxModal, type LightboxItem } from '../media/lightbox-modal';
import { FloorActionButton } from './floor-action-button';
import {
    buildFloorCleanupSelector,
    getMessageTextContainer,
    mountToSlot,
    resolveSlotElement,
} from './floor-dom-locator';

export interface FloorSlotState {
    target: SlotMountTarget;
    imageId?: string;
    displayUrl: string;
    favorited: boolean;
    syncFavUI: (fav: boolean) => void;
}

export interface SlotRendererHooks {
    readonly getClearEpoch: () => number;
    readonly isDisposed: () => boolean;
    readonly captureMessageToken: (messageId: number) => { clearEpoch: number; generation: number };
    readonly isMessageTokenValid: (
        messageId: number,
        token: { clearEpoch: number; generation: number }
    ) => boolean;
    readonly runSuppressed: (messageId: number, fn: () => void) => void;
    readonly syncObservedNodesIfTarget: (messageId: number) => void;
    readonly openImageActionPanel: (
        messageId: number,
        instructionIndex: number,
        imageId?: string,
        displayUrl?: string
    ) => Promise<void>;
}

/** 将图片显示配置同步应用至已渲染的楼层容器 DOM */
export function applyDisplaySettingsToContainer(
    imageContainer: HTMLElement,
    displayCfg:
        | {
              align?: string;
              objectFit?: string;
              maxHeight?: number;
              maxWidthPct?: number;
              rounded?: boolean;
              displayMode?: ImageDisplayMode;
          }
        | undefined
): void {
    imageContainer.classList.remove(
        'da-floor-image-container--center',
        'da-floor-image-container--left',
        'da-floor-image-container--right'
    );
    if (displayCfg?.align === 'center') {
        imageContainer.classList.add('da-floor-image-container--center');
    } else if (displayCfg?.align === 'flex-start') {
        imageContainer.classList.add('da-floor-image-container--left');
    } else if (displayCfg?.align === 'flex-end') {
        imageContainer.classList.add('da-floor-image-container--right');
    }

    const displayMode = displayCfg?.displayMode || 'normal';
    const isCollapseMode = displayMode === 'collapse';
    imageContainer.classList.toggle('da-floor-image-container--collapse', isCollapseMode);
    const toggleBtn = imageContainer.querySelector(
        '.da-floor-image-collapse-toggle'
    ) as HTMLButtonElement | null;
    if (!isCollapseMode) {
        imageContainer.classList.remove('is-expanded');
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', 'false');
            const labelEl = toggleBtn.querySelector('.da-floor-image-collapse-toggle__label');
            if (labelEl) {
                labelEl.textContent = '展开生成图片';
            }
        }
    }

    const imageBox = imageContainer.querySelector('.da-floor-image-box') as HTMLElement | null;
    if (imageBox) {
        imageBox.style.borderRadius = displayCfg?.rounded === false ? '0px' : '';
    }

    const imgEl = imageContainer.querySelector('.da-floor-image') as HTMLImageElement | null;
    if (imgEl) {
        imgEl.style.maxHeight = displayCfg?.maxHeight ? `${displayCfg.maxHeight}px` : '';
        imgEl.style.maxWidth = displayCfg?.maxWidthPct ? `${displayCfg.maxWidthPct}%` : '';
        imgEl.style.objectFit = displayCfg?.objectFit || '';
        imgEl.classList.toggle('da-floor-image--blurred', displayMode === 'blur');
    }
}

export class FloorSlotRenderer {
    public readonly activeButtons = new Map<string, FloorActionButton>();
    public readonly activeImageContainers = new Map<string, HTMLElement>();
    public readonly activeSlotStates = new Map<string, FloorSlotState>();
    public readonly activeSkeletons = new Map<string, HTMLElement>();
    private readonly activeSlotCleanups = new Map<string, () => void>();
    private readonly activePreloadCleanups = new Map<string, () => void>();
    private readonly inFlightRenders = new Map<string, Promise<void>>();

    public constructor(private readonly hooks: SlotRendererHooks) {}

    public getElementGroups(): Array<Map<string, HTMLElement>> {
        const buttonElements = new Map<string, HTMLElement>();
        for (const [key, btn] of this.activeButtons.entries()) {
            buttonElements.set(key, btn.element);
        }
        return [buttonElements, this.activeImageContainers, this.activeSkeletons];
    }

    /** 在楼层容器内挂载骨架屏 */
    public renderSkeleton(
        messageId: number,
        instructionIndex = 0,
        chatId?: string,
        swipeId?: number
    ): void {
        if (typeof document === 'undefined') {
            return;
        }

        const coords = floorCoordinator.resolveSlotCoordinates(messageId, chatId, swipeId);
        const containerKey = buildFloorSlotKey(
            coords.chatId,
            messageId,
            coords.swipeId,
            instructionIndex
        );

        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageDom) {
            return;
        }

        const slotElement = messageDom.querySelector(
            `.da-floor-slot[data-instruction-index="${instructionIndex}"]`
        ) as HTMLElement | null;
        if (!slotElement) {
            return;
        }

        const existingContainer = this.activeImageContainers.get(containerKey);
        if (existingContainer && existingContainer.isConnected && slotElement.contains(existingContainer)) {
            return;
        }

        const existingSkeleton = this.activeSkeletons.get(containerKey);
        if (existingSkeleton) {
            if (!existingSkeleton.isConnected || !slotElement.contains(existingSkeleton)) {
                this.hooks.runSuppressed(messageId, () => {
                    mountToSlot(slotElement, existingSkeleton, 'visual');
                    this.hooks.syncObservedNodesIfTarget(messageId);
                });
            }
            return;
        }

        const skeleton = document.createElement('div');
        skeleton.className = 'da-floor-image-skeleton';
        skeleton.setAttribute('data-slot-skeleton', containerKey);

        const iconSpan = document.createElement('span');
        iconSpan.textContent = '正在生成图像...';
        skeleton.appendChild(iconSpan);

        this.hooks.runSuppressed(messageId, () => {
            mountToSlot(slotElement, skeleton, 'visual');
            this.activeSkeletons.set(containerKey, skeleton);
            this.hooks.syncObservedNodesIfTarget(messageId);
        });
    }

    /** 移除指定楼层容器的骨架屏 */
    public removeSkeleton(
        messageId: number,
        instructionIndex = 0,
        chatId?: string,
        swipeId?: number
    ): void {
        const coords = floorCoordinator.resolveSlotCoordinates(messageId, chatId, swipeId);
        const containerKey = buildFloorSlotKey(
            coords.chatId,
            messageId,
            coords.swipeId,
            instructionIndex
        );

        const skeleton = this.activeSkeletons.get(containerKey);
        if (skeleton) {
            this.hooks.runSuppressed(messageId, () => {
                skeleton.remove();
                this.activeSkeletons.delete(containerKey);
                this.hooks.syncObservedNodesIfTarget(messageId);
            });
        }
    }

    /** 串行渲染指定插槽的生成图像或空白重置 */
    public async renderImage(
        messageId: number,
        imageId?: string,
        instructionIndex = 0,
        serverImageUrl?: string,
        chatId?: string,
        swipeId?: number
    ): Promise<void> {
        if (typeof document === 'undefined') {
            return;
        }

        const coords = floorCoordinator.resolveSlotCoordinates(messageId, chatId, swipeId);
        const containerKey = buildFloorSlotKey(
            coords.chatId,
            messageId,
            coords.swipeId,
            instructionIndex
        );
        const token = this.hooks.captureMessageToken(messageId);

        const prevRender = this.inFlightRenders.get(containerKey) ?? Promise.resolve();
        const renderPromise = prevRender
            .catch(() => undefined)
            .then(() =>
                this.performRenderImage(
                    messageId,
                    imageId,
                    instructionIndex,
                    serverImageUrl,
                    coords.chatId,
                    coords.swipeId,
                    containerKey,
                    token
                )
            );
        this.inFlightRenders.set(containerKey, renderPromise);
        try {
            await renderPromise;
        } finally {
            if (this.inFlightRenders.get(containerKey) === renderPromise) {
                this.inFlightRenders.delete(containerKey);
            }
        }
    }

    private isStillActiveTarget(
        messageId: number,
        effectiveChatId: string,
        effectiveSwipeId: number,
        token: { clearEpoch: number; generation: number }
    ): boolean {
        if (!this.hooks.isMessageTokenValid(messageId, token)) {
            return false;
        }
        return floorCoordinator.isTargetActiveInHost({
            chatId: effectiveChatId,
            messageId,
            swipeId: effectiveSwipeId,
            instructionIndex: 0,
        });
    }

    private async performRenderImage(
        messageId: number,
        imageId: string | undefined,
        instructionIndex: number,
        serverImageUrl: string | undefined,
        effectiveChatId: string,
        effectiveSwipeId: number,
        containerKey: string,
        token: { clearEpoch: number; generation: number }
    ): Promise<void> {
        const isActive = () =>
            this.isStillActiveTarget(messageId, effectiveChatId, effectiveSwipeId, token);

        if (!isActive()) {
            return;
        }

        const containerInfo = getMessageTextContainer(messageId);
        if (!containerInfo) {
            return;
        }
        const { messageDom, mesText: textContainer } = containerInfo;

        let displayUrl = serverImageUrl;
        if (!displayUrl && imageId) {
            displayUrl = urlPool.getUrl(imageId);
            if (!displayUrl) {
                const blob = await imageStorage.getImageBlob(imageId);
                if (!isActive()) {
                    return;
                }
                if (blob && blob.size > 0) {
                    displayUrl = urlPool.createUrl(imageId, blob);
                }
            }
        }

        if (!displayUrl) {
            const target: SlotMountTarget = {
                chatId: effectiveChatId,
                messageId,
                swipeId: effectiveSwipeId,
                instructionIndex,
            };
            const activeTask = generationOrchestrator.getActiveTaskByTarget(target);
            if (activeTask) {
                this.renderSkeleton(messageId, instructionIndex, effectiveChatId, effectiveSwipeId);
            } else {
                this.removeSkeleton(messageId, instructionIndex, effectiveChatId, effectiveSwipeId);
                this.hooks.runSuppressed(messageId, () => {
                    const existingContainer = this.activeImageContainers.get(containerKey);
                    if (existingContainer) {
                        this.activePreloadCleanups.get(containerKey)?.();
                        this.activePreloadCleanups.delete(containerKey);
                        this.activeSlotCleanups.get(containerKey)?.();
                        this.activeSlotCleanups.delete(containerKey);
                        existingContainer.remove();
                        this.activeImageContainers.delete(containerKey);
                    }
                    this.activeSlotStates.delete(containerKey);
                    const slotElement = messageDom.querySelector(
                        `.da-floor-slot[data-instruction-index="${instructionIndex}"]`
                    );
                    slotElement?.querySelector('.da-floor-image-container')?.remove();
                    slotElement?.querySelector('.da-floor-image-skeleton')?.remove();

                    const button = this.activeButtons.get(containerKey);
                    if (button) {
                        button.element.style.display = '';
                        button.setState('ready');
                    }
                    this.hooks.syncObservedNodesIfTarget(messageId);
                });
            }
            return;
        }

        this.removeSkeleton(messageId, instructionIndex, effectiveChatId, effectiveSwipeId);

        const settings = settingsStore.getSettings();
        const displayCfg = settings.ui?.imageDisplay;
        const initialRecord = imageId ? await imageStorage.getImageRecord(imageId) : undefined;
        if (!isActive()) {
            return;
        }
        const initialFavorited = Boolean(initialRecord?.favorited);

        const bindImageFallback = (img: HTMLImageElement) => {
            const targetEpoch = this.hooks.getClearEpoch();
            img.onerror = async () => {
                if (
                    this.hooks.isDisposed() ||
                    this.hooks.getClearEpoch() !== targetEpoch ||
                    !img.isConnected
                ) {
                    return;
                }
                if (imageId && !img.dataset.fallbackApplied) {
                    img.dataset.fallbackApplied = 'true';
                    let localUrl = urlPool.getUrl(imageId);
                    if (!localUrl || img.src === localUrl) {
                        const blob = await imageStorage.getImageBlob(imageId);
                        if (
                            this.hooks.isDisposed() ||
                            this.hooks.getClearEpoch() !== targetEpoch ||
                            !img.isConnected
                        ) {
                            return;
                        }
                        if (blob && blob.size > 0) {
                            localUrl = urlPool.createUrl(imageId, blob);
                        } else {
                            localUrl = undefined;
                        }
                    }
                    if (localUrl && img.src !== localUrl) {
                        logger.info(`图像展示异常，已从本地数据库重建展示地址 [${imageId}]`);
                        img.src = localUrl;
                        const state = this.activeSlotStates.get(containerKey);
                        if (state) {
                            state.displayUrl = localUrl;
                        }
                    }
                }
            };
        };

        const existingContainer = this.activeImageContainers.get(containerKey);
        const existingImg = existingContainer?.querySelector(
            '.da-floor-image'
        ) as HTMLImageElement | null;
        if (existingContainer && existingImg) {
            this.hooks.runSuppressed(messageId, () => {
                const mountTarget =
                    resolveSlotElement(messageId, instructionIndex, textContainer) ?? textContainer;
                mountToSlot(mountTarget, existingContainer, 'visual');
                const existingButton = this.activeButtons.get(containerKey);
                if (existingButton && existingButton.element.style.display !== 'none') {
                    mountToSlot(mountTarget, existingButton.element, 'button');
                }
                this.hooks.syncObservedNodesIfTarget(messageId);
            });

            delete existingImg.dataset.fallbackApplied;
            bindImageFallback(existingImg);

            this.activePreloadCleanups.get(containerKey)?.();

            const preloader = new Image();
            let applied = false;
            let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
            const cleanupPreloader = () => {
                if (fallbackTimer !== null) {
                    clearTimeout(fallbackTimer);
                    fallbackTimer = null;
                }
                preloader.onload = null;
                preloader.onerror = null;
            };

            const applySwap = () => {
                if (applied) return;
                applied = true;
                cleanupPreloader();
                this.activePreloadCleanups.delete(containerKey);
                if (this.activeImageContainers.get(containerKey) !== existingContainer || !isActive()) {
                    return;
                }
                existingImg.src = displayUrl;
                existingImg.classList.remove('da-floor-image--regenerating');
            };

            preloader.onload = applySwap;
            preloader.onerror = applySwap;
            if (typeof preloader.decode === 'function') {
                preloader.decode().then(applySwap).catch(applySwap);
            }
            preloader.src = displayUrl;
            if (preloader.complete) {
                applySwap();
            } else {
                fallbackTimer = setTimeout(applySwap, 8000);
            }

            if (!applied) {
                this.activePreloadCleanups.set(containerKey, () => {
                    cleanupPreloader();
                    applied = true;
                });
            }

            const existingState = this.activeSlotStates.get(containerKey);
            if (existingState) {
                existingState.target = {
                    chatId: effectiveChatId,
                    messageId,
                    swipeId: effectiveSwipeId,
                    instructionIndex,
                };
                existingState.imageId = imageId;
                existingState.displayUrl = displayUrl;
                existingState.syncFavUI(initialFavorited);
            }
            if (settings.saveToServer && !serverImageUrl && imageId) {
                const liveCoords = floorCoordinator.resolveSlotCoordinates(messageId);
                void sessionLifecycle.ensureSlotServerImage({
                    chatId: liveCoords.chatId,
                    messageId,
                    swipeId: liveCoords.swipeId,
                    instructionIndex,
                });
            }
            logger.info(`已更新楼层 #${messageId} 图像 (序号: ${instructionIndex})`);
            return;
        }

        const isLightboxEnabled = settings.ui?.lightbox?.enabled ?? true;
        const isImageActionPanelEnabled = settings.ui?.imageActionPanel?.enabled ?? true;

        const favBtn = document.createElement('button');
        const slotState: FloorSlotState = {
            target: {
                chatId: effectiveChatId,
                messageId,
                swipeId: effectiveSwipeId,
                instructionIndex,
            },
            imageId,
            displayUrl,
            favorited: initialFavorited,
            syncFavUI: (fav: boolean) => {
                slotState.favorited = fav;
                favBtn.classList.toggle('is-active', fav);
                favBtn.title = fav ? '取消收藏' : '收藏图片';
                favBtn.innerHTML = renderIcon(fav ? 'starFilled' : 'star', 14);
            },
        };
        this.activeSlotStates.set(containerKey, slotState);

        const imageContainer = document.createElement('div');
        imageContainer.className = 'da-floor-image-container';

        const imageBox = document.createElement('div');
        imageBox.className = 'da-floor-image-box';

        const imgEl = document.createElement('img');
        imgEl.className = 'da-floor-image';
        bindImageFallback(imgEl);
        imgEl.src = displayUrl;
        imgEl.alt = 'AI 生成图像';
        imgEl.loading = 'lazy';

        const resolveSlotBlob = async (): Promise<Blob | null> => {
            if (slotState.imageId) {
                const stored = await imageStorage.getImageBlob(slotState.imageId);
                if (stored && stored.size > 0) return stored;
            }
            if (slotState.displayUrl) {
                const res = await fetch(slotState.displayUrl);
                if (res.ok) return await res.blob();
            }
            return null;
        };
        const dragFileBase = `st_draw_${slotState.imageId ? slotState.imageId.slice(0, 8) : messageId}`;
        const detachDrag = attachImageDragFile(imgEl, resolveSlotBlob, dragFileBase);

        let justLongPressed = false;
        if (isLightboxEnabled) {
            imgEl.classList.add('da-floor-image--zoomable');
            imgEl.title = '点击查看大图';
            imgEl.addEventListener('click', (e) => {
                if (justLongPressed) {
                    justLongPressed = false;
                    e.stopPropagation();
                    e.preventDefault();
                    return;
                }
                e.stopPropagation();
                void this.openSlotLightbox(
                    slotState,
                    messageId,
                    instructionIndex,
                    isImageActionPanelEnabled
                );
            });
        }

        if (isImageActionPanelEnabled) {
            imageBox.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                void this.hooks.openImageActionPanel(
                    messageId,
                    instructionIndex,
                    slotState.imageId,
                    slotState.displayUrl
                );
            });

            let touchTimer: ReturnType<typeof setTimeout> | null = null;
            let clickSuppressionTimer: ReturnType<typeof setTimeout> | null = null;
            let touchStartX = 0;
            let touchStartY = 0;

            const cancelTouch = () => {
                if (touchTimer) {
                    clearTimeout(touchTimer);
                    touchTimer = null;
                }
            };

            const cancelAllGestures = () => {
                cancelTouch();
                if (clickSuppressionTimer) {
                    clearTimeout(clickSuppressionTimer);
                    clickSuppressionTimer = null;
                }
                justLongPressed = false;
            };

            imageBox.addEventListener(
                'touchstart',
                (e) => {
                    if (e.touches.length !== 1) return;
                    justLongPressed = false;
                    const touch = e.touches[0];
                    touchStartX = touch.clientX;
                    touchStartY = touch.clientY;

                    touchTimer = setTimeout(() => {
                        touchTimer = null;
                        justLongPressed = true;
                        void this.hooks.openImageActionPanel(
                            messageId,
                            instructionIndex,
                            slotState.imageId,
                            slotState.displayUrl
                        );
                    }, 500);
                },
                { passive: true }
            );

            imageBox.addEventListener(
                'touchmove',
                (e) => {
                    if (!touchTimer) return;
                    const touch = e.touches[0];
                    if (touch) {
                        const dx = Math.abs(touch.clientX - touchStartX);
                        const dy = Math.abs(touch.clientY - touchStartY);
                        if (dx > 10 || dy > 10) {
                            cancelTouch();
                        }
                    }
                },
                { passive: true }
            );

            imageBox.addEventListener('touchend', () => {
                cancelTouch();
                if (justLongPressed) {
                    if (clickSuppressionTimer) clearTimeout(clickSuppressionTimer);
                    clickSuppressionTimer = setTimeout(() => {
                        justLongPressed = false;
                        clickSuppressionTimer = null;
                    }, 300);
                }
            });

            imageBox.addEventListener('touchcancel', cancelTouch, { passive: true });

            this.activeSlotCleanups.set(containerKey, () => {
                detachDrag();
                cancelAllGestures();
            });
        } else {
            this.activeSlotCleanups.set(containerKey, detachDrag);
        }

        imageBox.appendChild(imgEl);

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'da-floor-image__actions';

        favBtn.type = 'button';
        favBtn.className = 'da-floor-image__action-btn';
        slotState.syncFavUI(initialFavorited);
        favBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (slotState.imageId) {
                const nextFav = await imageStorage.toggleFavorite(slotState.imageId);
                slotState.syncFavUI(nextFav);
                Toast.info(nextFav ? '已加入收藏' : '已取消收藏');
            }
        });
        actionsContainer.appendChild(favBtn);

        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'da-floor-image__action-btn';
        infoBtn.title = '查看生成元信息';
        infoBtn.innerHTML = renderIcon('info', 14);
        infoBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentRecord = slotState.imageId
                ? await imageStorage.getImageRecord(slotState.imageId)
                : undefined;
            imageInfoModal.open({
                record: currentRecord,
                metadata: currentRecord?.metadata,
                imageUrl: slotState.displayUrl,
                onPreview: (url) => {
                    void this.openSlotLightbox(
                        slotState,
                        messageId,
                        instructionIndex,
                        isImageActionPanelEnabled,
                        url
                    );
                },
                onEdit: isImageActionPanelEnabled
                    ? () => {
                          void this.hooks.openImageActionPanel(
                              messageId,
                              instructionIndex,
                              slotState.imageId,
                              slotState.displayUrl
                          );
                      }
                    : undefined,
            });
        });
        actionsContainer.appendChild(infoBtn);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'da-floor-image__action-btn';
        copyBtn.title = '复制图片';
        copyBtn.innerHTML = renderIcon('copy', 14);
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const blob = await resolveSlotBlob();
            if (!blob) {
                Toast.error('获取图片数据失败');
                return;
            }
            const ok = await copyImageBlobToClipboard(blob);
            if (ok) {
                Toast.success('已复制图片到剪贴板');
            } else {
                Toast.error('当前浏览器不支持复制图片，请使用右键或下载');
            }
        });
        actionsContainer.appendChild(copyBtn);

        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'da-floor-image__action-btn';
        downloadBtn.title = '下载图片';
        downloadBtn.innerHTML = renderIcon('download', 14);
        downloadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const safePrefix = slotState.imageId ? slotState.imageId.slice(0, 8) : Date.now();
                const ok = await downloadImageAsset({
                    resolveBlob: resolveSlotBlob,
                    url: slotState.displayUrl,
                    fileNameBase: `st_draw_${safePrefix}`,
                });
                if (!ok) {
                    Toast.error('下载失败，未找到可用图像资源');
                }
            } catch (err) {
                logger.error('下载图片异常:', err);
            }
        });
        actionsContainer.appendChild(downloadBtn);

        if (isImageActionPanelEnabled) {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'da-floor-image__action-btn';
            editBtn.title = '编辑并重新生成';
            editBtn.innerHTML = renderIcon('sliders', 14);
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.hooks.openImageActionPanel(
                    messageId,
                    instructionIndex,
                    slotState.imageId,
                    slotState.displayUrl
                );
            });
            actionsContainer.appendChild(editBtn);
        }

        imageBox.appendChild(actionsContainer);

        const collapseToggleBtn = document.createElement('button');
        collapseToggleBtn.type = 'button';
        collapseToggleBtn.className = 'da-floor-image-collapse-toggle';
        collapseToggleBtn.setAttribute('aria-expanded', 'false');
        collapseToggleBtn.innerHTML = `<span class="da-floor-image-collapse-toggle__arrow">${renderIcon('chevronRight', 13)}</span><span class="da-floor-image-collapse-toggle__icon">${renderIcon('image', 13)}</span><span class="da-floor-image-collapse-toggle__label">展开生成图片</span>`;
        collapseToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const expanded = imageContainer.classList.toggle('is-expanded');
            collapseToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            const labelEl = collapseToggleBtn.querySelector('.da-floor-image-collapse-toggle__label');
            if (labelEl) {
                labelEl.textContent = expanded ? '收起生成图片' : '展开生成图片';
            }
        });

        imageContainer.appendChild(collapseToggleBtn);
        imageContainer.appendChild(imageBox);
        applyDisplaySettingsToContainer(imageContainer, displayCfg);

        this.hooks.runSuppressed(messageId, () => {
            const mountTarget =
                resolveSlotElement(messageId, instructionIndex, textContainer) ?? textContainer;
            mountToSlot(mountTarget, imageContainer, 'visual');
            this.activeImageContainers.set(containerKey, imageContainer);
            const existingButton = this.activeButtons.get(containerKey);
            if (existingButton && existingButton.element.style.display !== 'none') {
                mountToSlot(mountTarget, existingButton.element, 'button');
            }
            this.hooks.syncObservedNodesIfTarget(messageId);
        });

        if (settings.saveToServer && !serverImageUrl && imageId) {
            const liveCoords = floorCoordinator.resolveSlotCoordinates(messageId);
            void sessionLifecycle.ensureSlotServerImage({
                chatId: liveCoords.chatId,
                messageId,
                swipeId: liveCoords.swipeId,
                instructionIndex,
            });
        }

        logger.info(`已成功在楼层 #${messageId} 挂载生成图像 (序号: ${instructionIndex})`);
    }

    /** 打开楼层插槽大图预览，支持历史图片翻页对照与设为当前 */
    private async openSlotLightbox(
        slotState: FloorSlotState,
        messageId: number,
        instructionIndex: number,
        isImageActionPanelEnabled: boolean,
        currentOverrideUrl?: string
    ): Promise<void> {
        const currentUrl = currentOverrideUrl || slotState.displayUrl;
        const currentImageId = slotState.imageId;
        const slotEntry = sessionLifecycle.getSlotEntry(slotState.target);
        const historyIds = Array.isArray(slotEntry?.history) ? slotEntry.history : [];

        const items: LightboxItem[] = [];
        const missingHistoryIds = new Set<string>();

        for (const histId of historyIds) {
            if (!histId || histId === currentImageId) {
                continue;
            }
            let histUrl = urlPool.getUrl(histId);
            const record = await imageStorage.getImageRecord(histId).catch(() => undefined);
            if (!histUrl) {
                const blob = await imageStorage.getImageBlob(histId).catch(() => undefined);
                if (blob && blob.size > 0) {
                    histUrl = urlPool.createUrl(histId, blob);
                } else if (record?.remotePath) {
                    histUrl = record.remotePath;
                }
            }
            if (!histUrl) {
                missingHistoryIds.add(histId);
                continue;
            }
            const resolvedHistUrl = histUrl;
            items.push({
                url: resolvedHistUrl,
                imageId: histId,
                favorited: Boolean(record?.favorited),
                title: record?.metadata?.rawPrompt || record?.metadata?.prompt,
                isHistory: true,
                onEdit: isImageActionPanelEnabled
                    ? () => {
                          void this.hooks.openImageActionPanel(
                              messageId,
                              instructionIndex,
                              histId,
                              resolvedHistUrl
                          );
                      }
                    : undefined,
                onSetCurrent: async () => {
                    const switched = await sessionLifecycle.switchSlotToHistoryImage(
                        slotState.target,
                        histId,
                        { imageUrl: record?.remotePath }
                    );
                    if (!switched) {
                        Toast.error('切换失败：目标楼层或分支已变更');
                        return false;
                    }
                    await this.renderImage(
                        messageId,
                        switched.imageId,
                        instructionIndex,
                        switched.imageUrl,
                        slotState.target.chatId,
                        slotState.target.swipeId
                    );
                    Toast.success('已将该历史图片设为当前楼层图片');
                    if (lightboxModal.isOpen()) {
                        await this.openSlotLightbox(
                            slotState,
                            messageId,
                            instructionIndex,
                            isImageActionPanelEnabled
                        );
                    }
                    return true;
                },
            });
        }

        if (missingHistoryIds.size > 0) {
            void sessionLifecycle.pruneSlotHistory(slotState.target, missingHistoryIds);
        }

        const currentRecord = currentImageId
            ? await imageStorage.getImageRecord(currentImageId).catch(() => undefined)
            : undefined;
        items.push({
            url: currentUrl,
            imageId: currentImageId,
            favorited: slotState.favorited,
            title: currentRecord?.metadata?.rawPrompt || currentRecord?.metadata?.prompt,
            isHistory: false,
            onFavoriteChange: (newFav) => {
                slotState.syncFavUI(newFav);
            },
            onEdit: isImageActionPanelEnabled
                ? () => {
                      void this.hooks.openImageActionPanel(
                          messageId,
                          instructionIndex,
                          slotState.imageId,
                          slotState.displayUrl
                      );
                  }
                : undefined,
        });

        lightboxModal.openItems(items, items.length - 1);
    }

    /** 为指定生图指令容器创建或复用交互动作按钮，挂载并同步状态 */
    public mountActionButtonForSlot(options: {
        chatId: string;
        messageId: number;
        swipeId: number;
        target: SlotMountTarget;
        cmd: ExtractedFloorCommand;
        slotKey: string;
        slotElement: HTMLElement;
        hasRenderedImage: boolean;
        activeTask: DrawingTask | undefined;
        hideButtonOnDone: boolean;
    }): void {
        const {
            chatId,
            messageId,
            swipeId,
            target,
            cmd,
            slotKey,
            slotElement,
            hasRenderedImage,
            activeTask,
            hideButtonOnDone,
        } = options;

        this.hooks.runSuppressed(messageId, () => {
            if (hasRenderedImage && hideButtonOnDone && !activeTask) {
                const existingBtn = this.activeButtons.get(slotKey);
                if (existingBtn) {
                    existingBtn.dispose();
                    this.activeButtons.delete(slotKey);
                }
                return;
            }

            let button = this.activeButtons.get(slotKey);
            if (!button) {
                button = new FloorActionButton({
                    chatId,
                    messageId,
                    instructionIndex: cmd.instructionIndex,
                    onTrigger: async () => {
                        const currentSettings = settingsStore.getSettings();
                        const check = floorCoordinator.validateCurrentPresetAssets(
                            currentSettings.activeProvider as ProviderType
                        );
                        if (!check.valid) {
                            const confirmed = await ConfirmDialog.confirm({
                                title: '模型缺失确认',
                                message: `当前生图参数预设引用的部分模型未在服务端检测到：\n- ${check.missing.join('\n- ')}\n\n是否仍继续尝试生图？`,
                                confirmText: '继续生图',
                                cancelText: '取消',
                            });
                            if (!confirmed) {
                                return false;
                            }
                        }

                        const liveSlot = resolveSlotElement(messageId, cmd.instructionIndex);
                        const imgEl = liveSlot?.querySelector('.da-floor-image') ?? null;
                        if (imgEl) {
                            imgEl.classList.add('da-floor-image--regenerating');
                        } else {
                            this.renderSkeleton(messageId, cmd.instructionIndex, chatId, swipeId);
                        }

                        try {
                            const { taskId, status } = await floorCoordinator.submitSlotTask({
                                target,
                                rawPrompt: cmd.promptText,
                            });
                            if (status === 'generating' && button?.getState() === 'pending') {
                                button.setState('generating');
                            }
                            return taskId;
                        } catch (err: unknown) {
                            this.removeSkeleton(messageId, cmd.instructionIndex, chatId, swipeId);
                            const currentSlot = resolveSlotElement(messageId, cmd.instructionIndex);
                            currentSlot
                                ?.querySelector('.da-floor-image')
                                ?.classList.remove('da-floor-image--regenerating');
                            Toast.error('生图任务提交失败，请前往「日志与统计」查看详情');
                            throw err;
                        }
                    },
                    onCancel: () => {
                        floorCoordinator.cancelSlotTask(target, '用户主动取消');
                        const liveSlot = resolveSlotElement(messageId, cmd.instructionIndex);
                        liveSlot
                            ?.querySelector('.da-floor-image')
                            ?.classList.remove('da-floor-image--regenerating');
                        this.removeSkeleton(messageId, cmd.instructionIndex, chatId, swipeId);
                    },
                });

                this.activeButtons.set(slotKey, button);
            }

            mountToSlot(slotElement, button.element, 'button');

            if (activeTask) {
                button.element.style.display = '';
                button.setState(activeTask.status === 'pending' ? 'pending' : 'generating');
            } else if (hasRenderedImage) {
                button.element.style.display = hideButtonOnDone ? 'none' : '';
                button.setState('done');
            } else {
                button.element.style.display = '';
                button.setState('ready');
            }
        });
    }

    /** 清理指定楼层所有已注册插槽的 UI 实例 */
    public purgeMessageSlots(messageId: number): void {
        for (const [key, btn] of this.activeButtons.entries()) {
            if (matchesFloorSlotMessage(key, messageId)) {
                btn.dispose();
                this.activeButtons.delete(key);
            }
        }

        for (const [key, container] of this.activeImageContainers.entries()) {
            if (matchesFloorSlotMessage(key, messageId)) {
                this.activePreloadCleanups.get(key)?.();
                this.activePreloadCleanups.delete(key);
                this.activeSlotCleanups.get(key)?.();
                this.activeSlotCleanups.delete(key);
                container.remove();
                this.activeImageContainers.delete(key);
                this.activeSlotStates.delete(key);
            }
        }

        for (const [key, skeleton] of this.activeSkeletons.entries()) {
            if (matchesFloorSlotMessage(key, messageId)) {
                skeleton.remove();
                this.activeSkeletons.delete(key);
            }
        }
    }

    /** 响应图片删除：支持保留服务端备份切换或清理容器重置按钮 */
    public handleImageDeleted(imageId: string): void {
        sessionLifecycle.pruneHistoryImageIdFromChat?.(imageId);
        const affectedEntries: Array<[string, FloorSlotState]> = [];
        for (const [key, slotState] of this.activeSlotStates.entries()) {
            if (slotState.imageId === imageId) {
                affectedEntries.push([key, slotState]);
            }
        }

        for (const [key, slotState] of affectedEntries) {
            const slotEntry = slotState.target
                ? sessionLifecycle.getSlotEntry(slotState.target)
                : undefined;
            const serverImageUrl = slotEntry?.imageUrl;

            if (serverImageUrl) {
                slotState.displayUrl = serverImageUrl;
                const container = this.activeImageContainers.get(key);
                const imgEl = container?.querySelector('.da-floor-image') as HTMLImageElement | null;
                if (imgEl && imgEl.src !== serverImageUrl) {
                    imgEl.src = serverImageUrl;
                }
                logger.info(
                    `本地图库图像已删除，楼层图片已平滑切换至服务端备份: ${key} [${imageId}]`
                );
                continue;
            }

            const targetMessageId = slotState.target?.messageId;
            const executeCleanup = () => {
                this.activePreloadCleanups.get(key)?.();
                this.activePreloadCleanups.delete(key);
                this.activeSlotCleanups.get(key)?.();
                this.activeSlotCleanups.delete(key);
                this.activeSlotStates.delete(key);
                const container = this.activeImageContainers.get(key);
                if (container) {
                    container.remove();
                    this.activeImageContainers.delete(key);
                }

                const button = this.activeButtons.get(key);
                if (button) {
                    button.element.style.display = '';
                    button.setState('ready');
                }
                if (typeof targetMessageId === 'number') {
                    this.hooks.syncObservedNodesIfTarget(targetMessageId);
                }
            };
            if (typeof targetMessageId === 'number') {
                this.hooks.runSuppressed(targetMessageId, executeCleanup);
            } else {
                executeCleanup();
            }
            logger.info(`已同步重置被删除图像对应楼层图片容器: ${key} [${imageId}]`);
        }
    }

    /** 清理全部活跃插槽 DOM 与预载定时器 */
    public clearAll(options?: { preserveFloorSlots?: boolean }): void {
        this.inFlightRenders.clear();

        for (const cleanup of this.activePreloadCleanups.values()) {
            try {
                cleanup();
            } catch {
                // 忽略注销异常
            }
        }
        this.activePreloadCleanups.clear();

        for (const cleanup of this.activeSlotCleanups.values()) {
            try {
                cleanup();
            } catch {
                // 忽略注销异常
            }
        }
        this.activeSlotCleanups.clear();

        for (const btn of this.activeButtons.values()) {
            try {
                btn.dispose();
            } catch {
                // 忽略注销异常
            }
        }
        this.activeButtons.clear();

        for (const container of this.activeImageContainers.values()) {
            try {
                container.remove();
            } catch {
                // 忽略注销异常
            }
        }
        this.activeImageContainers.clear();
        this.activeSlotStates.clear();

        for (const skeleton of this.activeSkeletons.values()) {
            try {
                skeleton.remove();
            } catch {
                // 忽略注销异常
            }
        }
        this.activeSkeletons.clear();

        if (typeof document !== 'undefined') {
            const selector = buildFloorCleanupSelector('#chat', options?.preserveFloorSlots);
            for (const node of document.querySelectorAll(selector)) {
                node.remove();
            }
        }
    }
}
