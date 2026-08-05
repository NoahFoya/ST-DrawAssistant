/**
 * @module ui/components/storage-bar
 * @description 图库存储容量与配额进度条组件 (StorageBar)
 *
 * 职责：
 * - 呈现 IndexedDB 图像占用空间与浏览器 StorageQuota 动态比例条
 * - 提供一键孤立图库清理与格式清空引导
 */

import { getGalleryStats } from '../../storage/image-db';
import { findIsolatedImages, deleteIsolatedImages } from '../../storage/chat-scanner';
import { formatBytes } from '../../utils/image-utils';
import { logger } from '../../core/logger';

export function renderStorageBar(onRefreshGallery: () => void): HTMLElement {
    const card = document.createElement('div');
    card.className = 'da-section-card da-storage-bar-card';

    const updateView = async () => {
        card.innerHTML = '';

        const stats = await getGalleryStats();
        const usageRatio = Math.min(100, Number(((stats.usageBytes / stats.quotaBytes) * 100).toFixed(1)));

        let barColor = '#4caf50';
        if (usageRatio >= 80) barColor = '#f44336';
        else if (usageRatio >= 60) barColor = '#ff9800';

        const header = document.createElement('div');
        header.className = 'da-section-header';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.flexWrap = 'wrap';
        header.style.gap = '8px';

        const titleBox = document.createElement('div');
        titleBox.innerHTML = `
            <span class="da-section-title">存储概览与空间清理</span>
            <span class="da-section-desc">已存 ${stats.totalCount} 张生成图像 (空间占用: ${formatBytes(stats.totalSizeBytes)})</span>
        `;

        const actionBox = document.createElement('div');
        actionBox.style.display = 'flex';
        actionBox.style.gap = '8px';
        actionBox.style.alignItems = 'center';

        const scanIsolatedBtn = document.createElement('button');
        scanIsolatedBtn.className = 'da-btn secondary';
        scanIsolatedBtn.style.padding = '4px 10px';
        scanIsolatedBtn.style.fontSize = '0.85em';
        scanIsolatedBtn.textContent = '扫描孤立废图';

        const cleanIsolatedBtn = document.createElement('button');
        cleanIsolatedBtn.className = 'da-btn danger';
        cleanIsolatedBtn.style.padding = '4px 10px';
        cleanIsolatedBtn.style.fontSize = '0.85em';
        cleanIsolatedBtn.textContent = '清理孤立废图';

        scanIsolatedBtn.addEventListener('click', async () => {
            scanIsolatedBtn.disabled = true;
            scanIsolatedBtn.textContent = '扫描中...';
            try {
                const isolated = await findIsolatedImages();
                showToastNotice(`扫描完成！发现 ${isolated.length} 张未被任何聊天引用的孤立废弃图像。`, '孤立废图扫描', true);
            } catch (err) {
                logger.error('扫描孤立废图失败', err);
                showToastNotice(`扫描失败: ${err instanceof Error ? err.message : String(err)}`, '扫描失败', false);
            } finally {
                scanIsolatedBtn.disabled = false;
                scanIsolatedBtn.textContent = '扫描孤立废图';
            }
        });

        cleanIsolatedBtn.addEventListener('click', async () => {
            if (confirm('确认扫描并清理删除所有未在当前聊天消息中被引用的孤立废图数据吗？')) {
                cleanIsolatedBtn.disabled = true;
                cleanIsolatedBtn.textContent = '清理中...';
                try {
                    const count = await deleteIsolatedImages();
                    showToastNotice(`清理成功！已永久释放并删除 ${count} 张孤立废图。`, '废图清理成功', true);
                    onRefreshGallery();
                } catch (err) {
                    logger.error('清理孤立废图失败', err);
                    showToastNotice(`清理失败: ${err instanceof Error ? err.message : String(err)}`, '清理失败', false);
                } finally {
                    cleanIsolatedBtn.disabled = false;
                    cleanIsolatedBtn.textContent = '清理孤立废图';
                }
            }
        });

        actionBox.appendChild(scanIsolatedBtn);
        actionBox.appendChild(cleanIsolatedBtn);

        header.appendChild(titleBox);
        header.appendChild(actionBox);
        card.appendChild(header);

        // 存储使用率进度条
        const progressBg = document.createElement('div');
        progressBg.style.height = '6px';
        progressBg.style.background = 'rgba(255,255,255,0.1)';
        progressBg.style.borderRadius = '3px';
        progressBg.style.overflow = 'hidden';
        progressBg.style.margin = '8px 0 4px 0';

        const progressFill = document.createElement('div');
        progressFill.style.height = '100%';
        progressFill.style.width = `${usageRatio}%`;
        progressFill.style.background = barColor;

        progressBg.appendChild(progressFill);
        card.appendChild(progressBg);

        const subInfo = document.createElement('div');
        subInfo.style.fontSize = '0.78em';
        subInfo.style.color = 'var(--da-text-secondary)';
        subInfo.style.textAlign = 'right';
        subInfo.textContent = `浏览器存储已占用 ${formatBytes(stats.usageBytes)} / ${formatBytes(stats.quotaBytes)} (${usageRatio}%)`;
        card.appendChild(subInfo);
    };

    void updateView();
    return card;
}

/** 辅助函数：显示 ST 全局 Toast 通知 */
function showToastNotice(message: string, title = '存储空间', isSuccess = true): void {
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
