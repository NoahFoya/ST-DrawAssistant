/**
 * ST-DrawAssistant 楼层生图触发与状态反馈按钮组件。
 *
 * @remarks
 * 嵌入在聊天消息楼层绘图指令对应位置，承载触发绘图、排队/进度展示、
 * 点击取消与失败重试等完整业务状态流转。
 */

import type { BaseComponent } from '../components/types';
import { eventBus, type TaskStatusEventData } from '../../util/event-bus';
import type { TaskProgressInfo } from '@types';

export type FloorButtonState = 'ready' | 'pending' | 'progress' | 'done' | 'error';

export interface FloorActionButtonOptions {
    /** 绑定的会话标识符 */
    chatId: string;
    /** 绑定的楼层消息索引 */
    messageId: number;
    /** 绑定的插槽索引 (默认 0) */
    slotIndex?: number;
    /** 触发绘图回调 */
    onTrigger?: () => Promise<string | undefined> | string | undefined;
    /** 取消当前任务回调 */
    onCancel?: (taskId: string) => void;
}

export class FloorActionButton implements BaseComponent<void> {
    public readonly element: HTMLDivElement;
    public readonly buttonElement: HTMLButtonElement;

    private readonly textSpan: HTMLSpanElement;
    private state: FloorButtonState = 'ready';
    private currentTaskId?: string;

    private unbindProgress: (() => void) | null = null;
    private unbindStatus: (() => void) | null = null;
    private clickHandler: (() => void) | null = null;

    constructor(private readonly options: FloorActionButtonOptions) {
        this.element = document.createElement('div');
        this.element.classList.add('da-floor-btn-wrapper');

        this.buttonElement = document.createElement('button');
        this.buttonElement.type = 'button';
        this.buttonElement.classList.add('da-floor-btn', 'da-floor-btn--default');

        const iconSpan = document.createElement('span');
        iconSpan.classList.add('da-floor-btn-placeholder');
        iconSpan.textContent = '🎨';
        this.buttonElement.appendChild(iconSpan);

        this.textSpan = document.createElement('span');
        this.textSpan.classList.add('da-floor-btn-prompt');
        this.textSpan.textContent = '开始绘图';
        this.buttonElement.appendChild(this.textSpan);

        this.element.appendChild(this.buttonElement);

        this.bindUserInteractions();
        this.bindTaskEvents();
    }

    private bindUserInteractions(): void {
        this.clickHandler = async () => {
            if (this.state === 'ready' || this.state === 'error') {
                this.setState('pending');
                try {
                    const taskId = await this.options.onTrigger?.();
                    if (taskId) {
                        this.currentTaskId = taskId;
                    }
                } catch {
                    this.setState('error', '触发失败');
                }
            } else if ((this.state === 'pending' || this.state === 'progress') && this.currentTaskId) {
                this.options.onCancel?.(this.currentTaskId);
            }
        };
        this.buttonElement.addEventListener('click', this.clickHandler);
    }

    private bindTaskEvents(): void {
        this.unbindProgress = eventBus.on(
            'task:progress',
            ({ taskId, progress }: { taskId: string; progress: TaskProgressInfo }) => {
                if (this.currentTaskId && taskId === this.currentTaskId) {
                    const pct = Math.round(progress.percent || 0);
                    this.setState('progress', `生成中 ${pct}%... [点击取消]`);
                }
            }
        );

        this.unbindStatus = eventBus.on('task:status', (eventData: TaskStatusEventData) => {
            if (this.currentTaskId && eventData.taskId === this.currentTaskId) {
                if (eventData.status === 'generating') {
                    this.setState('progress', '正在生成... [点击取消]');
                } else if (eventData.status === 'completed') {
                    this.setState('done', '绘制完成 ✓');
                } else if (eventData.status === 'failed') {
                    this.setState('error', '生成失败，点击重试 ✕');
                } else if (eventData.status === 'cancelled') {
                    this.setState('error', '已取消，点击重试 ✕');
                }
            }
        });
    }

    /** 关联指定的生图任务标识符 */
    public bindTaskId(taskId: string): void {
        this.currentTaskId = taskId;
    }

    /** 获取当前状态 */
    public getState(): FloorButtonState {
        return this.state;
    }

    /**
     * 切换按钮的展示状态与文案
     * @param state 目标状态
     * @param customText 自定义文案 (可选)
     */
    public setState(state: FloorButtonState, customText?: string): void {
        this.state = state;

        // 清除旧的状态类
        this.buttonElement.classList.remove(
            'da-floor-btn--default',
            'da-floor-btn--pending',
            'da-floor-btn--progress',
            'da-floor-btn--done',
            'da-floor-btn--error'
        );

        switch (state) {
            case 'ready':
                this.buttonElement.classList.add('da-floor-btn--default');
                this.textSpan.textContent = customText || '开始绘图';
                break;
            case 'pending':
                this.buttonElement.classList.add('da-floor-btn--pending');
                this.textSpan.textContent = customText || '排队中... [点击取消]';
                break;
            case 'progress':
                this.buttonElement.classList.add('da-floor-btn--progress');
                this.textSpan.textContent = customText || '正在生成... [点击取消]';
                break;
            case 'done':
                this.buttonElement.classList.add('da-floor-btn--done');
                this.textSpan.textContent = customText || '绘制完成 ✓';
                break;
            case 'error':
                this.buttonElement.classList.add('da-floor-btn--error');
                this.textSpan.textContent = customText || '生成失败，点击重试 ✕';
                break;
        }
    }

    public getValue(): void {
        // 按钮无取值
    }

    public setValue(): void {
        // 按钮无设值
    }

    public setDisabled(disabled: boolean): void {
        this.buttonElement.disabled = disabled;
    }

    public dispose(): void {
        if (this.clickHandler) {
            this.buttonElement.removeEventListener('click', this.clickHandler);
            this.clickHandler = null;
        }
        if (this.unbindProgress) {
            this.unbindProgress();
            this.unbindProgress = null;
        }
        if (this.unbindStatus) {
            this.unbindStatus();
            this.unbindStatus = null;
        }
        if (this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
    }
}
