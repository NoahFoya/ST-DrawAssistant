/**
 * 实时排障日志终端控制台组件 (LogTerminal)。
 *
 * @remarks
 * 基于 Preact JSX 呈现运行日志输出与交互检索：
 * 1. 控制工具栏：日志级别过滤、防抖关键词搜索、全量复制与清空；
 * 2. 单条快捷交互：复制单条日志及异常堆栈，支持短时状态反馈；
 * 3. 结构化详情折叠：展开或收起格式化 JSON 文本；
 * 4. 滚动定位跟随与环形缓冲区裁剪。
 */

import type { VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { copyTextToClipboard } from '../../util/browser-io';
import { logger as globalLogger, type LogEntry, type LogLevel, type Logger } from '../../util/logger';
import { ButtonControl, SelectControl, TextInputControl } from '../framework/controls';

/** 终端日志过滤模式 */
export type TerminalFilterMode = 'all' | 'error_warn' | 'debug';

/** 单条日志条目模型 */
export interface TerminalLogItem {
    /** 全局唯一条目标识符 */
    readonly id: string;
    /** 生成时间戳（毫秒） */
    readonly timestamp: number;
    /** 日志级别 */
    readonly level: LogLevel;
    /** 日志消息主体 */
    readonly message: string;
    /** 所属模块命名空间 */
    readonly namespace?: string;
    /** 结构化数据或异常堆栈 */
    readonly details?: unknown;
}

/** 终端组件属性 */
export interface LogTerminalProps {
    /** 环形缓冲区最大保留条目数，默认 300 */
    maxLines?: number;
    /** 初始日志过滤模式，默认 'all' */
    filterMode?: TerminalFilterMode;
    /** 初始载入的历史日志 */
    initialLogs?: Array<Partial<TerminalLogItem> & { message: string }>;
    /** 是否自动预载并订阅全局 logger，默认 true */
    autoSubscribeGlobalLogger?: boolean;
    /** 自定义 logger 实例（主要用于测试注入） */
    loggerInstance?: Logger;
    /** 附加 CSS 类名 */
    className?: string;
}

const FILTER_OPTIONS = [
    { value: 'all', label: '全部日志' },
    { value: 'error_warn', label: '仅看错误与警告' },
    { value: 'debug', label: '仅看调试信息' },
];

/** 将日志附加详情（支持 Error / HttpError 实例、单元素数组解包与嵌套对象）格式化为可读文本 */
export function formatLogDetailsText(rawDetails: unknown): string {
    if (rawDetails === undefined || rawDetails === null) {
        return '';
    }
    const unwrapped =
        Array.isArray(rawDetails) && rawDetails.length === 1 ? rawDetails[0] : rawDetails;
    if (typeof unwrapped === 'string') {
        return unwrapped;
    }
    try {
        return JSON.stringify(
            unwrapped,
            (_key, val) => {
                if (val instanceof Error) {
                    const errRecord: Record<string, unknown> = {
                        name: val.name,
                        message: val.message,
                    };
                    for (const prop of Object.keys(val)) {
                        errRecord[prop] = (val as unknown as Record<string, unknown>)[prop];
                    }
                    if (val.stack) {
                        errRecord.stack = val.stack;
                    }
                    return errRecord;
                }
                return val;
            },
            2
        );
    } catch {
        return String(unwrapped);
    }
}

export function isTerminalLogVisible(
    item: TerminalLogItem,
    filterMode: TerminalFilterMode,
    searchKeyword: string
): boolean {
    if (filterMode === 'error_warn') {
        if (item.level !== 'error' && item.level !== 'warn') {
            return false;
        }
    } else if (filterMode === 'debug') {
        if (item.level !== 'debug') {
            return false;
        }
    }

    const kw = searchKeyword.trim().toLowerCase();
    if (kw) {
        const msgMatch = item.message.toLowerCase().includes(kw);
        const tagMatch = item.namespace ? item.namespace.toLowerCase().includes(kw) : false;
        const detailsMatch =
            item.details !== undefined && item.details !== null
                ? formatLogDetailsText(item.details).toLowerCase().includes(kw)
                : false;
        if (!msgMatch && !tagMatch && !detailsMatch) {
            return false;
        }
    }

    return true;
}

function formatTerminalTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatTerminalItemText(item: TerminalLogItem, includeDetails = true): string {
    const time = formatTerminalTime(item.timestamp);
    const tag = item.namespace ? `[${item.namespace}] ` : '';
    let base = `${time} [${item.level.toUpperCase()}] ${tag}${item.message}`;

    if (includeDetails && item.details !== undefined && item.details !== null) {
        const detailStr = formatLogDetailsText(item.details);
        if (detailStr) {
            base += `\n${detailStr}`;
        }
    }

    return base;
}

export function LogTerminal(props: LogTerminalProps): VNode {
    const maxLines = props.maxLines ?? 300;
    const idCounterRef = useRef(0);
    const normalizeItem = (
        entry: Partial<TerminalLogItem> & { message: string; level?: LogLevel }
    ): TerminalLogItem => ({
        id: entry.id || `log_${++idCounterRef.current}_${Date.now()}`,
        timestamp: entry.timestamp ?? Date.now(),
        level: entry.level ?? 'info',
        message: entry.message,
        namespace: entry.namespace,
        details: entry.details,
    });

    const [entries, setEntries] = useState<TerminalLogItem[]>(() => {
        const initial: TerminalLogItem[] = [];
        if (props.initialLogs && props.initialLogs.length > 0) {
            for (const entry of props.initialLogs) {
                initial.push(normalizeItem(entry));
            }
        }
        return initial.slice(-maxLines);
    });
    const [filterMode, setFilterMode] = useState<TerminalFilterMode>(props.filterMode ?? 'all');
    const [searchKeyword, setSearchKeyword] = useState('');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
    const [copyFeedback, setCopyFeedback] = useState<Record<string, 'success' | 'error'>>({});

    const terminalRef = useRef<HTMLDivElement | null>(null);
    const isAutoScrollRef = useRef(true);
    const copyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    useEffect(() => {
        if (props.autoSubscribeGlobalLogger === false && !props.loggerInstance) {
            return;
        }
        const targetLogger = props.loggerInstance ?? globalLogger;
        const recentLogs = targetLogger.getRecentLogs(200);
        if (recentLogs.length > 0) {
            setEntries((prev) => {
                const next = [...prev, ...recentLogs.map((e) => normalizeItem(e))];
                return next.length > maxLines ? next.slice(-maxLines) : next;
            });
        }

        const unsubscribe = targetLogger.onLog((entry: LogEntry) => {
            setEntries((prev) => {
                const next = [
                    ...prev,
                    normalizeItem({
                        timestamp: entry.timestamp,
                        level: entry.level,
                        message: entry.message,
                        details: entry.details,
                    }),
                ];
                return next.length > maxLines ? next.slice(-maxLines) : next;
            });
        });

        return () => {
            unsubscribe();
        };
    }, [props.autoSubscribeGlobalLogger, props.loggerInstance, maxLines]);

    useEffect(() => {
        const timers = copyTimersRef.current;
        return () => {
            for (const t of timers.values()) {
                clearTimeout(t);
            }
            timers.clear();
        };
    }, []);

    const filteredEntries = useMemo(
        () => entries.filter((item) => isTerminalLogVisible(item, filterMode, searchKeyword)),
        [entries, filterMode, searchKeyword]
    );

    useEffect(() => {
        const el = terminalRef.current;
        if (el && isAutoScrollRef.current && filteredEntries.length > 0) {
            el.scrollTop = el.scrollHeight;
        }
    }, [filteredEntries]);

    const handleCopyItem = async (item: TerminalLogItem) => {
        const ok = await copyTextToClipboard(formatTerminalItemText(item, true));
        const existingTimer = copyTimersRef.current.get(item.id);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        setCopyFeedback((prev) => ({
            ...prev,
            [item.id]: ok ? 'success' : 'error',
        }));
        const timer = setTimeout(() => {
            copyTimersRef.current.delete(item.id);
            setCopyFeedback((prev) => {
                const next = { ...prev };
                delete next[item.id];
                return next;
            });
        }, 1500);
        copyTimersRef.current.set(item.id, timer);
    };

    const handleCopyAll = async () => {
        if (filteredEntries.length === 0) return;
        const text = filteredEntries.map((item) => formatTerminalItemText(item)).join('\n');
        await copyTextToClipboard(text);
    };

    const wrapperClass = ['da-terminal-wrapper', props.className || '']
        .filter(Boolean)
        .join(' ');

    return (
        <div className={wrapperClass}>
            <div className="da-terminal-toolbar">
                <SelectControl
                    value={filterMode}
                    options={FILTER_OPTIONS}
                    onChange={(val) => setFilterMode(val as TerminalFilterMode)}
                />
                <TextInputControl
                    value={searchKeyword}
                    placeholder="搜索日志..."
                    clearable={true}
                    debounceMs={150}
                    onChange={(val) => setSearchKeyword(val)}
                />
                <div className="da-terminal-toolbar-actions">
                    <ButtonControl
                        label="复制全部"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleCopyAll()}
                    />
                    <ButtonControl
                        label="清空"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            for (const t of copyTimersRef.current.values()) {
                                clearTimeout(t);
                            }
                            copyTimersRef.current.clear();
                            setCopyFeedback({});
                            setExpandedIds(new Set());
                            setEntries([]);
                        }}
                    />
                </div>
            </div>

            <div
                ref={terminalRef}
                className="da-log-terminal"
                onScroll={(e) => {
                    const el = e.currentTarget as HTMLDivElement;
                    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
                    isAutoScrollRef.current = distance <= 24;
                }}
            >
                {filteredEntries.map((item) => {
                    const hasDetails = item.details !== undefined && item.details !== null;
                    const isExpanded = expandedIds.has(item.id);
                    const fb = copyFeedback[item.id];
                    const copyClass = [
                        'da-log-action-btn',
                        'da-log-copy-btn',
                        fb === 'success' ? 'is-success' : fb === 'error' ? 'is-error' : '',
                    ]
                        .filter(Boolean)
                        .join(' ');

                    return (
                        <div
                            key={item.id}
                            className="da-log-entry"
                            data-id={item.id}
                            data-level={item.level}
                        >
                            <div
                                className="da-log-line"
                                data-id={item.id}
                                data-level={item.level}
                            >
                                <span className="da-log-time">
                                    {formatTerminalTime(item.timestamp)}
                                </span>
                                <span className={`da-log-level da-log-level--${item.level}`}>
                                    {`[${item.level.toUpperCase()}]`}
                                </span>
                                {item.namespace && (
                                    <span className="da-log-tag">{`[${item.namespace}]`}</span>
                                )}
                                <span className="da-log-msg">{item.message}</span>
                                <div className="da-log-actions">
                                    <button
                                        type="button"
                                        className={copyClass}
                                        title="复制此条日志"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void handleCopyItem(item);
                                        }}
                                    >
                                        {fb === 'success' ? '✔' : fb === 'error' ? '✖' : '⧉'}
                                    </button>
                                    {hasDetails && (
                                        <button
                                            type="button"
                                            className="da-log-action-btn da-log-expand-btn"
                                            title="展开/收起详情"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setExpandedIds((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(item.id)) {
                                                        next.delete(item.id);
                                                    } else {
                                                        next.add(item.id);
                                                    }
                                                    return next;
                                                });
                                            }}
                                        >
                                            {isExpanded ? '▲' : '▼'}
                                        </button>
                                    )}
                                </div>
                            </div>
                            {hasDetails && (
                                <div
                                    className="da-log-details-block"
                                    style={{ display: isExpanded ? 'block' : 'none' }}
                                >
                                    {formatLogDetailsText(item.details)}
                                </div>
                            )}
                        </div>
                    );
                })}
                <div
                    className="da-log-empty-tip"
                    style={{ display: filteredEntries.length > 0 ? 'none' : 'block' }}
                >
                    暂无匹配的日志记录
                </div>
            </div>
        </div>
    );
}
