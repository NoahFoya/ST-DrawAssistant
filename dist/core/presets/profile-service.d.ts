/**
 * @module core/presets/profile-service
 * @description 预设方案管理服务 (负责方案的增删改查、批量导入与状态同步)
 */
import { ObservableStore } from '../state/store';
import { DrawAssistantSettings, PresetProfileItem } from '../state/store-types';
import { RegistryCategory, PresetCategoryMap } from './preset-definitions';
/**
 * 预设方案业务管理服务
 */
export declare class ProfileService {
    private readonly _store;
    constructor(store: ObservableStore<DrawAssistantSettings>);
    /** 批量校验与规范化预设数据 (供初始化与文件导入共用) */
    static normalizeAndImportBatch<K extends RegistryCategory>(category: K, rawItems: unknown[]): PresetProfileItem<PresetCategoryMap[K]['dataType']>[];
    /** 获取指定分类在全局设置中存储的预设列表 */
    getEffectiveList<K extends RegistryCategory>(category: K): PresetProfileItem<PresetCategoryMap[K]['dataType']>[];
    /** 获取指定分类当前激活的预设 ID */
    getActiveId<K extends RegistryCategory>(category: K): string;
    /** 选中并激活指定预设，将其包含的参数应用至全局设置 */
    applyProfile<K extends RegistryCategory>(category: K, id: string): void;
    /** 将指定分类的预设列表写入全局 Store，类型安全由泛型约束保证 */
    private setStoreList;
    /**
     * 新建预设方案并将其设为当前激活项
     *
     * @param category 预设分类
     * @param name 新预设名称
     * @param data 预设数据内容
     * @returns 新建预设的唯一 ID
     */
    createProfile<K extends RegistryCategory>(category: K, name: string, data: PresetCategoryMap[K]['dataType']): string;
    /**
     * 更新指定预设的数据内容，保持 ID 与名称不变
     *
     * @param category 预设分类
     * @param id 要更新的预设 ID
     * @param data 新的预设数据内容
     */
    saveProfile<K extends RegistryCategory>(category: K, id: string, data: PresetCategoryMap[K]['dataType']): void;
    /**
     * 重命名指定预设
     *
     * @param category 预设分类
     * @param id 要重命名的预设 ID
     * @param newName 新名称
     */
    renameProfile<K extends RegistryCategory>(category: K, id: string, newName: string): void;
    /**
     * 删除指定预设，删除后自动切换至列表第一项（若删除的正是当前激活项）
     *
     * @param category 预设分类
     * @param id 要删除的预设 ID
     * @returns 删除后当前激活的预设 ID（若列表为空则返回空字符串）
     */
    deleteProfile<K extends RegistryCategory>(category: K, id: string): string;
    /**
     * 将指定分类的预设列表重置为传入的样本预设集，并激活第一项
     *
     * @param category 预设分类
     * @param sampleProfiles 用于重置的样本预设列表，默认为空数组
     */
    resetToDefault<K extends RegistryCategory>(category: K, sampleProfiles?: PresetProfileItem<PresetCategoryMap[K]['dataType']>[]): void;
}
//# sourceMappingURL=profile-service.d.ts.map