/**
 * 宿主消息正文原生生图动作按钮组件 (FloorActionButton)。
 *
 * @remarks
 * 组件职责与状态机规范：
 * 1. 纯视觉状态机模型：ready (就绪) -> pending (排队中) -> generating (生成中) -> done (完成) / error (失败)；
 * 2. 交互分流：
 *    - 空闲/终态 (ready / done / error)：点击触发 onTrigger 提交任务；
 *    - 进行态 (pending / generating)：点击触发 onCancel 委托取消任务；
 * 3. 边界解耦：不直接依赖具体的后台 TaskId 或网络通信细节，仅通过状态变更驱动按钮视觉图标与文本更新。
 */

import type { UIComponent } from '../types';

/** 楼层生图按钮视觉状态流转定义 */
export type FloorButtonState = 'ready' | 'pending' | 'generating' | 'done' | 'error';

/** 楼层生图按钮配置参数 */
export interface FloorActionButtonOptions {
    /** 绑定的会话唯一标识符 */
    chatId: string;
    /** 绑定的楼层消息数字索引 */
    messageId: number;
    /** 绑定的绘图指令插槽序号 (默认 0) */
    instructionIndex?: number;
    /** 触发绘图回调函数 */
    onTrigger?: () => Promise<void | string | undefined> | void | string | undefined;
    /** 取消当前任务回调函数 */
    onCancel?: () => void;
}

export class FloorActionButton implements UIComponent {
    public readonly element: HTMLElement;
    public readonly buttonElement: HTMLButtonElement;

    private readonly iconSpan: HTMLSpanElement;
    private readonly textSpan: HTMLSpanElement;
    private readonly spinnerSpan: HTMLSpanElement;

    private state: FloorButtonState = 'ready';
    private clickHandler: (() => void) | null = null;

    public constructor(private readonly options: FloorActionButtonOptions) {
        this.element = document.createElement('div');
        this.element.className = 'da-floor-action-wrapper';

        this.buttonElement = document.createElement('button');
        this.buttonElement.type = 'button';
        this.buttonElement.className = 'da-floor-action-btn';

        this.iconSpan = document.createElement('span');
        this.iconSpan.className = 'da-floor-action-btn__icon';
        this.iconSpan.textContent = '🎨';

        this.spinnerSpan = document.createElement('span');
        this.spinnerSpan.className = 'da-floor-action-btn__spinner';
        this.spinnerSpan.style.display = 'none';

        this.textSpan = document.createElement('span');
        this.textSpan.className = 'da-floor-action-btn__text';
        this.textSpan.textContent = '开始绘图';

        this.buttonElement.appendChild(this.iconSpan);
        this.buttonElement.appendChild(this.spinnerSpan);
        this.buttonElement.appendChild(this.textSpan);

        this.element.appendChild(this.buttonElement);

        this.bindUserInteractions();
    }

    private bindUserInteractions(): void {
        this.clickHandler = async () => {
            if (this.state === 'ready' || this.state === 'error' || this.state === 'done') {
                this.setState('pending');
                try {
                    await this.options.onTrigger?.();
                } catch {
                    this.setState('error', '触发失败，点击重试');
                }
            } else if ((this.state === 'pending' || this.state === 'generating') && this.options.onCancel) {
                try {
                    this.options.onCancel();
                } catch {
                    // 忽略取消回调内部异常
                }
            }
        };

        this.buttonElement.addEventListener('click', this.clickHandler);
    }


    /**
     * 获取当前按钮的状态机状态。
     */
    public getState(): FloorButtonState {
        return this.state;
    }

    /**
     * 切换按钮的展示状态与文案。
     *
     * @param state 目标状态
     * @param customText 可选的覆盖文案
     */
    public setState(state: FloorButtonState, customText?: string): void {
        this.state = state;

        this.buttonElement.classList.remove(
            'da-floor-action-btn--generating',
            'da-floor-action-btn--done',
            'da-floor-action-btn--error'
        );

        switch (state) {
            case 'ready':
                this.iconSpan.style.display = '';
                this.spinnerSpan.style.display = 'none';
                this.textSpan.textContent = customText || '开始绘图';
                break;
            case 'pending':
                this.iconSpan.style.display = '';
                this.iconSpan.textContent = '⏳';
                this.spinnerSpan.style.display = 'none';
                this.textSpan.textContent = customText || '排队中... [点击取消]';
                break;
            case 'generating':
                this.buttonElement.classList.add('da-floor-action-btn--generating');
                this.iconSpan.style.display = 'none';
                this.spinnerSpan.style.display = '';
                this.textSpan.textContent = customText || '正在生成... [点击取消]';
                break;
            case 'done':
                this.buttonElement.classList.add('da-floor-action-btn--done');
                this.spinnerSpan.style.display = 'none';
                this.iconSpan.style.display = '';
                this.iconSpan.textContent = '🔄';
                this.textSpan.textContent = customText || '重新生成';
                break;
            case 'error':
                this.buttonElement.classList.add('da-floor-action-btn--error');
                this.spinnerSpan.style.display = 'none';
                this.iconSpan.style.display = '';
                this.iconSpan.textContent = '⚠️';
                this.textSpan.textContent = customText || '生成失败，点击重试';
                break;
        }
    }

    /**
     * 设置按钮的禁用状态。
     */
    public setDisabled(disabled: boolean): void {
        this.buttonElement.disabled = disabled;
    }

    /**
     * 释放事件监听器与 DOM 节点引用。
     */
    public dispose(): void {
        if (this.clickHandler) {
            this.buttonElement.removeEventListener('click', this.clickHandler);
            this.clickHandler = null;
        }
        this.element.remove();
    }
}
