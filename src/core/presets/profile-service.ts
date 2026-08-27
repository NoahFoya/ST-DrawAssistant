/**
 * @module core/presets/profile-service
 * @description 预设方案通用管理与持久化服务 (ProfileService)
 */

import { ObservableStore } from '../state/store';
import { DrawAssistantSettings, PresetProfileItem } from '../state/store-types';
import { PRESET_REGISTRY, RegistryCategory, PresetCategoryDef } from './preset-definitions';

export class ProfileService {
    private readonly _store: ObservableStore<DrawAssistantSettings>;

    constructor(store: ObservableStore<DrawAssistantSettings>) {
        this._store = store;
    }

    /**
     * 获取指定类别的当前预设列表
     */
    public getEffectiveList<T>(category: RegistryCategory): PresetProfileItem<T>[] {
        const def = PRESET_REGISTRY[category] as unknown as PresetCategoryDef<T>;
        return (this._store.get(def.listKey) as unknown as PresetProfileItem<T>[]) || [];
    }

    /**
     * 获取指定分类当前激活的预设 ID
     */
    public getActiveId(category: RegistryCategory): string {
        const def = PRESET_REGISTRY[category];
        return (this._store.get(def.activeIdKey) as unknown as string) || '';
    }

    /**
     * 切换激活的预设方案并将数据应用至全局配置
     */
    public applyProfile(category: RegistryCategory, id: string): void {
        const def = PRESET_REGISTRY[category];
        const list = this.getEffectiveList(category);
        const target = list.find((p) => p.id === id);

        this._store.set(def.activeIdKey as any, id);

        if (target && target.data) {
            const patch = def.applyToSettings(target.data as any);
            for (const [k, v] of Object.entries(patch)) {
                this._store.set(k as keyof DrawAssistantSettings, v as any);
            }
        }
    }

    /**
     * 新建预设方案
     */
    public createProfile<T>(category: RegistryCategory, name: string, data: T): string {
        const def = PRESET_REGISTRY[category] as unknown as PresetCategoryDef<T>;
        const list = [...this.getEffectiveList<T>(category)];
        const id = `${category}_${Date.now()}`;
        const newProfile: PresetProfileItem<T> = { id, name, data };

        list.push(newProfile);
        this._store.set(def.listKey as any, list);
        this._store.set(def.activeIdKey as any, id);
        return id;
    }

    /**
     * 保存/覆盖现有预设方案数据
     */
    public saveProfile<T>(category: RegistryCategory, id: string, data: T): void {
        const def = PRESET_REGISTRY[category] as unknown as PresetCategoryDef<T>;
        const list = this.getEffectiveList<T>(category).map((p) =>
            p.id === id ? { ...p, data } : p
        );
        this._store.set(def.listKey as any, list);
    }

    /**
     * 重命名预设方案
     */
    public renameProfile(category: RegistryCategory, id: string, newName: string): void {
        const def = PRESET_REGISTRY[category];
        const list = (this.getEffectiveList(category) as PresetProfileItem[]).map((p) =>
            p.id === id ? { ...p, name: newName } : p
        );
        this._store.set(def.listKey as any, list);
    }

    /**
     * 删除预设方案并返回下一个激活 ID
     */
    public deleteProfile(category: RegistryCategory, id: string): string {
        const def = PRESET_REGISTRY[category];
        const list = (this.getEffectiveList(category) as PresetProfileItem[]).filter((p) => p.id !== id);
        this._store.set(def.listKey as any, list);

        const currentActive = this.getActiveId(category);
        if (currentActive === id) {
            const nextId = list.length > 0 ? list[0].id : '';
            this.applyProfile(category, nextId);
            return nextId;
        }
        return currentActive;
    }

    /**
     * 重置/清空预设方案列表 (支持注入示例配置集)
     *
     * @param category 预设分类
     * @param sampleProfiles 可选的示范预设列表，未提供时清空列表
     */
    public resetToDefault<T>(category: RegistryCategory, sampleProfiles: PresetProfileItem<T>[] = []): void {
        const def = PRESET_REGISTRY[category];
        this._store.set(def.listKey as any, sampleProfiles);
        const firstId = sampleProfiles.length > 0 ? sampleProfiles[0].id : '';
        this.applyProfile(category, firstId);
    }
}
