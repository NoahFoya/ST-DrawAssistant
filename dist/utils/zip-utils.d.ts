/**
 * @module utils/zip-utils
 * @description ZIP 打包下载工具模块 (ZipUtils)
 *
 * 职责：
 * - 纯前端轻量级 Store 方式打包 Base64 图片为 ZIP 压缩包并自动触发下载
 * - 将选中的多张图片及其生成元数据 JSON 序列化导出为单包 ZIP 压缩文件
 * - 支持未引入 JSZip 场景下的容错与多文件打包降级
 */
export declare function exportImagesToZip(uuids: string[]): Promise<void>;
//# sourceMappingURL=zip-utils.d.ts.map