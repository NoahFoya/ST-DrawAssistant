/**
 * @module src/ui/media/image-info
 * @description 图像技术元数据检查器抽屉组件 (ImageInfoModal)
 *
 * 核心功能：
 * 1. 结构化解析并呈现历史生图的完整技术元数据（生图引擎、生成耗时、精确超参数与随机种子）；
 * 2. 呈现正反向提示词与 LoRA 模型列表，支持文本一键复制与快捷复用；
 * 3. 呈现图像缩略图、文件尺寸与存储类型规格；
 * 4. 提供原始响应 JSON 预览与复制能力，辅助高级调优与复现。
 *
 * 注意事项：
 * 1. 历史或外部生成的图像记录可能缺失部分元数据字段，渲染时需提供默认占位防崩保护；
 * 2. 复制文本到剪贴板需做权限异常捕获与友好反馈。
 */

import { createElement, formatBytes } from '../../util/dom';
import { createButton, ButtonHandle } from '../components/button';
import { Toast } from '../components/feedback';
import { getIconSvg } from '../components/icons';
import type { StoredImageRecord } from '@types';

export interface ImageInfoModalOptions {
    containerEl?: HTMLElement;
    onReusePrompt?: (prompt: string, negativePrompt?: string) => void;
    onRegenerate?: (record: StoredImageRecord) => void;
    onPreviewImage?: (url: string) => void;
    onClose?: () => void;
}

export interface ImageInfoModalHandle {
    readonly element: HTMLElement;
    open(record: StoredImageRecord): void;
    close(): void;
    isOpen(): boolean;
    dispose(): void;
}

export function createImageInfoModal(options: ImageInfoModalOptions = {}): ImageInfoModalHandle {
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    let currentRecord: StoredImageRecord | null = null;
    let currentObjectUrl: string | null = null;
    let isOpen = false;

    // 1. 全屏遮罩
    const backdrop = createElement('div', {
        className: 'da-modal-backdrop st-da-root',
        attributes: {
            style: 'display: none; position: fixed; inset: 0; z-index: var(--da-z-modal, 100050); background: var(--da-bg-overlay-modal, rgba(0, 0, 0, 0.65)); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); align-items: center; justify-content: center;'
        }
    });

    // 2. 视窗主体 (.da-inspect-modal)
    const modal = createElement('div', { className: 'da-inspect-modal' });
    backdrop.appendChild(modal);

    // 3. 顶栏 (.da-inspect-header)
    const header = createElement('div', { className: 'da-inspect-header' });

    const headerLeft = createElement('div', { className: 'da-inspect-header__left' });
    const titleEl = createElement('h3', { className: 'da-inspect-title' });
    titleEl.innerHTML = `${getIconSvg('palette')} <span>生图参数元数据详情</span>`;
    headerLeft.appendChild(titleEl);

    const engineBadge = createElement('span', { className: 'da-inspect-badge' });
    headerLeft.appendChild(engineBadge);

    const timeBadge = createElement('span', { className: 'da-inspect-badge' });
    headerLeft.appendChild(timeBadge);
    header.appendChild(headerLeft);

    const closeBtn = createElement('button', {
        className: 'da-icon-btn',
        attributes: { type: 'button', 'aria-label': '关闭', title: '关闭 (Esc)' }
    });
    closeBtn.innerHTML = getIconSvg('close');
    closeBtn.addEventListener('click', () => close());
    header.appendChild(closeBtn);

    modal.appendChild(header);

    // 4. 双列主体网格 (.da-inspect-body)
    const body = createElement('div', { className: 'da-inspect-body' });
    modal.appendChild(body);

    // 左栏 (.da-inspect-col-meta)
    const colMeta = createElement('div', { className: 'da-inspect-col-meta' });

    // 正向提示词卡片
    const posBox = createElement('div', { className: 'da-inspect-prompt-box' });
    const posHeader = createElement('div', { className: 'da-inspect-prompt-header' });
    posHeader.innerHTML = `
        <div class="da-inspect-prompt-title">
            ${getIconSvg('sparkles')}
            <span>正向提示词 (Positive Prompt)</span>
        </div>
    `;
    const posCopyBtn: ButtonHandle = createButton({
        text: '复制',
        variant: 'secondary',
        icon: 'copy',
        onClick: () => {
            const text = currentRecord?.metadata?.prompt || currentRecord?.prompt || '';
            navigator.clipboard.writeText(text);
            Toast.success('正向提示词已复制');
        }
    });
    regDisposer(posCopyBtn);
    posHeader.appendChild(posCopyBtn.element);
    posBox.appendChild(posHeader);

    const posTextEl = createElement('div', { className: 'da-inspect-prompt-text' });
    posBox.appendChild(posTextEl);
    colMeta.appendChild(posBox);

    // 负向提示词卡片
    const negBox = createElement('div', { className: 'da-inspect-prompt-box is-negative' });
    const negHeader = createElement('div', { className: 'da-inspect-prompt-header' });
    negHeader.innerHTML = `
        <div class="da-inspect-prompt-title">
            ${getIconSvg('alert')}
            <span>负向提示词 (Negative Prompt)</span>
        </div>
    `;
    const negCopyBtn: ButtonHandle = createButton({
        text: '复制',
        variant: 'secondary',
        icon: 'copy',
        onClick: () => {
            const text = currentRecord?.metadata?.negativePrompt || '';
            navigator.clipboard.writeText(text);
            Toast.success('负向提示词已复制');
        }
    });
    regDisposer(negCopyBtn);
    negHeader.appendChild(negCopyBtn.element);
    negBox.appendChild(negHeader);

    const negTextEl = createElement('div', { className: 'da-inspect-prompt-text' });
    negBox.appendChild(negTextEl);
    colMeta.appendChild(negBox);

    // LoRA 列表卡片
    const loraBox = createElement('div', { className: 'da-inspect-lora-box' });
    loraBox.innerHTML = `<div class="da-inspect-meta-subhead">${getIconSvg('zap')} 挂载 LoRA 模型</div>`;
    const loraChipsContainer = createElement('div', { className: 'da-inspect-lora-chips' });
    loraBox.appendChild(loraChipsContainer);
    colMeta.appendChild(loraBox);

    // 参数双列网格 (.da-inspect-params-matrix)
    const paramsMatrix = createElement('div', { className: 'da-inspect-params-matrix' });
    colMeta.appendChild(paramsMatrix);

    body.appendChild(colMeta);

    // 右栏 (.da-inspect-col-visual)
    const colVisual = createElement('div', { className: 'da-inspect-col-visual' });

    // 1:1 预览视窗
    const previewBox = createElement('div', { className: 'da-inspect-preview-box' });
    const previewImg = createElement('img', { className: 'da-inspect-preview-img' });
    previewBox.appendChild(previewImg);

    const zoomBadge = createElement('div', {
        className: 'da-inspect-zoom-badge',
        textContent: '点击放大预览 🔍'
    });
    previewBox.appendChild(zoomBadge);

    previewBox.addEventListener('click', () => {
        if (currentRecord && currentObjectUrl) {
            options.onPreviewImage?.(currentObjectUrl);
        }
    });
    colVisual.appendChild(previewBox);

    // 技术规格指标 (.da-inspect-tech-specs)
    const techSpecs = createElement('div', { className: 'da-inspect-tech-specs' });
    colVisual.appendChild(techSpecs);

    // 快捷操作工具箱 (.da-inspect-actions-card)
    const actionsCard = createElement('div', { className: 'da-inspect-actions-card' });

    // 一键复用提示词
    const reuseBtn: ButtonHandle = createButton({
        text: '一键复用提示词',
        variant: 'secondary',
        icon: 'copy',
        onClick: () => {
            if (!currentRecord) return;
            const prompt = currentRecord.metadata?.prompt || currentRecord.prompt || '';
            const negPrompt = currentRecord.metadata?.negativePrompt || '';
            options.onReusePrompt?.(prompt, negPrompt);
            Toast.success('提示词已注入输入框');
            close();
        }
    });
    regDisposer(reuseBtn);
    actionsCard.appendChild(reuseBtn.element);

    // 一键复现生图
    const regenBtn: ButtonHandle = createButton({
        text: '一键复现生图',
        variant: 'primary',
        icon: 'sparkles',
        onClick: () => {
            if (!currentRecord) return;
            options.onRegenerate?.(currentRecord);
            Toast.success('已加入生图执行队列');
            close();
        }
    });
    regDisposer(regenBtn);
    actionsCard.appendChild(regenBtn.element);

    // 复制全部参数 (JSON)
    const copyJsonBtn: ButtonHandle = createButton({
        text: '复制全部参数 (JSON)',
        variant: 'secondary',
        icon: 'copy',
        onClick: () => {
            if (!currentRecord) return;
            const fullParams = {
                prompt: currentRecord.metadata?.prompt || currentRecord.prompt,
                negativePrompt: currentRecord.metadata?.negativePrompt,
                engine: currentRecord.metadata?.engine,
                dimensions: currentRecord.metadata?.dimensions,
                durationMs: currentRecord.metadata?.durationMs,
                engineParams: currentRecord.metadata?.engineParams
            };
            navigator.clipboard.writeText(JSON.stringify(fullParams, null, 2));
            Toast.success('全部参数已复制为 JSON');
        }
    });
    regDisposer(copyJsonBtn);
    actionsCard.appendChild(copyJsonBtn.element);

    // 下载图片
    const downloadBtn: ButtonHandle = createButton({
        text: '下载原图',
        variant: 'secondary',
        icon: 'download',
        onClick: () => {
            if (!currentRecord?.originalBlob) return;
            const url = URL.createObjectURL(currentRecord.originalBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `st_draw_${currentRecord.id || Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            Toast.success('开始下载图片');
        }
    });
    regDisposer(downloadBtn);
    actionsCard.appendChild(downloadBtn.element);

    colVisual.appendChild(actionsCard);
    body.appendChild(colVisual);

    // 键盘 Esc 监听
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && isOpen) {
            close();
        }
    };
    document.addEventListener('keydown', onKeyDown);
    disposers.push(() => document.removeEventListener('keydown', onKeyDown));

    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            close();
        }
    });

    disposers.push(() => backdrop.remove());

    interface ExtractedDisplayParams {
        model: string;
        sampler: string;
        scheduler: string;
        steps: string;
        cfg: string;
        seed: string;
        loras: Array<{ name: string; weight: number }>;
    }

    function extractImageDisplayParams(record: StoredImageRecord): ExtractedDisplayParams {
        const meta = record.metadata;
        const ep = meta?.engineParams as Record<string, unknown> | undefined;
        const engine = (meta?.engine || (ep?.engine as string) || '').toLowerCase();
        const raw = meta?.rawResponse as Record<string, unknown> | undefined;

        let model = '--';
        let sampler = '--';
        let scheduler = '--';
        let steps = '--';
        let cfg = '--';
        let seed = '--';
        const loras: Array<{ name: string; weight: number }> = [];

        if (raw && typeof raw.seed === 'number') {
            seed = String(raw.seed);
        }

        if (engine === 'comfyui' && ep) {
            const vars = (ep.variables || {}) as Record<string, unknown>;
            model = String(vars.model_name || vars.ckpt_name || ep.model || '--');
            sampler = vars.sampler_name ? String(vars.sampler_name) : (ep.sampler ? String(ep.sampler) : (ep.sampler_name ? String(ep.sampler_name) : '--'));
            scheduler = vars.scheduler ? String(vars.scheduler) : (ep.scheduler ? String(ep.scheduler) : '--');
            const stepVal = vars.steps ?? ep.steps;
            steps = stepVal !== undefined ? `${stepVal} 步` : '--';
            const cfgVal = vars.cfg ?? ep.cfg ?? ep.cfgScale;
            cfg = cfgVal !== undefined ? String(cfgVal) : '--';
            const seedVal = vars.seed ?? ep.seed;
            if (seed === '--' && seedVal !== undefined) seed = String(seedVal);

            if (Array.isArray(ep.loras)) {
                for (const item of ep.loras) {
                    if (!item) continue;
                    const name = typeof item === 'string' ? item : item.name || item.id || 'LoRA';
                    const weight = typeof item === 'object' ? item.modelWeight ?? item.weight ?? 1.0 : 1.0;
                    loras.push({ name, weight });
                }
            }
        } else if (engine === 'sdwebui' && ep) {
            const overrides = (ep.override_settings || {}) as Record<string, unknown>;
            model = String(overrides.sd_model_checkpoint || ep.model || '--');
            sampler = String(ep.sampler_name || '--');
            scheduler = String(ep.scheduler || '默认');
            steps = ep.steps ? `${ep.steps} 步` : '--';
            cfg = ep.cfg_scale !== undefined ? String(ep.cfg_scale) : '--';
            if (seed === '--' && ep.seed !== undefined) seed = String(ep.seed);

            // 从正向提示词中提取已嵌入的 <lora:name:weight> 标签
            const promptText = meta?.prompt || record.prompt || '';
            const loraRegex = /<lora:([^:>]+):?([^>]*)>/g;
            let match: RegExpExecArray | null;
            while ((match = loraRegex.exec(promptText)) !== null) {
                const name = match[1];
                const weight = parseFloat(match[2]) || 1.0;
                loras.push({ name, weight });
            }
        } else if (engine === 'novelai' && ep) {
            model = String(ep.model || '--');
            const params = (ep.parameters || {}) as Record<string, unknown>;
            sampler = String(params.sampler || '--');
            scheduler = '--';
            steps = params.steps ? `${params.steps} 步` : '--';
            cfg = params.scale !== undefined ? String(params.scale) : '--';
            if (seed === '--' && params.seed !== undefined) seed = String(params.seed);
        } else if (engine === 'openai' && ep) {
            model = String(ep.model || '--');
            sampler = 'API内置';
            scheduler = '--';
            steps = 'API内置';
            cfg = 'API内置';
            if (seed === '--' && ep.seed !== undefined) seed = String(ep.seed);
        } else if (ep) {
            model = String(ep.model || ep.checkpoint || ep.baseModel || '--');
            sampler = String(ep.sampler || ep.sampler_name || '--');
            scheduler = String(ep.scheduler || '--');
            steps = ep.steps ? `${ep.steps} 步` : '--';
            cfg = String(ep.cfg || ep.cfgScale || '--');
            if (seed === '--' && ep.seed !== undefined) seed = String(ep.seed);
        }

        return { model, sampler, scheduler, steps, cfg, seed, loras };
    }

    function renderModal(record: StoredImageRecord) {
        currentRecord = record;
        const meta = record.metadata;
        const displayParams = extractImageDisplayParams(record);

        // 顶栏徽标
        engineBadge.textContent = (meta?.engine || '未知引擎').toUpperCase();
        timeBadge.textContent = meta?.durationMs ? `${(meta.durationMs / 1000).toFixed(2)}s` : '--';

        // 提示词
        posTextEl.textContent = meta?.prompt || record.prompt || '(无正向词)';
        negTextEl.textContent = meta?.negativePrompt || '(无负向词)';

        // LoRA
        loraChipsContainer.innerHTML = '';
        if (displayParams.loras.length > 0) {
            loraBox.style.display = 'flex';
            for (const lora of displayParams.loras) {
                const chip = createElement('div', { className: 'da-inspect-lora-chip' });
                chip.innerHTML = `
                    <span>${lora.name}</span>
                    <span class="da-chip-val">${lora.weight}</span>
                `;
                loraChipsContainer.appendChild(chip);
            }
        } else {
            loraBox.style.display = 'none';
        }

        // 参数属性表格
        paramsMatrix.innerHTML = '';
        const paramsList = [
            { label: '生图底模', val: displayParams.model },
            { label: '采样算法', val: displayParams.sampler },
            { label: '调度类型', val: displayParams.scheduler },
            { label: '迭代步数', val: displayParams.steps },
            { label: 'CFG 相关性', val: displayParams.cfg },
            { label: '随机种子', val: displayParams.seed },
            { label: '画幅规格', val: meta?.dimensions ? `${meta.dimensions.width} × ${meta.dimensions.height}` : '--' },
            { label: '生成时间', val: meta?.createdAt ? new Date(meta.createdAt).toLocaleString() : '--' }
        ];

        for (const p of paramsList) {
            const cell = createElement('div', { className: 'da-inspect-param-cell' });
            cell.innerHTML = `
                <div class="da-inspect-param-label">${p.label}</div>
                <div class="da-inspect-param-val is-copyable" title="点击复制">${p.val}</div>
            `;
            const valEl = cell.querySelector('.da-inspect-param-val');
            valEl?.addEventListener('click', () => {
                navigator.clipboard.writeText(String(p.val));
                Toast.success(`已复制 ${p.label}: ${p.val}`);
            });
            paramsMatrix.appendChild(cell);
        }

        // 缩略图
        if (record.originalBlob) {
            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
            }
            currentObjectUrl = URL.createObjectURL(record.originalBlob);
            previewImg.src = currentObjectUrl;
        } else {
            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
                currentObjectUrl = null;
            }
            previewImg.src = '';
        }

        // 技术规格
        techSpecs.innerHTML = `
            <div class="da-inspect-tech-item">
                <span class="da-inspect-tech-label">文件体积</span>
                <span class="da-inspect-tech-value">${record.originalBlob ? formatBytes(record.originalBlob.size) : '--'}</span>
            </div>
            <div class="da-inspect-tech-item">
                <span class="da-inspect-tech-label">像素分辨率</span>
                <span class="da-inspect-tech-value">${meta.dimensions ? `${meta.dimensions.width}×${meta.dimensions.height}` : '--'}</span>
            </div>
            <div class="da-inspect-tech-item">
                <span class="da-inspect-tech-label">图像格式</span>
                <span class="da-inspect-tech-value">${record.originalBlob?.type || 'image/png'}</span>
            </div>
            <div class="da-inspect-tech-item">
                <span class="da-inspect-tech-label">资产校验哈希</span>
                <span class="da-inspect-tech-value" style="font-family: monospace; font-size: 10px;" title="${record.hash || '--'}">${record.hash ? record.hash.slice(0, 10) + '...' : '--'}</span>
            </div>
        `;
    }

    function open(record: StoredImageRecord) {
        isOpen = true;
        const targetParent = options.containerEl || (typeof document !== 'undefined' ? document.body : null);
        if (targetParent && !targetParent.contains(backdrop)) {
            targetParent.appendChild(backdrop);
        }
        backdrop.style.display = 'flex';
        renderModal(record);
    }

    function close() {
        isOpen = false;
        backdrop.style.display = 'none';
        options.onClose?.();
    }

    return {
        element: backdrop,
        open,
        close,
        isOpen(): boolean {
            return isOpen;
        },
        dispose(): void {
            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
                currentObjectUrl = null;
            }
            backdrop.remove();
            for (const d of disposers) {
                d();
            }
        }
    };
}
