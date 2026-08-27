/**
 * @module ui/views/gallery-tab
 * @description 本地历史图库管理面板视图 (GalleryTabView)
 *
 * 架构范式：继承 BaseTabView，实现 ITabView 接口
 */

import { IStorageAdapter, IHostBridge } from '../../core';
import { createCard, createCardHeader } from '../layout/container-factory';
import {
    renderStorageBar,
    createGalleryManager,
    GalleryManagerHandle,
    StorageCardHandle
} from '../media';
import { BaseTabView } from '../foundation/tab-view';

/**
 * 本地历史图库面板视图
 */
export class GalleryTabView extends BaseTabView {
    private _galleryManagerHandle: GalleryManagerHandle | null = null;
    private _storageBarHandle: StorageCardHandle | null = null;

    constructor(
        private readonly _storage: IStorageAdapter,
        private readonly _hostBridge?: IHostBridge
    ) {
        super('da-gallery-tab');
        this._buildCards();
    }

    private _buildCards(): void {
        // ── G1: 本地存储与图库统计 ───────────────────────────
        const cardStorage = createCard({ hoverable: true });
        const headerStorage = createCardHeader({
            title: '本地存储概览',
            description: '监控本地数据库存储占用情况，空间不足时将自动清理非收藏历史图片'
        });
        cardStorage.header.appendChild(headerStorage);

        this._storageBarHandle = renderStorageBar(this._storage, this._hostBridge, async () => {
            await this._galleryManagerHandle?.reload();
        });
        this._disposables.add(this._storageBarHandle);
        cardStorage.body.appendChild(this._storageBarHandle);
        this._root.appendChild(cardStorage.root);

        // ── G2: 历史画廊与管理 ───────────────────
        const cardManager = createCard({ hoverable: true });
        const headerManager = createCardHeader({
            title: '历史图库管理',
            description: '支持按提示词与模型筛选、批量导出与管理历史生图'
        });
        cardManager.header.appendChild(headerManager);

        this._galleryManagerHandle = createGalleryManager(this._storage, this._hostBridge, async () => {
            await this._storageBarHandle?.refresh();
        });
        this._disposables.add(this._galleryManagerHandle);
        cardManager.body.appendChild(this._galleryManagerHandle);
        this._root.appendChild(cardManager.root);
    }

    override dispose(): void {
        this._galleryManagerHandle = null;
        this._storageBarHandle = null;
        super.dispose();
    }
}

