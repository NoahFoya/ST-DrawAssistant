/**
 * 楼层图像操作面板 (ImageActionPanel)。
 *
 * @remarks
 * 负责楼层图片的快捷管理与交互操作：
 * 1. 提示词在线微调：展示当前图像的正向/反向提示词，支持自由编辑与一键复制；
 * 2. 原位重绘更新：点击“重新生成”基于微调后的新提示词触发原插槽图像重新生成；
 * 3. 详细元数据联动：一键调起详细技术元数据检视器；
 * 4. 原图下载与快捷退出：支持下载、Esc 与遮罩点击退出。
 */

import type { Disposable } from '../types';
import type { StoredImageRecord } from '@types';
import { Toast } from '../feedback/toast';
import { imageInfoModal } from './image-info-modal';
import { logger } from '../../util/logger';

/** 图像操作弹窗上下文数据 */
export interface ImageActionContext {
    /** 宿主消息楼层序号 */
    readonly messageId: number;
    /** 指令插槽索引 (默认 0) */
    readonly instructionIndex: number;
    /** 图像全局唯一标识符 */
    readonly imageId?: string;
    /** 图像展示地址 (Blob URL / 远程静态相对路径) */
    readonly imageUrl?: string;
    /** 初始正向提示词 */
    readonly prompt?: string;
    /** 初始反向提示词 */
    readonly negativePrompt?: string;
    /** 完整的图像资产持久化记录快照 */
    readonly record?: StoredImageRecord;
    /** 触发重绘回调 */
    readonly onRegenerate?: (newPrompt: string, newNegativePrompt?: string) => Promise<void> | void;
    /** 查看详细元数据回调 */
    readonly onViewMetadata?: (record?: StoredImageRecord) => void;
}

/**
 * 楼层图像操作面板类。
 */
export class ImageActionPanel implements Disposable {
    private isOpenState = false;
    private currentContext: ImageActionContext | null = null;

    // DOM 元素引用
    private backdropEl?: HTMLElement;
    private titleEl?: HTMLElement;
    private posTextarea?: HTMLTextAreaElement;
    private negTextarea?: HTMLTextAreaElement;
    private metaBadgeContainer?: HTMLElement;

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
        backdrop.className = 'da-modal-backdrop';
        backdrop.style.display = 'none';

        // 2. 居中面板
        const panel = document.createElement('div');
        panel.className = 'da-action-panel';
        panel.style.width = '90%';
        panel.style.maxWidth = '540px';
        panel.style.maxHeight = '85vh';
        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';
        panel.style.overflow = 'hidden';

        // 3. Header 顶栏
        const header = document.createElement('div');
        header.className = 'da-action-panel__header';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.padding = '12px 18px';
        header.style.borderBottom = '1px solid var(--da-border-color, rgba(255, 255, 255, 0.1))';

        const title = document.createElement('div');
        title.className = 'da-action-panel__title';
        title.style.display = 'flex';
        title.style.alignItems = 'center';
        title.style.gap = '8px';
        title.style.fontWeight = '600';
        title.style.fontSize = '14px';
        title.textContent = '🎨 图像微调与重绘';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-action-panel__close-btn';
        closeBtn.title = '关闭 (Esc)';
        closeBtn.innerHTML = '✕';
        closeBtn.style.background = 'transparent';
        closeBtn.style.border = 'none';
        closeBtn.style.color = 'var(--da-text-secondary, #aaa)';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.fontSize = '16px';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
        header.appendChild(closeBtn);

        panel.appendChild(header);

        // 4. Body 提示词与参数区域
        const body = document.createElement('div');
        body.className = 'da-action-panel__body';
        body.style.padding = '16px 18px';
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '14px';
        body.style.overflowY = 'auto';

        // 正向提示词卡片
        const posSection = this.createPromptSection('正向提示词 (Prompt)', '输入正向描述提示词...');
        this.posTextarea = posSection.textarea;
        body.appendChild(posSection.container);

        // 反向提示词卡片
        const negSection = this.createPromptSection('反向过滤提示词 (Negative Prompt)', '输入反向过滤提示词...');
        this.negTextarea = negSection.textarea;
        body.appendChild(negSection.container);

        // 技术参数摘要胶囊栏
        const metaBadgeContainer = document.createElement('div');
        metaBadgeContainer.className = 'da-action-panel__meta-badges';
        metaBadgeContainer.style.display = 'flex';
        metaBadgeContainer.style.flexWrap = 'wrap';
        metaBadgeContainer.style.gap = '6px';
        metaBadgeContainer.style.fontSize = '11px';
        body.appendChild(metaBadgeContainer);
        this.metaBadgeContainer = metaBadgeContainer;

        panel.appendChild(body);

        // 5. Footer 底部操作按钮行
        const footer = document.createElement('div');
        footer.className = 'da-action-panel__footer';
        footer.style.display = 'flex';
        footer.style.alignItems = 'center';
        footer.style.justifyContent = 'space-between';
        footer.style.padding = '12px 18px';
        footer.style.borderTop = '1px solid var(--da-border-color, rgba(255, 255, 255, 0.1))';

        const footerLeft = document.createElement('div');
        footerLeft.style.display = 'flex';
        footerLeft.style.alignItems = 'center';
        footerLeft.style.gap = '8px';

        // 详细元数据按钮
        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        infoBtn.title = '查看完整生成超参数与技术元数据';
        infoBtn.innerHTML = 'ℹ️ 元数据';
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
        downloadBtn.innerHTML = '💾 下载';
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleDownload();
        });
        footerLeft.appendChild(downloadBtn);

        footer.appendChild(footerLeft);

        const footerRight = document.createElement('div');
        footerRight.style.display = 'flex';
        footerRight.style.alignItems = 'center';
        footerRight.style.gap = '8px';

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

        // 重新生成按钮 (Primary)
        const regenBtn = document.createElement('button');
        regenBtn.type = 'button';
        regenBtn.className = 'da-btn da-btn--primary da-btn--sm';
        regenBtn.title = '使用微调后的提示词重新生成本图';
        regenBtn.innerHTML = '🔄 重新生成';
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
        this.titleEl = title;

        // 遮罩点击退出
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                this.close();
            }
        });

        // 键盘 Esc 监听
        const onKeyDown = (e: KeyboardEvent) => {
            if (this.isOpenState && e.key === 'Escape') {
                e.stopPropagation();
                this.close();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        this.disposers.push(() => window.removeEventListener('keydown', onKeyDown));
    }

    /**
     * 构建提示词编辑卡片块。
     */
    private createPromptSection(label: string, placeholder: string): {
        container: HTMLElement;
        textarea: HTMLTextAreaElement;
    } {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '6px';

        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.alignItems = 'center';
        headerRow.style.justifyContent = 'space-between';

        const labelEl = document.createElement('span');
        labelEl.style.fontSize = '12px';
        labelEl.style.fontWeight = '500';
        labelEl.style.color = 'var(--da-text-secondary, #aaa)';
        labelEl.textContent = label;
        headerRow.appendChild(labelEl);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'da-btn da-btn--text da-btn--xs';
        copyBtn.style.fontSize = '11px';
        copyBtn.style.padding = '2px 6px';
        copyBtn.textContent = '📋 复制';
        copyBtn.addEventListener('click', () => {
            const val = textarea.value.trim();
            if (!val) {
                Toast.info('提示词为空');
                return;
            }
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(val).then(() => {
                    Toast.success('已复制到剪贴板');
                }).catch(() => {
                    Toast.warning('复制受阻，请手动选中文本');
                });
            }
        });
        headerRow.appendChild(copyBtn);
        container.appendChild(headerRow);

        const textarea = document.createElement('textarea');
        textarea.className = 'da-textarea';
        textarea.placeholder = placeholder;
        textarea.rows = 3;
        textarea.style.width = '100%';
        textarea.style.boxSizing = 'border-box';
        textarea.style.resize = 'vertical';
        textarea.style.fontSize = '12px';
        textarea.style.fontFamily = 'monospace';
        textarea.style.lineHeight = '1.45';
        textarea.style.padding = '8px 10px';
        textarea.style.borderRadius = 'var(--da-radius-sm, 6px)';
        textarea.style.border = '1px solid var(--da-border-color, rgba(255, 255, 255, 0.15))';
        textarea.style.background = 'var(--da-bg-input, rgba(0, 0, 0, 0.25))';
        textarea.style.color = 'var(--da-text-primary, #fff)';

        container.appendChild(textarea);

        return { container, textarea };
    }

    /**
     * 打开楼层图像微调操作面板。
     *
     * @param context 操作上下文
     */
    public open(context: ImageActionContext): void {
        this.currentContext = context;
        this.isOpenState = true;

        if (this.titleEl) {
            this.titleEl.textContent = `🎨 图像微调与重绘 (#${context.messageId})`;
        }

        if (this.posTextarea) {
            this.posTextarea.value = context.prompt || context.record?.metadata?.prompt || '';
        }
        if (this.negTextarea) {
            this.negTextarea.value = context.negativePrompt || context.record?.metadata?.negativePrompt || '';
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
            span.style.padding = '2px 8px';
            span.style.borderRadius = '4px';
            span.style.background = 'rgba(255, 255, 255, 0.08)';
            span.style.color = 'var(--da-text-secondary, #aaa)';
            span.style.border = '1px solid var(--da-border-color, rgba(255, 255, 255, 0.1))';
            span.textContent = text;
            this.metaBadgeContainer.appendChild(span);
        }
    }

    /**
     * 触发原位重绘并关闭面板。
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
        } else {
            Toast.warning('当前上下文未绑定重绘调度器');
        }
    }

    /**
     * 触发查看详细元数据。
     */
    private handleViewMetadata(): void {
        if (!this.currentContext) return;

        if (this.currentContext.onViewMetadata) {
            this.currentContext.onViewMetadata(this.currentContext.record);
        } else {
            // 联动全局 imageInfoModal
            imageInfoModal.open(this.currentContext.record?.metadata as Record<string, unknown>);
        }
    }

    /**
     * 触发下载图像文件。
     */
    private handleDownload(): void {
        if (!this.currentContext?.imageUrl) {
            Toast.warning('未找到可下载的图像资源');
            return;
        }

        try {
            const a = document.createElement('a');
            a.href = this.currentContext.imageUrl;
            a.download = `st_draw_${this.currentContext.imageId || Date.now()}.png`;
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
