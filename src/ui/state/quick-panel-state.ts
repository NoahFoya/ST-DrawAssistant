/**
 * 悬浮球快捷设置面板无 DOM 状态模型 (QuickPanelState)。
 *
 * @remarks
 * 管理当前激活分页、配置信号订阅、各设置分组的状态更新与宿主同步调度；
 * 不持有任何 DOM 节点或浮层坐标计算逻辑，所有视图通过 signals 响应式读取。
 */

import { signal } from '@preact/signals';
import type {
    ActivationTriggerMode,
    DrawingPresetData,
    MaterialActivationPresetData,
    MaterialExtractionPresetData,
    MaterialLibraryConfig,
    PromptChannelId,
    PromptChannelPresetData,
    PromptInjectionConfig,
    ProviderStoredConfig,
    ProviderType,
    ThinkingDisplayMode,
} from '@types';
import type { Disposable } from '../types';
import { settingsStore, type DrawAssistantSettings } from '../../store/settings-store';
import { AssetSyncCoordinator } from '../../pipeline/asset-sync-coordinator';
import { promptInjector } from '../../pipeline/prompt-injector';
import { hostRegexService } from '../../pipeline/host-regex-service';
import { getHostCharacterCards } from '../../host';
import { eventBus } from '../../util/event-bus';

export type QuickPanelTabId = 'general' | 'provider' | 'prompts' | 'materials';

export interface QuickSelectOption {
    label: string;
    value: string;
}

export interface QuickPanelStateOptions {
    readonly onSettingsUpdated?: () => void;
}

/** 构建确保包含当前已选值的下拉选项列表 */
export function buildSelectOptionsWithCurrent(
    baseOptions: ReadonlyArray<QuickSelectOption>,
    currentVal: string | undefined,
    emptyPlaceholder?: string
): QuickSelectOption[] {
    const list: QuickSelectOption[] = [];
    if (emptyPlaceholder !== undefined) {
        list.push({ label: emptyPlaceholder, value: '' });
    }
    const seen = new Set<string>(list.map((o) => o.value));
    for (const opt of baseOptions) {
        if (!seen.has(opt.value)) {
            seen.add(opt.value);
            list.push({ label: opt.label, value: opt.value });
        }
    }
    const trimmed = (currentVal || '').trim();
    if (trimmed && !seen.has(trimmed)) {
        list.unshift({ label: trimmed, value: trimmed });
    }
    return list;
}

export class QuickPanelState implements Disposable {
    public readonly activeTab = signal<QuickPanelTabId>('general');
    public readonly settingsSignal = signal<DrawAssistantSettings>(settingsStore.getSettings());
    public readonly expandedPromptChannels = signal<Record<PromptChannelId, boolean>>({
        story: true,
        vocab: false,
        character: false,
        material: false,
    });
    public readonly rawBoundCardsDraft = signal<{ presetId: string; text: string } | null>(null);

    private unlistenSettings: (() => void) | null = null;
    private activeServiceSyncAbort: AbortController | null = null;

    public constructor(options: QuickPanelStateOptions = {}) {
        this.unlistenSettings = eventBus.on('settings:updated', () => {
            this.settingsSignal.value = settingsStore.getSettings();
            options.onSettingsUpdated?.();
        });
    }

    public syncFromStore(): void {
        this.settingsSignal.value = settingsStore.getSettings();
    }

    public setActiveTab(tab: QuickPanelTabId): void {
        this.activeTab.value = tab;
    }

    public togglePromptChannelExpanded(channelId: PromptChannelId): void {
        const current = this.expandedPromptChannels.value;
        this.expandedPromptChannels.value = {
            ...current,
            [channelId]: !current[channelId],
        };
    }

    public setEnabled(enabled: boolean): void {
        settingsStore.set('enabled', enabled);
        void promptInjector.scheduleSyncToHost();
    }

    public setSetting<K extends keyof DrawAssistantSettings>(
        key: K,
        value: DrawAssistantSettings[K]
    ): void {
        settingsStore.set(key, value);
    }

    public setThinkingDisplayMode(mode: ThinkingDisplayMode): void {
        settingsStore.set('thinkingDisplayMode', mode);
        hostRegexService.syncToHost({ reloadChatOnDisplayChange: true });
    }

    public setCleanHistoryThinking(val: boolean): void {
        settingsStore.set('cleanHistoryThinking', val);
        hostRegexService.syncToHost();
    }

    public setCleanHistoryMarkup(val: boolean): void {
        settingsStore.set('cleanHistoryMarkup', val);
        hostRegexService.syncToHost();
    }

    public updateUiImageDisplay(
        patch: Partial<DrawAssistantSettings['ui']['imageDisplay']>
    ): void {
        const curUi = settingsStore.get('ui');
        settingsStore.set('ui', {
            ...curUi,
            imageDisplay: {
                ...curUi.imageDisplay,
                ...patch,
            },
        });
    }

    public updateUiFloorHideOnDone(val: boolean): void {
        const curUi = settingsStore.get('ui');
        settingsStore.set('ui', {
            ...curUi,
            floorButton: { ...curUi.floorButton, hideOnDone: val },
        });
    }

    public updateUiImageActionPanelEnabled(val: boolean): void {
        const curUi = settingsStore.get('ui');
        settingsStore.set('ui', {
            ...curUi,
            imageActionPanel: { ...curUi.imageActionPanel, enabled: val },
        });
    }

    public updateUiLightboxEnabled(val: boolean): void {
        const curUi = settingsStore.get('ui');
        settingsStore.set('ui', {
            ...curUi,
            lightbox: { ...curUi.lightbox, enabled: val },
        });
    }

    public setProviderConfig(
        provider: ProviderType,
        patch: Partial<ProviderStoredConfig>
    ): void {
        settingsStore.setProviderConfig(provider, patch);
    }

    /** 中止快捷面板发起的在途服务商资产同步请求 */
    private cancelInFlightServiceAssetSync(): void {
        if (this.activeServiceSyncAbort) {
            this.activeServiceSyncAbort.abort();
            this.activeServiceSyncAbort = null;
        }
    }

    /**
     * 切换服务商档位，与主设置面板共享 `serviceProfiles` 存档切换并在无缓存模型时触发静默资产同步。
     */
    public switchProviderService(provider: ProviderType, nextServiceId: string): void {
        this.cancelInFlightServiceAssetSync();
        const res = settingsStore.switchProviderService(provider, nextServiceId);
        if (!res.switched) {
            return;
        }
        const cache = res.nextAssetCache;
        const hasModels =
            Boolean(cache?.checkpoints?.length) || Boolean(cache?.unets?.length);
        if (!hasModels) {
            const controller = new AbortController();
            this.activeServiceSyncAbort = controller;
            void AssetSyncCoordinator.syncProviderAssets(provider, {
                isManual: false,
                silentIfNoChange: true,
                signal: controller.signal,
            }).finally(() => {
                if (this.activeServiceSyncAbort === controller) {
                    this.activeServiceSyncAbort = null;
                }
            });
        }
    }

    public updateActiveDrawingPresetData(
        provider: ProviderType,
        activePresetId: string,
        patch: Partial<DrawingPresetData>
    ): void {
        const preset = settingsStore.getPreset<DrawingPresetData>(
            'drawing',
            activePresetId,
            provider
        );
        if (!preset) return;
        settingsStore.savePreset<DrawingPresetData>(
            'drawing',
            {
                ...preset,
                data: {
                    ...preset.data,
                    ...patch,
                },
                updatedAt: Date.now(),
            },
            provider
        );
    }

    public updatePromptChannel(
        channelId: PromptChannelId,
        patch: Partial<{ enabled: boolean; activePresetId: string; hideWhenEmpty: boolean }>
    ): void {
        const cur = settingsStore.get('promptInjection');
        const next: PromptInjectionConfig = {
            ...cur,
            [channelId]: {
                ...(cur?.[channelId] || { enabled: false, activePresetId: '' }),
                ...patch,
            },
        };
        settingsStore.set('promptInjection', next);
        void promptInjector.scheduleSyncToHost();
    }

    public updatePromptChannelEntry(
        category: 'prompt_story' | 'prompt_vocab' | 'prompt_character' | 'prompt_material',
        presetId: string,
        entryId: string,
        patch: Partial<{ enabled: boolean; triggerMode: ActivationTriggerMode }>
    ): void {
        const preset = settingsStore.getPreset<PromptChannelPresetData>(category, presetId);
        if (!preset || !Array.isArray(preset.data?.entries)) return;
        const nextEntries = preset.data.entries.map((entry) =>
            entry.id === entryId ? { ...entry, ...patch } : entry
        );
        settingsStore.savePreset<PromptChannelPresetData>(category, {
            ...preset,
            data: {
                ...preset.data,
                entries: nextEntries,
            },
            updatedAt: Date.now(),
        });
        void promptInjector.scheduleSyncToHost();
    }

    public updateMaterialConfig(patch: Partial<MaterialLibraryConfig>): void {
        const cur = settingsStore.get('materialConfig');
        settingsStore.set('materialConfig', {
            ...cur,
            ...patch,
        });
        void promptInjector.scheduleSyncToHost();
    }

    public updateActiveActivationData(
        activeActPreset: { id: string; name: string; data: MaterialActivationPresetData },
        patch: Partial<MaterialActivationPresetData>
    ): void {
        settingsStore.savePreset<MaterialActivationPresetData>('material_activations', {
            ...activeActPreset,
            data: {
                ...(activeActPreset.data || { characterRules: {}, outfitRules: {} }),
                ...patch,
            },
            updatedAt: Date.now(),
        });
        void promptInjector.scheduleSyncToHost();
    }

    public updateActivationRule(
        activeActPreset: { id: string; name: string; data: MaterialActivationPresetData },
        ruleGroup: 'characterRules' | 'outfitRules',
        presetId: string,
        patch: { enabled?: boolean; triggerMode?: ActivationTriggerMode }
    ): void {
        const actData = activeActPreset.data || { characterRules: {}, outfitRules: {} };
        const currentRules =
            (ruleGroup === 'characterRules' ? actData.characterRules : actData.outfitRules) ||
            {};
        const prev = currentRules[presetId];
        const nextMode = patch.triggerMode ?? prev?.triggerMode ?? 'keyword';
        const nextEnabled =
            patch.enabled !== undefined
                ? patch.enabled
                : patch.triggerMode === 'always'
                  ? true
                  : Boolean(prev?.enabled);

        this.updateActiveActivationData(activeActPreset, {
            [ruleGroup]: {
                ...currentRules,
                [presetId]: {
                    ...(prev || {}),
                    enabled: nextEnabled,
                    triggerMode: nextMode,
                },
            },
        });
    }

    public updateActiveExtractionData(
        activeExtPreset: { id: string; name: string; data: MaterialExtractionPresetData },
        patch: Partial<MaterialExtractionPresetData>
    ): void {
        settingsStore.savePreset<MaterialExtractionPresetData>('material_extractions', {
            ...activeExtPreset,
            data: {
                ...activeExtPreset.data,
                ...patch,
            },
            updatedAt: Date.now(),
        });
        hostRegexService.syncToHost();
    }

    public getHostCards(): Array<{ id: string; name: string }> {
        return getHostCharacterCards();
    }

    public dispose(): void {
        this.cancelInFlightServiceAssetSync();
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
    }
}
