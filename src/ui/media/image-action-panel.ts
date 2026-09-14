/**
 * @module src/ui/media/image-action-panel
 * @description 聊天楼层图片独立操作弹窗组件 (ImageActionPanel)
 *
 * 核心功能：
 * 1. 对应旧版 image-action-panel.ts 功能，面向用户在聊天楼层生成图片后的快捷操作；
 * 2. 提供正向/反向提示词卡片展示，支持一键复制、解锁编辑与取消修改；
 * 3. 提供局部重绘入口 (InpaintModal)、元数据详情入口 (ImageInfoModal)、原图下载、删除确认与基于编辑后提示词的重新生成；
 * 4. 严格遵循 tool-ui 设计规范，支持 Esc 与遮罩点击退出，使用 var(--da-*) 样式变量。
 */

import { createElement } from '../../util/dom';
import { Toast } from '../components/feedback';
import { getIconSvg } from '../components/icons';
import type { StoredImageRecord } from '@types';

export interface ImageActionData {
    messageId?: number | string;
    swipeId?: number;
    buttonIndex?: number;
    imageUrl?: string;
    imageBlob?: Blob;
    prompt?: string;
    negativePrompt?: string;
    record?: StoredImageRecord;
    metadata?: Record<string, unknown>;
}

export interface ImageActionPanelOptions {
    containerEl?: HTMLElement;
    onInpaint?: (data: ImageActionData) => void;
    onViewMetadata?: (data: ImageActionData) => void;
    onDownload?: (data: ImageActionData) => void;
    onDelete?: (data: ImageActionData) => Promise<boolean> | boolean;
    onRegenerate?: (newPrompt: string, newNegativePrompt: string, data: ImageActionData) => void;
    onClose?: () => void;
}

export interface ImageActionPanelHandle {
    readonly element: HTMLElement;
    open(data: ImageActionData): void;
    close(): void;
    isOpen(): boolean;
    dispose(): void;
}

export function createImageActionPanel(options: ImageActionPanelOptions = {}): ImageActionPanelHandle {
    const disposers: (() => void)[] = [];
    let currentData: ImageActionData | null = null;
    let isOpen = false;

    // 1. 全屏遮罩外壳
    const backdrop = createElement('div', {
        className: 'da-modal-backdrop st-da-root',
        attributes: {
            style: 'display: none; position: fixed; inset: 0; z-index: var(--da-z-modal, 100050); background: var(--da-bg-overlay-modal, rgba(0, 0, 0, 0.65)); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); align-items: center; justify-content: center;'
        }
    });

    // 2. 居中操作面板
    const panel = createElement('div', {
        className: 'da-action-panel',
        attributes: {
            style: 'width: 90%; max-width: 520px; background: var(--da-bg-card, #1e1e24); border: 1px solid var(--da-separator, #2f2f38); border-radius: var(--da-radius-lg, 12px); box-shadow: var(--da-shadow-lg, 0 12px 32px rgba(0,0,0,0.5)); display: flex; flex-direction: column; overflow: hidden; max-height: 85vh;'
        }
    });
    backdrop.appendChild(panel);

    // 3. Header 顶栏
    const header = createElement('div', {
        className: 'da-action-panel__header',
        attributes: {
            style: 'display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--da-separator, #2f2f38); background: var(--da-bg-panel, #25252d);'
        }
    });

    const headerTitle = createElement('div', {
        className: 'da-action-panel__title',
        attributes: {
            style: 'display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--da-text-primary, #fff);'
        }
    });
    headerTitle.innerHTML = `${getIconSvg('palette')} <span>图像操作栏</span>`;
    header.appendChild(headerTitle);

    const closeBtn = createElement('button', {
        className: 'da-icon-btn',
        attributes: {
            type: 'button',
            'aria-label': '关闭',
            title: '关闭 (Esc)',
            style: 'background: transparent; border: none; color: var(--da-text-secondary, #aaa); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 4px; transition: color 0.15s ease;'
        }
    });
    closeBtn.innerHTML = getIconSvg('close');
    closeBtn.addEventListener('click', () => close());
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // 4. Body 提示词区域
    const body = createElement('div', {
        className: 'da-action-panel__body',
        attributes: {
            style: 'padding: 16px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;'
        }
    });

    const createPromptCard = (title: string, placeholder: string) => {
        const card = createElement('div', {
            className: 'da-tag-card',
            attributes: {
                style: 'display: flex; flex-direction: column; gap: 8px; background: rgba(255,255,255,0.02); border: 1px solid var(--da-separator, #2f2f38); border-radius: var(--da-radius-md, 8px); padding: 10px 12px;'
            }
        });

        const cardHeader = createElement('div', {
            attributes: {
                style: 'display: flex; align-items: center; justify-content: space-between;'
            }
        });

        const labelSpan = createElement('span', {
            attributes: {
                style: 'font-size: 12px; font-weight: 500; color: var(--da-text-secondary, #aaa);'
            },
            textContent: title
        });

        const btnGroup = createElement('div', {
            attributes: {
                style: 'display: flex; align-items: center; gap: 6px;'
            }
        });

        const copyBtn = createElement('button', {
            attributes: {
                type: 'button',
                title: '复制提示词',
                style: 'display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; font-size: 11px; border-radius: 4px; border: 1px solid var(--da-separator, #3a3a46); background: transparent; color: var(--da-text-secondary, #aaa); cursor: pointer;'
            }
        });
        copyBtn.innerHTML = `${getIconSvg('copy')} <span>复制</span>`;

        const editBtn = createElement('button', {
            attributes: {
                type: 'button',
                title: '编辑提示词',
                style: 'display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; font-size: 11px; border-radius: 4px; border: 1px solid var(--da-separator, #3a3a46); background: transparent; color: var(--da-text-secondary, #aaa); cursor: pointer;'
            }
        });
        editBtn.innerHTML = `${getIconSvg('edit')} <span>编辑</span>`;

        const cancelBtn = createElement('button', {
            attributes: {
                type: 'button',
                title: '取消修改并还原',
                style: 'display: none; align-items: center; gap: 4px; padding: 2px 8px; font-size: 11px; border-radius: 4px; border: 1px solid var(--da-separator, #3a3a46); background: transparent; color: var(--da-text-secondary, #aaa); cursor: pointer;'
            },
            textContent: '取消'
        });

        btnGroup.appendChild(copyBtn);
        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(cancelBtn);

        cardHeader.appendChild(labelSpan);
        cardHeader.appendChild(btnGroup);
        card.appendChild(cardHeader);

        const textarea = createElement('textarea', {
            className: 'da-textarea',
            attributes: {
                placeholder,
                readonly: 'true',
                style: 'width: 100%; min-height: 68px; font-size: 12px; line-height: 1.5; font-family: monospace; padding: 6px 8px; border-radius: 4px; border: 1px solid transparent; background: rgba(0,0,0,0.25); color: var(--da-text-primary, #fff); resize: vertical; box-sizing: border-box; outline: none;'
            }
        }) as HTMLTextAreaElement;

        let isEditing = false;
        let backupText = '';

        copyBtn.addEventListener('click', () => {
            const val = textarea.value.trim();
            if (!val) {
                Toast.info('内容为空');
                return;
            }
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(val).then(() => {
                    Toast.success('提示词已复制到剪贴板');
                }).catch(() => {
                    Toast.warn('复制受阻，请手动选择复制');
                });
            }
        });

        editBtn.addEventListener('click', () => {
            if (!isEditing) {
                isEditing = true;
                backupText = textarea.value;
                textarea.readOnly = false;
                textarea.style.border = '1px solid var(--da-accent-color, #4a88f7)';
                textarea.style.background = 'rgba(0,0,0,0.4)';
                textarea.focus();
                editBtn.innerHTML = `${getIconSvg('check')} <span>锁定</span>`;
                cancelBtn.style.display = 'inline-flex';
            } else {
                isEditing = false;
                backupText = textarea.value;
                textarea.readOnly = true;
                textarea.style.border = '1px solid transparent';
                textarea.style.background = 'rgba(0,0,0,0.25)';
                editBtn.innerHTML = `${getIconSvg('edit')} <span>编辑</span>`;
                cancelBtn.style.display = 'none';
            }
        });

        cancelBtn.addEventListener('click', () => {
            if (isEditing) {
                isEditing = false;
                textarea.value = backupText;
                textarea.readOnly = true;
                textarea.style.border = '1px solid transparent';
                textarea.style.background = 'rgba(0,0,0,0.25)';
                editBtn.innerHTML = `${getIconSvg('edit')} <span>编辑</span>`;
                cancelBtn.style.display = 'none';
            }
        });

        card.appendChild(textarea);

        return {
            card,
            textarea,
            setValue(text: string) {
                isEditing = false;
                backupText = text || '';
                textarea.value = text || '';
                textarea.readOnly = true;
                textarea.style.border = '1px solid transparent';
                textarea.style.background = 'rgba(0,0,0,0.25)';
                editBtn.innerHTML = `${getIconSvg('edit')} <span>编辑</span>`;
                cancelBtn.style.display = 'none';
            },
            getValue(): string {
                return textarea.value.trim();
            }
        };
    };

    const posCard = createPromptCard('正向提示词 (Prompt)', '正向提示词内容...');
    const negCard = createPromptCard('反向提示词 (Negative Prompt)', '反向过滤提示词内容...');

    body.appendChild(posCard.card);
    body.appendChild(negCard.card);
    panel.appendChild(body);

    // 5. Footer 操作按钮行
    const footer = createElement('div', {
        className: 'da-action-panel__footer',
        attributes: {
            style: 'display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-top: 1px solid var(--da-separator, #2f2f38); background: var(--da-bg-panel, #25252d);'
        }
    });

    const footerLeft = createElement('div', {
        attributes: { style: 'display: flex; align-items: center; gap: 8px;' }
    });

    // 次要操作：局部重绘
    const btnInpaint = createElement('button', {
        className: 'da-btn da-btn--secondary da-btn--sm',
        attributes: {
            type: 'button',
            title: '进入画布绘制蒙版重绘',
            style: 'display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; font-size: 12px; border-radius: 4px; border: 1px solid var(--da-separator, #3a3a46); background: rgba(255,255,255,0.06); color: var(--da-text-primary, #fff); cursor: pointer;'
        }
    });
    btnInpaint.innerHTML = `${getIconSvg('palette')} <span>局部重绘</span>`;
    btnInpaint.addEventListener('click', () => {
        if (!currentData) return;
        close();
        if (options.onInpaint) {
            options.onInpaint(currentData);
        } else {
            Toast.warn('当前状态不支持局部重绘');
        }
    });
    footerLeft.appendChild(btnInpaint);

    // 次要操作：元数据详情（双入口之二！）
    const btnInfo = createElement('button', {
        className: 'da-btn da-btn--secondary da-btn--sm',
        attributes: {
            type: 'button',
            title: '查看图像技术元数据与生成超参数',
            style: 'display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; font-size: 12px; border-radius: 4px; border: 1px solid var(--da-separator, #3a3a46); background: rgba(255,255,255,0.06); color: var(--da-text-primary, #fff); cursor: pointer;'
        }
    });
    btnInfo.innerHTML = `${getIconSvg('help')} <span>元数据</span>`;
    btnInfo.addEventListener('click', () => {
        if (!currentData) return;
        close();
        if (options.onViewMetadata) {
            options.onViewMetadata(currentData);
        } else {
            Toast.warn('未检测到可用的技术元数据');
        }
    });
    footerLeft.appendChild(btnInfo);

    // 次要操作：下载原图
    const btnDownload = createElement('button', {
        className: 'da-btn da-btn--secondary da-btn--sm',
        attributes: {
            type: 'button',
            title: '下载原图至本地',
            style: 'display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; font-size: 12px; border-radius: 4px; border: 1px solid var(--da-separator, #3a3a46); background: rgba(255,255,255,0.06); color: var(--da-text-primary, #fff); cursor: pointer;'
        }
    });
    btnDownload.innerHTML = `${getIconSvg('download')} <span>下载</span>`;
    btnDownload.addEventListener('click', () => {
        if (!currentData) return;
        if (options.onDownload) {
            options.onDownload(currentData);
        } else if (currentData.imageUrl) {
            const a = document.createElement('a');
            a.href = currentData.imageUrl;
            a.download = `da-image-${currentData.messageId || Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            Toast.success('已开始下载图像');
        } else {
            Toast.warn('未检测到可下载的图像资源');
        }
    });
    footerLeft.appendChild(btnDownload);

    // 破坏性操作：删除
    const btnDelete = createElement('button', {
        className: 'da-btn da-btn--danger da-btn--sm',
        attributes: {
            type: 'button',
            title: '删除该图片',
            style: 'display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; font-size: 12px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.15); color: #f87171; cursor: pointer;'
        }
    });
    btnDelete.innerHTML = `${getIconSvg('trash')} <span>删除</span>`;
    btnDelete.addEventListener('click', async () => {
        if (!currentData) return;
        if (typeof window !== 'undefined' && window.confirm && !window.confirm('确定要删除此图像记录吗？')) {
            return;
        }
        close();
        if (options.onDelete) {
            await options.onDelete(currentData);
        }
        Toast.success('图像已移除');
    });
    footerLeft.appendChild(btnDelete);

    footer.appendChild(footerLeft);

    // 主要操作：重新生成 (Primary)
    const btnRegen = createElement('button', {
        className: 'da-btn da-btn--primary da-btn--sm',
        attributes: {
            type: 'button',
            title: '使用当前编辑后的提示词重新发起生成',
            style: 'display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; font-size: 12px; font-weight: 500; border-radius: 4px; border: none; background: var(--da-accent-color, #4a88f7); color: #fff; cursor: pointer; transition: opacity 0.15s ease;'
        }
    });
    btnRegen.innerHTML = `${getIconSvg('sparkles')} <span>重新生成</span>`;
    btnRegen.addEventListener('click', () => {
        if (!currentData) return;
        const newPos = posCard.getValue();
        const newNeg = negCard.getValue();
        close();
        if (options.onRegenerate) {
            options.onRegenerate(newPos, newNeg, currentData);
        }
    });
    footer.appendChild(btnRegen);

    panel.appendChild(footer);

    // 6. 遮罩点击与 Esc 键盘监听
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            close();
        }
    });

    const onKeyDown = (e: KeyboardEvent) => {
        if (isOpen && e.key === 'Escape') {
            e.stopPropagation();
            close();
        }
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('keydown', onKeyDown);
        disposers.push(() => window.removeEventListener('keydown', onKeyDown));
    }

    const parent = options.containerEl || (typeof document !== 'undefined' ? document.body : null);
    if (parent) {
        parent.appendChild(backdrop);
        disposers.push(() => backdrop.remove());
    }

    function open(data: ImageActionData): void {
        currentData = data;
        const titleSuffix = data.messageId !== undefined ? ` (#${data.messageId})` : '';
        headerTitle.innerHTML = `${getIconSvg('palette')} <span>图像操作栏${titleSuffix}</span>`;

        posCard.setValue(data.prompt || '');
        negCard.setValue(data.negativePrompt || '');

        backdrop.style.display = 'flex';
        isOpen = true;
    }

    function close(): void {
        if (!isOpen) return;
        backdrop.style.display = 'none';
        isOpen = false;
        options.onClose?.();
    }

    return {
        element: backdrop,
        open,
        close,
        isOpen() {
            return isOpen;
        },
        dispose() {
            close();
            for (const d of disposers) {
                d();
            }
            disposers.length = 0;
            currentData = null;
        }
    };
}
