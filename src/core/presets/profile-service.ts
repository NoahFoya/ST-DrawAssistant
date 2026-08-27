/**
 * @module core/presets/profile-service
 * @description 预设方案管理服务 (负责方案的增删改查、批量导入与状态同步)
 */

import { ObservableStore } from '../state/store';
import { DrawAssistantSettings, PresetProfileItem } from '../state/store-types';
import { PRESET_REGISTRY, RegistryCategory, PresetCategoryMap } from './preset-definitions';

/**
 * 预设方案业务管理服务
 */
export class ProfileService {
    private readonly _store: ObservableStore<DrawAssistantSettings>;

    constructor(store: ObservableStore<DrawAssistantSettings>) {
        this._store = store;
    }

    /** 批量校验与规范化预设数据 (供初始化与文件导入共用) */
    public static normalizeAndImportBatch<K extends RegistryCategory>(
        category: K,
        rawItems: unknown[]
    ): PresetProfileItem<PresetCategoryMap[K]['dataType']>[] {
        const def = PRESET_REGISTRY[category];
        const results: PresetProfileItem<PresetCategoryMap[K]['dataType']>[] = [];

        rawItems.forEach((raw, idx) => {
            if (!raw || typeof raw !== 'object') return;
            const validation = def.validateImport(raw);
            if (!validation.valid) return;

            const r = raw as Record<string, unknown>;
            const id = typeof r.id === 'string' ? r.id : `${category}_preset_${idx + 1}`;
            const name = typeof r.name === 'string' ? r.name : `预设方案 ${idx + 1}`;
            const normalizeFn = def.normalizeImport;
            const data = typeof normalizeFn === 'function'
                ? normalizeFn(raw, JSON.stringify(raw))
                : ((r.data !== undefined ? r.data : raw) as PresetCategoryMap[K]['dataType']);

            results.push({ id, name, data });
        });

        return results;
    }

    /** 获取指定分类在全局设置中存储的预设列表 */
    public getEffectiveList<K extends RegistryCategory>(
        category: K
    ): PresetProfileItem<PresetCategoryMap[K]['dataType']>[] {
        const def = PRESET_REGISTRY[category];
        const list = this._store.get(def.listKey);
        return Array.isArray(list) ? (list as PresetProfileItem<PresetCategoryMap[K]['dataType']>[]) : [];
    }

    /** 获取指定分类当前激活的预设 ID */
    public getActiveId<K extends RegistryCategory>(category: K): string {
        const def = PRESET_REGISTRY[category];
        const id = this._store.get(def.activeIdKey);
        return typeof id === 'string' ? id : '';
    }

    /** 选中并激活指定预设，将其包含的参数应用至全局设置 */
    public applyProfile<K extends RegistryCategory>(category: K, id: string): void {
        const def = PRESET_REGISTRY[category];
        const list = this.getEffectiveList(category);
        const target = list.find((p) => p.id === id);

        this._store.set(def.activeIdKey, id);

        if (target && target.data) {
            const patch = def.applyToSettings(target.data);
            for (const [k, v] of Object.entries(patch)) {
                this._store.set(k as keyof DrawAssistantSettings, v as any);
            }
        }
    }

    /** 将指定分类的预设列表写入全局 Store，类型安全由泛型约束保证 */
    private setStoreList<K extends RegistryCategory>(
        category: K,
        list: PresetProfileItem<PresetCategoryMap[K]['dataType']>[]
    ): void {
        const def = PRESET_REGISTRY[category];
        this._store.set(def.listKey, list as DrawAssistantSettings[PresetCategoryMap[K]['listKey']]);
    }

    /**
     * 新建预设方案并将其设为当前激活项
     *
     * @param category 预设分类
     * @param name 新预设名称
     * @param data 预设数据内容
     * @returns 新建预设的唯一 ID
     */
    public createProfile<K extends RegistryCategory>(
        category: K,
        name: string,
        data: PresetCategoryMap[K]['dataType']
    ): string {
        const def = PRESET_REGISTRY[category];
        const list = [...this.getEffectiveList(category)];
        const id = `${category}_${Date.now()}`;
        const newProfile: PresetProfileItem<PresetCategoryMap[K]['dataType']> = { id, name, data };

        list.push(newProfile);
        this.setStoreList(category, list);
        this._store.set(def.activeIdKey, id);
        return id;
    }

    /**
     * 更新指定预设的数据内容，保持 ID 与名称不变
     *
     * @param category 预设分类
     * @param id 要更新的预设 ID
     * @param data 新的预设数据内容
     */
    public saveProfile<K extends RegistryCategory>(
        category: K,
        id: string,
        data: PresetCategoryMap[K]['dataType']
    ): void {
        const list = this.getEffectiveList(category).map((p) =>
            p.id === id ? { ...p, data } : p
        );
        this.setStoreList(category, list);
    }

    /**
     * 重命名指定预设
     *
     * @param category 预设分类
     * @param id 要重命名的预设 ID
     * @param newName 新名称
     */
    public renameProfile<K extends RegistryCategory>(
        category: K,
        id: string,
        newName: string
    ): void {
        const list = this.getEffectiveList(category).map((p) =>
            p.id === id ? { ...p, name: newName } : p
        );
        this.setStoreList(category, list);
    }

    /**
     * 删除指定预设，删除后自动切换至列表第一项（若删除的正是当前激活项）
     *
     * @param category 预设分类
     * @param id 要删除的预设 ID
     * @returns 删除后当前激活的预设 ID（若列表为空则返回空字符串）
     */
    public deleteProfile<K extends RegistryCategory>(category: K, id: string): string {
        const list = this.getEffectiveList(category).filter((p) => p.id !== id);
        this.setStoreList(category, list);

        const currentActive = this.getActiveId(category);
        if (currentActive === id) {
            const nextId = list.length > 0 ? list[0].id : '';
            this.applyProfile(category, nextId);
            return nextId;
        }
        return currentActive;
    }

    /**
     * 将指定分类的预设列表重置为传入的样本预设集，并激活第一项
     *
     * @param category 预设分类
     * @param sampleProfiles 用于重置的样本预设列表，默认为空数组
     */
    public resetToDefault<K extends RegistryCategory>(
        category: K,
        sampleProfiles: PresetProfileItem<PresetCategoryMap[K]['dataType']>[] = []
    ): void {
        this.setStoreList(category, sampleProfiles);
        const firstId = sampleProfiles.length > 0 ? sampleProfiles[0].id : '';
        this.applyProfile(category, firstId);
    }
}


