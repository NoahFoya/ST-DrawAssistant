/**
 * 通用提示词条目管理器复合控件 (PromptEntriesManager)。
 *
 * @remarks
 * 负责各提示词通道条目的增删改查、排序与展开编辑：
 * 1. 预设管理：卡片顶部挂载预设工具栏；
 * 2. 工作台容器：嵌入具备深色微内凹的独立工作区，提供无分页纵向列表；
 * 3. 紧凑工具栏：单一展开/折叠切换、单一全开/全关切换、按注入时序重排、搜索与类型筛选；
 * 4. 水平条目行：左侧展开箭头与启停微胶囊、标题备注、纯图标触发策略、插入位置下拉、深度 @D、顺序 Order 与右侧复制删除操作；
 * 5. 精简抽屉：第一排关键字与匹配逻辑；第二排正文文本域（支持联想补全与 Token 统计）。
 */

import { type VNode } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import type {
    PromptInjectionEntry,
    PromptChannelId,
    ActivationTriggerMode,
} from '@types';
import { bindDelegatedTagAutocomplete } from './tag-autocomplete';
import { ICONS } from '../components/icons';
import { SelectControl } from '../framework/controls';

export interface WiPositionOption {
    readonly value: number;
    readonly label: string;
    readonly isDepthEnabled: boolean;
    readonly position: 0 | 1 | 2;
    readonly role: 0 | 1 | 2;
}

/** 酒馆世界书原生 10 项插入位置枚举定义 (完全对齐原生文案与图标) */
export const WI_POSITION_OPTIONS: readonly WiPositionOption[] = [
    { value: 0, label: '角色定义前（↑ Char）', isDepthEnabled: false, position: 2, role: 0 },
    { value: 1, label: '角色定义后（↓ Char）', isDepthEnabled: false, position: 0, role: 0 },
    { value: 5, label: '示例消息前（↑ EM）', isDepthEnabled: false, position: 2, role: 0 },
    { value: 6, label: '示例消息后（↓ EM）', isDepthEnabled: false, position: 0, role: 0 },
    { value: 2, label: '作者注释前（↑ AN）', isDepthEnabled: false, position: 2, role: 0 },
    { value: 3, label: '作者注释后（↓ AN）', isDepthEnabled: false, position: 0, role: 0 },
    { value: 40, label: '[系统⚙] 插入深度 @D', isDepthEnabled: true, position: 1, role: 0 },
    { value: 41, label: '[用户👤] 插入深度 @D', isDepthEnabled: true, position: 1, role: 1 },
    { value: 42, label: '[AI🤖] 插入深度 @D', isDepthEnabled: true, position: 1, role: 2 },
    { value: 7, label: '➡ 锚点', isDepthEnabled: false, position: 0, role: 0 },
];

/** 从当前条目的 position 与 role 推断其对应的世界书位置项 */
export function resolveWiPositionValue(entry: PromptInjectionEntry): number {
    const rawWi = entry.wiPosition;
    if (typeof rawWi === 'number') {
        if (rawWi === 4) {
            return entry.role === 1 ? 41 : entry.role === 2 ? 42 : 40;
        }
        return rawWi;
    }
    if (entry.position === 1) {
        return entry.role === 1 ? 41 : entry.role === 2 ? 42 : 40;
    }
    if (entry.position === 2) {
        return 0; // 角色定义前
    }
    return 1; // 角色定义后
}

export interface PromptEntriesManagerProps {
    readonly entries: PromptInjectionEntry[];
    readonly onChange: (nextEntries: PromptInjectionEntry[]) => void;
    readonly channelId: PromptChannelId;
}

/**
 * 按真实生成上下文注入时序比对两条提示词条目：
 * 角色定义前 (pos 2, Order 升序) -> 角色定义后 (pos 0, Order 升序) -> 深度插入 @D (pos 1, Depth 降序，同 Depth 按 Order 升序)。
 * 排序结果中，越靠后的条目在实际组装上下文时越贴近最新一条聊天消息。
 */
export function comparePromptEntriesByInjectionSequence(
    a: PromptInjectionEntry,
    b: PromptInjectionEntry
): number {
    const posA = a.position === 0 || a.position === 1 || a.position === 2 ? a.position : 1;
    const posB = b.position === 0 || b.position === 1 || b.position === 2 ? b.position : 1;
    const rankA = posA === 2 ? 0 : posA === 0 ? 1 : 2;
    const rankB = posB === 2 ? 0 : posB === 0 ? 1 : 2;
    if (rankA !== rankB) {
        return rankA - rankB;
    }
    if (posA === 1) {
        const depthA = typeof a.depth === 'number' ? a.depth : 0;
        const depthB = typeof b.depth === 'number' ? b.depth : 0;
        if (depthA !== depthB) {
            return depthB - depthA;
        }
    }
    const orderA = typeof a.order === 'number' ? a.order : 100;
    const orderB = typeof b.order === 'number' ? b.order : 100;
    if (orderA !== orderB) {
        return orderA - orderB;
    }
    return a.id.localeCompare(b.id);
}

export function PromptEntriesManager(props: PromptEntriesManagerProps): VNode {
    const {
        entries,
        onChange,
        channelId,
    } = props;

    // 1. 交互状态
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [filterMode, setFilterMode] = useState<'all' | 'always' | 'keyword' | 'enabled' | 'disabled'>('all');

    const containerRef = useRef<HTMLDivElement | null>(null);

    // 自动接入输入联想委托绑定
    useEffect(() => {
        if (!containerRef.current) return;
        const handle = bindDelegatedTagAutocomplete(
            containerRef.current,
            '.da-wi-textarea',
            { mode: 'prompt-with-macro' }
        );
        return () => handle.dispose();
    }, []);

    // 2. 过滤与时序排序（默认按注入上下文时序由早至晚排序，越靠下越贴近最新消息）
    const query = searchQuery.trim().toLowerCase();
    const hasFilter = Boolean(query || filterMode !== 'all');
    const filteredEntries = entries
        .filter((e) => {
            if (filterMode === 'always' && e.triggerMode !== 'always') return false;
            if (filterMode === 'keyword' && e.triggerMode !== 'keyword') return false;
            if (filterMode === 'enabled' && !e.enabled) return false;
            if (filterMode === 'disabled' && e.enabled) return false;
            if (!query) return true;
            return (
                e.name.toLowerCase().includes(query) ||
                (e.keywords || '').toLowerCase().includes(query) ||
                (e.secondaryKeywords || '').toLowerCase().includes(query) ||
                (e.content || '').toLowerCase().includes(query)
            );
        })
        .sort(comparePromptEntriesByInjectionSequence);

    // 批量操作作用域：存在筛选或搜索时仅作用于可见条目；无筛选时作用于全局
    const targetScopeEntries = hasFilter ? filteredEntries : entries;

    // 3. 展开收起与批量状态切换
    const toggleExpand = (id: string) => {
        const next = new Set(expandedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setExpandedIds(next);
    };

    const isAllExpanded =
        targetScopeEntries.length > 0 &&
        targetScopeEntries.every((e) => expandedIds.has(e.id));
    const toggleAllExpand = () => {
        const next = new Set(expandedIds);
        if (isAllExpanded) {
            targetScopeEntries.forEach((e) => next.delete(e.id));
        } else {
            targetScopeEntries.forEach((e) => next.add(e.id));
        }
        setExpandedIds(next);
    };

    const isAllEnabled =
        targetScopeEntries.length > 0 &&
        targetScopeEntries.every((e) => e.enabled);
    const toggleAllEnabled = () => {
        const nextTargetState = !isAllEnabled;
        const targetIds = new Set(targetScopeEntries.map((e) => e.id));
        const next = entries.map((e) =>
            targetIds.has(e.id) ? { ...e, enabled: nextTargetState } : e
        );
        onChange(next);
    };

    // 4. 基础条目增删改
    const handlePatchEntry = (
        id: string,
        patch: Partial<PromptInjectionEntry> & { wiPosition?: number }
    ) => {
        const next = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
        onChange(next);
    };

    const handleAddEntry = () => {
        const id = 'entry_' + Math.random().toString(36).slice(2, 9);
        const defaultDepth = channelId === 'vocab' ? 7 : 0;
        const defaultOrder = (entries.length + 1) * 10;
        const newEntry: PromptInjectionEntry = {
            id,
            name: `提示词条目 #${entries.length + 1}`,
            enabled: true,
            triggerMode: 'always',
            keywords: '',
            secondaryKeywords: '',
            logicType: 'and_any',
            caseSensitive: false,
            scanDepth: 5,
            position: 1,
            depth: defaultDepth,
            role: 0,
            order: defaultOrder,
            skipWhenEmpty: false,
            content: '',
        };
        const next = [...entries, newEntry];
        onChange(next);
        const nextExpanded = new Set(expandedIds);
        nextExpanded.add(id);
        setExpandedIds(nextExpanded);
    };

    const handleCloneEntry = (entry: PromptInjectionEntry) => {
        const newId = 'entry_' + Math.random().toString(36).slice(2, 9);
        const cloned: PromptInjectionEntry = {
            ...entry,
            id: newId,
            name: `${entry.name} (副本)`,
            order: entry.order + 1,
        };
        const idx = entries.findIndex((e) => e.id === entry.id);
        const next = [...entries];
        next.splice(idx + 1, 0, cloned);
        onChange(next);
        const nextExpanded = new Set(expandedIds);
        nextExpanded.add(newId);
        setExpandedIds(nextExpanded);
    };

    const handleDeleteEntry = (id: string) => {
        const next = entries.filter((e) => e.id !== id);
        onChange(next);
        if (expandedIds.has(id)) {
            const nextExpanded = new Set(expandedIds);
            nextExpanded.delete(id);
            setExpandedIds(nextExpanded);
        }
    };

    return (
        <div className="da-prompt-entries-manager" ref={containerRef}>
            {/* 内部容器内胆：包裹条目工具栏与条目列表，形成清晰工作台层级 */}
            <div className="da-prompt-entries-inner-container">
                {/* 2.1 左右开阔分布的条目工具栏 */}
                <div className="da-wi-toolbar">
                    <div className="da-wi-toolbar__left">
                        <button
                            type="button"
                            className="da-btn da-btn--primary da-btn--sm da-wi-btn--add"
                            title="新增提示词条目"
                            onClick={handleAddEntry}
                        >
                            <span
                                className="da-wi-btn__icon"
                                dangerouslySetInnerHTML={{ __html: ICONS.plus }}
                            />
                            <span>新建条目</span>
                        </button>
                        <button
                            type="button"
                            className="da-btn da-btn--secondary da-btn--sm da-wi-btn--icon"
                            title="展开/收起全部条目"
                            onClick={toggleAllExpand}
                        >
                            <span dangerouslySetInnerHTML={{ __html: ICONS.chevronsUpDown }} />
                        </button>
                        <button
                            type="button"
                            className="da-btn da-btn--secondary da-btn--sm da-wi-btn--icon"
                            title="全部开启/全部关闭条目"
                            onClick={toggleAllEnabled}
                        >
                            <span dangerouslySetInnerHTML={{ __html: ICONS.toggleRight }} />
                        </button>
                    </div>

                    <div className="da-wi-toolbar__right">
                        <div className="da-wi-search-wrapper">
                            <span
                                className="da-wi-search-icon"
                                dangerouslySetInnerHTML={{ __html: ICONS.search }}
                            />
                            <input
                                type="text"
                                className="da-wi-search-input"
                                placeholder="搜索标题、关键词或正文..."
                                value={searchQuery}
                                onInput={(e) =>
                                    setSearchQuery((e.currentTarget as HTMLInputElement).value)
                                }
                            />
                        </div>
                        <SelectControl
                            className="da-wi-filter-select"
                            value={filterMode}
                            onChange={(val) =>
                                setFilterMode(val as typeof filterMode)
                            }
                            options={[
                                { value: 'all', label: '全部类型' },
                                { value: 'always', label: '常驻注入' },
                                { value: 'keyword', label: '条件触发' },
                                { value: 'enabled', label: '仅已启用' },
                                { value: 'disabled', label: '仅已停用' },
                            ]}
                        />
                    </div>
                </div>

                {/* 2.2 表头列标 */}
                <div className="da-wi-header-labels">
                    <span className="da-wi-col-expand-toggle" />
                    <span className="da-wi-col-title">条目标题 / 备注</span>
                    <span className="da-wi-col-trigger">触发策略</span>
                    <span className="da-wi-col-pos">插入位置</span>
                    <span className="da-wi-col-depth">深度</span>
                    <span className="da-wi-col-order">顺序</span>
                    <span className="da-wi-col-actions">操作</span>
                </div>

                {/* 2.3 条目列表与抽屉 */}
                {filteredEntries.length === 0 ? (
                    <div className="da-wi-empty">
                        {searchQuery
                            ? '未找到符合条件的提示词条目'
                            : '当前预设暂无条目，请点击上方「新建条目」添加'}
                    </div>
                ) : (
                    <div className="da-wi-rows-container">
                        {filteredEntries.map((entry) => {
                            const isExpanded = expandedIds.has(entry.id);
                            const wiPosVal = resolveWiPositionValue(entry);
                            const matchedWiOpt = WI_POSITION_OPTIONS.find((o) => o.value === wiPosVal);
                            const isDepthActive = matchedWiOpt?.isDepthEnabled ?? entry.position === 1;

                            return (
                                <div
                                    key={entry.id}
                                    className={`da-wi-entry-wrapper ${isExpanded ? 'is-expanded' : ''} ${
                                        entry.enabled ? 'is-enabled' : 'is-disabled'
                                    }`}
                                >
                                    {/* 水平主行 */}
                                    <div className="da-wi-row">
                                        {/* 展开/收起矢量 ChevronDown 箭头 */}
                                        <button
                                            type="button"
                                            className={`da-wi-toggle-arrow ${isExpanded ? 'is-open' : ''}`}
                                            title={isExpanded ? '收起抽屉' : '展开抽屉编辑提示词'}
                                            onClick={() => toggleExpand(entry.id)}
                                        >
                                            <span dangerouslySetInnerHTML={{ __html: ICONS.chevronDown }} />
                                        </button>

                                        {/* 启停状态胶囊 */}
                                        <button
                                            type="button"
                                            className={`da-wi-enable-pill ${entry.enabled ? 'is-active' : ''}`}
                                            title={entry.enabled ? '点击禁用' : '点击启用'}
                                            onClick={() =>
                                                handlePatchEntry(entry.id, {
                                                    enabled: !entry.enabled,
                                                })
                                            }
                                        >
                                            <span className="da-wi-pill-dot" />
                                        </button>

                                        {/* 标题备注输入框 */}
                                        <input
                                            type="text"
                                            className="da-wi-title-input"
                                            placeholder="条目标题或备注..."
                                            value={entry.name}
                                            onInput={(e) =>
                                                handlePatchEntry(entry.id, {
                                                    name: (e.currentTarget as HTMLInputElement).value,
                                                })
                                            }
                                        />

                                        {/* 触发策略纯图标圆点下拉 */}
                                        <div className="da-wi-trigger-cell">
                                            <select
                                                className={`da-wi-trigger-icon-select ${
                                                    entry.triggerMode === 'always'
                                                        ? 'mode--always'
                                                        : 'mode--keyword'
                                                }`}
                                                title={
                                                    entry.triggerMode === 'always'
                                                        ? '常驻注入 (每轮生效)'
                                                        : '条件触发 (关键词命中时生效)'
                                                }
                                                value={entry.triggerMode}
                                                onChange={(e) =>
                                                    handlePatchEntry(entry.id, {
                                                        triggerMode: (e.currentTarget as HTMLSelectElement)
                                                            .value as ActivationTriggerMode,
                                                    })
                                                }
                                            >
                                                <option value="always">常驻</option>
                                                <option value="keyword">条件</option>
                                            </select>
                                        </div>

                                        {/* 10 选项插入位置下拉 */}
                                        <SelectControl
                                            className="da-wi-pos-select"
                                            value={String(wiPosVal)}
                                            onChange={(valStr) => {
                                                const nextVal = Number(valStr);
                                                const opt = WI_POSITION_OPTIONS.find(
                                                    (o) => o.value === nextVal
                                                );
                                                if (!opt) return;
                                                const patch: Partial<PromptInjectionEntry> & {
                                                    wiPosition?: number;
                                                } = {
                                                    position: opt.position,
                                                    role: opt.role,
                                                    wiPosition:
                                                        opt.value === 40 ||
                                                        opt.value === 41 ||
                                                        opt.value === 42
                                                            ? 4
                                                            : opt.value,
                                                };
                                                if (!opt.isDepthEnabled) {
                                                    patch.depth = 0;
                                                } else if (
                                                    typeof entry.depth !== 'number' ||
                                                    entry.depth === 0
                                                ) {
                                                    patch.depth = channelId === 'vocab' ? 7 : 0;
                                                }
                                                handlePatchEntry(entry.id, patch);
                                            }}
                                            options={WI_POSITION_OPTIONS.map((opt) => ({
                                                value: String(opt.value),
                                                label: opt.label,
                                            }))}
                                        />

                                        {/* 深度输入框 (联动置灰) */}
                                        <input
                                            type="number"
                                            className={`da-wi-num-input ${!isDepthActive ? 'is-disabled' : ''}`}
                                            min={0}
                                            max={9999}
                                            disabled={!isDepthActive}
                                            value={isDepthActive ? entry.depth ?? 0 : 0}
                                            title={
                                                isDepthActive
                                                    ? '聊天上下文插入深度 @D'
                                                    : '仅在插入深度 @D 模式下可用'
                                            }
                                            onInput={(e) => {
                                                const val = Math.max(
                                                    0,
                                                    Math.floor(
                                                        Number(
                                                            (e.currentTarget as HTMLInputElement).value
                                                        )
                                                    )
                                                );
                                                handlePatchEntry(entry.id, { depth: val });
                                            }}
                                        />

                                        {/* 顺序输入框 */}
                                        <input
                                            type="number"
                                            className="da-wi-num-input"
                                            min={0}
                                            max={9999}
                                            value={entry.order ?? 100}
                                            title="同位置/深度排序权重 Order（数值越小越靠前）"
                                            onInput={(e) => {
                                                const val = Math.floor(
                                                    Number(
                                                        (e.currentTarget as HTMLInputElement).value
                                                    )
                                                );
                                                handlePatchEntry(entry.id, { order: val });
                                            }}
                                        />

                                        {/* 行操作按钮 (矢量 SVG 图标) */}
                                        <div className="da-wi-row-actions">
                                            <button
                                                type="button"
                                                className="da-wi-icon-btn"
                                                title="复制此条目"
                                                onClick={() => handleCloneEntry(entry)}
                                                dangerouslySetInnerHTML={{ __html: ICONS.copy }}
                                            />
                                            <button
                                                type="button"
                                                className="da-wi-icon-btn da-wi-icon-btn--danger"
                                                title="删除此条目"
                                                onClick={() => handleDeleteEntry(entry.id)}
                                                dangerouslySetInnerHTML={{ __html: ICONS.trash }}
                                            />
                                        </div>
                                    </div>

                                    {/* 展开抽屉：仅保留第一排关键字行与第二排正文文本域 */}
                                    {isExpanded && (
                                        <div className="da-wi-drawer">
                                            {/* 第一排：主关键词 + 匹配逻辑 + 次要关键词 (过滤) */}
                                            <div className="da-wi-drawer__row da-wi-drawer__keywords-block">
                                                <div className="da-wi-field da-wi-field--main-kw">
                                                    <label className="da-wi-label">主关键词</label>
                                                    <input
                                                        type="text"
                                                        className="da-wi-drawer-input"
                                                        placeholder="关键词或正则表达式"
                                                        value={entry.keywords || ''}
                                                        onInput={(e) =>
                                                            handlePatchEntry(entry.id, {
                                                                keywords: (
                                                                    e.currentTarget as HTMLInputElement
                                                                ).value,
                                                            })
                                                        }
                                                    />
                                                </div>

                                                <div className="da-wi-field da-wi-field--logic">
                                                    <label className="da-wi-label">匹配逻辑</label>
                                                    <SelectControl
                                                        className="da-wi-drawer-select"
                                                        value={entry.logicType || 'and_any'}
                                                        onChange={(val) =>
                                                            handlePatchEntry(entry.id, {
                                                                logicType: val as PromptInjectionEntry['logicType'],
                                                            })
                                                        }
                                                        options={[
                                                            { value: 'and_any', label: '满足任意 (包含任一)' },
                                                            { value: 'and_all', label: '全部满足 (包含所有)' },
                                                            { value: 'not_any', label: '排除任意 (出现则排除)' },
                                                        ]}
                                                    />
                                                </div>

                                                <div className="da-wi-field da-wi-field--filter-kw">
                                                    <label className="da-wi-label">次要关键词 (过滤)</label>
                                                    <input
                                                        type="text"
                                                        className="da-wi-drawer-input"
                                                        placeholder="次要关键词或正则表达式（留空则不限制）"
                                                        value={entry.secondaryKeywords || ''}
                                                        onInput={(e) =>
                                                            handlePatchEntry(entry.id, {
                                                                secondaryKeywords: (
                                                                    e.currentTarget as HTMLInputElement
                                                                ).value,
                                                            })
                                                        }
                                                    />
                                                </div>
                                            </div>

                                            {/* 第二排：正文编辑区 + Token 与字符数实时统计 */}
                                            <div className="da-wi-drawer__textarea-wrapper">
                                                <div className="da-wi-drawer__textarea-header">
                                                    <span className="da-wi-content-title">提示词内容</span>
                                                    <div className="da-wi-textarea-stats">
                                                        <span className="da-wi-stat-badge">
                                                            (Token: ~{Math.ceil((entry.content || '').length / 4)})
                                                        </span>
                                                        <span className="da-wi-stat-badge">
                                                            (字符数: {(entry.content || '').length})
                                                        </span>
                                                    </div>
                                                </div>
                                                <textarea
                                                    className="da-wi-textarea"
                                                    rows={5}
                                                    placeholder="输入提示词正文内容，支持 Tagcomplete 自动联想补全与酒馆 {{// 注释}} 语法..."
                                                    value={entry.content || ''}
                                                    onInput={(e) =>
                                                        handlePatchEntry(entry.id, {
                                                            content: (
                                                                e.currentTarget as HTMLTextAreaElement
                                                            ).value,
                                                        })
                                                    }
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
