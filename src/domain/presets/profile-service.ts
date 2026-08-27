/**
 * @module domain/presets/profile-service
 * @description 预设方案业务管理服务 (ProfileService)
 * 职责：负责预设方案的增删改查、全局状态同步、JSON 导入导出、快照管理与数据规范化
 * 属于 Domain 领域业务层，纯业务逻辑，不依赖具体 UI 呈现组件
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    PresetProfileItem,
    PRESET_SCHEMA_BINDINGS,
    RegistryCategory,
    PresetCategoryMap,
    PresetExportPackage,
    DEFAULT_THEME_DATA
} from '../../core';

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
        const def = PRESET_SCHEMA_BINDINGS[category];
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
        const def = PRESET_SCHEMA_BINDINGS[category];
        const list = this._store.get(def.listKey);
        return Array.isArray(list) ? (list as PresetProfileItem<PresetCategoryMap[K]['dataType']>[]) : [];
    }

    /** 获取指定分类当前激活的预设 ID */
    public getActiveId<K extends RegistryCategory>(category: K): string {
        const def = PRESET_SCHEMA_BINDINGS[category];
        const id = this._store.get(def.activeIdKey);
        return typeof id === 'string' ? id : '';
    }

    /** 
     * 读取指定分类方案持久库中的原始快照数据 (用于放弃未保存修改/还原快照)
     */
    public getProfileSnapshot<K extends RegistryCategory>(
        category: K,
        id?: string
    ): PresetCategoryMap[K]['dataType'] | null {
        const targetId = id || this.getActiveId(category);
        if (!targetId) return null;
        const list = this.getEffectiveList(category);
        const found = list.find((p) => p.id === targetId);
        if (!found?.data) return null;
        // 深拷贝防止草稿污染持久化快照
        return JSON.parse(JSON.stringify(found.data)) as PresetCategoryMap[K]['dataType'];
    }

    /** 选中并激活指定预设，将其包含的参数应用至全局设置 */
    public applyProfile<K extends RegistryCategory>(category: K, id: string): void {
        const def = PRESET_SCHEMA_BINDINGS[category];
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
        const def = PRESET_SCHEMA_BINDINGS[category];
        this._store.set(def.listKey as any, list as any);
    }

    /**
     * 新建预设方案并将其设为当前激活项
     */
    public createProfile<K extends RegistryCategory>(
        category: K,
        name: string,
        data: PresetCategoryMap[K]['dataType']
    ): string {
        const def = PRESET_SCHEMA_BINDINGS[category];
        const list = [...this.getEffectiveList(category)];
        const id = `${category}_${Date.now()}`;
        const newProfile: PresetProfileItem<PresetCategoryMap[K]['dataType']> = {
            id,
            name: name.trim() || `新${def.label}`,
            data: JSON.parse(JSON.stringify(data))
        };

        list.push(newProfile);
        this.setStoreList(category, list);
        this._store.set(def.activeIdKey, id);
        return id;
    }

    /**
     * 更新指定预设的数据内容，保持 ID 与名称不变
     */
    public saveProfile<K extends RegistryCategory>(
        category: K,
        id: string,
        data: PresetCategoryMap[K]['dataType']
    ): void {
        const list = this.getEffectiveList(category).map((p) =>
            p.id === id ? { ...p, data: JSON.parse(JSON.stringify(data)) } : p
        );
        this.setStoreList(category, list);
    }

    /**
     * 重命名指定预设
     */
    public renameProfile<K extends RegistryCategory>(
        category: K,
        id: string,
        newName: string
    ): void {
        const trimmed = newName.trim();
        if (!trimmed) return;
        const list = this.getEffectiveList(category).map((p) =>
            p.id === id ? { ...p, name: trimmed } : p
        );
        this.setStoreList(category, list);
    }

    /**
     * 删除指定预设并处理边界条件（主题列表若被清空则自动回退至默认主题，其它分类置空）
     */
    public deleteProfile<K extends RegistryCategory>(category: K, id: string): string {
        let list = this.getEffectiveList(category).filter((p) => p.id !== id);

        // 主题分类特殊边界处理：若列表为空则自动回退至单一默认主题
        if (category === 'theme' && list.length === 0) {
            list = [{ id: 'luminous-obsidian', name: '流光黑曜', data: { ...DEFAULT_THEME_DATA } as any }];
        }

        this.setStoreList(category, list);

        const currentActive = this.getActiveId(category);
        if (currentActive === id || !list.some((p) => p.id === currentActive)) {
            const nextId = list.length > 0 ? list[0].id : '';
            this._store.set(PRESET_SCHEMA_BINDINGS[category].activeIdKey, nextId);
            if (nextId) {
                this.applyProfile(category, nextId);
            }
            return nextId;
        }
        return currentActive;
    }

    /**
     * 导出指定方案为包含元数据的标准 JSON 数据包
     */
    public exportProfile<K extends RegistryCategory>(
        category: K,
        id: string,
        data?: PresetCategoryMap[K]['dataType']
    ): void {
        const list = this.getEffectiveList(category);
        const target = list.find((p) => p.id === id);
        const finalData = data || target?.data;
        if (!finalData) return;

        const pkg: PresetExportPackage<PresetCategoryMap[K]['dataType']> = {
            schemaVersion: 1,
            category,
            name: target?.name || id,
            data: finalData,
            exportedAt: Date.now()
        };

        const jsonStr = JSON.stringify(pkg, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ST-DA_${category}_${target?.name || id}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * 解析并导入方案（兼容带元数据的导出包与普通配置数据）
     */
    public importProfile<K extends RegistryCategory>(
        category: K,
        content: string,
        fileName: string
    ): string | null {
        try {
            const raw = JSON.parse(content);
            const def = PRESET_SCHEMA_BINDINGS[category];

            // 格式 1: 包含元数据的标准导出数据包
            if (raw && typeof raw === 'object' && raw.schemaVersion === 1 && raw.data !== undefined) {
                const pkg = raw as PresetExportPackage<PresetCategoryMap[K]['dataType']>;
                const name = pkg.name || fileName.replace(/\.json$/i, '');
                return this.createProfile(category, name, pkg.data);
            }

            // 格式 2: 普通 JSON 预设配置
            const validation = def.validateImport(raw);
            if (!validation.valid) {
                return null;
            }

            const name = typeof raw.name === 'string' ? raw.name : fileName.replace(/\.json$/i, '');
            const normalizeFn = def.normalizeImport;
            const data = typeof normalizeFn === 'function'
                ? normalizeFn(raw, content)
                : ((raw.data !== undefined ? raw.data : raw) as PresetCategoryMap[K]['dataType']);

            return this.createProfile(category, name, data);
        } catch {
            return null;
        }
    }
}
