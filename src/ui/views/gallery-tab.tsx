/**
 * 本地图库选项卡视图 (GalleryTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 GalleryViewModel 构建，专注于图像资产浏览、多维检索与批量管理
 * （本地存储容量监控与分级清理统一归口至“日志与统计”选项卡）：
 * 1. 顶部快筛与检索工具栏卡片（全部/收藏/未收藏快筛胶囊、关键词搜索、服务引擎筛选、时间排序与批量管理切换）；
 * 2. 批量选择操作条（全选当前页、取消全选、导出元数据 JSON、批量删除）；
 * 3. 响应式图像卡片网格 (MediaCardView)；
 * 4. 底部分页导航栏。
 */

import type { VNode } from 'preact';
import {
    PreactSettingsView,
    TextInputControl,
    SelectControl,
    ButtonControl,
    MediaCardView,
} from '../framework';
import { GalleryViewModel } from '../viewmodels/gallery-vm';
import { imageInfoModal } from '../media';
import { renderIcon } from '../components/icons';

const ENGINE_FILTER_OPTIONS = [
    { label: '全部服务', value: 'all' },
    { label: 'ComfyUI', value: 'comfyui' },
    { label: 'SD-WebUI / Forge', value: 'sdwebui' },
    { label: 'NovelAI', value: 'novelai' },
    { label: 'OpenAI 兼容', value: 'openai' },
];

const SORT_MODE_OPTIONS = [
    { label: '时间倒序 (最新)', value: 'time-desc' },
    { label: '时间正序 (最早)', value: 'time-asc' },
];

export class GalleryTabView extends PreactSettingsView {
    public readonly id = 'gallery';
    public readonly title = '本地图库';

    public readonly vm: GalleryViewModel;

    public constructor() {
        super('da-tab-pane da-gallery-manager-widget');
        this.vm = new GalleryViewModel();
        this.mountPreact();
    }

    protected renderContent(): VNode {
        const summary = this.vm.storageSummary.value;
        const pageRecords = this.vm.pageRecords.value;
        const totalItems = this.vm.filteredRecords.value.length;
        const totalPages = this.vm.totalPages.value;
        const currentPage = this.vm.currentPage.value;
        const isBatchMode = this.vm.isBatchMode.value;
        const selectedIds = this.vm.selectedIds.value;
        const favFilter = this.vm.favoriteFilter.value;
        // 订阅 pageUrlMap 以在异步 Blob URL 解析完成时触发更新
        const urlMap = this.vm.pageUrlMap.value;

        const filterTabs = [
            { value: 'all', label: '全部记录', count: summary.totalImages },
            { value: 'favorited', label: '已收藏', count: summary.favoritedImages },
            { value: 'unfavorited', label: '未收藏', count: summary.unfavoritedImages },
        ];

        return (
            <>
                <div className="da-gallery-toolbar-card">
                    <div className="da-gallery-toolbar-top">
                        <div className="da-gallery-filter-pills" role="tablist" aria-label="收藏状态快筛">
                            {filterTabs.map((tab) => {
                                const isActive = favFilter === tab.value;
                                return (
                                    <button
                                        key={tab.value}
                                        type="button"
                                        role="tab"
                                        aria-selected={isActive ? 'true' : 'false'}
                                        className={`da-gallery-pill${isActive ? ' is-active' : ''}`}
                                        onClick={() => this.vm.setFavoriteFilter(tab.value)}
                                    >
                                        <span>{tab.label}</span>
                                        <span className="da-gallery-pill__count">{tab.count}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="da-gallery-toolbar-actions">
                            <ButtonControl
                                label="刷新"
                                variant="ghost"
                                size="sm"
                                onClick={() => this.vm.refresh()}
                            />
                            <ButtonControl
                                label={isBatchMode ? '退出批量管理' : '批量管理'}
                                variant={isBatchMode ? 'primary' : 'secondary'}
                                size="sm"
                                onClick={() => this.vm.toggleBatchMode()}
                            />
                        </div>
                    </div>

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
                                value={this.vm.sortMode.value}
                                options={SORT_MODE_OPTIONS}
                                onChange={(val) => this.vm.setSortMode(val)}
                            />
                        </div>
                    </div>
                </div>

                {isBatchMode && (
                    <div className="da-gallery-batch-toolbar">
                        <div className="da-gallery-batch-toolbar__left">
                            <span className="da-gallery-batch-count">
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

                        <div className="da-gallery-batch-toolbar__right">
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
                )}

                <div className="da-gallery-stream-container">
                    <div className="da-media-grid">
                        {pageRecords.length === 0 ? (
                            <div className="da-gallery-empty">
                                <div
                                    className="da-gallery-empty__icon"
                                    dangerouslySetInnerHTML={{ __html: renderIcon('image', 32) }}
                                />
                                <div className="da-gallery-empty__title">暂无匹配的图像记录</div>
                                <div className="da-gallery-empty__sub">
                                    生成的图片将自动保存在本地图库中，支持按提示词、生图引擎或收藏状态检索
                                </div>
                            </div>
                        ) : (
                            pageRecords.map((record) => {
                                const displayUrl =
                                    this.vm.getDisplayUrl(record) ??
                                    urlMap.get(record.imageId);
                                const isLoadFailed = this.vm.loadFailedIds.value.has(
                                    record.imageId
                                );
                                const effectiveStatus = isLoadFailed ? 'failed' : record.status;
                                return (
                                    <MediaCardView
                                        key={record.imageId}
                                        item={{
                                            id: record.imageId,
                                            status: effectiveStatus,
                                            url: displayUrl,
                                            isFavorite: Boolean(record.favorited),
                                            ...(isLoadFailed
                                                ? { errorMessage: '图像资源无法载入' }
                                                : {}),
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
                                                onPreview: () =>
                                                    void this.vm.openLightboxForRecord(
                                                        record.imageId
                                                    ),
                                                onDelete: () => {
                                                    void this.vm.deleteSingleRecord(record.imageId);
                                                },
                                            });
                                        }}
                                        onToggleFavorite={(fav, item) =>
                                            void this.vm.toggleFavorite(item.id, fav)
                                        }
                                        onImageError={(item) =>
                                            this.vm.retryLoadRecord(item.id, true)
                                        }
                                        onRetry={(item) =>
                                            void this.vm.retryLoadRecord(item.id)
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

                <div className="da-gallery-pagination">
                    <ButtonControl
                        label="上一页"
                        variant="secondary"
                        size="sm"
                        disabled={currentPage <= 1}
                        onClick={() => this.vm.prevPage()}
                    />
                    <span className="da-gallery-pagination__info">
                        {`第 ${currentPage} / ${totalPages} 页 · 共 ${totalItems} 项`}
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
        super.activate();
        void this.vm.refresh();
    }

    public override dispose(): void {
        this.vm.dispose();
        super.dispose();
    }
}
