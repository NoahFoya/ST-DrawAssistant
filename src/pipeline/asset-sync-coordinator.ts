/**
 * 服务端资产同步与预设状态协同服务 (AssetSyncCoordinator)。
 *
 * @remarks
 * 统一承载生图后端的模型资产同步、持久化缓存管理、增减差异分析与预设有效性校验：
 * 1. 启动初始化同步：插件启动 (initOnce) 时仅对当前激活服务 (activeProvider) 发起一次轻量连通性检查并拉取资产；
 * 2. 差异计算与浮动通知：拉取完成后对比本地前次缓存与当前预设模型，在有变动或失效时展示 3 秒浮动提示；
 * 3. 严格单次缓存原则：仅在启动/刷新、服务地址变更、手动拉取或切换激活服务时触发网络拉取，Tab 切换零请求。
 */

import type {
    ProviderType,
    ProviderAssetCache,
    DrawingPresetData,
    PromptPresetData,
    ProviderStoredConfig,
} from '@types';
import { providerRegistry } from '../provider/registry';
import { hasProviderAssetSync } from '../provider/base-provider';
import { settingsStore } from '../store/settings-store';
import { validatePresetAssets } from '../util/asset-matcher';
import { Toast } from '../ui/feedback/toast';
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
}

/** 资产同步运行配置项 */
export interface AssetSyncOptions {
    /** 是否为用户在 UI 中显式点击触发（手动触发时始终展示浮动提示，即使无变动） */
    readonly isManual?: boolean;
    /** 在无资产变动且预设完整时是否保持静默（启动初始化时设为 true） */
    readonly silentIfNoChange?: boolean;
    /** 是否跳过健康连通性检查（调用方已预检时可用） */
    readonly skipHealthCheck?: boolean;
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
    const oldModels = new Set([...(oldCache?.checkpoints || []), ...(oldCache?.unets || [])]);
    const newModels = new Set([...(newCache.checkpoints || []), ...(newCache.unets || [])]);
    const oldLoras = new Set(oldCache?.loras || []);
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
        const provider = providerRegistry.getProvider(providerType);
        if (!provider) {
            if (options.isManual) {
                Toast.error(`未注册 ${providerType} 服务提供方`, 3000);
            }
            return null;
        }

        if (!hasProviderAssetSync(provider)) {
            if (options.isManual) {
                Toast.show('当前服务使用预置模型目录，不支持同步服务端模型', {
                    level: 'info',
                    duration: 3000,
                });
            }
            return null;
        }

        // 1. 连通性前置检查：离线时直接退出或提示，避免发送无效拉取请求
        if (!options.skipHealthCheck && typeof provider.checkHealth === 'function') {
            try {
                const health = await provider.checkHealth();
                if (health.status !== 'ok') {
                    if (options.isManual) {
                        Toast.error(`获取模型列表失败: ${health.message || '服务未启动或连接失败'}`, 3000);
                    }
                    return null;
                }
            } catch (err: unknown) {
                if (options.isManual) {
                    const msg = err instanceof Error ? err.message : String(err || '网络异常');
                    Toast.error(`获取模型列表异常: ${msg}`, 3000);
                }
                return null;
            }
        }

        // 2. 若为显式手动触发，重置提供方短时缓存以强制向服务端拉取最新数据
        if (options.isManual && typeof provider.clearAssetCache === 'function') {
            provider.clearAssetCache();
        }

        try {
            // 3. 并发/依次拉取各类资产
            let checkpoints: string[] = [];
            let unets: string[] | undefined;
            let vaes: string[] = [];
            let clips: string[] = [];
            let samplers: string[] = [];
            let schedulers: string[] = [];
            let loras: string[] = [];

            // 3.1 主模型拉取
            if (typeof provider.fetchCategorizedModels === 'function') {
                const cat = await provider.fetchCategorizedModels();
                if (cat) {
                    checkpoints = cat.checkpoints || [];
                    unets = cat.unets || [];
                }
            } else if (typeof provider.fetchModels === 'function') {
                checkpoints = await provider.fetchModels();
            }

            // 3.2 VAE 拉取
            if (typeof provider.fetchVaes === 'function') {
                vaes = await provider.fetchVaes();
            }

            // 3.3 CLIP 拉取
            if (typeof provider.fetchClips === 'function') {
                clips = await provider.fetchClips();
            }

            // 3.4 采样器拉取
            if (typeof provider.fetchSamplers === 'function') {
                samplers = await provider.fetchSamplers();
            }

            // 3.5 调度器拉取
            if (typeof provider.fetchSchedulers === 'function') {
                schedulers = await provider.fetchSchedulers();
            }

            // 3.6 LoRA 模型拉取
            if (typeof provider.fetchLoras === 'function') {
                loras = await provider.fetchLoras();
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

            // 7. 比对当前激活绘图预设与提示词预设的可用性
            const activeDrawingId = prevCfg?.activeDrawingPresetId;
            const dp = activeDrawingId
                ? settingsStore.getPreset<DrawingPresetData>('drawing', activeDrawingId, providerType)
                : undefined;
            const promptPresetId = dp?.data?.promptPresetId;
            const pp = promptPresetId
                ? settingsStore.getPreset<PromptPresetData>('prompts', promptPresetId, providerType)
                : undefined;

            const validation = validatePresetAssets({
                drawingPreset: dp?.data,
                promptPreset: pp?.data,
                assetCache: updatedCache,
                providerType,
            });

            const result: AssetDiffResult = {
                hasChanges: diff.hasChanges,
                addedModels: diff.addedModels,
                removedModels: diff.removedModels,
                addedLoras: diff.addedLoras,
                removedLoras: diff.removedLoras,
                presetValid: validation.valid,
                missingAssets: validation.missing,
            };

            // 8. 格式化 3 秒轻量浮动提示通知
            const diffParts: string[] = [];
            if (diff.addedModels > 0) diffParts.push(`+${diff.addedModels} 模型`);
            if (diff.removedModels > 0) diffParts.push(`-${diff.removedModels} 模型`);
            if (diff.addedLoras > 0) diffParts.push(`+${diff.addedLoras} LoRA`);
            if (diff.removedLoras > 0) diffParts.push(`-${diff.removedLoras} LoRA`);
            const diffText = diffParts.length > 0 ? ` (${diffParts.join(', ')})` : '';

            if (!validation.valid) {
                const missingStr = validation.missing.join('、');
                Toast.show(`模型资产已同步${diffText}，警告: 当前预设缺少 ${missingStr}`, {
                    level: 'warning',
                    duration: 3000,
                });
            } else if (diff.hasChanges) {
                Toast.show(`模型资产已同步${diffText}，当前预设资产正常`, {
                    level: 'success',
                    duration: 3000,
                });
            } else if (options.isManual) {
                Toast.show('模型资产已是最新，当前预设资产正常', {
                    level: 'info',
                    duration: 3000,
                });
            } else if (!options.silentIfNoChange) {
                Toast.show('模型资产已同步，当前预设资产正常', {
                    level: 'info',
                    duration: 3000,
                });
            }

            logger.info(
                `[AssetSyncCoordinator] [${providerType}] 资产同步完成 (主模型: ${checkpoints.length}, LoRA: ${loras.length}), 预设有效性: ${validation.valid}`
            );

            return result;
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err || '拉取异常');
            logger.warn(`[AssetSyncCoordinator] [${providerType}] 资产同步异常:`, err);
            if (options.isManual) {
                Toast.error(`模型资产同步失败: ${errorMsg}`, 3000);
            }
            return null;
        }
    }
}
