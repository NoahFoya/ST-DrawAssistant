/**
 * LoRA 模型管理独立模态弹窗 (LoraModal)。
 *
 * @remarks
 * 专用 LoRA 管理视窗：
 * 1. 内嵌无外框 `LoraManager` (`embedded: true`)，提供标准表单行模式切换（SD-WebUI / ComfyUI）与联想下拉添加；
 * 2. 支持无上限挂载、单条启用/停用切换与多维权重调优；
 * 3. 点击确认后同步回写条目与语法模式至提示词预设数据模型。
 */

import type { Disposable } from '../types';
import type { LoraSyntaxMode } from '@types';
import { renderIcon } from '../components/icons';
import { overlayStack } from '../framework/overlay-stack';
import { LoraManager, type LoraEntryItem } from '../composite/lora-manager';

export interface LoraModalOptions {
    /** 当前 LoRA 语法模式 (默认 'standard') */
    readonly mode?: LoraSyntaxMode;
    /** 可选的可用 LoRA 模型文件名列表 */
    readonly availableModels?: string[];
    /** 初始挂载的 LoRA 条目快照 */
    readonly initialItems?: LoraEntryItem[];
    /** 保存/确认回调 */
    readonly onSave?: (items: LoraEntryItem[], mode: LoraSyntaxMode) => void;
    /** 关闭或取消回调 */
    readonly onClose?: () => void;
}

/**
 * 弹出独立的 LoRA 模型管理模态对话框。
 *
 * @param options 配置选项
 * @returns 资源释放句柄
 */
export function openLoraModal(options: LoraModalOptions): Disposable {
    if (typeof document === 'undefined') {
        return { dispose: () => {} };
    }

    let isDisposed = false;
    let currentMode: LoraSyntaxMode = options.mode ?? 'standard';
    let currentItems: LoraEntryItem[] = options.initialItems
        ? options.initialItems.map((it) => ({ ...it }))
        : [];

    // 1. 全屏遮罩外壳
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-lora-modal-backdrop';

    // 2. 居中模态面板
    const panel = document.createElement('div');
    panel.className = 'da-modal-shell da-lora-modal-panel';

    // 3. 头部顶栏
    const header = document.createElement('div');
    header.className = 'da-lora-modal-header';

    const titleBox = document.createElement('div');
    titleBox.className = 'da-lora-modal-title-group';

    const titleText = document.createElement('span');
    titleText.className = 'da-lora-modal-title';
    titleText.textContent = 'LoRA 模型与权重配置';
    titleBox.appendChild(titleText);

    const subtitleText = document.createElement('span');
    subtitleText.className = 'da-lora-modal-subtitle';
    subtitleText.textContent = '从已同步的服务端模型列表中输入关键词联想选择并添加，关闭单条开关可停用该模型';
    titleBox.appendChild(subtitleText);

    header.appendChild(titleBox);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'da-lora-modal-close';
    closeBtn.innerHTML = renderIcon('close', 16);
    closeBtn.title = '关闭 (Esc)';
    closeBtn.setAttribute('aria-label', '关闭弹窗');
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 4. 内容主体区域（内嵌 LoraManager，包含模式选择表单行、联想下拉框与已挂载列表）
    const body = document.createElement('div');
    body.className = 'da-lora-modal-body';

    const loraManager = new LoraManager({
        embedded: true,
        mode: currentMode,
        availableModels: options.availableModels ?? [],
        initialItems: currentItems,
        onModeChange: (nextMode) => {
            currentMode = nextMode;
        },
        onChange: (items) => {
            currentItems = items.map((it) => ({ ...it }));
            clearAllBtn.style.display = currentItems.length > 0 ? '' : 'none';
        },
    });

    body.appendChild(loraManager.element);
    panel.appendChild(body);

    // 5. 底部操作栏
    const footer = document.createElement('div');
    footer.className = 'da-lora-modal-footer';

    const footerLeft = document.createElement('div');
    footerLeft.className = 'da-lora-modal-footer__left';

    const clearAllBtn = document.createElement('button');
    clearAllBtn.type = 'button';
    clearAllBtn.className = 'da-btn da-btn--ghost da-btn--sm';
    clearAllBtn.textContent = '清空列表';
    clearAllBtn.style.display = currentItems.length > 0 ? '' : 'none';
    clearAllBtn.onclick = () => {
        loraManager.setItems([]);
    };
    footerLeft.appendChild(clearAllBtn);
    footer.appendChild(footerLeft);

    const footerRight = document.createElement('div');
    footerRight.className = 'da-lora-modal-footer__right';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'da-btn da-btn--secondary da-btn--sm';
    cancelBtn.textContent = '取消';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'da-btn da-btn--primary da-btn--sm';
    saveBtn.textContent = '应用配置';

    footerRight.appendChild(cancelBtn);
    footerRight.appendChild(saveBtn);
    footer.appendChild(footerRight);
    panel.appendChild(footer);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    // 关闭与清理函数
    const dispose = () => {
        if (isDisposed) return;
        isDisposed = true;
        overlayStack.remove('lora-modal');
        loraManager.dispose();
        backdrop.remove();
    };

    overlayStack.push('lora-modal', () => {
        options.onClose?.();
        dispose();
    });

    closeBtn.onclick = () => {
        options.onClose?.();
        dispose();
    };
    cancelBtn.onclick = () => {
        options.onClose?.();
        dispose();
    };
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            options.onClose?.();
            dispose();
        }
    };

    saveBtn.onclick = () => {
        const finalItems = loraManager.getItems();
        const finalMode = loraManager.getMode();
        dispose();
        options.onSave?.(finalItems, finalMode);
    };

    return { dispose };
}
