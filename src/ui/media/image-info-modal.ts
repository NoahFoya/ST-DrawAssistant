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
    /** 可选的删除当前图像记录回调 */
    onDelete?: () => void;
}

export class ImageInfoModal implements Disposable {
    private isOpenState = false;
    private backdropEl?: HTMLElement;

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

        // 1. 构建全屏遮罩容器
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

        const engineName = String(metadata.engine || record?.taskId || 'Standard');
        const badgeEl = document.createElement('span');
        badgeEl.className = 'da-inspect-badge';
        badgeEl.textContent = engineName;
        headerLeft.appendChild(badgeEl);
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

        // 左栏：提示词与生成参数 (.da-inspect-col-meta)
        const colMeta = document.createElement('div');
        colMeta.className = 'da-inspect-col-meta';

        // 1. 正向提示词卡片
        const promptText = String(metadata.prompt || '');
        const promptBox = this.createPromptCard('正向提示词 (Prompt)', promptText, false);
        colMeta.appendChild(promptBox);

        // 2. 负向提示词卡片 (若存在)
        const negativeText = String(metadata.negativePrompt || '');
        if (negativeText) {
            const negBox = this.createPromptCard('负向提示词 (Negative Prompt)', negativeText, true);
            colMeta.appendChild(negBox);
        }

        // 3. 生成参数表格 (.da-inspect-params-matrix)
        const paramsMatrix = document.createElement('div');
        paramsMatrix.className = 'da-inspect-params-matrix';

        const widthVal = metadata.width ?? record?.width;
        const heightVal = metadata.height ?? record?.height;
        const paramEntries: Array<{ label: string; value: string | number | undefined }> = [
            { label: '服务引擎', value: metadata.engine as string | undefined },
            { label: '模型文件', value: (metadata.baseModel as string) || (metadata.modelName as string) },
            { label: '工作流模板', value: metadata.workflowId as string | undefined },
            { label: '采样算法', value: metadata.sampler as string | undefined },
            { label: '调度器', value: metadata.scheduler as string | undefined },
            { label: '采样步数', value: metadata.steps as number | undefined },
            { label: 'CFG Scale', value: metadata.cfgScale as number | undefined },
            { label: '随机种子', value: metadata.seed as number | undefined },
            {
                label: '输出分辨率',
                value: widthVal && heightVal ? `${widthVal} × ${heightVal}` : undefined,
            },
        ];

        let hasRenderedParam = false;
        for (const entry of paramEntries) {
            if (entry.value !== undefined && entry.value !== '') {
                hasRenderedParam = true;
                const cell = document.createElement('div');
                cell.className = 'da-inspect-param-cell';

                const labelEl = document.createElement('span');
                labelEl.className = 'da-inspect-param-label';
                labelEl.textContent = entry.label;
                cell.appendChild(labelEl);

                const valEl = document.createElement('span');
                valEl.className = 'da-inspect-param-val is-copyable';
                valEl.textContent = String(entry.value);
                valEl.title = '点击复制此参数值';
                valEl.addEventListener('click', () => {
                    void this.copyText(String(entry.value), `已复制 ${entry.label}`);
                });
                cell.appendChild(valEl);

                paramsMatrix.appendChild(cell);
            }
        }
        if (hasRenderedParam) {
            colMeta.appendChild(paramsMatrix);
        }
        body.appendChild(colMeta);

        // 右栏：图像预览与操作工具箱 (.da-inspect-col-visual)
        const colVisual = document.createElement('div');
        colVisual.className = 'da-inspect-col-visual';

        // 1. 图像预览
        if (imageUrl) {
            const previewBox = document.createElement('div');
            previewBox.className = 'da-inspect-preview-box';
            previewBox.title = '点击在新标签页打开原图';

            const imgEl = document.createElement('img');
            imgEl.className = 'da-inspect-preview-img';
            imgEl.src = imageUrl;
            imgEl.alt = '图像预览';
            previewBox.appendChild(imgEl);

            const zoomBadge = document.createElement('div');
            zoomBadge.className = 'da-inspect-zoom-badge';
            zoomBadge.textContent = '打开原图';
            previewBox.appendChild(zoomBadge);

            previewBox.addEventListener('click', () => {
                window.open(imageUrl, '_blank');
            });
            colVisual.appendChild(previewBox);
        }

        // 2. 规格指标
        if (record) {
            const specsBox = document.createElement('div');
            specsBox.className = 'da-inspect-tech-specs';

            const items: Array<{ label: string; val: string }> = [
                { label: '文件体积', val: this.formatBytes(record.byteSize) },
                { label: '媒体类型', val: record.mimeType || 'image/png' },
            ];
            if (typeof metadata.durationMs === 'number') {
                items.push({ label: '生成耗时', val: `${(metadata.durationMs / 1000).toFixed(2)}s` });
            }
            if (record.createdAt) {
                items.push({
                    label: '生成时间',
                    val: new Date(record.createdAt).toLocaleString(),
                });
            }

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

        if (imageUrl) {
            const downloadBtn = document.createElement('button');
            downloadBtn.type = 'button';
            downloadBtn.className = 'da-btn da-btn--secondary da-btn--sm';
            downloadBtn.textContent = '下载图片';
            downloadBtn.addEventListener('click', () => {
                this.downloadImage(imageUrl, record?.imageId);
            });
            actionsCard.appendChild(downloadBtn);
        }

        const copyJsonBtn = document.createElement('button');
        copyJsonBtn.type = 'button';
        copyJsonBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        copyJsonBtn.textContent = '复制元数据 JSON';
        copyJsonBtn.addEventListener('click', () => {
            const jsonPayload = JSON.stringify(metadata, null, 2);
            void this.copyText(jsonPayload, '已复制元数据 JSON');
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
     * 下载原图到本地。
     */
    private downloadImage(url: string, imageId?: string): void {
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = `st_draw_${imageId || Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            Toast.success('已开始下载图片');
        } catch (err) {
            logger.error('下载图片异常:', err);
            Toast.error('下载失败，请检查图像资源');
        }
    }

    /**
     * 复制文本到剪贴板。
     */
    private async copyText(content: string, successMessage: string): Promise<void> {
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(content);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = content;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            Toast.success(successMessage);
        } catch {
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
