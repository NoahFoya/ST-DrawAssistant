/**
 * @module ui/views/gallery-tab
 * @description 本地历史图库管理面板视图 (GalleryTab)
 */
import { IStorageAdapter } from '../../core/state/storage-adapter';
import { IHostBridge } from '../../core/foundation/host-bridge';
import { IDisposable } from '../../core/foundation/disposable';
/**
 * 构建并渲染本地历史图库面板
 *
 * @param storage 本地持久化存储适配器实例
 * @param hostBridge 可选宿主桥接适配器
 * @returns 包含生命周期清理能力的图库面板 DOM 根节点
 */
export declare function createGalleryTabView(storage: IStorageAdapter, hostBridge?: IHostBridge): HTMLElement & IDisposable;
//# sourceMappingURL=gallery-tab.d.ts.map