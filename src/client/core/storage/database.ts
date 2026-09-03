/**
 * @module core/storage/database
 * @description 基于 IndexedDB 的生图资产持久化存储服务
 */

import localforage from 'localforage';
import { StoredImageRecord, IDisposable } from '../types';
import { Logger } from '../logger';
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
            driver: localforage.INDEXEDDB,
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

    /**
     * 按创建时间倒序分页获取图片记录
     *
     * 先收集轻量级的时间与 ID 信息完成分页切片，再按需读取当前页的图片实体，
     * 避免在内存中一次性加载所有大图数据导致浏览器内存溢出。
     *
     * @param limit 每页记录数
     * @param offset 起始位置
     */
    public async list(limit = 50, offset = 0): Promise<StoredImageRecord[]> {
        await this.init();

        const indexList: { id: string; createdAt: number }[] = [];
        await this._db.iterate((value: StoredImageRecord) => {
            if (value && value.id) {
                indexList.push({
                    id: value.id,
                    createdAt: value.metadata?.createdAt || 0
                });
            }
        });

        indexList.sort((a, b) => b.createdAt - a.createdAt);
        const pagedIndexes = indexList.slice(offset, offset + limit);

        const records: StoredImageRecord[] = [];
        for (const item of pagedIndexes) {
            const record = await this._db.getItem<StoredImageRecord>(item.id);
            if (record) {
                records.push(record);
            }
        }

        return records;
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
