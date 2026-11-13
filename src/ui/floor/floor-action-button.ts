/**
 * 楼层生图动作按钮组件 (FloorActionButton)。
 *
 * 负责在宿主消息中展示生图状态（就绪、排队、生成中、完成、失败）并分流用户点击交互：
 * - 空闲与完成态点击触发生图；
 * - 排队与生成中点击触发取消。
 */

import type { UIComponent } from '../types';
import { renderIcon } from '../components/icons';

/** 楼层生图按钮状态定义 */
export type FloorButtonState = 'ready' | 'pending' | 'generating' | 'done' | 'error';

/** 楼层生图按钮配置参数 */
export interface FloorActionButtonOptions {
    /** 绑定的会话唯一标识符 */
    chatId: string;
    /** 绑定的楼层消息数字索引 */
    messageId: number;
    /** 绑定的生图指令序号 (默认 0) */
    instructionIndex?: number;
    /** 触发生图回调函数，返回 false 表示被前置逻辑或用户取消拦截，自动回滚按钮原状态 */
    onTrigger?: () => Promise<void | string | boolean | undefined> | void | string | boolean | undefined;
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
    private lastTriggerTimestamp = 0;

    public constructor(private readonly options: FloorActionButtonOptions) {
        this.element = document.createElement('div');
        this.element.className = 'da-floor-action-wrapper';

        this.buttonElement = document.createElement('button');
        this.buttonElement.type = 'button';
        this.buttonElement.className = 'da-floor-action-btn';
        this.buttonElement.setAttribute('data-state', 'ready');

        this.iconSpan = document.createElement('span');
        this.iconSpan.className = 'da-floor-action-btn__icon';
        this.iconSpan.innerHTML = renderIcon('palette', 14);

        this.spinnerSpan = document.createElement('span');
        this.spinnerSpan.className = 'da-floor-action-btn__spinner';
        this.spinnerSpan.style.display = 'none';

        this.textSpan = document.createElement('span');
        this.textSpan.className = 'da-floor-action-btn__text';
        this.textSpan.textContent = '点击生图';

        this.buttonElement.appendChild(this.iconSpan);
        this.buttonElement.appendChild(this.spinnerSpan);
        this.buttonElement.appendChild(this.textSpan);

        this.element.appendChild(this.buttonElement);

        this.bindUserInteractions();
    }

    private bindUserInteractions(): void {
        this.clickHandler = async () => {
            if (this.state === 'ready' || this.state === 'error' || this.state === 'done') {
                const prevState = this.state;
                this.lastTriggerTimestamp = Date.now();
                this.setState('pending');
                try {
                    const result = await this.options.onTrigger?.();
                    if (result === false) {
                        this.setState(prevState);
                    }
                } catch {
                    this.setState('error', '生成失败，点击重试');
                }
            } else if ((this.state === 'pending' || this.state === 'generating') && this.options.onCancel) {
                // 防止快速双击误将刚入队的任务取消，设置 400ms 冷却时间
                if (Date.now() - this.lastTriggerTimestamp < 400) {
                    return;
                }
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
     * 获取当前按钮状态。
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
        this.buttonElement.setAttribute('data-state', state);

        this.buttonElement.classList.remove(
            'da-floor-action-btn--pending',
            'da-floor-action-btn--generating',
            'da-floor-action-btn--done',
            'da-floor-action-btn--error'
        );

        switch (state) {
            case 'ready':
                this.iconSpan.style.display = '';
                this.iconSpan.innerHTML = renderIcon('palette', 14);
                this.spinnerSpan.style.display = 'none';
                this.textSpan.textContent = customText || '点击生图';
                break;
            case 'pending':
                this.buttonElement.classList.add('da-floor-action-btn--pending');
                this.iconSpan.style.display = '';
                this.iconSpan.innerHTML = renderIcon('clock', 14);
                this.spinnerSpan.style.display = 'none';
                this.textSpan.textContent = customText || '排队中... (点击取消)';
                break;
            case 'generating':
                this.buttonElement.classList.add('da-floor-action-btn--generating');
                this.iconSpan.style.display = 'none';
                this.spinnerSpan.style.display = '';
                this.textSpan.textContent = customText || '正在生成... (点击取消)';
                break;
            case 'done':
                this.buttonElement.classList.add('da-floor-action-btn--done');
                this.spinnerSpan.style.display = 'none';
                this.iconSpan.style.display = '';
                this.iconSpan.innerHTML = renderIcon('refresh', 14);
                this.textSpan.textContent = customText || '重新生成';
                break;
            case 'error':
                this.buttonElement.classList.add('da-floor-action-btn--error');
                this.spinnerSpan.style.display = 'none';
                this.iconSpan.style.display = '';
                this.iconSpan.innerHTML = renderIcon('warning', 14);
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
