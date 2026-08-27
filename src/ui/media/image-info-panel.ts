/**
 * @module ui/media/image-info-panel
 * @description 图像详细元数据查看面板 (ImageInfoPanel)
 */

import { ThemeService } from '../foundation/theme-service';
import { FeedbackService, showConfirmDialog } from '../feedback/feedback';
import { openLightboxModal } from './lightbox-modal';
import { IndexedDBStorageAdapter } from '../../core/state/storage-adapter';
import { Logger } from '../../core/diagnostics/logger';

const logger = new Logger('ImageInfoPanel');

import { formatBytes } from '../foundation';

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

export async function openImageInfoPanel(imageIdOrMeta: any, meta?: any): Promise<void> {
    let imageId = 'Preview';
    let recordObj: Record<string, any> = {};
    let metaObj: Record<string, any> = {};
    let targetUuid: string | undefined;

    if (typeof imageIdOrMeta === 'object' && imageIdOrMeta !== null) {
        recordObj = imageIdOrMeta as Record<string, any>;
        metaObj = (recordObj.metadata as Record<string, any>) || recordObj;
        targetUuid = (recordObj.uuid || recordObj.id || recordObj.imageId) as string | undefined;
    } else if (typeof imageIdOrMeta === 'string' && imageIdOrMeta.trim()) {
        targetUuid = imageIdOrMeta.trim();
        metaObj = typeof meta === 'object' && meta !== null ? (meta as Record<string, any>) : {};
        recordObj = metaObj;
    }

    if (targetUuid) {
        imageId = String(targetUuid).slice(0, 8);
    }

    if (targetUuid && (!recordObj.data && !metaObj.data && !recordObj.imageSrc)) {
        try {
            const storage = new IndexedDBStorageAdapter();
            await storage.init();
            const dbRecord = await storage.getImage(targetUuid);
            if (dbRecord) {
                recordObj = dbRecord;
                metaObj = (dbRecord.metadata as any) || dbRecord;
            }
        } catch (err) {
            logger.debug('从 IndexedDB 读取图像元数据失败 (可能已被清理):', err);
        }
    }

    let onRefreshFn: (() => void) | undefined;
    let onDeleteFn: ((uuid: string) => void) | undefined;

    if (typeof meta === 'function') {
        onRefreshFn = meta as () => void;
    } else if (typeof meta === 'object' && meta !== null) {
        const metaObjCast = meta as Record<string, unknown>;
        if (typeof metaObjCast.onRefresh === 'function') onRefreshFn = metaObjCast.onRefresh as () => void;
        if (typeof metaObjCast.onDelete === 'function') onDeleteFn = metaObjCast.onDelete as (uuid: string) => void;
    }

    const createdObjectUrls: string[] = [];
    const closePanel = () => {
        backdrop.remove();
        createdObjectUrls.forEach((url) => {
            try {
                URL.revokeObjectURL(url);
            } catch (err) {
                logger.debug('释放 Object URL 失败:', err);
            }
        });
        if (onRefreshFn) onRefreshFn();
    };

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';
    ThemeService.applyCurrentThemeToNode(backdrop);

    const panel = document.createElement('div');
    panel.className = 'da-info-panel st-da-root';
    ThemeService.applyCurrentThemeToNode(panel);

    // 1. Header
    const header = document.createElement('div');
    header.className = 'da-info-panel__header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'da-info-panel__header-left';

    const title = document.createElement('h3');
    title.className = 'da-info-panel__title';
    title.textContent = '🖼️ 图像元数据详情';

    const badge = document.createElement('span');
    badge.className = 'da-info-panel__badge';
    badge.textContent = `#${imageId}`;

    headerLeft.appendChild(title);
    headerLeft.appendChild(badge);

    const btnClose = document.createElement('button');
    btnClose.className = 'da-btn secondary da-btn-sm';
    btnClose.textContent = '✕';
    btnClose.onclick = () => closePanel();

    header.appendChild(headerLeft);
    header.appendChild(btnClose);
    panel.appendChild(header);

    // 2. Body
    const content = document.createElement('div');
    content.className = 'da-info-panel__body';

    const rawData = recordObj.data || metaObj.data || recordObj.imageSrc || recordObj.src || recordObj.base64;
    const rawUrl = recordObj.url || metaObj.url || recordObj.imageSrc || recordObj.src;
    let imgSrc = '';

    if (rawData instanceof Blob) {
        imgSrc = URL.createObjectURL(rawData);
        createdObjectUrls.push(imgSrc);
    } else if (rawData && typeof rawData === 'string') {
        if (rawData.startsWith('data:') || rawData.startsWith('http:') || rawData.startsWith('https:') || rawData.startsWith('blob:') || rawData.startsWith('file:')) {
            imgSrc = rawData;
        } else {
            imgSrc = `data:${recordObj.mime || 'image/png'};base64,${rawData}`;
        }
    } else if (rawUrl && typeof rawUrl === 'string') {
        imgSrc = rawUrl;
    }

    // 2.1 左栏：预览图与下载删除动作
    const leftCol = document.createElement('div');
    leftCol.className = 'da-info-panel__preview-col';

    if (imgSrc) {
        const previewBox = document.createElement('div');
        previewBox.className = 'da-info-panel__preview-box';
        previewBox.title = '点击调起全屏大图查看器';

        const previewImg = document.createElement('img');
        previewImg.className = 'da-info-panel__preview-img';
        previewImg.src = imgSrc;

        const zoomBadge = document.createElement('div');
        zoomBadge.className = 'da-info-panel__zoom-badge';
        zoomBadge.textContent = '🔍 点击放大';

        previewBox.appendChild(previewImg);
        previewBox.appendChild(zoomBadge);
        previewBox.addEventListener('click', () => openLightboxModal(imgSrc));
        leftCol.appendChild(previewBox);
    } else {
        const noImgCard = document.createElement('div');
        noImgCard.className = 'da-empty-tip';
        noImgCard.innerHTML = `🖼️ 暂无图像文件预览<br><span style="font-size:0.8em;opacity:0.7">（图像数据已清理或未缓存）</span>`;
        leftCol.appendChild(noImgCard);
    }

    const leftActionsCard = document.createElement('div');
    leftActionsCard.className = 'da-info-panel__actions-card';

    if (imgSrc) {
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'da-btn secondary da-btn-sm';
        downloadBtn.textContent = '💾 下载图像';
        downloadBtn.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = imgSrc;
            a.download = `image-${imageId}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            FeedbackService.toastSuccess('已开始下载图像');
        });
        leftActionsCard.appendChild(downloadBtn);
    }

    const uuidForDelete = recordObj.uuid || recordObj.id || targetUuid;
    if (onDeleteFn && uuidForDelete) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'da-btn danger da-btn-sm';
        deleteBtn.textContent = '🗑️ 删除记录';
        deleteBtn.addEventListener('click', async () => {
            const confirmed = await showConfirmDialog({
                title: '删除图像确认',
                message: `确定要物理删除图像 #${imageId} 吗？此操作不可撤销。`,
                isDangerous: true
            });
            if (confirmed) {
                onDeleteFn!(uuidForDelete);
                closePanel();
                FeedbackService.toastSuccess('图像记录已成功删除');
            }
        });
        leftActionsCard.appendChild(deleteBtn);
    }

    if (leftActionsCard.children.length > 0) {
        leftCol.appendChild(leftActionsCard);
    }

    content.appendChild(leftCol);

    // 2.2 右栏：提示词与生成参数详情
    const rightCol = document.createElement('div');
    rightCol.className = 'da-info-panel__details-col';

    const promptVal = metaObj.fullPositivePrompt || recordObj.prompt || metaObj.prompt;
    const negVal = metaObj.fullNegativePrompt || metaObj.negativePrompt || recordObj.negativePrompt;

    if (promptVal || negVal) {
        const promptSec = document.createElement('div');
        promptSec.className = 'da-info-panel__prompt-sec';

        if (promptVal) {
            const posBox = document.createElement('div');
            posBox.className = 'da-info-panel__prompt-box';

            const posHeader = document.createElement('div');
            posHeader.className = 'da-info-panel__prompt-header';

            const posTitle = document.createElement('span');
            posTitle.className = 'da-info-panel__prompt-title';
            posTitle.textContent = '🔤 正向提示词 (Prompt)';

            const copyPosBtn = document.createElement('button');
            copyPosBtn.className = 'da-btn secondary da-btn-sm';
            copyPosBtn.textContent = '📋 复制正向词';
            copyPosBtn.onclick = () => {
                void navigator.clipboard.writeText(String(promptVal)).then(() => {
                    FeedbackService.toastSuccess('已成功复制正向提示词');
                });
            };

            posHeader.appendChild(posTitle);
            posHeader.appendChild(copyPosBtn);
            posBox.appendChild(posHeader);

            const posText = document.createElement('div');
            posText.className = 'da-info-panel__prompt-text';
            posText.textContent = String(promptVal);
            posBox.appendChild(posText);

            promptSec.appendChild(posBox);
        }

        if (negVal) {
            const negBox = document.createElement('div');
            negBox.className = 'da-info-panel__prompt-box';

            const negHeader = document.createElement('div');
            negHeader.className = 'da-info-panel__prompt-header';

            const negTitle = document.createElement('span');
            negTitle.className = 'da-info-panel__prompt-title';
            negTitle.textContent = '🚫 反向提示词 (Negative Prompt)';

            const copyNegBtn = document.createElement('button');
            copyNegBtn.className = 'da-btn secondary da-btn-sm';
            copyNegBtn.textContent = '📋 复制反向词';
            copyNegBtn.onclick = () => {
                void navigator.clipboard.writeText(String(negVal)).then(() => {
                    FeedbackService.toastSuccess('已成功复制反向提示词');
                });
            };

            negHeader.appendChild(negTitle);
            negHeader.appendChild(copyNegBtn);
            negBox.appendChild(negHeader);

            const negText = document.createElement('div');
            negText.className = 'da-info-panel__prompt-text';
            negText.textContent = String(negVal);
            negBox.appendChild(negText);

            promptSec.appendChild(negBox);
        }

        rightCol.appendChild(promptSec);
    }

    // 参数表
    const paramsCard = document.createElement('div');
    paramsCard.className = 'da-info-panel__params-card';

    const addParamRow = (label: string, value: any, copyable = false) => {
        if (value === undefined || value === null || value === '') return;
        const row = document.createElement('div');
        row.className = 'da-info-panel__param-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'da-info-panel__param-label';
        labelEl.textContent = label;

        const valEl = document.createElement('span');
        valEl.className = 'da-info-panel__param-val';
        valEl.textContent = String(value);

        if (copyable) {
            valEl.style.cursor = 'pointer';
            valEl.title = '点击复制数值';
            valEl.onclick = () => {
                void navigator.clipboard.writeText(String(value)).then(() => {
                    FeedbackService.toastSuccess(`已复制 ${label}: ${value}`);
                });
            };
        }

        row.appendChild(labelEl);
        row.appendChild(valEl);
        paramsCard.appendChild(row);
    };

    addParamRow('模型 (Model)', metaObj.model || metaObj.checkpoint || recordObj.model, true);
    addParamRow('采样步数 (Steps)', metaObj.steps || recordObj.steps);
    addParamRow('提示词引导 (CFG Scale)', metaObj.cfgScale || metaObj.cfg || recordObj.cfgScale);
    addParamRow('随机种子 (Seed)', metaObj.seed || recordObj.seed, true);
    addParamRow('采样器 (Sampler)', metaObj.samplerName || metaObj.sampler || recordObj.samplerName);
    addParamRow('调度器 (Scheduler)', metaObj.scheduler || recordObj.scheduler);
    addParamRow('图像尺寸 (Resolution)', metaObj.width && metaObj.height ? `${metaObj.width} × ${metaObj.height}` : undefined);
    addParamRow('生成时间 (Created At)', recordObj.timestamp ? new Date(recordObj.timestamp).toLocaleString() : undefined);

    if (rawData instanceof Blob) {
        addParamRow('物理文件体积', formatBytes(rawData.size));
    }

    rightCol.appendChild(paramsCard);
    content.appendChild(rightCol);
    panel.appendChild(content);

    backdrop.appendChild(panel);
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closePanel();
    });

    document.body.appendChild(backdrop);
}
