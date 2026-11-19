/**
 * 本地词库内存检索索引与素材宏补全服务 (LexiconIndexService)。
 *
 * @remarks
 * 负责编辑框输入联想的数据检索与宏语法状态校验：
 * 1. 仅索引浏览器 IndexedDB 本地词库（「自定义词汇」+「已启用导入词汇文件」），
 *    独立于「提示词 -> 词汇指导」模块，专用于编辑框输入联想；
 * 2. 监听 `'lexicon:local-updated'` 事件自动增量刷新内存索引；
 * 3. 提供普通 Tag 中英混合检索 (`searchLexicon`) 与 `$` 素材宏及 `$名称-宏-状态$` 两段式补全 (`searchMaterialMacros`)；
 * 4. 提供编辑框内 `$宏$` 语法调用状态的实时诊断 (`inspectPromptMacros`)。
 */

import {
    localLexiconStorage,
    type LocalLexiconStorage,
} from '../store/local-lexicon-storage';
import type { DrawAssistantSettings } from '../store/settings-store';
import {
    searchMaterialMacros,
    inspectPromptMacros,
    type LexiconCandidateItem,
    type LexiconCandidateKind,
    type MacroTokenDiagnostic,
} from './macro-resolver';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';

export type { LexiconCandidateItem, LexiconCandidateKind, MacroTokenDiagnostic };
interface IndexedLexiconWord {
    readonly tag: string;
    readonly lowerTag: string;
    readonly cn: string;
    readonly lowerCn: string;
    readonly lowerAliasesJoined: string;
    readonly source: 'custom' | 'file';
    readonly count: number;
    readonly category?: number;
}

function buildJoinedLowerAliases(aliases: readonly string[]): string {
    if (!aliases || aliases.length === 0) {
        return '';
    }
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const alias of aliases) {
        const normalized = (alias || '').replace(/\0/g, '').trim().toLowerCase();
        if (normalized && !seen.has(normalized)) {
            seen.add(normalized);
            cleaned.push(normalized);
        }
    }
    return cleaned.length > 0 ? `\0${cleaned.join('\0')}\0` : '';
}

function mergeJoinedLowerAliases(
    existingJoined: string,
    extraAliases: readonly string[],
): string {
    if (!extraAliases || extraAliases.length === 0) {
        return existingJoined;
    }
    if (!existingJoined) {
        return buildJoinedLowerAliases(extraAliases);
    }
    const existingParts = existingJoined.slice(1, -1).split('\0').filter(Boolean);
    return buildJoinedLowerAliases([...existingParts, ...extraAliases]);
}

/**
 * 本地词库内存检索索引服务。
 */
export class LexiconIndexService {
    private readonly _storage: LocalLexiconStorage;
    private _words: IndexedLexiconWord[] = [];
    private _loaded = false;
    private _loadPromise: Promise<void> | null = null;
    private _loadSeq = 0;
    private _unlisten: (() => void) | null = null;

    public constructor(storage: LocalLexiconStorage = localLexiconStorage) {
        this._storage = storage;
        this.bind();
    }

    /**
     * 绑定或恢复词库更新事件监听（幂等，用于插件重新激活）。
     */
    public bind(): void {
        if (this._unlisten) {
            return;
        }
        this._unlisten = eventBus.on('lexicon:local-updated', () => {
            void this.reload().catch((err) => {
                logger.warn('[LexiconIndexService] 词库索引刷新失败:', err);
            });
        });
    }

    /**
     * 确保内存索引已从本地存储完成加载（若存在正在进行中的刷新任务，优先等待其完成）。
     */
    public async ensureLoaded(): Promise<void> {
        while (this._loadPromise) {
            await this._loadPromise;
        }
        if (this._loaded) {
            return;
        }
        await this.reload();
    }

    /**
     * 重新从 LocalLexiconStorage 读取「自定义词汇」与「已启用词汇文件」并构建去重索引。
     */
    public async reload(): Promise<void> {
        const seq = ++this._loadSeq;
        const task = (async () => {
            const [customWords, enabledFiles] = await Promise.all([
                this._storage.listCustomWords(),
                this._storage.getEnabledFilesEntries(),
            ]);

            if (seq !== this._loadSeq) {
                return;
            }

            const byLowerTag = new Map<string, IndexedLexiconWord>();

            // 1. 先载入自定义词汇（优先级最高）
            for (const item of customWords) {
                const tag = (item.tag || '').trim();
                if (!tag) continue;
                const lowerTag = tag.toLowerCase();
                const cn = (item.cn || '').trim();
                byLowerTag.set(lowerTag, {
                    tag,
                    lowerTag,
                    cn,
                    lowerCn: cn.toLowerCase(),
                    lowerAliasesJoined: buildJoinedLowerAliases(cn ? [cn] : []),
                    source: 'custom',
                    count: Number.MAX_SAFE_INTEGER,
                });
            }

            // 2. 合并已启用导入词汇文件中的词条
            for (const fileGroup of enabledFiles) {
                for (const entry of fileGroup.entries) {
                    const tag = (entry.tag || '').trim();
                    if (!tag) continue;
                    const lowerTag = tag.toLowerCase();
                    const existing = byLowerTag.get(lowerTag);
                    const cn = (entry.cn || '').trim();
                    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];

                    const entryCount = typeof entry.count === 'number' ? entry.count : 0;

                    if (existing) {
                        // 合并同标签来自词表的别名、缺失释义、分类及较高热度计数
                        const extraAliases = aliases.length > 0 ? aliases : cn ? [cn] : [];
                        const mergedAliasesJoined = mergeJoinedLowerAliases(
                            existing.lowerAliasesJoined,
                            extraAliases,
                        );
                        const nextCn = existing.cn || cn;
                        const nextCategory = existing.category ?? entry.category;
                        const nextCount =
                            existing.source === 'file'
                                ? Math.max(existing.count, entryCount)
                                : existing.count;

                        if (
                            nextCn !== existing.cn ||
                            mergedAliasesJoined !== existing.lowerAliasesJoined ||
                            nextCategory !== existing.category ||
                            nextCount !== existing.count
                        ) {
                            byLowerTag.set(lowerTag, {
                                ...existing,
                                cn: nextCn,
                                lowerCn: nextCn.toLowerCase(),
                                lowerAliasesJoined: mergedAliasesJoined,
                                count: nextCount,
                                category: nextCategory,
                            });
                        }
                        continue;
                    }

                    byLowerTag.set(lowerTag, {
                        tag,
                        lowerTag,
                        cn,
                        lowerCn: cn.toLowerCase(),
                        lowerAliasesJoined: buildJoinedLowerAliases(aliases),
                        source: 'file',
                        count: entryCount,
                        category: entry.category,
                    });
                }
            }

            const words = Array.from(byLowerTag.values());
            // 预排序一次，使后续各命中层级内保持最终优先级，避免搜索热路径重复排序
            words.sort((a, b) => {
                if (a.source !== b.source) {
                    return a.source === 'custom' ? -1 : 1;
                }
                if (b.count !== a.count) {
                    return b.count - a.count;
                }
                return a.tag.localeCompare(b.tag);
            });

            this._words = words;
            this._loaded = true;
        })();

        this._loadPromise = task;
        try {
            await task;
        } finally {
            if (this._loadPromise === task) {
                this._loadPromise = null;
            }
        }
        // 被并发 reload 覆盖的旧调用等待最新一次加载落定后再返回
        while (this._loadPromise && seq !== this._loadSeq) {
            await this._loadPromise;
        }
    }

    /**
     * 获取当前已索引的本地词库总词条数。
     */
    public getIndexedWordCount(): number {
        return this._words.length;
    }

    /**
     * 检索普通本地词库（仅检索自定义词汇与已启用导入文件，不含任何 $ 素材宏）。
     */
    public searchLexicon(query: string, limit = 15): LexiconCandidateItem[] {
        if (!this._loaded && !this._loadPromise) {
            void this.ensureLoaded().catch((err) => {
                logger.warn('[LexiconIndexService] 词库懒加载失败:', err);
            });
        }

        if (limit <= 0) {
            return [];
        }

        const q = (query || '').replace(/\0/g, '').trim().toLowerCase();
        if (!q || q.startsWith('$')) {
            return [];
        }

        // 单字符前缀优先：当输入仅为单字符时，只检索精确与前缀匹配，跳过全局子串遍历以提升交互帧率
        const allowSubstring = q.length >= 2;
        const exactAliasToken = `\0${q}\0`;
        const prefixToken = `\0${q}`;
        const tier5: IndexedLexiconWord[] = [];
        const tier4: IndexedLexiconWord[] = [];
        const tier3: IndexedLexiconWord[] = [];
        const tier2: IndexedLexiconWord[] = [];

        for (const word of this._words) {
            if (word.lowerTag === q || word.lowerCn === q) {
                tier5.push(word);
                if (tier5.length >= limit) {
                    break;
                }
                continue;
            }

            const rem4 = limit - tier5.length;
            if (
                tier4.length < rem4 &&
                word.lowerAliasesJoined !== '' &&
                word.lowerAliasesJoined.includes(exactAliasToken)
            ) {
                tier4.push(word);
                continue;
            }

            const rem3 = rem4 - tier4.length;
            if (tier3.length < rem3) {
                if (
                    word.lowerTag.startsWith(q) ||
                    (word.lowerCn && word.lowerCn.startsWith(q)) ||
                    (word.lowerAliasesJoined !== '' &&
                        word.lowerAliasesJoined.includes(prefixToken))
                ) {
                    tier3.push(word);
                    continue;
                }
            }

            const rem2 = rem3 - tier3.length;
            if (allowSubstring && tier2.length < rem2) {
                if (
                    word.lowerTag.includes(q) ||
                    (word.lowerCn && word.lowerCn.includes(q)) ||
                    (word.lowerAliasesJoined !== '' && word.lowerAliasesJoined.includes(q))
                ) {
                    tier2.push(word);
                }
            }
        }

        const matched =
            tier5.length >= limit
                ? tier5.slice(0, limit)
                : [...tier5, ...tier4, ...tier3, ...tier2].slice(0, limit);

        return matched.map((item) => ({
            kind: item.source === 'custom' ? 'custom-word' : 'file-word',
            insertText: item.tag,
            label: item.tag,
            ...(item.cn ? { subLabel: item.cn } : {}),
            badge: item.source === 'custom' ? '自定义' : '词表',
            ...(item.source === 'file' && item.count > 0 ? { count: item.count } : {}),
            ...(item.category !== undefined ? { category: item.category } : {}),
        }));
    }

    /**
     * 检索 `$` 素材宏及 `$名称-宏-状态$` 候选列表（委托至 macro-resolver 解析）。
     */
    public searchMaterialMacros(
        rawToken: string,
        customSettings?: Partial<DrawAssistantSettings>,
        limit = 15,
    ): LexiconCandidateItem[] {
        return searchMaterialMacros(rawToken, customSettings, limit);
    }

    /**
     * 诊断提示词文本中的所有 `$...$` 宏片段（委托至 macro-resolver 校验）。
     */
    public inspectPromptMacros(
        text: string,
        customSettings?: Partial<DrawAssistantSettings>,
    ): MacroTokenDiagnostic[] {
        return inspectPromptMacros(text, customSettings);
    }

    /**
     * 释放事件监听。
     */
    public dispose(): void {
        if (this._unlisten) {
            this._unlisten();
            this._unlisten = null;
        }
    }
}

/** 全局本地词库与素材宏检索单例 */
export const lexiconIndexService = new LexiconIndexService();
