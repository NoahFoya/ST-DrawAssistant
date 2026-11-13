/**
 * 楼层图像操作与编辑面板 (ImageActionPanel)。
 *
 * @remarks
 * 负责楼层图片的提示词编辑与重新生成：
 * 1. 唤出方式：桌面端右键图片 (`contextmenu`)、移动端长按图片 (`touchstart` 500ms)，或从元信息/灯箱的“操作”按钮进入；
 * 2. 提示词在线编辑：展示当前图像的正向/负向提示词，支持编辑与一键复制；
 * 3. 重新生成：点击“重新生成”基于修改后的提示词重新生成当前楼层图片；
 * 4. 辅助功能：底部提供查看完整元信息、局部重绘与下载图片入口。
 */

import type { Disposable } from '../types';
import type { StoredImageRecord } from '@types';
import { renderIcon } from '../components/icons';
import { overlayStack } from '../framework/overlay-stack';
import { Toast } from '../feedback/toast';
import { imageInfoModal } from './image-info-modal';
import { openInpaintModal, type InpaintConfirmResult } from './inpaint-modal';
import { attachTagAutocomplete, type TagAutocomplete } from '../composite/tag-autocomplete';
import { resolvePromptMacros } from '../../pipeline/macro-resolver';
import { settingsStore } from '../../store/settings-store';
import { logger } from '../../util/logger';

/** 图像操作弹窗上下文数据 */
export interface ImageActionContext {
    /** 宿主消息楼层序号 */
    readonly messageId: number;
    /** 指令序号 (默认 0) */
    readonly instructionIndex: number;
    /** 图像全局唯一标识符 */
    readonly imageId?: string;
    /** 图像展示地址 (Blob URL / 远程静态相对路径) */
    readonly imageUrl?: string;
    /** 初始正向提示词 */
    readonly prompt: string;
    /** 初始负向提示词 */
    readonly negativePrompt?: string;
    /** 完整的图像资产持久化记录快照 */
    readonly record?: StoredImageRecord;
    /** 触发整图重新生成回调 */
    readonly onRegenerate?: (newPrompt: string, newNegativePrompt?: string) => Promise<void> | void;
    /** 触发局部重绘 Inpaint 回调 */
    readonly onInpaint?: (data: InpaintConfirmResult) => Promise<void> | void;
}

/**
 * 楼层图像编辑与操作面板类。
 */
export class ImageActionPanel implements Disposable {
    private isOpenState = false;
    private currentContext: ImageActionContext | null = null;

    // DOM 元素引用
    private backdropEl?: HTMLElement;
    private titleTextEl?: HTMLElement;
    private posTextarea?: HTMLTextAreaElement;
    private negTextarea?: HTMLTextAreaElement;
    private resetPosUndo?: () => void;
    private resetNegUndo?: () => void;
    private updatePosHighlight?: () => void;
    private updateNegHighlight?: () => void;
    private metaBadgeContainer?: HTMLElement;
    private readonly autocompletes: TagAutocomplete[] = [];

    // 全局事件解绑器列表
    private readonly disposers: (() => void)[] = [];

    public constructor() {
        this.initDom();
    }

    /**
     * 初始化 DOM 结构。
     */
    private initDom(): void {
        if (typeof document === 'undefined') {
            return;
        }

        // 1. 全屏遮罩外壳
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop st-da-root da-action-panel-backdrop';
        backdrop.style.display = 'none';

        // 2. 居中面板
        const panel = document.createElement('div');
        panel.className = 'da-modal-shell da-action-panel';

        // 3. Header 顶栏
        const header = document.createElement('div');
        header.className = 'da-action-panel__header';

        const title = document.createElement('div');
        title.className = 'da-action-panel__title';

        const titleText = document.createElement('span');
        titleText.textContent = '图像编辑';
        title.appendChild(titleText);
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-modal-close-btn da-action-panel__close';
        closeBtn.setAttribute('aria-label', '关闭图像编辑面板');
        closeBtn.innerHTML = renderIcon('close', 16);
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
        header.appendChild(closeBtn);

        panel.appendChild(header);

        // 4. Body 提示词与参数区域
        const body = document.createElement('div');
        body.className = 'da-action-panel__body';

        // 正向提示词卡片
        const posSection = this.createPromptSection('正向提示词 (Prompt)', '输入正向描述提示词...');
        this.posTextarea = posSection.textarea;
        this.resetPosUndo = posSection.resetUndo;
        this.updatePosHighlight = posSection.updateHighlight;
        const posAc = attachTagAutocomplete(this.posTextarea, { mode: 'prompt-with-macro' });
        this.autocompletes.push(posAc);
        this.disposers.push(() => posAc.dispose());
        body.appendChild(posSection.container);

        // 负向提示词卡片
        const negSection = this.createPromptSection('负向提示词 (Negative Prompt)', '输入负向过滤提示词...');
        this.negTextarea = negSection.textarea;
        this.resetNegUndo = negSection.resetUndo;
        this.updateNegHighlight = negSection.updateHighlight;
        const negAc = attachTagAutocomplete(this.negTextarea, { mode: 'prompt-with-macro' });
        this.autocompletes.push(negAc);
        this.disposers.push(() => negAc.dispose());
        body.appendChild(negSection.container);

        // 技术参数摘要胶囊栏
        const metaBadgeContainer = document.createElement('div');
        metaBadgeContainer.className = 'da-action-panel__meta-badges';
        body.appendChild(metaBadgeContainer);
        this.metaBadgeContainer = metaBadgeContainer;

        panel.appendChild(body);

        // 5. Footer 底部操作按钮行
        const footer = document.createElement('div');
        footer.className = 'da-action-panel__footer';

        const footerLeft = document.createElement('div');
        footerLeft.className = 'da-action-panel__footer-left';

        // 详细元信息按钮
        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        infoBtn.title = '查看完整生成参数与技术元信息';
        infoBtn.textContent = '元信息';
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleViewMetadata();
        });
        footerLeft.appendChild(infoBtn);

        // 下载原图按钮
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        downloadBtn.title = '下载原图至本地';
        downloadBtn.textContent = '下载';
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleDownload();
        });
        footerLeft.appendChild(downloadBtn);

        footer.appendChild(footerLeft);

        const footerRight = document.createElement('div');
        footerRight.className = 'da-action-panel__footer-right';

        // 取消按钮
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
        footerRight.appendChild(cancelBtn);

        // 局部重绘按钮
        const inpaintBtn = document.createElement('button');
        inpaintBtn.type = 'button';
        inpaintBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        inpaintBtn.title = '打开局部重绘画板涂抹修改本图局部细节';
        inpaintBtn.textContent = '局部重绘';
        inpaintBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleInpaint();
        });
        footerRight.appendChild(inpaintBtn);

        // 重新生成按钮 (Primary)
        const regenBtn = document.createElement('button');
        regenBtn.type = 'button';
        regenBtn.className = 'da-btn da-btn--primary da-btn--sm';
        regenBtn.title = '重新生成本图';
        regenBtn.textContent = '重新生成';
        regenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleRegenerate();
        });
        footerRight.appendChild(regenBtn);

        footer.appendChild(footerRight);
        panel.appendChild(footer);

        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);

        // 保存引用
        this.backdropEl = backdrop;
        this.titleTextEl = titleText;

        // 遮罩点击退出
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                this.close();
            }
        });
    }

    /**
     * 构建提示词编辑卡片块（双层镜像宏高亮）。
     */
    private createPromptSection(label: string, placeholder: string): {
        container: HTMLElement;
        textarea: HTMLTextAreaElement;
        resetUndo: () => void;
        updateHighlight: () => void;
    } {
        const container = document.createElement('div');
        container.className = 'da-action-panel__field';

        const headerRow = document.createElement('div');
        headerRow.className = 'da-action-panel__field-header';

        const labelEl = document.createElement('span');
        labelEl.className = 'da-action-panel__label';
        labelEl.textContent = label;
        headerRow.appendChild(labelEl);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'da-action-panel__field-actions';

        // 1. 双层镜像编辑器容器与结构
        const editorContainer = document.createElement('div');
        editorContainer.className = 'da-highlight-editor';

        const backdrop = document.createElement('div');
        backdrop.className = 'da-highlight-editor__backdrop';

        const highlights = document.createElement('div');
        highlights.className = 'da-highlight-editor__highlights';
        backdrop.appendChild(highlights);

        const textarea = document.createElement('textarea');
        textarea.className = 'da-textarea da-action-panel__textarea da-highlight-editor__textarea';
        textarea.placeholder = placeholder;
        textarea.rows = 3;

        editorContainer.appendChild(backdrop);
        editorContainer.appendChild(textarea);

        let undoSnapshot: string | null = null;
        let isProgrammaticChange = false;

        const escapeHtml = (str: string): string => {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const renderHighlightedText = (text: string): string => {
            if (!text) {
                return '';
            }
            const settings = settingsStore.getSettings();
            const res = resolvePromptMacros(text, settings);
            const resolvedSet = new Set(res.resolvedMacros.map((m) => m.toLowerCase()));

            // 按宏正则 /(\$[^\$\r\n]+\$)/g 分割，保留有效宏与无效宏标记
            const parts = text.split(/(\$[^\$\r\n]+\$)/g);
            let html = '';
            for (const part of parts) {
                if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
                    const rawToken = part.slice(1, -1).trim().toLowerCase();
                    const escaped = escapeHtml(part);
                    if (resolvedSet.has(rawToken)) {
                        html += `<span class="da-macro--valid">${escaped}</span>`;
                    } else {
                        html += `<span class="da-macro--invalid">${escaped}</span>`;
                    }
                } else {
                    html += escapeHtml(part);
                }
            }

            if (text.endsWith('\n')) {
                html += '\n';
            }
            return html;
        };

        const syncScrollbarCompensation = (): void => {
            const scrollbarWidth = textarea.offsetWidth - textarea.clientWidth;
            if (scrollbarWidth > 0) {
                highlights.style.paddingRight = `calc(var(--da-space-md, 12px) + ${scrollbarWidth}px)`;
            } else {
                highlights.style.paddingRight = 'var(--da-space-md, 12px)';
            }
        };

        const updateHighlight = (): void => {
            highlights.innerHTML = renderHighlightedText(textarea.value);
            backdrop.scrollTop = textarea.scrollTop;
            backdrop.scrollLeft = textarea.scrollLeft;
            syncScrollbarCompensation();
        };

        let isComposing = false;
        textarea.addEventListener('compositionstart', () => {
            isComposing = true;
        });
        textarea.addEventListener('compositionend', () => {
            isComposing = false;
            updateHighlight();
        });

        // 监听输入与滚动，保持底层渲染与光标位置严格对齐
        textarea.addEventListener('input', () => {
            if (!isComposing) {
                updateHighlight();
            }
        });
        textarea.addEventListener('scroll', () => {
            backdrop.scrollTop = textarea.scrollTop;
            backdrop.scrollLeft = textarea.scrollLeft;
        });

        // 监听尺寸拖拽拉伸与视口变化，像素级同步 backdrop 尺寸与滚动条补偿
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => {
                backdrop.style.height = `${textarea.offsetHeight}px`;
                syncScrollbarCompensation();
            });
            ro.observe(textarea);
            this.disposers.push(() => ro.disconnect());
        }

        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'da-action-panel__copy-btn da-action-panel__expand-btn';
        expandBtn.textContent = '展开宏';
        expandBtn.title = '将文本中的 $素材宏$ 展开替换为具体标签';

        const resetUndo = (): void => {
            undoSnapshot = null;
            expandBtn.textContent = '展开宏';
            expandBtn.title = '将文本中的 $素材宏$ 展开替换为具体标签';
        };

        expandBtn.addEventListener('click', () => {
            if (undoSnapshot !== null) {
                // 处于撤销状态：还原快照
                isProgrammaticChange = true;
                textarea.value = undoSnapshot;
                resetUndo();
                updateHighlight();
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true }));
                isProgrammaticChange = false;
                Toast.info('已撤销宏展开');
                return;
            }

            const currentVal = textarea.value;
            if (!currentVal || !currentVal.includes('$')) {
                Toast.info('未检测到 $素材宏$');
                return;
            }

            const settings = settingsStore.getSettings();
            const res = resolvePromptMacros(currentVal, settings);

            if (res.resolvedMacros.length === 0) {
                if (res.unresolvedMacros.length > 0) {
                    Toast.warning(
                        `未定义宏: ${res.unresolvedMacros.map((m) => `$${m}$`).join(', ')}`
                    );
                } else {
                    Toast.info('未检测到可展开的素材宏');
                }
                return;
            }

            undoSnapshot = currentVal;
            isProgrammaticChange = true;
            textarea.value = res.text;
            expandBtn.textContent = '撤销展开';
            expandBtn.title = '还原为展开前的 $素材宏$ 原文';

            updateHighlight();
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            isProgrammaticChange = false;

            Toast.success(`已将 ${res.resolvedMacros.length} 个素材宏展开为提示词标签`);
            if (res.unresolvedMacros.length > 0) {
                Toast.warning(
                    `注意: ${res.unresolvedMacros.map((m) => `$${m}$`).join(', ')} 未定义并已清空`
                );
            }
        });

        // 用户主动修改文本框内容时复位撤销状态
        textarea.addEventListener('input', () => {
            if (isProgrammaticChange) {
                return;
            }
            if (undoSnapshot !== null && textarea.value !== undoSnapshot) {
                resetUndo();
            }
        });

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'da-action-panel__copy-btn';
        copyBtn.textContent = '复制';
        copyBtn.addEventListener('click', () => {
            const val = textarea.value.trim();
            if (!val) {
                Toast.info('提示词为空');
                return;
            }
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                navigator.clipboard
                    .writeText(val)
                    .then(() => {
                        Toast.success('已复制到剪贴板');
                    })
                    .catch(() => {
                        Toast.warning('复制失败，请手动选中文本');
                    });
            }
        });

        actionsEl.appendChild(expandBtn);
        actionsEl.appendChild(copyBtn);
        headerRow.appendChild(actionsEl);
        container.appendChild(headerRow);
        container.appendChild(editorContainer);

        return { container, textarea, resetUndo, updateHighlight };
    }

    /**
     * 打开楼层图像编辑操作面板。
     *
     * @param context 操作上下文
     */
    public open(context: ImageActionContext): void {
        this.currentContext = context;
        this.isOpenState = true;
        overlayStack.push('image-action-panel', () => this.close());
        this.resetPosUndo?.();
        this.resetNegUndo?.();
        for (const ac of this.autocompletes) {
            ac.closePopup();
        }

        if (this.titleTextEl) {
            this.titleTextEl.textContent = `图像编辑 (楼层 #${context.messageId})`;
        }

        if (this.posTextarea) {
            this.posTextarea.value = context.prompt || '';
            this.updatePosHighlight?.();
        }
        if (this.negTextarea) {
            this.negTextarea.value = context.negativePrompt || '';
            this.updateNegHighlight?.();
        }

        for (const ac of this.autocompletes) {
            ac.refreshMacroStatus();
        }

        this.renderMetaBadges(context.record);

        if (this.backdropEl) {
            if (!this.backdropEl.parentNode && typeof document !== 'undefined') {
                document.body.appendChild(this.backdropEl);
            }
            this.backdropEl.style.display = 'flex';
        }
    }

    /**
     * 渲染简明技术参数徽标。
     */
    private renderMetaBadges(record?: StoredImageRecord): void {
        if (!this.metaBadgeContainer) return;
        this.metaBadgeContainer.innerHTML = '';

        if (!record?.metadata) {
            return;
        }

        const meta = record.metadata;
        const badges: string[] = [];

        if (meta.engine) {
            badges.push(`引擎: ${meta.engine}`);
        }
        if (record.width && record.height) {
            badges.push(`尺寸: ${record.width}×${record.height}`);
        }
        if (meta.steps) {
            badges.push(`步数: ${meta.steps}`);
        }
        if (meta.cfgScale) {
            badges.push(`CFG: ${meta.cfgScale}`);
        }
        if (meta.seed !== undefined) {
            badges.push(`Seed: ${meta.seed}`);
        }
        if (meta.sampler) {
            badges.push(`采样: ${meta.sampler}`);
        }

        for (const text of badges) {
            const span = document.createElement('span');
            span.className = 'da-action-panel__meta-chip';
            span.textContent = text;
            this.metaBadgeContainer.appendChild(span);
        }
    }

    /**
     * 触发重新生成并关闭面板。
     */
    private handleRegenerate(): void {
        if (!this.currentContext) return;

        const newPrompt = this.posTextarea?.value.trim() ?? '';
        const newNegativePrompt = this.negTextarea?.value.trim() ?? '';

        if (!newPrompt) {
            Toast.warning('正向提示词不能为空');
            return;
        }

        const onRegen = this.currentContext.onRegenerate;
        this.close();
        if (onRegen) {
            void onRegen(newPrompt, newNegativePrompt);
        }
    }

    /**
     * 触发局部重绘 Inpaint 画板。
     */
    private handleInpaint(): void {
        if (!this.currentContext) return;

        if (!this.currentContext.imageUrl) {
            Toast.warning('当前图片未就绪，无法打开局部重绘画板');
            return;
        }

        const ctx = this.currentContext;
        const initialPrompt = this.posTextarea?.value.trim() || ctx.prompt || '';
        const initialNegPrompt = this.negTextarea?.value.trim() || ctx.negativePrompt || '';

        this.close();

        openInpaintModal({
            imageSrc: ctx.imageUrl!,
            initialPrompt,
            initialNegativePrompt: initialNegPrompt,
            onConfirm: async (data) => {
                if (typeof ctx.onInpaint === 'function') {
                    await ctx.onInpaint(data);
                } else if (typeof ctx.onRegenerate === 'function') {
                    await ctx.onRegenerate(data.prompt, data.negativePrompt);
                }
            },
        });
    }

    /**
     * 触发查看详细元信息。
     */
    private handleViewMetadata(): void {
        if (!this.currentContext) return;
        const ctx = this.currentContext;
        imageInfoModal.open({
            record: ctx.record,
            metadata: ctx.record?.metadata,
            imageUrl: ctx.imageUrl,
        });
    }

    /**
     * 触发下载图像文件。
     */
    private handleDownload(): void {
        const url = this.currentContext?.imageUrl;
        if (!url) return;
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = `st_draw_${this.currentContext?.imageId || Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            Toast.success('已开始下载图像');
        } catch (err) {
            logger.error('下载图像异常:', err);
            Toast.error('下载失败，请检查网络或资源');
        }
    }

    /**
     * 关闭面板。
     */
    public close(): void {
        this.isOpenState = false;
        overlayStack.remove('image-action-panel');
        this.resetPosUndo?.();
        this.resetNegUndo?.();
        for (const ac of this.autocompletes) {
            ac.closePopup();
        }
        if (this.backdropEl) {
            this.backdropEl.style.display = 'none';
        }
        this.currentContext = null;
    }

    /**
     * 查询是否正处于打开展示状态。
     */
    public isOpen(): boolean {
        return this.isOpenState;
    }

    /**
     * 释放所有资源与 DOM。
     */
    public dispose(): void {
        this.close();
        for (const disposer of this.disposers) {
            try {
                disposer();
            } catch {
                // 忽略注销时的异常
            }
        }
        this.disposers.length = 0;

        if (this.backdropEl && this.backdropEl.parentNode) {
            this.backdropEl.parentNode.removeChild(this.backdropEl);
        }
        this.backdropEl = undefined;
    }
}

/** 全局默认单例楼层图像操作面板 */
export const imageActionPanel = new ImageActionPanel();
