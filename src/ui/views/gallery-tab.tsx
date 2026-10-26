/**
 * 历史生图画廊选项卡视图 (GalleryTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 GalleryViewModel 构建，将视图渲染与数据筛选/分页/批量管理完全解耦：
 * 1. 存储水位监控卡片 (StorageBarView)；
 * 2. 检索与多维筛选工具条 (TextInputControl + SelectControl + ButtonControl)；
 * 3. 响应式图像卡片网格 (MediaCardView)；
 * 4. 批量操作栏与分页控制器。
 */

import type { VNode } from 'preact';
import {
    PreactSettingsView,
    TextInputControl,
    SelectControl,
    ButtonControl,
    StorageBarView,
    MediaCardView,
} from '../framework';
import { GalleryViewModel } from '../viewmodels';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { imageInfoModal } from '../media';

const ENGINE_FILTER_OPTIONS = [
    { label: '全部服务', value: 'all' },
    { label: 'ComfyUI', value: 'comfyui' },
    { label: 'SD-WebUI / Forge', value: 'sdwebui' },
    { label: 'NovelAI', value: 'novelai' },
    { label: 'OpenAI 兼容', value: 'openai' },
];

const FAVORITE_FILTER_OPTIONS = [
    { label: '全部记录', value: 'all' },
    { label: '仅标星收藏 ★', value: 'favorited' },
    { label: '仅未标星草稿 ☆', value: 'unfavorited' },
];

const SORT_MODE_OPTIONS = [
    { label: '时间倒序 (最新)', value: 'time-desc' },
    { label: '时间正序 (最早)', value: 'time-asc' },
];

export class GalleryTabView extends PreactSettingsView {
    public readonly id = 'gallery';
    public readonly title = '历史生图画廊';

    public readonly vm: GalleryViewModel;

    public constructor() {
        super('da-tab-pane da-gallery-manager-widget');
        this.vm = new GalleryViewModel();
        this.mountPreact();
    }

    /**
     * 重新从本地存储检索全量记录并刷新画廊视图。
     */
    public async refresh(): Promise<void> {
        await this.vm.refresh();
    }

    protected renderContent(): VNode {
        const storageData = this.vm.storageSummary.value;
        const pageRecords = this.vm.pageRecords.value;
        const totalItems = this.vm.filteredRecords.value.length;
        const totalPages = this.vm.totalPages.value;
        const currentPage = this.vm.currentPage.value;
        const isBatchMode = this.vm.isBatchMode.value;
        const selectedIds = this.vm.selectedIds.value;
        // 订阅 pageUrlMap 以在异步 Blob URL 解析完成时触发更新
        const urlMap = this.vm.pageUrlMap.value;

        return (
            <>
                <StorageBarView
                    title="本地图片存储 (IndexedDB)"
                    className="da-storage-bar"
                    data={storageData}
                    confirmHandler={(msg) => ConfirmDialog.confirm(msg)}
                    onRefresh={() => this.vm.refresh()}
                    onCleanFailed={() => this.vm.cleanFailedRecords()}
                    onCleanUnfavorited={() => this.vm.cleanUnfavoritedRecords()}
                    onClearAll={() => this.vm.clearAllRecords()}
                />

                <div className="da-gallery-toolbar">
                    <TextInputControl
                        value={this.vm.keyword.value}
                        placeholder="搜索提示词、模型或种子..."
                        clearable={true}
                        onChange={(val) => this.vm.setKeyword(val)}
                    />

                    <div className="da-gallery-filter-row">
                        <SelectControl
                            value={this.vm.engineFilter.value}
                            options={ENGINE_FILTER_OPTIONS}
                            onChange={(val) => this.vm.setEngineFilter(val)}
                        />
                        <SelectControl
                            value={this.vm.favoriteFilter.value}
                            options={FAVORITE_FILTER_OPTIONS}
                            onChange={(val) => this.vm.setFavoriteFilter(val)}
                        />
                        <SelectControl
                            value={this.vm.sortMode.value}
                            options={SORT_MODE_OPTIONS}
                            onChange={(val) => this.vm.setSortMode(val)}
                        />
                        <ButtonControl
                            label={isBatchMode ? '退出管理' : '批量管理'}
                            variant="secondary"
                            size="sm"
                            onClick={() => this.vm.toggleBatchMode()}
                        />
                    </div>
                </div>

                <div className="da-gallery-stream-container">
                    <div className="da-media-grid">
                        {pageRecords.length === 0 ? (
                            <div
                                className="da-gallery-empty"
                                style={{
                                    gridColumn: '1 / -1',
                                    padding: '48px 0',
                                    textAlign: 'center',
                                    color: 'var(--da-text-secondary, #888)',
                                }}
                            >
                                <div style={{ fontSize: '32px', marginBottom: '8px' }}>🖼️</div>
                                <div style={{ fontSize: '13px' }}>暂无图片记录</div>
                            </div>
                        ) : (
                            pageRecords.map((record) => {
                                const displayUrl =
                                    this.vm.getDisplayUrl(record) ??
                                    urlMap.get(record.imageId);
                                return (
                                    <MediaCardView
                                        key={record.imageId}
                                        item={{
                                            id: record.imageId,
                                            status: record.status,
                                            url: displayUrl,
                                            isFavorite: Boolean(record.favorited),
                                        }}
                                        selectable={isBatchMode}
                                        selected={selectedIds.has(record.imageId)}
                                        onSelect={(selected, item) =>
                                            this.vm.toggleSelectItem(item.id, selected)
                                        }
                                        onPreview={() =>
                                            void this.vm.openLightboxForRecord(record.imageId)
                                        }
                                        onInfo={() => {
                                            imageInfoModal.open({
                                                record,
                                                metadata: record.metadata,
                                                imageUrl: displayUrl,
                                            });
                                        }}
                                        onToggleFavorite={(fav, item) =>
                                            void this.vm.toggleFavorite(item.id, fav)
                                        }
                                        onDelete={(item) =>
                                            void this.vm.deleteSingleRecord(item.id)
                                        }
                                    />
                                );
                            })
                        )}
                    </div>
                </div>

                <div
                    className="da-gallery-batch-toolbar"
                    style={{
                        display: isBatchMode ? 'flex' : 'none',
                        padding: '8px 14px',
                        background: 'var(--da-bg-secondary, #1e2029)',
                        border: '1px solid var(--da-border-color, rgba(255, 255, 255, 0.15))',
                        borderRadius: 'var(--da-radius-md, 8px)',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                            style={{
                                fontSize: '12px',
                                fontWeight: '600',
                                color: 'var(--da-text-primary, #fff)',
                            }}
                        >
                            {`已选中 ${selectedIds.size} 项`}
                        </span>
                        <ButtonControl
                            label="全选当前页"
                            variant="secondary"
                            size="sm"
                            onClick={() => this.vm.selectAllCurrentPage()}
                        />
                        <ButtonControl
                            label="取消全选"
                            variant="secondary"
                            size="sm"
                            onClick={() => this.vm.clearSelection()}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ButtonControl
                            label="导出元数据 (JSON)"
                            variant="secondary"
                            size="sm"
                            onClick={() => this.vm.exportSelectedBackup()}
                        />
                        <ButtonControl
                            label="批量删除"
                            variant="danger"
                            size="sm"
                            onClick={() => void this.vm.deleteSelectedItems()}
                        />
                    </div>
                </div>

                <div
                    className="da-gallery-pagination"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px',
                        padding: '12px 0',
                    }}
                >
                    <ButtonControl
                        label="上一页"
                        variant="secondary"
                        size="sm"
                        disabled={currentPage <= 1}
                        onClick={() => this.vm.prevPage()}
                    />
                    <span
                        style={{
                            fontSize: '12px',
                            color: 'var(--da-text-secondary, #aaa)',
                        }}
                    >
                        {`第 ${currentPage} / ${totalPages} 页 (共 ${totalItems} 项)`}
                    </span>
                    <ButtonControl
                        label="下一页"
                        variant="secondary"
                        size="sm"
                        disabled={currentPage >= totalPages}
                        onClick={() => this.vm.nextPage()}
                    />
                </div>
            </>
        );
    }

    public override activate(): void {
        void this.vm.refresh();
    }

    public override dispose(): void {
        this.vm.dispose();
        super.dispose();
    }
}
