/**
 * 预设批量导入/导出过渡兼容导出模块 (PresetBatchIO)。
 *
 * @remarks
 * 纯解析与校验逻辑已迁移至 `@domain` (`src/domain/preset`)，文件读取已迁移至 `@util/browser-io`；
 * 本文件不再依赖 `preset-controller.ts`，彻底解除双向循环依赖。
 */

export {
    type PresetBundlePayload,
    type ParsedPresetCandidate,
    type ParsePresetBatchResult,
    parsePresetBatchJson,
    buildPresetBundlePayload,
    resolveBatchUniquePresetName,
    formatBatchImportSummary,
} from '../../domain';
export { readFileAsText } from '../../util/browser-io';

