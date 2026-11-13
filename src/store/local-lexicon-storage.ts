/**
 * 本地词库 IndexedDB 存储服务 (LocalLexiconStorage)。
 *
 * @remarks
 * 基于 `localforage` 独立实例 (`st_draw_assistant_lexicon`) 管理纯本地联想词库：
 * 1. 零内置词条，与 `SettingsStore` 及「提示词 -> 词汇指导」完全解耦，不参与酒馆宿主上下文注入；
 * 2. 导入词汇文件 (`files_meta` + `file_entries_<id>`)：
 *    支持 Tagcomplete CSV (`tag,category,count,"aliases"`)、双列中英 CSV/TSV (`tag,中文`) 与 JSON 词表，
 *    支持多文件共存、按文件独立启停与单文件删除；
 * 3. 自定义词汇 (`custom_words`)：
 *    支持单条增删改、同名 Tag 自动合并更新、多行文本批量粘贴解析及导出；
 * 4. 变更事件：每次修改后通过 `eventBus` 派发 `'lexicon:local-updated'`，驱动联想索引服务增量刷新。
 */

import localforage from 'localforage';
import type { LocalLexiconFileMeta, LocalCustomWordItem } from '@types';
import { eventBus } from '../util/event-bus';

const KEY_FILES_META = 'files_meta';
const KEY_FILE_ENTRIES_PREFIX = 'file_entries_';
const KEY_CUSTOM_WORDS = 'custom_words';

/** 单条解析后的本地词库词条 */
export interface ParsedLocalLexiconEntry {
    /** 标准英文 Tag */
    readonly tag: string;
    /** 中文释义或主要中文别名 */
    readonly cn?: string;
    /** 附加检索别名数组（来自 Tagcomplete 第 4 列或 JSON aliases） */
    readonly aliases?: string[];
    /** Danbooru 分类编号（0=general, 1=artist, 3=copyright, 4=character, 5=meta） */
    readonly category?: number;
    /** 词条使用热度计数（用于联想排序） */
    readonly count?: number;
}

/** 本地词库文件内容解析结果 */
export interface ParsedLexiconFileResult {
    readonly format: 'tagcomplete-csv' | 'bilingual-csv' | 'json';
    readonly entries: ParsedLocalLexiconEntry[];
}

/**
 * 解析单行 CSV，支持双引号包裹字段与转义双引号。
 */
export function splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

/**
 * 判断字符串是否包含中文字符。
 */
function hasChineseChar(text: string): boolean {
    return /[\u4e00-\u9fa5]/.test(text);
}

/**
 * 解析单行自定义词汇文本，支持：
 * - `- cowboy_shot（七分身/美式镜头）` 或 `- 1girl`
 * - `cowboy_shot(七分身)`
 * - `cowboy_shot, 七分身` / `cowboy_shot\t七分身` / `cowboy_shot: 七分身`
 */
export function parseSingleCustomWordLine(
    rawLine: string
): { tag: string; cn?: string } | null {
    let line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) {
        return null;
    }

    // 剥离列表前缀 `- ` 或 `* `
    line = line.replace(/^[-*•]\s+/, '').trim();
    if (!line) {
        return null;
    }

    // 1. 匹配末尾中文全角或半角括号说明：`tag（中文说明）` 或 `tag (中文说明)`
    // 注意区分 Danbooru 版权括号如 `texas_(arknights)`（括号紧跟下划线且不含中文）
    const bracketMatch = line.match(/^(.+?)\s*（([^）]+)）\s*$/) ||
        line.match(/^(.+?)\s+\(([^)]+)\)\s*$/) ||
        line.match(/^([^_()]+)\(([^)]*[\u4e00-\u9fa5][^)]*)\)\s*$/);
    if (bracketMatch) {
        const tag = bracketMatch[1].trim();
        const cn = bracketMatch[2].trim();
        if (tag) {
            return { tag, ...(cn ? { cn } : {}) };
        }
    }

    // 2. 匹配制表符、逗号或中文冒号分隔：`tag\t中文` / `tag, 中文` / `tag：中文`
    const sepMatch = line.match(/^([^,\t，：:]+)[,\t，：:]\s*(.+)$/);
    if (sepMatch) {
        const tag = sepMatch[1].trim();
        const cn = sepMatch[2].trim();
        if (tag) {
            return { tag, ...(cn ? { cn } : {}) };
        }
    }

    return { tag: line };
}

/**
 * 批量解析多行自定义词汇粘贴文本。
 */
export function parseBatchCustomWordsText(
    rawText: string
): Array<{ tag: string; cn?: string }> {
    if (!rawText || !rawText.trim()) {
        return [];
    }

    const lines = rawText.split(/\r?\n/);
    const map = new Map<string, { tag: string; cn?: string }>();

    for (const rawLine of lines) {
        const parsed = parseSingleCustomWordLine(rawLine);
        if (!parsed || !parsed.tag) continue;
        const lowerKey = parsed.tag.toLowerCase();
        const existing = map.get(lowerKey);
        if (!existing || (parsed.cn && !existing.cn)) {
            map.set(lowerKey, parsed);
        } else if (parsed.cn && existing.cn && !existing.cn.includes(parsed.cn)) {
            map.set(lowerKey, {
                tag: existing.tag,
                cn: `${existing.cn} / ${parsed.cn}`,
            });
        }
    }

    return Array.from(map.values());
}

/**
 * 自动识别并解析外部导入的词库文件内容（支持 Tagcomplete CSV、双列 CSV/TSV 与 JSON）。
 */
export function parseLocalLexiconFileContent(
    rawText: string,
    fileName = ''
): ParsedLexiconFileResult {
    const trimmed = (rawText || '').replace(/^\uFEFF/, '').trim();
    if (!trimmed) {
        return { format: 'bilingual-csv', entries: [] };
    }

    const isJsonCandidate =
        fileName.toLowerCase().endsWith('.json') ||
        trimmed.startsWith('[') ||
        trimmed.startsWith('{');

    if (isJsonCandidate) {
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            const entries: ParsedLocalLexiconEntry[] = [];

            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (typeof item === 'string' && item.trim()) {
                        entries.push({ tag: item.trim() });
                    } else if (item && typeof item === 'object') {
                        const obj = item as Record<string, unknown>;
                        const tag = String(obj.tag ?? obj.en ?? obj.name ?? '').trim();
                        if (!tag) continue;
                        const cn = String(
                            obj.cn ?? obj.zh ?? obj.translation ?? obj.desc ?? ''
                        ).trim();
                        const aliases = Array.isArray(obj.aliases)
                            ? obj.aliases.map((a) => String(a).trim()).filter(Boolean)
                            : undefined;
                        const count =
                            typeof obj.count === 'number' && Number.isFinite(obj.count)
                                ? obj.count
                                : undefined;
                        const category =
                            typeof obj.category === 'number' &&
                            Number.isFinite(obj.category)
                                ? obj.category
                                : undefined;
                        entries.push({
                            tag,
                            ...(cn ? { cn } : {}),
                            ...(aliases && aliases.length > 0 ? { aliases } : {}),
                            ...(category !== undefined ? { category } : {}),
                            ...(count !== undefined ? { count } : {}),
                        });
                    }
                }
                return { format: 'json', entries };
            }

            if (parsed && typeof parsed === 'object') {
                for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
                    const tag = k.trim();
                    if (!tag) continue;
                    if (typeof val === 'string') {
                        const cn = val.trim();
                        entries.push({ tag, ...(cn ? { cn } : {}) });
                    } else if (val && typeof val === 'object') {
                        const obj = val as Record<string, unknown>;
                        const cn = String(obj.cn ?? obj.zh ?? obj.translation ?? '').trim();
                        const count =
                            typeof obj.count === 'number' && Number.isFinite(obj.count)
                                ? obj.count
                                : undefined;
                        entries.push({
                            tag,
                            ...(cn ? { cn } : {}),
                            ...(count !== undefined ? { count } : {}),
                        });
                    }
                }
                return { format: 'json', entries };
            }
        } catch {
            // JSON 解析失败时继续尝试按行解析 CSV/TSV
        }
    }

    const lines = trimmed.split(/\r?\n/);
    const entries: ParsedLocalLexiconEntry[] = [];
    let tagcompleteVotes = 0;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) {
            continue;
        }

        // 优先检查制表符 TSV
        if (line.includes('\t') && !line.includes(',')) {
            const parts = line.split('\t').map((s) => s.trim());
            const tag = parts[0];
            const cn = parts.slice(1).filter(Boolean).join(' / ');
            if (tag && tag.toLowerCase() !== 'tag') {
                entries.push({ tag, ...(cn ? { cn } : {}) });
            }
            continue;
        }

        const cols = splitCsvLine(line);
        if (cols.length === 0 || !cols[0]) continue;

        const firstColLower = cols[0].toLowerCase();
        if (
            (firstColLower === 'tag' || firstColLower === 'name') &&
            (cols[1]?.toLowerCase() === 'category' ||
                cols[1]?.toLowerCase() === 'cn' ||
                cols[1]?.toLowerCase() === 'translation')
        ) {
            // 跳过表头行
            continue;
        }

        // 检测 Tagcomplete CSV 结构：col[1] 为分类数字 (0..9)，col[2] 为词频数字
        const catNum = cols.length >= 3 ? Number(cols[1]) : NaN;
        const countNum = cols.length >= 3 ? Number(cols[2]) : NaN;
        if (
            cols.length >= 3 &&
            Number.isInteger(catNum) &&
            catNum >= 0 &&
            catNum <= 15 &&
            Number.isFinite(countNum) &&
            countNum >= 0
        ) {
            tagcompleteVotes++;
            const tag = cols[0];
            const rawAliasField = cols.slice(3).join(',');
            const aliases = rawAliasField
                .split(/[,，|]+/)
                .map((s) => s.trim())
                .filter(Boolean);
            const cnTokens = aliases.filter((a) => hasChineseChar(a));
            const cn =
                cnTokens.length > 0
                    ? cnTokens.slice(0, 4).join(' / ')
                    : aliases[0] || undefined;

            entries.push({
                tag,
                category: catNum,
                count: countNum,
                ...(cn ? { cn } : {}),
                ...(aliases.length > 0 ? { aliases } : {}),
            });
            continue;
        }

        // 双列 CSV 或单行列表格式
        if (cols.length >= 2) {
            const tag = cols[0];
            const cn = cols.slice(1).filter(Boolean).join(' / ');
            entries.push({ tag, ...(cn ? { cn } : {}) });
        } else {
            const single = parseSingleCustomWordLine(line);
            if (single && single.tag) {
                entries.push(single);
            }
        }
    }

    const format: 'tagcomplete-csv' | 'bilingual-csv' =
        tagcompleteVotes > 0 && tagcompleteVotes >= entries.length * 0.3
            ? 'tagcomplete-csv'
            : 'bilingual-csv';

    return { format, entries };
}

/**
 * 本地词库存储管理器。
 */
export class LocalLexiconStorage {
    private readonly _store: LocalForage;
    private readonly _memoryFallback = new Map<string, unknown>();

    public constructor() {
        this._store = localforage.createInstance({
            name: 'st_draw_assistant_lexicon',
            storeName: 'local_lexicon',
            description: 'ST-DrawAssistant 本地联想词库（导入词汇文件与自定义词汇）',
        });
    }

    private async _getItem<T>(key: string): Promise<T | null> {
        try {
            const val = await this._store.getItem<T>(key);
            if (val !== null && val !== undefined) {
                return val;
            }
        } catch {
            // Node / jsdom 无 IndexedDB 驱动时使用内存回退存储
        }
        return this._memoryFallback.has(key)
            ? (structuredClone(this._memoryFallback.get(key)) as T)
            : null;
    }

    private async _setItem<T>(key: string, value: T): Promise<void> {
        try {
            await this._store.setItem(key, value);
        } catch {
            // 非浏览器环境驱动缺失时回退到内存存储
            this._memoryFallback.set(key, structuredClone(value));
        }
    }

    private async _removeItem(key: string): Promise<void> {
        this._memoryFallback.delete(key);
        try {
            await this._store.removeItem(key);
        } catch {
            // 忽略非浏览器环境驱动缺失异常
        }
    }

    // 1. 导入词汇文件管理

    /**
     * 获取所有已导入词汇文件的元数据列表（按导入时间降序）。
     */
    public async listFilesMeta(): Promise<LocalLexiconFileMeta[]> {
        const list = await this._getItem<LocalLexiconFileMeta[]>(KEY_FILES_META);
        if (!Array.isArray(list)) {
            return [];
        }
        return [...list].sort((a, b) => b.importedAt - a.importedAt);
    }

    /**
     * 读取指定导入词汇文件的词条明细。
     */
    public async getFileEntries(fileId: string): Promise<ParsedLocalLexiconEntry[]> {
        if (!fileId) return [];
        const entries = await this._getItem<ParsedLocalLexiconEntry[]>(
            `${KEY_FILE_ENTRIES_PREFIX}${fileId}`
        );
        return Array.isArray(entries) ? entries : [];
    }

    /**
     * 读取全部当前已启用词汇文件的元数据与词条明细。
     */
    public async getEnabledFilesEntries(): Promise<
        Array<{ meta: LocalLexiconFileMeta; entries: ParsedLocalLexiconEntry[] }>
    > {
        const metas = await this.listFilesMeta();
        const enabledMetas = metas.filter((m) => m.enabled);
        const results = await Promise.all(
            enabledMetas.map(async (meta) => ({
                meta,
                entries: await this.getFileEntries(meta.id),
            }))
        );
        return results;
    }

    /**
     * 解析并导入一个外部词汇文件。
     */
    public async importLexiconFile(
        fileName: string,
        rawText: string
    ): Promise<LocalLexiconFileMeta> {
        const parsed = parseLocalLexiconFileContent(rawText, fileName);
        const id = `lex_file_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2, 6)}`;
        const byteSize = new TextEncoder().encode(rawText || '').byteLength;

        const meta: LocalLexiconFileMeta = {
            id,
            fileName: (fileName || '').trim() || '未命名词库文件.csv',
            format: parsed.format,
            entryCount: parsed.entries.length,
            byteSize,
            enabled: true,
            importedAt: Date.now(),
        };

        const currentMetas = await this.listFilesMeta();
        await Promise.all([
            this._setItem(`${KEY_FILE_ENTRIES_PREFIX}${id}`, parsed.entries),
            this._setItem(KEY_FILES_META, [meta, ...currentMetas]),
        ]);

        eventBus.emit('lexicon:local-updated', { reason: 'file-imported' });
        return meta;
    }

    /**
     * 切换某个导入词汇文件的启用状态。
     */
    public async setFileEnabled(fileId: string, enabled: boolean): Promise<boolean> {
        const currentMetas = await this.listFilesMeta();
        let found = false;
        const nextMetas = currentMetas.map((m) => {
            if (m.id === fileId) {
                found = true;
                return { ...m, enabled: Boolean(enabled) };
            }
            return m;
        });

        if (!found) {
            return false;
        }

        await this._setItem(KEY_FILES_META, nextMetas);
        eventBus.emit('lexicon:local-updated', { reason: 'file-toggled' });
        return true;
    }

    /**
     * 删除指定的导入词汇文件及其词条数据。
     */
    public async deleteFile(fileId: string): Promise<boolean> {
        const currentMetas = await this.listFilesMeta();
        const nextMetas = currentMetas.filter((m) => m.id !== fileId);
        if (nextMetas.length === currentMetas.length) {
            return false;
        }

        await Promise.all([
            this._removeItem(`${KEY_FILE_ENTRIES_PREFIX}${fileId}`),
            this._setItem(KEY_FILES_META, nextMetas),
        ]);
        eventBus.emit('lexicon:local-updated', { reason: 'file-deleted' });
        return true;
    }

    /**
     * 清空所有已导入的词汇文件。
     */
    public async clearAllFiles(): Promise<void> {
        const currentMetas = await this.listFilesMeta();
        await Promise.all([
            ...currentMetas.map((m) =>
                this._removeItem(`${KEY_FILE_ENTRIES_PREFIX}${m.id}`)
            ),
            this._setItem(KEY_FILES_META, []),
        ]);
        eventBus.emit('lexicon:local-updated', { reason: 'files-cleared' });
    }

    // 2. 自定义词汇管理

    /**
     * 获取全部自定义词汇列表（保持用户编排与插入顺序）。
     */
    public async listCustomWords(): Promise<LocalCustomWordItem[]> {
        const list = await this._getItem<LocalCustomWordItem[]>(KEY_CUSTOM_WORDS);
        if (!Array.isArray(list)) {
            return [];
        }
        return [...list];
    }

    /**
     * 新增或更新单条自定义词汇（若未传 id 但存在同名英文 tag，自动覆盖更新该条记录）。
     *
     * @param input.index 可选插入位置索引；未指定时默认追加到末尾
     */
    public async upsertCustomWord(input: {
        id?: string;
        tag: string;
        cn?: string;
        index?: number;
    }): Promise<LocalCustomWordItem> {
        const trimmedTag = (input.tag || '').trim();
        if (!trimmedTag) {
            throw new Error('自定义词汇的英文 Tag 不能为空');
        }
        const trimmedCn = (input.cn || '').trim();
        const current = await this.listCustomWords();
        const now = Date.now();

        const targetIdx = current.findIndex(
            (item) =>
                (input.id && item.id === input.id) ||
                item.tag.toLowerCase() === trimmedTag.toLowerCase()
        );

        let savedItem: LocalCustomWordItem;
        let nextList: LocalCustomWordItem[];

        if (targetIdx >= 0) {
            savedItem = {
                ...current[targetIdx],
                tag: trimmedTag,
                ...(trimmedCn ? { cn: trimmedCn } : { cn: undefined }),
                updatedAt: now,
            };
            nextList = current.map((item, idx) =>
                idx === targetIdx ? savedItem : item
            );
        } else {
            savedItem = {
                id:
                    input.id ||
                    `cw_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                tag: trimmedTag,
                ...(trimmedCn ? { cn: trimmedCn } : {}),
                updatedAt: now,
            };
            if (
                typeof input.index === 'number' &&
                input.index >= 0 &&
                input.index <= current.length
            ) {
                nextList = [...current];
                nextList.splice(input.index, 0, savedItem);
            } else {
                nextList = [...current, savedItem];
            }
        }

        await this._setItem(KEY_CUSTOM_WORDS, nextList);
        eventBus.emit('lexicon:local-updated', { reason: 'custom-updated' });
        return savedItem;
    }

    /**
     * 在指定位置插入自定义词汇。
     */
    public async insertCustomWordAt(
        index: number,
        word: { tag: string; cn?: string }
    ): Promise<LocalCustomWordItem> {
        return this.upsertCustomWord({ ...word, index });
    }

    /**
     * 批量解析多行文本并合并写入自定义词汇表。
     *
     * @param rawText 待解析的多行自定义词汇文本
     * @param options 可选参数：overwriteConflicts 为 false 时保留已有词条的释义，不使用导入的新释义覆盖
     */
    public async batchImportCustomWords(
        rawText: string,
        options?: { overwriteConflicts?: boolean }
    ): Promise<{ added: number; updated: number; total: number }> {
        const parsedItems = parseBatchCustomWordsText(rawText);
        if (parsedItems.length === 0) {
            const existing = await this.listCustomWords();
            return { added: 0, updated: 0, total: existing.length };
        }

        const current = await this.listCustomWords();
        const currentOrderKeys: string[] = [];
        const byLowerTag = new Map<string, LocalCustomWordItem>();
        for (const item of current) {
            const key = item.tag.toLowerCase();
            currentOrderKeys.push(key);
            byLowerTag.set(key, item);
        }

        let added = 0;
        let updated = 0;
        const now = Date.now();
        const overwriteConflicts = options?.overwriteConflicts ?? true;
        const newlyAddedKeys: string[] = [];

        parsedItems.forEach((p, idx) => {
            const lower = p.tag.toLowerCase();
            const existing = byLowerTag.get(lower);
            if (existing) {
                const nextCn = existing.cn && !overwriteConflicts ? existing.cn : (p.cn ?? existing.cn);
                byLowerTag.set(lower, {
                    ...existing,
                    tag: p.tag,
                    cn: nextCn,
                    updatedAt: now + idx,
                });
                updated++;
            } else {
                byLowerTag.set(lower, {
                    id: `cw_${now.toString(36)}_${idx}_${Math.random()
                        .toString(36)
                        .slice(2, 5)}`,
                    tag: p.tag,
                    ...(p.cn ? { cn: p.cn } : {}),
                    updatedAt: now + idx,
                });
                newlyAddedKeys.push(lower);
                added++;
            }
        });

        const nextList: LocalCustomWordItem[] = [];
        for (const key of currentOrderKeys) {
            const item = byLowerTag.get(key);
            if (item) nextList.push(item);
        }
        for (const key of newlyAddedKeys) {
            const item = byLowerTag.get(key);
            if (item) nextList.push(item);
        }
        await this._setItem(KEY_CUSTOM_WORDS, nextList);
        eventBus.emit('lexicon:local-updated', { reason: 'custom-updated' });
        return { added, updated, total: nextList.length };
    }

    /**
     * 删除单条自定义词汇。
     */
    public async deleteCustomWord(id: string): Promise<boolean> {
        const current = await this.listCustomWords();
        const nextList = current.filter((item) => item.id !== id);
        if (nextList.length === current.length) {
            return false;
        }
        await this._setItem(KEY_CUSTOM_WORDS, nextList);
        eventBus.emit('lexicon:local-updated', { reason: 'custom-updated' });
        return true;
    }

    /**
     * 清空全部自定义词汇。
     */
    public async clearCustomWords(): Promise<void> {
        await this._setItem(KEY_CUSTOM_WORDS, []);
        eventBus.emit('lexicon:local-updated', { reason: 'custom-updated' });
    }

    /**
     * 将自定义词汇导出为 JSON 文本。
     */
    public async exportCustomWordsAsJson(): Promise<string> {
        const list = await this.listCustomWords();
        const simplified = list.map((item) => ({
            tag: item.tag,
            ...(item.cn ? { cn: item.cn } : {}),
        }));
        return JSON.stringify(simplified, null, 2);
    }

    /**
     * 将自定义词汇导出为双列 CSV 文本。
     */
    public async exportCustomWordsAsCsv(): Promise<string> {
        const list = await this.listCustomWords();
        return list
            .map((item) => {
                const safeCn = item.cn ? item.cn.replace(/"/g, '""') : '';
                return safeCn.includes(',')
                    ? `${item.tag},"${safeCn}"`
                    : safeCn
                      ? `${item.tag},${safeCn}`
                      : item.tag;
            })
            .join('\n');
    }

    /**
     * 清空整个本地词库（供测试重置使用）。
     */
    public async clearAll(): Promise<void> {
        const metas = await this.listFilesMeta();
        for (const m of metas) {
            await this._removeItem(`${KEY_FILE_ENTRIES_PREFIX}${m.id}`);
        }
        await this._removeItem(KEY_FILES_META);
        await this._removeItem(KEY_CUSTOM_WORDS);
        this._memoryFallback.clear();
        try {
            await this._store.clear();
        } catch {
            // 忽略非浏览器环境异常
        }
        eventBus.emit('lexicon:local-updated', { reason: 'all-cleared' });
    }
}

/** 全局本地词库存储单例 */
export const localLexiconStorage = new LocalLexiconStorage();
