/**
 * ST-DrawAssistant 楼层消息解析、指令挂载与图像渲染装饰器。
 *
 * @remarks
 * 监听宿主 CHARACTER_MESSAGE_RENDERED 事件，幂等解析消息中的绘图指令并挂载交互按钮。
 * 在生图完成后安全回写 extra.drawings 并在 DOM 中展示生成图像，
 * 支持大图全屏预览与会话切换资源释放。
 */

import { FloorActionButton } from './floor-action-button';
import { promptPipeline } from '../../pipeline/prompt-pipeline';
import { generationOrchestrator, type SubmitTaskOptions } from '../../pipeline/generation-orchestrator';
import { sessionLifecycle } from '../../pipeline/session-lifecycle';
import { settingsStore } from '../../store/settings-store';
import { imageStorage } from '../../store/image-storage';
import { urlPool } from '../../store/url-pool';
import { eventBus, type TaskStatusEventData } from '../../util/event-bus';
import { logger } from '../../util/logger';
import type { ProviderType } from '@types';

export class MessageDecorator {
    private readonly activeButtons = new Map<string, FloorActionButton>();
    private unbindStatusListener: (() => void) | null = null;

    constructor() {
        this.listenTaskCompleted();
    }

    private listenTaskCompleted(): void {
        this.unbindStatusListener = eventBus.on('task:status', async (eventData: TaskStatusEventData) => {
            if (eventData.status !== 'completed' || !eventData.task || !eventData.imageId) {
                return;
            }

            const task = eventData.task;
            const hostContext = (window as any).SillyTavern?.getContext?.();
            const currentChatId = hostContext?.chatId;

            // 跨会话安全防护：若当前活跃会话与任务所属会话不一致，跳过当前视图 DOM 渲染
            if (currentChatId && currentChatId !== task.target.chatId) {
                return;
            }

            // 1. 持久化回写宿主消息结构
            await sessionLifecycle.updateMessageSlot(task.target, eventData.imageId);

            // 2. 在消息 DOM 中呈现渲染生成的图像
            await this.renderImageToFloor(task.target.messageId, eventData.imageId);
        });
    }

    /**
     * 装饰指定索引的消息楼层
     * @param messageId 宿主楼层消息数字索引
     */
    public async decorateMessage(messageId: number): Promise<void> {
        if (typeof document === 'undefined') return;

        const hostContext = (window as any).SillyTavern?.getContext?.();
        if (!hostContext || !Array.isArray(hostContext.chat)) return;

        const message = hostContext.chat[messageId];
        if (!message || typeof message.mes !== 'string') return;

        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageDom) return;

        // 幂等性防护：若该楼层已挂载过按钮，直接跳过
        if (messageDom.querySelector('.da-floor-btn-wrapper')) {
            return;
        }

        const commands = promptPipeline.extractCommands(message.mes);
        if (commands.length === 0) {
            return;
        }

        const cmd = commands[0];
        const targetContainer = messageDom.querySelector('.mes_text') || messageDom;
        const chatId = hostContext.chatId || 'default_chat';
        const buttonKey = `${chatId}_${messageId}_${cmd.instructionIndex}`;

        const button = new FloorActionButton({
            chatId,
            messageId,
            slotIndex: cmd.instructionIndex,
            onTrigger: async () => {
                const settings = settingsStore.getSettings();
                const submitOptions: SubmitTaskOptions = {
                    rawPrompt: cmd.promptText,
                    providerType: settings.activeProvider as ProviderType,
                    target: {
                        chatId,
                        messageId,
                        swipeId: hostContext.chat[messageId]?.swipe_id ?? 0,
                        instructionIndex: cmd.instructionIndex,
                    },
                };

                const taskId = await generationOrchestrator.submitTask(submitOptions);
                return taskId;
            },
            onCancel: (taskId) => {
                generationOrchestrator.cancelTask(taskId, '用户主动取消');
            },
        });

        this.activeButtons.set(buttonKey, button);
        targetContainer.appendChild(button.element);

        // 若开启了自动生图模式，挂载后直接自动触发执行
        if (settingsStore.getSettings().autoGenerate) {
            button.buttonElement.click();
        }
    }

    /**
     * 在消息楼层中挂载生成的图像元素与点击放大弹窗
     */
    public async renderImageToFloor(messageId: number, imageId: string): Promise<void> {
        if (typeof document === 'undefined') return;

        const messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!messageDom) return;

        const container = messageDom.querySelector('.mes_text') || messageDom;
        const existingImg = container.querySelector(`img[data-da-image-id="${imageId}"]`);
        if (existingImg) return;

        // 从存储中心或 UrlPool 获取临时预览地址
        const blob = await imageStorage.getImageBlob(imageId);
        if (!blob) return;

        const objectUrl = urlPool.getUrl(imageId) || urlPool.createUrl(imageId, blob);

        const img = document.createElement('img');
        img.src = objectUrl;
        img.setAttribute('data-da-image-id', imageId);
        img.classList.add('da-image-preview-img');
        img.alt = 'AI 生成图像';

        // 点击开启大图全屏预览
        img.addEventListener('click', () => {
            this.showFullscreenPreview(objectUrl);
        });

        container.appendChild(img);
        logger.info(`已在楼层 #${messageId} 中完成图像渲染与挂载 (${imageId})`);
    }

    /**
     * 打开大图全屏预览浮层
     */
    public showFullscreenPreview(src: string): void {
        if (typeof document === 'undefined' || !document.body) return;

        const backdrop = document.createElement('div');
        backdrop.classList.add('da-image-preview-backdrop');

        const bigImg = document.createElement('img');
        bigImg.src = src;
        bigImg.classList.add('da-image-preview-img');
        backdrop.appendChild(bigImg);

        const closeHandler = () => {
            if (backdrop.parentElement) {
                backdrop.parentElement.removeChild(backdrop);
            }
            document.removeEventListener('keydown', keyHandler);
        };

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                closeHandler();
            }
        };

        backdrop.addEventListener('click', closeHandler);
        document.addEventListener('keydown', keyHandler);

        document.body.appendChild(backdrop);
    }

    /**
     * 会话切换时清理当前视图中的所有楼层按钮
     */
    public clearCurrentButtons(): void {
        for (const button of this.activeButtons.values()) {
            button.dispose();
        }
        this.activeButtons.clear();
    }

    public dispose(): void {
        if (this.unbindStatusListener) {
            this.unbindStatusListener();
            this.unbindStatusListener = null;
        }
        this.clearCurrentButtons();
    }
}

/** 全局楼层消息装饰器单例 */
export const messageDecorator = new MessageDecorator();
