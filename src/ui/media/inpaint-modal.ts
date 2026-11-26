/**
 * 局部重绘双层画布模态弹窗 (InpaintModal)。
 *
 * @remarks
 * 基于 Soft UI 规范提供 Canvas 遮罩涂抹与局部重绘参数配置能力：
 * 1. 采用双栏工作台布局：左侧承载画布舞台、工具条、缩放控制与快捷键指示；右侧承载重绘参数与提示词检查器；
 * 2. 离屏输出标准二值掩码（黑色底景 #000000 代表保留，白色选区 #ffffff 代表重绘）；
 * 3. 具备实时随动画笔光圈、画布缩放/平移（滚轮、空格拖拽、中/右键与双指手势）、20 步撤销/重做及空蒙版拦截；
 * 4. 支持 Ctrl+Enter 快捷提交与 Esc 退出，并在销毁时安全注销所有监听与引用。
 */

import type { Disposable } from '../types';
import { bindBackdropDismiss, overlayStack } from '../framework/overlay-stack';
import { NumberInput } from '../components/number-input';
import { SegmentedControl } from '../components/segmented-control';
import { renderIcon } from '../components/icons';
import { Toast } from '../feedback/toast';
import { reportRuntimeError } from '../feedback/error-feedback';
import { providerRegistry } from '../../provider/registry';
import { settingsStore } from '../../store/settings-store';
import { imageStorage } from '../../store/image-storage';
import { logger } from '../../util/logger';

/** 局部重绘偏好配置缓存键名 */
const INPAINT_PREFS_KEY = 'st_da_inpaint_prefs';

/** 局部重绘本地持久化偏好结构 */
interface InpaintPreferences {
    brushSize?: number;
    denoiseStrength?: number;
    maskBlur?: number;
}

/** 提交局部重绘确认数据结构 */
export interface InpaintConfirmResult {
    /** 原始底图数据 (Data URI 或有效图像地址) */
    readonly initImage: string;
    /** 遮罩蒙版图像数据 (Data URI / PNG) */
    readonly maskImage: string;
    /** 底图原始像素宽度 */
    readonly width?: number;
    /** 底图原始像素高度 */
    readonly height?: number;
    /** 正向提示词文本 */
    readonly prompt: string;
    /** 负向提示词文本 */
    readonly negativePrompt?: string;
    /** 局部重绘去噪幅度 (0.05 ~ 1.00) */
    readonly denoiseStrength: number;
    /** 蒙版边缘羽化像素半径 (0 ~ 32) */
    readonly maskBlur: number;
}

/** 局部重绘弹窗配置项 */
export interface InpaintModalOptions {
    /** 原底图地址 (Blob URL 或 Base64 / 相对路径) */
    readonly imageSrc: string;
    /** 可选的本地存储资产 ID（当 Blob URL 已释放时用于 IDB 回退恢复） */
    readonly imageId?: string;
    /** 初始正向提示词 */
    readonly initialPrompt?: string;
    /** 初始负向提示词 */
    readonly initialNegativePrompt?: string;
    /** 确认提交重绘回调，返回 false 时表示用户取消或未实际入队 */
    readonly onConfirm: (data: InpaintConfirmResult) => Promise<boolean | void> | boolean | void;
    /** 取消或关闭回调 */
    readonly onCancel?: () => void;
}

/**
 * 读取本地存储中的局部重绘参数偏好。
 */
function loadPreferences(): InpaintPreferences {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const raw = window.localStorage.getItem(INPAINT_PREFS_KEY);
            if (raw) {
                return JSON.parse(raw) as InpaintPreferences;
            }
        }
    } catch {
        // 读取异常时使用默认基准值
    }
    return {};
}

/**
 * 保存局部重绘参数偏好至本地存储。
 */
function savePreferences(prefs: InpaintPreferences): void {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(INPAINT_PREFS_KEY, JSON.stringify(prefs));
        }
    } catch {
        // 存储受限或异常时忽略
    }
}

/**
 * 局部重绘模态画板实现类。
 */
export class InpaintModal implements Disposable {
    private readonly options: InpaintModalOptions;
    private isDisposed = false;
    private isSubmitting = false;
    private isDrawing = false;
    private toolMode: 'brush' | 'eraser' | 'pan' = 'brush';
    private cursorRingRafId: number | null = null;
    private pendingCursorEvent: MouseEvent | null = null;

    // 视图缩放与平移状态
    private zoom = 1;
    private panX = 0;
    private panY = 0;
    private isPanning = false;
    private isSpacePressed = false;
    private panStartClientX = 0;
    private panStartClientY = 0;
    private panStartX = 0;
    private panStartY = 0;
    private pinchStartDist = 0;
    private pinchStartZoom = 1;
    private pinchLastCenter: { x: number; y: number } | null = null;

    // 蒙版历史快照栈（上限 20 步）
    private historyStack: Array<{ overlay: ImageData; mask: ImageData }> = [];
    private historyIndex = -1;
    private readonly maxHistory = 20;

    // 参数状态
    private brushSize: number;
    private denoiseStrength: number;
    private maskBlur: number;

    private lastPos: { x: number; y: number } | null = null;

    // DOM 元素引用
    private backdropEl?: HTMLElement;
    private badgeEl?: HTMLElement;
    private confirmBtnEl?: HTMLButtonElement;
    private stageEl?: HTMLElement;
    private canvasContainerEl?: HTMLElement;
    private zoomLabelEl?: HTMLElement;
    private undoBtnEl?: HTMLButtonElement;
    private redoBtnEl?: HTMLButtonElement;
    private bgCanvas?: HTMLCanvasElement;
    private maskCanvas?: HTMLCanvasElement;
    private overlayCanvas?: HTMLCanvasElement;
    private cursorRingEl?: HTMLElement;
    private promptInput?: HTMLTextAreaElement;
    private negPromptInput?: HTMLTextAreaElement;

    // 子组件引用
    private toolControl?: SegmentedControl;
    private brushInput?: NumberInput;
    private denoiseInput?: NumberInput;
    private blurInput?: NumberInput;

    private get isEraser(): boolean {
        return this.toolMode === 'eraser';
    }

    // 全局事件解绑器列表
    private readonly disposers: (() => void)[] = [];

    public constructor(options: InpaintModalOptions) {
        this.options = options;

        const prefs = loadPreferences();
        this.brushSize = Math.max(4, Math.min(160, prefs.brushSize ?? 25));
        this.denoiseStrength = Math.max(0.05, Math.min(1.0, prefs.denoiseStrength ?? 0.75));
        this.maskBlur = Math.max(0, Math.min(32, prefs.maskBlur ?? 4));

        this.renderDom();
    }

    /**
     * 构建与渲染模态画板 DOM 结构。
     */
    private renderDom(): void {
        if (typeof document === 'undefined') {
            return;
        }

        // 1. 全屏背景遮罩
        const backdrop = document.createElement('div');
        backdrop.className = 'da-inpaint-backdrop da-modal-backdrop da-modal-backdrop--fullscreen st-da-root';
        this.backdropEl = backdrop;

        // 2. 居中面板容器
        const panel = document.createElement('div');
        panel.className = 'da-inpaint-modal-panel';
        backdrop.appendChild(panel);

        // 3. 头部顶栏
        const header = document.createElement('div');
        header.className = 'da-inpaint-header';

        const title = document.createElement('div');
        title.className = 'da-inpaint-title';
        title.innerHTML = `${renderIcon('brush', 16)}<span>局部重绘画板</span>`;

        const badge = document.createElement('span');
        badge.className = 'da-inpaint-badge';
        badge.textContent = '加载中...';
        this.badgeEl = badge;
        title.appendChild(badge);
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-btn da-btn--ghost da-btn--sm';
        closeBtn.innerHTML = renderIcon('close', 14);
        closeBtn.title = '关闭 (Esc)';
        closeBtn.onclick = () => this.handleCancel();
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // 4. 双栏主体
        const body = document.createElement('div');
        body.className = 'da-inpaint-body';

        // 4.1 左侧工作台 (Workbench)
        const workbench = document.createElement('div');
        workbench.className = 'da-inpaint-workbench';

        // 4.1.1 顶部绘图工具条
        const toolbar = document.createElement('div');
        toolbar.className = 'da-inpaint-toolbar';

        const toolGroupLeft = document.createElement('div');
        toolGroupLeft.className = 'da-inpaint-tool-group';

        // 模式切换胶囊分段条
        this.toolControl = new SegmentedControl({
            value: this.toolMode,
            options: [
                { value: 'brush', label: '画笔' },
                { value: 'eraser', label: '橡皮擦' },
                { value: 'pan', label: '平移' },
            ],
            onChange: (val) => {
                this.toolMode = val as 'brush' | 'eraser' | 'pan';
                this.updateStageCursor();
                this.updateCursorRing();
            },
        });
        toolGroupLeft.appendChild(this.toolControl.element);

        const divider = document.createElement('div');
        divider.className = 'da-inpaint-toolbar-divider';
        toolGroupLeft.appendChild(divider);

        // 画笔大小调节数值框
        const brushControl = document.createElement('div');
        brushControl.className = 'da-inpaint-brush-control da-inpaint-tool-label';
        const brushLabel = document.createElement('span');
        brushLabel.className = 'da-inpaint-brush-label';
        brushLabel.textContent = '大小';
        brushControl.appendChild(brushLabel);

        this.brushInput = new NumberInput({
            min: 4,
            max: 160,
            step: 1,
            precision: 0,
            unit: 'px',
            value: this.brushSize,
            onChange: (val) => {
                this.brushSize = val;
                this.updateCursorRing();
            },
        });
        brushControl.appendChild(this.brushInput.element);
        toolGroupLeft.appendChild(brushControl);
        toolbar.appendChild(toolGroupLeft);

        // 工具栏右侧动作组（撤销 / 重做 / 清空蒙版）
        const toolGroupRight = document.createElement('div');
        toolGroupRight.className = 'da-inpaint-tool-actions';

        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'da-btn da-btn--ghost da-btn--sm';
        undoBtn.title = '撤销 (Ctrl+Z)';
        undoBtn.setAttribute('aria-label', '撤销');
        undoBtn.disabled = true;
        undoBtn.innerHTML = `${renderIcon('undo', 13)}<span>撤销</span>`;
        undoBtn.onclick = () => this.undo();
        this.undoBtnEl = undoBtn;
        toolGroupRight.appendChild(undoBtn);

        const redoBtn = document.createElement('button');
        redoBtn.type = 'button';
        redoBtn.className = 'da-btn da-btn--ghost da-btn--sm';
        redoBtn.title = '重做 (Ctrl+Y / Ctrl+Shift+Z)';
        redoBtn.setAttribute('aria-label', '重做');
        redoBtn.disabled = true;
        redoBtn.innerHTML = `${renderIcon('redo', 13)}<span>重做</span>`;
        redoBtn.onclick = () => this.redo();
        this.redoBtnEl = redoBtn;
        toolGroupRight.appendChild(redoBtn);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'da-btn da-btn--ghost da-btn--sm';
        clearBtn.innerHTML = `${renderIcon('trash', 13)}<span>清空蒙版</span>`;
        clearBtn.onclick = () => this.clearMask();
        toolGroupRight.appendChild(clearBtn);

        toolbar.appendChild(toolGroupRight);
        workbench.appendChild(toolbar);

        // 4.1.2 画布舞台容器
        const stage = document.createElement('div');
        stage.className = 'da-inpaint-stage';
        this.stageEl = stage;

        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'da-inpaint-canvas-container';
        this.canvasContainerEl = canvasContainer;

        const bgCanvas = document.createElement('canvas');
        bgCanvas.className = 'da-inpaint-bg-canvas';
        this.bgCanvas = bgCanvas;
        canvasContainer.appendChild(bgCanvas);

        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.className = 'da-inpaint-overlay-canvas';
        this.overlayCanvas = overlayCanvas;
        canvasContainer.appendChild(overlayCanvas);

        stage.appendChild(canvasContainer);

        // 随动光圈光标置于舞台外层，避免随画布缩放发生描边加粗
        const cursorRing = document.createElement('div');
        cursorRing.className = 'da-inpaint-cursor-ring';
        this.cursorRingEl = cursorRing;
        stage.appendChild(cursorRing);

        // 右下角视图缩放控制胶囊
        const zoomCapsule = document.createElement('div');
        zoomCapsule.className = 'da-inpaint-zoom-capsule';

        const zoomOutBtn = document.createElement('button');
        zoomOutBtn.type = 'button';
        zoomOutBtn.className = 'da-inpaint-zoom-btn';
        zoomOutBtn.title = '缩小视图';
        zoomOutBtn.setAttribute('aria-label', '缩小视图');
        zoomOutBtn.innerHTML = renderIcon('zoomOut', 12);
        zoomOutBtn.onclick = (e) => {
            e.stopPropagation();
            this.adjustZoom(-0.25);
        };
        zoomCapsule.appendChild(zoomOutBtn);

        const zoomResetBtn = document.createElement('button');
        zoomResetBtn.type = 'button';
        zoomResetBtn.className = 'da-inpaint-zoom-btn da-inpaint-zoom-btn--reset';
        zoomResetBtn.title = '重置 100% 视图';
        zoomResetBtn.setAttribute('aria-label', '重置视图');
        zoomResetBtn.textContent = '100%';
        zoomResetBtn.onclick = (e) => {
            e.stopPropagation();
            this.resetView();
        };
        this.zoomLabelEl = zoomResetBtn;
        zoomCapsule.appendChild(zoomResetBtn);

        const zoomInBtn = document.createElement('button');
        zoomInBtn.type = 'button';
        zoomInBtn.className = 'da-inpaint-zoom-btn';
        zoomInBtn.title = '放大视图';
        zoomInBtn.setAttribute('aria-label', '放大视图');
        zoomInBtn.innerHTML = renderIcon('zoomIn', 12);
        zoomInBtn.onclick = (e) => {
            e.stopPropagation();
            this.adjustZoom(0.25);
        };
        zoomCapsule.appendChild(zoomInBtn);

        stage.appendChild(zoomCapsule);
        workbench.appendChild(stage);

        // 4.1.3 底部快捷键指示
        const hint = document.createElement('div');
        hint.className = 'da-inpaint-stage-hint';
        hint.textContent =
            '左键涂抹 · 滚轮缩放画布 · Alt/Shift+滚轮调画笔 · 空格拖拽/中右键平移 · Ctrl+Z/Y 撤销重做 · Ctrl+Enter 提交';
        workbench.appendChild(hint);

        body.appendChild(workbench);

        // 4.2 右侧检查器 (Inspector)
        const inspector = document.createElement('div');
        inspector.className = 'da-inpaint-inspector';

        const inspectorContent = document.createElement('div');
        inspectorContent.className = 'da-inpaint-inspector-content';

        // 4.2.1 重绘技术参数组
        const paramsSection = document.createElement('div');
        paramsSection.className = 'da-inpaint-section';

        const paramsTitle = document.createElement('div');
        paramsTitle.className = 'da-inpaint-section-title';
        paramsTitle.innerHTML = `${renderIcon('sliders', 12)}<span>重绘参数</span>`;
        paramsSection.appendChild(paramsTitle);

        // 重绘幅度
        const denoiseGroup = document.createElement('div');
        denoiseGroup.className = 'da-inpaint-field-group';
        const denoiseHeader = document.createElement('div');
        denoiseHeader.className = 'da-inpaint-field-header';
        const denoiseLabel = document.createElement('span');
        denoiseLabel.className = 'da-inpaint-field-label';
        denoiseLabel.textContent = '重绘幅度 (Denoise)';
        const denoiseNote = document.createElement('span');
        denoiseNote.className = 'da-inpaint-field-note';
        denoiseNote.textContent = '0.05~1.00';
        denoiseHeader.appendChild(denoiseLabel);
        denoiseHeader.appendChild(denoiseNote);
        denoiseGroup.appendChild(denoiseHeader);

        this.denoiseInput = new NumberInput({
            min: 0.05,
            max: 1.0,
            step: 0.01,
            precision: 2,
            value: this.denoiseStrength,
            onChange: (val) => {
                this.denoiseStrength = val;
            },
        });
        denoiseGroup.appendChild(this.denoiseInput.element);
        paramsSection.appendChild(denoiseGroup);

        // 蒙版羽化
        const blurGroup = document.createElement('div');
        blurGroup.className = 'da-inpaint-field-group';
        const blurHeader = document.createElement('div');
        blurHeader.className = 'da-inpaint-field-header';
        const blurLabel = document.createElement('span');
        blurLabel.className = 'da-inpaint-field-label';
        blurLabel.textContent = '蒙版羽化 (Mask Blur)';
        const blurNote = document.createElement('span');
        blurNote.className = 'da-inpaint-field-note';
        blurNote.textContent = '边缘柔化';
        blurHeader.appendChild(blurLabel);
        blurHeader.appendChild(blurNote);
        blurGroup.appendChild(blurHeader);

        this.blurInput = new NumberInput({
            min: 0,
            max: 32,
            step: 1,
            precision: 0,
            unit: 'px',
            value: this.maskBlur,
            onChange: (val) => {
                this.maskBlur = val;
            },
        });
        blurGroup.appendChild(this.blurInput.element);
        paramsSection.appendChild(blurGroup);

        inspectorContent.appendChild(paramsSection);

        // 4.2.2 提示词编辑组
        const promptSection = document.createElement('div');
        promptSection.className = 'da-inpaint-section';

        const promptTitle = document.createElement('div');
        promptTitle.className = 'da-inpaint-section-title';
        promptTitle.innerHTML = `${renderIcon('edit', 12)}<span>重绘提示词</span>`;
        promptSection.appendChild(promptTitle);

        // 正向提示词
        const promptGroup = document.createElement('div');
        promptGroup.className = 'da-inpaint-field-group';
        const promptLabel = document.createElement('span');
        promptLabel.className = 'da-inpaint-field-label';
        promptLabel.textContent = '正向描述';
        promptGroup.appendChild(promptLabel);

        const promptInput = document.createElement('textarea');
        promptInput.className = 'da-inpaint-textarea';
        promptInput.rows = 4;
        promptInput.value = this.options.initialPrompt || '';
        promptInput.placeholder = '输入针对涂抹选区的局部重绘描述...';
        this.promptInput = promptInput;
        promptGroup.appendChild(promptInput);
        promptSection.appendChild(promptGroup);

        // 负向提示词（遵循当前激活引擎能力）
        const activeProvider = settingsStore.getSettings().activeProvider;
        const supportsNegative = providerRegistry.getProvider(activeProvider)?.supportsNegativePrompt !== false;
        const negGroup = document.createElement('div');
        negGroup.className = 'da-inpaint-field-group';
        if (!supportsNegative) {
            negGroup.style.display = 'none';
        }
        const negLabel = document.createElement('span');
        negLabel.className = 'da-inpaint-field-label';
        negLabel.textContent = '负向过滤 (可选)';
        negGroup.appendChild(negLabel);

        const negPromptInput = document.createElement('textarea');
        negPromptInput.className = 'da-inpaint-textarea';
        negPromptInput.rows = 2;
        negPromptInput.value = supportsNegative ? this.options.initialNegativePrompt || '' : '';
        negPromptInput.placeholder = '过滤不需要的内容...';
        this.negPromptInput = negPromptInput;
        negGroup.appendChild(negPromptInput);
        promptSection.appendChild(negGroup);

        inspectorContent.appendChild(promptSection);
        inspector.appendChild(inspectorContent);

        // 4.2.3 底部操作动作栏
        const footer = document.createElement('div');
        footer.className = 'da-inpaint-inspector-footer da-inpaint-footer';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        cancelBtn.textContent = '取消';
        cancelBtn.onclick = () => this.handleCancel();
        footer.appendChild(cancelBtn);

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'da-btn da-btn--primary da-btn--sm';
        confirmBtn.innerHTML = `${renderIcon('sparkles', 13)}<span>确认重绘</span>`;
        confirmBtn.onclick = () => void this.handleConfirm();
        this.confirmBtnEl = confirmBtn;
        footer.appendChild(confirmBtn);

        inspector.appendChild(footer);
        body.appendChild(inspector);

        panel.appendChild(body);

        // 5. 挂载至 document.body
        document.body.appendChild(backdrop);

        // 6. 初始化离屏掩码画布
        this.maskCanvas = document.createElement('canvas');

        // 7. 初始化画布图像与事件监听
        this.initImage();
        this.bindCanvasEvents();

        // 8. 注册层级管理与 Esc 监听
        overlayStack.push('inpaint-modal', () => this.handleCancel(), () => this.dispose());

        // 9. 遮罩背景点击退出
        this.disposers.push(bindBackdropDismiss(backdrop, () => this.handleCancel()));

        // 10. 绑定全局快捷键 Ctrl+Enter、Ctrl+Z/Y 撤销重做与空格临时平移
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void this.handleConfirm();
                return;
            }
            const target = e.target as HTMLElement | null;
            const isEditingText =
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLInputElement ||
                Boolean(target?.isContentEditable);
            if (isEditingText) {
                return;
            }
            const keyLower = e.key.toLowerCase();
            if ((e.ctrlKey || e.metaKey) && keyLower === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.redo();
                } else {
                    this.undo();
                }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && keyLower === 'y') {
                e.preventDefault();
                this.redo();
                return;
            }
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                if (!this.isSpacePressed) {
                    this.isSpacePressed = true;
                    this.updateStageCursor();
                    this.updateCursorRing();
                }
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space' || e.key === ' ') {
                if (this.isSpacePressed) {
                    this.isSpacePressed = false;
                    this.updateStageCursor();
                    this.updateCursorRing();
                }
            }
        };
        const onWindowBlur = () => {
            this.isSpacePressed = false;
            this.isPanning = false;
            this.isDrawing = false;
            this.lastPos = null;
            this.updateStageCursor();
            this.updateCursorRing();
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onWindowBlur);
        this.disposers.push(() => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onWindowBlur);
        });
    }

    /**
     * 载入底图并在画布上完成初始化排版与掩码重置。
     */
    private initImage(): void {
        if (!this.bgCanvas || !this.maskCanvas || !this.overlayCanvas) {
            return;
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            if (this.isDisposed || !this.bgCanvas || !this.maskCanvas || !this.overlayCanvas) {
                return;
            }

            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;

            if (this.badgeEl) {
                this.badgeEl.textContent = `${width} × ${height}`;
            }

            this.bgCanvas.width = width;
            this.bgCanvas.height = height;
            this.maskCanvas.width = width;
            this.maskCanvas.height = height;
            this.overlayCanvas.width = width;
            this.overlayCanvas.height = height;

            // 绘制底图
            const bgCtx = this.bgCanvas.getContext('2d');
            if (bgCtx) {
                bgCtx.drawImage(img, 0, 0);
            }

            // 初始化离屏掩码画布：全黑填充（#000000 代表全部保留）
            const maskCtx = this.maskCanvas.getContext('2d');
            if (maskCtx) {
                maskCtx.fillStyle = '#000000';
                maskCtx.fillRect(0, 0, width, height);
            }

            // 清理预览选区画布
            const overlayCtx = this.overlayCanvas.getContext('2d');
            if (overlayCtx) {
                overlayCtx.clearRect(0, 0, width, height);
            }

            // 重置历史快照并写入初始干净状态，同时重置缩放视角
            this.historyStack = [];
            this.historyIndex = -1;
            this.pushHistorySnapshot();
            this.resetView();

            // 依据画布实际显示尺寸同步顶层覆盖层样式
            this.syncCanvasLayout();
        };

        let fallbackAttempted = false;
        img.onerror = async (err) => {
            if (this.isDisposed) {
                return;
            }
            if (!fallbackAttempted && this.options.imageId) {
                fallbackAttempted = true;
                try {
                    const blob = await imageStorage.getImageBlob(this.options.imageId);
                    if (this.isDisposed) {
                        return;
                    }
                    if (blob && blob.size > 0) {
                        const objUrl = URL.createObjectURL(blob);
                        this.disposers.push(() => URL.revokeObjectURL(objUrl));
                        img.src = objUrl;
                        return;
                    }
                } catch (fallbackErr) {
                    logger.warn('[InpaintModal] 本地 Blob 回退恢复失败:', fallbackErr);
                }
            }
            if (this.isDisposed) {
                return;
            }
            reportRuntimeError(
                '[InpaintModal] 底图加载失败:',
                '底图加载失败，请检查网络或在「日志与统计」查看详情',
                err
            );
            this.handleCancel();
        };

        img.src = this.options.imageSrc;
    }

    /**
     * 同步顶层交互画布与底层展示画布的未缩放视口布局尺寸。
     */
    private syncCanvasLayout(): void {
        if (!this.bgCanvas || !this.overlayCanvas) return;
        const w = this.bgCanvas.clientWidth;
        const h = this.bgCanvas.clientHeight;
        if (w > 0 && h > 0) {
            this.overlayCanvas.style.width = `${w}px`;
            this.overlayCanvas.style.height = `${h}px`;
        }
        this.updateCursorRing();
    }

    private updateStageCursor(): void {
        if (!this.stageEl) return;
        const panMode = this.toolMode === 'pan' || this.isSpacePressed;
        this.stageEl.classList.toggle('is-pan-mode', panMode);
        this.stageEl.classList.toggle('is-panning', this.isPanning);
    }

    private applyViewTransform(): void {
        if (this.canvasContainerEl) {
            const maxX = Math.max(240, (this.canvasContainerEl.offsetWidth || 400) * this.zoom * 0.85);
            const maxY = Math.max(240, (this.canvasContainerEl.offsetHeight || 400) * this.zoom * 0.85);
            this.panX = Math.max(-maxX, Math.min(maxX, this.panX));
            this.panY = Math.max(-maxY, Math.min(maxY, this.panY));
            this.canvasContainerEl.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.zoom})`;
        }
        if (this.zoomLabelEl) {
            this.zoomLabelEl.textContent = `${Math.round(this.zoom * 100)}%`;
        }
    }

    private setZoomAtPoint(nextZoom: number, clientX?: number, clientY?: number): void {
        const clamped = Math.max(0.5, Math.min(5.0, Math.round(nextZoom * 1000) / 1000));
        if (clientX !== undefined && clientY !== undefined && this.stageEl && this.zoom > 0) {
            const stageRect = this.stageEl.getBoundingClientRect();
            const ox = clientX - (stageRect.left + stageRect.width / 2);
            const oy = clientY - (stageRect.top + stageRect.height / 2);
            const ratio = clamped / this.zoom;
            this.panX = ox - (ox - this.panX) * ratio;
            this.panY = oy - (oy - this.panY) * ratio;
        }
        this.zoom = clamped;
        this.applyViewTransform();
        this.updateCursorRing();
    }

    private adjustZoom(delta: number): void {
        const target = Math.round((this.zoom + delta) * 100) / 100;
        this.setZoomAtPoint(target);
    }

    private resetView(): void {
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyViewTransform();
        this.updateCursorRing();
    }

    private updateHistoryButtons(): void {
        if (this.undoBtnEl) {
            this.undoBtnEl.disabled = this.historyIndex <= 0;
        }
        if (this.redoBtnEl) {
            this.redoBtnEl.disabled = this.historyIndex >= this.historyStack.length - 1;
        }
    }

    private pushHistorySnapshot(): void {
        if (!this.overlayCanvas || !this.maskCanvas) return;
        const w = this.overlayCanvas.width;
        const h = this.overlayCanvas.height;
        if (w <= 0 || h <= 0) return;

        const overlayCtx = this.overlayCanvas.getContext('2d');
        const maskCtx = this.maskCanvas.getContext('2d');
        if (!overlayCtx || !maskCtx) return;

        const overlay = overlayCtx.getImageData(0, 0, w, h);
        const mask = maskCtx.getImageData(0, 0, w, h);
        if (this.historyIndex < this.historyStack.length - 1) {
            this.historyStack.length = this.historyIndex + 1;
        }
        this.historyStack.push({ overlay, mask });
        if (this.historyStack.length > this.maxHistory) {
            this.historyStack.shift();
        }
        this.historyIndex = this.historyStack.length - 1;
        this.updateHistoryButtons();
    }

    private applyHistorySnapshot(index: number): void {
        const snap = this.historyStack[index];
        if (!snap || !this.overlayCanvas || !this.maskCanvas) return;
        const overlayCtx = this.overlayCanvas.getContext('2d');
        const maskCtx = this.maskCanvas.getContext('2d');
        if (!overlayCtx || !maskCtx) return;

        overlayCtx.putImageData(snap.overlay, 0, 0);
        maskCtx.putImageData(snap.mask, 0, 0);
        this.historyIndex = index;
        this.updateHistoryButtons();
    }

    private undo(): void {
        if (this.historyIndex <= 0) return;
        this.applyHistorySnapshot(this.historyIndex - 1);
    }

    private redo(): void {
        if (this.historyIndex >= this.historyStack.length - 1) return;
        this.applyHistorySnapshot(this.historyIndex + 1);
    }

    /**
     * 更新随动光圈光标的位置、直径与显示状态。
     */
    private updateCursorRing(e?: MouseEvent): void {
        if (!this.cursorRingEl || !this.overlayCanvas || !this.stageEl) return;

        if (e) {
            const rect = this.stageEl.getBoundingClientRect();
            const relX = e.clientX - rect.left;
            const relY = e.clientY - rect.top;
            this.cursorRingEl.style.left = `${relX}px`;
            this.cursorRingEl.style.top = `${relY}px`;
        }

        const rect = this.overlayCanvas.getBoundingClientRect();
        const scale = rect.width / (this.overlayCanvas.width || 1);
        const displayDiameter = Math.max(6, this.brushSize * scale);

        this.cursorRingEl.style.width = `${displayDiameter}px`;
        this.cursorRingEl.style.height = `${displayDiameter}px`;

        this.cursorRingEl.classList.toggle('is-eraser', this.isEraser);
        this.cursorRingEl.classList.toggle(
            'is-pan-hidden',
            this.toolMode === 'pan' || this.isPanning || this.isSpacePressed
        );
    }

    /**
     * 清空当前所有绘制涂抹蒙版。
     */
    private clearMask(): void {
        if (this.overlayCanvas) {
            const overlayCtx = this.overlayCanvas.getContext('2d');
            if (overlayCtx) {
                overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            }
        }
        if (this.maskCanvas) {
            const maskCtx = this.maskCanvas.getContext('2d');
            if (maskCtx) {
                maskCtx.fillStyle = '#000000';
                maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
            }
        }
        this.pushHistorySnapshot();
        Toast.info('已清空重绘涂抹选区');
    }

    /**
     * 绑定画布鼠标、滚轮、缩放平移与触屏涂抹事件。
     */
    private bindCanvasEvents(): void {
        if (!this.overlayCanvas || !this.stageEl) return;

        const canvas = this.overlayCanvas;
        const stage = this.stageEl;

        const getPos = (e: MouseEvent | Touch): { x: number; y: number } => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / (rect.width || 1);
            const scaleY = canvas.height / (rect.height || 1);
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY,
            };
        };

        const handlePointerDown = (pos: { x: number; y: number }) => {
            if (this.historyStack.length === 0) {
                this.pushHistorySnapshot();
            }
            this.isDrawing = true;
            this.lastPos = pos;
            this.drawStroke(pos, pos);
        };

        const handlePointerMove = (pos: { x: number; y: number }) => {
            if (!this.isDrawing || !this.lastPos) return;
            this.drawStroke(this.lastPos, pos);
            this.lastPos = pos;
        };

        const handlePointerUp = () => {
            if (!this.isDrawing) return;
            this.isDrawing = false;
            this.lastPos = null;
            this.pushHistorySnapshot();
        };

        // 鼠标事件（画布绘制 + 中右键/空格/移动模式拖拽平移）
        const onMouseDown = (e: MouseEvent) => {
            if ((e.target as HTMLElement | null)?.closest('.da-inpaint-zoom-capsule')) {
                return;
            }
            const shouldPan =
                this.toolMode === 'pan' ||
                this.isSpacePressed ||
                e.button === 1 ||
                e.button === 2;
            if (shouldPan) {
                if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
                e.preventDefault();
                this.isPanning = true;
                this.panStartClientX = e.clientX;
                this.panStartClientY = e.clientY;
                this.panStartX = this.panX;
                this.panStartY = this.panY;
                this.updateStageCursor();
                this.updateCursorRing();
                return;
            }
            if (e.button !== 0) return;
            handlePointerDown(getPos(e));
        };
        const onMouseMove = (e: MouseEvent) => {
            this.pendingCursorEvent = e;
            if (this.cursorRingRafId === null) {
                this.cursorRingRafId = requestAnimationFrame(() => {
                    this.cursorRingRafId = null;
                    const evt = this.pendingCursorEvent;
                    this.pendingCursorEvent = null;
                    if (evt && !this.isDisposed) {
                        this.updateCursorRing(evt);
                    }
                });
            }
            if (this.isPanning) {
                this.panX = this.panStartX + (e.clientX - this.panStartClientX);
                this.panY = this.panStartY + (e.clientY - this.panStartClientY);
                this.applyViewTransform();
                return;
            }
            handlePointerMove(getPos(e));
        };
        const onMouseUp = () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.updateStageCursor();
                this.updateCursorRing();
            }
            handlePointerUp();
        };

        const onMouseEnter = () => {
            this.cursorRingEl?.classList.add('is-visible');
        };
        const onMouseLeave = () => {
            this.cursorRingEl?.classList.remove('is-visible');
        };
        const onContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };

        // 滚轮缩放画布，Alt/Shift + 滚轮微调画笔尺寸
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (e.altKey || e.shiftKey) {
                const delta = e.deltaY > 0 ? -2 : 2;
                const nextVal = Math.max(4, Math.min(160, this.brushSize + delta));
                if (nextVal !== this.brushSize) {
                    this.brushSize = nextVal;
                    this.brushInput?.setValue(nextVal, { silent: true });
                    this.updateCursorRing();
                }
                return;
            }
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            this.setZoomAtPoint(this.zoom * factor, e.clientX, e.clientY);
        };

        stage.addEventListener('mousedown', onMouseDown);
        stage.addEventListener('mouseenter', onMouseEnter);
        stage.addEventListener('mouseleave', onMouseLeave);
        stage.addEventListener('contextmenu', onContextMenu);
        stage.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        this.disposers.push(() => {
            if (this.cursorRingRafId !== null) {
                cancelAnimationFrame(this.cursorRingRafId);
                this.cursorRingRafId = null;
            }
            this.pendingCursorEvent = null;
            stage.removeEventListener('mousedown', onMouseDown);
            stage.removeEventListener('mouseenter', onMouseEnter);
            stage.removeEventListener('mouseleave', onMouseLeave);
            stage.removeEventListener('contextmenu', onContextMenu);
            stage.removeEventListener('wheel', onWheel);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        });

        // 触屏单指涂抹/平移与双指捏合缩放
        const getTouchCenterAndDist = (t1: Touch, t2: Touch) => ({
            dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
            center: {
                x: (t1.clientX + t2.clientX) / 2,
                y: (t1.clientY + t2.clientY) / 2,
            },
        });

        const onTouchStart = (e: TouchEvent) => {
            if ((e.target as HTMLElement | null)?.closest('.da-inpaint-zoom-capsule')) {
                return;
            }
            if (e.touches.length === 2) {
                e.preventDefault();
                handlePointerUp();
                this.isPanning = false;
                this.updateStageCursor();
                const { dist, center } = getTouchCenterAndDist(e.touches[0], e.touches[1]);
                this.pinchStartDist = Math.max(1, dist);
                this.pinchStartZoom = this.zoom;
                this.pinchLastCenter = center;
                return;
            }
            if (e.touches.length === 1) {
                e.preventDefault();
                const t = e.touches[0];
                if (this.toolMode === 'pan') {
                    this.isPanning = true;
                    this.panStartClientX = t.clientX;
                    this.panStartClientY = t.clientY;
                    this.panStartX = this.panX;
                    this.panStartY = this.panY;
                    this.updateStageCursor();
                } else {
                    handlePointerDown(getPos(t));
                }
            }
        };
        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 2 && this.pinchLastCenter) {
                e.preventDefault();
                const { dist, center } = getTouchCenterAndDist(e.touches[0], e.touches[1]);
                this.panX += center.x - this.pinchLastCenter.x;
                this.panY += center.y - this.pinchLastCenter.y;
                this.pinchLastCenter = center;
                const nextZoom = this.pinchStartZoom * (dist / Math.max(1, this.pinchStartDist));
                this.setZoomAtPoint(nextZoom, center.x, center.y);
                return;
            }
            if (e.touches.length === 1) {
                e.preventDefault();
                const t = e.touches[0];
                if (this.isPanning) {
                    this.panX = this.panStartX + (t.clientX - this.panStartClientX);
                    this.panY = this.panStartY + (t.clientY - this.panStartClientY);
                    this.applyViewTransform();
                } else {
                    handlePointerMove(getPos(t));
                }
            }
        };
        const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2) {
                this.pinchStartDist = 0;
                this.pinchLastCenter = null;
            }
            if (e.touches.length === 0) {
                if (this.isPanning) {
                    this.isPanning = false;
                    this.updateStageCursor();
                }
                handlePointerUp();
            }
        };

        stage.addEventListener('touchstart', onTouchStart, { passive: false });
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
        window.addEventListener('touchcancel', onTouchEnd);

        this.disposers.push(() => {
            stage.removeEventListener('touchstart', onTouchStart);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
            window.removeEventListener('touchcancel', onTouchEnd);
        });

        // 窗口与画布容器尺寸变化同步
        const onResize = () => this.syncCanvasLayout();
        window.addEventListener('resize', onResize);
        this.disposers.push(() => window.removeEventListener('resize', onResize));
        if (typeof ResizeObserver !== 'undefined' && this.bgCanvas) {
            const resizeObserver = new ResizeObserver(() => this.syncCanvasLayout());
            resizeObserver.observe(this.bgCanvas);
            this.disposers.push(() => resizeObserver.disconnect());
        }
    }

    /**
     * 在预览画布与离屏二值蒙版画布上同步绘制线条。
     */
    private drawStroke(from: { x: number; y: number }, to: { x: number; y: number }): void {
        if (!this.overlayCanvas || !this.maskCanvas) return;

        const overlayCtx = this.overlayCanvas.getContext('2d');
        const maskCtx = this.maskCanvas.getContext('2d');
        if (!overlayCtx || !maskCtx) return;

        // 1. 顶层半透明预览画布（半透明红色呈现涂抹区域）
        overlayCtx.save();
        overlayCtx.lineWidth = this.brushSize;
        overlayCtx.lineCap = 'round';
        overlayCtx.lineJoin = 'round';

        if (this.isEraser) {
            overlayCtx.globalCompositeOperation = 'destination-out';
        } else {
            overlayCtx.globalCompositeOperation = 'source-over';
            overlayCtx.strokeStyle = 'rgba(255, 60, 60, 0.45)';
            overlayCtx.fillStyle = 'rgba(255, 60, 60, 0.45)';
        }

        overlayCtx.beginPath();
        overlayCtx.moveTo(from.x, from.y);
        overlayCtx.lineTo(to.x, to.y);
        overlayCtx.stroke();
        overlayCtx.beginPath();
        overlayCtx.arc(to.x, to.y, this.brushSize / 2, 0, Math.PI * 2);
        overlayCtx.fill();
        overlayCtx.restore();

        // 2. 离屏标准二值 Mask 画布（黑色底景 #000000，白色选区 #ffffff）
        maskCtx.save();
        maskCtx.lineWidth = this.brushSize;
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';

        if (this.isEraser) {
            maskCtx.globalCompositeOperation = 'source-over';
            maskCtx.strokeStyle = '#000000';
            maskCtx.fillStyle = '#000000';
        } else {
            maskCtx.globalCompositeOperation = 'source-over';
            maskCtx.strokeStyle = '#ffffff';
            maskCtx.fillStyle = '#ffffff';
        }

        maskCtx.beginPath();
        maskCtx.moveTo(from.x, from.y);
        maskCtx.lineTo(to.x, to.y);
        maskCtx.stroke();
        maskCtx.beginPath();
        maskCtx.arc(to.x, to.y, this.brushSize / 2, 0, Math.PI * 2);
        maskCtx.fill();
        maskCtx.restore();
    }

    /**
     * 校验当前离屏蒙版画布是否存在至少一个非全黑有效涂抹像素。
     */
    private hasPaintedMask(): boolean {
        if (!this.maskCanvas || !this.bgCanvas) return false;
        const ctx = this.maskCanvas.getContext('2d');
        if (!ctx) {
            return true;
        }
        if (this.maskCanvas.width <= 0 || this.maskCanvas.height <= 0) {
            return false;
        }
        const data = ctx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height).data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * 确认并导出重绘数据。
     */
    private async handleConfirm(): Promise<void> {
        if (!this.maskCanvas || !this.bgCanvas) {
            Toast.error('画布尚未就绪');
            return;
        }

        const activeProvider = settingsStore.getSettings().activeProvider;
        const supportsNegative = providerRegistry.getProvider(activeProvider)?.supportsNegativePrompt !== false;
        const prompt = this.promptInput?.value.trim() ?? '';
        const negativePrompt = supportsNegative ? this.negPromptInput?.value.trim() || undefined : undefined;

        if (!prompt) {
            Toast.warning('重绘正向提示词不能为空');
            return;
        }

        if (!this.hasPaintedMask()) {
            Toast.warning('请先在画布上涂抹需要重绘的区域');
            return;
        }

        // 保存即时调节偏好至本地记忆
        savePreferences({
            brushSize: this.brushSize,
            denoiseStrength: this.denoiseStrength,
            maskBlur: this.maskBlur,
        });

        if (this.isDisposed || this.isSubmitting) {
            return;
        }
        this.isSubmitting = true;
        if (this.confirmBtnEl) {
            this.confirmBtnEl.disabled = true;
        }

        try {
            const maskBase64 = this.maskCanvas.toDataURL('image/png');
            const initBase64 = this.bgCanvas.toDataURL('image/png');

            const result: InpaintConfirmResult = {
                initImage: initBase64,
                maskImage: maskBase64,
                width: this.bgCanvas.width > 0 ? this.bgCanvas.width : undefined,
                height: this.bgCanvas.height > 0 ? this.bgCanvas.height : undefined,
                prompt,
                negativePrompt,
                denoiseStrength: this.denoiseStrength,
                maskBlur: this.maskBlur,
            };

            const confirmed = await this.options.onConfirm(result);
            if (confirmed === false) {
                return;
            }
            if (!this.isDisposed) {
                this.dispose();
            }
            Toast.success('已提交局部重绘任务');
        } catch (err) {
            reportRuntimeError(
                '[InpaintModal] 导出或提交局部重绘异常:',
                '提交局部重绘任务失败，请前往「日志与统计」查看详情',
                err
            );
        } finally {
            this.isSubmitting = false;
            if (this.confirmBtnEl && !this.isDisposed) {
                this.confirmBtnEl.disabled = false;
            }
        }
    }

    /**
     * 取消并关闭画板。
     */
    private handleCancel(): void {
        this.options.onCancel?.();
        this.dispose();
    }

    /**
     * 释放所有资源与 DOM 节点。
     */
    public dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;

        overlayStack.remove('inpaint-modal');

        for (const disposer of this.disposers) {
            try {
                disposer();
            } catch {
                // 忽略注销异常
            }
        }
        this.disposers.length = 0;

        if (this.toolControl) {
            this.toolControl.dispose();
            this.toolControl = undefined;
        }
        if (this.brushInput) {
            this.brushInput.dispose();
            this.brushInput = undefined;
        }
        if (this.denoiseInput) {
            this.denoiseInput.dispose();
            this.denoiseInput = undefined;
        }
        if (this.blurInput) {
            this.blurInput.dispose();
            this.blurInput = undefined;
        }

        if (this.backdropEl && this.backdropEl.parentNode) {
            this.backdropEl.parentNode.removeChild(this.backdropEl);
        }
        this.backdropEl = undefined;
        this.badgeEl = undefined;
        this.confirmBtnEl = undefined;
        this.stageEl = undefined;
        this.canvasContainerEl = undefined;
        this.zoomLabelEl = undefined;
        this.undoBtnEl = undefined;
        this.redoBtnEl = undefined;
        this.cursorRingEl = undefined;
        this.bgCanvas = undefined;
        this.maskCanvas = undefined;
        this.overlayCanvas = undefined;
        this.historyStack = [];
        this.historyIndex = -1;
    }
}

/**
 * 快捷打开局部重绘双层画板模态弹窗。
 *
 * @param options 重绘弹窗配置项
 * @returns 资源释放句柄
 */
export function openInpaintModal(options: InpaintModalOptions): Disposable {
    return new InpaintModal(options);
}
