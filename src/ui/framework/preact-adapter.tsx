/**
 * Preact 视图容器与生命周期桥接器 (PreactAdapter)。
 *
 * @remarks
 * 为基于 Preact JSX 与 @preact/signals 构建的声明式视图提供统一的宿主挂载容器：
 * 1. 实现 SettingsView 与 UIComponent 接口，对接主设置面板与外部 DOM 挂载点；
 * 2. 结合 @preact/signals 的 effect 响应式追踪与 Preact render()，在状态变更时同步完成虚拟 DOM 比对与真实 DOM 更新；
 * 3. 在 dispose() 阶段调用 render(null, container) 自动卸载组件树并释放全部关联资源。
 */

import { render, options, type ComponentChildren } from 'preact';
import { effect, signal } from '@preact/signals';
import type { SettingsView, UIComponent, Disposable } from '../types';

// 启用同步重渲染批处理，确保状态与 Signal 变更后 DOM 在当前调用栈立即就绪
options.debounceRendering = (cb: () => void) => {
    cb();
};

/**
 * 基于 Preact + Signals 的通用 UI 组件基类。
 */
export abstract class PreactUIComponent implements UIComponent {
    public readonly element: HTMLElement;
    private disposeEffect: (() => void) | null = null;
    private isDisposed = false;
    private readonly renderTrigger = signal(0);

    protected constructor(tagName = 'div', className = '') {
        this.element = document.createElement(tagName);
        if (className) {
            this.element.className = className;
        }
    }

    /**
     * 子类实现：返回当前状态的 Preact JSX 节点树。
     * 在该方法内读取的任何 Signal 均会被自动追踪，并在变更时同步重渲染。
     */
    protected abstract renderContent(): ComponentChildren;

    /**
     * 启动响应式挂载。应在子类构造函数末尾调用。
     */
    protected mountPreact(): void {
        if (this.isDisposed) {
            return;
        }
        if (this.disposeEffect) {
            this.disposeEffect();
            this.disposeEffect = null;
        }
        const Root = () => {
            void this.renderTrigger.value;
            return <>{this.renderContent()}</>;
        };
        this.disposeEffect = effect(() => {
            void this.renderTrigger.value;
            render(<Root />, this.element);
        });
    }

    /**
     * 手动请求同步重渲染（当非 Signal 局部状态变化时可调用）。
     */
    protected requestUpdate(): void {
        if (!this.isDisposed) {
            this.renderTrigger.value++;
        }
    }

    /**
     * 子类可选覆盖：在组件销毁时执行额外的清理逻辑。
     */
    protected onDispose(): void {
        // 默认无额外清理
    }

    public dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;
        if (this.disposeEffect) {
            this.disposeEffect();
            this.disposeEffect = null;
        }
        this.onDispose();
        render(null, this.element);
        this.element.remove();
    }
}

/**
 * 基于 Preact + Signals 的设置选项卡视图基类。
 *
 * @remarks
 * 自动实现 SettingsView 的 id、title、element、activate、deactivate 与 dispose。
 */
export abstract class PreactSettingsView extends PreactUIComponent implements SettingsView {
    public abstract readonly id: string;
    public abstract readonly title: string;

    protected readonly extraDisposables: Disposable[] = [];

    protected constructor(paneClassName = '') {
        const trimmed = paneClassName.trim();
        const cls = trimmed
            ? trimmed.includes('da-tab-pane')
                ? trimmed
                : `da-tab-pane ${trimmed}`
            : 'da-tab-pane';
        super('div', cls);
    }

    /**
     * 注册需要随视图销毁自动释放的控制器或外部订阅资源。
     */
    protected registerDisposable<T extends Disposable>(item: T): T {
        this.extraDisposables.push(item);
        return item;
    }

    public activate(): void {
        this.onActivate();
        this.requestUpdate();
    }

    public deactivate(): void {
        this.onDeactivate();
    }

    /**
     * 子类可覆盖：当选项卡被激活显示时调用。
     */
    protected onActivate(): void {
        // 默认空实现
    }

    /**
     * 子类可覆盖：当选项卡切走或面板关闭时调用。
     */
    protected onDeactivate(): void {
        // 默认空实现
    }

    public override dispose(): void {
        this.deactivate();
        for (const item of this.extraDisposables) {
            try {
                item.dispose();
            } catch {
                // 忽略单个资源释放异常
            }
        }
        this.extraDisposables.length = 0;
        super.dispose();
    }
}
