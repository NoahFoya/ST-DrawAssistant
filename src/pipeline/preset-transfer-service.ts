/**
 * 统一预设批量导入工作流协调服务 (PresetTransferService)。
 *
 * @remarks
 * 聚合原本散落在预设控制器、提供方选项卡、素材库及提示词注入中的重复批量导入循环，
 * 统一负责文件读取、解析校验、`AppValidationError` 提示提取、脏状态确认与重名消歧。
 */

import {
    AppValidationError,
    extractUserFacingErrorMessage,
    formatBatchImportSummary,
    resolveBatchUniquePresetName,
} from '../domain';
import { readFileAsText } from '../util/browser-io';
import { logger } from '../util/logger';

export interface BatchImportCandidate<TData> {
    readonly name: string;
    readonly data: TData;
}

export interface BatchParseResult<TData> {
    readonly candidates: ReadonlyArray<BatchImportCandidate<TData>>;
    readonly skippedErrors?: ReadonlyArray<unknown>;
}

export interface BatchPresetImportOptions<TData> {
    readonly files: readonly File[];
    readonly existingNames: Set<string>;
    readonly fallbackName: string;
    readonly parseFile: (rawText: string, file: File) => BatchParseResult<TData>;
    readonly validateCandidate?: (candidate: BatchImportCandidate<TData>) => AppValidationError | null;
    readonly resolveSingleName?: (
        proposedName: string,
        existingNames: ReadonlySet<string>,
        fallbackName: string
    ) => Promise<string | null>;
    readonly isDirty?: () => boolean;
    readonly confirmOverwrite?: () => Promise<boolean>;
    readonly isDisposed?: () => boolean;
    readonly commitItem: (
        candidate: BatchImportCandidate<TData>,
        finalName: string
    ) => Promise<{ id?: string; name?: string } | void> | { id?: string; name?: string } | void;
    readonly logTag?: string;
}

export interface BatchPresetImportResult {
    readonly aborted: boolean;
    readonly importedCount: number;
    readonly failedCount: number;
    readonly firstError?: string;
    readonly lastImportedId: string;
    readonly lastImportedName: string;
    readonly summaryMessage: string;
    readonly toastLevel: 'success' | 'warning' | 'error';
}

export class PresetTransferService {
    /**
     * 执行多文件预设批量导入标准流程：
     * 1. 读取全部文件并解析校验（未改写任何存储）；
     * 2. 若无有效候选直接汇总错误结果；
     * 3. 当存在未保存草稿时通过 `confirmOverwrite` 请求确认；
     * 4. 单文件单预设时允许调用 `resolveSingleName` 交互式命名，其余情况自动追加序号消歧；
     * 5. 逐条提交并生成统一汇总结果与 Toast 级别。
     */
    public async importFiles<TData>(
        options: BatchPresetImportOptions<TData>
    ): Promise<BatchPresetImportResult> {
        const logTag = options.logTag || '[PresetTransferService]';
        const isDisposed = options.isDisposed ?? (() => false);

        if (isDisposed() || options.files.length === 0) {
            return {
                aborted: true,
                importedCount: 0,
                failedCount: 0,
                lastImportedId: '',
                lastImportedName: '',
                summaryMessage: '',
                toastLevel: 'info' as 'error',
            };
        }

        const validCandidates: Array<BatchImportCandidate<TData>> = [];
        let failedCount = 0;
        let firstError: string | undefined;

        for (const file of options.files) {
            try {
                const rawText = await readFileAsText(file);
                if (isDisposed()) {
                    return {
                        aborted: true,
                        importedCount: 0,
                        failedCount,
                        firstError,
                        lastImportedId: '',
                        lastImportedName: '',
                        summaryMessage: '',
                        toastLevel: 'error',
                    };
                }

                const { candidates, skippedErrors = [] } = options.parseFile(rawText, file);
                if (skippedErrors.length > 0) {
                    failedCount += skippedErrors.length;
                    logger.warn(`${logTag} 批量导入跳过无效条目 (${file.name}):`, skippedErrors[0]);
                    firstError ??= extractUserFacingErrorMessage(skippedErrors[0]);
                }

                if (candidates.length === 0 && skippedErrors.length === 0) {
                    const emptyErr = new AppValidationError(`${file.name} 未包含有效预设`);
                    failedCount += 1;
                    logger.warn(`${logTag} 批量导入文件为空 (${file.name})`);
                    firstError ??= extractUserFacingErrorMessage(emptyErr);
                    continue;
                }

                for (const candidate of candidates) {
                    if (options.validateCandidate) {
                        const validationError = options.validateCandidate(candidate);
                        if (validationError) {
                            failedCount += 1;
                            logger.warn(
                                `${logTag} 批量导入预设校验失败 (${file.name} / ${candidate.name}):`,
                                validationError
                            );
                            firstError ??= extractUserFacingErrorMessage(validationError);
                            continue;
                        }
                    }
                    validCandidates.push(candidate);
                }
            } catch (err: unknown) {
                failedCount += 1;
                logger.warn(`${logTag} 批量导入文件读取/解析失败 (${file.name}):`, err);
                firstError ??= extractUserFacingErrorMessage(err);
            }
        }

        if (validCandidates.length === 0) {
            return {
                aborted: false,
                importedCount: 0,
                failedCount,
                firstError,
                lastImportedId: '',
                lastImportedName: '',
                summaryMessage: formatBatchImportSummary(0, failedCount, firstError),
                toastLevel: 'error',
            };
        }

        if (options.isDirty?.() && options.confirmOverwrite) {
            const confirmed = await options.confirmOverwrite();
            if (!confirmed || isDisposed()) {
                return {
                    aborted: true,
                    importedCount: 0,
                    failedCount,
                    firstError,
                    lastImportedId: '',
                    lastImportedName: '',
                    summaryMessage: '',
                    toastLevel: 'warning',
                };
            }
        }

        const isSingleInteractive =
            Boolean(options.resolveSingleName) &&
            validCandidates.length === 1 &&
            options.files.length === 1;

        let lastImportedId = '';
        let lastImportedName = '';
        let importedCount = 0;

        for (const candidate of validCandidates) {
            if (isDisposed()) {
                return {
                    aborted: true,
                    importedCount,
                    failedCount,
                    firstError,
                    lastImportedId,
                    lastImportedName,
                    summaryMessage: '',
                    toastLevel: 'warning',
                };
            }

            let finalName: string | null;
            if (isSingleInteractive && options.resolveSingleName) {
                finalName = await options.resolveSingleName(
                    candidate.name,
                    options.existingNames,
                    options.fallbackName
                );
                if (!finalName || isDisposed()) {
                    return {
                        aborted: true,
                        importedCount,
                        failedCount,
                        firstError,
                        lastImportedId,
                        lastImportedName,
                        summaryMessage: '',
                        toastLevel: 'warning',
                    };
                }
                options.existingNames.add(finalName.trim().toLowerCase());
            } else {
                finalName = resolveBatchUniquePresetName(
                    candidate.name,
                    options.existingNames,
                    options.fallbackName
                );
            }

            const committed = await options.commitItem(candidate, finalName);
            lastImportedId = committed?.id ?? lastImportedId;
            lastImportedName = committed?.name ?? finalName;
            importedCount += 1;
        }

        const summaryMessage =
            importedCount === 1 && failedCount === 0
                ? `已成功导入预设: ${lastImportedName}`
                : formatBatchImportSummary(importedCount, failedCount, firstError);

        return {
            aborted: false,
            importedCount,
            failedCount,
            firstError,
            lastImportedId,
            lastImportedName,
            summaryMessage,
            toastLevel: importedCount === 0 ? 'error' : failedCount > 0 ? 'warning' : 'success',
        };
    }
}

export const presetTransferService = new PresetTransferService();
