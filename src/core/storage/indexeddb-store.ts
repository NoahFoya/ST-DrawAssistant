/**
 * @module core/storage/indexeddb-store
 * @description 基于 IndexedDB 的生图资产持久化存储服务
 */

import localforage from 'localforage';
import { StoredImageRecord, IDisposable } from '../types';
import { Logger } from '../logging/logger';
import { DB_NAME, DB_STORE_NAME } from '../constants';

/**
 * 本地图片与元数据持久化存储
 */
export class IndexedDbStore implements IDisposable {
    private readonly _db: LocalForage;
    private readonly _logger = new Logger('IndexedDbStore');
    private _isInitialized = false;

    constructor() {
        this._db = localforage.createInstance({
            name: DB_NAME,
            storeName: DB_STORE_NAME,
            description: 'ST-DrawAssistant 生图资产与元数据持久化存储'
        });
    }

    /** 初始化数据库实例 */
    public async init(): Promise<void> {
        if (this._isInitialized) return;
        try {
            await this._db.ready();
            this._isInitialized = true;
            this._logger.info('IndexedDB 本地存储已就绪');
        } catch (err) {
            this._logger.error('初始化 IndexedDB 失败', err);
            throw err;
        }
    }

    /** 保存图像实体记录 */
    public async save(record: StoredImageRecord): Promise<void> {
        await this.init();
        await this._db.setItem(record.id, record);
    }

    /** 根据 ID 获取图像记录 */
    public async get(id: string): Promise<StoredImageRecord | null> {
        await this.init();
        return await this._db.getItem<StoredImageRecord>(id);
    }

    /** 根据 ID 删除图像记录 */
    public async delete(id: string): Promise<boolean> {
        await this.init();
        await this._db.removeItem(id);
        return true;
    }

    /** 分页列出图像记录（按时间倒序） */
    public async list(limit = 50, offset = 0): Promise<StoredImageRecord[]> {
        await this.init();
        const list: StoredImageRecord[] = [];
        await this._db.iterate((value: StoredImageRecord) => {
            if (value && value.id) {
                list.push(value);
            }
        });

        list.sort((a, b) => (b.metadata?.createdAt || 0) - (a.metadata?.createdAt || 0));
        return list.slice(offset, offset + limit);
    }

    /** 获取记录总数 */
    public async count(): Promise<number> {
        await this.init();
        return await this._db.length();
    }

    public dispose(): void {
        this._isInitialized = false;
    }
}
