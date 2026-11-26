/**
 * 本地持久化存储监控与分级维护卡片 (StorageBar)。
 *
 * @remarks
 * 负责呈现浏览器 IndexedDB 存储使用量与图片存储分布，并提供安全的分级清理能力：
 * 1. 存储容量预警：动态计算已用容量与配额上限，使用率超 75% 切换预警色，超 90% 切换危险告警色；
 * 2. 存储数据分布展示：呈现总图片数、标星收藏数、未收藏草稿与生成失败记录；
 * 3. 分级清理控制：支持清理失败记录、清理未收藏草稿与清空全部存储，并内置二次确认防护。
 */

import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { ButtonControl, CardView } from '../framework/controls';

/** 存储统计概览数据模型 */
export interface StorageSummaryData {
    /** 已用存储字节数 */
    readonly usedBytes: number;
    /** 总配额字节数 */
    readonly totalBytes: number;
    /** 容量使用百分比 (0 ~ 100) */
    readonly usagePercentage: number;
    /** 缓存图片总数 */
    readonly totalImages: number;
    /** 标星收藏图片数 */
    readonly favoritedImages: number;
    /** 未收藏图片数 */
    readonly unfavoritedImages: number;
    /** 生成失败记录数 */
    readonly failedCount: number;
}

/** 异步或同步确认处理函数类型定义 */
export type StorageConfirmHandler = (message: string) => Promise<boolean> | boolean;

/** 存储卡片组件属性 */
export interface StorageBarProps {
    /** 卡片主标题，默认 '本地存储空间 (IndexedDB)' */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** 当前存储统计数据 */
    data?: StorageSummaryData;
    /** 自定义操作确认处理器（未提供时使用 ConfirmDialog.confirm） */
    confirmHandler?: StorageConfirmHandler;
    /** 刷新存储配额回调 */
    onRefresh?: () => void | Promise<void>;
    /** 清理失败记录回调 */
    onCleanFailed?: () => void | Promise<void>;
    /** 清理未标星草稿回调 */
    onCleanUnfavorited?: () => void | Promise<void>;
    /** 清空全部存储回调 */
    onClearAll?: () => void | Promise<void>;
    /** 附加 CSS 类名 */
    className?: string;
}

const DEFAULT_STORAGE: StorageSummaryData = {
    usedBytes: 0,
    totalBytes: 1024 * 1024 * 1024,
    usagePercentage: 0,
    totalImages: 0,
    favoritedImages: 0,
    unfavoritedImages: 0,
    failedCount: 0,
};

function formatStorageBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(1)} ${units[i]}`;
}

export function StorageBar(props: StorageBarProps): VNode {
    const [loadingAction, setLoadingAction] = useState<
        'refresh' | 'failed' | 'unfavorited' | 'clearAll' | null
    >(null);

    const data = props.data ?? DEFAULT_STORAGE;
    const usedFormatted = formatStorageBytes(data.usedBytes);
    const totalFormatted = formatStorageBytes(data.totalBytes);
    const pct = Math.max(0, Math.min(100, Number.isFinite(data.usagePercentage) ? data.usagePercentage : 0));
    const variantClass = pct >= 90 ? 'is-danger' : pct >= 75 ? 'is-warning' : '';

    const confirmAction = async (message: string): Promise<boolean> => {
        if (props.confirmHandler) {
            try {
                return await props.confirmHandler(message);
            } catch {
                return false;
            }
        }
        return ConfirmDialog.confirm({
            title: '存储清理确认',
            message,
            isDanger: true,
        });
    };

    const runAction = async (
        action: 'refresh' | 'failed' | 'unfavorited' | 'clearAll',
        fn?: () => void | Promise<void>,
        confirmMessage?: string
    ): Promise<void> => {
        if (!fn) return;
        if (confirmMessage) {
            const confirmed = await confirmAction(confirmMessage);
            if (!confirmed) return;
        }
        try {
            setLoadingAction(action);
            await fn();
        } finally {
            setLoadingAction(null);
        }
    };

    const hasActions = Boolean(
        props.onCleanFailed || props.onCleanUnfavorited || props.onClearAll
    );

    const rootClass = ['da-storage-bar', 'da-card--padded', props.className || '']
        .filter(Boolean)
        .join(' ');

    return (
        <CardView
            title={props.title ?? '本地存储空间 (IndexedDB)'}
            subtitle={props.subtitle ?? '浏览器配额占用、存储分布与分级清理'}
            className={rootClass}
            actions={
                props.onRefresh ? (
                    <ButtonControl
                        label="刷新"
                        variant="ghost"
                        size="sm"
                        loading={loadingAction === 'refresh'}
                        onClick={() => void runAction('refresh', props.onRefresh)}
                    />
                ) : undefined
            }
        >
            <div className="da-storage-progress-wrapper">
                <div className="da-storage-label-row">
                    <span className="da-storage-label">
                        {`已用容量: ${usedFormatted} / ${totalFormatted}`}
                    </span>
                    <span className={`da-storage-pct-badge${variantClass ? ` ${variantClass}` : ''}`}>
                        {`${pct.toFixed(1)}%`}
                    </span>
                </div>
                <div className="da-storage-track">
                    <div
                        className={`da-storage-fill${variantClass ? ` ${variantClass}` : ''}`}
                        style={{ width: `${pct.toFixed(1)}%` }}
                    />
                </div>
            </div>

            <div className="da-stat-grid">
                <div className="da-stat-card">
                    <div className="da-stat-card__label">全部图片</div>
                    <div className="da-stat-card__val">{`${data.totalImages} 张`}</div>
                </div>
                <div className="da-stat-card">
                    <div className="da-stat-card__label">已收藏</div>
                    <div className="da-stat-card__val">{`${data.favoritedImages} 张`}</div>
                </div>
                <div className="da-stat-card">
                    <div className="da-stat-card__label">未收藏草稿</div>
                    <div className="da-stat-card__val">{`${data.unfavoritedImages} 张`}</div>
                </div>
                <div className="da-stat-card">
                    <div className="da-stat-card__label">失败记录</div>
                    <div className="da-stat-card__val">{`${data.failedCount} 项`}</div>
                </div>
            </div>

            {hasActions && (
                <div className="da-storage-actions-toolbar">
                    {props.onCleanFailed && (
                        <ButtonControl
                            label="清理失败记录"
                            variant="secondary"
                            size="sm"
                            disabled={data.failedCount === 0}
                            loading={loadingAction === 'failed'}
                            tooltip="清除本地生成失败、超时中断的任务报错记录，释放无效状态缓存"
                            onClick={() => void runAction('failed', props.onCleanFailed)}
                        />
                    )}
                    {props.onCleanUnfavorited && (
                        <ButtonControl
                            label="清理未收藏图片"
                            variant="secondary"
                            size="sm"
                            disabled={data.unfavoritedImages === 0}
                            loading={loadingAction === 'unfavorited'}
                            tooltip="仅删除未收藏的图片，已收藏图片将保留"
                            onClick={() =>
                                void runAction(
                                    'unfavorited',
                                    props.onCleanUnfavorited,
                                    '确定要清理全部未收藏的图片吗？已收藏的图片将保留。'
                                )
                            }
                        />
                    )}
                    {props.onClearAll && (
                        <ButtonControl
                            label="清空全部存储"
                            variant="danger"
                            size="sm"
                            loading={loadingAction === 'clearAll'}
                            tooltip="危险操作：清空本地 IndexedDB 中的全部图像资产（含收藏图片与元数据），不可逆"
                            onClick={() =>
                                void runAction(
                                    'clearAll',
                                    props.onClearAll,
                                    '警告：此操作将清空包含收藏在内的全部本地缓存图片，不可恢复！是否确认清空？'
                                )
                            }
                        />
                    )}
                </div>
            )}
        </CardView>
    );
}
