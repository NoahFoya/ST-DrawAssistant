/**
 * LoRA 模型管理独立模态弹窗 (LoraModal)。
 *
 * @remarks
 * 专用 LoRA 管理视窗：
 * 1. 内嵌无外框 `LoraManager` (`embedded: true`)，提供联想下拉添加与三权重微调；
 * 2. 支持无上限挂载、单条启用/停用切换与常驻/关键词触发；
 * 3. 点击确认后同步回写条目至提示词预设数据模型。
 */

import type { Disposable } from '../types';
import { renderIcon } from '../components/icons';
import { bindBackdropDismiss, overlayStack } from '../framework/overlay-stack';
import { LoraManager, type LoraEntryItem } from '../composite/lora-manager';
import { DEFAULT_LORA_WEIGHTS } from '../../pipeline/lora-utils';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { Toast } from '../feedback/toast';

function normalizeLoraSnapshot(items: readonly LoraEntryItem[]): string {
    return JSON.stringify(
        items.map((it) => ({
            id: it.id,
            enabled: it.enabled !== false,
            modelName: (it.modelName || '').trim(),
            modelWeight: it.modelWeight,
            clipWeight: it.clipWeight,
            triggerWeight: it.triggerWeight ?? DEFAULT_LORA_WEIGHTS.triggerWeight,
            triggerMode: it.triggerMode === 'keyword' ? 'keyword' : 'always',
            keywords: it.keywords ?? '',
        }))
    );
}

export interface LoraModalOptions {
    /** 可选的可用 LoRA 模型文件名列表 */
    readonly availableModels?: string[];
    /** 初始挂载的 LoRA 条目快照 */
    readonly initialItems?: LoraEntryItem[];
    /** 保存/确认回调 */
    readonly onSave?: (items: LoraEntryItem[]) => void;
    /** 关闭或取消回调 */
    readonly onClose?: () => void;
}

let activeLoraModalInstance: Disposable | null = null;

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

    if (activeLoraModalInstance) {
        activeLoraModalInstance.dispose();
        activeLoraModalInstance = null;
    }

    let isDisposed = false;
    let isPromptingClose = false;
    const initialItems: LoraEntryItem[] = options.initialItems
        ? options.initialItems.map((it) => ({ ...it }))
        : [];
    const initialSnapshot = normalizeLoraSnapshot(initialItems);

    // 1. 全屏遮罩外壳
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-submodal-backdrop da-lora-modal-backdrop';

    // 2. 居中模态面板
    const panel = document.createElement('div');
    panel.className = 'da-modal-shell da-submodal-panel da-lora-modal-panel';

    // 3. 头部顶栏
    const header = document.createElement('div');
    header.className = 'da-submodal-header da-lora-modal-header';

    const titleBox = document.createElement('div');
    titleBox.className = 'da-submodal-title-group da-lora-modal-title-group';

    const titleText = document.createElement('span');
    titleText.className = 'da-submodal-title da-lora-modal-title';
    titleText.textContent = 'LoRA 模型与权重配置';
    titleBox.appendChild(titleText);

    const subtitleText = document.createElement('span');
    subtitleText.className = 'da-submodal-subtitle da-lora-modal-subtitle';
    subtitleText.textContent = '从已同步的服务端模型列表中输入关键词联想选择并添加，关闭单条开关可停用该模型';
    titleBox.appendChild(subtitleText);

    header.appendChild(titleBox);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'da-submodal-close da-lora-modal-close';
    closeBtn.innerHTML = renderIcon('close', 16);
    closeBtn.title = '关闭 (Esc)';
    closeBtn.setAttribute('aria-label', '关闭弹窗');
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 4. 内容主体区域（内嵌 LoraManager，包含能力说明、联想下拉框与已挂载列表）
    const body = document.createElement('div');
    body.className = 'da-submodal-body da-lora-modal-body';

    const clearAllBtn = document.createElement('button');
    clearAllBtn.type = 'button';
    clearAllBtn.className = 'da-btn da-btn--ghost da-btn--sm';
    clearAllBtn.textContent = '清空列表';
    clearAllBtn.classList.toggle('da-hidden', initialItems.length === 0);

    const loraManager = new LoraManager({
        embedded: true,
        availableModels: options.availableModels ?? [],
        initialItems,
        onChange: (items) => {
            clearAllBtn.classList.toggle('da-hidden', items.length === 0);
        },
    });

    body.appendChild(loraManager.element);
    panel.appendChild(body);

    // 5. 底部操作栏
    const footer = document.createElement('div');
    footer.className = 'da-submodal-footer da-lora-modal-footer';

    const footerLeft = document.createElement('div');
    footerLeft.className = 'da-submodal-footer__left da-lora-modal-footer__left';

    clearAllBtn.onclick = () => {
        loraManager.setItems([]);
    };
    footerLeft.appendChild(clearAllBtn);
    footer.appendChild(footerLeft);

    const footerRight = document.createElement('div');
    footerRight.className = 'da-submodal-footer__right da-lora-modal-footer__right';

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
    let unbindBackdrop = () => {};
    const dispose = () => {
        if (isDisposed) return;
        isDisposed = true;
        if (isPromptingClose) {
            ConfirmDialog.dispose();
            isPromptingClose = false;
        }
        unbindBackdrop();
        overlayStack.remove('lora-modal');
        loraManager.dispose();
        backdrop.remove();
        if (activeLoraModalInstance?.dispose === dispose) {
            activeLoraModalInstance = null;
        }
    };

    const handleSave = (): boolean => {
        const invalidRules = loraManager.validateKeywordRules();
        if (invalidRules.length > 0) {
            const first = invalidRules[0];
            loraManager.focusItemKeywords(first.id);
            Toast.warning(`请先修正「${first.modelName}」中的无效关键词正则：${first.errors[0]}`);
            return false;
        }
        const finalItems = loraManager.getItems();
        dispose();
        options.onSave?.(finalItems);
        return true;
    };

    const handleClose = async () => {
        if (isDisposed || isPromptingClose) return;
        const currentSnapshot = normalizeLoraSnapshot(loraManager.getItems());
        if (currentSnapshot === initialSnapshot) {
            options.onClose?.();
            dispose();
            return;
        }

        isPromptingClose = true;
        try {
            const choice = await ConfirmDialog.choose({
                title: '存在未应用修改',
                message: '当前 LoRA 配置存在尚未应用的修改，是否在关闭前应用？',
                primaryText: '应用并关闭',
                secondaryText: '放弃修改',
                cancelText: '继续编辑',
                isSecondaryDanger: true,
            });
            if (isDisposed || choice === 'cancel') {
                return;
            }
            if (choice === 'primary') {
                handleSave();
                return;
            }
            options.onClose?.();
            dispose();
        } finally {
            isPromptingClose = false;
        }
    };

    activeLoraModalInstance = { dispose };
    overlayStack.push('lora-modal', () => {
        void handleClose();
    }, dispose);

    closeBtn.onclick = () => {
        void handleClose();
    };
    cancelBtn.onclick = () => {
        void handleClose();
    };
    unbindBackdrop = bindBackdropDismiss(backdrop, () => {
        void handleClose();
    });

    saveBtn.onclick = () => {
        handleSave();
    };

    return { dispose };
}
