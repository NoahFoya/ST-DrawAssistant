/**
 * @module ui/foundation/tab-view
 * @description Tab 面板视图基类与生命周期接口定义 (ITabView / ISection / BaseTabView)
 *
 * 设计原则：
 * 1. 严格遵循生命周期释放原则：每个视图与内部卡片必须能完整响应 dispose()；
 * 2. 纯视图渲染与状态解耦：数据流由 Store 与 FormBinder 驱动；
 * 3. BaseTabView 提供统一的 DisposableStore 管理子 Section 与监听器。
 */

import { IDisposable, DisposableStore } from '../../core';

/**
 * Tab 面板视图统一接口
 */
export interface ITabView extends IDisposable {
    readonly element: HTMLElement;
    onActivated?(): void;
    onDeactivated?(): void;
}

/**
 * 卡片/独立分区生命周期接口
 */
export interface ISection extends IDisposable {
    readonly element: HTMLElement;
}

/**
 * Tab 面板视图抽象基类 (BaseTabView)
 *
 * 封装根容器节点与 DisposableStore，统一挂载与生命周期清理
 */
export abstract class BaseTabView implements ITabView {
    protected readonly _disposables = new DisposableStore();
    protected readonly _root: HTMLElement;

    constructor(className?: string) {
        this._root = document.createElement('div');
        this._root.className = `da-tab-pane ${className ?? ''}`.trim();
    }

    get element(): HTMLElement {
        return this._root;
    }

    /** 注册并挂载子 Section，自动接入统一的 dispose 释放链 */
    protected _addSection(section: ISection): void {
        this._root.appendChild(section.element);
        this._disposables.add(section);
    }

    onActivated?(): void;
    onDeactivated?(): void;

    dispose(): void {
        this._disposables.dispose();
    }
}
