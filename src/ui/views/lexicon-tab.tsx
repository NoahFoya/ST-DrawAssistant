/**
 * 词库选项卡视图 (LexiconTabView)。
 *
 * @remarks
 * 纯本地联想词库管理界面（无预设管理器、无酒馆上下文注入设置）：
 * 1. 数据保存于浏览器 IndexedDB (`st_draw_assistant_lexicon`)，
 *    独立于「提示词 -> 词汇指导」，专门为编辑框输入联想提供数据源；
 * 2. 词汇文件 (`files`)：在统一单行列表中展示按需载入的预置 Danbooru 词库分片（默认未载入）与手动导入文件
 *    （支持 Tagcomplete CSV、双列中英 CSV/TSV/TXT 与 JSON），支持原地载入/卸载、独立启停与清空管理；
 * 3. 自定义词汇 (`custom`)：支持表格样式数据网格编辑、尾部空白行自增、右键/长按菜单插入与多行文本解析。
 */

import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import type {
    LocalLexiconFileMeta,
    LocalCustomWordItem,
    StaticLexiconManifest,
    StaticLexiconPackMeta,
} from '@types';
import type { Disposable } from '../types';
import {
    PreactSettingsView,
    CardView,
    SwitchControl,
    ButtonControl,
    SegmentedControlView,
} from '../framework';
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
import { Toast } from '../feedback/toast';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { createPointAnchorRect, openFloatingSurface } from '../layout/floating-sheet';
import { downloadTextFile } from '../../util/browser-io';

export type LexiconSubTab = 'files' | 'custom';

export class LexiconTabView extends PreactSettingsView {
    public readonly id = 'lexicon';
    public readonly title = '词库';

    public readonly subTab = signal<LexiconSubTab>('files');
    public readonly filesMeta = signal<LocalLexiconFileMeta[]>([]);
    public readonly customWords = signal<LocalCustomWordItem[]>([]);
    public readonly presetManifest = signal<StaticLexiconManifest | null>(null);
    public readonly presetManifestLoading = signal<boolean>(false);
    public readonly presetManifestError = signal<string | null>(null);
    public readonly busyPresetPackIds = signal<Set<string>>(new Set());

    // 表格单元格编辑草稿状态
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

    private readonly _storage: LocalLexiconStorage;
    private unlistenLexicon: (() => void) | null = null;
    private fileInputEl: HTMLInputElement | null = null;
    private touchTimer: ReturnType<typeof setTimeout> | null = null;
    private draftBlurTimer: ReturnType<typeof setTimeout> | null = null;
    private focusCellTimer: ReturnType<typeof setTimeout> | null = null;
    private contextMenuHandle: Disposable | null = null;
    private isKeydownBound = false;
    private viewDisposed = false;
    private reloadSeq = 0;
    private touchStartX = 0;
    private touchStartY = 0;

    public constructor(storageInstance?: LocalLexiconStorage) {
        super('da-tab-pane da-view-lexicon');
        this._storage = storageInstance ?? localLexiconStorage;

        this.unlistenLexicon = eventBus.on('lexicon:local-updated', () => {
            if (!this.viewDisposed) {
                void this.reloadFromStorage();
            }
        });

        this.mountPreact();
        void this.reloadFromStorage();
        void this.ensurePresetManifestLoaded();
    }

    private bindGlobalKeyDown(): void {
        if (this.isKeydownBound || this.viewDisposed || typeof window === 'undefined') {
            return;
        }
        window.addEventListener('keydown', this.handleGlobalKeyDown, true);
        this.isKeydownBound = true;
    }

    private unbindGlobalKeyDown(): void {
        if (!this.isKeydownBound || typeof window === 'undefined') {
            return;
        }
        window.removeEventListener('keydown', this.handleGlobalKeyDown, true);
        this.isKeydownBound = false;
    }

    public override activate(): void {
        this.bindGlobalKeyDown();
        void this.reloadFromStorage();
        super.activate();
    }

    public override deactivate(): void {
        this.unbindGlobalKeyDown();
        this.closeContextMenu();
        super.deactivate();
    }

    public override dispose(): void {
        this.viewDisposed = true;
        this.reloadSeq++;
        this.unbindGlobalKeyDown();
        this.closeContextMenu();
        if (this.unlistenLexicon) {
            this.unlistenLexicon();
            this.unlistenLexicon = null;
        }
        if (this.fileInputEl) {
            this.fileInputEl.remove();
            this.fileInputEl = null;
        }
        if (this.touchTimer) {
            clearTimeout(this.touchTimer);
            this.touchTimer = null;
        }
        if (this.draftBlurTimer) {
            clearTimeout(this.draftBlurTimer);
            this.draftBlurTimer = null;
        }
        if (this.focusCellTimer) {
            clearTimeout(this.focusCellTimer);
            this.focusCellTimer = null;
        }
        super.dispose();
    }

    private readonly handleGlobalKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && this.insertedDraft.value) {
            this.insertedDraft.value = null;
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
        }
    };

    /**
     * 精准聚焦指定行的单元格。
     */
    public focusCell(rowSelector: string, col: 'tag' | 'cn', select = false): void {
        if (typeof document === 'undefined' || this.viewDisposed) return;
        if (this.focusCellTimer) {
            clearTimeout(this.focusCellTimer);
        }
        this.focusCellTimer = setTimeout(() => {
            this.focusCellTimer = null;
            if (this.viewDisposed) return;
            const row = this.element.querySelector<HTMLElement>(rowSelector);
            const input = row?.querySelector<HTMLInputElement>(
                col === 'tag' ? '.da-lexicon-cell-tag' : '.da-lexicon-cell-cn'
            );
            if (input) {
                input.focus();
                if (select) {
                    input.select();
                }
            }
        }, 30);
    }

    /**
     * 从 IndexedDB 重新加载词汇文件列表与自定义词汇列表。
     */
    public async reloadFromStorage(): Promise<void> {
        const seq = ++this.reloadSeq;
        const [files, words] = await Promise.all([
            this._storage.listFilesMeta(),
            this._storage.listCustomWords(),
        ]);
        if (this.viewDisposed || seq !== this.reloadSeq) return;
        this.filesMeta.value = files;
        this.customWords.value = words;
    }

    /**
     * 导入单个外部词汇文件文本。
     */
    public async importFileContent(
        fileName: string,
        rawText: string
    ): Promise<LocalLexiconFileMeta> {
        const meta = await this._storage.importLexiconFile(fileName, rawText);
        await this.reloadFromStorage();
        Toast.show(
            `已导入词库文件「${meta.fileName}」（共 ${meta.entryCount} 条词条）`,
            { level: 'success' }
        );
        return meta;
    }

    /**
     * 提交尾部空白行：若 Tag 非空则持久化并自增派生新空行，支持回车连击录入。
     */
    public async commitTailDraftRow(autoFocusNext = false): Promise<void> {
        const tag = this.tailDraft.value.tag.trim();
        const cn = this.tailDraft.value.cn.trim();
        if (!tag) {
            return;
        }
        const saved = await this._storage.upsertCustomWord({ tag, cn });
        this.tailDraft.value = { tag: '', cn: '' };
        await this.reloadFromStorage();
        Toast.show(`已添加词条: ${saved.tag}`, { level: 'success' });

        if (autoFocusNext) {
            this.focusCell('.da-lexicon-tail-draft-row', 'tag');
        }
    }

    /**
     * 提交中间插入的待录入空白行。
     */
    public async commitInsertedDraftRow(): Promise<void> {
        const draft = this.insertedDraft.value;
        if (!draft) return;
        const tag = draft.tag.trim();
        const cn = draft.cn.trim();
        if (tag) {
            await this._storage.insertCustomWordAt(draft.index, { tag, cn });
            this.insertedDraft.value = null;
            await this.reloadFromStorage();
            Toast.show(`已插入词条: ${tag}`, { level: 'success' });
        } else {
            // 空内容离开时直接收缩销毁该行，不残留垃圾
            this.insertedDraft.value = null;
        }
    }

    /**
     * 调度插入行失焦延迟自动提交，记录并重置定时器句柄防止生命周期泄漏。
     */
    private scheduleDraftBlurCommit(): void {
        if (this.draftBlurTimer) {
            clearTimeout(this.draftBlurTimer);
        }
        this.draftBlurTimer = setTimeout(() => {
            this.draftBlurTimer = null;
            const activeEl = document.activeElement;
            const inDraft = activeEl?.closest('.da-lexicon-inserted-row');
            if (!inDraft) {
                void this.commitInsertedDraftRow();
            }
        }, 120);
    }

    /**
     * 单元格智能多行粘贴：识别包含换行或制表符的多行文本，自动解析并批量填入网格。
     */
    public async handleCellPaste(
        e: ClipboardEvent,
        insertIndex: number
    ): Promise<void> {
        const text = e.clipboardData?.getData('text') || '';
        if (text.includes('\n') || text.includes('\t')) {
            e.preventDefault();
            const parsed = parseBatchCustomWordsText(text);
            if (parsed.length > 0) {
                // 逆序插入保持粘贴顺序
                for (let i = parsed.length - 1; i >= 0; i--) {
                    const item = parsed[i];
                    if (item) {
                        await this._storage.insertCustomWordAt(insertIndex, item);
                    }
                }
                await this.reloadFromStorage();
                Toast.show(`已批量填入 ${parsed.length} 条词汇`, {
                    level: 'success',
                });
            }
        }
    }

    /**
     * 已有行 Tag 单元格失焦处理：若被完全清空，自动删除该行；若修改则持久化。
     */
    public async handleExistingTagBlur(
        item: LocalCustomWordItem,
        rawNextTag: string
    ): Promise<void> {
        const nextTag = rawNextTag.trim();
        if (!nextTag) {
            // 清空 Tag 视为直接删除此行
            await this._storage.deleteCustomWord(item.id);
            await this.reloadFromStorage();
            Toast.show(`已移除空行: ${item.tag}`, { level: 'info' });
            return;
        }
        if (nextTag !== item.tag) {
            await this._storage.upsertCustomWord({
                id: item.id,
                tag: nextTag,
                cn: item.cn,
            });
            await this.reloadFromStorage();
        }
    }

    /**
     * 已有行 中文单元格失焦处理。
     */
    public async handleExistingCnBlur(
        item: LocalCustomWordItem,
        rawNextCn: string
    ): Promise<void> {
        const nextCn = rawNextCn.trim();
        if (nextCn !== (item.cn || '')) {
            await this._storage.upsertCustomWord({
                id: item.id,
                tag: item.tag,
                cn: nextCn,
            });
            await this.reloadFromStorage();
        }
    }

    /**
     * 通过浮动菜单层呼出右键或长按操作菜单（桌面端相对锚点展开，移动端自动切换底部 Action Sheet）。
     */
    public openContextMenu(
        clientX: number,
        clientY: number,
        item: LocalCustomWordItem,
        index: number,
        anchorEl?: HTMLElement | null
    ): void {
        this.closeContextMenu();
        const anchorRect = anchorEl
            ? anchorEl.getBoundingClientRect()
            : createPointAnchorRect(clientX, clientY);

        this.contextMenuHandle = openFloatingSurface({
            stackId: 'lexicon-context-menu',
            title: item.tag ? `词条：${item.tag}` : '词条操作',
            anchorRect,
            preferredPlacement: 'bottom',
            align: anchorEl ? 'end' : 'start',
            desktopWidth: 190,
            estimatedHeight: 220,
            panelClassName: 'da-lexicon-context-menu',
            entries: [
                {
                    label: '复制英文 Tag',
                    onSelect: () => {
                        if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            void navigator.clipboard.writeText(item.tag);
                            Toast.show(`已复制 Tag: ${item.tag}`, { level: 'success' });
                        }
                    },
                },
                {
                    label: '编辑此行',
                    onSelect: () => {
                        const escapedId =
                            typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                                ? CSS.escape(item.id)
                                : item.id.replace(/["\\]/g, '\\$&');
                        this.focusCell(
                            `.da-lexicon-custom-row[data-word-id="${escapedId}"]`,
                            'tag',
                            true
                        );
                    },
                },
                { type: 'divider' },
                {
                    label: '在上方插入行',
                    onSelect: () => {
                        this.insertedDraft.value = { index, tag: '', cn: '' };
                        this.focusCell('.da-lexicon-inserted-row', 'tag');
                    },
                },
                {
                    label: '在下方插入行',
                    onSelect: () => {
                        this.insertedDraft.value = { index: index + 1, tag: '', cn: '' };
                        this.focusCell('.da-lexicon-inserted-row', 'tag');
                    },
                },
                { type: 'divider' },
                {
                    label: '删除此词条',
                    danger: true,
                    onSelect: () => {
                        void (async () => {
                            await this._storage.deleteCustomWord(item.id);
                            await this.reloadFromStorage();
                            Toast.show('已删除词条', { level: 'info' });
                        })();
                    },
                },
            ],
            onClose: () => {
                this.contextMenuHandle = null;
            },
        });
    }

    /** 关闭当前活动的词库上下文菜单浮层 */
    public closeContextMenu(): void {
        if (this.contextMenuHandle) {
            const handle = this.contextMenuHandle;
            this.contextMenuHandle = null;
            handle.dispose();
        }
    }

    /**
     * 批量解析并导入多行自定义词汇文本。
     */
    public async runBatchImportCustomWords(
        textOverride?: string
    ): Promise<{ added: number; updated: number; total: number }> {
        const raw = textOverride ?? this.batchPasteText.value;
        const parsedItems = parseBatchCustomWordsText(raw);
        if (parsedItems.length === 0) {
            Toast.show('未解析出有效词条，请检查输入格式', { level: 'warning' });
            const existing = await this._storage.listCustomWords();
            return { added: 0, updated: 0, total: existing.length };
        }

        const current = await this._storage.listCustomWords();
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

        const stats = await this._storage.batchImportCustomWords(raw, {
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

    private triggerFileDialog(): void {
        if (typeof document === 'undefined') return;
        if (!this.fileInputEl) {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.csv,.tsv,.txt,.json';
            input.className = 'da-hidden';
            input.onchange = () => {
                const fileList = Array.from(input.files || []);
                input.value = '';
                for (const f of fileList) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        if (this.viewDisposed) return;
                        void this.importFileContent(
                            f.name,
                            String(reader.result || '')
                        );
                    };
                    reader.onerror = () => {
                        if (!this.viewDisposed) {
                            Toast.show(`读取文件「${f.name}」失败`, {
                                level: 'error',
                            });
                        }
                    };
                    reader.readAsText(f);
                }
            };
            document.body.appendChild(input);
            this.fileInputEl = input;
        }
        this.fileInputEl.click();
    }

    private async handleExportCustomWords(format: 'json' | 'csv'): Promise<void> {
        const text =
            format === 'json'
                ? await this._storage.exportCustomWordsAsJson()
                : await this._storage.exportCustomWordsAsCsv();
        downloadTextFile(
            `st-draw-custom-lexicon.${format}`,
            text,
            format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'
        );
    }

    private setPackBusy(packId: string, busy: boolean): void {
        if (this.viewDisposed) return;
        const next = new Set(this.busyPresetPackIds.value);
        if (busy) {
            next.add(packId);
        } else {
            next.delete(packId);
        }
        this.busyPresetPackIds.value = next;
    }

    /**
     * 按需读取预置静态词库目录清单 (manifest.json)，不自动下载任何 CSV 分片文件。
     */
    public async ensurePresetManifestLoaded(forceReload = false): Promise<void> {
        if (this.viewDisposed) return;
        if (!forceReload && (this.presetManifest.value || this.presetManifestLoading.value)) {
            return;
        }
        this.presetManifestLoading.value = true;
        this.presetManifestError.value = null;
        try {
            const manifest = await loadStaticLexiconManifest({ forceReload });
            if (this.viewDisposed) return;
            this.presetManifest.value = manifest;
        } catch (err) {
            if (this.viewDisposed) return;
            this.presetManifestError.value =
                err instanceof Error ? err.message : String(err);
        } finally {
            if (!this.viewDisposed) {
                this.presetManifestLoading.value = false;
            }
        }
    }

    /**
     * 按需下载并载入单个本地词库分片至本地 IndexedDB。
     */
    public async loadPresetPack(pack: StaticLexiconPackMeta): Promise<void> {
        if (this.viewDisposed || this.busyPresetPackIds.value.has(pack.id)) {
            return;
        }
        this.setPackBusy(pack.id, true);
        try {
            const rawCsv = await fetchStaticLexiconShardText(pack.fileName);
            if (this.viewDisposed) return;
            const meta = await this._storage.importLexiconFile(pack.displayName, rawCsv, {
                presetPackId: pack.id,
            });
            if (this.viewDisposed) return;
            await this.reloadFromStorage();
            Toast.show(
                `已载入「${pack.displayName}」（${meta.entryCount.toLocaleString()} 词条）`,
                { level: 'success' }
            );
        } catch (err) {
            if (!this.viewDisposed) {
                Toast.show(
                    `载入「${pack.displayName}」失败: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                    { level: 'error' }
                );
            }
        } finally {
            this.setPackBusy(pack.id, false);
        }
    }

    /**
     * 卸载指定已载入的本地词库分片并释放本地存储空间。
     */
    public async unloadPresetPack(pack: StaticLexiconPackMeta): Promise<void> {
        if (this.viewDisposed || this.busyPresetPackIds.value.has(pack.id)) {
            return;
        }
        this.setPackBusy(pack.id, true);
        try {
            const removed = await this._storage.uninstallPresetPack(pack.id);
            if (this.viewDisposed) return;
            await this.reloadFromStorage();
            if (removed) {
                Toast.show(`已卸载「${pack.displayName}」`, { level: 'info' });
            }
        } catch (err) {
            if (!this.viewDisposed) {
                Toast.show(
                    `卸载「${pack.displayName}」失败: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                    { level: 'error' }
                );
            }
        } finally {
            this.setPackBusy(pack.id, false);
        }
    }

    /**
     * 一键载入全部尚未载入的本地词库分片。
     */
    public async loadAllPresetPacks(): Promise<void> {
        const manifest = this.presetManifest.value;
        if (this.viewDisposed || !manifest) return;
        const loadedIds = new Set(
            this.filesMeta.value.map((f) => f.presetPackId).filter(Boolean) as string[]
        );
        const pending = manifest.packs.filter((p) => !loadedIds.has(p.id));
        if (pending.length === 0) return;

        let loadedCount = 0;
        let failedCount = 0;
        for (const pack of pending) {
            if (this.viewDisposed) return;
            this.setPackBusy(pack.id, true);
            try {
                const rawCsv = await fetchStaticLexiconShardText(pack.fileName);
                if (this.viewDisposed) return;
                await this._storage.importLexiconFile(pack.displayName, rawCsv, {
                    presetPackId: pack.id,
                });
                loadedCount += 1;
            } catch {
                failedCount += 1;
            } finally {
                this.setPackBusy(pack.id, false);
            }
        }
        if (this.viewDisposed) return;
        await this.reloadFromStorage();
        Toast.show(
            failedCount === 0
                ? `已一键载入 ${loadedCount} 个本地词库`
                : `本地词库载入完成：成功 ${loadedCount} 个，失败 ${failedCount} 个`,
            { level: failedCount > 0 ? 'warning' : 'success' }
        );
    }

    /**
     * 一键卸载全部已载入的本地词库分片（不影响用户自导入的本地词表）。
     */
    public async unloadAllPresetPacks(): Promise<void> {
        const manifest = this.presetManifest.value;
        if (this.viewDisposed || !manifest) return;
        const loadedIds = new Set(
            this.filesMeta.value.map((f) => f.presetPackId).filter(Boolean) as string[]
        );
        const targets = manifest.packs.filter((p) => loadedIds.has(p.id));
        if (targets.length === 0) return;

        let removedCount = 0;
        for (const pack of targets) {
            if (this.viewDisposed) return;
            this.setPackBusy(pack.id, true);
            try {
                const removed = await this._storage.uninstallPresetPack(pack.id);
                if (removed) removedCount += 1;
            } finally {
                this.setPackBusy(pack.id, false);
            }
        }
        if (this.viewDisposed) return;
        await this.reloadFromStorage();
        Toast.show(`已卸载 ${removedCount} 个本地词库`, { level: 'info' });
    }

    private renderFilesSubPanel(): VNode {
        const files = this.filesMeta.value;
        const manifest = this.presetManifest.value;
        const manifestLoading = this.presetManifestLoading.value;
        const manifestError = this.presetManifestError.value;
        const busySet = this.busyPresetPackIds.value;

        const loadedPresetMap = new Map<string, LocalLexiconFileMeta>();
        for (const f of files) {
            if (f.presetPackId) {
                loadedPresetMap.set(f.presetPackId, f);
            }
        }

        const presetPacks = manifest?.packs ?? [];
        const renderedPresetIds = new Set(presetPacks.map((p) => p.id));
        const customOrExtraFiles = files.filter(
            (f) => !f.presetPackId || !renderedPresetIds.has(f.presetPackId)
        );
        const isAllEmpty =
            !manifestLoading && customOrExtraFiles.length === 0 && presetPacks.length === 0;
        const hasUnloadedPresetPacks = presetPacks.some((p) => !loadedPresetMap.has(p.id));
        const hasLoadedPresetPacks = presetPacks.some((p) => loadedPresetMap.has(p.id));
        const isAnyPackBusy = busySet.size > 0;

        return (
            <CardView
                className="da-card--padded"
                title={`词汇文件 (${files.length})`}
                subtitle="按需载入本地词库或导入自定义词表用于输入联想（支持 CSV / TSV / JSON）"
                actions={
                    <div className="da-extra-fields-toolbar">
                        {presetPacks.length > 0 && hasUnloadedPresetPacks && (
                            <ButtonControl
                                label="一键载入"
                                variant="secondary"
                                size="sm"
                                disabled={isAnyPackBusy}
                                onClick={() => void this.loadAllPresetPacks()}
                            />
                        )}
                        {presetPacks.length > 0 && hasLoadedPresetPacks && (
                            <ButtonControl
                                label="一键卸载"
                                variant="secondary"
                                size="sm"
                                disabled={isAnyPackBusy}
                                onClick={() => void this.unloadAllPresetPacks()}
                            />
                        )}
                        {files.length > 0 && (
                            <ButtonControl
                                label="清空全部"
                                variant="danger"
                                size="sm"
                                className="da-lexicon-clear-files-btn"
                                onClick={async () => {
                                    const ok = await ConfirmDialog.confirm({
                                        title: '清空全部词汇文件',
                                        message: `确定要清空当前已载入的 ${files.length} 个词汇文件吗？此操作不会影响您的自定义词条。`,
                                        confirmText: '清空全部',
                                        cancelText: '取消',
                                    });
                                    if (ok) {
                                        await this._storage.clearAllFiles();
                                        await this.reloadFromStorage();
                                        Toast.show('已清空全部词汇文件', { level: 'info' });
                                    }
                                }}
                            />
                        )}
                        <ButtonControl
                            label="+ 导入文件"
                            variant="primary"
                            size="sm"
                            tooltip="支持导入 Danbooru/Tagcomplete 三列 CSV、双列中英 CSV/TSV 以及通用 JSON 词表（推荐 UTF-8 编码）。"
                            className="da-lexicon-import-file-btn"
                            onClick={() => this.triggerFileDialog()}
                        />
                    </div>
                }
            >
                {manifestError && !manifest && (
                    <div className="da-empty-hint da-lexicon-preset-error-bar">
                        <span>本地词库清单读取失败：{manifestError}</span>
                        <ButtonControl
                            label="重试"
                            variant="secondary"
                            size="sm"
                            onClick={() => void this.ensurePresetManifestLoaded(true)}
                        />
                    </div>
                )}

                {manifestLoading && !manifest && (
                    <div className="da-empty-hint">正在读取本地词库清单...</div>
                )}

                {isAllEmpty ? (
                    <div className="da-empty-hint da-lexicon-empty-hint">
                        当前尚未载入任何词汇文件，点击右上角「+ 导入文件」可载入本地词表。
                    </div>
                ) : (
                    <div className="da-lexicon-files-list">
                        {customOrExtraFiles.map((file) => (
                            <div
                                key={file.id}
                                className="da-lexicon-file-row"
                                data-file-id={file.id}
                            >
                                <div className="da-lexicon-file-row__left">
                                    <SwitchControl
                                        value={Boolean(file.enabled)}
                                        onChange={(checked) => {
                                            void this._storage.setFileEnabled(
                                                file.id,
                                                checked
                                            );
                                        }}
                                    />
                                    <span className="da-lexicon-file-name">
                                        <strong>{file.fileName}</strong>
                                    </span>
                                    <span className="da-lexicon-file-meta">
                                        {file.entryCount.toLocaleString()} 词条
                                    </span>
                                </div>
                                <div className="da-lexicon-file-row__right">
                                    <ButtonControl
                                        label="✕"
                                        variant="danger"
                                        size="sm"
                                        className="da-lexicon-delete-file-btn"
                                        onClick={async () => {
                                            await this._storage.deleteFile(file.id);
                                            await this.reloadFromStorage();
                                            Toast.show(`已删除文件「${file.fileName}」`, {
                                                level: 'info',
                                            });
                                        }}
                                    />
                                </div>
                            </div>
                        ))}

                        {presetPacks.map((pack) => {
                            const loadedMeta = loadedPresetMap.get(pack.id);
                            const isLoaded = Boolean(loadedMeta);
                            const isBusy = busySet.has(pack.id);

                            return (
                                <div
                                    key={pack.id}
                                    className={`da-lexicon-file-row${
                                        isLoaded ? '' : ' da-lexicon-file-row--unloaded'
                                    }`}
                                    data-preset-pack-id={pack.id}
                                    {...(loadedMeta ? { 'data-file-id': loadedMeta.id } : {})}
                                >
                                    <div className="da-lexicon-file-row__left">
                                        <SwitchControl
                                            value={isLoaded && Boolean(loadedMeta?.enabled)}
                                            disabled={!isLoaded || isBusy}
                                            onChange={(checked) => {
                                                if (loadedMeta) {
                                                    void this._storage.setFileEnabled(
                                                        loadedMeta.id,
                                                        checked
                                                    );
                                                }
                                            }}
                                        />
                                        <span className="da-lexicon-file-name">
                                            <strong>{pack.displayName}</strong>
                                        </span>
                                        <span className="da-lexicon-file-meta">
                                            {pack.entryCount.toLocaleString()} 词条
                                        </span>
                                    </div>
                                    <div className="da-lexicon-file-row__right">
                                        {isLoaded ? (
                                            <ButtonControl
                                                label="卸载"
                                                variant="danger"
                                                size="sm"
                                                loading={isBusy}
                                                loadingText="卸载中..."
                                                disabled={isBusy}
                                                className="da-lexicon-preset-unload-btn"
                                                onClick={() => void this.unloadPresetPack(pack)}
                                            />
                                        ) : (
                                            <ButtonControl
                                                label="载入"
                                                variant="primary"
                                                size="sm"
                                                loading={isBusy}
                                                loadingText="载入中..."
                                                disabled={isBusy}
                                                className="da-lexicon-preset-load-btn"
                                                onClick={() => void this.loadPresetPack(pack)}
                                            />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardView>
        );
    }

    private handleRowContextMenu(
        e: MouseEvent,
        item: LocalCustomWordItem,
        index: number
    ): void {
        e.preventDefault();
        e.stopPropagation();
        this.openContextMenu(e.clientX, e.clientY, item, index);
    }

    private handleRowTouchStart(
        e: TouchEvent,
        item: LocalCustomWordItem,
        index: number
    ): void {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        if (this.touchTimer) clearTimeout(this.touchTimer);
        this.touchTimer = setTimeout(() => {
            this.touchTimer = null;
            this.openContextMenu(touch.clientX, touch.clientY, item, index);
        }, 500);
    }

    private handleRowTouchMove(e: TouchEvent): void {
        if (!this.touchTimer) return;
        const touch = e.touches[0];
        if (!touch) return;
        if (
            Math.hypot(
                touch.clientX - this.touchStartX,
                touch.clientY - this.touchStartY
            ) > 10
        ) {
            clearTimeout(this.touchTimer);
            this.touchTimer = null;
        }
    }

    private handleRowTouchEnd(): void {
        if (this.touchTimer) {
            clearTimeout(this.touchTimer);
            this.touchTimer = null;
        }
    }

    private renderCustomWordsSubPanel(): VNode {
        const allWords = this.customWords.value;
        const indexedWords = allWords.map((item, origIndex) => ({ item, origIndex }));
        const query = this.customSearchQuery.value.trim().toLowerCase();
        const filteredEntries = query
            ? indexedWords.filter(
                  ({ item }) =>
                      item.tag.toLowerCase().includes(query) ||
                      (item.cn || '').toLowerCase().includes(query)
              )
            : indexedWords;
        const visibleEntries = filteredEntries.slice(0, 120);
        const draft = this.insertedDraft.value;
        const isSearching = Boolean(query);

        // 渲染无任何多余按钮的纯单元格插入行
        const renderInsertedRow = () => {
            if (!draft) return null;
            return (
                <div
                    key="inserted-draft-row"
                    className="da-lexicon-grid-row da-lexicon-inserted-row"
                    data-row-index={draft.index}
                >
                    <input
                        type="text"
                        className="da-input da-lexicon-cell da-lexicon-cell-tag"
                        value={draft.tag}
                        placeholder="输入英文 Tag..."
                        autoFocus
                        onInput={(e) => {
                            if (this.insertedDraft.value) {
                                this.insertedDraft.value = {
                                    ...this.insertedDraft.value,
                                    tag: (e.currentTarget as HTMLInputElement).value,
                                };
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Tab' && !e.shiftKey) {
                                e.preventDefault();
                                this.focusCell('.da-lexicon-inserted-row', 'cn');
                            } else if (e.key === 'Enter') {
                                e.preventDefault();
                                void this.commitInsertedDraftRow();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                this.insertedDraft.value = null;
                            }
                        }}
                        onBlur={() => this.scheduleDraftBlurCommit()}
                        onPaste={(e) => void this.handleCellPaste(e, draft.index)}
                    />
                    <input
                        type="text"
                        className="da-input da-lexicon-cell da-lexicon-cell-cn"
                        value={draft.cn}
                        placeholder="中文释义 (选填)..."
                        onInput={(e) => {
                            if (this.insertedDraft.value) {
                                this.insertedDraft.value = {
                                    ...this.insertedDraft.value,
                                    cn: (e.currentTarget as HTMLInputElement).value,
                                };
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                                e.preventDefault();
                                void this.commitInsertedDraftRow();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                this.insertedDraft.value = null;
                            }
                        }}
                        onBlur={() => this.scheduleDraftBlurCommit()}
                        onPaste={(e) => void this.handleCellPaste(e, draft.index)}
                    />
                    <span className="da-lexicon-row-placeholder-handle" />
                </div>
            );
        };

        return (
            <CardView
                className="da-card--padded"
                title={`自定义词库 (${allWords.length})`}
                subtitle="维护本地专用的生图 Tag 与中文释义，在提示词输入框中自动联想补全"
                actions={
                    <div className="da-extra-fields-toolbar">
                        <ButtonControl
                            label="+ 添加词条"
                            variant="primary"
                            size="sm"
                            className="da-lexicon-add-word-btn"
                            onClick={() => {
                                this.focusCell('.da-lexicon-tail-draft-row', 'tag');
                            }}
                        />
                        <ButtonControl
                            label={
                                this.showBatchBox.value
                                    ? '收起批量录入'
                                    : '批量录入 ▾'
                            }
                            variant="secondary"
                            size="sm"
                            className="da-lexicon-toggle-batch-btn"
                            onClick={() => {
                                this.showBatchBox.value = !this.showBatchBox.value;
                            }}
                        />
                        <ButtonControl
                            label="导出 JSON"
                            variant="secondary"
                            size="sm"
                            disabled={allWords.length === 0}
                            onClick={() => {
                                void this.handleExportCustomWords('json');
                            }}
                        />
                        <ButtonControl
                            label="导出 CSV"
                            variant="secondary"
                            size="sm"
                            disabled={allWords.length === 0}
                            onClick={() => {
                                void this.handleExportCustomWords('csv');
                            }}
                        />
                        {allWords.length > 0 && (
                            <ButtonControl
                                label="清空全部"
                                variant="danger"
                                size="sm"
                                className="da-lexicon-clear-custom-btn"
                                onClick={async () => {
                                    const ok = await ConfirmDialog.confirm({
                                        title: '清空自定义词库',
                                        message: `确定要清空全部 ${allWords.length} 条自定义词汇吗？此操作不可撤销，建议在清空前先导出备份。`,
                                        confirmText: '清空全部',
                                        cancelText: '取消',
                                    });
                                    if (ok) {
                                        await this._storage.clearCustomWords();
                                        await this.reloadFromStorage();
                                        Toast.show('已清空全部自定义词库', { level: 'info' });
                                    }
                                }}
                            />
                        )}
                    </div>
                }
            >
                {/* 1. 批量导入抽屉 */}
                {this.showBatchBox.value && (
                    <div className="da-lexicon-batch-box">
                        <textarea
                            className="da-textarea da-lexicon-batch-textarea"
                            rows={5}
                            value={this.batchPasteText.value}
                            placeholder={
                                '每行一条 (支持 tag,中文 或 - tag（中文）)，例如:\n- cowboy_shot（七分身/美式镜头）\nover_the_shoulder, 过肩视角\ndutch_angle'
                            }
                            onInput={(e) => {
                                this.batchPasteText.value = (
                                    e.currentTarget as HTMLTextAreaElement
                                ).value;
                            }}
                        />
                        <div className="da-extra-fields-toolbar">
                            <ButtonControl
                                label="确认批量解析并导入"
                                variant="primary"
                                size="sm"
                                className="da-lexicon-batch-import-btn"
                                onClick={() => {
                                    void this.runBatchImportCustomWords();
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* 2. 搜索过滤栏 */}
                {allWords.length > 0 && (
                    <div className="da-lexicon-filter-bar">
                        <input
                            type="text"
                            className="da-input da-lexicon-custom-search-input"
                            value={this.customSearchQuery.value}
                            placeholder="搜索自定义英文 Tag 或中文释义..."
                            onInput={(e) => {
                                this.customSearchQuery.value = (
                                    e.currentTarget as HTMLInputElement
                                ).value;
                            }}
                        />
                        {this.customSearchQuery.value && (
                            <button
                                type="button"
                                className="da-lexicon-search-clear-btn"
                                title="清除搜索"
                                onClick={() => {
                                    this.customSearchQuery.value = '';
                                }}
                            >
                                ✕
                            </button>
                        )}
                    </div>
                )}

                {/* 3. 自定义词汇表格数据网格 */}
                <div className="da-lexicon-table-container">
                    <div className="da-lexicon-table-header">
                        <span className="da-lexicon-th-tag">英文 Tag</span>
                        <span className="da-lexicon-th-cn">中文释义 / 别名</span>
                        <span className="da-lexicon-th-action">操作</span>
                    </div>

                    <div className="da-lexicon-custom-list">
                        {allWords.length === 0 && !isSearching && (
                            <div className="da-lexicon-empty-state">
                                <div className="da-lexicon-empty-state__icon">
                                    <svg
                                        width="28"
                                        height="28"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.75"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                                        <line x1="7" y1="7" x2="7.01" y2="7" />
                                    </svg>
                                </div>
                                <div className="da-lexicon-empty-state__title">暂无自定义词条</div>
                                <div className="da-lexicon-empty-state__subtitle">
                                    可在下方直接输入 Tag 录入，或点击右上角「批量录入」导入已有词表
                                </div>
                            </div>
                        )}

                        {visibleEntries.map(({ item, origIndex }, idx) => (
                            <>
                                {draft && draft.index === origIndex && renderInsertedRow()}
                                <div
                                    key={item.id}
                                    className="da-lexicon-custom-row da-lexicon-grid-row"
                                    data-word-id={item.id}
                                    data-row-index={idx}
                                    onContextMenu={(e) =>
                                        this.handleRowContextMenu(e, item, origIndex)
                                    }
                                    onTouchStart={(e) =>
                                        this.handleRowTouchStart(e, item, origIndex)
                                    }
                                    onTouchMove={(e) => this.handleRowTouchMove(e)}
                                    onTouchEnd={() => this.handleRowTouchEnd()}
                                    onTouchCancel={() => this.handleRowTouchEnd()}
                                >
                                    <input
                                        type="text"
                                        className="da-input da-lexicon-cell da-lexicon-cell-tag"
                                        value={item.tag}
                                        placeholder="英文 Tag"
                                        onFocus={(e) => {
                                            this.cellBackupValue.value = (
                                                e.currentTarget as HTMLInputElement
                                            ).value;
                                        }}
                                        onBlur={(e) => {
                                            void this.handleExistingTagBlur(
                                                item,
                                                (e.currentTarget as HTMLInputElement)
                                                    .value
                                            );
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Tab' && !e.shiftKey) {
                                                e.preventDefault();
                                                this.focusCell(
                                                    `.da-lexicon-grid-row[data-row-index="${idx}"]`,
                                                    'cn'
                                                );
                                            } else if (e.key === 'Enter') {
                                                e.preventDefault();
                                                if (idx + 1 < visibleEntries.length) {
                                                    this.focusCell(
                                                        `.da-lexicon-grid-row[data-row-index="${idx + 1}"]`,
                                                        'tag'
                                                    );
                                                } else {
                                                    this.focusCell(
                                                        '.da-lexicon-tail-draft-row',
                                                        'tag'
                                                    );
                                                }
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                (
                                                    e.currentTarget as HTMLInputElement
                                                ).value = this.cellBackupValue.value;
                                                (
                                                    e.currentTarget as HTMLInputElement
                                                ).blur();
                                            }
                                        }}
                                        onPaste={(e) => void this.handleCellPaste(e, origIndex)}
                                    />
                                    <input
                                        type="text"
                                        className="da-input da-lexicon-cell da-lexicon-cell-cn"
                                        value={item.cn || ''}
                                        placeholder="中文释义"
                                        onFocus={(e) => {
                                            this.cellBackupValue.value = (
                                                e.currentTarget as HTMLInputElement
                                            ).value;
                                        }}
                                        onBlur={(e) => {
                                            void this.handleExistingCnBlur(
                                                item,
                                                (e.currentTarget as HTMLInputElement)
                                                    .value
                                            );
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Tab' && !e.shiftKey) {
                                                e.preventDefault();
                                                if (idx + 1 < visibleEntries.length) {
                                                    this.focusCell(
                                                        `.da-lexicon-grid-row[data-row-index="${idx + 1}"]`,
                                                        'tag'
                                                    );
                                                } else {
                                                    this.focusCell(
                                                        '.da-lexicon-tail-draft-row',
                                                        'tag'
                                                    );
                                                }
                                            } else if (e.key === 'Enter') {
                                                e.preventDefault();
                                                if (idx + 1 < visibleEntries.length) {
                                                    this.focusCell(
                                                        `.da-lexicon-grid-row[data-row-index="${idx + 1}"]`,
                                                        'cn'
                                                    );
                                                } else {
                                                    this.focusCell(
                                                        '.da-lexicon-tail-draft-row',
                                                        'tag'
                                                    );
                                                }
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                (
                                                    e.currentTarget as HTMLInputElement
                                                ).value = this.cellBackupValue.value;
                                                (
                                                    e.currentTarget as HTMLInputElement
                                                ).blur();
                                            }
                                        }}
                                        onPaste={(e) => void this.handleCellPaste(e, origIndex)}
                                    />
                                    <div className="da-lexicon-row-actions">
                                        <button
                                            type="button"
                                            className="da-lexicon-row-del-btn"
                                            title="删除此词条"
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                await this._storage.deleteCustomWord(item.id);
                                                await this.reloadFromStorage();
                                                Toast.show(`已删除词条: ${item.tag}`, { level: 'info' });
                                            }}
                                        >
                                            <svg
                                                width="13"
                                                height="13"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            className="da-lexicon-row-more-btn"
                                            title="更多操作 (复制 / 上下插入行)"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                this.openContextMenu(
                                                    e.clientX,
                                                    e.clientY,
                                                    item,
                                                    origIndex,
                                                    e.currentTarget as HTMLElement
                                                );
                                            }}
                                        >
                                            ⋮
                                        </button>
                                    </div>
                                </div>
                            </>
                        ))}

                        {/* 在列表末尾处展开的插入行 */}
                        {draft &&
                            !visibleEntries.some((entry) => entry.origIndex === draft.index) &&
                            renderInsertedRow()}

                        {/* 搜索无匹配项提示 */}
                        {isSearching && visibleEntries.length === 0 && (
                            <div className="da-empty-hint">
                                未找到匹配的自定义词汇。
                            </div>
                        )}

                        {/* 4. 末端空白追加行 (Tail Blank Row) - 无独立提交按钮 */}
                        {!isSearching && (
                            <div
                                className="da-lexicon-custom-row da-lexicon-grid-row da-lexicon-tail-draft-row"
                                data-row-index={visibleEntries.length}
                            >
                                <input
                                    type="text"
                                    className="da-input da-lexicon-cell da-lexicon-cell-tag da-lexicon-tail-tag"
                                    value={this.tailDraft.value.tag}
                                    placeholder="+ 输入英文 Tag，Enter 保存"
                                    onInput={(e) => {
                                        this.tailDraft.value = {
                                            ...this.tailDraft.value,
                                            tag: (e.currentTarget as HTMLInputElement)
                                                .value,
                                        };
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Tab' && !e.shiftKey) {
                                            e.preventDefault();
                                            this.focusCell(
                                                '.da-lexicon-tail-draft-row',
                                                'cn'
                                            );
                                        } else if (e.key === 'Enter') {
                                            e.preventDefault();
                                            void this.commitTailDraftRow(true);
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            this.tailDraft.value = {
                                                ...this.tailDraft.value,
                                                tag: '',
                                            };
                                        }
                                    }}
                                    onBlur={() => {
                                        void this.commitTailDraftRow(false);
                                    }}
                                    onPaste={(e) =>
                                        void this.handleCellPaste(
                                            e,
                                            allWords.length
                                        )
                                    }
                                />
                                <input
                                    type="text"
                                    className="da-input da-lexicon-cell da-lexicon-cell-cn da-lexicon-tail-cn"
                                    value={this.tailDraft.value.cn}
                                    placeholder="中文释义 (选填)"
                                    onInput={(e) => {
                                        this.tailDraft.value = {
                                            ...this.tailDraft.value,
                                            cn: (e.currentTarget as HTMLInputElement)
                                                .value,
                                        };
                                    }}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === 'Enter' ||
                                            (e.key === 'Tab' && !e.shiftKey)
                                        ) {
                                            e.preventDefault();
                                            void this.commitTailDraftRow(true);
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            this.tailDraft.value = {
                                                ...this.tailDraft.value,
                                                cn: '',
                                            };
                                        }
                                    }}
                                    onBlur={() => {
                                        void this.commitTailDraftRow(false);
                                    }}
                                    onPaste={(e) =>
                                        void this.handleCellPaste(
                                            e,
                                            allWords.length
                                        )
                                    }
                                />
                                <span className="da-lexicon-row-placeholder-handle" />
                            </div>
                        )}
                    </div>
                </div>
            </CardView>
        );
    }

    protected renderContent(): VNode {
        const files = this.filesMeta.value;
        const enabledFilesCount = files.filter((f) => f.enabled).length;
        const enabledFileWordsCount = files
            .filter((f) => f.enabled)
            .reduce((sum, f) => sum + (f.entryCount || 0), 0);
        const customWordsCount = this.customWords.value.length;
        const currentSubTab = this.subTab.value;

        return (
            <div className="da-lexicon-view-container">
                {/* 1. 子页分栏导航栏 */}
                <div className="da-subtab-nav-bar da-lexicon-subtab-bar">
                    <SegmentedControlView
                        size="lg"
                        value={currentSubTab}
                        options={[
                            { label: `词汇文件 (${files.length})`, value: 'files' },
                            { label: `自定义词库 (${customWordsCount})`, value: 'custom' },
                        ]}
                        onChange={(val) => {
                            this.subTab.value = val as LexiconSubTab;
                        }}
                    />
                </div>

                {/* 2. 顶部全景度量与索引就绪状态栏 */}
                <div className="da-lexicon-stat-banner">
                    <div className="da-lexicon-stat-group">
                        <span className="da-lexicon-stat-pill">
                            <span className="da-lexicon-stat-label">词表文件:</span>
                            <strong className="da-lexicon-stat-val">
                                {enabledFilesCount} 启用 / 共 {files.length}
                            </strong>
                        </span>
                        <span className="da-lexicon-stat-pill">
                            <span className="da-lexicon-stat-label">外部词条:</span>
                            <strong className="da-lexicon-stat-val">
                                {enabledFileWordsCount.toLocaleString()}
                            </strong>
                        </span>
                        <span className="da-lexicon-stat-pill">
                            <span className="da-lexicon-stat-label">自定义词条:</span>
                            <strong className="da-lexicon-stat-val">
                                {customWordsCount.toLocaleString()}
                            </strong>
                        </span>
                        <span className="da-lexicon-stat-pill da-lexicon-stat-pill--ready">
                            <span className="da-lexicon-stat-dot" />
                            <span className="da-lexicon-stat-label">本地索引:</span>
                            <strong className="da-lexicon-stat-val">正常</strong>
                        </span>
                    </div>
                    <div className="da-lexicon-stat-actions">
                        <ButtonControl
                            label="重建索引"
                            variant="secondary"
                            size="sm"
                            className="da-lexicon-reindex-btn"
                            tooltip="从本地 IndexedDB 重新读取词库文件与自定义词条并重建检索索引；若标签联想未及时更新可点击刷新。"
                            onClick={async () => {
                                await Promise.all([
                                    this.reloadFromStorage(),
                                    lexiconIndexService.reload(),
                                ]);
                                Toast.show('本地词库索引已刷新', { level: 'success' });
                            }}
                        />
                    </div>
                </div>

                {/* 3. 子页面卡片 */}
                {currentSubTab === 'files' && this.renderFilesSubPanel()}
                {currentSubTab === 'custom' && this.renderCustomWordsSubPanel()}
            </div>
        );
    }
}
