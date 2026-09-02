/**
 * @module core/config/config-sync
 * @description 配置文件导入/导出与服务端同步服务
 */

import { ConfigStore, mergeSettingsWithDefaults } from './config-store';
import { Logger } from '../logging/logger';

export class ConfigSyncService {
    private readonly _store: ConfigStore;
    private readonly _logger = new Logger('ConfigSync');

    constructor(store: ConfigStore) {
        this._store = store;
    }

    /** 导出当前完整设置为 JSON 文本 */
    public exportConfigJson(): string {
        return JSON.stringify(this._store.getState(), null, 2);
    }

    /**
     * 从 JSON 文本解析并合并导入设置
     *
     * @param jsonText JSON 文本
     * @returns 导入是否成功
     */
    public importConfigJson(jsonText: string): boolean {
        try {
            const parsed = JSON.parse(jsonText);
            if (!parsed || typeof parsed !== 'object') {
                throw new Error('无效的配置 JSON 对象');
            }
            const merged = mergeSettingsWithDefaults(parsed, this._store.getState());
            this._store.update(merged);
            return true;
        } catch (err) {
            this._logger.error('导入配置 JSON 失败', err);
            return false;
        }
    }

    /**
     * 将当前配置同步保存到服务端插件本地文件
     *
     * @param syncEndpoint 服务端同步接口地址
     * @param headers 请求头信息
     */
    public async syncToServerFile(syncEndpoint: string, headers?: Record<string, string>): Promise<boolean> {
        try {
            const resp = await fetch(syncEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(headers || {})
                },
                body: this.exportConfigJson()
            });
            return resp.ok;
        } catch (err) {
            this._logger.warn('同步配置至服务端文件失败', err);
            return false;
        }
    }
}
