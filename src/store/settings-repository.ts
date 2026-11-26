/**
 * 核心配置状态仓库 (SettingsRepository) 与细粒度只读响应式 Signal Slice。
 *
 * @remarks
 * 负责扩展核心运行配置的读取、合并更新、细粒度 Preact Signal 分发、
 * 宿主持久化同步以及敏感凭据脱敏隔离，取代原有全量 `structuredClone` 桥接器。
 */

import { batch, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type {
    MaterialLibraryConfig,
    PresetSettings,
    PromptInjectionConfig,
    ProviderType,
    TransportMode,
} from '@types';
import defaultSettingsData from '../../config/default-settings.json';
import { getHostContext } from '../host';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';
import { createEmptyPresetSettings } from './static-preset-loader';
import {
    persistProviderSecretsToStorage,
    restoreProviderSecretsFromStorage,
    SECRET_FIELD_PATTERN,
    stripSecretsDeep,
} from './secret-vault';
import type { DrawAssistantSettings } from './settings-store';

export const FORBIDDEN_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(item: unknown): item is Record<string, unknown> {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
    }
    const proto = Object.getPrototypeOf(item);
    return proto === null || proto === Object.prototype;
}

/** 递归深度合并两个纯对象，跳过危险原型属性并隔离外部对象引用 */
export function deepMerge<T extends object>(target: T, source?: unknown): T {
    if (!isPlainObject(source)) {
        return target;
    }

    const result = { ...target } as Record<string, unknown>;

    for (const key of Object.keys(source)) {
        if (FORBIDDEN_MERGE_KEYS.has(key)) {
            continue;
        }
        const sourceVal = source[key];
        const targetVal = result[key];

        if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
            result[key] = deepMerge(targetVal, sourceVal);
        } else if (sourceVal !== undefined) {
            result[key] =
                isPlainObject(sourceVal) || Array.isArray(sourceVal)
                    ? structuredClone(sourceVal)
                    : sourceVal;
        }
    }

    return result as T;
}

/** 构建轻量初始配置骨架（不含任何内嵌预设数据） */
export function buildDefaultSettings(): DrawAssistantSettings {
    const base = structuredClone(defaultSettingsData) as unknown as DrawAssistantSettings;
    return {
        ...base,
        isInitialized: false,
        presets: createEmptyPresetSettings(),
    };
}

/**
 * 细粒度只读配置信号切片集合。
 * UI 层直接订阅对应切片，避免整体快照 `structuredClone` 与无关组件重渲染。
 */
export interface SettingsSignals {
    readonly settings: ReadonlySignal<DrawAssistantSettings>;
    readonly enabled: ReadonlySignal<boolean>;
    readonly activeProvider: ReadonlySignal<ProviderType>;
    readonly transport: ReadonlySignal<TransportMode>;
    readonly taskTimeoutMs: ReadonlySignal<number>;
    readonly activeThemePresetId: ReadonlySignal<string>;
    readonly ui: ReadonlySignal<DrawAssistantSettings['ui']>;
    readonly providers: ReadonlySignal<DrawAssistantSettings['providers']>;
    readonly presets: ReadonlySignal<PresetSettings>;
    readonly promptInjection: ReadonlySignal<PromptInjectionConfig>;
    readonly materialConfig: ReadonlySignal<MaterialLibraryConfig>;
}

export interface SettingsRepositoryOptions {
    readonly initialData?: Partial<DrawAssistantSettings>;
    readonly onSaveToHost?: (syncSecrets: boolean) => void;
}

export class SettingsRepository {
    public static readonly EXTENSION_NAME = 'ST-DrawAssistant';

    private _settings: DrawAssistantSettings;
    private _hasInitializedFromHost = false;
    private readonly onSaveToHost?: (syncSecrets: boolean) => void;

    private readonly _settingsSig: Signal<DrawAssistantSettings>;
    private readonly _enabledSig: Signal<boolean>;
    private readonly _activeProviderSig: Signal<ProviderType>;
    private readonly _transportSig: Signal<TransportMode>;
    private readonly _taskTimeoutMsSig: Signal<number>;
    private readonly _activeThemePresetIdSig: Signal<string>;
    private readonly _uiSig: Signal<DrawAssistantSettings['ui']>;
    private readonly _providersSig: Signal<DrawAssistantSettings['providers']>;
    private readonly _presetsSig: Signal<PresetSettings>;
    private readonly _promptInjectionSig: Signal<PromptInjectionConfig>;
    private readonly _materialConfigSig: Signal<MaterialLibraryConfig>;

    public readonly signals: SettingsSignals;

    public constructor(options?: Partial<DrawAssistantSettings> | SettingsRepositoryOptions) {
        const isOptions =
            options &&
            typeof options === 'object' &&
            ('initialData' in options || 'onSaveToHost' in options);
        const initialData = isOptions
            ? (options as SettingsRepositoryOptions).initialData
            : (options as Partial<DrawAssistantSettings> | undefined);
        this.onSaveToHost = isOptions
            ? (options as SettingsRepositoryOptions).onSaveToHost
            : undefined;
        const baseDefaults = buildDefaultSettings();
        this._settings = deepMerge(baseDefaults, initialData);

        this._settingsSig = signal(this._settings);
        this._enabledSig = signal(this._settings.enabled);
        this._activeProviderSig = signal(this._settings.activeProvider);
        this._transportSig = signal(this._settings.transport);
        this._taskTimeoutMsSig = signal(this._settings.taskTimeoutMs);
        this._activeThemePresetIdSig = signal(this._settings.activeThemePresetId);
        this._uiSig = signal(this._settings.ui);
        this._providersSig = signal(this._settings.providers);
        this._presetsSig = signal(this._settings.presets);
        this._promptInjectionSig = signal(this._settings.promptInjection);
        this._materialConfigSig = signal(this._settings.materialConfig);

        this.signals = {
            settings: this._settingsSig,
            enabled: this._enabledSig,
            activeProvider: this._activeProviderSig,
            transport: this._transportSig,
            taskTimeoutMs: this._taskTimeoutMsSig,
            activeThemePresetId: this._activeThemePresetIdSig,
            ui: this._uiSig,
            providers: this._providersSig,
            presets: this._presetsSig,
            promptInjection: this._promptInjectionSig,
            materialConfig: this._materialConfigSig,
        };
    }

    public get hasInitializedFromHost(): boolean {
        return this._hasInitializedFromHost;
    }

    public setHasInitializedFromHost(flag: boolean): void {
        this._hasInitializedFromHost = flag;
    }

    /** 读取内部只读引用（仅供仓库家族协作，禁止外部直接修改） */
    public getRaw(): DrawAssistantSettings {
        return this._settings;
    }

    /** 替换内部状态对象并同步细粒度信号切片 */
    public replaceRaw(
        nextSettings: DrawAssistantSettings,
        options?: { readonly forceAllSlices?: boolean }
    ): void {
        const prev = this._settings;
        this._settings = nextSettings;
        this.syncSignals(prev, nextSettings, Boolean(options?.forceAllSlices));
    }

    private syncSignals(
        prev: DrawAssistantSettings,
        next: DrawAssistantSettings,
        forceAll: boolean
    ): void {
        batch(() => {
            if (forceAll || this._settingsSig.peek() !== next) {
                this._settingsSig.value = next;
            }
            if (forceAll || prev.enabled !== next.enabled) {
                this._enabledSig.value = next.enabled;
            }
            if (forceAll || prev.activeProvider !== next.activeProvider) {
                this._activeProviderSig.value = next.activeProvider;
            }
            if (forceAll || prev.transport !== next.transport) {
                this._transportSig.value = next.transport;
            }
            if (forceAll || prev.taskTimeoutMs !== next.taskTimeoutMs) {
                this._taskTimeoutMsSig.value = next.taskTimeoutMs;
            }
            if (forceAll || prev.activeThemePresetId !== next.activeThemePresetId) {
                this._activeThemePresetIdSig.value = next.activeThemePresetId;
            }
            if (forceAll || prev.ui !== next.ui) {
                this._uiSig.value = next.ui;
            }
            if (forceAll || prev.providers !== next.providers) {
                this._providersSig.value = next.providers;
            }
            if (forceAll || prev.presets !== next.presets) {
                this._presetsSig.value = next.presets;
            }
            if (forceAll || prev.promptInjection !== next.promptInjection) {
                this._promptInjectionSig.value = next.promptInjection;
            }
            if (forceAll || prev.materialConfig !== next.materialConfig) {
                this._materialConfigSig.value = next.materialConfig;
            }
        });
    }

    /** 获取当前完整配置深拷贝快照 */
    public getSettings(): Readonly<DrawAssistantSettings> {
        return structuredClone(this._settings);
    }

    /** 读取指定根级配置项的值 */
    public get<K extends keyof DrawAssistantSettings>(key: K): DrawAssistantSettings[K] {
        return this._settings[key];
    }

    /** 更新单个根级配置项的值 */
    public set<K extends keyof DrawAssistantSettings>(
        key: K,
        value: DrawAssistantSettings[K]
    ): void {
        if (this._settings[key] === value) {
            return;
        }

        const next: DrawAssistantSettings = {
            ...this._settings,
            [key]: value,
        };
        this.replaceRaw(next);

        eventBus.emit('settings:updated', { key: String(key), value, keys: [String(key)] });
        this.saveToHost(key === 'providers');
    }

    /** 批量合并更新配置 */
    public update(patch: Partial<DrawAssistantSettings>): void {
        const next = deepMerge(this._settings, patch);
        this.replaceRaw(next);
        const allKeys = Object.keys(patch);

        eventBus.emit('settings:updated', { keys: allKeys, patch });
        this.saveToHost(patch.providers !== undefined);
    }

    /** 深度合并更新 UI 交互子配置项 */
    public updateUi(patch: Partial<NonNullable<DrawAssistantSettings['ui']>>): void {
        const currentUi =
            this._settings.ui || ({} as NonNullable<DrawAssistantSettings['ui']>);
        this.update({
            ui: {
                ...currentUi,
                ...patch,
                fab: patch.fab
                    ? { ...(currentUi.fab || {}), ...patch.fab }
                    : currentUi.fab,
                floorButton: patch.floorButton
                    ? { ...(currentUi.floorButton || {}), ...patch.floorButton }
                    : currentUi.floorButton,
                imageActionPanel: patch.imageActionPanel
                    ? { ...(currentUi.imageActionPanel || {}), ...patch.imageActionPanel }
                    : currentUi.imageActionPanel,
                lightbox: patch.lightbox
                    ? { ...(currentUi.lightbox || {}), ...patch.lightbox }
                    : currentUi.lightbox,
                imageDisplay: patch.imageDisplay
                    ? { ...(currentUi.imageDisplay || {}), ...patch.imageDisplay }
                    : currentUi.imageDisplay,
            },
        });
    }

    /** 读取指定绘图服务提供方的私有配置对象快照 */
    public getProviderConfig<T = Record<string, unknown>>(type: ProviderType): T | undefined {
        const providers = this._settings.providers as Record<string, unknown> | undefined;
        const config = providers?.[type];
        if (!config || typeof config !== 'object') {
            return undefined;
        }
        return structuredClone(config as Record<string, unknown>) as T;
    }

    /** 更新指定绘图服务提供方的私有配置 */
    public setProviderConfig<T = Record<string, unknown>>(
        type: ProviderType,
        patch: Partial<T>
    ): void {
        const current = (this.getProviderConfig<T>(type) || {}) as T;
        const updated = deepMerge(
            current as Record<string, unknown>,
            patch as Record<string, unknown>
        ) as T;

        const next: DrawAssistantSettings = {
            ...this._settings,
            providers: {
                ...this._settings.providers,
                [type]: updated,
            },
        };
        this.replaceRaw(next);

        eventBus.emit('settings:updated', { key: `providers.${type}`, value: updated });
        this.saveToHost(true);
    }

    public restoreLocalSecrets(): void {
        restoreProviderSecretsFromStorage(this._settings.providers);
    }

    public persistLocalSecrets(): void {
        persistProviderSecretsToStorage(this._settings.providers);
    }

    public stripSecretsFromSettings(settings: DrawAssistantSettings): DrawAssistantSettings {
        const cloned = structuredClone(settings);
        if (cloned.providers && typeof cloned.providers === 'object') {
            for (const [pKey, pCfg] of Object.entries(cloned.providers)) {
                if (pCfg && typeof pCfg === 'object' && !Array.isArray(pCfg)) {
                    (cloned.providers as Record<string, unknown>)[pKey] = stripSecretsDeep(
                        pCfg,
                        SECRET_FIELD_PATTERN
                    );
                }
            }
        }
        return cloned;
    }

    /** 将当前内存配置持久化同步至 SillyTavern 宿主 */
    public saveToHost(syncSecrets = false): void {
        if (this.onSaveToHost) {
            this.onSaveToHost(syncSecrets);
            return;
        }
        this.persistToHost(syncSecrets);
    }

    /** 实际执行宿主持久化与本地密钥写入 */
    public persistToHost(syncSecrets = false): void {
        if (syncSecrets || this._hasInitializedFromHost) {
            this.persistLocalSecrets();
        }

        const hostContext = getHostContext();
        if (hostContext?.extensionSettings) {
            const sanitized = this.stripSecretsFromSettings(this._settings);
            hostContext.extensionSettings[SettingsRepository.EXTENSION_NAME] =
                sanitized as unknown as Record<string, unknown>;
        }

        if (typeof hostContext?.saveSettingsDebounced === 'function') {
            try {
                hostContext.saveSettingsDebounced();
            } catch (err) {
                logger.error('调用宿主 saveSettingsDebounced 异常:', err);
            }
        }
    }
}
