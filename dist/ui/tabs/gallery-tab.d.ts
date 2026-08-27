/**
 * @module ui/tabs/gallery-tab
 * @description 图库管理与历史作品流 Tab 组件
 *
 * 职责：
 * - 从 IndexedDB 检索历史生成图片，支持关键词过滤与排序
 * - 呈现全局存储空间使用配额与清除废弃垃圾垃圾数据
 *
 * IndexedDB 图库读取策略：
 * 优先读取 thumbnails 表的 WebP 缩略图用于列表展示，
 * 按需从 images 表读取原图；删除操作同时清理两张表中的记录。
 */
import { type IDisposable } from '../../core/disposable';
export declare function renderGalleryTab(): [HTMLElement, IDisposable];
//# sourceMappingURL=gallery-tab.d.ts.map