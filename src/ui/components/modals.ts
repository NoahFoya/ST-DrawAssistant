/**
 * @module ui/components/modals
 * @description 扩展统一 UI 模态弹窗组件库 (Consolidated Modals)
 *
 * 职责：
 * - BLOCK 1: 通用对话框 (showConfirmDialog, showPromptDialog, showTripleChoiceDialog)
 * - BLOCK 2: 图像详细元数据查看面板 (openImageInfoPanel)
 * - BLOCK 3: 悬浮球自定义图标裁剪弹窗 (openImageCropperModal)
 */

import { logger } from '../../core/logger';
import { showToastNotice } from '../../utils/toast';
import { formatBytes } from '../../utils/image-utils';
import { getImageFromDB } from '../../storage/image-db';
import { applyCurrentThemeToNode } from '../tabs/theme-tab';

// ============================================================================
// BLOCK 1: 通用对话框组件 (Confirm / Prompt / TripleChoice)
// ============================================================================

export interface ConfirmDialogOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
}

export interface PromptDialogOptions {
    title?: string;
    message: string;
    defaultValue?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
}

export interface TripleChoiceDialogOptions {
    title?: string;
    message: string;
    saveText?: string;
    discardText?: string;
    cancelText?: string;
}

export type TripleChoiceResult = 'save' | 'discard' | 'cancel';

/**
 * 弹出确认操作对话框
 *
 * @param options 对话框配置
 * @returns 确认返回 true，取消返回 false 的 Promise
 */
export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root';
        backdrop.style.zIndex = '100090';
        backdrop.style.display = 'flex';
        backdrop.style.alignItems = 'center';
        backdrop.style.justifyContent = 'center';
        applyCurrentThemeToNode(backdrop);

        const dialog = document.createElement('div');
        dialog.className = 'da-settings-panel da-dialog-panel';
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const titleEl = document.createElement('div');
        titleEl.className = 'da-dialog-title';
        titleEl.textContent = options.title || '操作确认';

        const messageEl = document.createElement('div');
        messageEl.className = 'da-dialog-message';
        messageEl.textContent = options.message;

        const btnGroup = document.createElement('div');
        btnGroup.className = 'da-dialog-actions';

        const btnCancel = document.createElement('button');
        btnCancel.className = 'da-btn secondary';
        btnCancel.textContent = options.cancelText || '取消';

        const btnConfirm = document.createElement('button');
        btnConfirm.className = options.isDangerous ? 'da-btn danger' : 'da-btn primary';
        btnConfirm.textContent = options.confirmText || '确定';

        const cleanup = (result: boolean) => {
            document.removeEventListener('keydown', keyHandler);
            backdrop.remove();
            resolve(result);
        };

        btnCancel.addEventListener('click', () => cleanup(false));
        btnConfirm.addEventListener('click', () => cleanup(true));

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                document.removeEventListener('keydown', keyHandler);
                cleanup(false);
            } else if (e.key === 'Enter' && !options.isDangerous) {
                e.preventDefault();
                document.removeEventListener('keydown', keyHandler);
                cleanup(true);
            }
        };
        document.addEventListener('keydown', keyHandler);

        backdrop.addEventListener('click', () => {
            document.removeEventListener('keydown', keyHandler);
            cleanup(false);
        });

        btnGroup.appendChild(btnCancel);
        btnGroup.appendChild(btnConfirm);

        dialog.appendChild(titleEl);
        dialog.appendChild(messageEl);
        dialog.appendChild(btnGroup);

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        btnConfirm.focus();
    });
}

/**
 * 弹出文本输入对话框
 *
 * @param options 对话框配置
 * @returns 确认返回输入的文本，取消返回 null 的 Promise
 */
export function showPromptDialog(options: PromptDialogOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root';
        backdrop.style.zIndex = '100090';
        backdrop.style.display = 'flex';
        backdrop.style.alignItems = 'center';
        backdrop.style.justifyContent = 'center';
        applyCurrentThemeToNode(backdrop);

        const dialog = document.createElement('div');
        dialog.className = 'da-settings-panel da-dialog-panel';
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const titleEl = document.createElement('div');
        titleEl.className = 'da-dialog-title';
        titleEl.textContent = options.title || '请输入名称';

        const messageEl = document.createElement('div');
        messageEl.className = 'da-dialog-message';
        messageEl.style.marginBottom = '14px';
        messageEl.textContent = options.message;

        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'da-input';
        inputEl.value = options.defaultValue || '';
        inputEl.placeholder = options.placeholder || '';
        inputEl.style.width = '100%';
        inputEl.style.marginBottom = '22px';
        inputEl.style.boxSizing = 'border-box';

        const btnGroup = document.createElement('div');
        btnGroup.className = 'da-dialog-actions';

        const btnCancel = document.createElement('button');
        btnCancel.className = 'da-btn secondary';
        btnCancel.textContent = options.cancelText || '取消';

        const btnConfirm = document.createElement('button');
        btnConfirm.className = 'da-btn primary';
        btnConfirm.textContent = options.confirmText || '确定';

        const cleanup = (result: string | null) => {
            backdrop.remove();
            resolve(result);
        };

        btnCancel.addEventListener('click', () => cleanup(null));
        btnConfirm.addEventListener('click', () => {
            const val = inputEl.value.trim();
            cleanup(val ? val : null);
        });

        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = inputEl.value.trim();
                cleanup(val ? val : null);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cleanup(null);
            }
        });

        backdrop.addEventListener('click', () => cleanup(null));

        btnGroup.appendChild(btnCancel);
        btnGroup.appendChild(btnConfirm);

        dialog.appendChild(titleEl);
        dialog.appendChild(messageEl);
        dialog.appendChild(inputEl);
        dialog.appendChild(btnGroup);

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        requestAnimationFrame(() => {
            inputEl.focus();
            inputEl.select();
        });
    });
}

/**
 * 弹出三按钮选择对话框（用于未保存草稿确认提示）
 *
 * @param options 对话框配置
 * @returns 用户选择类型 Promise：'save' | 'discard' | 'cancel'
 */
export function showTripleChoiceDialog(options: TripleChoiceDialogOptions): Promise<TripleChoiceResult> {
    return new Promise<TripleChoiceResult>((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root';
        backdrop.style.zIndex = '100095';
        backdrop.style.display = 'flex';
        backdrop.style.alignItems = 'center';
        backdrop.style.justifyContent = 'center';
        applyCurrentThemeToNode(backdrop);

        const dialog = document.createElement('div');
        dialog.className = 'da-settings-panel da-dialog-panel';
        dialog.style.maxWidth = '450px';
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const titleEl = document.createElement('div');
        titleEl.className = 'da-dialog-title';
        titleEl.textContent = options.title || '⚠️ 未保存修改提示';

        const messageEl = document.createElement('div');
        messageEl.className = 'da-dialog-message';
        messageEl.textContent = options.message;

        const btnGroup = document.createElement('div');
        btnGroup.className = 'da-dialog-actions';
        btnGroup.style.gap = '8px';

        const btnCancel = document.createElement('button');
        btnCancel.className = 'da-btn secondary';
        btnCancel.textContent = options.cancelText || '取消';

        const btnDiscard = document.createElement('button');
        btnDiscard.className = 'da-btn secondary';
        btnDiscard.style.borderColor = 'var(--da-status-warning-border, rgba(255, 159, 10, 0.45))';
        btnDiscard.style.color = 'var(--da-status-warning, #ff9f0a)';
        btnDiscard.textContent = options.discardText || '放弃修改';

        const btnSave = document.createElement('button');
        btnSave.className = 'da-btn primary';
        btnSave.textContent = options.saveText || '保存修改';

        const cleanup = (result: TripleChoiceResult) => {
            document.removeEventListener('keydown', keyHandler);
            backdrop.remove();
            resolve(result);
        };

        btnCancel.addEventListener('click', () => cleanup('cancel'));
        btnDiscard.addEventListener('click', () => cleanup('discard'));
        btnSave.addEventListener('click', () => cleanup('save'));

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                document.removeEventListener('keydown', keyHandler);
                cleanup('cancel');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                document.removeEventListener('keydown', keyHandler);
                cleanup('save');
            }
        };
        document.addEventListener('keydown', keyHandler);

        backdrop.addEventListener('click', () => {
            document.removeEventListener('keydown', keyHandler);
            cleanup('cancel');
        });

        btnGroup.appendChild(btnCancel);
        btnGroup.appendChild(btnDiscard);
        btnGroup.appendChild(btnSave);

        dialog.appendChild(titleEl);
        dialog.appendChild(messageEl);
        dialog.appendChild(btnGroup);

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        btnSave.focus();
    });
}

// ============================================================================
// BLOCK 2: 图像详细元数据查看面板
// ============================================================================

export interface ImageMetadata {
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    model?: string;
    samplerName?: string;
    scheduler?: string;
    timestamp?: number;
    [key: string]: unknown;
}

/**
 * 弹出全屏 Lightbox 图像放大全景查看器
 *
 * @param imgSrc 图像 Base64 数据串或 DataURL/URL
 */
export function openLightboxModal(imgSrc: string): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';
    backdrop.style.zIndex = '100100';
    backdrop.style.display = 'flex';
    backdrop.style.alignItems = 'center';
    backdrop.style.justifyContent = 'center';
    backdrop.style.cursor = 'zoom-out';
    backdrop.style.background = 'rgba(0, 0, 0, 0.88)';
    backdrop.style.backdropFilter = 'blur(14px)';
    applyCurrentThemeToNode(backdrop);

    const img = document.createElement('img');
    img.src = imgSrc.startsWith('data:') ? imgSrc : `data:image/png;base64,${imgSrc}`;
    img.style.maxWidth = '94vw';
    img.style.maxHeight = '94vh';
    img.style.objectFit = 'contain';
    img.style.borderRadius = '8px';
    img.style.boxShadow = '0 20px 60px rgba(0, 0, 0, 0.8)';
    img.style.transition = 'transform 0.2s ease';

    const closeBadge = document.createElement('div');
    closeBadge.style.position = 'absolute';
    closeBadge.style.top = '20px';
    closeBadge.style.right = '24px';
    closeBadge.style.color = '#ffffff';
    closeBadge.style.fontSize = '1.4em';
    closeBadge.style.cursor = 'pointer';
    closeBadge.style.userSelect = 'none';
    closeBadge.style.padding = '4px 12px';
    closeBadge.style.borderRadius = '8px';
    closeBadge.style.background = 'rgba(255, 255, 255, 0.1)';
    closeBadge.textContent = '✕';

    backdrop.appendChild(img);
    backdrop.appendChild(closeBadge);
    backdrop.onclick = () => backdrop.remove();
    document.body.appendChild(backdrop);
}

/**
 * 弹出图像元数据详情展示面板
 *
 * @param imageId 图片 ID 或 StoredImageRecord 实体
 * @param meta 图像包含的元数据结构体或回调挂载对象
 */
export async function openImageInfoPanel(imageIdOrMeta: any, meta?: any): Promise<void> {
    let imageId = 'Preview';
    let recordObj: any = {};
    let metaObj: any = {};
    let targetUuid: string | undefined;

    if (typeof imageIdOrMeta === 'object' && imageIdOrMeta !== null) {
        recordObj = imageIdOrMeta;
        metaObj = imageIdOrMeta.metadata || imageIdOrMeta;
        targetUuid = recordObj.uuid || recordObj.id || recordObj.imageId;
    } else if (typeof imageIdOrMeta === 'string' && imageIdOrMeta.trim()) {
        targetUuid = imageIdOrMeta.trim();
        metaObj = (typeof meta === 'object' && meta !== null) ? meta : {};
        recordObj = metaObj;
    }

    if (targetUuid) {
        imageId = String(targetUuid).slice(0, 8);
    }

    if (targetUuid && (!recordObj.data && !metaObj.data)) {
        try {
            const dbRecord = await getImageFromDB(targetUuid);
            if (dbRecord) {
                recordObj = dbRecord;
                metaObj = dbRecord.metadata || dbRecord;
            }
        } catch (err) {
            logger.warn(`openImageInfoPanel: 从 IndexedDB 提取图像记录失败 (uuid=${targetUuid})`, err);
        }
    }

    let onRefreshFn: (() => void) | undefined;
    let onDeleteFn: ((uuid: string) => void) | undefined;

    if (typeof meta === 'function') {
        onRefreshFn = meta;
    } else if (typeof meta === 'object' && meta !== null) {
        if (typeof meta.onRefresh === 'function') onRefreshFn = meta.onRefresh;
        if (typeof meta.onDelete === 'function') onDeleteFn = meta.onDelete;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';
    backdrop.style.zIndex = '100095';
    applyCurrentThemeToNode(backdrop);

    const panel = document.createElement('div');
    panel.className = 'da-settings-panel st-da-root';
    panel.style.width = '90%';
    panel.style.maxWidth = '860px';
    panel.style.padding = '22px';
    panel.style.borderRadius = '16px';
    panel.style.background = 'var(--da-bg-secondary-rgba, var(--da-bg-secondary, #1a1d26))';
    panel.style.backdropFilter = 'blur(var(--da-blur-radius, 20px))';
    panel.style.border = '1px solid var(--da-border-color)';
    panel.style.boxShadow = '0 16px 48px rgba(0, 0, 0, 0.65)';
    panel.style.color = 'var(--da-text-primary)';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '14px';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.borderBottom = '1px solid var(--da-border-color)';
    header.style.paddingBottom = '12px';

    const headerLeft = document.createElement('div');
    headerLeft.style.display = 'flex';
    headerLeft.style.alignItems = 'center';
    headerLeft.style.gap = '8px';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.style.fontSize = '1.1em';
    title.style.fontWeight = 'bold';
    title.style.color = 'var(--da-text-primary)';
    title.textContent = '🖼️ 图像元数据详情';

    const badge = document.createElement('span');
    badge.style.fontSize = '0.75em';
    badge.style.padding = '2px 8px';
    badge.style.borderRadius = '10px';
    badge.style.background = 'rgba(var(--da-accent-rgb, 0, 242, 254), 0.15)';
    badge.style.color = 'var(--da-accent-color, #00f2fe)';
    badge.style.border = '1px solid rgba(var(--da-accent-rgb, 0, 242, 254), 0.3)';
    badge.style.fontFamily = 'var(--monoFontFamily, monospace)';
    badge.textContent = `#${imageId}`;

    headerLeft.appendChild(title);
    headerLeft.appendChild(badge);

    const btnClose = document.createElement('button');
    btnClose.className = 'da-btn secondary';
    btnClose.style.padding = '2px 10px';
    btnClose.style.fontSize = '0.9em';
    btnClose.textContent = '✕';
    btnClose.onclick = () => {
        backdrop.remove();
        if (onRefreshFn) onRefreshFn();
    };

    header.appendChild(headerLeft);
    header.appendChild(btnClose);
    panel.appendChild(header);

    const content = document.createElement('div');
    content.style.maxHeight = '72vh';
    content.style.overflowY = 'auto';
    content.style.paddingRight = '4px';
    content.style.display = 'flex';
    content.style.gap = '18px';
    content.style.flexWrap = 'wrap';

    const rawData = recordObj.data || metaObj.data || recordObj.imageSrc || recordObj.src || recordObj.base64;
    const rawUrl = recordObj.url || metaObj.url || recordObj.imageSrc || recordObj.src;
    let imgSrc = '';

    if (rawData && typeof rawData === 'string') {
        if (rawData.startsWith('data:') || rawData.startsWith('http:') || rawData.startsWith('https:') || rawData.startsWith('blob:') || rawData.startsWith('file:')) {
            imgSrc = rawData;
        } else {
            imgSrc = `data:${recordObj.mime || 'image/png'};base64,${rawData}`;
        }
    } else if (rawUrl && typeof rawUrl === 'string') {
        imgSrc = rawUrl;
    }

    const leftCol = document.createElement('div');
    leftCol.style.flex = '0 0 340px';
    leftCol.style.maxWidth = '100%';
    leftCol.style.display = 'flex';
    leftCol.style.flexDirection = 'column';
    leftCol.style.gap = '12px';

    if (imgSrc) {
        const previewContainer = document.createElement('div');
        previewContainer.style.display = 'flex';
        previewContainer.style.flexDirection = 'column';
        previewContainer.style.alignItems = 'center';
        previewContainer.style.justifyContent = 'center';
        previewContainer.style.padding = '10px';
        previewContainer.style.borderRadius = '12px';
        previewContainer.style.background = 'var(--da-bg-card, rgba(0, 0, 0, 0.25))';
        previewContainer.style.border = '1px solid var(--da-border-color)';
        previewContainer.style.cursor = 'pointer';
        previewContainer.style.position = 'relative';
        previewContainer.style.overflow = 'hidden';
        previewContainer.title = '点击调起全屏大图查看器';

        const previewImg = document.createElement('img');
        previewImg.src = imgSrc;
        previewImg.style.maxHeight = '380px';
        previewImg.style.maxWidth = '100%';
        previewImg.style.objectFit = 'contain';
        previewImg.style.borderRadius = '8px';
        previewImg.style.transition = 'transform 0.2s ease';

        const zoomBadge = document.createElement('div');
        zoomBadge.style.position = 'absolute';
        zoomBadge.style.bottom = '14px';
        zoomBadge.style.right = '14px';
        zoomBadge.style.padding = '4px 10px';
        zoomBadge.style.borderRadius = '6px';
        zoomBadge.style.background = 'rgba(0, 0, 0, 0.7)';
        zoomBadge.style.color = '#ffffff';
        zoomBadge.style.fontSize = '0.78em';
        zoomBadge.style.backdropFilter = 'blur(4px)';
        zoomBadge.style.pointerEvents = 'none';
        zoomBadge.textContent = '🔍 点击放大';

        previewContainer.appendChild(previewImg);
        previewContainer.appendChild(zoomBadge);

        previewContainer.addEventListener('mouseenter', () => {
            previewImg.style.transform = 'scale(1.02)';
        });
        previewContainer.addEventListener('mouseleave', () => {
            previewImg.style.transform = 'scale(1)';
        });
        previewContainer.addEventListener('click', () => {
            openLightboxModal(imgSrc);
        });

        leftCol.appendChild(previewContainer);
    } else {
        const noImgCard = document.createElement('div');
        noImgCard.style.padding = '40px 20px';
        noImgCard.style.borderRadius = '12px';
        noImgCard.style.background = 'var(--da-bg-card, rgba(0, 0, 0, 0.2))';
        noImgCard.style.border = '1px dashed var(--da-border-color)';
        noImgCard.style.textAlign = 'center';
        noImgCard.style.color = 'var(--da-text-secondary)';
        noImgCard.style.fontSize = '0.9em';
        noImgCard.innerHTML = `🖼️ 暂无图像文件预览<br><span style="font-size:0.8em;opacity:0.7">（图像数据已清理或未缓存）</span>`;
        leftCol.appendChild(noImgCard);
    }

    const leftActionsCard = document.createElement('div');
    leftActionsCard.style.padding = '10px 12px';
    leftActionsCard.style.borderRadius = '10px';
    leftActionsCard.style.background = 'var(--da-bg-card, rgba(0, 0, 0, 0.15))';
    leftActionsCard.style.border = '1px solid var(--da-border-color)';
    leftActionsCard.style.display = 'flex';
    leftActionsCard.style.justifyContent = 'space-around';
    leftActionsCard.style.gap = '8px';

    if (imgSrc || recordObj.data) {
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'da-btn secondary';
        downloadBtn.style.flex = '1';
        downloadBtn.style.padding = '6px 10px';
        downloadBtn.style.fontSize = '0.82em';
        downloadBtn.textContent = '💾 下载图像';
        downloadBtn.addEventListener('click', () => {
            const a = document.createElement('a');
            const dataUrl = imgSrc || (recordObj.data.startsWith('data:')
                ? recordObj.data
                : `data:${recordObj.mime || 'image/png'};base64,${recordObj.data}`);
            a.href = dataUrl;
            a.download = `image-${imageId}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
        leftActionsCard.appendChild(downloadBtn);
    }

    const uuidForDelete = recordObj.uuid || targetUuid;
    if (onDeleteFn && uuidForDelete) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'da-btn danger';
        deleteBtn.style.flex = '1';
        deleteBtn.style.padding = '6px 10px';
        deleteBtn.style.fontSize = '0.82em';
        deleteBtn.textContent = '🗑️ 删除记录';
        deleteBtn.addEventListener('click', async () => {
            const confirmed = await showConfirmDialog({
                title: '删除图像确认',
                message: `确定要物理删除图像 #${imageId} 吗？此操作不可撤销。`,
                isDangerous: true,
            });
            if (confirmed) {
                onDeleteFn!(uuidForDelete);
                backdrop.remove();
                if (onRefreshFn) onRefreshFn();
                showToastNotice(`图像 #${imageId} 已从数据库成功删除`, '删除成功', true);
            }
        });
        leftActionsCard.appendChild(deleteBtn);
    }

    if (leftActionsCard.children.length > 0) {
        leftCol.appendChild(leftActionsCard);
    }

    content.appendChild(leftCol);

    const rightCol = document.createElement('div');
    rightCol.style.flex = '1';
    rightCol.style.minWidth = '300px';
    rightCol.style.display = 'flex';
    rightCol.style.flexDirection = 'column';
    rightCol.style.gap = '14px';

    const promptVal = metaObj.fullPositivePrompt || recordObj.prompt || metaObj.prompt;
    const negVal = metaObj.fullNegativePrompt || metaObj.negativePrompt || recordObj.negativePrompt;

    if (promptVal || negVal) {
        const promptSec = document.createElement('div');
        promptSec.style.display = 'flex';
        promptSec.style.flexDirection = 'column';
        promptSec.style.gap = '10px';

        if (promptVal) {
            const posBox = document.createElement('div');
            posBox.style.display = 'flex';
            posBox.style.flexDirection = 'column';
            posBox.style.gap = '4px';

            const posHeader = document.createElement('div');
            posHeader.style.display = 'flex';
            posHeader.style.justifyContent = 'space-between';
            posHeader.style.alignItems = 'center';

            const posTitle = document.createElement('span');
            posTitle.style.fontSize = '0.85em';
            posTitle.style.fontWeight = '600';
            posTitle.style.color = 'var(--da-text-secondary)';
            posTitle.textContent = '🔤 正向提示词 (Prompt)';

            const copyPosBtn = document.createElement('button');
            copyPosBtn.className = 'da-btn secondary';
            copyPosBtn.style.fontSize = '0.78em';
            copyPosBtn.style.padding = '2px 8px';
            copyPosBtn.textContent = '📋 复制正向词';
            copyPosBtn.onclick = () => {
                void navigator.clipboard.writeText(String(promptVal)).then(() => {
                    showToastNotice('正向提示词已成功复制到剪贴板！', '复制成功', true);
                });
            };

            posHeader.appendChild(posTitle);
            posHeader.appendChild(copyPosBtn);
            posBox.appendChild(posHeader);

            const posText = document.createElement('div');
            posText.style.fontSize = '0.86em';
            posText.style.lineHeight = '1.4';
            posText.style.padding = '8px 12px';
            posText.style.borderRadius = '8px';
            posText.style.background = 'var(--da-bg-card, rgba(255, 255, 255, 0.04))';
            posText.style.border = '1px solid var(--da-border-color)';
            posText.style.color = 'var(--da-text-primary)';
            posText.style.userSelect = 'text';
            posText.style.maxHeight = '120px';
            posText.style.overflowY = 'auto';
            posText.style.wordBreak = 'break-word';
            posText.textContent = String(promptVal);
            posBox.appendChild(posText);

            promptSec.appendChild(posBox);
        }

        if (negVal) {
            const negBox = document.createElement('div');
            negBox.style.display = 'flex';
            negBox.style.flexDirection = 'column';
            negBox.style.gap = '4px';

            const negHeader = document.createElement('div');
            negHeader.style.display = 'flex';
            negHeader.style.justifyContent = 'space-between';
            negHeader.style.alignItems = 'center';

            const negTitle = document.createElement('span');
            negTitle.style.fontSize = '0.85em';
            negTitle.style.fontWeight = '600';
            negTitle.style.color = 'var(--da-text-secondary)';
            negTitle.textContent = '🚫 反向提示词 (Negative Prompt)';

            const copyNegBtn = document.createElement('button');
            copyNegBtn.className = 'da-btn secondary';
            copyNegBtn.style.fontSize = '0.78em';
            copyNegBtn.style.padding = '2px 8px';
            copyNegBtn.textContent = '📋 复制反向词';
            copyNegBtn.onclick = () => {
                void navigator.clipboard.writeText(String(negVal)).then(() => {
                    showToastNotice('反向提示词已成功复制到剪贴板！', '复制成功', true);
                });
            };

            negHeader.appendChild(negTitle);
            negHeader.appendChild(copyNegBtn);
            negBox.appendChild(negHeader);

            const negText = document.createElement('div');
            negText.style.fontSize = '0.86em';
            negText.style.lineHeight = '1.4';
            negText.style.padding = '8px 12px';
            negText.style.borderRadius = '8px';
            negText.style.background = 'var(--da-bg-card, rgba(255, 255, 255, 0.04))';
            negText.style.border = '1px solid var(--da-border-color)';
            negText.style.color = 'var(--da-text-primary)';
            negText.style.userSelect = 'text';
            negText.style.maxHeight = '100px';
            negText.style.overflowY = 'auto';
            negText.style.wordBreak = 'break-word';
            negText.textContent = String(negVal);
            negBox.appendChild(negText);

            promptSec.appendChild(negBox);
        }

        rightCol.appendChild(promptSec);
    }

    const modelVal = metaObj.ckptName || metaObj.model || recordObj.ckptName || recordObj.model;
    const clipVal = metaObj.clipName;
    const vaeVal = metaObj.vaeName;
    const seedVal = metaObj.seed ?? recordObj.seed;
    const samplerVal = metaObj.samplerName ?? recordObj.samplerName;
    const schedulerVal = metaObj.scheduler;
    const stepsVal = metaObj.steps ?? recordObj.steps;
    const cfgVal = metaObj.cfgScale ?? recordObj.cfgScale;
    const widthVal = metaObj.width ?? recordObj.width;
    const heightVal = metaObj.height ?? recordObj.height;
    const denoiseVal = metaObj.denoise ?? recordObj.denoise;

    const paramItems: Array<{ label: string; value: string; fullWidth?: boolean }> = [];

    if (modelVal) paramItems.push({ label: '📦 绘图模型', value: String(modelVal), fullWidth: true });
    if (clipVal) paramItems.push({ label: '🔤 CLIP 编码器', value: String(clipVal) });
    if (vaeVal) paramItems.push({ label: '🎨 VAE 解码器', value: String(vaeVal) });
    if (seedVal !== undefined && seedVal !== null) paramItems.push({ label: '🎲 随机种子', value: String(seedVal) });
    if (samplerVal) paramItems.push({ label: '⚙️ 采样/调度算法', value: `${samplerVal}${schedulerVal ? ` (${schedulerVal})` : ''}` });
    if (stepsVal !== undefined && stepsVal !== null) paramItems.push({ label: '🔢 迭代步数', value: `${stepsVal} 步` });
    if (cfgVal !== undefined && cfgVal !== null) paramItems.push({ label: '🎚️ CFG Scale', value: String(cfgVal) });
    if (widthVal && heightVal) paramItems.push({ label: '📐 图像尺寸', value: `${widthVal} x ${heightVal} px` });
    if (denoiseVal !== undefined && denoiseVal !== null) paramItems.push({ label: '🎨 重噪比 (Denoise)', value: String(denoiseVal) });

    if (paramItems.length > 0) {
        const paramSec = document.createElement('div');
        paramSec.style.display = 'flex';
        paramSec.style.flexDirection = 'column';
        paramSec.style.gap = '6px';

        const paramTitle = document.createElement('span');
        paramTitle.style.fontSize = '0.85em';
        paramTitle.style.fontWeight = '600';
        paramTitle.style.color = 'var(--da-text-secondary)';
        paramTitle.textContent = '⚙️ 生图核心参数';
        paramSec.appendChild(paramTitle);

        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        grid.style.gap = '8px';

        paramItems.forEach(item => {
            const badgeItem = document.createElement('div');
            if (item.fullWidth) badgeItem.style.gridColumn = '1 / -1';
            badgeItem.style.padding = '6px 10px';
            badgeItem.style.borderRadius = '8px';
            badgeItem.style.background = 'var(--da-bg-card, rgba(255, 255, 255, 0.03))';
            badgeItem.style.border = '1px solid var(--da-border-color)';
            badgeItem.style.display = 'flex';
            badgeItem.style.flexDirection = 'column';
            badgeItem.style.gap = '2px';

            const itemLbl = document.createElement('span');
            itemLbl.style.fontSize = '0.74em';
            itemLbl.style.color = 'var(--da-text-secondary)';
            itemLbl.textContent = item.label;

            const itemVal = document.createElement('span');
            itemVal.style.fontSize = '0.84em';
            itemVal.style.fontWeight = '600';
            itemVal.style.color = 'var(--da-text-primary)';
            itemVal.style.userSelect = 'text';
            itemVal.style.wordBreak = 'break-word';
            itemVal.textContent = item.value;

            badgeItem.appendChild(itemLbl);
            badgeItem.appendChild(itemVal);
            grid.appendChild(badgeItem);
        });

        paramSec.appendChild(grid);
        rightCol.appendChild(paramSec);
    }

    const uuidVal = recordObj.uuid || (typeof imageIdOrMeta === 'string' ? imageIdOrMeta : undefined);
    const dateVal = recordObj.timestamp ? new Date(recordObj.timestamp).toLocaleString() : undefined;
    const providerVal = metaObj.provider || recordObj.provider;
    const durationVal = metaObj.durationMs ? `${(metaObj.durationMs / 1000).toFixed(2)} 秒` : undefined;

    let sizeStr: string | undefined;
    if (recordObj.data) {
        const base64Len = typeof recordObj.data === 'string' ? recordObj.data.length : 0;
        const approxBytes = Math.round(base64Len * 0.75);
        sizeStr = `${recordObj.mime || 'image/png'} (~${formatBytes(approxBytes)})`;
    }

    const sysItems: Array<{ label: string; value: string; fullWidth?: boolean }> = [];
    if (providerVal) sysItems.push({ label: '⚡ 生图引擎', value: String(providerVal) });
    if (dateVal) sysItems.push({ label: '🕒 生成时间', value: String(dateVal) });
    if (sizeStr) sysItems.push({ label: '💾 存储与体积', value: String(sizeStr) });
    if (durationVal) sysItems.push({ label: '⏱️ 生成耗时', value: String(durationVal) });
    if (uuidVal) sysItems.push({ label: '🆔 图像 UUID', value: String(uuidVal), fullWidth: true });

    if (sysItems.length > 0) {
        const sysSec = document.createElement('div');
        sysSec.style.display = 'flex';
        sysSec.style.flexDirection = 'column';
        sysSec.style.gap = '6px';

        const sysTitle = document.createElement('span');
        sysTitle.style.fontSize = '0.85em';
        sysTitle.style.fontWeight = '600';
        sysTitle.style.color = 'var(--da-text-secondary)';
        sysTitle.textContent = '💻 系统与存储数据';
        sysSec.appendChild(sysTitle);

        const sysGrid = document.createElement('div');
        sysGrid.style.display = 'grid';
        sysGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        sysGrid.style.gap = '8px';

        sysItems.forEach(item => {
            const badgeItem = document.createElement('div');
            if (item.fullWidth) badgeItem.style.gridColumn = '1 / -1';
            badgeItem.style.padding = '6px 10px';
            badgeItem.style.borderRadius = '8px';
            badgeItem.style.background = 'var(--da-bg-card, rgba(255, 255, 255, 0.03))';
            badgeItem.style.border = '1px solid var(--da-border-color)';
            badgeItem.style.display = 'flex';
            badgeItem.style.flexDirection = 'column';
            badgeItem.style.gap = '2px';

            const itemLbl = document.createElement('span');
            itemLbl.style.fontSize = '0.74em';
            itemLbl.style.color = 'var(--da-text-secondary)';
            itemLbl.textContent = item.label;

            const itemVal = document.createElement('span');
            itemVal.style.fontSize = '0.82em';
            itemVal.style.color = 'var(--da-text-primary)';
            itemVal.style.userSelect = 'text';
            itemVal.style.wordBreak = 'break-word';
            itemVal.style.fontFamily = item.label.includes('UUID') ? 'var(--monoFontFamily, monospace)' : 'inherit';
            itemVal.textContent = item.value;

            badgeItem.appendChild(itemLbl);
            badgeItem.appendChild(itemVal);
            sysGrid.appendChild(badgeItem);
        });

        sysSec.appendChild(sysGrid);
        rightCol.appendChild(sysSec);
    }

    content.appendChild(rightCol);
    panel.appendChild(content);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
}

// ============================================================================
// BLOCK 4: 悬浮球自定义图标裁剪弹窗
// ============================================================================

export interface ImageCropperOptions {
    imageSrc: string;
    aspectRatio?: number;
    onCrop?: (croppedBase64: string) => void;
    onConfirm?: (croppedBase64: string) => void;
    onCancel?: () => void;
}

/**
 * 弹出图像裁剪与图标预览模态框
 *
 * @param options 包含图片 Base64 / URL、目标比例和裁剪回调的配置项
 */
export function openImageCropperModal(options: ImageCropperOptions): void {
    const { imageSrc, onCrop, onConfirm, onCancel } = options;
    const cropCallback = onConfirm || onCrop;

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';
    backdrop.style.zIndex = '100085';
    applyCurrentThemeToNode(backdrop);

    const panel = document.createElement('div');
    panel.className = 'da-settings-panel';
    panel.style.width = '90%';
    panel.style.maxWidth = '460px';
    panel.style.padding = '20px';
    panel.style.borderRadius = '14px';

    const title = document.createElement('h3');
    title.textContent = '裁剪悬浮球图标 (1:1 正方形)';
    title.style.margin = '0 0 16px 0';
    panel.appendChild(title);

    const imgContainer = document.createElement('div');
    imgContainer.style.width = '100%';
    imgContainer.style.maxHeight = '320px';
    imgContainer.style.display = 'flex';
    imgContainer.style.justifyContent = 'center';
    imgContainer.style.overflow = 'hidden';
    imgContainer.style.background = 'var(--da-bg-primary, #000)';
    imgContainer.style.borderRadius = '8px';

    const img = document.createElement('img');
    img.src = imageSrc;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '320px';
    img.style.objectFit = 'contain';
    imgContainer.appendChild(img);
    panel.appendChild(imgContainer);

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.justifyContent = 'flex-end';
    btnGroup.style.gap = '10px';
    btnGroup.style.marginTop = '18px';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'da-btn secondary';
    btnCancel.textContent = '取消';
    btnCancel.onclick = () => {
        backdrop.remove();
        if (onCancel) onCancel();
    };

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'da-btn primary';
    btnConfirm.textContent = '保存图标';
    btnConfirm.onclick = () => {
        try {
            const canvas = document.createElement('canvas');
            const size = 128;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const minSide = Math.min(img.naturalWidth, img.naturalHeight);
                const sx = (img.naturalWidth - minSide) / 2;
                const sy = (img.naturalHeight - minSide) / 2;
                ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
                const croppedData = canvas.toDataURL('image/png');
                if (cropCallback) cropCallback(croppedData);
            }
        } catch (err) {
            logger.error('图像裁剪处理失败', err);
            showToastNotice('图像裁剪失败，请尝试换一张图', '裁剪失败', false);
        }
        backdrop.remove();
    };

    btnGroup.appendChild(btnCancel);
    btnGroup.appendChild(btnConfirm);
    panel.appendChild(btnGroup);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
}
