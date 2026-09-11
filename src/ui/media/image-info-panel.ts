/**
 * 图像元数据与参数详情面板 (ImageInfoPanel)
 * 展示图像详情：左栏呈现提示词、LoRA 列表与后端生成参数；
 * 右栏提供大图预览（支持调起全屏查看器）、技术指标与操作工具（下载、标星、复制参数与删除）。
 */

import { ThemeService } from '../foundation/theme-service';
import { FeedbackService, showConfirmDialog } from '../feedback/feedback';
import { openImagePreviewModal } from './image-preview-modal';
import { IDisposable } from '../../types';
import { Logger } from '../../utils';
import { formatBytes } from '../foundation/utils';
import { ModalService } from '../layout/modal-service';

const logger = new Logger('ImageInfoPanel');

// 内联标准 Feather SVG 图标字典 (淘汰字体图标)
const SVG_ICONS = {
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    zoom: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>',
    download: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    starLine: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
    starFill: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
    copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    code: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
    image: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'
};

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
export function extractLorasFromPrompt(promptText: string): Array<{ name: string; weight: number }> {
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
 * 识别生图引擎类型
 */
export function detectEngineType(meta: Record<string, any>, record: Record<string, any>): 'sdwebui' | 'comfyui' | 'novelai' | 'openai' | 'generic' {
    const rawDriver = String(meta.driver || record.driver || meta.engine || record.engine || '').toLowerCase();
    if (rawDriver.includes('openai') || rawDriver.includes('cloud') || rawDriver.includes('dall') || rawDriver.includes('gemini') || rawDriver.includes('grok')) return 'openai';
    if (rawDriver.includes('comfy')) return 'comfyui';
    if (rawDriver.includes('sd') || rawDriver.includes('webui') || rawDriver.includes('forge') || rawDriver.includes('a1111')) return 'sdwebui';
    if (rawDriver.includes('novel') || rawDriver === 'nai' || rawDriver.startsWith('nai-')) return 'novelai';

    if (meta.workflow || meta.workflowProfile || meta.promptId) return 'comfyui';
    if (meta.sdModelCheckpoint || meta.enableHires || meta.clipSkip !== undefined) return 'sdwebui';
    if (meta.smea !== undefined || meta.uncondScale !== undefined || meta.decrisper !== undefined) return 'novelai';
    if (meta.quality || meta.style) return 'openai';

    return 'generic';
}

/**
 * 显示图像元数据与生成参数面板
 */
export function openImageInfoPanel(imageIdOrOptions: any, meta?: any): IDisposable {
    if (typeof document === 'undefined') return { dispose: () => {} };

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
    panel.className = 'da-inspect-modal st-da-root';
    ThemeService.applyCurrentThemeToNode(panel);
    backdrop.appendChild(panel);

    // 顶栏：标题、标识与关闭按钮
    const header = document.createElement('div');
    header.className = 'da-inspect-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'da-inspect-header__left';

    const title = document.createElement('h3');
    title.className = 'da-inspect-title';
    title.innerHTML = `${SVG_ICONS.image} 图像元数据与生成参数`;

    const badge = document.createElement('span');
    badge.className = 'da-inspect-badge';
    badge.textContent = `#${imageId}`;

    headerLeft.appendChild(title);
    headerLeft.appendChild(badge);

    const btnClose = document.createElement('button');
    btnClose.className = 'da-btn da-btn--secondary da-btn--sm';
    btnClose.innerHTML = SVG_ICONS.close;
    btnClose.title = '关闭 (Esc)';
    btnClose.onclick = () => closePanel();

    header.appendChild(headerLeft);
    header.appendChild(btnClose);
    panel.appendChild(header);

    // 双栏主体容器
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

    const promptVal = metaObj.fullPositivePrompt || metaObj.prompt || recordObj.prompt;
    const negVal = metaObj.fullNegativePrompt || metaObj.negativePrompt || recordObj.negativePrompt || metaObj.uc;

    // 左栏：提示词、LoRA 列表与生成参数
    const leftCol = document.createElement('div');
    leftCol.className = 'da-inspect-col-meta';

    // 终态正向提示词卡片
    if (promptVal) {
        const posBox = document.createElement('div');
        posBox.className = 'da-inspect-prompt-box';

        const posHeader = document.createElement('div');
        posHeader.className = 'da-inspect-prompt-header';

        const posTitle = document.createElement('span');
        posTitle.className = 'da-inspect-prompt-title';
        const strVal = String(promptVal);
        const tokenEstimate = strVal.split(/[,，\s]+/).filter(Boolean).length;
        posTitle.innerHTML = `终态正向提示词 (Final Prompt) <span class="da-inspect-token-count">约 ${tokenEstimate} 词元 / ${strVal.length} 字符</span>`;

        const copyPosBtn = document.createElement('button');
        copyPosBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        copyPosBtn.innerHTML = `${SVG_ICONS.copy} 复制`;
        copyPosBtn.onclick = () => {
            void navigator.clipboard.writeText(strVal).then(() => {
                FeedbackService.toastSuccess('已复制正向提示词');
            });
        };

        posHeader.appendChild(posTitle);
        posHeader.appendChild(copyPosBtn);
        posBox.appendChild(posHeader);

        const posText = document.createElement('div');
        posText.className = 'da-inspect-prompt-text';
        posText.textContent = strVal;
        posBox.appendChild(posText);

        leftCol.appendChild(posBox);
    }

    // 终态反向提示词卡片
    if (negVal) {
        const negBox = document.createElement('div');
        negBox.className = 'da-inspect-prompt-box is-negative';

        const negHeader = document.createElement('div');
        negHeader.className = 'da-inspect-prompt-header';

        const negTitle = document.createElement('span');
        negTitle.className = 'da-inspect-prompt-title';
        const strNeg = String(negVal);
        negTitle.innerHTML = `终态反向提示词 (Final Negative) <span class="da-inspect-token-count">${strNeg.length} 字符</span>`;

        const copyNegBtn = document.createElement('button');
        copyNegBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        copyNegBtn.innerHTML = `${SVG_ICONS.copy} 复制`;
        copyNegBtn.onclick = () => {
            void navigator.clipboard.writeText(strNeg).then(() => {
                FeedbackService.toastSuccess('已复制反向提示词');
            });
        };

        negHeader.appendChild(negTitle);
        negHeader.appendChild(copyNegBtn);
        negBox.appendChild(negHeader);

        const negText = document.createElement('div');
        negText.className = 'da-inspect-prompt-text';
        negText.textContent = strNeg;
        negBox.appendChild(negText);

        leftCol.appendChild(negBox);
    }

    // 生效 LoRA 列表
    const loras = extractLorasFromPrompt(String(promptVal || ''));
    if (loras.length > 0) {
        const loraBox = document.createElement('div');
        loraBox.className = 'da-inspect-lora-box';

        const loraTitle = document.createElement('div');
        loraTitle.className = 'da-inspect-meta-subhead';
        loraTitle.textContent = `生效 LoRA 模型 (${loras.length})`;
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
        leftCol.appendChild(loraBox);
    }

    // 后端引擎参数 (动态识别引擎并输出参数)
    const paramsCard = document.createElement('div');
    paramsCard.className = 'da-inspect-params-matrix';

    const renderedKeys = new Set<string>();

    const addParamRow = (label: string, value: any, copyable = false) => {
        if (value === undefined || value === null || value === '' || typeof value === 'object') return;
        const row = document.createElement('div');
        row.className = 'da-inspect-param-cell';

        const labelEl = document.createElement('span');
        labelEl.className = 'da-inspect-param-label';
        labelEl.textContent = label;

        const valEl = document.createElement('span');
        valEl.className = `da-inspect-param-val ${copyable ? 'is-copyable' : ''}`;
        valEl.textContent = String(value);

        if (copyable) {
            valEl.title = '点击复制此数值';
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

    const engineType = detectEngineType(metaObj, recordObj);
    const paramsSource = (typeof metaObj.params === 'object' && metaObj.params !== null ? metaObj.params : {}) as Record<string, any>;
    const getVal = (...keys: string[]) => {
        for (const k of keys) {
            if (metaObj[k] !== undefined && metaObj[k] !== null && metaObj[k] !== '') {
                renderedKeys.add(k);
                return metaObj[k];
            }
            if (paramsSource[k] !== undefined && paramsSource[k] !== null && paramsSource[k] !== '') {
                renderedKeys.add(k);
                return paramsSource[k];
            }
            if (recordObj[k] !== undefined && recordObj[k] !== null && recordObj[k] !== '') {
                renderedKeys.add(k);
                return recordObj[k];
            }
        }
        return undefined;
    };

    // 引擎参数呈现
    if (engineType === 'comfyui') {
        addParamRow('生图引擎 (Driver)', 'ComfyUI (节点工作流)');
        const profile = getVal('workflow', 'workflowProfile', 'workflowName', 'profile');
        if (profile) addParamRow('工作流方案 (Profile)', profile, true);
        const model = getVal('model', 'ckptName', 'checkpoint');
        if (model) addParamRow('主模型 (Model)', model, true);
        const vae = getVal('vae', 'vaeName');
        if (vae) addParamRow('VAE 解码器', vae, true);
        const sampler = getVal('samplerName', 'sampler', 'sampler_name');
        if (sampler) addParamRow('采样算法 (Sampler)', sampler);
        const scheduler = getVal('scheduler', 'schedulerName', 'noise_schedule');
        if (scheduler) addParamRow('时间步调度 (Scheduler)', scheduler);
        const steps = getVal('steps');
        if (steps) addParamRow('采样步数 (Steps)', steps);
        const cfg = getVal('cfgScale', 'cfg', 'scale');
        if (cfg) addParamRow('引导系数 (CFG Scale)', cfg);
        const denoise = getVal('denoise', 'denoisingStrength', 'denoising_strength');
        if (denoise !== undefined) addParamRow('去噪幅度 (Denoise)', denoise);
        const seed = getVal('seed');
        if (seed !== undefined) addParamRow('随机种子 (Seed)', seed, true);
        const promptId = getVal('promptId', 'prompt_id');
        if (promptId) addParamRow('任务编号 (Prompt ID)', promptId, true);
    } else if (engineType === 'sdwebui') {
        addParamRow('生图引擎 (Driver)', 'SD-WebUI / Forge');
        const model = getVal('ckptName', 'model', 'checkpoint', 'sdModelCheckpoint');
        if (model) addParamRow('主模型 (Checkpoint)', model, true);
        const sampler = getVal('samplerName', 'sampler', 'sampler_name');
        if (sampler) addParamRow('采样算法 (Sampler)', sampler);
        const steps = getVal('steps');
        if (steps) addParamRow('采样步数 (Steps)', steps);
        const cfg = getVal('cfgScale', 'cfg', 'scale');
        if (cfg) addParamRow('引导系数 (CFG Scale)', cfg);
        const seed = getVal('seed');
        if (seed !== undefined) addParamRow('随机种子 (Seed)', seed, true);
        const clipSkip = getVal('clipSkip', 'clip_skip');
        if (clipSkip !== undefined) addParamRow('CLIP 跳过层 (Clip Skip)', clipSkip);
        const hires = getVal('enableHires', 'hires_fix');
        if (hires) addParamRow('高清修复 (Hires.fix)', '已启用');
        const upscaler = getVal('hiresUpscaler', 'hr_upscaler');
        if (upscaler) addParamRow('放大算法 (Upscaler)', upscaler);
        const hrScale = getVal('hiresScale', 'hr_scale');
        if (hrScale) addParamRow('放大倍率 (Upscale By)', `${hrScale}x`);
        const hrDenoise = getVal('hiresDenoise', 'denoising_strength', 'hr_denoise');
        if (hrDenoise !== undefined) addParamRow('高清去噪幅度 (Denoise)', hrDenoise);
    } else if (engineType === 'novelai') {
        addParamRow('生图引擎 (Driver)', 'NovelAI Diffusion');
        const model = getVal('model', 'naiModel');
        if (model) addParamRow('NAI 模型 (Model)', model, true);
        const sampler = getVal('samplerName', 'sampler');
        if (sampler) addParamRow('采样算法 (Sampler)', sampler);
        const noiseSched = getVal('scheduler', 'noise_schedule');
        if (noiseSched) addParamRow('时间步调度 (Scheduler)', noiseSched);
        const uncond = getVal('uncondScale', 'uncond_scale');
        if (uncond !== undefined) addParamRow('未提示词引导 (Uncond)', uncond);
        const smea = getVal('smea', 'sm');
        const smeaDyn = getVal('smea_dyn', 'sm_dyn');
        if (smea || smeaDyn) addParamRow('SMEA 采样增强', smeaDyn ? 'SMEA DYN' : 'SMEA');
        const decrisper = getVal('decrisper');
        if (decrisper !== undefined) addParamRow('去脆化 (Decrisper)', decrisper ? '开启' : '关闭');
        const qualityToggle = getVal('addQualityTags', 'quality_toggle');
        if (qualityToggle !== undefined) addParamRow('画质标签添加', qualityToggle ? '开启' : '关闭');
        const seed = getVal('seed');
        if (seed !== undefined) addParamRow('随机种子 (Seed)', seed, true);
    } else if (engineType === 'openai') {
        addParamRow('生图引擎 (Driver)', 'OpenAI 兼容 (OpenAI API)');
        const engineModel = getVal('model', 'engine');
        if (engineModel) addParamRow('模型 (Model)', engineModel, true);
        const quality = getVal('quality');
        if (quality) addParamRow('画质模式 (Quality)', quality);
        const style = getVal('style');
        if (style) addParamRow('画面风格 (Style)', style);
        const aspect = getVal('aspectRatio', 'aspect_ratio');
        if (aspect) addParamRow('画面宽高比 (Aspect Ratio)', aspect);
        const seed = getVal('seed');
        if (seed !== undefined) addParamRow('随机种子 (Seed)', seed, true);
    } else {
        const driver = getVal('driver', 'engine');
        if (driver) addParamRow('生图驱动 (Driver)', driver);
        const model = getVal('model', 'ckptName');
        if (model) addParamRow('生成模型 (Model)', model, true);
        const sampler = getVal('samplerName', 'sampler');
        if (sampler) addParamRow('采样算法 (Sampler)', sampler);
        const steps = getVal('steps');
        if (steps) addParamRow('采样步数 (Steps)', steps);
        const cfg = getVal('cfgScale', 'cfg');
        if (cfg) addParamRow('引导系数 (CFG Scale)', cfg);
        const seed = getVal('seed');
        if (seed !== undefined) addParamRow('随机种子 (Seed)', seed, true);
    }

    // 图像尺寸
    const width = getVal('width');
    const height = getVal('height');
    if (width && height) {
        addParamRow('生成分辨率 (Size)', `${width} × ${height}`);
    } else {
        const size = getVal('size');
        if (size) addParamRow('生成分辨率 (Size)', size);
    }

    // 自适应扩展参数提取
    const ignoredKeys = new Set([
        'prompt', 'positive', 'fullPositivePrompt', 'negativePrompt', 'negative', 'fullNegativePrompt', 'uc',
        'data', 'imageSrc', 'src', 'base64', 'url', 'mime', 'timestamp', 'params', 'images', 'info', 'loras',
        'uuid', 'id', 'imageId', 'isFavorite', 'storage', 'onDelete', 'onFavoriteChange', 'onRefresh'
    ]);

    const allCombined = { ...metaObj, ...paramsSource };
    for (const [key, val] of Object.entries(allCombined)) {
        if (renderedKeys.has(key) || ignoredKeys.has(key)) continue;
        if (val === undefined || val === null || val === '' || typeof val === 'object') continue;

        const friendlyLabel = key
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^./, (str) => str.toUpperCase())
            .trim();
        addParamRow(friendlyLabel, val, true);
        renderedKeys.add(key);
    }

    leftCol.appendChild(paramsCard);
    content.appendChild(leftCol);

    // 右栏：视觉大图、技术指标与操作工具箱
    const rightCol = document.createElement('div');
    rightCol.className = 'da-inspect-col-visual';

    const previewBox = document.createElement('div');
    previewBox.className = 'da-inspect-preview-box';
    previewBox.title = '点击调起全屏原图查看器';

    const previewImg = document.createElement('img');
    previewImg.className = 'da-inspect-preview-img';

    if (imgSrc) {
        previewImg.src = imgSrc;
        const zoomBadge = document.createElement('div');
        zoomBadge.className = 'da-inspect-zoom-badge';
        zoomBadge.innerHTML = `${SVG_ICONS.zoom} 点击放大`;
        previewBox.appendChild(previewImg);
        previewBox.appendChild(zoomBadge);
        previewBox.addEventListener('click', () => openImagePreviewModal(imgSrc));
        rightCol.appendChild(previewBox);
    } else {
        const noImgCard = document.createElement('div');
        noImgCard.className = 'da-empty-tip da-empty-tip--card';
        noImgCard.innerHTML = `暂无图像文件预览<div class="da-empty-tip__sub">（图像数据已离线或待载入）</div>`;
        rightCol.appendChild(noImgCard);
    }

    // 技术指标卡片
    const specsCard = document.createElement('div');
    specsCard.className = 'da-inspect-tech-specs';

    const addTechSpec = (label: string, value: string) => {
        const item = document.createElement('div');
        item.className = 'da-inspect-tech-item';
        item.innerHTML = `<span class="da-inspect-tech-label">${label}</span><span class="da-inspect-tech-value">${value}</span>`;
        specsCard.appendChild(item);
    };

    if (width && height) addTechSpec('分辨率', `${width} × ${height}`);
    if (rawData instanceof Blob) addTechSpec('文件体积', formatBytes(rawData.size));
    if (recordObj.mime || metaObj.mime) addTechSpec('图像格式', String(recordObj.mime || metaObj.mime).toUpperCase().replace('IMAGE/', ''));
    if (recordObj.timestamp || metaObj.timestamp) {
        addTechSpec('生成时间', new Date(Number(recordObj.timestamp || metaObj.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }

    if (specsCard.children.length > 0) {
        rightCol.appendChild(specsCard);
    }

    // 快捷操作工具箱 (原图下载 / 标星 / 复制标准参数 / 复制 JSON / 删除)
    const actionsCard = document.createElement('div');
    actionsCard.className = 'da-inspect-actions-card';

    let downloadBtn: HTMLButtonElement | undefined;
    const bindDownloadAction = (url: string) => {
        if (!downloadBtn) {
            downloadBtn = document.createElement('button');
            downloadBtn.className = 'da-btn da-btn--secondary da-btn--sm';
            downloadBtn.innerHTML = `${SVG_ICONS.download} 原图下载`;
            actionsCard.prepend(downloadBtn);
            if (!actionsCard.parentElement) {
                rightCol.appendChild(actionsCard);
            }
        }
        downloadBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = `st-draw-${imageId}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            FeedbackService.toastSuccess('已开始下载原始图像');
        };
    };

    if (imgSrc) {
        bindDownloadAction(imgSrc);
    }

    // 标星收藏
    let currentFavoriteState = Boolean(recordObj.isFavorite);
    if (targetUuid && targetStorage) {
        const favBtn = document.createElement('button');
        favBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        favBtn.innerHTML = currentFavoriteState ? `${SVG_ICONS.starFill} 已标星收藏` : `${SVG_ICONS.starLine} 标星收藏`;
        favBtn.onclick = async () => {
            try {
                const newFav = await targetStorage.toggleFavorite(targetUuid!);
                currentFavoriteState = newFav;
                favBtn.innerHTML = newFav ? `${SVG_ICONS.starFill} 已标星收藏` : `${SVG_ICONS.starLine} 标星收藏`;
                onFavoriteChangeFn?.(newFav);
                FeedbackService.toastSuccess(newFav ? '已加入标星收藏' : '已取消标星收藏');
            } catch (err) {
                FeedbackService.toastError('更新标星收藏状态失败');
            }
        };
        actionsCard.appendChild(favBtn);
    }

    // 复制标准参数文本
    const copyParamsBtn = document.createElement('button');
    copyParamsBtn.className = 'da-btn da-btn--secondary da-btn--sm';
    copyParamsBtn.innerHTML = `${SVG_ICONS.copy} 复制标准参数`;
    copyParamsBtn.onclick = () => {
        const lines: string[] = [];
        if (promptVal) lines.push(String(promptVal));
        if (negVal) lines.push(`Negative prompt: ${String(negVal)}`);

        const paramTokens: string[] = [];
        const steps = getVal('steps');
        if (steps) paramTokens.push(`Steps: ${steps}`);
        const sampler = getVal('samplerName', 'sampler');
        if (sampler) paramTokens.push(`Sampler: ${sampler}`);
        const cfg = getVal('cfgScale', 'cfg');
        if (cfg) paramTokens.push(`CFG scale: ${cfg}`);
        const seed = getVal('seed');
        if (seed !== undefined) paramTokens.push(`Seed: ${seed}`);
        if (width && height) paramTokens.push(`Size: ${width}x${height}`);
        const model = getVal('model', 'ckptName');
        if (model) paramTokens.push(`Model: ${model}`);

        if (paramTokens.length > 0) lines.push(paramTokens.join(', '));
        const fullText = lines.join('\n');
        void navigator.clipboard.writeText(fullText).then(() => {
            FeedbackService.toastSuccess('已复制标准生图参数文本');
        });
    };
    actionsCard.appendChild(copyParamsBtn);

    // 复制完整元数据 JSON
    const copyJsonBtn = document.createElement('button');
    copyJsonBtn.className = 'da-btn da-btn--secondary da-btn--sm';
    copyJsonBtn.innerHTML = `${SVG_ICONS.code} 复制完整 JSON`;
    copyJsonBtn.onclick = () => {
        const jsonStr = JSON.stringify({ prompt: promptVal, negativePrompt: negVal, metadata: metaObj }, null, 2);
        void navigator.clipboard.writeText(jsonStr).then(() => {
            FeedbackService.toastSuccess('已复制完整元数据 JSON');
        });
    };
    actionsCard.appendChild(copyJsonBtn);

    // 删除单图记录
    const uuidForDelete = recordObj.uuid || recordObj.id || targetUuid;
    if (onDeleteFn && uuidForDelete) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'da-btn da-btn--danger da-btn--sm';
        deleteBtn.innerHTML = `${SVG_ICONS.trash} 删除记录`;
        deleteBtn.onclick = async () => {
            const confirmed = await showConfirmDialog({
                title: '删除图像记录确认',
                message: `确定要删除图像 #${imageId} 吗？此操作无法撤销。`,
                isDangerous: true
            });
            if (confirmed) {
                onDeleteFn!(uuidForDelete);
                closePanel();
                FeedbackService.toastSuccess('图像记录已成功删除');
            }
        };
        actionsCard.appendChild(deleteBtn);
    }

    if (actionsCard.children.length > 0) {
        rightCol.appendChild(actionsCard);
    }

    content.appendChild(rightCol);
    panel.appendChild(content);

    // 异步拉取原图 (当传入仅为 UUID 时)
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
                    previewBox.innerHTML = '';
                    const dynImg = document.createElement('img');
                    dynImg.className = 'da-inspect-preview-img';
                    dynImg.src = dynamicSrc;
                    const zoomBadge = document.createElement('div');
                    zoomBadge.className = 'da-inspect-zoom-badge';
                    zoomBadge.innerHTML = `${SVG_ICONS.zoom} 点击放大`;
                    previewBox.appendChild(dynImg);
                    previewBox.appendChild(zoomBadge);
                    previewBox.onclick = () => openImagePreviewModal(dynamicSrc);
                    bindDownloadAction(dynamicSrc);
                }
            }
        }).catch((err: any) => {
            logger.debug('异步拉取原图数据失败:', err);
        });
    }

    return modalHandle;
}
