/**
 * @module core/state/schema-migrator
 * @description 配置项版本自动校验与数据模型迁移工具 (SchemaMigrator)
 */
import { DrawAssistantSettings } from './store-types';
/**
 * 校验并平滑迁移历史设置对象至最新数据模型
 * 保证与 createDefaultSettings() 保持完全一致的单一事实源默认值
 *
 * @param rawSettings 宿主或 LocalStorage 读取出的原始设置对象
 * @returns 迁移补齐后的标准 DrawAssistantSettings 对象
 */
export declare function migrateSettings(rawSettings: unknown): DrawAssistantSettings;
//# sourceMappingURL=schema-migrator.d.ts.map