/**
 * 预设存储管理模块 (PresetStore)
 * 面向 SettingsStore 与酒馆 extension_settings 的统一预设方案门面。
 * 负责 themes, prompts, workflows, drawing 四大分类预设的增删改查、独立导入导出与出厂重置。
 */

import { PresetItem, PresetsArchiveData } from '../types';
import { SettingsStore } from './settings-store';
import { Logger } from '../utils/logger';

export class PresetStore {
    private static readonly _logger = new Logger('PresetStore');
    private static _store: SettingsStore | null = null;

    /** 绑定当前运行时的 SettingsStore 实例 */
    public static bindStore(store: SettingsStore): void {
        this._store = store;
    }

    private static _getStore(): SettingsStore {
        if (!this._store) {
            this._store = new SettingsStore();
        }
        return this._store;
    }

    /**
     * 读取指定分类下的预设方案列表
     */
    public static async list<T = any>(category: string, subCategory?: string): Promise<PresetItem<T>[]> {
        return this._getStore().getPresets<T>(category, subCategory);
    }

    /**
     * 兼容别名：获取预设摘要列表
     */
    public static async listSummary<T = any>(category: string, subCategory?: string): Promise<PresetItem<T>[]> {
        return this.list<T>(category, subCategory);
    }

    /**
     * 读取单个预设详情
     */
    public static async get<T = any>(
        category: string,
        id: string,
        subCategory?: string
    ): Promise<PresetItem<T> | null> {
        return this._getStore().getPreset<T>(category, id, subCategory);
    }

    /**
     * 保存或覆盖预设方案到酒馆持久化配置中
     */
    public static async save<T = any>(
        category: string,
        item: { id: string; name: string; data?: T; isBuiltin?: boolean },
        subCategory?: string
    ): Promise<boolean> {
        const ok = this._getStore().savePreset<T>(category, item, subCategory);
        if (ok) {
            this._logger.info(`预设方案已持久化 [${category}:${subCategory || ''}:${item.id}]`);
        }
        return ok;
    }

    /**
     * 删除指定预设方案
     */
    public static async delete(
        category: string,
        id: string,
        subCategory?: string
    ): Promise<boolean> {
        const ok = this._getStore().deletePreset(category, id, subCategory);
        if (ok) {
            this._logger.info(`预设方案已删除 [${category}:${subCategory || ''}:${id}]`);
        }
        return ok;
    }

    /**
     * 导出全量预设方案为归档对象
     */
    public static async exportArchive(): Promise<PresetsArchiveData> {
        return this._getStore().exportPresetsArchive();
    }

    /**
     * 批量导入预设归档包并写入持久化配置
     */
    public static async importArchive(
        presets: any
    ): Promise<{ success: boolean; importedCount: number; error?: string }> {
        return this._getStore().importPresetsArchive(presets);
    }

    /**
     * 清空自定义修改并恢复为出厂预设
     */
    public static async resetDefaults(): Promise<{ success: boolean; error?: string }> {
        return this._getStore().resetPresets();
    }
}
