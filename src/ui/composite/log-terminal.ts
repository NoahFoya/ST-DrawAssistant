/**
 * 实时排障日志终端控制台组件 (LogTerminal)。
 *
 * @remarks
 * 负责呈现运行日志输出与交互检索：
 * 1. 控制工具栏：日志级别过滤、防抖关键词搜索、全量复制与清空；
 * 2. 单条快捷交互：悬停复制日志内容与异常堆栈，支持状态反馈；
 * 3. 结构化详情折叠：展开或收起对象的格式化 JSON 字符串；
 * 4. 滚动定位跟随：用户回滚查看历史时暂停跟随，滚动至底部时恢复自动吸底；
 * 5. 环形缓冲区管理：限制条目总数，超出上限时先进先出移除，销毁时清理定时器与订阅。
 */

import type { UIComponent } from '../types';
import { Select } from '../components/select';
import { TextInput } from '../components/text-input';
import { Button } from '../components/button';
import type { Logger, LogLevel, LogEntry } from '../../util/logger';

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

/** 终端配置选项 */
export interface LogTerminalOptions {
    /** 环形缓冲区最大保留条目数，默认 300 */
    maxLines?: number;
    /** 初始日志过滤模式，默认 'all' */
    filterMode?: TerminalFilterMode;
    /** 初始载入的历史日志 */
    initialLogs?: Array<Partial<TerminalLogItem> & { message: string }>;
    /** 附加 CSS 类名 */
    className?: string;
}

interface LogRowRecord {
    item: TerminalLogItem;
    entryElement: HTMLElement;
    element: HTMLElement;
    detailsBlock?: HTMLElement;
    expandBtn?: HTMLButtonElement;
    copyBtn?: HTMLButtonElement;
}

/**
 * 实时排障日志终端控制台实现类。
 */
export class LogTerminal implements UIComponent {
    public readonly element: HTMLElement;
    public readonly terminalElement: HTMLElement;
    public readonly toolbarElement: HTMLElement;

    // 控制工具栏子控件
    private readonly filterSelect: Select;
    private readonly searchInput: TextInput;
    private readonly copyAllBtn: Button;
    private readonly clearBtn: Button;
    private readonly emptyTipElement: HTMLElement;

    // 内部状态与生命周期跟踪
    private readonly maxLines: number;
    private filterMode: TerminalFilterMode = 'all';
    private searchKeyword = '';
    private isAutoScroll = true;
    private idCounter = 0;

    private readonly entries: TerminalLogItem[] = [];
    private readonly rowMap = new Map<string, LogRowRecord>();
    private readonly activeTimers = new Set<ReturnType<typeof setTimeout>>();

    private readonly scrollListener: () => void;
    private unsubscribeLogger?: () => void;

    public constructor(options: LogTerminalOptions = {}) {
        this.maxLines = options.maxLines ?? 300;
        this.filterMode = options.filterMode ?? 'all';

        // 1. 创建最外层容器
        this.element = document.createElement('div');
        this.element.className = 'da-terminal-wrapper';
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 2. 创建顶部紧凑控制栏
        this.toolbarElement = document.createElement('div');
        this.toolbarElement.className = 'da-terminal-toolbar';

        // 2.1 级别过滤模式下拉框
        this.filterSelect = new Select({
            value: this.filterMode,
            options: [
                { value: 'all', label: '全部日志' },
                { value: 'error_warn', label: '仅看错误与警告' },
                { value: 'debug', label: '仅看调试信息' },
            ],
            onChange: (val) => {
                this.setFilterMode(val as TerminalFilterMode);
            },
        });
        this.toolbarElement.appendChild(this.filterSelect.element);

        // 2.2 关键词实时搜索框
        this.searchInput = new TextInput({
            placeholder: '搜索日志...',
            clearable: true,
            debounceMs: 150,
            onChange: (val) => {
                this.setSearchKeyword(val);
            },
        });
        this.toolbarElement.appendChild(this.searchInput.element);

        // 2.3 右侧快捷操作按钮组
        const actionsGroup = document.createElement('div');
        actionsGroup.className = 'da-terminal-toolbar-actions';

        this.copyAllBtn = new Button({
            label: '复制全部',
            variant: 'ghost',
            size: 'sm',
            onClick: async () => {
                await this.copyAllVisible();
            },
        });

        this.clearBtn = new Button({
            label: '清空',
            variant: 'ghost',
            size: 'sm',
            onClick: () => {
                this.clear();
            },
        });

        actionsGroup.appendChild(this.copyAllBtn.element);
        actionsGroup.appendChild(this.clearBtn.element);
        this.toolbarElement.appendChild(actionsGroup);
        this.element.appendChild(this.toolbarElement);

        // 3. 创建终端日志视口
        this.terminalElement = document.createElement('div');
        this.terminalElement.className = 'da-log-terminal';

        // 自然滚动监听：向上滚时暂停吸底，滑回底部恢复
        this.scrollListener = () => {
            const distance = this.terminalElement.scrollHeight - this.terminalElement.scrollTop - this.terminalElement.clientHeight;
            this.isAutoScroll = distance <= 24;
        };
        this.terminalElement.addEventListener('scroll', this.scrollListener);

        // 4. 空态提示节点
        this.emptyTipElement = document.createElement('div');
        this.emptyTipElement.className = 'da-log-empty-tip';
        this.emptyTipElement.textContent = '暂无匹配的日志记录';
        this.terminalElement.appendChild(this.emptyTipElement);

        this.element.appendChild(this.terminalElement);

        // 5. 初始日志载入
        if (options.initialLogs && options.initialLogs.length > 0) {
            this.appendBatch(options.initialLogs);
        } else {
            this.updateEmptyTipVisibility();
        }
    }

    /**
     * 向终端末尾追加一条日志。
     *
     * @param entry 日志条目参数
     */
    public append(entry: Partial<TerminalLogItem> & { message: string; level?: LogLevel }): void {
        const item: TerminalLogItem = {
            id: entry.id || `log_${++this.idCounter}_${Date.now()}`,
            timestamp: entry.timestamp ?? Date.now(),
            level: entry.level ?? 'info',
            message: entry.message,
            namespace: entry.namespace,
            details: entry.details,
        };

        this.entries.push(item);

        // 环形缓冲区超限淘汰
        if (this.entries.length > this.maxLines) {
            const evicted = this.entries.shift();
            if (evicted) {
                const record = this.rowMap.get(evicted.id);
                if (record) {
                    record.entryElement.remove();
                    this.rowMap.delete(evicted.id);
                }
            }
        }

        // 渲染自闭合 DOM 条目
        const rowRecord = this.createRowRecord(item);
        this.rowMap.set(item.id, rowRecord);

        // 挂载至视口末尾（在 emptyTipElement 之前）
        this.terminalElement.insertBefore(rowRecord.entryElement, this.emptyTipElement);

        // 根据当前过滤条件判定显隐
        const visible = this.isItemVisible(item);
        rowRecord.entryElement.style.display = visible ? '' : 'none';

        this.updateEmptyTipVisibility();

        // 自然滚动跟随
        if (this.isAutoScroll && visible) {
            this.terminalElement.scrollTop = this.terminalElement.scrollHeight;
        }
    }

    /**
     * 批量追加多条日志。
     *
     * @param entries 日志条目数组
     */
    public appendBatch(entries: Array<Partial<TerminalLogItem> & { message: string; level?: LogLevel }>): void {
        for (const entry of entries) {
            this.append(entry);
        }
    }

    /**
     * 清空控制台中所有日志条目与 DOM 节点。
     */
    public clear(): void {
        this.clearActiveTimers();
        this.entries.length = 0;
        for (const record of this.rowMap.values()) {
            record.entryElement.remove();
        }
        this.rowMap.clear();
        this.updateEmptyTipVisibility();
    }

    /**
     * 获取当前缓冲区内的全量日志快照。
     */
    public getLogs(): TerminalLogItem[] {
        return [...this.entries];
    }

    /**
     * 获取当前经过级别模式与搜索过滤后可见的日志列表。
     */
    public getFilteredLogs(): TerminalLogItem[] {
        return this.entries.filter((item) => this.isItemVisible(item));
    }

    /**
     * 设置日志过滤模式。
     *
     * @param mode 'all' | 'error_warn' | 'debug'
     */
    public setFilterMode(mode: TerminalFilterMode): void {
        if (this.filterMode === mode) {
            return;
        }
        this.filterMode = mode;
        this.filterSelect.setValue(mode, { silent: true });
        this.applyFilter();
    }

    /**
     * 设置关键词搜索过滤。
     *
     * @param keyword 搜索关键字
     */
    public setSearchKeyword(keyword: string): void {
        const trimmed = keyword.trim().toLowerCase();
        if (this.searchKeyword === trimmed) {
            return;
        }
        this.searchKeyword = trimmed;
        this.applyFilter();
    }

    /**
     * 复制当前所有可见日志至剪贴板。
     *
     * @returns 是否复制成功
     */
    public async copyAllVisible(): Promise<boolean> {
        const visibleItems = this.getFilteredLogs();
        if (visibleItems.length === 0) {
            return false;
        }

        const text = visibleItems.map((item) => this.formatItemText(item)).join('\n');
        return this.writeClipboard(text);
    }

    /**
     * 复制指定单条日志至剪贴板。
     *
     * @param id 条目唯一标识符
     * @returns 是否复制成功
     */
    public async copyItem(id: string): Promise<boolean> {
        const record = this.rowMap.get(id);
        if (!record) {
            return false;
        }

        const text = this.formatItemText(record.item, true);
        const ok = await this.writeClipboard(text);

        if (record.copyBtn) {
            const originalText = record.copyBtn.textContent;
            if (ok) {
                record.copyBtn.textContent = '✔';
                record.copyBtn.classList.add('is-success');
            } else {
                record.copyBtn.textContent = '✖';
                record.copyBtn.classList.add('is-error');
            }
            const timerId = setTimeout(() => {
                this.activeTimers.delete(timerId);
                if (record.copyBtn) {
                    record.copyBtn.textContent = originalText;
                    record.copyBtn.classList.remove('is-success', 'is-error');
                }
            }, 1500);
            this.activeTimers.add(timerId);
        }

        return ok;
    }

    /**
     * 订阅系统 Logger 实例的实时日志流。
     *
     * @param logger 目标 Logger 实例
     */
    public subscribeLogger(logger: Logger): void {
        if (this.unsubscribeLogger) {
            this.unsubscribeLogger();
            this.unsubscribeLogger = undefined;
        }

        this.unsubscribeLogger = logger.onLog((entry: LogEntry) => {
            this.append({
                timestamp: entry.timestamp,
                level: entry.level,
                message: entry.message,
                details: entry.details,
            });
        });
    }

    /**
     * 销毁组件，解绑所有事件监听、定时器与内部子组件。
     */
    public dispose(): void {
        this.clearActiveTimers();
        if (this.unsubscribeLogger) {
            this.unsubscribeLogger();
            this.unsubscribeLogger = undefined;
        }

        this.terminalElement.removeEventListener('scroll', this.scrollListener);

        this.filterSelect.dispose();
        this.searchInput.dispose();
        this.copyAllBtn.dispose();
        this.clearBtn.dispose();

        this.clear();
        this.element.remove();
    }

    // 私有辅助方法

    private clearActiveTimers(): void {
        for (const timer of this.activeTimers) {
            clearTimeout(timer);
        }
        this.activeTimers.clear();
    }

    private createRowRecord(item: TerminalLogItem): LogRowRecord {
        const entry = document.createElement('div');
        entry.className = 'da-log-entry';
        entry.setAttribute('data-id', item.id);
        entry.setAttribute('data-level', item.level);

        const row = document.createElement('div');
        row.className = 'da-log-line';
        row.setAttribute('data-id', item.id);
        row.setAttribute('data-level', item.level);

        // 1. 时间戳
        const timeSpan = document.createElement('span');
        timeSpan.className = 'da-log-time';
        timeSpan.textContent = this.formatTime(item.timestamp);
        row.appendChild(timeSpan);

        // 2. 级别标签
        const levelSpan = document.createElement('span');
        levelSpan.className = `da-log-level da-log-level--${item.level}`;
        levelSpan.textContent = `[${item.level.toUpperCase()}]`;
        row.appendChild(levelSpan);

        // 3. 命名空间
        if (item.namespace) {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'da-log-tag';
            tagSpan.textContent = `[${item.namespace}]`;
            row.appendChild(tagSpan);
        }

        // 4. 消息主体
        const msgSpan = document.createElement('span');
        msgSpan.className = 'da-log-msg';
        msgSpan.textContent = item.message;
        row.appendChild(msgSpan);

        // 5. 悬停操作按钮组
        const actionsEl = document.createElement('div');
        actionsEl.className = 'da-log-actions';

        // 单条复制按钮
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'da-log-action-btn da-log-copy-btn';
        copyBtn.title = '复制此条日志';
        copyBtn.textContent = '⧉';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copyItem(item.id);
        });
        actionsEl.appendChild(copyBtn);

        // 详情展开按钮（若存在 details）
        let detailsBlock: HTMLElement | undefined;
        let expandBtn: HTMLButtonElement | undefined;

        if (item.details !== undefined && item.details !== null) {
            expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.className = 'da-log-action-btn da-log-expand-btn';
            expandBtn.title = '展开/收起详情';
            expandBtn.textContent = '▼';

            detailsBlock = document.createElement('div');
            detailsBlock.className = 'da-log-details-block';
            detailsBlock.style.display = 'none';

            try {
                detailsBlock.textContent = typeof item.details === 'string'
                    ? item.details
                    : JSON.stringify(item.details, null, 2);
            } catch {
                detailsBlock.textContent = String(item.details);
            }

            expandBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!detailsBlock || !expandBtn) return;
                const isExpanded = detailsBlock.style.display !== 'none';
                detailsBlock.style.display = isExpanded ? 'none' : 'block';
                expandBtn.textContent = isExpanded ? '▼' : '▲';
            });

            actionsEl.appendChild(expandBtn);
        }

        row.appendChild(actionsEl);
        entry.appendChild(row);

        if (detailsBlock) {
            entry.appendChild(detailsBlock);
        }

        return {
            item,
            entryElement: entry,
            element: row,
            detailsBlock,
            expandBtn,
            copyBtn,
        };
    }

    private applyFilter(): void {
        for (const record of this.rowMap.values()) {
            const visible = this.isItemVisible(record.item);
            record.entryElement.style.display = visible ? '' : 'none';
        }
        this.updateEmptyTipVisibility();
    }

    private isItemVisible(item: TerminalLogItem): boolean {
        // 1. 级别模式判定
        if (this.filterMode === 'error_warn') {
            if (item.level !== 'error' && item.level !== 'warn') {
                return false;
            }
        } else if (this.filterMode === 'debug') {
            if (item.level !== 'debug') {
                return false;
            }
        }

        // 2. 关键词模糊判定
        if (this.searchKeyword) {
            const msgMatch = item.message.toLowerCase().includes(this.searchKeyword);
            const tagMatch = item.namespace ? item.namespace.toLowerCase().includes(this.searchKeyword) : false;
            let detailsMatch = false;

            if (item.details !== undefined && item.details !== null) {
                try {
                    detailsMatch = JSON.stringify(item.details).toLowerCase().includes(this.searchKeyword);
                } catch {
                    detailsMatch = String(item.details).toLowerCase().includes(this.searchKeyword);
                }
            }

            if (!msgMatch && !tagMatch && !detailsMatch) {
                return false;
            }
        }

        return true;
    }

    private updateEmptyTipVisibility(): void {
        const hasVisible = this.getFilteredLogs().length > 0;
        this.emptyTipElement.style.display = hasVisible ? 'none' : 'block';
    }

    private formatTime(ts: number): string {
        const d = new Date(ts);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    private formatItemText(item: TerminalLogItem, includeDetails = false): string {
        const time = this.formatTime(item.timestamp);
        const tag = item.namespace ? `[${item.namespace}] ` : '';
        let base = `${time} [${item.level.toUpperCase()}] ${tag}${item.message}`;

        if (includeDetails && item.details !== undefined && item.details !== null) {
            try {
                const detailStr = typeof item.details === 'string'
                    ? item.details
                    : JSON.stringify(item.details, null, 2);
                base += `\n${detailStr}`;
            } catch {
                base += `\n${String(item.details)}`;
            }
        }

        return base;
    }

    private async writeClipboard(text: string): Promise<boolean> {
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(text);
                return true;
            }
            // 备用机制：使用 textarea 复制
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const success = document.execCommand('copy');
            textarea.remove();
            return success;
        } catch {
            return false;
        }
    }
}
