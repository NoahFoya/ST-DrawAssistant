/**
 * @module core/presets/profile-service
 * @description 预设方案通用管理与持久化服务 (ProfileService)
 */
import { ObservableStore } from '../state/store';
import { DrawAssistantSettings, PresetProfileItem } from '../state/store-types';
import { RegistryCategory } from './preset-definitions';
export declare class ProfileService {
    private readonly _store;
    constructor(store: ObservableStore<DrawAssistantSettings>);
    /**
     * 获取指定类别的当前预设列表
     */
    getEffectiveList<T>(category: RegistryCategory): PresetProfileItem<T>[];
    /**
     * 获取指定分类当前激活的预设 ID
     */
    getActiveId(category: RegistryCategory): string;
    /**
     * 切换激活的预设方案并将数据应用至全局配置
     */
    applyProfile(category: RegistryCategory, id: string): void;
    /**
     * 新建预设方案
     */
    createProfile<T>(category: RegistryCategory, name: string, data: T): string;
    /**
     * 保存/覆盖现有预设方案数据
     */
    saveProfile<T>(category: RegistryCategory, id: string, data: T): void;
    /**
     * 重命名预设方案
     */
    renameProfile(category: RegistryCategory, id: string, newName: string): void;
    /**
     * 删除预设方案并返回下一个激活 ID
     */
    deleteProfile(category: RegistryCategory, id: string): string;
    /**
     * 重置/清空预设方案列表 (支持注入示例配置集)
     *
     * @param category 预设分类
     * @param sampleProfiles 可选的示范预设列表，未提供时清空列表
     */
    resetToDefault<T>(category: RegistryCategory, sampleProfiles?: PresetProfileItem<T>[]): void;
}
//# sourceMappingURL=profile-service.d.ts.map