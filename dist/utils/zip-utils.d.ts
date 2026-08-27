/**
 * @module utils/zip-utils
 * @description ZIP 打包下载工具模块 (ZipUtils)
 *
 * 职责：
 * - 纯前端轻量级 Store 方式打包 Base64 图片为 ZIP 压缩包并自动触发下载
 * - 将选中的多张图片及其生成元数据 JSON 序列化导出为单包 ZIP 压缩文件
 * - 支持未引入 JSZip 场景下的容错与多文件打包降级
 */
/**
 * 将指定 UUID 列表的图片及生成元数据打包导出为 ZIP 文件并触发下载
 *
 * 当环境中存在 JSZip 时打包为包含图片、独立 JSON 元数据和清单的 ZIP 压缩包；
 * 当无 JSZip 时自动降级为导出包含完整记录的 JSON 格式文件。
 *
 * @param uuids 要打包导出的图像 UUID 列表
 * @returns 打包或导出完成的 Promise
 */
export declare function exportImagesToZip(uuids: string[]): Promise<void>;
//# sourceMappingURL=zip-utils.d.ts.map