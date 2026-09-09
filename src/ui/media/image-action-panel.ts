/**
 * 单张图片快捷操作菜单面板 (ImageActionPanel)
 * 提供查看原图、重绘编辑、设为背景及删除操作
 */

import { ThemeService } from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';
import { IDisposable } from '../../types';
import { StorageService } from '../../state';
import { ModalService } from '../layout/modal-service';
import { openImageInfoPanel } from './image-info-panel';

export interface ImageActionCallbacks {
    imageSrc?: string;
    mimeType?: string;
    promptText?: string;
    negativePrompt?: string;
    messageIndex?: number;
    buttonIndex?: number;
    uuid?: string;
    metadata?: Record<string, any>;
    storage?: StorageService;
    onConfirm?: (newPrompt: string, newNegativePrompt?: string) => void;
    onPreview?: () => void;
    onRegen?: () => void;
    onRegenerate?: () => void;
    onInpaint?: () => void;
    onDownload?: () => void;
    onDelete?: () => void;
    onOpenInfo?: () => void;
    [key: string]: unknown;
}

export function openImageActionPanel(_e: MouseEvent | PointerEvent, callbacks: ImageActionCallbacks): IDisposable {
    if (typeof document === 'undefined') return { dispose: () => {} };

    const overlay = document.createElement('div');
    overlay.className = 'da-modal-backdrop st-da-root';
    ThemeService.applyCurrentThemeToNode(overlay);

    const panel = document.createElement('div');
    panel.className = 'da-action-panel st-da-root';
    ThemeService.applyCurrentThemeToNode(panel);

    const modalHandle = ModalService.getInstance().open(overlay, {
        closeOnBackdrop: true,
        closeOnEscape: true
    });

    // 顶栏：标题与关闭按钮
    const header = document.createElement('div');
    header.className = 'da-action-panel__header';

    const headerTitle = document.createElement('h3');
    headerTitle.className = 'da-action-panel__title';
    headerTitle.textContent = callbacks.messageIndex !== undefined ? `图像操作栏 (#${callbacks.messageIndex})` : '图像操作栏';

    const btnClose = document.createElement('button');
    btnClose.className = 'da-btn da-btn--secondary da-btn--sm';
    btnClose.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    btnClose.title = '关闭 (Esc)';
    btnClose.onclick = () => modalHandle.dispose();

    header.appendChild(headerTitle);
    header.appendChild(btnClose);
    panel.appendChild(header);

    // 主体：提示词卡片区
    const body = document.createElement('div');
    body.className = 'da-action-panel__body';

    const createTagCard = (
        titleLabel: string,
        initialValue: string,
        placeholder: string,
        copySuccessMsg: string
    ) => {
        const card = document.createElement('div');
        card.className = 'da-tag-card';

        const cardHeader = document.createElement('div');
        cardHeader.className = 'da-tag-card__header';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'da-tag-card__label';
        labelSpan.textContent = titleLabel;

        const btnGroup = document.createElement('div');
        btnGroup.className = 'da-tag-card__btn-group';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        copyBtn.textContent = '复制';

        const editBtn = document.createElement('button');
        editBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        editBtn.textContent = '编辑';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        cancelBtn.style.display = 'none';
        cancelBtn.textContent = '取消';

        btnGroup.appendChild(copyBtn);
        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(cancelBtn);

        cardHeader.appendChild(labelSpan);
        cardHeader.appendChild(btnGroup);
        card.appendChild(cardHeader);

        const textarea = document.createElement('textarea');
        textarea.className = 'da-textarea';
        textarea.readOnly = true;
        textarea.placeholder = placeholder;
        textarea.value = initialValue || '';

        let isEditing = false;
        let backupText = initialValue || '';

        copyBtn.onclick = () => {
            void navigator.clipboard?.writeText(textarea.value).then(() => {
                FeedbackService.toastSuccess(copySuccessMsg);
            });
        };

        editBtn.onclick = () => {
            if (!isEditing) {
                isEditing = true;
                backupText = textarea.value;
                textarea.readOnly = false;
                textarea.focus();
                editBtn.textContent = '锁定';
                editBtn.className = 'da-btn da-btn--primary da-btn--sm';
                cancelBtn.style.display = 'inline-block';
            } else {
                isEditing = false;
                backupText = textarea.value;
                textarea.readOnly = true;
                editBtn.textContent = '编辑';
                editBtn.className = 'da-btn da-btn--secondary da-btn--sm';
                cancelBtn.style.display = 'none';
            }
        };

        cancelBtn.onclick = () => {
            if (isEditing) {
                isEditing = false;
                textarea.value = backupText;
                textarea.readOnly = true;
                editBtn.textContent = '编辑';
                editBtn.className = 'da-btn da-btn--secondary da-btn--sm';
                cancelBtn.style.display = 'none';
            }
        };

        card.appendChild(textarea);
        return { card, getText: () => textarea.value };
    };

    const promptCard = createTagCard('正向提示词 (Prompt)', callbacks.promptText || '', '暂无正向提示词', '已复制正向提示词');
    body.appendChild(promptCard.card);

    let negativeCard: { card: HTMLElement; getText: () => string } | null = null;
    if (callbacks.negativePrompt) {
        negativeCard = createTagCard('负向提示词 (Negative)', callbacks.negativePrompt, '暂无负向提示词', '已复制负向提示词');
        body.appendChild(negativeCard.card);
    }

    panel.appendChild(body);

    // 底部快捷操作按钮组
    const footer = document.createElement('div');
    footer.className = 'da-action-panel__footer';

    const createActionBtn = (label: string, isPrimary: boolean, onClick: () => void) => {
        const btn = document.createElement('button');
        btn.className = `da-btn ${isPrimary ? 'da-btn--primary' : 'da-btn--secondary'} da-btn--sm`;
        btn.textContent = label;
        btn.onclick = () => {
            onClick();
            modalHandle.dispose();
        };
        return btn;
    };

    if (callbacks.onPreview) {
        footer.appendChild(createActionBtn('放大查看', false, callbacks.onPreview));
    }

    footer.appendChild(createActionBtn('元数据详情', false, () => {
        if (callbacks.onOpenInfo) {
            callbacks.onOpenInfo();
        } else {
            openImageInfoPanel({
                imageSrc: callbacks.imageSrc,
                prompt: promptCard.getText(),
                negativePrompt: negativeCard?.getText(),
                uuid: callbacks.uuid,
                metadata: callbacks.metadata,
                storage: callbacks.storage,
                onDelete: callbacks.onDelete
            });
        }
    }));

    if (callbacks.onInpaint) {
        footer.appendChild(createActionBtn('局部重绘', false, callbacks.onInpaint));
    }

    const regenFn = callbacks.onRegenerate || callbacks.onRegen;
    if (regenFn) {
        footer.appendChild(createActionBtn('重新生成', true, () => {
            if (callbacks.onConfirm) {
                callbacks.onConfirm(promptCard.getText(), negativeCard?.getText());
            }
            regenFn();
        }));
    }

    if (callbacks.onDownload) {
        footer.appendChild(createActionBtn('下载原图', false, callbacks.onDownload));
    }

    if (callbacks.onDelete) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'da-btn da-btn--danger da-btn--sm';
        deleteBtn.textContent = '删除图片';
        deleteBtn.onclick = async () => {
            const confirmed = await FeedbackService.confirm({
                title: '删除图片确认',
                message: '确定要从本地数据库和当前消息中删除此张图片吗？此操作无法撤销。'
            });
            if (confirmed) {
                callbacks.onDelete?.();
                modalHandle.dispose();
            }
        };
        footer.appendChild(deleteBtn);
    }

    panel.appendChild(footer);
    overlay.appendChild(panel);

    return modalHandle;
}
