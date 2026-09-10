/**
 * 生图画廊面板视图 (GalleryTabView)
 * 包含本地存储占用概览与生图画廊图片管理，挂载至主设置面板的画廊标签页
 */

import { StorageService } from '../../state';
import { HostClient } from '../../host';
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
        super();
        this._buildCards();
    }

    private _buildCards(): void {
        // 存储空间概览卡片
        const cardStorage = createCard({ hoverable: true });
        const headerStorage = createCardHeader({
            title: '存储空间',
            description: '查看本地存储占用与图片统计'
        });
        cardStorage.header.appendChild(headerStorage);

        // 存储条主体 (配额进度条 + 统计指标)
        this._storageBarHandle = renderStorageBar(this._storage, this._hostClient, async () => {
            await this._galleryManagerHandle?.reload();
        });
        this._disposables.add(this._storageBarHandle);
        cardStorage.body.appendChild(this._storageBarHandle);

        // 存储空间操作栏 (清理无引用 / 清理未收藏 / 刷新统计 / 清空全部)
        const actionRow = document.createElement('div');
        actionRow.className = 'da-card-action-row';

        // 检查本地存储服务可用性，若处于无痕模式或存储服务初始化失败则拦截操作并提示，防静默失败
        const ensureStorage = async (): Promise<boolean> => {
            if (!this._storage) {
                const { FeedbackService } = await import('../feedback/feedback');
                FeedbackService.toastWarning('本地存储服务未初始化或已停用');
                return false;
            }
            return true;
        };

        // 按钮 1: 清理无引用图片
        const cleanIsoBtn = document.createElement('button');
        cleanIsoBtn.type = 'button';
        cleanIsoBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        cleanIsoBtn.textContent = '清理无引用图片';
        cleanIsoBtn.title = '扫描当前会话，清除已被聊天删除的孤立历史图片（保留已标星收藏图片）';
        cleanIsoBtn.onclick = async () => {
            if (!await ensureStorage()) return;
            const { FeedbackService } = await import('../feedback/feedback');
            const refIds = this._hostClient?.getReferencedImageIds ? this._hostClient.getReferencedImageIds() : new Set<string>();
            const confirmed = await FeedbackService.confirm({
                title: '清理无引用图片确认',
                message: '确定要清理当前聊天上下文中已失去引用的历史图片吗？已标星收藏的图片会保留。',
                confirmText: '确认清理'
            });
            if (confirmed && this._storage) {
                const count = await this._storage.cleanIsolatedImages(refIds);
                await this._storageBarHandle?.refresh();
                await this._galleryManagerHandle?.reload();
                FeedbackService.toastSuccess(count > 0 ? `已清理 ${count} 张无引用历史图片` : '未发现需要清理的无引用图片');
            }
        };

        // 按钮 2: 清理未收藏图片
        const cleanUnfavBtn = document.createElement('button');
        cleanUnfavBtn.type = 'button';
        cleanUnfavBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        cleanUnfavBtn.textContent = '清理未收藏图片';
        cleanUnfavBtn.title = '清理所有未加星标收藏的本地生图记录，已标星的图片将永久保留';
        cleanUnfavBtn.onclick = async () => {
            if (!await ensureStorage()) return;
            const { FeedbackService } = await import('../feedback/feedback');
            const confirmed = await FeedbackService.confirm({
                title: '清理未收藏图片确认',
                message: '确定要清理所有未加星标收藏的本地生图记录吗？已标星收藏的图片将被保留。',
                confirmText: '确认清理'
            });
            if (confirmed && this._storage) {
                const count = await this._storage.clearUnfavorited();
                await this._storageBarHandle?.refresh();
                await this._galleryManagerHandle?.reload();
                FeedbackService.toastSuccess(`已清理 ${count} 张未收藏图片`);
            }
        };

        // 按钮 3: 刷新统计
        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        refreshBtn.textContent = '刷新统计';
        refreshBtn.onclick = async () => {
            const { FeedbackService } = await import('../feedback/feedback');
            await this._storageBarHandle?.refresh();
            FeedbackService.toastSuccess('存储空间与资产统计已刷新');
        };

        // 按钮 4: 清空全部画廊 (危险)
        const clearAllBtn = document.createElement('button');
        clearAllBtn.type = 'button';
        clearAllBtn.className = 'da-btn da-btn--danger da-btn--sm';
        clearAllBtn.textContent = '清空画廊';
        clearAllBtn.title = '清空本地存储中的所有生图记录与元数据（包含收藏图片）';
        clearAllBtn.onclick = async () => {
            if (!await ensureStorage()) return;
            const { FeedbackService } = await import('../feedback/feedback');
            const confirmed = await FeedbackService.confirm({
                title: '⚠️ 危险：清空画廊确认',
                message: '此操作将永久清空本地数据库中的全部历史生图记录（包含所有已标星收藏的图片），且无法恢复！是否确定全部清空？',
                confirmText: '确认全部清空'
            });
            if (confirmed && this._storage) {
                await this._storage.clearAll();
                await this._storageBarHandle?.refresh();
                await this._galleryManagerHandle?.reload();
                FeedbackService.toastSuccess('已清空全部画廊数据');
            }
        };

        actionRow.appendChild(cleanIsoBtn);
        actionRow.appendChild(cleanUnfavBtn);
        actionRow.appendChild(refreshBtn);
        actionRow.appendChild(clearAllBtn);
        cardStorage.body.appendChild(actionRow);

        this._root.appendChild(cardStorage.root);

        // 画廊卡片
        const cardManager = createCard({ hoverable: true });
        const headerManager = createCardHeader({
            title: '生图画廊',
            description: '检索、预览与批量管理历史生图资产'
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

