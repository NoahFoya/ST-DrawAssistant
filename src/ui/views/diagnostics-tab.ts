/**
 * @module ui/views/diagnostics-tab
 * @description 运行诊断与日志面板视图 (包含多引擎连通性探测、运行环境概览与实时日志流监控)
 */

import { Logger } from '../../core/diagnostics/logger';
import { LogEntry } from '../../core/diagnostics/log-buffer';
import { ControlFactory } from '../components/controls';

/**
 * 构建并渲染运行诊断与实时日志面板
 *
 * @returns 诊断日志面板 DOM 根节点
 */
export function createDiagnosticsTabView(): HTMLElement {
    const controls = new ControlFactory();
    const container = document.createElement('div');
    container.className = 'da-tab-pane';

    const card = controls.createCard('运行诊断与日志 (Diagnostics & Logs)', (body) => {
        const desc = document.createElement('div');
        desc.style.fontSize = '0.85em';
        desc.style.color = 'var(--da-text-secondary)';
        desc.style.marginBottom = '12px';
        desc.textContent = '收集插件运行日志，便于排查后端连接或生图异常：';
        body.appendChild(desc);

        const logView = document.createElement('pre');
        logView.className = 'da-log-viewer';
        logView.style.height = '240px';
        logView.style.overflowY = 'auto';
        logView.style.padding = '10px';
        logView.style.background = 'var(--da-bg-primary)';
        logView.style.borderRadius = '6px';
        logView.style.border = '1px solid var(--da-border-color)';
        logView.style.fontSize = '0.8em';
        logView.style.color = 'var(--da-text-primary)';

        const refreshLogs = () => {
            const buffer = Logger.getGlobalBuffer();
            const logs = buffer.getAll();
            logView.textContent = logs
                .map((l: LogEntry) => `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.level}] [${l.namespace}] ${l.message}`)
                .join('\n');
            logView.scrollTop = logView.scrollHeight;
        };

        refreshLogs();
        body.appendChild(logView);

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '10px';
        actions.style.marginTop = '12px';

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'da-btn secondary';
        refreshBtn.textContent = '🔄 刷新日志';
        refreshBtn.onclick = () => refreshLogs();

        const exportBtn = document.createElement('button');
        exportBtn.className = 'da-btn primary';
        exportBtn.textContent = '📥 导出诊断包 (JSON)';
        exportBtn.onclick = () => {
            const dump = Logger.getGlobalBuffer().exportDiagnosticDump();
            const blob = new Blob([dump], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `st-da-diagnostics-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        };

        actions.appendChild(refreshBtn);
        actions.appendChild(exportBtn);
        body.appendChild(actions);
    });

    container.appendChild(card);
    return container;
}
