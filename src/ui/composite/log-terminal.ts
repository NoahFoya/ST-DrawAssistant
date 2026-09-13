/**
 * 实时日志终端控制台组件 (LogTerminal)
 * 对齐 styles/features/terminal.css 规范。
 * 提供语法高亮、时间戳格式化、环形缓冲区控制、划词复制与平滑自动滚屏。
 */

import type { TerminalLogEntry, TerminalLogLevel } from '@types';
import { createButton, ButtonHandle } from '../components/button';

export interface LogTerminalOptions {
    maxLines?: number;
    autoScroll?: boolean;
    showToolbar?: boolean;
    initialLogs?: TerminalLogEntry[];
    className?: string;
}

export interface LogTerminalHandle {
    readonly element: HTMLElement;
    append(entry: TerminalLogEntry): void;
    clear(): void;
    getLogs(): TerminalLogEntry[];
    setFilter(level?: TerminalLogLevel): void;
    dispose(): void;
}

export function createLogTerminal(options: LogTerminalOptions = {}): LogTerminalHandle {
    const root = document.createElement('div');
    root.className = 'da-terminal-wrapper';
    if (options.className) root.classList.add(options.className);

    const maxLines = options.maxLines ?? 200;
    let autoScroll = options.autoScroll ?? true;
    let filterLevel: TerminalLogLevel | undefined;

    const entries: TerminalLogEntry[] = [];
    const lineElements: { entry: TerminalLogEntry; el: HTMLElement }[] = [];

    // 1. 终端卡片主体容器
    const terminal = document.createElement('div');
    terminal.className = 'da-log-terminal';

    // 用户手动向上滚动时暂时解除自动吸底
    terminal.addEventListener('scroll', () => {
        const isAtBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight <= 20;
        autoScroll = isAtBottom;
    });

    root.appendChild(terminal);

    // 2. 顶部微型操作栏（清空、复制）
    let toolbar: HTMLElement | null = null;
    let copyBtn: ButtonHandle | null = null;
    let clearBtn: ButtonHandle | null = null;

    if (options.showToolbar) {
        toolbar = document.createElement('div');
        toolbar.className = 'da-terminal-toolbar da-card-actions-right';
        toolbar.style.display = 'flex';
        toolbar.style.justifyContent = 'flex-end';
        toolbar.style.gap = '6px';
        toolbar.style.marginBottom = '6px';

        copyBtn = createButton({
            text: '复制全部',
            variant: 'ghost',
            size: 'sm',
            icon: 'copy',
            onClick: async () => {
                const text = entries
                    .map((e) => {
                        const time = new Date(e.timestamp || Date.now()).toLocaleTimeString();
                        const tag = e.namespace ? `[${e.namespace}] ` : '';
                        return `${time} [${e.level.toUpperCase()}] ${tag}${e.message}`;
                    })
                    .join('\n');
                if (navigator?.clipboard) {
                    await navigator.clipboard.writeText(text);
                }
            }
        });

        clearBtn = createButton({
            text: '清空终端',
            variant: 'ghost',
            size: 'sm',
            icon: 'trash',
            onClick: () => {
                clearLogs();
            }
        });

        toolbar.appendChild(copyBtn.element);
        toolbar.appendChild(clearBtn.element);
        root.insertBefore(toolbar, terminal);
    }

    const formatTime = (ts?: number): string => {
        const d = new Date(ts || Date.now());
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const renderLine = (entry: TerminalLogEntry): HTMLElement => {
        const line = document.createElement('div');
        line.className = 'da-log-line';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'da-log-time';
        timeSpan.textContent = formatTime(entry.timestamp);

        const levelSpan = document.createElement('span');
        levelSpan.className = `da-log-level da-log-level--${entry.level}`;
        levelSpan.textContent = `[${entry.level.toUpperCase()}]`;

        line.appendChild(timeSpan);
        line.appendChild(levelSpan);

        if (entry.namespace) {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'da-log-tag';
            tagSpan.textContent = `[${entry.namespace}]`;
            line.appendChild(tagSpan);
        }

        const msgSpan = document.createElement('span');
        msgSpan.className = 'da-log-msg';
        msgSpan.textContent = entry.message;
        line.appendChild(msgSpan);

        if (filterLevel && entry.level !== filterLevel) {
            line.style.display = 'none';
        }

        return line;
    };

    const appendLog = (entry: TerminalLogEntry) => {
        entries.push(entry);

        // 环形缓冲区超限截断
        if (entries.length > maxLines) {
            entries.shift();
            const first = lineElements.shift();
            first?.el.remove();
        }

        const lineEl = renderLine(entry);
        lineElements.push({ entry, el: lineEl });
        terminal.appendChild(lineEl);

        if (autoScroll) {
            terminal.scrollTop = terminal.scrollHeight;
        }
    };

    const clearLogs = () => {
        entries.length = 0;
        lineElements.length = 0;
        terminal.innerHTML = '';
    };

    if (options.initialLogs) {
        options.initialLogs.forEach(appendLog);
    }

    return {
        element: root,
        append(entry: TerminalLogEntry): void {
            appendLog(entry);
        },
        clear(): void {
            clearLogs();
        },
        getLogs(): TerminalLogEntry[] {
            return [...entries];
        },
        setFilter(level?: TerminalLogLevel): void {
            filterLevel = level;
            for (const { entry, el } of lineElements) {
                if (!level || entry.level === level) {
                    el.style.display = '';
                } else {
                    el.style.display = 'none';
                }
            }
        },
        dispose(): void {
            copyBtn?.dispose();
            clearBtn?.dispose();
            terminal.remove();
            root.remove();
        }
    };
}
