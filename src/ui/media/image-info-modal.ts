/**
 * 图像元数据查看弹窗 (ImageInfoModal)。
 *
 * @remarks
 * 呈现生图参数与元数据：
 * 支持提示词快速复制、生成参数表格查看及元数据 JSON 导出。
 */

import type { Disposable } from '../types';
import type { ImageGenerationMetadata, StoredImageRecord } from '@types';
import { Toast } from '../feedback/toast';

export interface ImageInfoModalOpenOptions {
    /** 图像技术元数据对象 */
    metadata?: ImageGenerationMetadata | Record<string, unknown>;
    /** 可选的图像预览地址 (URL 或 DataURL) */
    imageUrl?: string;
    /** 可选的资产记录完整上下文 */
    record?: StoredImageRecord;
}

export class ImageInfoModal implements Disposable {
    private isOpenState = false;
    private backdropEl?: HTMLElement;
    private keydownListener?: (e: KeyboardEvent) => void;

    /**
     * 打开并呈现图像元数据检视弹窗。
     *
     * @param optionsOrMetadata 检视入参或元数据对象
     */
    public open(
        optionsOrMetadata?: ImageInfoModalOpenOptions | ImageGenerationMetadata | Record<string, unknown>
    ): void {
        let options: ImageInfoModalOpenOptions = {};
        if (optionsOrMetadata) {
            if ('metadata' in optionsOrMetadata || 'imageUrl' in optionsOrMetadata || 'record' in optionsOrMetadata) {
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

        const metadata = options.metadata || options.record?.metadata || {};
        const imageUrl = options.imageUrl || options.record?.remotePath;
        const record = options.record;

        // 1. 构建全屏遮罩容器
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-overlay';
        backdrop.style.position = 'fixed';
        backdrop.style.inset = '0';
        backdrop.style.zIndex = '10050';
        backdrop.style.background = 'rgba(0, 0, 0, 0.65)';
        backdrop.style.backdropFilter = 'blur(4px)';
        backdrop.style.display = 'flex';
        backdrop.style.alignItems = 'center';
        backdrop.style.justifyContent = 'center';
        backdrop.style.padding = '20px';

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
        titleEl.innerHTML = '<span>ℹ️</span><span>图像生成元数据</span>';
        headerLeft.appendChild(titleEl);

        const engineName = String(metadata.engine || record?.taskId || 'Standard');
        const badgeEl = document.createElement('span');
        badgeEl.className = 'da-inspect-badge';
        badgeEl.textContent = engineName;
        headerLeft.appendChild(badgeEl);
        header.appendChild(headerLeft);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        closeBtn.style.minWidth = '32px';
        closeBtn.style.padding = '4px 8px';
        closeBtn.textContent = '✕';
        closeBtn.title = '关闭 (ESC)';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // 4. 构建主体双列网格 (.da-inspect-body)
        const body = document.createElement('div');
        body.className = 'da-inspect-body';

        // === 左栏：提示词与生成参数 (.da-inspect-col-meta) ===
        const colMeta = document.createElement('div');
        colMeta.className = 'da-inspect-col-meta';

        // (1) 正向提示词卡片
        const promptText = String(metadata.prompt || '');
        const promptBox = this.createPromptCard('正向提示词 (Prompt)', promptText, false);
        colMeta.appendChild(promptBox);

        // (2) 负向提示词卡片 (若存在)
        const negativeText = String(metadata.negativePrompt || '');
        if (negativeText) {
            const negBox = this.createPromptCard('负向提示词 (Negative Prompt)', negativeText, true);
            colMeta.appendChild(negBox);
        }

        // (3) 生成参数表格 (.da-inspect-params-matrix)
        const paramsMatrix = document.createElement('div');
        paramsMatrix.className = 'da-inspect-params-matrix';

        const paramEntries: Array<{ label: string; value: string | number | undefined }> = [
            { label: '模型文件', value: (metadata.baseModel as string) || (metadata.modelName as string) },
            { label: '工作流模板', value: metadata.workflowId as string | undefined },
            { label: '采样器', value: metadata.sampler as string },
            { label: '采样步数', value: metadata.steps as number },
            { label: 'CFG Scale', value: metadata.cfgScale as number },
            { label: '随机种子', value: metadata.seed as number },
            {
                label: '输出分辨率',
                value: metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : undefined,
            },
        ];

        for (const entry of paramEntries) {
            if (entry.value !== undefined && entry.value !== '') {
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
        colMeta.appendChild(paramsMatrix);
        body.appendChild(colMeta);

        // === 右栏：图像预览与快捷工具箱 (.da-inspect-col-visual) ===
        const colVisual = document.createElement('div');
        colVisual.className = 'da-inspect-col-visual';

        // (1) 图像预览
        if (imageUrl) {
            const previewBox = document.createElement('div');
            previewBox.className = 'da-inspect-preview-box';
            previewBox.title = '在新标签页打开原图';

            const imgEl = document.createElement('img');
            imgEl.className = 'da-inspect-preview-img';
            imgEl.src = imageUrl;
            imgEl.alt = '图像预览';
            previewBox.appendChild(imgEl);

            const zoomBadge = document.createElement('div');
            zoomBadge.className = 'da-inspect-zoom-badge';
            zoomBadge.textContent = '🔍 原图预览';
            previewBox.appendChild(zoomBadge);

            previewBox.addEventListener('click', () => {
                window.open(imageUrl, '_blank');
            });
            colVisual.appendChild(previewBox);
        }

        // (2) 规格指标
        if (record) {
            const specsBox = document.createElement('div');
            specsBox.className = 'da-inspect-tech-specs';

            const items: Array<{ label: string; val: string }> = [
                { label: '文件体积', val: this.formatBytes(record.byteSize) },
                { label: '媒体类型', val: record.mimeType },
            ];
            if (typeof metadata.durationMs === 'number') {
                items.push({ label: '生成耗时', val: `${(metadata.durationMs / 1000).toFixed(2)}s` });
            }

            for (const item of items) {
                const itemEl = document.createElement('div');
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

        // (3) 操作工具卡片
        const actionsCard = document.createElement('div');
        actionsCard.className = 'da-inspect-actions-card';

        const copyJsonBtn = document.createElement('button');
        copyJsonBtn.type = 'button';
        copyJsonBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        copyJsonBtn.textContent = '📋 复制元数据 JSON';
        copyJsonBtn.addEventListener('click', () => {
            const jsonPayload = JSON.stringify(metadata, null, 2);
            void this.copyText(jsonPayload, '已复制元数据 JSON');
        });
        actionsCard.appendChild(copyJsonBtn);

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

        // 监听 ESC 键关闭
        this.keydownListener = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.close();
            }
        };
        window.addEventListener('keydown', this.keydownListener);
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
        const iconSpan = document.createElement('span');
        iconSpan.textContent = isNegative ? '🚫' : '✨';
        const textSpan = document.createElement('span');
        textSpan.textContent = title;
        titleEl.appendChild(iconSpan);
        titleEl.appendChild(textSpan);
        header.appendChild(titleEl);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        copyBtn.style.padding = '2px 8px';
        copyBtn.style.fontSize = '11px';
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
        if (this.keydownListener) {
            window.removeEventListener('keydown', this.keydownListener);
            this.keydownListener = undefined;
        }
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
