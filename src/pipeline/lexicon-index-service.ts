/**
 * 本地词库内存检索索引与素材宏补全服务 (LexiconIndexService)。
 *
 * @remarks
 * 负责编辑框输入联想的数据检索与宏语法状态校验：
 * 1. 仅索引浏览器 IndexedDB 本地词库（「自定义词汇」+「已启用导入词汇文件」），
 *    与「提示词 -> 词汇指导」完全解耦，避免提示词通道注入与编辑框输入联想相互耦合；
 * 2. 监听 `'lexicon:local-updated'` 事件自动增量刷新内存索引；
 * 3. 提供普通 Tag 中英混合检索 (`searchLexicon`) 与 `$` 素材宏及 `-宏规则/-部位` 链式补全 (`searchMaterialMacros`)；
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

export type { LexiconCandidateItem, LexiconCandidateKind, MacroTokenDiagnostic };
interface IndexedLexiconWord {
    readonly tag: string;
    readonly lowerTag: string;
    readonly cn: string;
    readonly lowerCn: string;
    readonly aliases: string[];
    readonly lowerAliases: string[];
    readonly source: 'custom' | 'file';
    readonly count: number;
    readonly category?: number;
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
            void this.reload();
        });
    }

    /**
     * 确保内存索引已从本地存储完成首次加载。
     */
    public async ensureLoaded(): Promise<void> {
        if (this._loaded) {
            return;
        }
        if (this._loadPromise) {
            return this._loadPromise;
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
                    aliases: cn ? [cn] : [],
                    lowerAliases: cn ? [cn.toLowerCase()] : [],
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

                    if (existing) {
                        // 若已存在同名自定义词汇，仅补全缺失的中文释义与分类信息
                        if (!existing.cn && cn) {
                            byLowerTag.set(lowerTag, {
                                ...existing,
                                cn,
                                lowerCn: cn.toLowerCase(),
                                aliases: aliases.length > 0 ? aliases : [cn],
                                lowerAliases: (aliases.length > 0 ? aliases : [cn]).map((a) =>
                                    a.toLowerCase(),
                                ),
                                category: entry.category ?? existing.category,
                            });
                        }
                        continue;
                    }

                    byLowerTag.set(lowerTag, {
                        tag,
                        lowerTag,
                        cn,
                        lowerCn: cn.toLowerCase(),
                        aliases,
                        lowerAliases: aliases.map((a) => a.toLowerCase()),
                        source: 'file',
                        count: typeof entry.count === 'number' ? entry.count : 0,
                        category: entry.category,
                    });
                }
            }

            this._words = Array.from(byLowerTag.values());
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
            void this.ensureLoaded();
        }

        const q = (query || '').trim().toLowerCase();
        if (!q || q.startsWith('$')) {
            return [];
        }

        // 单字符前缀优先：当输入仅为单字符时，只检索精确与前缀匹配，跳过全局子串遍历以提升交互帧率
        const allowSubstring = q.length >= 2;
        const scored: Array<{ item: IndexedLexiconWord; tier: number }> = [];

        for (const word of this._words) {
            let tier = 0;

            if (word.lowerTag === q || word.lowerCn === q) {
                tier = 4;
            } else if (
                word.lowerTag.startsWith(q) ||
                (word.lowerCn && word.lowerCn.startsWith(q)) ||
                word.lowerAliases.some((a) => a.startsWith(q))
            ) {
                tier = 3;
            } else if (
                allowSubstring &&
                (word.lowerTag.includes(q) ||
                    (word.lowerCn && word.lowerCn.includes(q)) ||
                    word.lowerAliases.some((a) => a.includes(q)))
            ) {
                tier = 2;
            }

            if (tier > 0) {
                scored.push({ item: word, tier });
            }
        }

        scored.sort((a, b) => {
            if (b.tier !== a.tier) {
                return b.tier - a.tier;
            }
            if (a.item.source !== b.item.source) {
                return a.item.source === 'custom' ? -1 : 1;
            }
            if (b.item.count !== a.item.count) {
                return b.item.count - a.item.count;
            }
            return a.item.tag.localeCompare(b.item.tag);
        });

        return scored.slice(0, limit).map(({ item }) => ({
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
     * 检索 `$` 素材宏及 `-宏规则/-部位` 候选列表（委托至 macro-resolver 解析）。
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
