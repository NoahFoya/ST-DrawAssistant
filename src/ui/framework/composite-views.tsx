/**
 * 业务复合组件的声明式 Preact 包装层 (Composite Views)。
 *
 * @remarks
 * 将现有的高内聚复合组件（ConnectionCard、PresetToolbar、DimensionPicker、SamplerCard、
 * PromptPresetManager、WorkflowCard、StorageBar、StatCard、MediaCard、LogTerminal）
 * 封装为受控的 Preact JSX 组件。
 * 采用同步引用挂载与卸载自动调用 dispose() 的桥接策略，使视图层无需手动维护 disposables 列表，
 * 同时保证单元测试中同步派发 DOM 事件时立即完成状态同步。
 */

import { useRef, useCallback } from 'preact/hooks';
import type { VNode } from 'preact';
import type { UIComponent, Disposable } from '../types';
import {
    ConnectionCard,
    type ConnectionCardOptions,
    type ConnectionCardData,
    PresetToolbar,
    type PresetToolbarItem,
    type PresetActionType,
    DimensionPicker,
    type DimensionPickerOptions,
    type DimensionPickerData,
    SamplerCard,
    type SamplerCardOptions,
    type SamplerCardData,
    PromptPresetManager,
    type PromptPresetManagerOptions,
    type PromptCardPresetItem,
    WorkflowCard,
    type WorkflowCardOptions,
    type WorkflowCardPresetItem,
    StorageBar,
    type StorageBarOptions,
    type StorageSummaryData,
    StatCard,
    type StatCardOptions,
    type GenerationStatsData,
    MediaCard,
    type MediaCardOptions,
    type MediaCardItemData,
    LogTerminal,
    type LogTerminalOptions,
} from '../composite';
import { logger } from '../../util/logger';

/**
 * 通用复合组件同步挂载与生命周期托管 Hook。
 */
export function useCompositeInstance<T extends UIComponent & Disposable>(
    factory: () => T,
    sync?: (instance: T) => void
): VNode {
    const instanceRef = useRef<T | null>(null);
    const factoryRef = useRef(factory);
    factoryRef.current = factory;

    if (!instanceRef.current) {
        instanceRef.current = factoryRef.current();
    }

    sync?.(instanceRef.current);

    const setHostRef = useCallback((hostEl: HTMLDivElement | null) => {
        if (hostEl) {
            if (!instanceRef.current) {
                instanceRef.current = factoryRef.current();
            }
            const inst = instanceRef.current;
            if (inst && inst.element.parentNode !== hostEl) {
                hostEl.appendChild(inst.element);
            }
        } else {
            const inst = instanceRef.current;
            if (inst) {
                instanceRef.current = null;
                try {
                    inst.dispose();
                } catch {
                    // 忽略卸载释放异常
                }
            }
        }
    }, []);

    return <div style={{ display: 'contents' }} ref={setHostRef} />;
}

// 1. 服务连接与状态探测卡片 (ConnectionCardView)

export interface ConnectionCardViewProps extends Omit<ConnectionCardOptions, 'initialData'> {
    data: ConnectionCardData;
}

export function ConnectionCardView(props: ConnectionCardViewProps): VNode {
    const callbacksRef = useRef(props);
    callbacksRef.current = props;
    const prevDataJsonRef = useRef<string>(JSON.stringify(props.data));

    return useCompositeInstance(
        () =>
            new ConnectionCard({
                ...props,
                initialData: props.data,
                onChange: (nextData) => {
                    prevDataJsonRef.current = JSON.stringify(nextData);
                    callbacksRef.current.onChange?.(nextData);
                },
                onTestPing: (url, key) => {
                    if (!callbacksRef.current.onTestPing) {
                        throw new Error('未配置连通性探测回调');
                    }
                    return callbacksRef.current.onTestPing(url, key);
                },
                onFetchAssets: props.onFetchAssets
                    ? (url, key) => callbacksRef.current.onFetchAssets!(url, key)
                    : undefined,
            }),
        (instance) => {
            const nextJson = JSON.stringify(props.data);
            if (nextJson !== prevDataJsonRef.current) {
                prevDataJsonRef.current = nextJson;
                instance.setData(props.data);
            }
        }
    );
}

// 2. 预设方案主控工具栏 (PresetToolbarView)

export interface PresetToolbarViewProps {
    presets: PresetToolbarItem[];
    activePresetId: string;
    dirty?: boolean;
    onAction: (action: PresetActionType, presetId: string) => void;
    onImportFile?: (file: File) => void;
    confirmHandler?: (message: string) => Promise<boolean> | boolean;
    className?: string;
}

export function PresetToolbarView(props: PresetToolbarViewProps): VNode {
    const callbacksRef = useRef(props);
    callbacksRef.current = props;
    const prevKeyRef = useRef<string>(
        JSON.stringify({ presets: props.presets, activeId: props.activePresetId })
    );

    return useCompositeInstance(
        () =>
            new PresetToolbar({
                presets: props.presets,
                activePresetId: props.activePresetId,
                confirmHandler: props.confirmHandler,
                className: props.className,
                onAction: (action, presetId) => callbacksRef.current.onAction(action, presetId),
                onImportFile: (file) => callbacksRef.current.onImportFile?.(file),
            }),
        (instance) => {
            const nextKey = JSON.stringify({
                presets: props.presets,
                activeId: props.activePresetId,
            });
            if (nextKey !== prevKeyRef.current) {
                prevKeyRef.current = nextKey;
                instance.setPresets(props.presets, props.activePresetId);
            }
            const nextDirty = Boolean(props.dirty);
            if (instance.isDirty() !== nextDirty) {
                instance.setDirty(nextDirty);
            }
        }
    );
}

// 3. 画幅尺寸选择器 (DimensionPickerView)

export interface DimensionPickerViewProps extends Omit<DimensionPickerOptions, 'initialData'> {
    width: number;
    height: number;
    dirty?: boolean;
    embedded?: boolean;
}

export function DimensionPickerView(props: DimensionPickerViewProps): VNode {
    const callbacksRef = useRef(props);
    callbacksRef.current = props;

    return useCompositeInstance(
        () =>
            new DimensionPicker({
                ...props,
                initialData: { width: props.width, height: props.height },
                onChange: (dims: DimensionPickerData) => {
                    callbacksRef.current.onChange?.(dims);
                },
            }),
        (instance) => {
            const cur = instance.getData();
            if (cur.width !== props.width || cur.height !== props.height) {
                instance.setData({ width: props.width, height: props.height }, { silent: true });
            }
            instance.element.classList.toggle('is-dirty', Boolean(props.dirty));
        }
    );
}

// 4. 采样控制复合卡片 (SamplerCardView)

export interface SamplerCardViewProps
    extends Omit<SamplerCardOptions, 'initialData' | 'initialSamplers' | 'initialSchedulers'> {
    data: SamplerCardData;
    samplers?: Array<{ value: string; label: string }>;
    schedulers?: Array<{ value: string; label: string }>;
    dirty?: boolean;
}

export function SamplerCardView(props: SamplerCardViewProps): VNode {
    const callbacksRef = useRef(props);
    callbacksRef.current = props;
    const prevSamplersJsonRef = useRef<string>(JSON.stringify(props.samplers ?? []));
    const prevSchedulersJsonRef = useRef<string>(JSON.stringify(props.schedulers ?? []));

    return useCompositeInstance(
        () =>
            new SamplerCard({
                ...props,
                initialData: props.data,
                initialSamplers: props.samplers,
                initialSchedulers: props.schedulers,
                onChange: (nextData) => {
                    callbacksRef.current.onChange?.(nextData);
                },
            }),
        (instance) => {
            if (props.samplers && props.samplers.length > 0) {
                const nextSJson = JSON.stringify(props.samplers);
                if (nextSJson !== prevSamplersJsonRef.current) {
                    prevSamplersJsonRef.current = nextSJson;
                    instance.setSamplers(props.samplers);
                }
            }
            if (props.schedulers && props.schedulers.length > 0) {
                const nextSchJson = JSON.stringify(props.schedulers);
                if (nextSchJson !== prevSchedulersJsonRef.current) {
                    prevSchedulersJsonRef.current = nextSchJson;
                    instance.setSchedulers(props.schedulers);
                }
            }

            const cur = instance.getData();
            const next = props.data;
            if (
                cur.samplerName !== next.samplerName ||
                cur.scheduler !== next.scheduler ||
                cur.steps !== next.steps ||
                cur.cfgScale !== next.cfgScale ||
                cur.seed !== next.seed ||
                cur.denoise !== next.denoise
            ) {
                instance.setData(next, { silent: true });
            }
            instance.element.classList.toggle('is-dirty', Boolean(props.dirty));
        }
    );
}

// 5. 提示词预设管理器卡片 (PromptPresetManagerView)

export interface PromptPresetManagerViewProps extends PromptPresetManagerOptions {
    defaultCollapsed?: boolean;
}

export function PromptPresetManagerView(props: PromptPresetManagerViewProps): VNode {
    const callbacksRef = useRef(props);
    callbacksRef.current = props;
    const prevPresetsJsonRef = useRef<string>(
        JSON.stringify({ presets: props.presets, activeId: props.activePresetId })
    );

    return useCompositeInstance(
        () => {
            const inst = new PromptPresetManager({
                ...props,
                onAction: (action, presetId, data) => {
                    callbacksRef.current.onAction?.(action, presetId, data);
                },
                onChange: (data) => {
                    callbacksRef.current.onChange?.(data);
                },
            });
            if (props.defaultCollapsed) {
                inst.card.setCollapsed(true);
            }
            return inst;
        },
        (instance) => {
            const nextJson = JSON.stringify({
                presets: props.presets,
                activeId: props.activePresetId,
            });
            if (nextJson !== prevPresetsJsonRef.current) {
                prevPresetsJsonRef.current = nextJson;
                instance.setPresets(props.presets as PromptCardPresetItem[], props.activePresetId);
            }
        }
    );
}

// 6. ComfyUI 工作流预设管理卡片 (WorkflowCardView)

export interface WorkflowCardViewProps extends WorkflowCardOptions {
    defaultCollapsed?: boolean;
}

export function WorkflowCardView(props: WorkflowCardViewProps): VNode {
    const callbacksRef = useRef(props);
    callbacksRef.current = props;
    const prevPresetsJsonRef = useRef<string>(
        JSON.stringify({ presets: props.presets, activeId: props.activePresetId })
    );

    return useCompositeInstance(
        () => {
            const inst = new WorkflowCard({
                ...props,
                onAction: (action, presetId, data) => {
                    callbacksRef.current.onAction?.(action, presetId, data);
                },
                onChange: (data) => {
                    callbacksRef.current.onChange?.(data);
                },
            });
            if (props.defaultCollapsed) {
                inst.card.setCollapsed(true);
            }
            return inst;
        },
        (instance) => {
            const nextJson = JSON.stringify({
                presets: props.presets,
                activeId: props.activePresetId,
            });
            if (nextJson !== prevPresetsJsonRef.current) {
                prevPresetsJsonRef.current = nextJson;
                instance.setPresets(
                    props.presets as WorkflowCardPresetItem[],
                    props.activePresetId
                );
            }
        }
    );
}

// 7. 存储水位监控与分级清理卡片 (StorageBarView)

export interface StorageBarViewProps extends Omit<StorageBarOptions, 'initialData'> {
    data: StorageSummaryData;
}

export function StorageBarView(props: StorageBarViewProps): VNode {
    const callbacksRef = useRef(props);
    callbacksRef.current = props;
    const prevDataJsonRef = useRef<string>(JSON.stringify(props.data));

    return useCompositeInstance(
        () =>
            new StorageBar({
                ...props,
                initialData: props.data,
                onRefresh: () => callbacksRef.current.onRefresh?.(),
                onCleanFailed: () => callbacksRef.current.onCleanFailed?.(),
                onCleanUnfavorited: () => callbacksRef.current.onCleanUnfavorited?.(),
                onClearAll: () => callbacksRef.current.onClearAll?.(),
            }),
        (instance) => {
            const nextJson = JSON.stringify(props.data);
            if (nextJson !== prevDataJsonRef.current) {
                prevDataJsonRef.current = nextJson;
                instance.update(props.data);
            }
        }
    );
}

// 8. 运行效能统计看板卡片 (StatCardView)

export interface StatCardViewProps extends Omit<StatCardOptions, 'initialData'> {
    data: GenerationStatsData;
    loading?: boolean;
}

export function StatCardView(props: StatCardViewProps): VNode {
    const callbacksRef = useRef(props);
    callbacksRef.current = props;
    const prevDataJsonRef = useRef<string>(JSON.stringify(props.data));

    return useCompositeInstance(
        () =>
            new StatCard({
                ...props,
                initialData: props.data,
                onRefresh: () => callbacksRef.current.onRefresh?.(),
                onReset: () => callbacksRef.current.onReset?.(),
            }),
        (instance) => {
            instance.setLoading(Boolean(props.loading));
            const nextJson = JSON.stringify(props.data);
            if (nextJson !== prevDataJsonRef.current) {
                prevDataJsonRef.current = nextJson;
                instance.updateStats(props.data);
            }
        }
    );
}

// 9. 画廊单张媒体卡片 (MediaCardView)

export interface MediaCardViewProps extends MediaCardOptions {
    key?: string;
}

export function MediaCardView(props: MediaCardViewProps): VNode {
    const callbacksRef = useRef(props);
    callbacksRef.current = props;
    const prevItemRef = useRef<MediaCardItemData>(props.item);

    return useCompositeInstance(
        () =>
            new MediaCard({
                ...props,
                onSelect: (selected, item) => callbacksRef.current.onSelect?.(selected, item),
                onPreview: (item) => callbacksRef.current.onPreview?.(item),
                onToggleFavorite: (fav, item) =>
                    callbacksRef.current.onToggleFavorite?.(fav, item),
                onRetry: (item) => callbacksRef.current.onRetry?.(item),
                onDelete: (item) => callbacksRef.current.onDelete?.(item),
            }),
        (instance) => {
            const prev = prevItemRef.current;
            const next = props.item;
            if (
                prev.status !== next.status ||
                prev.url !== next.url ||
                prev.isFavorite !== next.isFavorite ||
                prev.durationSec !== next.durationSec ||
                prev.errorMessage !== next.errorMessage
            ) {
                prevItemRef.current = next;
                instance.update(next);
            }
            instance.setSelectable(Boolean(props.selectable));
            if (instance.isSelected() !== Boolean(props.selected)) {
                instance.setSelected(Boolean(props.selected));
            }
        }
    );
}

// 10. 实时排障日志终端 (LogTerminalView)

export interface LogTerminalViewProps extends LogTerminalOptions {
    /** 是否自动预载并订阅全局 logger，默认 true */
    autoSubscribeGlobalLogger?: boolean;
}

export function LogTerminalView(props: LogTerminalViewProps): VNode {
    return useCompositeInstance(() => {
        const terminal = new LogTerminal(props);
        if (props.autoSubscribeGlobalLogger !== false) {
            const recentLogs = logger.getRecentLogs(200);
            for (const entry of recentLogs) {
                terminal.append({
                    timestamp: entry.timestamp,
                    level: entry.level,
                    message: entry.message,
                    details: entry.details,
                });
            }
            terminal.subscribeLogger(logger);
        }
        return terminal;
    });
}
