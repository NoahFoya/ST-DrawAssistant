/**
 * 本地图库选项卡视图 (GalleryTab / createGalleryTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 GalleryState 构建，专注于图像资产浏览、多维检索与批量管理
 * （本地存储容量监控与分级清理统一归口至“日志与统计”选项卡）：
 * 1. 顶部快筛与检索工具栏卡片（全部/收藏/未收藏快筛胶囊、关键词搜索、服务引擎筛选、时间排序与批量管理切换）；
 * 2. 批量选择操作条（全选当前页、取消全选、导出元数据 JSON、批量删除）；
 * 3. 响应式图像卡片网格 (MediaCard)；
 * 4. 底部分页导航栏。
 */

import type { VNode } from 'preact';
import {
    createPreactSettingsView,
    TextInputControl,
    SelectControl,
    ButtonControl,
    type StatefulSettingsView,
} from '../framework';
import { MediaCard } from '../composite';
import { GalleryState } from '../state';
import { imageInfoModal } from '../media';
import { renderIcon } from '../components/icons';

const ENGINE_FILTER_OPTIONS = [
    { label: '全部服务', value: 'all' },
    { label: 'ComfyUI', value: 'comfyui' },
    { label: 'SD-WebUI / Forge', value: 'sdwebui' },
    { label: 'NovelAI', value: 'novelai' },
    { label: 'OpenAI 兼容', value: 'openai' },
    { label: 'Google Gemini', value: 'gemini' },
    { label: 'xAI Grok', value: 'grok' },
];

const SORT_MODE_OPTIONS = [
    { label: '时间倒序 (最新)', value: 'time-desc' },
    { label: '时间正序 (最早)', value: 'time-asc' },
];

export function GalleryTab(props: { vm: GalleryState }): VNode {
    const { vm } = props;
    const summary = vm.storageSummary.value;
    const pageRecords = vm.pageRecords.value;
    const totalItems = vm.filteredRecords.value.length;
    const totalPages = vm.totalPages.value;
    const currentPage = vm.currentPage.value;
    const isBatchMode = vm.isBatchMode.value;
    const selectedIds = vm.selectedIds.value;
    const favFilter = vm.favoriteFilter.value;
    // 订阅 pageUrlMap 以在异步 Blob URL 解析完成时触发更新
    const urlMap = vm.pageUrlMap.value;

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
                                        onClick={() => vm.setFavoriteFilter(tab.value)}
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
                                variant="secondary"
                                onClick={() => vm.refresh()}
                            />
                            <ButtonControl
                                label={isBatchMode ? '退出批量管理' : '批量管理'}
                                variant={isBatchMode ? 'primary' : 'secondary'}
                                onClick={() => vm.toggleBatchMode()}
                            />
                        </div>
                    </div>

                    <div className="da-gallery-toolbar">
                        <TextInputControl
                            value={vm.keyword.value}
                            placeholder="搜索提示词、模型或种子..."
                            clearable={true}
                            onChange={(val) => vm.setKeyword(val)}
                        />

                        <div className="da-gallery-filter-row">
                            <SelectControl
                                value={vm.engineFilter.value}
                                options={ENGINE_FILTER_OPTIONS}
                                onChange={(val) => vm.setEngineFilter(val)}
                            />
                            <SelectControl
                                value={vm.sortMode.value}
                                options={SORT_MODE_OPTIONS}
                                onChange={(val) => vm.setSortMode(val)}
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
                                onClick={() => vm.selectAllCurrentPage()}
                            />
                            <ButtonControl
                                label="取消全选"
                                variant="secondary"
                                size="sm"
                                onClick={() => vm.clearSelection()}
                            />
                        </div>

                        <div className="da-gallery-batch-toolbar__right">
                            <ButtonControl
                                label="导出元数据 (JSON)"
                                variant="secondary"
                                size="sm"
                                onClick={() => vm.exportSelectedBackup()}
                            />
                            <ButtonControl
                                label="批量删除"
                                variant="danger"
                                size="sm"
                                onClick={() => void vm.deleteSelectedItems()}
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
                                    生成的图片将自动保存在本地图库中，支持按提示词、生图服务或收藏状态检索
                                </div>
                            </div>
                        ) : (
                            pageRecords.map((record) => {
                                const displayUrl =
                                    vm.getDisplayUrl(record) ??
                                    urlMap.get(record.imageId);
                                const isLoadFailed = vm.loadFailedIds.value.has(
                                    record.imageId
                                );
                                const effectiveStatus = isLoadFailed ? 'failed' : record.status;
                                return (
                                    <MediaCard
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
                                            vm.toggleSelectItem(item.id, selected)
                                        }
                                        onPreview={() =>
                                            void vm.openLightboxForRecord(record.imageId)
                                        }
                                        onInfo={() => {
                                            imageInfoModal.open({
                                                record,
                                                metadata: record.metadata,
                                                imageUrl: displayUrl,
                                                onPreview: () =>
                                                    void vm.openLightboxForRecord(
                                                        record.imageId
                                                    ),
                                                onDelete: () => {
                                                    void vm.deleteSingleRecord(record.imageId);
                                                },
                                            });
                                        }}
                                        onToggleFavorite={(fav, item) =>
                                            void vm.toggleFavorite(item.id, fav)
                                        }
                                        onImageError={(item) =>
                                            vm.retryLoadRecord(item.id, true)
                                        }
                                        onRetry={(item) =>
                                            void vm.retryLoadRecord(item.id)
                                        }
                                        onDelete={(item) =>
                                            void vm.deleteSingleRecord(item.id)
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
                        onClick={() => vm.prevPage()}
                    />
                    <span className="da-gallery-pagination__info">
                        {`第 ${currentPage} / ${totalPages} 页 · 共 ${totalItems} 项`}
                    </span>
                    <ButtonControl
                        label="下一页"
                        variant="secondary"
                        size="sm"
                        disabled={currentPage >= totalPages}
                        onClick={() => vm.nextPage()}
                    />
                </div>
            </>
        );
}

export function createGalleryTabView(): StatefulSettingsView<GalleryState> {
    const vm = new GalleryState();
    return createPreactSettingsView<GalleryState>({
        id: 'gallery',
        title: '本地图库',
        className: 'da-tab-pane da-gallery-manager-widget',
        state: vm,
        render: () => <GalleryTab vm={vm} />,
        onActivate: () => {
            vm.activate();
        },
        onDeactivate: () => {
            vm.deactivate();
        },
        onDispose: () => {
            vm.dispose();
        },
    });
}
