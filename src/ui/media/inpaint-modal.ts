/**
 * 局部重绘双层画布模态弹窗 (InpaintModal)。
 *
 * @remarks
 * 基于 Soft UI 规范提供 Canvas 遮罩涂抹与局部重绘参数配置能力：
 * 1. 采用双栏工作台布局：左侧承载画布舞台、工具条与快捷键指示；右侧承载重绘参数与提示词检查器；
 * 2. 离屏输出标准二值掩码（黑色底景 #000000 代表保留，白色选区 #ffffff 代表重绘）；
 * 3. 具备实时随动画笔光圈、画布滚轮快捷缩放、画笔与橡皮擦分段切换、一键清空及即时参数记忆；
 * 4. 支持 Ctrl+Enter 快捷提交与 Esc 退出，并在销毁时安全注销所有监听与引用。
 */

import type { Disposable } from '../types';
import { overlayStack } from '../framework/overlay-stack';
import { Slider } from '../components/slider';
import { SegmentedControl } from '../components/segmented-control';
import { renderIcon } from '../components/icons';
import { Toast } from '../feedback/toast';
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
    /** 初始正向提示词 */
    readonly initialPrompt?: string;
    /** 初始负向提示词 */
    readonly initialNegativePrompt?: string;
    /** 确认提交重绘回调 */
    readonly onConfirm: (data: InpaintConfirmResult) => Promise<void> | void;
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
    private isDrawing = false;
    private isEraser = false;

    // 参数状态
    private brushSize: number;
    private denoiseStrength: number;
    private maskBlur: number;

    private lastPos: { x: number; y: number } | null = null;

    // DOM 元素引用
    private backdropEl?: HTMLElement;
    private badgeEl?: HTMLElement;
    private canvasContainerEl?: HTMLElement;
    private bgCanvas?: HTMLCanvasElement;
    private maskCanvas?: HTMLCanvasElement;
    private overlayCanvas?: HTMLCanvasElement;
    private cursorRingEl?: HTMLElement;
    private promptInput?: HTMLTextAreaElement;
    private negPromptInput?: HTMLTextAreaElement;

    // 子组件引用
    private toolControl?: SegmentedControl;
    private brushSlider?: Slider;
    private denoiseSlider?: Slider;
    private blurSlider?: Slider;

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
        backdrop.className = 'da-inpaint-backdrop st-da-root';
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
            value: this.isEraser ? 'eraser' : 'brush',
            options: [
                { value: 'brush', label: '画笔' },
                { value: 'eraser', label: '橡皮擦' },
            ],
            onChange: (val) => {
                this.isEraser = val === 'eraser';
                this.updateCursorRing();
            },
        });
        toolGroupLeft.appendChild(this.toolControl.element);

        const divider = document.createElement('div');
        divider.className = 'da-inpaint-toolbar-divider';
        toolGroupLeft.appendChild(divider);

        // 画笔大小调节滑块
        const brushControl = document.createElement('div');
        brushControl.className = 'da-inpaint-brush-control da-inpaint-tool-label';
        const brushLabel = document.createElement('span');
        brushLabel.className = 'da-inpaint-brush-label';
        brushLabel.textContent = '大小';
        brushControl.appendChild(brushLabel);

        this.brushSlider = new Slider({
            min: 4,
            max: 160,
            step: 1,
            defaultValue: 25,
            unit: 'px',
            value: this.brushSize,
            onChange: (val) => {
                this.brushSize = val;
                this.updateCursorRing();
            },
        });
        brushControl.appendChild(this.brushSlider.element);
        toolGroupLeft.appendChild(brushControl);
        toolbar.appendChild(toolGroupLeft);

        // 清空蒙版按钮
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'da-btn da-btn--ghost da-btn--sm';
        clearBtn.innerHTML = `${renderIcon('trash', 13)}<span>清空蒙版</span>`;
        clearBtn.onclick = () => this.clearMask();
        toolbar.appendChild(clearBtn);

        workbench.appendChild(toolbar);

        // 4.1.2 画布舞台容器
        const stage = document.createElement('div');
        stage.className = 'da-inpaint-stage';

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

        // 随动光圈光标
        const cursorRing = document.createElement('div');
        cursorRing.className = 'da-inpaint-cursor-ring';
        this.cursorRingEl = cursorRing;
        canvasContainer.appendChild(cursorRing);

        stage.appendChild(canvasContainer);
        workbench.appendChild(stage);

        // 4.1.3 底部快捷键指示
        const hint = document.createElement('div');
        hint.className = 'da-inpaint-stage-hint';
        hint.textContent = '鼠标左键涂抹选区 · 滚轮调画笔 · Ctrl+Enter 提交 · Esc 退出';
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

        this.denoiseSlider = new Slider({
            min: 0.05,
            max: 1.00,
            step: 0.01,
            precision: 2,
            defaultValue: 0.75,
            value: this.denoiseStrength,
            onChange: (val) => {
                this.denoiseStrength = val;
            },
        });
        denoiseGroup.appendChild(this.denoiseSlider.element);
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

        this.blurSlider = new Slider({
            min: 0,
            max: 32,
            step: 1,
            defaultValue: 4,
            unit: 'px',
            value: this.maskBlur,
            onChange: (val) => {
                this.maskBlur = val;
            },
        });
        blurGroup.appendChild(this.blurSlider.element);
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

        // 负向提示词
        const negGroup = document.createElement('div');
        negGroup.className = 'da-inpaint-field-group';
        const negLabel = document.createElement('span');
        negLabel.className = 'da-inpaint-field-label';
        negLabel.textContent = '负向过滤 (可选)';
        negGroup.appendChild(negLabel);

        const negPromptInput = document.createElement('textarea');
        negPromptInput.className = 'da-inpaint-textarea';
        negPromptInput.rows = 2;
        negPromptInput.value = this.options.initialNegativePrompt || '';
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
        overlayStack.push('inpaint-modal', () => this.handleCancel());

        // 9. 遮罩背景点击退出
        backdrop.onclick = (e) => {
            if (e.target === backdrop) {
                this.handleCancel();
            }
        };

        // 10. 绑定全局快捷键 Ctrl+Enter
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void this.handleConfirm();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        this.disposers.push(() => window.removeEventListener('keydown', onKeyDown));
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

            // 依据画布实际显示尺寸同步顶层覆盖层样式
            this.syncCanvasLayout();
        };

        img.onerror = (err) => {
            logger.error('[InpaintModal] 底图加载失败:', err);
            Toast.error('底图加载失败，请检查网络或资源地址');
            this.handleCancel();
        };

        img.src = this.options.imageSrc;
    }

    /**
     * 同步顶层交互画布与底层展示画布的视口布局坐标。
     */
    private syncCanvasLayout(): void {
        if (!this.bgCanvas || !this.overlayCanvas) return;
        const rect = this.bgCanvas.getBoundingClientRect();
        this.overlayCanvas.style.width = `${rect.width}px`;
        this.overlayCanvas.style.height = `${rect.height}px`;
        this.updateCursorRing();
    }

    /**
     * 更新随动光圈光标的位置、直径与显示状态。
     */
    private updateCursorRing(e?: MouseEvent): void {
        if (!this.cursorRingEl || !this.overlayCanvas || !this.canvasContainerEl) return;

        if (e) {
            const rect = this.canvasContainerEl.getBoundingClientRect();
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

        if (this.isEraser) {
            this.cursorRingEl.classList.add('is-eraser');
        } else {
            this.cursorRingEl.classList.remove('is-eraser');
        }
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
        Toast.info('已清空重绘涂抹选区');
    }

    /**
     * 绑定画布鼠标、滚轮与触屏涂抹事件。
     */
    private bindCanvasEvents(): void {
        if (!this.overlayCanvas) return;

        const canvas = this.overlayCanvas;

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
            this.isDrawing = false;
            this.lastPos = null;
        };

        // 鼠标事件
        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            handlePointerDown(getPos(e));
        };
        const onMouseMove = (e: MouseEvent) => {
            this.updateCursorRing(e);
            handlePointerMove(getPos(e));
        };
        const onMouseUp = () => {
            handlePointerUp();
        };

        const onMouseEnter = () => {
            this.cursorRingEl?.classList.add('is-visible');
        };
        const onMouseLeave = () => {
            this.cursorRingEl?.classList.remove('is-visible');
        };

        // 滚轮缩放画笔大小
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -2 : 2;
            const nextVal = Math.max(4, Math.min(160, this.brushSize + delta));
            if (nextVal !== this.brushSize) {
                this.brushSize = nextVal;
                this.brushSlider?.setValue(nextVal, { silent: true });
                this.updateCursorRing();
            }
        };

        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mouseenter', onMouseEnter);
        canvas.addEventListener('mouseleave', onMouseLeave);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        this.disposers.push(() => {
            canvas.removeEventListener('mousedown', onMouseDown);
            canvas.removeEventListener('mouseenter', onMouseEnter);
            canvas.removeEventListener('mouseleave', onMouseLeave);
            canvas.removeEventListener('wheel', onWheel);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        });

        // 触屏事件
        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                handlePointerDown(getPos(e.touches[0]));
            }
        };
        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                handlePointerMove(getPos(e.touches[0]));
            }
        };
        const onTouchEnd = () => {
            handlePointerUp();
        };

        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);

        this.disposers.push(() => {
            canvas.removeEventListener('touchstart', onTouchStart);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
        });

        // 窗口缩放自适应同步
        const onResize = () => this.syncCanvasLayout();
        window.addEventListener('resize', onResize);
        this.disposers.push(() => window.removeEventListener('resize', onResize));
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
     * 确认并导出重绘数据。
     */
    private async handleConfirm(): Promise<void> {
        if (!this.maskCanvas || !this.bgCanvas) {
            Toast.error('画布尚未就绪');
            return;
        }

        const prompt = this.promptInput?.value.trim() ?? '';
        const negativePrompt = this.negPromptInput?.value.trim() || undefined;

        if (!prompt) {
            Toast.warning('重绘正向提示词不能为空');
            return;
        }

        // 保存即时调节偏好至本地记忆
        savePreferences({
            brushSize: this.brushSize,
            denoiseStrength: this.denoiseStrength,
            maskBlur: this.maskBlur,
        });

        try {
            const maskBase64 = this.maskCanvas.toDataURL('image/png');
            const initBase64 = this.bgCanvas.toDataURL('image/png');

            const result: InpaintConfirmResult = {
                initImage: initBase64,
                maskImage: maskBase64,
                prompt,
                negativePrompt,
                denoiseStrength: this.denoiseStrength,
                maskBlur: this.maskBlur,
            };

            this.dispose();

            await this.options.onConfirm(result);
            Toast.success('已提交局部重绘任务');
        } catch (err) {
            logger.error('[InpaintModal] 导出或提交局部重绘异常:', err);
            Toast.error('提交局部重绘任务失败');
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
        if (this.brushSlider) {
            this.brushSlider.dispose();
            this.brushSlider = undefined;
        }
        if (this.denoiseSlider) {
            this.denoiseSlider.dispose();
            this.denoiseSlider = undefined;
        }
        if (this.blurSlider) {
            this.blurSlider.dispose();
            this.blurSlider = undefined;
        }

        if (this.backdropEl && this.backdropEl.parentNode) {
            this.backdropEl.parentNode.removeChild(this.backdropEl);
        }
        this.backdropEl = undefined;
        this.badgeEl = undefined;
        this.canvasContainerEl = undefined;
        this.cursorRingEl = undefined;
        this.bgCanvas = undefined;
        this.maskCanvas = undefined;
        this.overlayCanvas = undefined;
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
