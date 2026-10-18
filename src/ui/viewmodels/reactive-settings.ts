/**
 * 全局设置响应式桥接器 (ReactiveSettingsBridge)。
 *
 * @remarks
 * 将 SettingsStore 与 EventBus 封装为响应式 Signal 状态源，
 * 供视图层直接读取和回写，消除手动同步控件状态的样板代码。
 */

import { signal, type Signal } from '@preact/signals';
import type { Disposable } from '../types';
import { settingsStore, type DrawAssistantSettings } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';

export class ReactiveSettingsBridge implements Disposable {
    /** 当前完整扩展配置的响应式信号 */
    public readonly settings: Signal<DrawAssistantSettings>;

    private unlistenSettings: (() => void) | null = null;

    public constructor(autoActivate = true) {
        this.settings = signal<DrawAssistantSettings>(structuredClone(settingsStore.getSettings()));
        if (autoActivate) {
            this.activate();
        }
    }

    /**
     * 从 SettingsStore 同步最新配置快照至响应式信号。
     */
    public syncFromStore(): void {
        this.settings.value = structuredClone(settingsStore.getSettings());
    }

    /**
     * 读取顶层配置项（在组件渲染或 computed 中调用将自动建立依赖追踪）。
     */
    public get<K extends keyof DrawAssistantSettings>(key: K): DrawAssistantSettings[K] {
        return this.settings.value[key];
    }

    /**
     * 更新单个顶层配置项并即时持久化到 SettingsStore。
     */
    public set<K extends keyof DrawAssistantSettings>(key: K, value: DrawAssistantSettings[K]): void {
        settingsStore.set(key, value);
        this.syncFromStore();
    }

    /**
     * 批量合并顶层配置项并即时持久化到 SettingsStore。
     */
    public update(patch: Partial<DrawAssistantSettings>): void {
        settingsStore.update(patch);
        this.syncFromStore();
    }

    /**
     * 深度合并更新 ui 子配置项并即时持久化。
     */
    public updateUi(patch: Partial<NonNullable<DrawAssistantSettings['ui']>>): void {
        const currentUi = settingsStore.get('ui') || ({} as NonNullable<DrawAssistantSettings['ui']>);
        settingsStore.update({
            ui: {
                ...currentUi,
                ...patch,
                trigger: patch.trigger
                    ? { ...(currentUi.trigger || {}), ...patch.trigger }
                    : currentUi.trigger,
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
        this.syncFromStore();
    }

    /**
     * 激活事件总线订阅，监听外部对配置的修改。
     */
    public activate(): void {
        this.syncFromStore();
        if (!this.unlistenSettings) {
            this.unlistenSettings = eventBus.on('settings:updated', () => {
                this.syncFromStore();
            });
        }
    }

    /**
     * 停用事件总线订阅（如选项卡切出隐藏时）。
     */
    public deactivate(): void {
        if (this.unlistenSettings) {
            this.unlistenSettings();
            this.unlistenSettings = null;
        }
    }

    /**
     * 释放事件监听资源。
     */
    public dispose(): void {
        this.deactivate();
    }
}
