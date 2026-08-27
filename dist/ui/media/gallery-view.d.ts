/**
 * @module ui/media/gallery-view
 * @description 本地图库画廊管理中枢与存储配额指示条 (Gallery & Media Domain)
 */
import { IStorageAdapter } from '../../core/state/storage-adapter';
import { IDisposable } from '../../core/foundation/disposable';
import { IHostBridge } from '../../core/foundation/host-bridge';
/**
 * 渲染 IndexedDB 存储空间与配额占比指示条组件
 */
export declare function renderStorageBar(_options?: unknown): HTMLElement;
/**
 * 画廊管理中枢操作句柄
 */
export interface GalleryManagerHandle extends HTMLElement, IDisposable {
    reload: () => Promise<void>;
}
/**
 * 创建历史画廊管理中枢业务组件
 */
export declare function createGalleryManager(storage: IStorageAdapter, hostBridge?: IHostBridge): GalleryManagerHandle;
//# sourceMappingURL=gallery-view.d.ts.map