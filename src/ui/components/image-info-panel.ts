/**
 * @module ui/components/image-info-panel
 * @description 图像元数据详情抽屉组件 (ImageInfoPanel)
 *
 * 职责：
 * - 呈现选中历史生图记录的完整 Positive Prompt、Negative Prompt、模型名称与采样配置
 * - 提供独立复制正向/负向 Prompt、下载原图与从 IndexedDB 物理删除图片功能
 */

import type { StoredImageRecord } from '../../storage/image-db';
import { deleteImageFromDB } from '../../storage/image-db';
import { formatBytes } from '../../utils/image-utils';
import { logger } from '../../core/logger';
import { openLightbox } from '../image-renderer';

export function openImageInfoPanel(record: StoredImageRecord, onDeleted?: () => void): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'da-image-info-panel-backdrop da-modal-backdrop';
    backdrop.style.zIndex = '10005';
    backdrop.style.display = 'flex';
    backdrop.style.justifyContent = 'center';
    backdrop.style.alignItems = 'center';
    backdrop.style.padding = '20px';

    const modal = document.createElement('div');
    modal.style.background = 'var(--da-bg-secondary, #1e1e2e)';
    modal.style.borderRadius = '12px';
    modal.style.width = '100%';
    modal.style.maxWidth = '520px';
    modal.style.maxHeight = '90vh';
    modal.style.overflowY = 'auto';
    modal.style.padding = '20px';
    modal.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
    modal.style.border = '1px solid var(--da-border-color, rgba(255,255,255,0.1))';
    modal.style.color = 'var(--da-text-primary)';

    // 点击事件冒泡隔离
    modal.addEventListener('click', (e) => e.stopPropagation());

    // 1. 头部
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '15px';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.style.fontSize = '1.1em';
    title.style.color = 'var(--da-text-primary)';
    title.textContent = `📷 图像元数据信息 (#${record.uuid.substring(0, 8)})`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-close-red-dot';
    closeBtn.title = '关闭详情抽屉';
    closeBtn.addEventListener('click', () => backdrop.remove());

    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // 2. 图片大图预览
    const imgContainer = document.createElement('div');
    imgContainer.style.width = '100%';
    imgContainer.style.maxHeight = '240px';
    imgContainer.style.background = 'var(--da-bg-primary, #000)';
    imgContainer.style.borderRadius = '8px';
    imgContainer.style.overflow = 'hidden';
    imgContainer.style.marginBottom = '15px';
    imgContainer.style.cursor = 'pointer';
    imgContainer.title = '点击查看全屏大图';

    const srcUrl = record.data.startsWith('data:') ? record.data : `data:${record.mime};base64,${record.data}`;
    const img = document.createElement('img');
    img.src = srcUrl;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';

    imgContainer.addEventListener('click', () => openLightbox(srcUrl));
    imgContainer.appendChild(img);
    modal.appendChild(imgContainer);

    // 3. 元数据表
    const metaTable = document.createElement('div');
    metaTable.style.display = 'flex';
    metaTable.style.flexDirection = 'column';
    metaTable.style.gap = '8px';
    metaTable.style.fontSize = '0.85em';

    const approxBytes = record.data ? record.data.length * 0.75 : 0;
    const meta = record.metadata ?? {};

    metaTable.appendChild(createMetaRow('UUID', record.uuid));
    metaTable.appendChild(createMetaRow('正向提示词 (Prompt)', record.prompt || '无'));
    metaTable.appendChild(createMetaRow('负向提示词 (Negative)', meta.negativePrompt || '无'));
    metaTable.appendChild(createMetaRow('生成引擎', (meta.provider ?? 'ComfyUI').toUpperCase()));
    metaTable.appendChild(createMetaRow('Checkpoint 模型', meta.ckptName ?? '默认模型'));
    metaTable.appendChild(createMetaRow('采样器 (Sampler)', `${meta.samplerName ?? 'euler_ancestral'} (${meta.steps ?? 20} 步, CFG ${meta.cfgScale ?? 7.0})`));
    metaTable.appendChild(createMetaRow('分辨率尺寸', `${meta.width ?? '未知'} × ${meta.height ?? '未知'}`));
    metaTable.appendChild(createMetaRow('文件类型 & 大小', `${record.mime} (${formatBytes(approxBytes)})`));
    metaTable.appendChild(createMetaRow('生成时间', new Date(record.timestamp).toLocaleString()));

    modal.appendChild(metaTable);

    // 4. 操作按钮栏
    const actionsBar = document.createElement('div');
    actionsBar.style.display = 'flex';
    actionsBar.style.gap = '8px';
    actionsBar.style.marginTop = '20px';
    actionsBar.style.flexWrap = 'wrap';

    const copyPositiveBtn = document.createElement('button');
    copyPositiveBtn.className = 'da-btn secondary';
    copyPositiveBtn.style.fontSize = '0.82em';
    copyPositiveBtn.innerHTML = '📋 复制正向 Prompt';
    copyPositiveBtn.addEventListener('click', () => {
        void navigator.clipboard.writeText(record.prompt || '');
        copyPositiveBtn.textContent = '✅ 已复制正向！';
        setTimeout(() => { copyPositiveBtn.innerHTML = '📋 复制正向 Prompt'; }, 1500);
    });

    const copyNegativeBtn = document.createElement('button');
    copyNegativeBtn.className = 'da-btn secondary';
    copyNegativeBtn.style.fontSize = '0.82em';
    copyNegativeBtn.innerHTML = '📋 复制负向 Prompt';
    copyNegativeBtn.addEventListener('click', () => {
        void navigator.clipboard.writeText(meta.negativePrompt || '');
        copyNegativeBtn.textContent = '✅ 已复制负向！';
        setTimeout(() => { copyNegativeBtn.innerHTML = '📋 复制负向 Prompt'; }, 1500);
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'da-btn primary';
    downloadBtn.style.fontSize = '0.82em';
    downloadBtn.innerHTML = '📥 下载图像';
    downloadBtn.addEventListener('click', () => {
        const ext = record.mime.split('/')[1] || 'png';
        const a = document.createElement('a');
        a.href = srcUrl;
        a.download = `st-draw-${record.uuid.substring(0, 8)}.${ext}`;
        a.click();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'da-btn danger';
    deleteBtn.style.fontSize = '0.82em';
    deleteBtn.innerHTML = '🗑️ 删除图片';
    deleteBtn.addEventListener('click', async () => {
        if (confirm(`确认永久删除图像 #${record.uuid.substring(0, 8)} 吗？`)) {
            await deleteImageFromDB(record.uuid);
            logger.info(`在图像面板中删除图像: uuid=${record.uuid}`);
            backdrop.remove();
            showToastNotice(`图像 #${record.uuid.substring(0, 8)} 已成功彻底删除。`, '删除成功', true);
            if (onDeleted) onDeleted();
        }
    });

    actionsBar.appendChild(copyPositiveBtn);
    actionsBar.appendChild(copyNegativeBtn);
    actionsBar.appendChild(downloadBtn);
    actionsBar.appendChild(deleteBtn);
    modal.appendChild(actionsBar);

    backdrop.appendChild(modal);
    backdrop.addEventListener('click', () => backdrop.remove());
    document.body.appendChild(backdrop);
}

function createMetaRow(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.background = 'var(--da-bg-input)';
    row.style.padding = '6px 10px';
    row.style.borderRadius = '6px';

    const lbl = document.createElement('span');
    lbl.style.width = '140px';
    lbl.style.flexShrink = '0';
    lbl.style.color = 'var(--da-text-secondary)';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.style.flex = '1';
    val.style.wordBreak = 'break-all';
    val.style.color = 'var(--da-text-primary)';
    val.textContent = value;

    row.appendChild(lbl);
    row.appendChild(val);
    return row;
}

/** 辅助函数：显示 ST 全局 Toast 通知 */
function showToastNotice(message: string, title = '图像详情', isSuccess = true): void {
    const win = window as unknown as { toastr?: { success?: (m: string, t?: string) => void; error?: (m: string, t?: string) => void; info?: (m: string, t?: string) => void } };
    if (win.toastr) {
        if (isSuccess && typeof win.toastr.success === 'function') {
            win.toastr.success(message, title);
            return;
        }
        if (!isSuccess && typeof win.toastr.error === 'function') {
            win.toastr.error(message, title);
            return;
        }
    }
    logger.info(`[${title}] ${message}`);
}
