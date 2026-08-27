/**
 * @module ui/media/image-info-panel
 * @description 沉浸式图像元数据详情与参数分析抽屉面板 (ImageInfoPanel)
 *
 * 参考 Civitai / SD-WebUI 图像详情设计范式：
 * 1. 左右沉浸式双栏架构 (大屏并列，小屏自适应垂直折叠)；
 * 2. 左栏：大图展示视口 + 技术指标 (尺寸/体积/格式/时间) + 快捷工具箱 (原图下载/标星收藏/复制 JSON/单图删除)；
 * 3. 右栏：正反提示词 (独立字数与一键复制) + LoRA 列表独立解析胶囊 + 多引擎紧凑参数矩阵。
 */

import { ThemeService } from '../foundation/theme-service';
import { FeedbackService, showConfirmDialog } from '../feedback/feedback';
import { openLightboxModal } from './lightbox-modal';
import { Logger, IDisposable } from '../../core';
import { formatBytes } from '../foundation';
import { ModalService } from '../layout/modal-service';

const logger = new Logger('ImageInfoPanel');

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

export interface ImageInfoPanelOptions {
    id?: string;
    uuid?: string;
    prompt?: string;
    negativePrompt?: string;
    metadata?: Record<string, any>;
    data?: Blob | string;
    imageSrc?: string;
    timestamp?: number;
    isFavorite?: boolean;
    storage?: any;
    onFavoriteChange?: (isFav: boolean) => void;
    onDelete?: (uuid: string) => void;
    onRefresh?: () => void;
    [key: string]: unknown;
}

/**
 * 从提示词文本中提取 LoRA 列表 (兼容 <lora:...> 与 <wlr:...>)
 */
function extractLorasFromPrompt(promptText: string): Array<{ name: string; weight: number }> {
    if (!promptText) return [];
    const results: Array<{ name: string; weight: number }> = [];
    const loraRegex = /<(?:lora|wlr):([^:>]+)(?::([^>]+))?>/gi;
    let match: RegExpExecArray | null;
    while ((match = loraRegex.exec(promptText)) !== null) {
        const name = match[1]?.trim() || '';
        const weight = match[2] !== undefined ? parseFloat(match[2]) || 1.0 : 1.0;
        if (name) {
            results.push({ name, weight });
        }
    }
    return results;
}

/**
 * 调起沉浸式图像元数据详情弹窗
 */
export function openImageInfoPanel(imageIdOrOptions: any, meta?: any): IDisposable {
    let imageId = 'Preview';
    let recordObj: Record<string, any> = {};
    let metaObj: Record<string, any> = {};
    let targetUuid: string | undefined;
    let inputStorage = typeof imageIdOrOptions === 'object' && imageIdOrOptions !== null ? imageIdOrOptions.storage : undefined;

    if (typeof imageIdOrOptions === 'object' && imageIdOrOptions !== null) {
        recordObj = imageIdOrOptions as Record<string, any>;
        metaObj = (recordObj.metadata as Record<string, any>) || recordObj;
        targetUuid = (recordObj.uuid || recordObj.id || recordObj.imageId) as string | undefined;
    } else if (typeof imageIdOrOptions === 'string' && imageIdOrOptions.trim()) {
        targetUuid = imageIdOrOptions.trim();
        metaObj = typeof meta === 'object' && meta !== null ? (meta as Record<string, any>) : {};
        recordObj = metaObj;
        if (typeof meta === 'object' && meta !== null && meta.storage) {
            inputStorage = meta.storage;
        }
    }

    if (targetUuid) {
        imageId = String(targetUuid).slice(0, 8);
    }

    let onRefreshFn: (() => void) | undefined;
    let onDeleteFn: ((uuid: string) => void) | undefined;
    let onFavoriteChangeFn: ((isFav: boolean) => void) | undefined;

    if (typeof meta === 'function') {
        onRefreshFn = meta as () => void;
    } else if (typeof meta === 'object' && meta !== null) {
        const metaObjCast = meta as Record<string, unknown>;
        if (typeof metaObjCast.onRefresh === 'function') onRefreshFn = metaObjCast.onRefresh as () => void;
        if (typeof metaObjCast.onDelete === 'function') onDeleteFn = metaObjCast.onDelete as (uuid: string) => void;
        if (typeof metaObjCast.onFavoriteChange === 'function') onFavoriteChangeFn = metaObjCast.onFavoriteChange as (isFav: boolean) => void;
    }

    if (typeof recordObj.onDelete === 'function') onDeleteFn = recordObj.onDelete;
    if (typeof recordObj.onFavoriteChange === 'function') onFavoriteChangeFn = recordObj.onFavoriteChange;

    const createdObjectUrls: string[] = [];
    let isCleanedUp = false;

    const cleanupUrls = () => {
        if (isCleanedUp) return;
        isCleanedUp = true;
        createdObjectUrls.forEach((url) => {
            try {
                URL.revokeObjectURL(url);
            } catch (err) {
                logger.debug('释放 Object URL 失败:', err);
            }
        });
        if (onRefreshFn) onRefreshFn();
    };
    const targetStorage = inputStorage;

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';
    ThemeService.applyCurrentThemeToNode(backdrop);

    const modalHandle = ModalService.getInstance().open(backdrop, {
        closeOnBackdrop: true,
        closeOnEscape: true,
        onClose: cleanupUrls
    });

    const closePanel = () => {
        cleanupUrls();
        modalHandle.dispose();
    };

    const panel = document.createElement('div');
    panel.className = 'da-info-panel da-inspect-modal st-da-root';
    ThemeService.applyCurrentThemeToNode(panel);
    backdrop.appendChild(panel);

    // 1. Header (标题与标识)
    const header = document.createElement('div');
    header.className = 'da-inspect-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'da-inspect-header__left';

    const title = document.createElement('h3');
    title.className = 'da-inspect-title';
    title.textContent = '图像元数据与生成参数';

    const badge = document.createElement('span');
    badge.className = 'da-inspect-badge';
    badge.textContent = `#${imageId}`;

    headerLeft.appendChild(title);
    headerLeft.appendChild(badge);

    const btnClose = document.createElement('button');
    btnClose.className = 'da-btn da-btn--secondary da-btn--sm';
    btnClose.textContent = '✕';
    btnClose.onclick = () => closePanel();

    header.appendChild(headerLeft);
    header.appendChild(btnClose);
    panel.appendChild(header);

    // 2. Body (沉浸式双栏)
    const content = document.createElement('div');
    content.className = 'da-inspect-body';

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

    // 2.1 左栏：大图展示视口 + 技术指标 + 快捷工具箱
    const leftCol = document.createElement('div');
    leftCol.className = 'da-inspect-col-visual';

    const previewBox = document.createElement('div');
    previewBox.className = 'da-inspect-preview-box';
    previewBox.title = '点击调起全屏大图查看器';

    const previewImg = document.createElement('img');
    previewImg.className = 'da-inspect-preview-img';

    if (imgSrc) {
        previewImg.src = imgSrc;
        const zoomBadge = document.createElement('div');
        zoomBadge.className = 'da-inspect-zoom-badge';
        zoomBadge.textContent = '点击放大';
        previewBox.appendChild(previewImg);
        previewBox.appendChild(zoomBadge);
        previewBox.addEventListener('click', () => openLightboxModal(imgSrc));
        leftCol.appendChild(previewBox);
    } else {
        const noImgCard = document.createElement('div');
        noImgCard.className = 'da-empty-tip';
        noImgCard.innerHTML = `暂无图像文件预览<br><span style="font-size:0.8em;opacity:0.7">（图像数据已清理或未缓存）</span>`;
        leftCol.appendChild(noImgCard);
    }

    // 快捷工具箱 (原图下载 / 标星 / 复制 JSON / 删除)
    const leftActionsCard = document.createElement('div');
    leftActionsCard.className = 'da-inspect-actions-card';

    if (imgSrc) {
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        downloadBtn.textContent = '原图下载';
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

    // 标星收藏切换按钮
    let currentFavoriteState = Boolean(recordObj.isFavorite);
    if (targetUuid && targetStorage) {
        const favBtn = document.createElement('button');
        favBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        favBtn.textContent = currentFavoriteState ? '⭐ 已收藏' : '☆ 标星收藏';
        favBtn.addEventListener('click', async () => {
            const newFav = await targetStorage.toggleFavorite(targetUuid!);
            currentFavoriteState = newFav;
            favBtn.textContent = newFav ? '⭐ 已收藏' : '☆ 标星收藏';
            onFavoriteChangeFn?.(newFav);
            FeedbackService.toastSuccess(newFav ? '已加入标星收藏' : '已取消标星收藏');
        });
        leftActionsCard.appendChild(favBtn);
    }

    // 复制完整元数据 JSON
    const copyJsonBtn = document.createElement('button');
    copyJsonBtn.className = 'da-btn da-btn--secondary da-btn--sm';
    copyJsonBtn.textContent = '复制参数 JSON';
    copyJsonBtn.addEventListener('click', () => {
        const jsonStr = JSON.stringify({ prompt: recordObj.prompt || metaObj.prompt, metadata: metaObj }, null, 2);
        void navigator.clipboard.writeText(jsonStr).then(() => {
            FeedbackService.toastSuccess('已成功复制完整参数 JSON');
        });
    });
    leftActionsCard.appendChild(copyJsonBtn);

    const uuidForDelete = recordObj.uuid || recordObj.id || targetUuid;
    if (onDeleteFn && uuidForDelete) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'da-btn da-btn--danger da-btn--sm';
        deleteBtn.textContent = '删除记录';
        deleteBtn.addEventListener('click', async () => {
            const confirmed = await showConfirmDialog({
                title: '删除图像确认',
                message: `确定要删除图像 #${imageId} 吗？此操作不可恢复。`,
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

    // 2.2 右栏：提示词、LoRA 列表与结构化参数矩阵
    const rightCol = document.createElement('div');
    rightCol.className = 'da-inspect-col-meta';

    const promptVal = metaObj.fullPositivePrompt || recordObj.prompt || metaObj.prompt;
    const negVal = metaObj.fullNegativePrompt || metaObj.negativePrompt || recordObj.negativePrompt || metaObj.uc;

    if (promptVal || negVal) {
        const promptSec = document.createElement('div');
        promptSec.className = 'da-inspect-prompt-sec';

        // 正向提示词
        if (promptVal) {
            const posBox = document.createElement('div');
            posBox.className = 'da-inspect-prompt-box';

            const posHeader = document.createElement('div');
            posHeader.className = 'da-inspect-prompt-header';

            const posTitle = document.createElement('span');
            posTitle.className = 'da-inspect-prompt-title';
            posTitle.textContent = '正向提示词 (Prompt)';

            const copyPosBtn = document.createElement('button');
            copyPosBtn.className = 'da-btn da-btn--secondary da-btn--sm';
            copyPosBtn.textContent = '复制正向词';
            copyPosBtn.onclick = () => {
                void navigator.clipboard.writeText(String(promptVal)).then(() => {
                    FeedbackService.toastSuccess('已成功复制正向提示词');
                });
            };

            posHeader.appendChild(posTitle);
            posHeader.appendChild(copyPosBtn);
            posBox.appendChild(posHeader);

            const posText = document.createElement('div');
            posText.className = 'da-inspect-prompt-text';
            posText.textContent = String(promptVal);
            posBox.appendChild(posText);

            promptSec.appendChild(posBox);
        }

        // 反向提示词
        if (negVal) {
            const negBox = document.createElement('div');
            negBox.className = 'da-inspect-prompt-box is-negative';

            const negHeader = document.createElement('div');
            negHeader.className = 'da-inspect-prompt-header';

            const negTitle = document.createElement('span');
            negTitle.className = 'da-inspect-prompt-title';
            negTitle.textContent = '反向提示词 (Negative Prompt)';

            const copyNegBtn = document.createElement('button');
            copyNegBtn.className = 'da-btn da-btn--secondary da-btn--sm';
            copyNegBtn.textContent = '复制反向词';
            copyNegBtn.onclick = () => {
                void navigator.clipboard.writeText(String(negVal)).then(() => {
                    FeedbackService.toastSuccess('已成功复制反向提示词');
                });
            };

            negHeader.appendChild(negTitle);
            negHeader.appendChild(copyNegBtn);
            negBox.appendChild(negHeader);

            const negText = document.createElement('div');
            negText.className = 'da-inspect-prompt-text';
            negText.textContent = String(negVal);
            negBox.appendChild(negText);

            promptSec.appendChild(negBox);
        }

        rightCol.appendChild(promptSec);
    }

    // 解析 LoRA 列表胶囊
    const loras = extractLorasFromPrompt(String(promptVal || ''));
    if (loras.length > 0) {
        const loraBox = document.createElement('div');
        loraBox.className = 'da-inspect-lora-box';

        const loraTitle = document.createElement('div');
        loraTitle.className = 'da-inspect-meta-subhead';
        loraTitle.textContent = `LoRA 模型 (${loras.length})`;
        loraBox.appendChild(loraTitle);

        const loraChips = document.createElement('div');
        loraChips.className = 'da-inspect-lora-chips';

        loras.forEach((lora) => {
            const chip = document.createElement('span');
            chip.className = 'da-inspect-lora-chip';
            chip.innerHTML = `<strong>${lora.name}</strong> <span class="da-chip-val">${lora.weight}</span>`;
            chip.title = '点击复制 LoRA 标签';
            chip.onclick = () => {
                void navigator.clipboard.writeText(`<lora:${lora.name}:${lora.weight}>`).then(() => {
                    FeedbackService.toastSuccess(`已复制 LoRA: ${lora.name}`);
                });
            };
            loraChips.appendChild(chip);
        });

        loraBox.appendChild(loraChips);
        rightCol.appendChild(loraBox);
    }

    // 结构化生成参数矩阵
    const paramsCard = document.createElement('div');
    paramsCard.className = 'da-inspect-params-matrix';

    const addParamRow = (label: string, value: any, copyable = false) => {
        if (value === undefined || value === null || value === '') return;
        const row = document.createElement('div');
        row.className = 'da-inspect-param-cell';

        const labelEl = document.createElement('span');
        labelEl.className = 'da-inspect-param-label';
        labelEl.textContent = label;

        const valEl = document.createElement('span');
        valEl.className = `da-inspect-param-val ${copyable ? 'is-copyable' : ''}`;
        valEl.textContent = String(value);

        if (copyable) {
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

    // 引擎驱动
    const driverName = metaObj.driver || recordObj.driver || metaObj.engine || (metaObj.ckptName ? 'ComfyUI' : undefined);
    addParamRow('生图引擎 (Driver)', driverName);

    // 主模型
    const modelVal = metaObj.ckptName || metaObj.model || metaObj.checkpoint || recordObj.model;
    addParamRow('主模型 (Model)', modelVal, true);

    // 采样算法 & 调度器
    const samplerVal = metaObj.samplerName || metaObj.sampler || metaObj.sampler_name || recordObj.samplerName;
    addParamRow('采样算法 (Sampler)', samplerVal);

    const schedulerVal = metaObj.scheduler || metaObj.schedulerName || metaObj.noise_schedule || recordObj.scheduler;
    addParamRow('时间步调度 (Scheduler)', schedulerVal);

    // 步数、CFG、Seed
    addParamRow('采样步数 (Steps)', metaObj.steps || recordObj.steps);
    addParamRow('引导系数 (CFG Scale)', metaObj.cfgScale || metaObj.cfg || metaObj.scale || recordObj.cfgScale);
    addParamRow('随机种子 (Seed)', metaObj.seed || recordObj.seed, true);

    // 去噪幅度 (图生图)
    addParamRow('去噪幅度 (Denoise)', metaObj.denoise || metaObj.denoising_strength);

    // 尺寸与时间
    const resVal = metaObj.width && metaObj.height ? `${metaObj.width} × ${metaObj.height}` : metaObj.size;
    addParamRow('图像尺寸 (Resolution)', resVal);
    addParamRow('生成时间 (Created At)', recordObj.timestamp ? new Date(recordObj.timestamp).toLocaleString() : undefined);

    if (rawData instanceof Blob) {
        addParamRow('文件大小 (File Size)', formatBytes(rawData.size));
    }

    rightCol.appendChild(paramsCard);
    content.appendChild(rightCol);
    panel.appendChild(content);

    // 异步加载原图（当只有 UUID 时）
    if (targetUuid && !imgSrc && targetStorage) {
        targetStorage.getImage(targetUuid).then((dbRecord: any) => {
            if (dbRecord && dbRecord.data && !isCleanedUp) {
                let dynamicSrc = '';
                if (dbRecord.data instanceof Blob) {
                    dynamicSrc = URL.createObjectURL(dbRecord.data);
                    createdObjectUrls.push(dynamicSrc);
                } else if (typeof dbRecord.data === 'string') {
                    dynamicSrc = dbRecord.data.startsWith('data:') ? dbRecord.data : `data:image/png;base64,${dbRecord.data}`;
                }
                if (dynamicSrc) {
                    leftCol.innerHTML = '';
                    const dynBox = document.createElement('div');
                    dynBox.className = 'da-inspect-preview-box';
                    const dynImg = document.createElement('img');
                    dynImg.className = 'da-inspect-preview-img';
                    dynImg.src = dynamicSrc;
                    const zoomBadge = document.createElement('div');
                    zoomBadge.className = 'da-inspect-zoom-badge';
                    zoomBadge.textContent = '🔍 点击放大';
                    dynBox.appendChild(dynImg);
                    dynBox.appendChild(zoomBadge);
                    dynBox.addEventListener('click', () => openLightboxModal(dynamicSrc));
                    leftCol.appendChild(dynBox);
                    leftCol.appendChild(leftActionsCard);
                }
            }
        }).catch((err: any) => {
            logger.debug('异步读取图像记录失败:', err);
        });
    }

    return modalHandle;
}
