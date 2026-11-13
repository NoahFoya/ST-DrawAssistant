/**
 * 全局模态浮层层叠栈管理服务 (OverlayStackManager)。
 *
 * @remarks
 * 采用后进先出（LIFO）栈统一管理多级模态弹窗（如主设置面板、二级编辑模态框、灯箱、图片详情与确认对话框）
 * 的 Escape 快捷键关闭顺序，确保单次按下 Escape 仅触发最顶层浮层关闭，不会联动关闭下层模态窗口。
 */

export interface OverlayStackEntry {
    readonly id: string;
    readonly onEscape: () => void;
}

export class OverlayStackManager {
    private readonly stack: OverlayStackEntry[] = [];
    private keydownBound = false;

    private readonly handleKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape' || e.defaultPrevented || this.stack.length === 0) {
            return;
        }

        // 若当前存在展开的标签补全下拉框或词库右键菜单，优先交由局部浮层处理
        if (
            typeof document !== 'undefined' &&
            document.querySelector('.da-autocomplete-popup--open, .da-lexicon-context-menu')
        ) {
            return;
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
     * 将模态浮层压入栈顶并注册 Escape 响应回调。
     *
     * @param id 浮层唯一标识
     * @param onEscape 按下 Escape 时的回调（若浮层关闭，需在关闭逻辑中调用返回的注销函数或 remove）
     * @returns 出栈注销函数
     */
    public push(id: string, onEscape: () => void): () => void {
        this.remove(id);
        this.stack.push({ id, onEscape });
        this.ensureListener();
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
