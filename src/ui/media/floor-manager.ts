/**
 * @module src/ui/media/floor-manager
 * @description 酒馆聊天消息楼层交互管理器 (FloorManager)
 *
 * 遵循规范 (styles/features/image-collapse.css 与 .agents/skills/st-extension/SKILL.md)：
 * 1. 聊天楼层生成按钮注入与展示容器管理 (.da-floor-btn-img-slot)；
 * 2. 图像折叠/展开胶囊按钮 (.da-image-collapse-toggle)，支持对齐方式修饰符 (left / center / right)；
 * 3. 楼层嵌入已生成的图像 (.da-generated-img)，支持悬停交互与点击呼出全屏灯箱大图；
 * 4. 会话变更 (CHAT_CHANGED) 严格生命周期管理：中止未决任务、批量 URL.revokeObjectURL 释放内存，防止跨会话楼层串号与泄漏。
 */

import { createElement } from '../../util/dom';
import { Toast } from '../components/feedback';
import { getIconSvg } from '../components/icons';
import type { SettingsStore } from '../../store/settings';
import type { GenerationOrchestrator } from '../../function/orchestrator';
import type { TaskQueueManager } from '../../store/task';
import type { IDisposable } from '../../util/event-bus';
import type { EngineType } from '@types';

export interface FloorManagerOptions {
    settingsStore: SettingsStore;
    orchestrator?: GenerationOrchestrator;
    taskQueue?: TaskQueueManager;
    onPreviewImage?: (url: string) => void;
    onInpaintImage?: (blob: Blob) => void;
    onViewImageInfo?: (metadata: Record<string, unknown>) => void;
}

export interface FloorManagerHandle {
    mountToMessage(messageElement: HTMLElement, messageId: number | string, isUserMessage?: boolean): void;
    updateFloorProgress(messageId: number | string, progress: number): void;
    attachFloorImage(messageId: number | string, imageUrl: string, metadata?: Record<string, unknown>): void;
    clearSessionState(): void;
    dispose(): void;
}

export class FloorManager implements FloorManagerHandle {
    private readonly _settingsStore: SettingsStore;
    private readonly _orchestrator?: GenerationOrchestrator;
    private readonly _taskQueue?: TaskQueueManager;
    private readonly _options: FloorManagerOptions;

    private _activeSlots = new Map<string | number, HTMLElement>();
    private _slotUrls = new Map<string | number, string>();
    private _allocatedUrls = new Set<string>();
    private _disposers: IDisposable[] = [];
    private _isDisposed = false;

    constructor(options: FloorManagerOptions) {
        this._settingsStore = options.settingsStore;
        this._orchestrator = options.orchestrator;
        this._taskQueue = options.taskQueue;
        this._options = options;

        if (this._taskQueue) {
            this._setupTaskListeners(this._taskQueue);
        }
    }

    public get orchestrator(): GenerationOrchestrator | undefined {
        return this._orchestrator;
    }

    /**
     * 挂载生图按钮与图像展示容器至指定消息楼层
     */
    public mountToMessage(messageElement: HTMLElement, messageId: number | string, _isUserMessage = false): void {
        if (this._isDisposed || !messageElement) return;

        // 避免重复挂载
        if (messageElement.querySelector('.da-image-collapse-wrapper')) {
            return;
        }

        const align = this._settingsStore.get('ui')?.imageDisplay?.align || 'left';
        const wrapper = createElement('div', {
            className: `da-image-collapse-wrapper da-image-collapse-wrapper--${align}`
        });

        // 1. 楼层右上角角标生成按钮 (若是助手消息或启用用户生图)
        const triggerBtn = createElement('button', {
            className: 'da-image-corner-trigger',
            attributes: {
                type: 'button',
                title: '依据此楼层文本直接生成绘画',
                style: 'display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; font-size: 11px; border-radius: 4px; background: rgba(var(--da-accent-rgb, 74, 136, 247), 0.12); color: var(--da-accent-color); border: 1px solid rgba(var(--da-accent-rgb, 74, 136, 247), 0.3); cursor: pointer; margin-bottom: 4px; transition: all 0.15s ease;'
            }
        });
        triggerBtn.innerHTML = `${getIconSvg('palette')} <span>绘画</span>`;

        triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._handleFloorGenerate(messageElement, messageId);
        });

        wrapper.appendChild(triggerBtn);

        // 2. 图像展示与折叠插槽容器 (.da-floor-btn-img-slot)
        const slot = createElement('div', { className: 'da-floor-btn-img-slot' });
        wrapper.appendChild(slot);

        this._activeSlots.set(messageId, slot);
        messageElement.appendChild(wrapper);
    }

    /**
     * 更新指定楼层的生图进度展示
     */
    public updateFloorProgress(messageId: number | string, progress: number): void {
        if (this._isDisposed) return;
        const slot = this._activeSlots.get(messageId);
        if (!slot) return;

        let progressEl = slot.querySelector('.da-floor-progress-bar') as HTMLElement;
        if (!progressEl) {
            slot.innerHTML = '';
            progressEl = createElement('div', {
                className: 'da-floor-progress-bar',
                attributes: {
                    style: 'display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--da-accent-color); padding: 4px 8px; background: rgba(0,0,0,0.25); border-radius: 4px;'
                }
            });
            progressEl.innerHTML = `
                <div class="da-icon-spin" style="display: inline-flex;">${getIconSvg('spinner')}</div>
                <span class="da-progress-text">正在绘制中... 0%</span>
            `;
            slot.appendChild(progressEl);
        }

        const pctText = progressEl.querySelector('.da-progress-text');
        if (pctText) {
            pctText.textContent = `正在绘制中... ${Math.round(progress * 100)}%`;
        }
    }

    /**
     * 将生成的图像注入挂载到聊天楼层
     */
    public attachFloorImage(messageId: number | string, imageUrl: string, _metadata?: Record<string, unknown>): void {
        if (this._isDisposed) return;
        const slot = this._activeSlots.get(messageId);
        if (!slot) return;

        const oldUrl = this._slotUrls.get(messageId);
        if (oldUrl && oldUrl !== imageUrl) {
            if (oldUrl.startsWith('blob:')) {
                URL.revokeObjectURL(oldUrl);
            }
            this._allocatedUrls.delete(oldUrl);
        }
        this._slotUrls.set(messageId, imageUrl);

        slot.innerHTML = '';
        this._allocatedUrls.add(imageUrl);

        // 折叠/展开胶囊按钮
        const defaultCollapsed = !!this._settingsStore.get('ui')?.imageDisplay?.collapsed;
        let isCollapsed = defaultCollapsed;

        const toggleBtn = createElement('div', {
            className: 'da-image-collapse-toggle',
            textContent: isCollapsed ? '展开绘画图片 ▾' : '收起绘画图片 ▴'
        });

        // 图片展示容器
        const imgWrap = createElement('div', {
            attributes: {
                style: `display: ${isCollapsed ? 'none' : 'block'}; position: relative; max-width: 320px; border-radius: var(--da-radius-md, 8px); overflow: hidden; margin-top: 4px; box-shadow: var(--da-shadow-md); border: 1px solid var(--da-separator);`
            }
        });

        const img = createElement('img', {
            className: 'da-generated-img',
            attributes: {
                src: imageUrl,
                alt: '生成的图片',
                style: 'width: 100%; height: auto; display: block; cursor: pointer; transition: transform 0.2s ease;'
            }
        });

        img.addEventListener('click', () => {
            this._options.onPreviewImage?.(imageUrl);
        });

        imgWrap.appendChild(img);

        // 切换折叠
        toggleBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            toggleBtn.textContent = isCollapsed ? '展开绘画图片 ▾' : '收起绘画图片 ▴';
            imgWrap.style.display = isCollapsed ? 'none' : 'block';
        });

        slot.appendChild(toggleBtn);
        slot.appendChild(imgWrap);
    }

    /**
     * 注册任务调度器事件监听
     */
    private _setupTaskListeners(taskQueue: TaskQueueManager): void {
        const unsubProgress = taskQueue.events.on('task:progress', ({ taskId, progress }) => {
            if (this._isDisposed) return;
            const task = taskQueue.getTask(taskId);
            if (task?.identity?.messageId !== undefined) {
                this.updateFloorProgress(task.identity.messageId, progress);
            }
        });
        this._disposers.push(unsubProgress);

        const unsubCompleted = taskQueue.events.on('task:completed', ({ taskId, result }) => {
            if (this._isDisposed) return;
            const task = taskQueue.getTask(taskId);
            if (task?.identity?.messageId !== undefined && result.blob) {
                const blobUrl = URL.createObjectURL(result.blob);
                this.attachFloorImage(task.identity.messageId, blobUrl, result.metadata);
            }
        });
        this._disposers.push(unsubCompleted);

        const unsubFailed = taskQueue.events.on('task:failed', ({ taskId, error }) => {
            if (this._isDisposed) return;
            const task = taskQueue.getTask(taskId);
            if (task?.identity?.messageId !== undefined) {
                this._showFloorError(task.identity.messageId, error);
            }
        });
        this._disposers.push(unsubFailed);

        const unsubCancelled = taskQueue.events.on('task:cancelled', ({ taskId, reason }) => {
            if (this._isDisposed) return;
            const task = taskQueue.getTask(taskId);
            if (task?.identity?.messageId !== undefined) {
                this._showFloorCancelled(task.identity.messageId, reason);
            }
        });
        this._disposers.push(unsubCancelled);
    }

    /**
     * 展示楼层生图失败反馈
     */
    private _showFloorError(messageId: number | string, error: string): void {
        if (this._isDisposed) return;
        const slot = this._activeSlots.get(messageId);
        if (!slot) return;

        slot.innerHTML = '';
        const errorEl = createElement('div', {
            className: 'da-floor-error-bar',
            attributes: {
                style: 'display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--da-color-danger, #e55353); padding: 4px 8px; background: rgba(229, 83, 83, 0.1); border-radius: 4px;'
            }
        });
        errorEl.textContent = `生图失败: ${error}`;
        slot.appendChild(errorEl);
    }

    /**
     * 展示楼层任务已取消反馈
     */
    private _showFloorCancelled(messageId: number | string, reason?: string): void {
        if (this._isDisposed) return;
        const slot = this._activeSlots.get(messageId);
        if (!slot) return;

        slot.innerHTML = '';
        const cancelEl = createElement('div', {
            className: 'da-floor-cancel-bar',
            attributes: {
                style: 'display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--da-text-secondary, #888); padding: 4px 8px;'
            }
        });
        cancelEl.textContent = `生图已取消${reason ? ` (${reason})` : ''}`;
        slot.appendChild(cancelEl);
    }

    /**
     * 触发楼层生图执行
     */
    private _handleFloorGenerate(messageElement: HTMLElement, messageId: number | string): void {
        const textElement = messageElement.querySelector('.mes_text');
        const textContent = (textElement?.textContent || messageElement.textContent || '').trim();
        if (!textContent) {
            Toast.warn('该楼层内容为空，无法提取提示词');
            return;
        }

        if (!this._taskQueue) {
            Toast.warn('生图任务调度队列未就绪');
            return;
        }

        const activeEngine = (this._settingsStore.get('activeEngine') as EngineType) || 'comfyui';
        let chatId = 'default';
        if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
            chatId = window.SillyTavern.getContext().chatId || 'default';
        }

        const numMessageId = typeof messageId === 'number' ? messageId : parseInt(String(messageId), 10);
        const parsedMessageId = Number.isNaN(numMessageId) ? undefined : numMessageId;

        this.updateFloorProgress(messageId, 0.05);

        try {
            this._taskQueue.submit(
                {
                    prompt: textContent,
                    width: 512,
                    height: 768,
                    seed: -1
                },
                {
                    chatId,
                    messageId: parsedMessageId
                },
                activeEngine
            );
            Toast.info(`已提取第 #${messageId} 楼层内容，加入生图队列`);
        } catch (err: any) {
            const errorMsg = err?.message || String(err) || '未知提交异常';
            Toast.error(`提交生图任务失败: ${errorMsg}`);
            this._showFloorError(messageId, errorMsg);
        }
    }

    /**
     * 会话切换 (CHAT_CHANGED) 清理：中止未决任务、释放所有由楼层分配的 Object URL
     */
    public clearSessionState(): void {
        for (const url of this._allocatedUrls) {
            if (url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        }
        this._allocatedUrls.clear();
        this._slotUrls.clear();
        this._activeSlots.clear();
    }

    /**
     * 销毁实例
     */
    public dispose(): void {
        this.clearSessionState();
        for (const unbind of this._disposers) {
            try {
                unbind.dispose();
            } catch (err) {
                console.error('[FloorManager] 释放监听器异常:', err);
            }
        }
        this._disposers = [];
        this._isDisposed = true;
    }
}
