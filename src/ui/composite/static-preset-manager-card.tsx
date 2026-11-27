/**
 * 本地预设按需管理卡片 (StaticPresetManagerCard)。
 *
 * @remarks
 * 基于 Preact JSX 呈现 5 大内置预设目录的载入与卸载状态：
 * 1. 基于 `settingsStore.getStaticPresetCatalog()` 按分类折叠展示全部内置预设；
 * 2. 支持单条「载入 / 卸载」、分类级「载入本类 / 卸载本类」与全局「全部载入 / 全部卸载」；
 * 3. 直接按需写入或移除本地预设池，不影响用户自定义预设。
 */

import type { VNode } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
    settingsStore,
    type OfficialPresetSyncCategory,
    type StaticPresetCatalogCategory,
} from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { logger } from '../../util/logger';
import { ICONS } from '../components/icons';
import { Toast } from '../feedback/toast';
import { ButtonControl } from '../framework/controls';

export interface StaticPresetManagerCardProps {
    /** 卡片标题 */
    readonly title?: string;
    /** 附加类名 */
    readonly className?: string;
}

export function StaticPresetManagerCard(props: StaticPresetManagerCardProps): VNode {
    const [catalog, setCatalog] = useState<StaticPresetCatalogCategory[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [hasError, setHasError] = useState(false);
    const [expandedCategories, setExpandedCategories] = useState<Set<OfficialPresetSyncCategory>>(
        () => new Set<OfficialPresetSyncCategory>(['prompts'])
    );

    const mountedRef = useRef(true);
    const busyRef = useRef(false);
    const loadingRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const refreshCatalog = useCallback(async (forceReload: boolean) => {
        if (!mountedRef.current || loadingRef.current) return;
        loadingRef.current = true;
        setIsLoading(true);
        setHasError(false);

        try {
            const nextCatalog = await settingsStore.getStaticPresetCatalog(
                forceReload ? { forceReload: true } : undefined
            );
            if (!mountedRef.current) return;
            setCatalog(nextCatalog);
        } catch (err) {
            if (!mountedRef.current) return;
            logger.warn('[StaticPresetManagerCard] 读取静态预设目录失败:', err);
            setHasError(true);
        } finally {
            loadingRef.current = false;
            if (mountedRef.current) {
                setIsLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        void refreshCatalog(false);
        const unlisten = eventBus.on('settings:updated', (payload) => {
            if (!mountedRef.current || busyRef.current) return;
            if (!payload.keys || payload.keys.includes('presets')) {
                void refreshCatalog(false);
            }
        });
        return () => {
            unlisten();
        };
    }, [refreshCatalog]);

    const handleLoadKeys = async (keys: readonly string[], label: string) => {
        if (!mountedRef.current || busyRef.current || keys.length === 0) return;
        busyRef.current = true;
        setIsBusy(true);
        try {
            const count = await settingsStore.loadStaticPresetItems(keys);
            if (!mountedRef.current) return;
            await refreshCatalog(false);
            Toast.show(`已载入 ${label}（${count || keys.length} 项）`, { level: 'success' });
        } catch (err) {
            logger.error('[StaticPresetManagerCard] 载入本地预设失败:', err);
            Toast.show('载入本地预设失败，请稍后重试', { level: 'error' });
        } finally {
            busyRef.current = false;
            if (mountedRef.current) {
                setIsBusy(false);
            }
        }
    };

    const handleUnloadKeys = async (keys: readonly string[], label: string) => {
        if (!mountedRef.current || busyRef.current || keys.length === 0) return;
        busyRef.current = true;
        setIsBusy(true);
        try {
            const count = await settingsStore.unloadStaticPresetItems(keys);
            if (!mountedRef.current) return;
            await refreshCatalog(false);
            Toast.show(`已卸载 ${label}（${count} 项）`, { level: 'info' });
        } catch (err) {
            logger.error('[StaticPresetManagerCard] 卸载本地预设失败:', err);
            Toast.show('卸载本地预设失败，请稍后重试', { level: 'error' });
        } finally {
            busyRef.current = false;
            if (mountedRef.current) {
                setIsBusy(false);
            }
        }
    };

    const totalLoaded = catalog.reduce((sum, c) => sum + c.loadedCount, 0);
    const totalAll = catalog.reduce((sum, c) => sum + c.totalCount, 0);
    const hasUnloaded = catalog.some((c) => c.items.some((i) => !i.loaded));
    const hasLoaded = catalog.some((c) => c.items.some((i) => i.loaded));
    const disabled = isLoading || isBusy;

    let badgeText = '正在读取清单...';
    let badgeClass = 'da-sync-card__badge';
    if (hasError) {
        badgeText = '读取失败';
    } else if (catalog.length > 0 || !isLoading) {
        badgeText = `已载入 ${totalLoaded} / ${totalAll} 项`;
        badgeClass =
            totalLoaded === totalAll && totalAll > 0
                ? 'da-sync-card__badge da-sync-card__badge--ok'
                : 'da-sync-card__badge da-sync-card__badge--pending';
    }

    const rootClass = ['da-sync-card', 'da-static-preset-card', props.className || '']
        .filter(Boolean)
        .join(' ');

    return (
        <div className={rootClass}>
            <div className="da-sync-card__header">
                <div className="da-sync-card__title-wrap">
                    <div className="da-sync-card__title">{props.title || '内置预设管理'}</div>
                    <div className="da-sync-card__desc">
                        按分类载入或卸载内置预设；卸载仅移除对应条目，不影响你自建的预设。
                    </div>
                </div>
                <span className={badgeClass}>{badgeText}</span>
            </div>

            <div className="da-sync-card__actions da-static-preset-toolbar">
                <ButtonControl
                    label="全部载入"
                    variant="primary"
                    size="sm"
                    disabled={disabled || !hasUnloaded}
                    onClick={() => {
                        const keys = catalog.flatMap((c) =>
                            c.items.filter((i) => !i.loaded).map((i) => i.key)
                        );
                        void handleLoadKeys(keys, '全部本地预设');
                    }}
                />
                <ButtonControl
                    label="全部卸载"
                    variant="danger"
                    size="sm"
                    disabled={disabled || !hasLoaded}
                    onClick={() => {
                        const keys = catalog.flatMap((c) =>
                            c.items.filter((i) => i.loaded).map((i) => i.key)
                        );
                        void handleUnloadKeys(keys, '全部本地预设');
                    }}
                />
                <ButtonControl
                    label="刷新"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => void refreshCatalog(true)}
                />
            </div>

            <div className="da-static-preset-categories">
                {hasError ? (
                    <div className="da-sync-card__hint">
                        无法读取本地预设清单，请点击「刷新」重试。
                    </div>
                ) : (
                    catalog.map((cat) => {
                        const isExpanded = expandedCategories.has(cat.category);
                        const unloadedKeys = cat.items
                            .filter((i) => !i.loaded)
                            .map((i) => i.key);
                        const loadedKeys = cat.items
                            .filter((i) => i.loaded)
                            .map((i) => i.key);

                        return (
                            <div key={cat.category} className="da-static-preset-group">
                                <div
                                    className="da-static-preset-group__header"
                                    onClick={() => {
                                        setExpandedCategories((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(cat.category)) {
                                                next.delete(cat.category);
                                            } else {
                                                next.add(cat.category);
                                            }
                                            return next;
                                        });
                                    }}
                                >
                                    <div className="da-static-preset-group__left">
                                        <span
                                            className={`da-static-preset-chevron${isExpanded ? ' is-expanded' : ''}`}
                                            dangerouslySetInnerHTML={{ __html: ICONS.chevronRight }}
                                        />
                                        <span className="da-static-preset-group__title">
                                            {cat.label}
                                        </span>
                                        <span className="da-static-preset-group__count">
                                            {`${cat.loadedCount} / ${cat.totalCount}`}
                                        </span>
                                    </div>
                                    <div className="da-static-preset-group__actions">
                                        {unloadedKeys.length > 0 && (
                                            <button
                                                type="button"
                                                className="da-btn da-btn--primary da-btn--sm"
                                                disabled={disabled}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleLoadKeys(
                                                        unloadedKeys,
                                                        `「${cat.label}」`
                                                    );
                                                }}
                                            >
                                                载入本类
                                            </button>
                                        )}
                                        {loadedKeys.length > 0 && (
                                            <button
                                                type="button"
                                                className="da-btn da-btn--danger da-btn--sm"
                                                disabled={disabled}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleUnloadKeys(
                                                        loadedKeys,
                                                        `「${cat.label}」`
                                                    );
                                                }}
                                            >
                                                卸载本类
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="da-static-preset-list">
                                        {cat.items.map((item) => (
                                            <div
                                                key={item.key}
                                                className={`da-static-preset-row${item.loaded ? '' : ' is-unloaded'}`}
                                            >
                                                <div className="da-static-preset-row__info">
                                                    <div className="da-static-preset-row__title">
                                                        <span className="da-static-preset-row__bucket">
                                                            {item.bucketLabel}
                                                        </span>
                                                        <span className="da-static-preset-row__name">
                                                            {item.officialName}
                                                        </span>
                                                    </div>
                                                    {item.description && (
                                                        <div
                                                            className="da-static-preset-row__desc"
                                                            title={item.description}
                                                        >
                                                            {item.description}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="da-static-preset-row__action">
                                                    <button
                                                        type="button"
                                                        className={
                                                            item.loaded
                                                                ? 'da-btn da-btn--danger da-btn--sm'
                                                                : 'da-btn da-btn--primary da-btn--sm'
                                                        }
                                                        disabled={disabled}
                                                        onClick={() =>
                                                            item.loaded
                                                                ? void handleUnloadKeys(
                                                                      [item.key],
                                                                      `「${item.officialName}」`
                                                                  )
                                                                : void handleLoadKeys(
                                                                      [item.key],
                                                                      `「${item.officialName}」`
                                                                  )
                                                        }
                                                    >
                                                        {item.loaded ? '卸载' : '载入'}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
