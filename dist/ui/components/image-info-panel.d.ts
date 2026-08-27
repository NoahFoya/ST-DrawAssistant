/**
 * @module ui/components/image-info-panel
 * @description 图像元数据详情抽屉组件 (ImageInfoPanel)
 *
 * 职责：
 * - 呈现选中历史生图记录的完整 Positive Prompt、Negative Prompt、模型名称与采样配置
 * - 提供独立复制正向/负向 Prompt、下载原图与从 IndexedDB 物理删除图片功能
 */
import type { StoredImageRecord } from '../../storage/image-db';
export declare function openImageInfoPanel(record: StoredImageRecord, onDeleted?: () => void): void;
//# sourceMappingURL=image-info-panel.d.ts.map