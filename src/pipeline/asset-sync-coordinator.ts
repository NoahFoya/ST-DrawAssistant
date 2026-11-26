/**
 * 服务端资产同步与预设状态协同服务 (AssetSyncCoordinator)。
 *
 * @remarks
 * 统一承载生图后端的模型资产同步、持久化缓存管理、增减差异分析与预设有效性校验：
 * 1. 启动初始化同步：插件启动 (initOnce) 时仅对当前激活服务 (activeProvider) 发起一次轻量连通性检查并拉取资产；
 * 2. 差异计算与浮动通知：拉取完成后对比本地前次缓存与当前预设模型，在有变动或失效时展示 3 秒浮动提示；
 * 3. 按需拉取缓存：仅在启动、手动刷新、服务地址变更或切换服务商时请求服务端，切换设置选项卡直接读取本地缓存。
 */

import type {
    ProviderType,
    ProviderAssetCache,
    DrawingPresetData,
    ProviderStoredConfig,
} from '@types';
import { resolveEffectivePromptPresetsForValidation } from './prompt-pipeline';
import { providerRegistry } from '../provider/registry';
import { hasProviderAssetSync } from '../provider/base-provider';
import { settingsStore } from '../store/settings-store';
import { validatePresetAssets } from '../util/asset-matcher';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';

/** 资产差异比对分析结果 */
export interface AssetDiffResult {
    /** 是否存在增减变动 */
    readonly hasChanges: boolean;
    /** 新增主模型数 */
    readonly addedModels: number;
    /** 减少主模型数 */
    readonly removedModels: number;
    /** 新增 LoRA 数 */
    readonly addedLoras: number;
    /** 减少 LoRA 数 */
    readonly removedLoras: number;
    /** 当前激活预设模型是否齐备 */
    readonly presetValid: boolean;
    /** 缺失的模型或资产描述列表 */
    readonly missingAssets: readonly string[];
    /** 本次同步拉取的模型资产总数 */
    readonly totalCount: number;
    /** 同步状态摘要文案 */
    readonly message: string;
}

/** 资产同步运行配置项 */
export interface AssetSyncOptions {
    /** 是否为用户在 UI 中显式点击触发（手动触发时始终展示浮动提示，即使无变动） */
    readonly isManual?: boolean;
    /** 在无资产变动且预设完整时是否保持静默（启动初始化时设为 true） */
    readonly silentIfNoChange?: boolean;
    /** 是否跳过健康连通性检查（调用方已预检时可用） */
    readonly skipHealthCheck?: boolean;
    /** 外部取消信号 */
    readonly signal?: AbortSignal;
    /** 是否抑制内部 Toast 弹出 */
    readonly suppressToast?: boolean;
    /** 在被中止、健康检查失败或请求异常时是否向上抛出错误（默认吞掉并返回 null） */
    readonly throwOnError?: boolean;
}

/**
 * 比对两份资产缓存快照，计算主模型与 LoRA 的增减变动。
 */
export function computeAssetDiff(
    oldCache: ProviderAssetCache | undefined,
    newCache: ProviderAssetCache
): {
    hasChanges: boolean;
    addedModels: number;
    removedModels: number;
    addedLoras: number;
    removedLoras: number;
} {
    if (!oldCache) {
        return {
            hasChanges: false,
            addedModels: 0,
            removedModels: 0,
            addedLoras: 0,
            removedLoras: 0,
        };
    }

    const oldModels = new Set([...(oldCache.checkpoints || []), ...(oldCache.unets || [])]);
    const newModels = new Set([...(newCache.checkpoints || []), ...(newCache.unets || [])]);
    const oldLoras = new Set(oldCache.loras || []);
    const newLoras = new Set(newCache.loras || []);

    let addedModels = 0;
    let removedModels = 0;
    for (const m of newModels) {
        if (!oldModels.has(m)) addedModels++;
    }
    for (const m of oldModels) {
        if (!newModels.has(m)) removedModels++;
    }

    let addedLoras = 0;
    let removedLoras = 0;
    for (const l of newLoras) {
        if (!oldLoras.has(l)) addedLoras++;
    }
    for (const l of oldLoras) {
        if (!newLoras.has(l)) removedLoras++;
    }

    const hasChanges = addedModels > 0 || removedModels > 0 || addedLoras > 0 || removedLoras > 0;
    return { hasChanges, addedModels, removedModels, addedLoras, removedLoras };
}

/**
 * 资产同步协同器。
 */
export class AssetSyncCoordinator {
    private static _syncGenByProvider = new Map<ProviderType, number>();

    /**
     * 对指定生图服务提供方执行资产同步、持久化并计算差异与预设可用性。
     *
     * @param providerType 目标生图服务类型
     * @param options 运行配置项
     * @returns 资产差异结果对象，跳过或失败时返回 null
     */
    public static async syncProviderAssets(
        providerType: ProviderType,
        options: AssetSyncOptions = {}
    ): Promise<AssetDiffResult | null> {
        const signal = options.signal;
        if (signal?.aborted) {
            if (options.throwOnError) {
                throw new DOMException('Aborted', 'AbortError');
            }
            return null;
        }

        const reqGen = (AssetSyncCoordinator._syncGenByProvider.get(providerType) ?? 0) + 1;
        AssetSyncCoordinator._syncGenByProvider.set(providerType, reqGen);

        const provider = providerRegistry.getProvider(providerType);
        if (!provider) {
            const errMsg = `未注册 ${providerType} 服务提供方`;
            if (options.throwOnError) {
                throw new Error(errMsg);
            }
            logger.error(`[AssetSyncCoordinator] ${errMsg}`);
            if (options.isManual && !options.suppressToast) {
                eventBus.emit('toast:show', {
                    type: 'error',
                    message: '获取模型列表失败，请前往「日志与统计」查看详情',
                    duration: 3000,
                });
            }
            return null;
        }

        if (!hasProviderAssetSync(provider)) {
            if (options.isManual && !options.suppressToast) {
                eventBus.emit('toast:show', {
                    type: 'info',
                    message: '当前服务使用预置模型目录，不支持同步服务端模型',
                    duration: 3000,
                });
            }
            return null;
        }

        const startCfg = settingsStore.getProviderConfig<ProviderStoredConfig>(providerType);
        const startServiceId = startCfg?.serviceId;
        const startServerUrl = startCfg?.serverUrl;
        const startTransport = settingsStore.getSettings().transport;
        const isStaleSync = (): boolean => {
            if (AssetSyncCoordinator._syncGenByProvider.get(providerType) !== reqGen) {
                return true;
            }
            const curCfg = settingsStore.getProviderConfig<ProviderStoredConfig>(providerType);
            return (
                curCfg?.serviceId !== startServiceId ||
                curCfg?.serverUrl !== startServerUrl ||
                settingsStore.getSettings().transport !== startTransport
            );
        };
        const checkAbortedOrStale = (): boolean => {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            if (isStaleSync()) {
                logger.debug(`[AssetSyncCoordinator] [${providerType}] 上下文已变更或被新请求取代，丢弃过期同步结果`);
                return true;
            }
            return false;
        };

        // 1. 连通性前置检查：离线时直接退出或提示，避免发送无效拉取请求
        if (!options.skipHealthCheck && typeof provider.checkHealth === 'function') {
            try {
                const health = await provider.checkHealth(signal);
                if (checkAbortedOrStale()) {
                    return null;
                }
                if (health.status !== 'ok') {
                    const errMsg = health.message || '服务未启动或连接失败';
                    if (options.throwOnError) {
                        throw new Error(errMsg);
                    }
                    logger.error(`[AssetSyncCoordinator] [${providerType}] 健康检测失败: ${errMsg}`);
                    if (options.isManual && !options.suppressToast) {
                        eventBus.emit('toast:show', {
                            type: 'error',
                            message: '获取模型列表失败，请前往「日志与统计」查看详情',
                            duration: 3000,
                        });
                    }
                    return null;
                }
            } catch (err: unknown) {
                const isAbort =
                    signal?.aborted || (err instanceof DOMException && err.name === 'AbortError');
                if (options.throwOnError) {
                    throw err;
                }
                if (!isAbort) {
                    logger.error(`[AssetSyncCoordinator] [${providerType}] 健康检测异常:`, err);
                    if (options.isManual && !options.suppressToast) {
                        eventBus.emit('toast:show', {
                            type: 'error',
                            message: '获取模型列表失败，请前往「日志与统计」查看详情',
                            duration: 3000,
                        });
                    }
                }
                return null;
            }
        }

        // 2. 若为显式手动触发，重置提供方短时缓存以强制向服务端拉取最新数据
        if (options.isManual && typeof provider.clearAssetCache === 'function') {
            provider.clearAssetCache();
        }

        try {
            // 3. 依次拉取各类资产
            let checkpoints: string[] = [];
            let unets: string[] | undefined;
            let vaes: string[] = [];
            let clips: string[] = [];
            let samplers: string[] = [];
            let schedulers: string[] = [];
            let loras: string[] = [];

            // 3.1 主模型拉取
            if (typeof provider.fetchCategorizedModels === 'function') {
                const cat = await provider.fetchCategorizedModels(signal);
                if (cat) {
                    checkpoints = cat.checkpoints || [];
                    unets = cat.unets || [];
                }
            } else if (typeof provider.fetchModels === 'function') {
                checkpoints = await provider.fetchModels(signal);
            }
            if (checkAbortedOrStale()) return null;

            // 3.2 VAE 拉取
            if (typeof provider.fetchVaes === 'function') {
                vaes = await provider.fetchVaes(signal);
                if (checkAbortedOrStale()) return null;
            }

            // 3.3 CLIP 拉取
            if (typeof provider.fetchClips === 'function') {
                clips = await provider.fetchClips(signal);
                if (checkAbortedOrStale()) return null;
            }

            // 3.4 采样器拉取
            if (typeof provider.fetchSamplers === 'function') {
                samplers = await provider.fetchSamplers(signal);
                if (checkAbortedOrStale()) return null;
            }

            // 3.5 调度器拉取
            if (typeof provider.fetchSchedulers === 'function') {
                schedulers = await provider.fetchSchedulers(signal);
                if (checkAbortedOrStale()) return null;
            }

            // 3.6 LoRA 模型拉取
            if (typeof provider.fetchLoras === 'function') {
                loras = await provider.fetchLoras(signal);
                if (checkAbortedOrStale()) return null;
            }

            // 4. 读取上一次持久化缓存以比对差异
            const prevCfg = settingsStore.getProviderConfig<ProviderStoredConfig>(providerType);
            const prevCache = prevCfg?.assetCache;

            // 5. 组装新缓存并持久化写入 SettingsStore
            const updatedCache: ProviderAssetCache = {
                checkpoints,
                unets,
                vaes,
                clips,
                loras,
                samplers,
                schedulers,
                updatedAt: Date.now(),
            };
            settingsStore.setProviderConfig(providerType, { assetCache: updatedCache });

            // 6. 计算资产增减差异
            const diff = computeAssetDiff(prevCache, updatedCache);

            // 7. 比对当前激活生图参数预设与提示词预设（含轮询候选池）的可用性
            const activeDrawingId = prevCfg?.activeDrawingPresetId;
            const dp = activeDrawingId
                ? settingsStore.getPreset<DrawingPresetData>('drawing', activeDrawingId, providerType)
                : undefined;
            const promptPresetsForCheck = resolveEffectivePromptPresetsForValidation(
                settingsStore,
                providerType,
                dp?.data
            );

            const validation = validatePresetAssets({
                drawingPreset: dp?.data,
                promptPresets: promptPresetsForCheck,
                assetCache: updatedCache,
                providerType,
            });

            const totalCount =
                checkpoints.length +
                (unets?.length ?? 0) +
                vaes.length +
                clips.length +
                samplers.length +
                schedulers.length +
                loras.length;
            const message =
                totalCount > 0
                    ? `已成功同步 ${totalCount} 项服务端模型`
                    : '未发现可用模型或服务端不支持查询';

            const result: AssetDiffResult = {
                hasChanges: diff.hasChanges,
                addedModels: diff.addedModels,
                removedModels: diff.removedModels,
                addedLoras: diff.addedLoras,
                removedLoras: diff.removedLoras,
                presetValid: validation.valid,
                missingAssets: validation.missing,
                totalCount,
                message,
            };

            // 8. 格式化 3 秒轻量浮动提示通知
            if (!options.suppressToast) {
                const diffParts: string[] = [];
                if (diff.addedModels > 0) diffParts.push(`+${diff.addedModels} 模型`);
                if (diff.removedModels > 0) diffParts.push(`-${diff.removedModels} 模型`);
                if (diff.addedLoras > 0) diffParts.push(`+${diff.addedLoras} LoRA`);
                if (diff.removedLoras > 0) diffParts.push(`-${diff.removedLoras} LoRA`);
                const diffText = diffParts.length > 0 ? ` (${diffParts.join(', ')})` : '';

                if (!validation.valid) {
                    const missingStr = validation.missing.join('、');
                    eventBus.emit('toast:show', {
                        type: 'warn',
                        message: `模型资产已同步${diffText}，警告: 当前预设缺少 ${missingStr}`,
                        duration: 3000,
                    });
                } else if (diff.hasChanges) {
                    eventBus.emit('toast:show', {
                        type: 'success',
                        message: `模型资产已同步${diffText}，当前预设资产正常`,
                        duration: 3000,
                    });
                } else if (options.isManual) {
                    eventBus.emit('toast:show', {
                        type: 'info',
                        message: '模型资产已是最新，当前预设资产正常',
                        duration: 3000,
                    });
                } else if (!options.silentIfNoChange) {
                    eventBus.emit('toast:show', {
                        type: 'info',
                        message: '模型资产已同步，当前预设资产正常',
                        duration: 3000,
                    });
                }
            }

            logger.info(
                `[AssetSyncCoordinator] [${providerType}] 资产同步完成 (主模型: ${checkpoints.length}, LoRA: ${loras.length}), 预设有效性: ${validation.valid}`
            );

            return result;
        } catch (err: unknown) {
            const isAbort =
                signal?.aborted || (err instanceof DOMException && err.name === 'AbortError');
            if (options.throwOnError) {
                throw err;
            }
            if (!isAbort) {
                logger.warn(`[AssetSyncCoordinator] [${providerType}] 资产同步异常:`, err);
                if (options.isManual && !options.suppressToast) {
                    eventBus.emit('toast:show', {
                        type: 'error',
                        message: '模型资产同步失败，请前往「日志与统计」查看详情',
                        duration: 3000,
                    });
                }
            }
            return null;
        }
    }
}
