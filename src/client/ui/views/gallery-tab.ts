/**
 * @module ui/views/gallery-tab
 * @description 本地历史图库管理面板视图 (GalleryTabView)
 */

import { StorageService } from '../../core/storage';
import { HostClient } from '../../core/host';
import { createCard, createCardHeader } from '../layout/container-factory';
import {
    renderStorageBar,
    createGalleryManager,
    GalleryManagerHandle,
    StorageCardHandle
} from '../media/gallery-view';
import { BaseTabView } from '../foundation/tab-view';

export class GalleryTabView extends BaseTabView {
    private _galleryManagerHandle: GalleryManagerHandle | null = null;
    private _storageBarHandle: StorageCardHandle | null = null;

    constructor(
        private readonly _storage?: StorageService,
        private readonly _hostClient?: HostClient
    ) {
        super('da-gallery-tab');
        this._buildCards();
    }

    private _buildCards(): void {
        // 1. 存储水位概览
        const cardStorage = createCard({ hoverable: true });
        const headerStorage = createCardHeader({
            title: '存储水位与概览',
            description: '监控本地 IndexedDB 数据库存储占用与容量水位'
        });
        cardStorage.header.appendChild(headerStorage);

        this._storageBarHandle = renderStorageBar(this._storage, this._hostClient, async () => {
            await this._galleryManagerHandle?.reload();
        });
        this._disposables.add(this._storageBarHandle);
        cardStorage.body.appendChild(this._storageBarHandle);
        this._root.appendChild(cardStorage.root);

        // 2. 图库瀑布流管理
        const cardManager = createCard({ hoverable: true });
        const headerManager = createCardHeader({
            title: '历史图库管理',
            description: '检索、预览与管理历史生成的本地图像资产'
        });
        cardManager.header.appendChild(headerManager);

        this._galleryManagerHandle = createGalleryManager(this._storage, this._hostClient, async () => {
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
