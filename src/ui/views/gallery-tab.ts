/**
 * @module ui/views/gallery-tab
 * @description 本地历史图库管理面板视图 (GalleryTab)
 */

import { IStorageAdapter } from '../../core/state/storage-adapter';
import { IHostBridge } from '../../core/foundation/host-bridge';
import { createSectionCard } from '../controls';
import {
    renderStorageBar,
    createGalleryManager,
    GalleryManagerHandle
} from '../media';
import { IDisposable } from '../../core/foundation/disposable';

/**
 * 构建并渲染本地历史图库面板
 *
 * @param storage 本地持久化存储适配器实例
 * @param hostBridge 可选宿主桥接适配器
 * @returns 包含生命周期清理能力的图库面板 DOM 根节点
 */
export function createGalleryTabView(storage: IStorageAdapter, hostBridge?: IHostBridge): HTMLElement & IDisposable {
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-gallery-tab';

    let galleryManagerHandle: GalleryManagerHandle | null = null;

    // ── G1: 本地存储配额概览 ───────────────────────────
    const cardStorage = createSectionCard({
        title: '本地存储概览',
        description: '监控本地数据库存储占用情况，空间不足时将自动清理非收藏历史图片',
        renderBody: (body) => {
            body.appendChild(renderStorageBar());
        }
    });
    container.appendChild(cardStorage);

    // ── G2: 历史画廊与管理 ───────────────────
    const cardManager = createSectionCard({
        title: '历史图库管理',
        description: '支持按提示词与模型筛选、批量导出与管理历史生图',
        renderBody: (body) => {
            galleryManagerHandle = createGalleryManager(storage, hostBridge);
            body.appendChild(galleryManagerHandle);
        }
    });
    container.appendChild(cardManager);

    container.dispose = () => {
        galleryManagerHandle?.dispose();
    };

    return container;
}
