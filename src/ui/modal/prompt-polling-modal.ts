/**
 * 提示词轮询候选池管理独立模态弹窗 (PromptPollingModal)。
 *
 * @remarks
 * 参照 LoraModal 交互与布局规范构建：
 * 1. 内嵌无外框 `PromptPollingManager` (`embedded: true`)，支持一键添加全部、全启/全停、下拉检索与单项开关/移除；
 * 2. 弹窗内部维持局部草稿编辑，点击「应用配置」后统一回写至绘画预设并退出；
 * 3. 点击「取消」、右上角关闭按钮、Esc 键或遮罩层均放弃本次弹窗修改。
 */

import type { PresetItem, PromptPollingPoolItem, PromptPresetData } from '@types';
import type { Disposable } from '../types';
import { renderIcon } from '../components/icons';
import { bindBackdropDismiss, overlayStack } from '../framework/overlay-stack';
import { PromptPollingManager } from '../composite/prompt-polling-manager';

export interface PromptPollingModalOptions {
    /** 当前服务可用的全部提示词预设列表 */
    readonly availablePresets: PresetItem<PromptPresetData>[];
    /** 初始轮询池条目快照 */
    readonly initialItems?: PromptPollingPoolItem[];
    /** 点击「应用配置」后的保存回调 */
    readonly onSave?: (items: PromptPollingPoolItem[]) => void;
    /** 关闭或取消回调 */
    readonly onClose?: () => void;
}

let activePromptPollingModalInstance: Disposable | null = null;

/**
 * 弹出独立的提示词轮询候选池管理对话框。
 *
 * @param options 配置选项
 * @returns 资源释放句柄
 */
export function openPromptPollingModal(options: PromptPollingModalOptions): Disposable {
    if (typeof document === 'undefined') {
        return { dispose: () => {} };
    }

    if (activePromptPollingModalInstance) {
        activePromptPollingModalInstance.dispose();
        activePromptPollingModalInstance = null;
    }

    let isDisposed = false;
    const initialItems: PromptPollingPoolItem[] = Array.isArray(options.initialItems)
        ? options.initialItems.map((it) => ({ ...it }))
        : [];

    // 1. 全屏遮罩外壳
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-submodal-backdrop da-polling-modal-backdrop';

    // 2. 居中模态面板
    const panel = document.createElement('div');
    panel.className = 'da-modal-shell da-submodal-panel da-polling-modal-panel';

    // 3. 头部顶栏
    const header = document.createElement('div');
    header.className = 'da-submodal-header da-polling-modal-header';

    const titleBox = document.createElement('div');
    titleBox.className = 'da-submodal-title-group da-polling-modal-title-group';

    const titleText = document.createElement('span');
    titleText.className = 'da-submodal-title da-polling-modal-title';
    titleText.textContent = '提示词轮询候选池';
    titleBox.appendChild(titleText);

    const subtitleText = document.createElement('span');
    subtitleText.className = 'da-submodal-subtitle da-polling-modal-subtitle';
    subtitleText.textContent = '从当前服务已保存的提示词预设中挑选参与随机轮询的候选列表；列表为空时自动轮询全部';
    titleBox.appendChild(subtitleText);

    header.appendChild(titleBox);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'da-submodal-close da-polling-modal-close';
    closeBtn.innerHTML = renderIcon('close', 16);
    closeBtn.title = '关闭 (Esc)';
    closeBtn.setAttribute('aria-label', '关闭弹窗');
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 4. 内容主体区域（内嵌无框 PromptPollingManager）
    const body = document.createElement('div');
    body.className = 'da-submodal-body da-polling-modal-body';

    const clearAllBtn = document.createElement('button');
    clearAllBtn.type = 'button';
    clearAllBtn.className = 'da-btn da-btn--ghost da-btn--sm';
    clearAllBtn.textContent = '清空列表';
    clearAllBtn.classList.toggle('da-hidden', initialItems.length === 0);

    const pollingManager = new PromptPollingManager({
        availablePresets: options.availablePresets,
        initialItems,
        embedded: true,
        onChange: (items) => {
            clearAllBtn.classList.toggle('da-hidden', items.length === 0);
        },
    });
    body.appendChild(pollingManager.element);
    panel.appendChild(body);

    // 5. 底部操作栏
    const footer = document.createElement('div');
    footer.className = 'da-submodal-footer da-polling-modal-footer';

    const leftActions = document.createElement('div');
    leftActions.className = 'da-submodal-footer__left da-polling-modal-footer__left';
    clearAllBtn.addEventListener('click', () => {
        pollingManager.setItems([]);
        clearAllBtn.classList.add('da-hidden');
    });
    leftActions.appendChild(clearAllBtn);

    const rightActions = document.createElement('div');
    rightActions.className = 'da-submodal-footer__right da-polling-modal-footer__right';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'da-btn da-btn--ghost da-btn--sm';
    cancelBtn.textContent = '取消';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'da-btn da-btn--primary da-btn--sm';
    saveBtn.textContent = '应用配置';

    rightActions.appendChild(cancelBtn);
    rightActions.appendChild(saveBtn);
    footer.appendChild(leftActions);
    footer.appendChild(rightActions);
    panel.appendChild(footer);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    // 6. 注册统一弹窗栈管理 Esc 键及遮罩关闭
    const handleCancel = (): void => {
        dispose();
    };

    const unbindBackdrop = bindBackdropDismiss(backdrop, handleCancel);
    overlayStack.push('prompt-polling-modal', handleCancel, () => dispose(false));

    function dispose(triggerOnClose = true): void {
        if (isDisposed) return;
        isDisposed = true;
        overlayStack.remove('prompt-polling-modal');
        unbindBackdrop();
        pollingManager.dispose();
        backdrop.parentElement?.removeChild(backdrop);
        if (activePromptPollingModalInstance?.dispose === instance.dispose) {
            activePromptPollingModalInstance = null;
        }
        if (triggerOnClose) {
            options.onClose?.();
        }
    }

    closeBtn.addEventListener('click', handleCancel);
    cancelBtn.addEventListener('click', handleCancel);
    saveBtn.addEventListener('click', () => {
        const finalItems = pollingManager.getItems();
        options.onSave?.(finalItems);
        dispose(false);
    });

    const instance: Disposable = { dispose: () => dispose(true) };
    activePromptPollingModalInstance = instance;
    return instance;
}
