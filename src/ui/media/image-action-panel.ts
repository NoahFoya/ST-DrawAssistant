import { ThemeService } from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';
import { openImageInfoPanel } from './image-info-panel';
import { Logger, IDisposable, IStorageAdapter } from '../../core';
import { ModalService } from '../layout/modal-service';

const logger = new Logger('ImageActionPanel');

export interface ImageActionCallbacks {
    imageSrc?: string;
    mimeType?: string;
    promptText?: string;
    negativePrompt?: string;
    messageIndex?: number;
    buttonIndex?: number;
    uuid?: string;
    storage?: IStorageAdapter;
    onConfirm?: (newPrompt: string, newNegativePrompt?: string) => void;
    onLightbox?: () => void;
    onRegen?: () => void;
    onRegenerate?: () => void;
    onInpaint?: () => void;
    onDownload?: () => void;
    onDelete?: () => void;
    onInfo?: () => void;
    [key: string]: unknown;
}

export function openImageActionPanel(_e: MouseEvent | PointerEvent, callbacks: ImageActionCallbacks): IDisposable {
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

    // 1. Header 顶栏
    const header = document.createElement('div');
    header.className = 'da-action-panel__header';

    const headerTitle = document.createElement('h3');
    headerTitle.className = 'da-action-panel__title';
    headerTitle.textContent =
        callbacks.messageIndex !== undefined ? `图像操作栏 (#${callbacks.messageIndex})` : '图像操作栏';

    const btnClose = document.createElement('button');
    btnClose.className = 'da-btn da-btn--secondary da-btn--sm';
    btnClose.textContent = '✕';
    btnClose.onclick = () => modalHandle.dispose();

    header.appendChild(headerTitle);
    header.appendChild(btnClose);
    panel.appendChild(header);

    // 2. 主体 Prompt 卡片区
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
            void navigator.clipboard.writeText(textarea.value).then(() => {
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
        return { card, textarea };
    };

    const posCard = createTagCard(
        '提取正向提示词 (Positive Tags)',
        callbacks.promptText || '',
        '输入正向生图提示词...',
        '已成功复制正向提示词'
    );

    const negCard = createTagCard(
        '反向提示词 (Negative Tags)',
        callbacks.negativePrompt || '',
        '输入反向过滤提示词...',
        '已成功复制反向提示词'
    );

    body.appendChild(posCard.card);
    body.appendChild(negCard.card);

    if (callbacks.uuid && !callbacks.negativePrompt) {
        const targetStorage = callbacks.storage;
        if (targetStorage) {
            targetStorage.getImage(callbacks.uuid).then((rec) => {
                const meta = rec?.metadata as Record<string, any> | undefined;
                const rawNeg = meta?.negativePrompt || meta?.fullNegativePrompt || (rec as any)?.negativePrompt;
                if (rawNeg && !negCard.textarea.value) {
                    negCard.textarea.value = String(rawNeg);
                }
            }).catch((err) => {
                logger.debug('从数据库获取反向提示词失败:', err);
            });
        }
    }

    panel.appendChild(body);

    // 3. Footer 操作按钮行
    const footer = document.createElement('div');
    footer.className = 'da-action-panel__footer';

    const footerLeft = document.createElement('div');
    footerLeft.className = 'da-action-panel__footer-left';

    const btnInpaint = document.createElement('button');
    btnInpaint.className = 'da-btn da-btn--secondary da-btn--sm';
    btnInpaint.textContent = '局部重绘';
    btnInpaint.onclick = () => {
        overlay.remove();
        if (callbacks.onInpaint) {
            callbacks.onInpaint();
        } else {
            FeedbackService.toastWarning('当前状态不支持局部重绘');
        }
    };
    footerLeft.appendChild(btnInpaint);

    const btnInfo = document.createElement('button');
    btnInfo.className = 'da-btn da-btn--secondary da-btn--sm';
    btnInfo.textContent = '元数据';
    btnInfo.onclick = () => {
        overlay.remove();
        if (callbacks.onInfo) {
            callbacks.onInfo();
        } else {
            openImageInfoPanel(callbacks.uuid || callbacks, { storage: callbacks.storage });
        }
    };
    footerLeft.appendChild(btnInfo);

    const btnDownload = document.createElement('button');
    btnDownload.className = 'da-btn da-btn--secondary da-btn--sm';
    btnDownload.textContent = '下载';
    btnDownload.onclick = () => {
        if (callbacks.onDownload) {
            callbacks.onDownload();
        } else if (callbacks.imageSrc) {
            const a = document.createElement('a');
            a.href = callbacks.imageSrc;
            a.download = `image-${callbacks.uuid || Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            FeedbackService.toastSuccess('已开始下载图像');
        } else {
            FeedbackService.toastWarning('未检测到可下载的图像资源');
        }
    };
    footerLeft.appendChild(btnDownload);

    const btnDelete = document.createElement('button');
    btnDelete.className = 'da-btn da-btn--danger da-btn--sm';
    btnDelete.textContent = '删除';
    btnDelete.onclick = async () => {
        overlay.remove();
        if (callbacks.onDelete) {
            callbacks.onDelete();
        } else {
            const confirmed = await FeedbackService.confirm({
                title: '删除确认',
                message: '确定要删除该图像吗？',
                isDangerous: true
            });
            if (confirmed) {
                FeedbackService.toastSuccess('图像已从视图中移除');
            }
        }
    };
    footerLeft.appendChild(btnDelete);

    const btnRegen = document.createElement('button');
    btnRegen.className = 'da-btn da-btn--primary da-btn--sm';
    btnRegen.textContent = '重新生成';
    btnRegen.onclick = () => {
        const newPos = posCard.textarea.value.trim();
        const newNeg = negCard.textarea.value.trim();
        modalHandle.dispose();
        if (callbacks.onConfirm) {
            callbacks.onConfirm(newPos, newNeg);
        } else if (callbacks.onRegenerate) {
            callbacks.onRegenerate();
        }
    };

    footer.appendChild(footerLeft);
    footer.appendChild(btnRegen);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    return modalHandle;
}
