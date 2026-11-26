/**
 * 本地联想词库无 DOM 状态模型 (LexiconState)。
 */

import { signal } from '@preact/signals';
import type {
    LocalLexiconFileMeta,
    LocalCustomWordItem,
    StaticLexiconManifest,
    StaticLexiconPackMeta,
} from '@types';
import type { Disposable } from '../types';
import {
    localLexiconStorage,
    parseBatchCustomWordsText,
    type LocalLexiconStorage,
} from '../../store/local-lexicon-storage';
import {
    loadStaticLexiconManifest,
    fetchStaticLexiconShardText,
} from '../../store/static-lexicon-loader';
import { lexiconIndexService } from '../../pipeline/lexicon-index-service';
import { eventBus } from '../../util/event-bus';
import { logger } from '../../util/logger';
import { downloadTextFile, readFileAsText } from '../../util/browser-io';
import { Toast } from '../feedback/toast';
import { reportRuntimeError } from '../feedback/error-feedback';
import { ConfirmDialog } from '../feedback/confirm-dialog';

export type LexiconSubTab = 'files' | 'custom';

export class LexiconState implements Disposable {
    public readonly subTab = signal<LexiconSubTab>('files');
    public readonly filesMeta = signal<LocalLexiconFileMeta[]>([]);
    public readonly customWords = signal<LocalCustomWordItem[]>([]);
    public readonly presetManifest = signal<StaticLexiconManifest | null>(null);
    public readonly presetManifestLoading = signal<boolean>(false);
    public readonly presetManifestError = signal<string | null>(null);
    public readonly busyPresetPackIds = signal<Set<string>>(new Set());

    public readonly tailDraft = signal<{ tag: string; cn: string }>({
        tag: '',
        cn: '',
    });
    public readonly insertedDraft = signal<{
        index: number;
        tag: string;
        cn: string;
    } | null>(null);
    public readonly cellBackupValue = signal<string>('');
    public readonly batchPasteText = signal<string>('');
    public readonly showBatchBox = signal<boolean>(false);
    public readonly customSearchQuery = signal<string>('');

    public readonly storage: LocalLexiconStorage;
    private unlistenLexicon: (() => void) | null = null;
    private disposed = false;
    private reloadSeq = 0;

    public constructor(storageInstance?: LocalLexiconStorage) {
        this.storage = storageInstance ?? localLexiconStorage;

        this.unlistenLexicon = eventBus.on('lexicon:local-updated', () => {
            if (!this.disposed) {
                void this.reloadFromStorage();
            }
        });

        void this.reloadFromStorage();
        void this.ensurePresetManifestLoaded();
    }

    public activate(): void {
        if (!this.disposed) {
            void this.reloadFromStorage();
        }
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.reloadSeq++;
        if (this.unlistenLexicon) {
            this.unlistenLexicon();
            this.unlistenLexicon = null;
        }
    }

    public dismissInsertedDraft(): void {
        this.insertedDraft.value = null;
    }

    public beginInsertDraftAt(index: number): void {
        this.insertedDraft.value = { index, tag: '', cn: '' };
    }

    public async reloadFromStorage(): Promise<void> {
        const seq = ++this.reloadSeq;
        const [files, words] = await Promise.all([
            this.storage.listFilesMeta(),
            this.storage.listCustomWords(),
        ]);
        if (this.disposed || seq !== this.reloadSeq) return;
        this.filesMeta.value = files;
        this.customWords.value = words;
    }

    public async importFileContent(
        fileName: string,
        rawText: string
    ): Promise<LocalLexiconFileMeta> {
        const meta = await this.storage.importLexiconFile(fileName, rawText);
        await this.reloadFromStorage();
        Toast.show(
            `已导入词库文件「${meta.fileName}」（共 ${meta.entryCount} 条词条）`,
            { level: 'success' }
        );
        return meta;
    }

    public async importFiles(files: File[]): Promise<void> {
        for (const f of files) {
            try {
                const rawText = await readFileAsText(f);
                if (this.disposed) return;
                await this.importFileContent(f.name, rawText);
            } catch (err) {
                if (!this.disposed) {
                    reportRuntimeError(
                        `[LexiconState] 读取词库文件「${f.name}」失败:`,
                        '读取词库文件失败，请前往「日志与统计」查看详情',
                        err
                    );
                }
            }
        }
    }

    public async setFileEnabled(fileId: string, enabled: boolean): Promise<void> {
        await this.storage.setFileEnabled(fileId, enabled);
    }

    public async deleteFile(fileId: string, fileName: string): Promise<void> {
        await this.storage.deleteFile(fileId);
        await this.reloadFromStorage();
        Toast.show(`已删除文件「${fileName}」`, { level: 'info' });
    }

    public async clearAllFiles(count: number): Promise<void> {
        const ok = await ConfirmDialog.confirm({
            title: '清空全部词汇文件',
            message: `确定要清空当前已载入的 ${count} 个词汇文件吗？此操作不会影响您的自定义词条。`,
            confirmText: '清空全部',
            cancelText: '取消',
        });
        if (!ok || this.disposed) return;
        await this.storage.clearAllFiles();
        await this.reloadFromStorage();
        Toast.show('已清空全部词汇文件', { level: 'info' });
    }

    public async commitTailDraftRow(): Promise<boolean> {
        const tag = this.tailDraft.value.tag.trim();
        const cn = this.tailDraft.value.cn.trim();
        if (!tag) {
            return false;
        }
        const saved = await this.storage.upsertCustomWord({ tag, cn });
        this.tailDraft.value = { tag: '', cn: '' };
        await this.reloadFromStorage();
        Toast.show(`已添加词条: ${saved.tag}`, { level: 'success' });
        return true;
    }

    public async commitInsertedDraftRow(): Promise<void> {
        const draft = this.insertedDraft.value;
        if (!draft) return;
        const tag = draft.tag.trim();
        const cn = draft.cn.trim();
        if (tag) {
            await this.storage.insertCustomWordAt(draft.index, { tag, cn });
            this.insertedDraft.value = null;
            await this.reloadFromStorage();
            Toast.show(`已插入词条: ${tag}`, { level: 'success' });
        } else {
            this.insertedDraft.value = null;
        }
    }

    public async applyMultiLinePasteText(
        text: string,
        insertIndex: number
    ): Promise<boolean> {
        if (!text.includes('\n') && !text.includes('\t')) {
            return false;
        }
        const parsed = parseBatchCustomWordsText(text);
        if (parsed.length > 0) {
            for (let i = parsed.length - 1; i >= 0; i--) {
                const item = parsed[i];
                if (item) {
                    await this.storage.insertCustomWordAt(insertIndex, item);
                }
            }
            await this.reloadFromStorage();
            Toast.show(`已批量填入 ${parsed.length} 条词汇`, { level: 'success' });
        }
        return true;
    }

    public async handleExistingTagBlur(
        item: LocalCustomWordItem,
        rawNextTag: string
    ): Promise<void> {
        const nextTag = rawNextTag.trim();
        if (!nextTag) {
            await this.storage.deleteCustomWord(item.id);
            await this.reloadFromStorage();
            Toast.show(`已移除空行: ${item.tag}`, { level: 'info' });
            return;
        }
        if (nextTag !== item.tag) {
            await this.storage.upsertCustomWord({
                id: item.id,
                tag: nextTag,
                cn: item.cn,
            });
            await this.reloadFromStorage();
        }
    }

    public async handleExistingCnBlur(
        item: LocalCustomWordItem,
        rawNextCn: string
    ): Promise<void> {
        const nextCn = rawNextCn.trim();
        if (nextCn !== (item.cn || '')) {
            await this.storage.upsertCustomWord({
                id: item.id,
                tag: item.tag,
                cn: nextCn,
            });
            await this.reloadFromStorage();
        }
    }

    public async deleteCustomWord(id: string, toastMessage = '已删除词条'): Promise<void> {
        await this.storage.deleteCustomWord(id);
        await this.reloadFromStorage();
        Toast.show(toastMessage, { level: 'info' });
    }

    public async clearCustomWords(count: number): Promise<void> {
        const ok = await ConfirmDialog.confirm({
            title: '清空自定义词库',
            message: `确定要清空全部 ${count} 条自定义词汇吗？此操作不可撤销，建议在清空前先导出备份。`,
            confirmText: '清空全部',
            cancelText: '取消',
        });
        if (!ok || this.disposed) return;
        await this.storage.clearCustomWords();
        await this.reloadFromStorage();
        Toast.show('已清空全部自定义词库', { level: 'info' });
    }

    public async runBatchImportCustomWords(
        textOverride?: string
    ): Promise<{ added: number; updated: number; total: number }> {
        const raw = textOverride ?? this.batchPasteText.value;
        const parsedItems = parseBatchCustomWordsText(raw);
        if (parsedItems.length === 0) {
            Toast.show('未解析出有效词条，请检查输入格式', { level: 'warning' });
            const existing = await this.storage.listCustomWords();
            return { added: 0, updated: 0, total: existing.length };
        }

        const current = await this.storage.listCustomWords();
        const currentByLower = new Map<string, LocalCustomWordItem>();
        for (const item of current) {
            currentByLower.set(item.tag.toLowerCase(), item);
        }

        const conflicts: Array<{ tag: string; existingCn: string; newCn: string }> = [];
        for (const p of parsedItems) {
            const existing = currentByLower.get(p.tag.toLowerCase());
            if (existing && existing.cn && p.cn && existing.cn !== p.cn) {
                conflicts.push({
                    tag: existing.tag,
                    existingCn: existing.cn,
                    newCn: p.cn,
                });
            }
        }

        let overwriteConflicts = true;
        if (conflicts.length > 0) {
            const sampleText = conflicts
                .slice(0, 3)
                .map((c) => `${c.tag}: "${c.existingCn}" → "${c.newCn}"`)
                .join(', ');
            const suffix = conflicts.length > 3 ? ` 等共 ${conflicts.length} 条` : '';
            overwriteConflicts = await ConfirmDialog.confirm({
                title: '词条冲突确认',
                message: `检测到待导入的词条中有 ${conflicts.length} 条与现有中文释义不同（例如 ${sampleText}${suffix}）。\n\n是否使用导入的新释义覆盖现有词条？`,
                confirmText: '覆盖现有',
                cancelText: '保留现有',
            });
        }

        const stats = await this.storage.batchImportCustomWords(raw, {
            overwriteConflicts,
        });
        if (textOverride === undefined) {
            this.batchPasteText.value = '';
        }
        await this.reloadFromStorage();
        if (stats.added > 0 || stats.updated > 0) {
            Toast.show(
                `批量导入完成：新增 ${stats.added} 条，更新 ${stats.updated} 条（当前共 ${stats.total} 条）`,
                { level: 'success' }
            );
        } else {
            Toast.show('未解析出有效词条，请检查输入格式', { level: 'warning' });
        }
        return stats;
    }

    public async handleExportCustomWords(format: 'json' | 'csv'): Promise<void> {
        const text =
            format === 'json'
                ? await this.storage.exportCustomWordsAsJson()
                : await this.storage.exportCustomWordsAsCsv();
        downloadTextFile(
            `st-draw-custom-lexicon.${format}`,
            text,
            format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'
        );
    }

    public async rebuildIndex(): Promise<void> {
        await Promise.all([this.reloadFromStorage(), lexiconIndexService.reload()]);
        Toast.show('本地词库索引已刷新', { level: 'success' });
    }

    private setPackBusy(packId: string, busy: boolean): void {
        if (this.disposed) return;
        const next = new Set(this.busyPresetPackIds.value);
        if (busy) {
            next.add(packId);
        } else {
            next.delete(packId);
        }
        this.busyPresetPackIds.value = next;
    }

    public async ensurePresetManifestLoaded(forceReload = false): Promise<void> {
        if (this.disposed) return;
        if (!forceReload && (this.presetManifest.value || this.presetManifestLoading.value)) {
            return;
        }
        this.presetManifestLoading.value = true;
        this.presetManifestError.value = null;
        try {
            const manifest = await loadStaticLexiconManifest({ forceReload });
            if (this.disposed) return;
            this.presetManifest.value = manifest;
        } catch (err) {
            if (this.disposed) return;
            this.presetManifestError.value = err instanceof Error ? err.message : String(err);
        } finally {
            if (!this.disposed) {
                this.presetManifestLoading.value = false;
            }
        }
    }

    public async loadPresetPack(pack: StaticLexiconPackMeta): Promise<void> {
        if (this.disposed || this.busyPresetPackIds.value.has(pack.id)) {
            return;
        }
        this.setPackBusy(pack.id, true);
        try {
            const rawCsv = await fetchStaticLexiconShardText(pack.fileName);
            if (this.disposed) return;
            const meta = await this.storage.importLexiconFile(pack.displayName, rawCsv, {
                presetPackId: pack.id,
            });
            if (this.disposed) return;
            await this.reloadFromStorage();
            Toast.show(
                `已载入「${pack.displayName}」（${meta.entryCount.toLocaleString()} 词条）`,
                { level: 'success' }
            );
        } catch (err) {
            if (!this.disposed) {
                reportRuntimeError(
                    `[LexiconState] 载入「${pack.displayName}」失败:`,
                    '载入本地词库失败，请前往「日志与统计」查看详情',
                    err
                );
            }
        } finally {
            this.setPackBusy(pack.id, false);
        }
    }

    public async unloadPresetPack(pack: StaticLexiconPackMeta): Promise<void> {
        if (this.disposed || this.busyPresetPackIds.value.has(pack.id)) {
            return;
        }
        this.setPackBusy(pack.id, true);
        try {
            const removed = await this.storage.uninstallPresetPack(pack.id);
            if (this.disposed) return;
            await this.reloadFromStorage();
            if (removed) {
                Toast.show(`已卸载「${pack.displayName}」`, { level: 'info' });
            }
        } catch (err) {
            if (!this.disposed) {
                reportRuntimeError(
                    `[LexiconState] 卸载「${pack.displayName}」失败:`,
                    '卸载本地词库失败，请前往「日志与统计」查看详情',
                    err
                );
            }
        } finally {
            this.setPackBusy(pack.id, false);
        }
    }

    public async loadAllPresetPacks(): Promise<void> {
        const manifest = this.presetManifest.value;
        if (this.disposed || !manifest) return;
        const loadedIds = new Set(
            this.filesMeta.value.map((f) => f.presetPackId).filter(Boolean) as string[]
        );
        const pending = manifest.packs.filter((p) => !loadedIds.has(p.id));
        if (pending.length === 0) return;

        let loadedCount = 0;
        let failedCount = 0;
        for (const pack of pending) {
            if (this.disposed) return;
            this.setPackBusy(pack.id, true);
            try {
                const rawCsv = await fetchStaticLexiconShardText(pack.fileName);
                if (this.disposed) return;
                await this.storage.importLexiconFile(pack.displayName, rawCsv, {
                    presetPackId: pack.id,
                });
                loadedCount += 1;
            } catch (err) {
                logger.warn(`[LexiconState] 批量载入词库分片「${pack.displayName}」失败:`, err);
                failedCount += 1;
            } finally {
                this.setPackBusy(pack.id, false);
            }
        }
        if (this.disposed) return;
        await this.reloadFromStorage();
        Toast.show(
            failedCount === 0
                ? `已一键载入 ${loadedCount} 个本地词库`
                : `本地词库载入完成：成功 ${loadedCount} 个，失败 ${failedCount} 个`,
            { level: failedCount > 0 ? 'warning' : 'success' }
        );
    }

    public async unloadAllPresetPacks(): Promise<void> {
        const manifest = this.presetManifest.value;
        if (this.disposed || !manifest) return;
        const loadedIds = new Set(
            this.filesMeta.value.map((f) => f.presetPackId).filter(Boolean) as string[]
        );
        const targets = manifest.packs.filter((p) => loadedIds.has(p.id));
        if (targets.length === 0) return;

        let removedCount = 0;
        for (const pack of targets) {
            if (this.disposed) return;
            this.setPackBusy(pack.id, true);
            try {
                const removed = await this.storage.uninstallPresetPack(pack.id);
                if (removed) removedCount += 1;
            } finally {
                this.setPackBusy(pack.id, false);
            }
        }
        if (this.disposed) return;
        await this.reloadFromStorage();
        Toast.show(`已卸载 ${removedCount} 个本地词库`, { level: 'info' });
    }
}
