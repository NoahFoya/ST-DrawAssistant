/**
 * 全局模态浮层层叠栈管理服务 (OverlayStackManager)。
 *
 * @remarks
 * 1. 采用后进先出（LIFO）栈统一管理多级模态弹窗（如主设置面板、二级编辑模态框、灯箱、图片详情与确认对话框）
 *    的 Escape 快捷键关闭顺序，确保单次按下 Escape 仅触发最顶层浮层关闭，不会联动关闭下层模态窗口。
 * 2. 联动维护根文档的 `da-has-active-modal` 滚动锁定类名：当任一模态弹窗活跃时阻止底层宿主聊天页连带滚动，
 *    栈归零或显式清空时同步恢复，避免多次开关导致滚动锁残留。
 */

interface OverlayStackEntry {
    readonly id: string;
    readonly onEscape: () => void;
    readonly onDispose?: () => void;
}

export class OverlayStackManager {
    private readonly stack: OverlayStackEntry[] = [];
    private readonly escapeGuards = new Set<() => boolean>();
    private keydownBound = false;

    private readonly handleKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape' || e.defaultPrevented || this.stack.length === 0) {
            return;
        }

        // 若当前存在未入栈的局部临时浮层（如自动补全、下拉候选）处于展开态，优先交由其处理 Escape
        for (const guard of this.escapeGuards) {
            try {
                if (guard()) {
                    return;
                }
            } catch {
                // 忽略守卫异常，继续检查栈顶模态窗口
            }
        }

        const top = this.stack[this.stack.length - 1];
        if (!top) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        top.onEscape();
    };

    /**
     * 注册非模态 Escape 拦截守卫；当任一守卫返回 true 时，本次 Escape 暂不关闭模态栈顶浮层。
     */
    public registerEscapeGuard(guard: () => boolean): () => void {
        this.escapeGuards.add(guard);
        return () => {
            this.escapeGuards.delete(guard);
        };
    }

    /**
     * 将模态浮层压入栈顶并注册 Escape 响应回调。
     *
     * @param id 浮层唯一标识
     * @param onEscape 按下 Escape 时的回调（若浮层关闭，需在关闭逻辑中调用返回的注销函数或 remove）
     * @returns 出栈注销函数
     */
    public push(id: string, onEscape: () => void, onDispose?: () => void): () => void {
        this.remove(id);
        this.stack.push({ id, onEscape, onDispose });
        this.ensureListener();
        this.syncRootModalState();
        return () => {
            this.remove(id);
        };
    }

    /**
     * 从栈中移除指定标识的浮层。
     *
     * @param id 浮层唯一标识
     */
    public remove(id: string): void {
        const idx = this.stack.findIndex((item) => item.id === id);
        if (idx !== -1) {
            this.stack.splice(idx, 1);
        }
        if (this.stack.length === 0) {
            this.unbindListener();
        }
        this.syncRootModalState();
    }

    /**
     * 判断指定浮层是否处于当前栈顶。
     *
     * @param id 浮层唯一标识
     * @returns 是否处于栈顶
     */
    public isTop(id: string): boolean {
        return this.stack.length > 0 && this.stack[this.stack.length - 1].id === id;
    }

    /**
     * 获取当前栈内活跃浮层数量。
     *
     * @returns 活跃浮层总数
     */
    public size(): number {
        return this.stack.length;
    }

    /**
     * 清空全部浮层栈并解绑全局监听（用于插件卸载或测试重置）。
     */
    public clear(): void {
        this.stack.length = 0;
        this.unbindListener();
        this.syncRootModalState();
    }

    /**
     * 卸载期间按从顶到底顺序调用各活跃浮层的清理回调，并清空管理栈
     */
    public disposeAll(): void {
        const snapshot = [...this.stack].reverse();
        this.clear();
        for (const entry of snapshot) {
            try {
                entry.onDispose?.();
            } catch {
                // ignore individual modal disposal errors during teardown
            }
        }
    }

    /**
     * 依据活跃模态栈深度同步根节点滚动隔离类名。
     */
    private syncRootModalState(): void {
        if (typeof document === 'undefined' || !document.documentElement) {
            return;
        }
        document.documentElement.classList.toggle('da-has-active-modal', this.stack.length > 0);
    }

    private ensureListener(): void {
        if (this.keydownBound || typeof window === 'undefined') {
            return;
        }
        window.addEventListener('keydown', this.handleKeyDown, false);
        this.keydownBound = true;
    }

    private unbindListener(): void {
        if (!this.keydownBound || typeof window === 'undefined') {
            return;
        }
        window.removeEventListener('keydown', this.handleKeyDown, false);
        this.keydownBound = false;
    }
}

export const overlayStack = new OverlayStackManager();

/**
 * 绑定遮罩背景点击关闭，防止框选或画笔拖出弹窗内容区时误关闭，同时兼容无指针预按下的程序化 click 触发。
 */
export function bindBackdropDismiss(backdrop: HTMLElement, onDismiss: () => void): () => void {
    let pointerDownOnBackdrop = false;

    const handlePointerDown = (e: PointerEvent) => {
        pointerDownOnBackdrop = e.target === backdrop;
    };

    const handleClick = (e: MouseEvent) => {
        const isSyntheticClick = e.detail === 0;
        const shouldDismiss = (pointerDownOnBackdrop || isSyntheticClick) && e.target === backdrop;
        pointerDownOnBackdrop = false;
        if (shouldDismiss) {
            onDismiss();
        }
    };

    backdrop.addEventListener('pointerdown', handlePointerDown);
    backdrop.addEventListener('click', handleClick);

    return () => {
        backdrop.removeEventListener('pointerdown', handlePointerDown);
        backdrop.removeEventListener('click', handleClick);
    };
}
