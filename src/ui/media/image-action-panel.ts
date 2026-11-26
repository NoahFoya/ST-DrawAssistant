/**
 * 图像编辑与双通道重绘工作台 (ImageActionPanel)。
 *
 * @remarks
 * 统一服务楼层与本地图库图像的提示词微调、参数模式切换与重新生成：
 * 1. 唤出方式：楼层图片右键/长按/角落编辑按钮、本地图库卡片/灯箱重绘入口或元信息弹窗；
 * 2. 双栏布局：桌面端采用左编辑（正向/负向提示词、宏补全与展开）右控制（缩略图预览、参数模式与独立种子徽标）工作台，窄屏自动保持编辑区置顶；
 * 3. 双模式重绘：支持「复现原参数 / 按当前配置」与「随机新种子 / 锁定原种子」组合提交（支持 Ctrl/Cmd+Enter 快捷触发）；
 * 4. 辅助工具：底部提供元信息详情、复制图片到剪贴板、局部重绘画板与图像文件下载。
 */

import type { Disposable } from '../types';
import type { StoredImageRecord } from '@types';
import { renderIcon } from '../components/icons';
import { bindBackdropDismiss, overlayStack } from '../framework/overlay-stack';
import { Toast } from '../feedback/toast';
import { reportRuntimeError } from '../feedback/error-feedback';
import { copyResolvedImageWithToast } from '../feedback/image-clipboard';
import { imageInfoModal } from './image-info-modal';
import { openInpaintModal, type InpaintConfirmResult } from './inpaint-modal';
import { attachTagAutocomplete, type TagAutocomplete } from '../composite/tag-autocomplete';
import { resolvePromptMacros } from '../../pipeline/macro-resolver';
import {
    inspectRecordForRegeneration,
    resolveRegenCapabilities,
    type RecordReplayInspection,
    type ReplayMode,
    type SeedMode,
} from '../../pipeline/regeneration-planner';
import { imageStorage } from '../../store/image-storage';
import { settingsStore } from '../../store/settings-store';
import { copyTextToClipboard, downloadImageAsset } from '../../util/browser-io';

/** 重新生成提交决策负载 */
export interface ImageActionSubmitDecision {
    readonly prompt: string;
    readonly negativePrompt?: string;
    readonly replayMode: ReplayMode;
    readonly seedMode: SeedMode;
}

/** 图像操作弹窗上下文数据 */
export interface ImageActionContext {
    /** 调用来源：楼层消息或本地图库（缺省视为 'floor'） */
    readonly source?: 'floor' | 'gallery';
    /** 宿主消息楼层序号（楼层来源时展示 `#N`） */
    readonly messageId?: number;
    /** 指令序号 (默认 0) */
    readonly instructionIndex?: number;
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
    /** 默认重绘参数模式（图库默认 'original'，楼层默认 'current'） */
    readonly defaultReplayMode?: ReplayMode;
    /** 触发整图重新生成兼容回调（仅传正/负向提示词） */
    readonly onRegenerate?: (newPrompt: string, newNegativePrompt?: string) => Promise<boolean | void> | boolean | void;
    /** 触发结构化双通道重绘回调（携带参数模式与种子决策） */
    readonly onSubmitRegenerate?: (decision: ImageActionSubmitDecision) => Promise<boolean | void> | boolean | void;
    /** 触发局部重绘 Inpaint 回调 */
    readonly onInpaint?: (data: InpaintConfirmResult) => Promise<boolean | void> | boolean | void;
    /** 触发结构化局部重绘回调（携带当前选择的参数模式与种子决策） */
    readonly onSubmitInpaint?: (
        data: InpaintConfirmResult,
        decision: Pick<ImageActionSubmitDecision, 'replayMode' | 'seedMode'>
    ) => Promise<boolean | void> | boolean | void;
}

/**
 * 楼层图像编辑与操作面板类。
 */
export class ImageActionPanel implements Disposable {
    private isOpenState = false;
    private currentContext: ImageActionContext | null = null;

    // DOM 元素引用
    private backdropEl?: HTMLElement;
    private panelEl?: HTMLElement;
    private bodyEl?: HTMLElement;
    private sideColEl?: HTMLElement;
    private unbindBackdrop?: () => void;
    private titleTextEl?: HTMLElement;
    private previewCardEl?: HTMLElement;
    private previewBoxEl?: HTMLElement;
    private previewImgEl?: HTMLImageElement;
    private specsEl?: HTMLElement;
    private posTextarea?: HTMLTextAreaElement;
    private negSectionEl?: HTMLElement;
    private negTextarea?: HTMLTextAreaElement;
    private inpaintBtnEl?: HTMLButtonElement;
    private replayPanelEl?: HTMLElement;
    private modeOriginalBtnEl?: HTMLButtonElement;
    private modeCurrentBtnEl?: HTMLButtonElement;
    private seedRowEl?: HTMLElement;
    private seedChipEl?: HTMLElement;
    private seedRandomBtnEl?: HTMLButtonElement;
    private seedFixedBtnEl?: HTMLButtonElement;
    private replayWarningEl?: HTMLElement;
    private resetPosUndo?: () => void;
    private resetNegUndo?: () => void;
    private updatePosHighlight?: () => void;
    private updateNegHighlight?: () => void;
    private readonly autocompletes: TagAutocomplete[] = [];

    private openGeneration = 0;
    private allocatedFallbackUrls: string[] = [];
    private currentReplayMode: ReplayMode = 'current';
    private currentSeedMode: SeedMode = 'random';
    private currentInspection: RecordReplayInspection | null = null;
    private hasManualPosEdit = false;
    private hasManualNegEdit = false;
    private isSyncingTextareas = false;

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

        // 1. 遮罩外壳（移动端自动切换为底部抽屉对齐）
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop da-modal-backdrop--sheet st-da-root da-action-panel-backdrop';
        backdrop.style.display = 'none';

        // 2. 居中双栏工作台面板
        const panel = document.createElement('div');
        panel.className = 'da-modal-shell da-action-panel';
        this.panelEl = panel;

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

        // 4. Body 双栏区域（左/上：正负向提示词输入；右/下：图像缩略图与参数切换）
        const body = document.createElement('div');
        body.className = 'da-action-panel__body';
        this.bodyEl = body;

        const editorCol = document.createElement('div');
        editorCol.className = 'da-action-panel__col-editor';

        const bindShortcutSubmit = (ta: HTMLTextAreaElement) => {
            ta.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    this.handleRegenerate();
                }
            });
        };

        // 正向提示词卡片
        const posSection = this.createPromptSection('正向提示词', '输入正向描述提示词...', 5);
        this.posTextarea = posSection.textarea;
        this.posTextarea.addEventListener('input', () => {
            if (!this.isSyncingTextareas) {
                this.hasManualPosEdit = true;
            }
        });
        bindShortcutSubmit(this.posTextarea);
        this.resetPosUndo = posSection.resetUndo;
        this.updatePosHighlight = posSection.updateHighlight;
        const posAc = attachTagAutocomplete(this.posTextarea, { mode: 'prompt-with-macro' });
        this.autocompletes.push(posAc);
        this.disposers.push(() => posAc.dispose());
        editorCol.appendChild(posSection.container);

        // 负向提示词卡片
        const negSection = this.createPromptSection('负向提示词', '输入负向过滤提示词...', 3);
        this.negSectionEl = negSection.container;
        this.negTextarea = negSection.textarea;
        this.negTextarea.addEventListener('input', () => {
            if (!this.isSyncingTextareas) {
                this.hasManualNegEdit = true;
            }
        });
        bindShortcutSubmit(this.negTextarea);
        this.resetNegUndo = negSection.resetUndo;
        this.updateNegHighlight = negSection.updateHighlight;
        const negAc = attachTagAutocomplete(this.negTextarea, { mode: 'prompt-with-macro' });
        this.autocompletes.push(negAc);
        this.disposers.push(() => negAc.dispose());
        editorCol.appendChild(negSection.container);

        body.appendChild(editorCol);

        // 4.2 右侧视觉预览与重绘设置栏
        const sideCol = document.createElement('div');
        sideCol.className = 'da-action-panel__col-side';
        this.sideColEl = sideCol;

        const previewCard = document.createElement('div');
        previewCard.className = 'da-action-panel__preview-card';
        const previewBox = document.createElement('div');
        previewBox.className = 'da-action-panel__preview-box';
        const previewImg = document.createElement('img');
        previewImg.className = 'da-action-panel__preview-img';
        previewImg.alt = '当前编辑图像';
        previewImg.draggable = true;
        previewImg.addEventListener('error', () => {
            void this.recoverPreviewFallback(previewImg);
        });
        previewBox.appendChild(previewImg);
        previewCard.appendChild(previewBox);

        const specsEl = document.createElement('div');
        specsEl.className = 'da-action-panel__specs';
        previewCard.appendChild(specsEl);

        this.previewCardEl = previewCard;
        this.previewBoxEl = previewBox;
        this.previewImgEl = previewImg;
        this.specsEl = specsEl;
        sideCol.appendChild(previewCard);

        const replayPanel = document.createElement('div');
        replayPanel.className = 'da-action-panel__replay-panel';
        replayPanel.style.display = 'none';

        const modeBlock = document.createElement('div');
        modeBlock.className = 'da-action-panel__control-block';
        const modeHeader = document.createElement('div');
        modeHeader.className = 'da-action-panel__control-header';
        const modeLabel = document.createElement('span');
        modeLabel.className = 'da-action-panel__replay-label';
        modeLabel.textContent = '参数模式';
        modeHeader.appendChild(modeLabel);
        const modeGroup = document.createElement('div');
        modeGroup.className = 'da-action-panel__seg-group';

        const modeOriginalBtn = document.createElement('button');
        modeOriginalBtn.type = 'button';
        modeOriginalBtn.className = 'da-action-panel__seg-btn';
        modeOriginalBtn.textContent = '复现原参数';
        modeOriginalBtn.addEventListener('click', () => this.switchReplayMode('original'));

        const modeCurrentBtn = document.createElement('button');
        modeCurrentBtn.type = 'button';
        modeCurrentBtn.className = 'da-action-panel__seg-btn';
        modeCurrentBtn.textContent = '按当前配置';
        modeCurrentBtn.addEventListener('click', () => this.switchReplayMode('current'));

        modeGroup.appendChild(modeOriginalBtn);
        modeGroup.appendChild(modeCurrentBtn);
        modeBlock.appendChild(modeHeader);
        modeBlock.appendChild(modeGroup);
        replayPanel.appendChild(modeBlock);

        const seedBlock = document.createElement('div');
        seedBlock.className = 'da-action-panel__control-block';
        const seedHeader = document.createElement('div');
        seedHeader.className = 'da-action-panel__control-header';
        const seedLabel = document.createElement('span');
        seedLabel.className = 'da-action-panel__replay-label';
        seedLabel.textContent = '随机种子';
        const seedChip = document.createElement('button');
        seedChip.type = 'button';
        seedChip.className = 'da-action-panel__seed-chip';
        seedChip.title = '点击复制原图种子';
        seedChip.style.display = 'none';
        seedChip.addEventListener('click', () => {
            const seed = this.currentInspection?.recordedSeed;
            if (seed === undefined) return;
            void copyTextToClipboard(String(seed)).then((ok) => {
                if (ok) Toast.success(`已复制种子 ${seed}`);
            });
        });
        seedHeader.appendChild(seedLabel);
        seedHeader.appendChild(seedChip);

        const seedGroup = document.createElement('div');
        seedGroup.className = 'da-action-panel__seg-group';

        const seedRandomBtn = document.createElement('button');
        seedRandomBtn.type = 'button';
        seedRandomBtn.className = 'da-action-panel__seg-btn';
        seedRandomBtn.textContent = '随机新种子';
        seedRandomBtn.addEventListener('click', () => this.switchSeedMode('random'));

        const seedFixedBtn = document.createElement('button');
        seedFixedBtn.type = 'button';
        seedFixedBtn.className = 'da-action-panel__seg-btn';
        seedFixedBtn.textContent = '锁定原种子';
        seedFixedBtn.addEventListener('click', () => this.switchSeedMode('fixed'));

        seedGroup.appendChild(seedRandomBtn);
        seedGroup.appendChild(seedFixedBtn);
        seedBlock.appendChild(seedHeader);
        seedBlock.appendChild(seedGroup);
        replayPanel.appendChild(seedBlock);

        const replayWarning = document.createElement('div');
        replayWarning.className = 'da-action-panel__replay-warning';
        replayWarning.style.display = 'none';
        replayPanel.appendChild(replayWarning);

        this.replayPanelEl = replayPanel;
        this.modeOriginalBtnEl = modeOriginalBtn;
        this.modeCurrentBtnEl = modeCurrentBtn;
        this.seedRowEl = seedBlock;
        this.seedChipEl = seedChip;
        this.seedRandomBtnEl = seedRandomBtn;
        this.seedFixedBtnEl = seedFixedBtn;
        this.replayWarningEl = replayWarning;
        sideCol.appendChild(replayPanel);

        body.appendChild(sideCol);
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
        infoBtn.title = '查看完整生成参数';
        infoBtn.textContent = '元信息';
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleViewMetadata();
        });
        footerLeft.appendChild(infoBtn);

        // 复制图片按钮（便于直接 Ctrl+V 粘贴至 QQ / 微信）
        const copyImgBtn = document.createElement('button');
        copyImgBtn.type = 'button';
        copyImgBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        copyImgBtn.title = '复制图片到剪贴板（支持直接粘贴到 QQ / 微信）';
        copyImgBtn.textContent = '复制图片';
        copyImgBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void copyResolvedImageWithToast(() => this.resolveCurrentBlob());
        });
        footerLeft.appendChild(copyImgBtn);

        // 下载原图按钮
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        downloadBtn.title = '下载图片到本地';
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
        inpaintBtn.title = '打开局部重绘画板涂抹修改细节';
        inpaintBtn.textContent = '局部重绘';
        inpaintBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleInpaint();
        });
        this.inpaintBtnEl = inpaintBtn;
        footerRight.appendChild(inpaintBtn);

        // 重新生成按钮 (Primary)
        const regenBtn = document.createElement('button');
        regenBtn.type = 'button';
        regenBtn.className = 'da-btn da-btn--primary da-btn--sm';
        regenBtn.title = '重新生成 (Ctrl+Enter)';
        regenBtn.textContent = '重新生成';
        regenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleRegenerate();
        });
        footerRight.appendChild(regenBtn);

        footer.appendChild(footerRight);
        panel.appendChild(footer);

        backdrop.appendChild(panel);

        // 保存引用（保持游离态，在 open() 打开时动态挂至 document.body 末位）
        this.backdropEl = backdrop;
        this.titleTextEl = titleText;

        // 遮罩点击退出
        this.unbindBackdrop?.();
        this.unbindBackdrop = bindBackdropDismiss(backdrop, () => this.close());
    }

    /**
     * 构建提示词编辑卡片块（双层镜像宏高亮）。
     */
    private createPromptSection(label: string, placeholder: string, defaultRows = 3): {
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
        textarea.rows = defaultRows;

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
        if (!this.backdropEl) {
            this.initDom();
        }
        this.openGeneration += 1;
        this.revokeAllocatedFallbackUrls();
        this.currentContext = context;
        this.isOpenState = true;
        this.hasManualPosEdit = false;
        this.hasManualNegEdit = false;
        overlayStack.push('image-action-panel', () => this.close(), () => this.close());
        this.resetPosUndo?.();
        this.resetNegUndo?.();
        for (const ac of this.autocompletes) {
            ac.closePopup();
        }

        const isGallery = context.source === 'gallery' || context.messageId === undefined;
        if (this.titleTextEl) {
            this.titleTextEl.textContent = isGallery
                ? '图像编辑 · 本地图库'
                : `图像编辑 · 楼层 #${context.messageId}`;
        }

        if (this.previewImgEl) {
            this.previewImgEl.dataset.fallbackTried = '';
            if (context.imageUrl) {
                this.previewImgEl.src = context.imageUrl;
            } else {
                this.previewImgEl.removeAttribute('src');
            }
        }

        const inspection = context.record?.metadata
            ? inspectRecordForRegeneration(
                  context.record,
                  context.prompt,
                  context.negativePrompt || ''
              )
            : null;
        this.currentInspection = inspection;

        const desiredDefaultMode: ReplayMode =
            context.defaultReplayMode ?? (isGallery ? 'original' : 'current');
        this.currentReplayMode =
            desiredDefaultMode === 'original' && inspection?.hasReplaySnapshot
                ? 'original'
                : 'current';
        this.currentSeedMode = 'random';

        this.applyModePrompts(true);
        this.syncReplayControlsUI();

        for (const ac of this.autocompletes) {
            ac.refreshMacroStatus();
        }

        if (this.backdropEl && typeof document !== 'undefined') {
            // 打开时始终置入 body 末位，使后打开的次级弹窗/详情窗自然处于其上方
            document.body.appendChild(this.backdropEl);
            this.backdropEl.style.display = 'flex';
        }
    }

    private switchReplayMode(nextMode: ReplayMode): void {
        if (nextMode === 'original' && !this.currentInspection?.hasReplaySnapshot) {
            return;
        }
        if (this.currentReplayMode === nextMode) {
            return;
        }
        this.currentReplayMode = nextMode;
        this.applyModePrompts(false);
        this.syncReplayControlsUI();
    }

    private switchSeedMode(nextSeedMode: SeedMode): void {
        if (nextSeedMode === 'fixed' && !this.currentInspection?.hasFixedSeed) {
            return;
        }
        this.currentSeedMode = nextSeedMode;
        this.syncReplayControlsUI();
    }

    private applyModePrompts(isInitialOpen: boolean): void {
        const ctx = this.currentContext;
        if (!ctx) return;

        const inspection = this.currentInspection;
        const targetPos =
            this.currentReplayMode === 'original' && inspection
                ? inspection.originalPrompt
                : inspection && inspection.currentPrompt
                  ? inspection.currentPrompt
                  : ctx.prompt || '';
        const targetNeg =
            this.currentReplayMode === 'original' && inspection
                ? inspection.originalNegativePrompt
                : inspection && inspection.currentNegativePrompt
                  ? inspection.currentNegativePrompt
                  : ctx.negativePrompt || '';

        this.isSyncingTextareas = true;
        try {
            if ((isInitialOpen || !this.hasManualPosEdit) && this.posTextarea) {
                this.posTextarea.value = isInitialOpen && ctx.prompt && !inspection ? ctx.prompt : targetPos;
                this.resetPosUndo?.();
                this.updatePosHighlight?.();
            }

            const { supportsNegative } = this.getActiveProviderCapabilities();
            if ((isInitialOpen || !this.hasManualNegEdit) && this.negTextarea) {
                const nextNegVal = supportsNegative
                    ? isInitialOpen && ctx.negativePrompt && !inspection
                        ? ctx.negativePrompt
                        : targetNeg
                    : '';
                this.negTextarea.value = nextNegVal;
                this.resetNegUndo?.();
                this.updateNegHighlight?.();
            }
        } finally {
            this.isSyncingTextareas = false;
        }
    }

    private syncReplayControlsUI(): void {
        const ctx = this.currentContext;
        const inspection = this.currentInspection;
        const { supportsNegative, supportsInpaint, supportsSeed } = this.getActiveProviderCapabilities();

        if (this.negSectionEl) {
            this.negSectionEl.style.display = supportsNegative ? '' : 'none';
        }
        if (this.inpaintBtnEl) {
            this.inpaintBtnEl.disabled = !supportsInpaint;
            this.inpaintBtnEl.title = supportsInpaint
                ? '打开局部重绘画板涂抹修改细节'
                : '当前生图服务不支持局部重绘（仅 ComfyUI / SD-WebUI 支持）';
        }

        const hasPreview = Boolean(ctx?.imageUrl);
        if (this.previewBoxEl) {
            this.previewBoxEl.style.display = hasPreview ? '' : 'none';
        }

        const hasReplayControls = Boolean(
            inspection && (inspection.hasReplaySnapshot || inspection.hasFixedSeed)
        );

        if (this.specsEl) {
            let specText = '';
            if (hasReplayControls && inspection) {
                specText =
                    this.currentReplayMode === 'original'
                        ? inspection.originalSummary
                        : `当前服务：${inspection.activeEngineLabel}`;
            } else if (hasPreview && ctx?.record?.width && ctx?.record?.height) {
                specText = `${ctx.record.width}×${ctx.record.height}`;
            }
            this.specsEl.textContent = specText;
            this.specsEl.style.display = specText ? '' : 'none';
        }

        const hasSpecs = Boolean(this.specsEl && this.specsEl.style.display !== 'none');
        if (this.previewCardEl) {
            this.previewCardEl.style.display = hasPreview || hasSpecs ? '' : 'none';
        }

        if (this.replayPanelEl) {
            this.replayPanelEl.style.display = hasReplayControls ? '' : 'none';
        }

        if (hasReplayControls && inspection) {
            if (this.modeOriginalBtnEl) {
                this.modeOriginalBtnEl.disabled = !inspection.hasReplaySnapshot;
                this.modeOriginalBtnEl.classList.toggle('is-active', this.currentReplayMode === 'original');
            }
            if (this.modeCurrentBtnEl) {
                this.modeCurrentBtnEl.classList.toggle('is-active', this.currentReplayMode === 'current');
            }

            if (this.seedRowEl && this.seedRandomBtnEl && this.seedFixedBtnEl) {
                this.seedRowEl.style.display = supportsSeed ? '' : 'none';
                if (supportsSeed) {
                    this.seedRandomBtnEl.classList.toggle('is-active', this.currentSeedMode === 'random');
                    this.seedFixedBtnEl.disabled = !inspection.hasFixedSeed;
                    this.seedFixedBtnEl.classList.toggle(
                        'is-active',
                        this.currentSeedMode === 'fixed' && inspection.hasFixedSeed
                    );
                    if (this.seedChipEl) {
                        if (inspection.hasFixedSeed && inspection.recordedSeed !== undefined) {
                            this.seedChipEl.textContent = `#${inspection.recordedSeed}`;
                            this.seedChipEl.style.display = '';
                        } else {
                            this.seedChipEl.textContent = '';
                            this.seedChipEl.style.display = 'none';
                        }
                    }
                }
            }

            if (this.replayWarningEl) {
                const warningText =
                    this.currentReplayMode === 'original' ? inspection.missingWorkflowWarning : undefined;
                if (warningText) {
                    this.replayWarningEl.textContent = warningText;
                    this.replayWarningEl.style.display = '';
                } else {
                    this.replayWarningEl.textContent = '';
                    this.replayWarningEl.style.display = 'none';
                }
            }
        }

        const hasSideContent = hasPreview || hasSpecs || hasReplayControls;
        if (this.sideColEl) {
            this.sideColEl.style.display = hasSideContent ? '' : 'none';
        }
        this.bodyEl?.classList.toggle('is-single-col', !hasSideContent);
        this.panelEl?.classList.toggle('is-compact', !hasSideContent);
    }

    private async resolveCurrentBlob(): Promise<Blob | null> {
        const ctx = this.currentContext;
        if (!ctx) return null;
        return imageStorage.resolveImageBlob(ctx.imageId ?? ctx.record?.imageId, ctx.imageUrl);
    }

    private async recoverPreviewFallback(imgEl: HTMLImageElement): Promise<void> {
        const ctx = this.currentContext;
        const targetId = ctx?.imageId ?? ctx?.record?.imageId;
        if (!this.isOpenState || !targetId || imgEl.dataset.fallbackTried === '1') {
            return;
        }
        imgEl.dataset.fallbackTried = '1';
        const capturedGen = this.openGeneration;
        try {
            const blob = await imageStorage.getImageBlob(targetId);
            if (!this.isOpenState || this.openGeneration !== capturedGen || !blob || blob.size === 0) {
                return;
            }
            const fallbackUrl = URL.createObjectURL(blob);
            this.allocatedFallbackUrls.push(fallbackUrl);
            imgEl.src = fallbackUrl;
        } catch {
            // 忽略本地预览回退异常
        }
    }

    private revokeAllocatedFallbackUrls(): void {
        for (const url of this.allocatedFallbackUrls) {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // 忽略临时 URL 回收异常
            }
        }
        this.allocatedFallbackUrls.length = 0;
    }

    /**
     * 统一按当前所选重绘模式与目标引擎查询负向词、局部重绘与随机种子能力。
     */
    private getActiveProviderCapabilities(): {
        supportsNegative: boolean;
        supportsInpaint: boolean;
        supportsSeed: boolean;
    } {
        return resolveRegenCapabilities(this.currentContext?.record, this.currentReplayMode);
    }

    /**
     * 触发重新生成并关闭面板。
     */
    private handleRegenerate(): void {
        if (!this.currentContext) return;

        const { supportsNegative } = this.getActiveProviderCapabilities();
        const newPrompt = this.posTextarea?.value.trim() ?? '';
        const newNegativePrompt = supportsNegative ? (this.negTextarea?.value.trim() ?? '') : undefined;

        if (!newPrompt) {
            Toast.warning('正向提示词不能为空');
            return;
        }

        const decision: ImageActionSubmitDecision = {
            prompt: newPrompt,
            negativePrompt: newNegativePrompt,
            replayMode: this.currentReplayMode,
            seedMode: this.currentSeedMode,
        };
        const { onSubmitRegenerate, onRegenerate } = this.currentContext;
        this.close();
        if (onSubmitRegenerate) {
            void onSubmitRegenerate(decision);
        } else if (onRegenerate) {
            void onRegenerate(newPrompt, newNegativePrompt);
        }
    }

    /**
     * 触发局部重绘 Inpaint 画板。
     */
    private handleInpaint(): void {
        if (!this.currentContext) return;

        const { supportsInpaint, supportsNegative } = this.getActiveProviderCapabilities();
        if (!supportsInpaint) {
            Toast.warning('当前生图服务不支持局部重绘（仅 ComfyUI / SD-WebUI 支持）');
            return;
        }

        if (!this.currentContext.imageUrl) {
            Toast.warning('当前图片未就绪，无法打开局部重绘画板');
            return;
        }

        const ctx = this.currentContext;
        const initialPrompt = this.posTextarea ? this.posTextarea.value.trim() : ctx.prompt || '';
        const initialNegPrompt = this.negTextarea
            ? supportsNegative
                ? this.negTextarea.value.trim()
                : ''
            : ctx.negativePrompt || '';
        const replayDecision = {
            replayMode: this.currentReplayMode,
            seedMode: this.currentSeedMode,
        };

        this.close();

        openInpaintModal({
            imageSrc: ctx.imageUrl!,
            imageId: ctx.imageId ?? ctx.record?.imageId,
            initialPrompt,
            initialNegativePrompt: initialNegPrompt,
            supportsNegativePrompt: supportsNegative,
            onConfirm: async (data) => {
                if (typeof ctx.onSubmitInpaint === 'function') {
                    return await ctx.onSubmitInpaint(data, replayDecision);
                }
                if (typeof ctx.onInpaint === 'function') {
                    return await ctx.onInpaint(data);
                }
                if (typeof ctx.onSubmitRegenerate === 'function') {
                    return await ctx.onSubmitRegenerate({
                        prompt: data.prompt,
                        negativePrompt: data.negativePrompt,
                        ...replayDecision,
                    });
                }
                if (typeof ctx.onRegenerate === 'function') {
                    return await ctx.onRegenerate(data.prompt, data.negativePrompt);
                }
                return false;
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
     * 触发下载图像文件（优先从 IDB 读取原始 Blob，自动匹配真实文件后缀）。
     */
    private async handleDownload(): Promise<void> {
        const ctx = this.currentContext;
        if (!ctx || (!ctx.imageUrl && !ctx.imageId && !ctx.record?.imageId)) return;
        const targetId = ctx.imageId ?? ctx.record?.imageId;
        try {
            const ok = await downloadImageAsset({
                resolveBlob: () =>
                    targetId ? imageStorage.getImageBlob(targetId) : Promise.resolve(null),
                url: ctx.imageUrl,
                fileNameBase: `st_draw_${targetId || Date.now()}`,
            });
            if (!ok) {
                Toast.error('下载失败，未找到可用图像资源');
                return;
            }
            Toast.success('已开始下载图像');
        } catch (err) {
            reportRuntimeError(
                '[ImageActionPanel] 下载图像异常:',
                '下载失败，请检查网络或前往「日志与统计」查看详情',
                err
            );
        }
    }

    /**
     * 关闭面板。
     */
    public close(): void {
        this.isOpenState = false;
        this.openGeneration += 1;
        this.revokeAllocatedFallbackUrls();
        overlayStack.remove('image-action-panel');
        this.resetPosUndo?.();
        this.resetNegUndo?.();
        for (const ac of this.autocompletes) {
            ac.closePopup();
        }
        if (this.previewImgEl) {
            this.previewImgEl.removeAttribute('src');
        }
        if (this.backdropEl) {
            this.backdropEl.style.display = 'none';
            this.backdropEl.remove();
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

        for (const ac of this.autocompletes) {
            ac.dispose();
        }
        this.autocompletes.length = 0;
        this.unbindBackdrop?.();
        this.unbindBackdrop = undefined;
        if (this.backdropEl && this.backdropEl.parentNode) {
            this.backdropEl.parentNode.removeChild(this.backdropEl);
        }
        this.backdropEl = undefined;
    }
}

/** 全局默认单例楼层图像操作面板 */
export const imageActionPanel = new ImageActionPanel();
