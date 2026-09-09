/**
 * 选项卡视图基类与生命周期契约 (ITabView / ISection / BaseTabView)
 * 规范选项卡面板与子分区的生命周期管理，统一响应 dispose() 销毁事件。
 * 遵循状态驱动模式，视图通过 Store 与 FormRenderer 渲染，不私自保留持久化业务状态。
 * BaseTabView 提供受管根容器 _root 与 DisposableStore 资源池，供主设置弹窗统一调度级联销毁。
 */

import { IDisposable, DisposableStore } from '../../types';

/**
 * 选项卡面板视图统一接口
 */
export interface ITabView extends IDisposable {
    /** 视图根 DOM 元素 */
    readonly element: HTMLElement;
    /** 视图被切入激活时的可选生命周期钩子 */
    onActivated?(): void;
    /** 视图被切出失活时的可选生命周期钩子 */
    onDeactivated?(): void;
}

/**
 * 卡片/独立子分区通用生命周期接口
 */
export interface ISection extends IDisposable {
    /** 子分区根 DOM 元素 */
    readonly element: HTMLElement;
}

/**
 * 选项卡面板视图抽象基类 (BaseTabView)
 *
 * 封装根容器节点与 `DisposableStore`，统一管理 DOM 挂载、事件订阅及子组件的级联清理。
 */
export abstract class BaseTabView implements ITabView {
    /** 内部受管资源存储池，dispose 时自动级联释放所有注册的监听器与子组件 */
    protected readonly _disposables = new DisposableStore();
    /** 视图根容器节点 */
    protected readonly _root: HTMLElement;

    /**
     * 创建选项卡视图实例
     * @param className 附加到根容器的自定义 CSS 类名 (如 'da-general-tab')
     */
    constructor(className?: string) {
        this._root = document.createElement('div');
        this._root.className = `da-tab-pane ${className ?? ''}`.trim();
    }

    /** 获取视图根 DOM 元素 */
    get element(): HTMLElement {
        return this._root;
    }

    /** 注册并挂载子 Section，自动接入统一的 dispose 级联释放链 */
    protected _addSection(section: ISection): void {
        this._root.appendChild(section.element);
        this._disposables.add(section);
    }

    onActivated?(): void;
    onDeactivated?(): void;

    /**
     * 释放当前视图持有的所有子组件、事件监听与定时器资源
     */
    dispose(): void {
        this._disposables.dispose();
    }
}
