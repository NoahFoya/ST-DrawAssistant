/**
 * @module ui/views/gallery-tab
 * @description 本地历史图库管理面板视图 (包含全量生成历史检索、缩略图网格流、大图灯箱预览与批量清理导出)
 */

import { IStorageAdapter, StoredImageRecord } from '../../core/state/storage-adapter';
import { ControlFactory } from '../components/controls';
import { FeedbackService } from '../feedback-service';

/**
 * 构建并渲染本地历史图库面板
 *
 * @param storage 本地持久化存储适配器实例
 * @returns 图库面板 DOM 根节点
 */
export function createGalleryTabView(storage: IStorageAdapter): HTMLElement {
    const controls = new ControlFactory();
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-gallery-tab';

    const card = controls.createCard('🖼️ 本地已生成图库 (IndexedDB Gallery)', (body) => {
        const toolbar = document.createElement('div');
        toolbar.style.display = 'flex';
        toolbar.style.justifyContent = 'space-between';
        toolbar.style.alignItems = 'center';
        toolbar.style.marginBottom = '12px';

        const leftBtns = document.createElement('div');
        leftBtns.style.display = 'flex';
        leftBtns.style.gap = '8px';

        const filterBtn = document.createElement('button');
        filterBtn.className = 'da-btn secondary';
        filterBtn.textContent = '⭐ 仅看收藏';
        let showOnlyFavorite = false;

        const exportBtn = document.createElement('button');
        exportBtn.className = 'da-btn secondary';
        exportBtn.textContent = '📦 导出图库 (JSON)';
        exportBtn.title = '导出全部图像元数据清单为 JSON 文件备份';
        exportBtn.onclick = async () => {
            try {
                const records = await storage.getAllImages();
                const exportData = records.map((r) => ({
                    id: r.id,
                    prompt: r.prompt,
                    hash: r.hash,
                    isFavorite: r.isFavorite,
                    timestamp: r.timestamp,
                    metadata: r.metadata
                }));
                const json = JSON.stringify(exportData, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ST-DrawAssistant-gallery-${Date.now()}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                FeedbackService.toast('图库元数据导出成功');
            } catch (err: any) {
                FeedbackService.toast(err.message || '导出失败', true);
            }
        };

        leftBtns.appendChild(filterBtn);
        leftBtns.appendChild(exportBtn);
        toolbar.appendChild(leftBtns);
        body.appendChild(toolbar);

        const grid = document.createElement('div');
        grid.className = 'da-gallery-grid';
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(140px, 1fr))';
        grid.style.gap = '12px';

        const loadImages = async () => {
            grid.innerHTML = '<div style="color:var(--da-text-secondary); font-size:0.85em;">加载中...</div>';
            try {
                let images = await storage.getAllImages();
                if (showOnlyFavorite) {
                    images = images.filter((i) => i.isFavorite);
                }
                grid.innerHTML = '';

                if (images.length === 0) {
                    grid.innerHTML =
                        '<div style="color:var(--da-text-secondary); font-size:0.85em;">暂无图像记录</div>';
                    return;
                }

                images.forEach((img: StoredImageRecord) => {
                    const item = document.createElement('div');
                    item.className = 'da-gallery-item';
                    item.style.position = 'relative';
                    item.style.borderRadius = 'var(--da-radius-small, 8px)';
                    item.style.overflow = 'hidden';
                    item.style.border = '1px solid var(--da-border-color)';
                    item.style.background = 'var(--da-bg-secondary)';

                    const imgEl = document.createElement('img');
                    imgEl.src = img.data;
                    imgEl.style.width = '100%';
                    imgEl.style.height = '140px';
                    imgEl.style.objectFit = 'cover';
                    imgEl.style.cursor = 'pointer';
                    imgEl.title = `${img.prompt} (点击查看大图)`;
                    imgEl.onclick = () => {
                        FeedbackService.lightbox(img.data);
                    };

                    // 悬浮/操作覆盖层
                    const actions = document.createElement('div');
                    actions.style.position = 'absolute';
                    actions.style.bottom = '0';
                    actions.style.left = '0';
                    actions.style.right = '0';
                    actions.style.display = 'flex';
                    actions.style.justifyContent = 'space-between';
                    actions.style.padding = '4px 6px';
                    actions.style.background = 'var(--da-shadow-strong, rgba(0, 0, 0, 0.65))';

                    const favBtn = document.createElement('button');
                    favBtn.style.background = 'none';
                    favBtn.style.border = 'none';
                    favBtn.style.cursor = 'pointer';
                    favBtn.style.color = img.isFavorite ? 'var(--da-accent-color)' : 'var(--da-text-primary, #ffffff)';
                    favBtn.textContent = img.isFavorite ? '★' : '☆';
                    favBtn.onclick = async (e) => {
                        e.stopPropagation();
                        await storage.toggleFavorite(img.id);
                        await loadImages();
                    };

                    const delBtn = document.createElement('button');
                    delBtn.style.background = 'none';
                    delBtn.style.border = 'none';
                    delBtn.style.cursor = 'pointer';
                    delBtn.style.color = 'var(--da-color-error, #ff453a)';
                    delBtn.textContent = '🗑️';
                    delBtn.onclick = async (e) => {
                        e.stopPropagation();
                        const confirmed = await FeedbackService.confirm({
                            title: '删除图库记录',
                            message: '确定要从本地图库彻底移除该图片吗？',
                            isDangerous: true
                        });
                        if (confirmed) {
                            await storage.deleteImage(img.id);
                            await loadImages();
                            FeedbackService.toast('已删除图像记录');
                        }
                    };

                    actions.appendChild(favBtn);
                    actions.appendChild(delBtn);

                    item.appendChild(imgEl);
                    item.appendChild(actions);
                    grid.appendChild(item);
                });
            } catch {
                grid.innerHTML =
                    '<div style="color:var(--da-color-error); font-size:0.85em;">加载图库失败</div>';
            }
        };

        filterBtn.onclick = () => {
            showOnlyFavorite = !showOnlyFavorite;
            filterBtn.textContent = showOnlyFavorite ? '📋 查看全部' : '⭐ 仅看收藏';
            void loadImages();
        };

        void loadImages();
        body.appendChild(grid);
    });

    container.appendChild(card);
    return container;
}
