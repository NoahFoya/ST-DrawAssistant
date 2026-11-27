/**
 * 插件配置中心与持久化存储服务 (SettingsStore)。
 *
 * @remarks
 * 负责插件配置与预设的管理与持久化：
 * 1. 集中管理插件设置、服务商配置、本地素材库与提示词四通道预设；
 * 2. 运行时加载大型预设：首次初始化或恢复默认设置时，从 `config/presets/` 异步读取静态 JSON 预设文件；
 * 3. 深拷贝快照保护：外部读取接口返回深拷贝快照，避免状态被外部直接修改；
 * 4. 宿主防抖持久化与凭据隔离：API Key 等敏感凭据隔离存放于本地 `localStorage`，同步给宿主的副本自动脱敏。
 */

import type {
    ProviderType,
    TransportMode,
    SDWebUIProviderConfig,
    ComfyUIProviderConfig,
    NovelAIProviderConfig,
    OpenAIProviderConfig,
    GeminiProviderConfig,
    GrokProviderConfig,
    PresetCategory,
    PresetItem,
    PresetSettings,
    MaterialLibraryConfig,
    MaterialItemActivationRule,
    ActivationTriggerMode,
    ThinkingDisplayMode,
    ImageDisplayMode,
    PromptInjectionConfig,
    ImageStorageQuality,
} from '@types';
import { registerDefaultProviderRuntime } from '../util/provider-runtime';
import type {
    ProviderServiceSwitchOverrides,
    ProviderServiceSwitchResult,
} from '../domain';
import { SettingsRepository, type SettingsSignals } from './settings-repository';
import { PresetRepository, resolveDrawingPresetFromPorts } from './preset-repository';
import { PresetLifecycle, ALL_OFFICIAL_SYNC_CATEGORIES } from './preset-lifecycle';
import type { LoadStaticPresetsOptions } from './static-preset-loader';
export type { SettingsSignals };
export { ALL_OFFICIAL_SYNC_CATEGORIES };

/** 官方预设更新同步分组 */
export type OfficialPresetSyncCategory =
    | 'prompts'
    | 'drawing'
    | 'workflows'
    | 'materialsAndThemes'
    | 'injectionAndRules';

/** 官方预设差异条目类型 */
export type OfficialPresetDiffKind = 'add' | 'update';

/** 官方预设同步执行模式 */
export type OfficialPresetSyncMode = 'add-only' | 'selected';

/** 单条官方预设差异明细 */
export interface OfficialPresetDiffItem {
    readonly key: string;
    readonly category: OfficialPresetSyncCategory;
    readonly bucketLabel: string;
    readonly kind: OfficialPresetDiffKind;
    readonly officialId: string;
    readonly officialName: string;
    readonly localId?: string;
    readonly localName?: string;
    readonly renamed: boolean;
    readonly description?: string;
}

/** 官方预设快速同步分组差异统计 */
export interface OfficialPresetCategoryDiff {
    readonly category: OfficialPresetSyncCategory;
    readonly label: string;
    readonly overwriteCount: number;
    readonly addCount: number;
    readonly customPreservedCount: number;
    readonly items: readonly OfficialPresetDiffItem[];
}

/** 官方预设预览或同步结果统计 */
export interface OfficialPresetSyncResult {
    readonly totalOverwriteCount: number;
    readonly totalAddCount: number;
    readonly totalCustomPreservedCount: number;
    readonly categories: OfficialPresetCategoryDiff[];
}

/** 官方预设同步参数选项 */
export interface SyncOfficialPresetsOptions {
    /** 需要同步的分组清单，未传时同步全部分组 */
    readonly categories?: readonly OfficialPresetSyncCategory[];
    /** 同步模式：'add-only' 仅补充新增项、不覆盖现有项；'selected' 按 selectedItemKeys（未传时默认全选）同步 */
    readonly mode?: OfficialPresetSyncMode;
    /** 显式勾选同步的差异条目 key 列表 */
    readonly selectedItemKeys?: readonly string[];
    /** 静态预设加载附加选项（如强制刷新或测试注入 fetcher） */
    readonly loaderOptions?: LoadStaticPresetsOptions;
}

/** 静态预设目录单条目（用于关于页按需载入/卸载管理） */
export interface StaticPresetCatalogItem {
    readonly key: string;
    readonly category: OfficialPresetSyncCategory;
    readonly bucketLabel: string;
    readonly officialId: string;
    readonly officialName: string;
    readonly description?: string;
    readonly loaded: boolean;
    readonly localId?: string;
}

/** 静态预设目录按分类汇总 */
export interface StaticPresetCatalogCategory {
    readonly category: OfficialPresetSyncCategory;
    readonly label: string;
    readonly loadedCount: number;
    readonly totalCount: number;
    readonly items: readonly StaticPresetCatalogItem[];
}

/** 配置导入结果结构 */
export interface SettingsImportResult {
    readonly success: boolean;
    readonly error?: string;
}

/** 局部恢复出厂设置细分控制选项 */
export interface ResetPartialOptions {
    readonly general?: boolean;
    readonly providers?: boolean;
    readonly ui?: boolean;
    readonly drawingPresets?: boolean;
    readonly promptPresets?: boolean;
    readonly workflowPresets?: boolean;
    readonly themePresets?: boolean;
    readonly characterPresets?: boolean;
    readonly outfitPresets?: boolean;
    readonly materialActivationPresets?: boolean;
    readonly materialExtractionPresets?: boolean;
    readonly materialFormatPresets?: boolean;
    readonly promptStoryPresets?: boolean;
    readonly promptCharacterPresets?: boolean;
    readonly promptVocabPresets?: boolean;
    readonly promptMaterialPresets?: boolean;
    readonly resetLocalLexicon?: boolean;
    /** 清空本地生成图库记录与 Blob 缓存（可选） */
    readonly resetLocalGallery?: boolean;
    readonly loaderOptions?: LoadStaticPresetsOptions;
}

/** 保存预设附加控制项 */
export interface SavePresetOptions {
    /**
     * 针对角色或服装预设：是否将其同步开启于当前激活的「启用预设」中。
     * 缺省行为：新建素材默认自动加入当前启用预设（`true`），修改既有素材保持原启用状态不变（`false`）。
     */
    readonly autoActivateMaterial?: boolean;
    /** 自动加入启用预设时的初始触发模式（默认 `'keyword'`） */
    readonly defaultTriggerMode?: ActivationTriggerMode;
}

/** 生图参数预设解析选项 */
export interface ResolveDrawingPresetOptions {
    /** 显式指定的生图参数预设 ID */
    explicitPresetId?: string;
    /** 隐式读取配置中的激活预设但未命中时是否抛出异常，默认 false（预处理阶段回退 undefined；实际后端执行传 true） */
    throwOnMissingActive?: boolean;
}

/** 插件核心配置结构定义 */
export interface DrawAssistantSettings {
    isInitialized: boolean;
    lastSeenChangelogVersion?: string;
    enabled: boolean;
    activeProvider: ProviderType;
    transport: TransportMode;
    taskTimeoutMs: number;
    cancelOnChatChange: boolean;
    cancelOnSwipe: boolean;
    saveToServer: boolean;
    imageQuality: ImageStorageQuality;
    autoGenerate: boolean;
    cleanPrompt: boolean;
    cleanPromptPunctuation: boolean;
    normalizeChinesePunctuation: boolean;
    thinkingDisplayMode: ThinkingDisplayMode;
    cleanHistoryThinking: boolean;
    cleanHistoryMarkup: boolean;
    promptStartTag: string;
    promptEndTag: string;
    activeThemePresetId: string;
    presets: PresetSettings;
    promptInjection: PromptInjectionConfig;
    materialConfig: MaterialLibraryConfig;
    providers: {
        comfyui: ComfyUIProviderConfig;
        sdwebui: SDWebUIProviderConfig;
        novelai: NovelAIProviderConfig;
        openai: OpenAIProviderConfig;
        gemini: GeminiProviderConfig;
        grok: GrokProviderConfig;
        [key: string]: unknown;
    };
    ui: {
        fab: {
            visible: boolean;
            opacity: number;
            icon: string;
            animationType?: 'starlight' | 'orbit-ring' | 'aurora-pulse' | 'ripple' | 'none';
            quickPanelEnabled?: boolean;
        };
        lightbox: {
            enabled: boolean;
            historyLimit?: number;
        };
        floorButton: {
            hideOnDone: boolean;
        };
        imageActionPanel: {
            enabled: boolean;
        };
        imageDisplay: {
            align: 'center' | 'flex-start' | 'flex-end' | string;
            objectFit: 'contain' | 'cover' | 'none' | string;
            maxHeight: number;
            maxWidthPct: number;
            rounded: boolean;
            displayMode: ImageDisplayMode;
        };
        seenGuides?: {
            plugin?: boolean;
            prompts?: boolean;
            providers?: Partial<Record<ProviderType, boolean>>;
        };
        dismissWeilinNotice?: boolean;
    };
}

/**
 * 插件配置状态中心门面类。
 * 内部职责拆分至 `SettingsRepository`、`PresetRepository` 与 `PresetLifecycle`，
 * 并保持对外公共 API 与持久化存储格式 100% 向后兼容。
 */
export class SettingsStore {
    /** 插件标识，与 manifest.json 一致 */
    public static readonly EXTENSION_NAME = SettingsRepository.EXTENSION_NAME;

    private readonly repository: SettingsRepository;
    private readonly presetRepo: PresetRepository;
    private readonly lifecycle: PresetLifecycle;

    /** 细粒度只读配置 Signal 切片集合 */
    public readonly signals: SettingsSignals;

    public constructor(initialData?: Partial<DrawAssistantSettings>) {
        this.repository = new SettingsRepository({
            initialData,
            onSaveToHost: (syncSecrets) => this.saveToHost(syncSecrets),
        });
        this.presetRepo = new PresetRepository(this.repository);
        this.lifecycle = new PresetLifecycle(this.repository, this.presetRepo);
        this.signals = this.repository.signals;
    }

    public initializeFromHost(loaderOptions?: LoadStaticPresetsOptions): Promise<void> {
        return this.lifecycle.initializeFromHost(loaderOptions);
    }

    public importOfficialPresets(loaderOptions?: LoadStaticPresetsOptions): Promise<void> {
        return this.lifecycle.importOfficialPresets(loaderOptions);
    }

    public getSettings(): Readonly<DrawAssistantSettings> {
        return this.repository.getSettings();
    }

    public get<K extends keyof DrawAssistantSettings>(key: K): DrawAssistantSettings[K] {
        return this.repository.get(key);
    }

    public set<K extends keyof DrawAssistantSettings>(
        key: K,
        value: DrawAssistantSettings[K]
    ): void {
        this.repository.set(key, value);
    }

    public update(patch: Partial<DrawAssistantSettings>): void {
        this.repository.update(patch);
    }

    public updateUi(patch: Partial<NonNullable<DrawAssistantSettings['ui']>>): void {
        this.repository.updateUi(patch);
    }

    public getProviderConfig<T = Record<string, unknown>>(type: ProviderType): T | undefined {
        return this.repository.getProviderConfig<T>(type);
    }

    public setProviderConfig<T = Record<string, unknown>>(
        type: ProviderType,
        patch: Partial<T>
    ): void {
        this.repository.setProviderConfig<T>(type, patch);
    }

    public switchProviderService(
        type: ProviderType,
        nextServiceId: string,
        overrides?: ProviderServiceSwitchOverrides
    ): ProviderServiceSwitchResult {
        return this.repository.switchProviderService(type, nextServiceId, overrides);
    }

    public getPresets<T = Record<string, unknown>>(
        category: PresetCategory,
        providerType?: string
    ): PresetItem<T>[] {
        return this.presetRepo.getPresets<T>(category, providerType);
    }

    public getPreset<T = Record<string, unknown>>(
        category: PresetCategory,
        id: string,
        providerType?: string
    ): PresetItem<T> | undefined {
        return this.presetRepo.getPreset<T>(category, id, providerType);
    }

    public resolveDrawingPreset<T = Record<string, unknown>>(
        provider: ProviderType,
        options: ResolveDrawingPresetOptions = {}
    ): { presetId?: string; preset?: T } {
        if (!this.presetRepo) {
            return resolveDrawingPresetFromPorts<T>(
                {
                    getProviderConfig: (p) =>
                        this.getProviderConfig<{ activeDrawingPresetId?: string }>(p),
                    getPreset: <U = Record<string, unknown>>(
                        category: PresetCategory,
                        id: string,
                        providerType?: string
                    ) =>
                        typeof this.getPreset === 'function'
                            ? this.getPreset<U>(category, id, providerType)
                            : this.getPresets<U>(category, providerType).find(
                                  (item) => item.id === id
                              ),
                },
                provider,
                options
            );
        }
        return this.presetRepo.resolveDrawingPreset<T>(provider, options);
    }

    public savePreset<T = Record<string, unknown>>(
        category: PresetCategory,
        item: PresetItem<T>,
        providerType?: string,
        options?: SavePresetOptions
    ): void {
        this.presetRepo.savePreset<T>(category, item, providerType, options);
    }

    public setMaterialActivationRule(
        kind: 'character' | 'outfit',
        materialPresetId: string,
        rule: MaterialItemActivationRule,
        activationPresetId?: string
    ): boolean {
        return this.presetRepo.setMaterialActivationRule(
            kind,
            materialPresetId,
            rule,
            activationPresetId
        );
    }

    public deletePreset(category: PresetCategory, id: string, providerType?: string): boolean {
        return this.presetRepo.deletePreset(category, id, providerType);
    }

    public saveToHost(syncSecrets = false): void {
        this.repository.persistToHost(syncSecrets);
    }

    /**
     * 导出配置为 JSON 字符串。
     * @param includeSecrets 是否包含 API Key 等私密字段，默认 false 执行脱敏
     */
    public exportSettings(includeSecrets = false): string {
        return this.lifecycle.exportSettings(includeSecrets);
    }

    public importSettings(jsonString: string): SettingsImportResult {
        return this.lifecycle.importSettings(jsonString);
    }

    public resetPartialToDefaults(options: ResetPartialOptions): Promise<void> {
        return this.lifecycle.resetPartialToDefaults(options);
    }

    public previewOfficialPresetSync(
        options?: SyncOfficialPresetsOptions
    ): Promise<OfficialPresetSyncResult> {
        return this.lifecycle.previewOfficialPresetSync(options);
    }

    public syncOfficialPresets(
        options?: SyncOfficialPresetsOptions
    ): Promise<OfficialPresetSyncResult> {
        return this.lifecycle.syncOfficialPresets(options);
    }

    public getStaticPresetCatalog(
        loaderOptions?: LoadStaticPresetsOptions
    ): Promise<StaticPresetCatalogCategory[]> {
        return this.lifecycle.getStaticPresetCatalog(loaderOptions);
    }

    public loadStaticPresetItems(
        itemKeys: readonly string[],
        loaderOptions?: LoadStaticPresetsOptions
    ): Promise<number> {
        return this.lifecycle.loadStaticPresetItems(itemKeys, loaderOptions);
    }

    public unloadStaticPresetItems(
        itemKeys: readonly string[],
        loaderOptions?: LoadStaticPresetsOptions
    ): Promise<number> {
        return this.lifecycle.unloadStaticPresetItems(itemKeys, loaderOptions);
    }

    /**
     * 恢复所有设置为默认值并重新异步装载默认静态推荐预设文件。
     */
    public async resetToDefaults(loaderOptions?: LoadStaticPresetsOptions): Promise<void> {
        return this.resetPartialToDefaults({
            general: true,
            providers: true,
            ui: true,
            drawingPresets: true,
            promptPresets: true,
            workflowPresets: true,
            themePresets: true,
            characterPresets: true,
            outfitPresets: true,
            materialActivationPresets: true,
            materialExtractionPresets: true,
            materialFormatPresets: true,
            promptStoryPresets: true,
            promptCharacterPresets: true,
            promptVocabPresets: true,
            promptMaterialPresets: true,
            resetLocalLexicon: false,
            loaderOptions,
        });
    }
}

/** 全局默认单例配置中心 */
export const settingsStore = new SettingsStore();

// 向 util 运行时入口注册默认提供方配置端口，避免 provider 层静态依赖 store 层
registerDefaultProviderRuntime(settingsStore);
