/**
 * 图像元数据查看弹窗 (ImageInfoModal)。
 *
 * @remarks
 * 呈现生图参数与元数据：
 * 1. 支持正向/负向提示词与各项生成参数一键复制；
 * 2. 支持原图预览、下载原图、复制元数据 JSON，以及可选的“编辑与重新生成”（供移动端或详情页直接唤出图片编辑面板）和“删除记录”操作。
 */

import type { Disposable } from '../types';
import type { ImageGenerationMetadata, StoredImageRecord } from '@types';
import { renderIcon } from '../components/icons';
import { overlayStack } from '../framework/overlay-stack';
import { Toast } from '../feedback/toast';
import { imageStorage } from '../../store/image-storage';
import { copyTextToClipboard } from '../../util/clipboard';
import { logger } from '../../util/logger';

export interface ImageInfoModalOpenOptions {
    /** 图像技术元数据对象 */
    metadata?: ImageGenerationMetadata | Record<string, unknown>;
    /** 可选的图像预览地址 (URL 或 DataURL) */
    imageUrl?: string;
    /** 可选的资产记录完整上下文 */
    record?: StoredImageRecord;
    /** 可选的打开图片编辑面板回调（移动端可通过此入口唤出编辑面板） */
    onEdit?: () => void;
    /** 可选的预览原图回调（未提供时回退至浏览器新标签页打开） */
    onPreview?: (imageUrl: string) => void;
    /** 可选的删除当前图像记录回调 */
    onDelete?: () => void;
}

interface ParamEntry {
    label: string;
    value: string;
    copyValue?: string;
    wide?: boolean;
}

interface ParamSection {
    title: string;
    entries: ParamEntry[];
}

/** 内部追踪与不可复用的字段集合，不在可复用参数面板与复制 JSON 中展示 */
const NON_REUSABLE_META_KEYS = new Set([
    'rawPrompt',
    'rawNegativePrompt',
    'promptId',
    'filename',
    'parentImageId',
    'durationMs',
    'taskId',
    'imageId',
    'chatId',
    'remotePath',
]);

/** 已归类映射的已知元数据字段 */
const KNOWN_REUSABLE_META_KEYS = new Set([
    'prompt',
    'negativePrompt',
    'engine',
    'mode',
    'width',
    'height',
    'sampler',
    'scheduler',
    'steps',
    'cfgScale',
    'seed',
    'baseModel',
    'clipName',
    'vaeName',
    'clipSkip',
    'extraModels',
    'workflowId',
    'denoiseStrength',
    'maskBlur',
    'enableHires',
    'hiresUpscaler',
    'hiresScale',
    'hiresSteps',
    'hiresDenoise',
    'cfgRescale',
    'smeaMode',
    'decrisper',
    'quality',
    'style',
]);

function formatEngineDisplay(engine?: string): string | undefined {
    if (!engine) return undefined;
    switch (engine.toLowerCase()) {
        case 'comfyui':
            return 'ComfyUI';
        case 'sdwebui':
            return 'SD-WebUI';
        case 'novelai':
            return 'NovelAI';
        case 'openai':
            return 'OpenAI';
        default:
            return engine;
    }
}

function formatSmeaDisplay(mode?: string): string | undefined {
    if (!mode) return undefined;
    switch (mode) {
        case 'smea_dyn':
            return 'SMEA + Dyn';
        case 'smea':
            return 'SMEA';
        case 'none':
            return '关闭';
        default:
            return mode;
    }
}

function hasDisplayValue(val: unknown): boolean {
    if (val === undefined || val === null) return false;
    if (typeof val === 'string') return val.trim().length > 0;
    if (Array.isArray(val)) return val.length > 0;
    return true;
}

export class ImageInfoModal implements Disposable {
    private isOpenState = false;
    private backdropEl?: HTMLElement;
    private allocatedFallbackUrls: string[] = [];

    /**
     * 打开并呈现图像元数据检视弹窗。
     *
     * @param optionsOrMetadata 弹窗选项或元数据对象
     */
    public open(
        optionsOrMetadata?: ImageInfoModalOpenOptions | ImageGenerationMetadata | Record<string, unknown>
    ): void {
        let options: ImageInfoModalOpenOptions = {};
        if (optionsOrMetadata) {
            if (
                'metadata' in optionsOrMetadata ||
                'imageUrl' in optionsOrMetadata ||
                'record' in optionsOrMetadata ||
                'onEdit' in optionsOrMetadata ||
                'onDelete' in optionsOrMetadata
            ) {
                options = optionsOrMetadata as ImageInfoModalOpenOptions;
            } else {
                options = { metadata: optionsOrMetadata as ImageGenerationMetadata };
            }
        }

        if (typeof document === 'undefined' || !document.body) {
            this.isOpenState = true;
            return;
        }

        this.close();

        const metadata = (options.metadata || options.record?.metadata || {}) as Record<string, unknown>;
        const imageUrl = options.imageUrl || options.record?.remotePath;
        const record = options.record;

        // 1. 构建弹窗遮罩容器（居中弹性外层）
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root da-inspect-backdrop';

        // 2. 构建弹窗外壳 (.da-inspect-modal)
        const modal = document.createElement('div');
        modal.className = 'da-inspect-modal';

        // 3. 构建顶栏 (.da-inspect-header)
        const header = document.createElement('div');
        header.className = 'da-inspect-header';

        const headerLeft = document.createElement('div');
        headerLeft.className = 'da-inspect-header__left';

        const titleEl = document.createElement('h3');
        titleEl.className = 'da-inspect-title';
        titleEl.textContent = '生图信息与参数';
        headerLeft.appendChild(titleEl);

        const rawEngine = metadata.engine as string | undefined;
        const engineLabel = formatEngineDisplay(rawEngine) || 'Standard';
        const badgeEl = document.createElement('span');
        badgeEl.className = 'da-inspect-badge';
        badgeEl.textContent = engineLabel;
        headerLeft.appendChild(badgeEl);

        if (metadata.mode === 'inpaint') {
            const modeBadge = document.createElement('span');
            modeBadge.className = 'da-inspect-badge da-inspect-badge--accent';
            modeBadge.textContent = '局部重绘';
            headerLeft.appendChild(modeBadge);
        }
        header.appendChild(headerLeft);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-modal-close-btn';
        closeBtn.innerHTML = renderIcon('close', 16);
        closeBtn.title = '关闭 (Esc)';
        closeBtn.setAttribute('aria-label', '关闭生图信息弹窗');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // 4. 构建主体双列网格 (.da-inspect-body)
        const body = document.createElement('div');
        body.className = 'da-inspect-body';

        // 左栏：提示词与分组可复用参数 (.da-inspect-col-meta)
        const colMeta = document.createElement('div');
        colMeta.className = 'da-inspect-col-meta';

        // 1. 正向提示词卡片
        const promptText = String(metadata.prompt || '');
        colMeta.appendChild(this.createPromptCard('正向提示词 (Prompt)', promptText, false));

        // 2. 负向提示词卡片 (若存在)
        const negativeText = String(metadata.negativePrompt || '');
        if (negativeText) {
            colMeta.appendChild(this.createPromptCard('负向提示词 (Negative Prompt)', negativeText, true));
        }

        // 3. 分组可复用生成参数卡片
        const sections = this.buildParamSections(metadata, record);
        for (const section of sections) {
            colMeta.appendChild(this.createParamSectionCard(section));
        }
        body.appendChild(colMeta);

        // 右栏：图像预览与操作工具箱 (.da-inspect-col-visual)
        const colVisual = document.createElement('div');
        colVisual.className = 'da-inspect-col-visual';

        const imageId = record?.imageId ?? (typeof metadata.imageId === 'string' ? metadata.imageId : undefined);
        let activeImageUrl = imageUrl || '';

        // 1. 图像预览
        if (activeImageUrl || imageId) {
            const previewBox = document.createElement('div');
            previewBox.className = 'da-inspect-preview-box';
            previewBox.title = options.onPreview ? '点击放大预览原图' : '点击在新标签页打开原图';

            const imgEl = document.createElement('img');
            imgEl.className = 'da-inspect-preview-img';
            imgEl.alt = '图像预览';

            let fallbackTried = false;
            imgEl.addEventListener('error', async () => {
                if (!this.isOpenState || fallbackTried || !imageId) {
                    return;
                }
                fallbackTried = true;
                try {
                    const blob = await imageStorage.getImageBlob(imageId);
                    if (!this.isOpenState || !blob || blob.size === 0) {
                        return;
                    }
                    const fallbackUrl = URL.createObjectURL(blob);
                    this.allocatedFallbackUrls.push(fallbackUrl);
                    activeImageUrl = fallbackUrl;
                    imgEl.src = fallbackUrl;
                } catch (err) {
                    logger.warn(`[ImageInfoModal] 本地 Blob 回退载入失败 (imageId: ${imageId})`, err);
                }
            });
            imgEl.src = activeImageUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            previewBox.appendChild(imgEl);

            const zoomBadge = document.createElement('div');
            zoomBadge.className = 'da-inspect-zoom-badge';
            zoomBadge.textContent = options.onPreview ? '放大预览' : '打开原图';
            previewBox.appendChild(zoomBadge);

            previewBox.addEventListener('click', () => {
                if (!activeImageUrl) return;
                if (options.onPreview) {
                    const previewCallback = options.onPreview;
                    this.close();
                    previewCallback(activeImageUrl);
                    return;
                }
                window.open(activeImageUrl, '_blank');
            });
            colVisual.appendChild(previewBox);
        }

        // 2. 规格指标（文件信息与耗时，即使未传入 record 也能展示 durationMs）
        const specsBox = this.createSpecsCard(metadata, record);
        if (specsBox) {
            colVisual.appendChild(specsBox);
        }

        // 3. 操作工具卡片
        const actionsCard = document.createElement('div');
        actionsCard.className = 'da-inspect-actions-card';

        if (options.onEdit) {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'da-btn da-btn--primary da-btn--sm';
            editBtn.textContent = '编辑与重新生成';
            editBtn.addEventListener('click', () => {
                const editCallback = options.onEdit;
                this.close();
                editCallback?.();
            });
            actionsCard.appendChild(editBtn);
        }

        if (activeImageUrl || imageId) {
            const downloadBtn = document.createElement('button');
            downloadBtn.type = 'button';
            downloadBtn.className = 'da-btn da-btn--secondary da-btn--sm';
            downloadBtn.textContent = '下载图片';
            downloadBtn.addEventListener('click', () => {
                void this.downloadImage(activeImageUrl, imageId);
            });
            actionsCard.appendChild(downloadBtn);
        }

        const copyJsonBtn = document.createElement('button');
        copyJsonBtn.type = 'button';
        copyJsonBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        copyJsonBtn.textContent = '复制可复用参数 JSON';
        copyJsonBtn.addEventListener('click', () => {
            const reusablePayload = this.buildReusableMetadataPayload(metadata);
            const jsonPayload = JSON.stringify(reusablePayload, null, 2);
            void this.copyText(jsonPayload, '已复制可复用参数 JSON');
        });
        actionsCard.appendChild(copyJsonBtn);

        if (options.onDelete) {
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'da-btn da-btn--danger da-btn--sm';
            deleteBtn.textContent = '删除此记录';
            deleteBtn.addEventListener('click', () => {
                const deleteCallback = options.onDelete;
                this.close();
                deleteCallback?.();
            });
            actionsCard.appendChild(deleteBtn);
        }

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        dismissBtn.textContent = '关闭';
        dismissBtn.addEventListener('click', () => {
            this.close();
        });
        actionsCard.appendChild(dismissBtn);

        colVisual.appendChild(actionsCard);
        body.appendChild(colVisual);

        modal.appendChild(body);
        backdrop.appendChild(modal);

        // 点击遮罩空白处关闭
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                this.close();
            }
        });

        document.body.appendChild(backdrop);
        this.backdropEl = backdrop;
        this.isOpenState = true;
        overlayStack.push('image-info-modal', () => this.close());
    }

    /**
     * 将生成参数筛选并组织为分组展示模型，自动剔除 rawPrompt 与内部追踪字段。
     */
    private buildParamSections(
        metadata: Record<string, unknown>,
        record?: StoredImageRecord
    ): ParamSection[] {
        const pushIfPresent = (
            list: ParamEntry[],
            label: string,
            rawVal: unknown,
            opts?: { display?: string; copyValue?: string; wide?: boolean }
        ): void => {
            if (!hasDisplayValue(rawVal)) return;
            const text = opts?.display ?? String(rawVal);
            list.push({
                label,
                value: text,
                copyValue: opts?.copyValue ?? text,
                wide: opts?.wide,
            });
        };

        // 1. 核心生成参数（采样与画幅）
        const coreEntries: ParamEntry[] = [];
        const rawEngine = metadata.engine as string | undefined;
        pushIfPresent(coreEntries, '服务引擎', rawEngine, {
            display: formatEngineDisplay(rawEngine),
            copyValue: rawEngine,
        });
        if (metadata.mode === 'inpaint' || metadata.mode === 'txt2img') {
            pushIfPresent(coreEntries, '生成模式', metadata.mode, {
                display: metadata.mode === 'inpaint' ? '局部重绘' : '文生图',
                copyValue: String(metadata.mode),
            });
        }
        const widthVal = metadata.width ?? record?.width;
        const heightVal = metadata.height ?? record?.height;
        if (hasDisplayValue(widthVal) && hasDisplayValue(heightVal)) {
            coreEntries.push({
                label: '输出分辨率',
                value: `${widthVal} × ${heightVal}`,
            });
        }
        pushIfPresent(coreEntries, '采样算法', metadata.sampler);
        pushIfPresent(coreEntries, '调度器', metadata.scheduler);
        pushIfPresent(coreEntries, '采样步数', metadata.steps);
        pushIfPresent(coreEntries, 'CFG Scale', metadata.cfgScale);
        pushIfPresent(coreEntries, '随机种子', metadata.seed);

        // 2. 模型与工作流
        const modelEntries: ParamEntry[] = [];
        const baseModel = metadata.baseModel as string | undefined;
        pushIfPresent(modelEntries, '主模型', baseModel, { wide: Boolean(baseModel && baseModel.length > 36) });
        pushIfPresent(modelEntries, 'CLIP 模型', metadata.clipName);
        pushIfPresent(modelEntries, 'VAE 模型', metadata.vaeName);
        pushIfPresent(modelEntries, 'CLIP 跳过层', metadata.clipSkip);
        if (Array.isArray(metadata.extraModels) && metadata.extraModels.length > 0) {
            const joined = metadata.extraModels.map((m) => String(m)).filter(Boolean).join(', ');
            pushIfPresent(modelEntries, '附加模型', joined, { wide: true });
        }
        pushIfPresent(modelEntries, '工作流模板', metadata.workflowId);

        // 3. 重绘与引擎扩展参数
        const extEntries: ParamEntry[] = [];
        pushIfPresent(extEntries, '重绘幅度', metadata.denoiseStrength);
        if (hasDisplayValue(metadata.maskBlur)) {
            pushIfPresent(extEntries, '蒙版羽化', metadata.maskBlur, {
                display: `${metadata.maskBlur} px`,
                copyValue: String(metadata.maskBlur),
            });
        }
        if (metadata.enableHires === true) {
            extEntries.push({ label: '高清修复', value: '开启', copyValue: 'true' });
        }
        pushIfPresent(extEntries, '放大算法', metadata.hiresUpscaler);
        if (hasDisplayValue(metadata.hiresScale)) {
            pushIfPresent(extEntries, '放大倍率', metadata.hiresScale, {
                display: `${metadata.hiresScale}x`,
                copyValue: String(metadata.hiresScale),
            });
        }
        pushIfPresent(extEntries, '高修步数', metadata.hiresSteps);
        pushIfPresent(extEntries, '高修重绘幅度', metadata.hiresDenoise);
        pushIfPresent(extEntries, 'CFG 重缩放', metadata.cfgRescale);
        if (hasDisplayValue(metadata.smeaMode)) {
            const rawSmea = String(metadata.smeaMode);
            pushIfPresent(extEntries, 'SMEA 模式', rawSmea, {
                display: formatSmeaDisplay(rawSmea),
                copyValue: rawSmea,
            });
        }
        if (metadata.decrisper === true) {
            extEntries.push({ label: '防过曝 (Decrisper)', value: '开启', copyValue: 'true' });
        }
        pushIfPresent(extEntries, '生成画质', metadata.quality);
        pushIfPresent(extEntries, '画面风格', metadata.style);

        // 附加未知的引擎自定义可复用字段（自动排除非复用及已归类字段）
        for (const [key, val] of Object.entries(metadata)) {
            if (KNOWN_REUSABLE_META_KEYS.has(key) || NON_REUSABLE_META_KEYS.has(key) || !hasDisplayValue(val)) {
                continue;
            }
            const formatted =
                Array.isArray(val)
                    ? val.map((item) => String(item)).join(', ')
                    : typeof val === 'object'
                      ? JSON.stringify(val)
                      : String(val);
            if (!formatted) continue;
            extEntries.push({
                label: key,
                value: formatted,
                wide: formatted.length > 36,
            });
        }

        const sections: ParamSection[] = [];
        if (coreEntries.length > 0) sections.push({ title: '核心生成参数', entries: coreEntries });
        if (modelEntries.length > 0) sections.push({ title: '模型与工作流', entries: modelEntries });
        if (extEntries.length > 0) sections.push({ title: '重绘与引擎扩展参数', entries: extEntries });
        return sections;
    }

    /**
     * 创建分组生成参数卡片。
     */
    private createParamSectionCard(section: ParamSection): HTMLElement {
        const card = document.createElement('div');
        card.className = 'da-inspect-param-section';

        const header = document.createElement('div');
        header.className = 'da-inspect-section-header';
        header.textContent = section.title;
        card.appendChild(header);

        const matrix = document.createElement('div');
        matrix.className = 'da-inspect-params-matrix';

        for (const entry of section.entries) {
            const cell = document.createElement('div');
            cell.className = `da-inspect-param-cell${entry.wide ? ' da-inspect-param-cell--wide' : ''}`;

            const labelEl = document.createElement('span');
            labelEl.className = 'da-inspect-param-label';
            labelEl.textContent = entry.label;
            cell.appendChild(labelEl);

            const valEl = document.createElement('span');
            valEl.className = 'da-inspect-param-val is-copyable';
            valEl.textContent = entry.value;
            valEl.title = '点击复制此参数值';
            const copyTarget = entry.copyValue ?? entry.value;
            valEl.addEventListener('click', () => {
                void this.copyText(copyTarget, `已复制 ${entry.label}`);
            });
            cell.appendChild(valEl);

            matrix.appendChild(cell);
        }

        card.appendChild(matrix);
        return card;
    }

    /**
     * 创建右栏文件与耗时规格卡片。
     */
    private createSpecsCard(
        metadata: Record<string, unknown>,
        record?: StoredImageRecord
    ): HTMLElement | null {
        const items: Array<{ label: string; val: string }> = [];
        if (record) {
            items.push(
                { label: '文件体积', val: this.formatBytes(record.byteSize) },
                { label: '媒体类型', val: record.mimeType || 'image/png' }
            );
        }
        if (typeof metadata.durationMs === 'number') {
            items.push({ label: '生成耗时', val: `${(metadata.durationMs / 1000).toFixed(2)}s` });
        }
        if (record?.createdAt) {
            items.push({
                label: '生成时间',
                val: new Date(record.createdAt).toLocaleString(),
            });
        }
        if (items.length === 0) {
            return null;
        }

        const specsBox = document.createElement('div');
        specsBox.className = 'da-inspect-tech-specs';
        for (const item of items) {
            const itemEl = document.createElement('div');
            itemEl.className = 'da-inspect-tech-item';
            const labelSpan = document.createElement('span');
            labelSpan.className = 'da-inspect-tech-label';
            labelSpan.textContent = item.label;
            const valSpan = document.createElement('span');
            valSpan.className = 'da-inspect-tech-value';
            valSpan.textContent = item.val;
            itemEl.appendChild(labelSpan);
            itemEl.appendChild(valSpan);
            specsBox.appendChild(itemEl);
        }
        return specsBox;
    }

    /**
     * 过滤掉 rawPrompt 与内部追踪标识，生成可复制的纯净参数 JSON。
     */
    private buildReusableMetadataPayload(metadata: Record<string, unknown>): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(metadata)) {
            if (NON_REUSABLE_META_KEYS.has(key) || val === undefined) {
                continue;
            }
            result[key] = val;
        }
        return result;
    }

    /**
     * 创建提示词卡片 DOM 节点。
     */
    private createPromptCard(title: string, text: string, isNegative: boolean): HTMLElement {
        const box = document.createElement('div');
        box.className = `da-inspect-prompt-box${isNegative ? ' is-negative' : ''}`;

        const header = document.createElement('div');
        header.className = 'da-inspect-prompt-header';

        const titleEl = document.createElement('div');
        titleEl.className = 'da-inspect-prompt-title';
        titleEl.textContent = title;
        header.appendChild(titleEl);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'da-btn da-btn--secondary da-btn--sm da-inspect-copy-btn';
        copyBtn.textContent = '复制';
        copyBtn.addEventListener('click', () => {
            void this.copyText(text, `已复制 ${title}`);
        });
        header.appendChild(copyBtn);
        box.appendChild(header);

        const textEl = document.createElement('div');
        textEl.className = 'da-inspect-prompt-text';
        textEl.textContent = text || '(无内容)';
        box.appendChild(textEl);

        return box;
    }

    /**
     * 下载原图到本地（优先从 IDB 读取原始 Blob，避免已释放的 blob: URL 下载失败）。
     */
    private async downloadImage(url: string, imageId?: string): Promise<void> {
        let tempObjectUrl: string | undefined;
        try {
            let downloadUrl = url;
            if (imageId) {
                const blob = await imageStorage.getImageBlob(imageId);
                if (blob && blob.size > 0) {
                    tempObjectUrl = URL.createObjectURL(blob);
                    downloadUrl = tempObjectUrl;
                }
            }
            if (!downloadUrl) {
                Toast.error('下载失败，未找到可用图像资源');
                return;
            }

            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `st_draw_${imageId || Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            Toast.success('已开始下载图片');
        } catch (err) {
            logger.error('下载图片异常:', err);
            Toast.error('下载失败，请检查图像资源');
        } finally {
            if (tempObjectUrl) {
                const revokeTarget = tempObjectUrl;
                setTimeout(() => URL.revokeObjectURL(revokeTarget), 1500);
            }
        }
    }

    /**
     * 复制文本到剪贴板。
     */
    private async copyText(content: string, successMessage: string): Promise<void> {
        const ok = await copyTextToClipboard(content);
        if (ok) {
            Toast.success(successMessage);
        } else {
            Toast.error('复制失败，请手动选择复制');
        }
    }

    /**
     * 格式化文件字节大小。
     */
    private formatBytes(bytes: number): string {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const val = (bytes / Math.pow(1024, i)).toFixed(1);
        return `${val} ${units[i] || 'B'}`;
    }

    /**
     * 关闭弹窗。
     */
    public close(): void {
        this.isOpenState = false;
        overlayStack.remove('image-info-modal');
        for (const fallbackUrl of this.allocatedFallbackUrls) {
            try {
                URL.revokeObjectURL(fallbackUrl);
            } catch {
                // 忽略回收异常
            }
        }
        this.allocatedFallbackUrls = [];
        if (this.backdropEl && this.backdropEl.parentNode) {
            this.backdropEl.parentNode.removeChild(this.backdropEl);
        }
        this.backdropEl = undefined;
    }

    public isOpen(): boolean {
        return this.isOpenState;
    }

    public dispose(): void {
        this.close();
    }
}

export const imageInfoModal = new ImageInfoModal();
