/**
 * @module ui/tabs/diagnostics-tab
 * @description 系统诊断与日志追溯 Tab 组件
 *
 * 职责：
 * - 实时呈现耗时打点趋势图表与分段链路性能
 * - 检索与导出结构化运行日志，辅助排查异常
 */

import { renderStatisticsCard, createFieldRow } from '../components/controls';
import { loadSettings } from '../../settings/manager';
import { createDriver } from '../../drivers/factory';
import { logger, type LogLevel, type StructuredLogEntry } from '../../core/logger';
import { PerformanceCollector } from '../../core/performance';
import { StatisticsCollector } from '../../statistics';
import { EXTENSION_DISPLAY_NAME, VERSION } from '../../core/constants';
import { escapeHtml } from '../../utils/html';
import { showToastNotice } from '../../utils/toast';

function downloadBlobFile(content: string, filename: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function renderDiagnosticsTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-diagnostics-tab';

    const settings = loadSettings();

    // ── 1. 绘图统计仪表板卡片 (优先置顶) ───────────────────────────────────────
    container.appendChild(renderStatisticsCard());

    // ── 2. 服务与运行环境健康诊断卡片 ──────────────────────────────────────────
    const cardHealth = document.createElement('div');
    cardHealth.className = 'da-section-card';
    cardHealth.style.marginTop = '15px';

    const activeProviderName = settings.provider === 'sd-webui' ? 'SD-WebUI' : (settings.provider === 'novelai' ? 'NovelAI' : 'ComfyUI');

    const headerHealth = document.createElement('div');
    headerHealth.className = 'da-section-header';
    headerHealth.innerHTML = `
        <span class="da-section-title">服务与运行环境健康诊断</span>
        <span class="da-section-desc">即时检测 ${activeProviderName} 服务响应延迟、硬件渲染引擎状态与本地存储数据库健康度</span>
    `;
    cardHealth.appendChild(headerHealth);

    const connStatusSpan = document.createElement('span');
    connStatusSpan.style.fontSize = '0.85em';
    connStatusSpan.style.color = 'var(--da-text-secondary)';
    connStatusSpan.textContent = `准备就绪 (${settings.serverUrl ?? 'http://127.0.0.1:8188'})`;

    const testConnBtn = document.createElement('button');
    testConnBtn.className = 'da-btn secondary';
    testConnBtn.style.padding = '4px 12px';
    testConnBtn.style.fontSize = '0.85em';
    testConnBtn.textContent = '测试连接与诊断';

    testConnBtn.addEventListener('click', async () => {
        testConnBtn.disabled = true;
        testConnBtn.textContent = '诊断中...';
        connStatusSpan.style.color = 'var(--da-text-secondary)';
        connStatusSpan.textContent = '正在发起握手测试...';

        try {
            const activeSettings = loadSettings();
            const driver = createDriver(activeSettings.provider, activeSettings);
            const res = await driver.checkConnection();
            if (res.connected) {
                connStatusSpan.style.color = 'var(--da-color-success, #30d158)';
                connStatusSpan.textContent = `服务连通正常 (延迟 ${res.latencyMs ?? 0}ms)`;
            } else {
                connStatusSpan.style.color = 'var(--da-color-error, #ff453a)';
                connStatusSpan.textContent = `服务连接异常: ${res.error ?? '无法访问'}`;
            }
        } catch (err) {
            connStatusSpan.style.color = 'var(--da-color-error, #ff453a)';
            connStatusSpan.textContent = `诊断失败: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
            testConnBtn.disabled = false;
            testConnBtn.textContent = '测试连接与诊断';
        }
    });

    cardHealth.appendChild(createFieldRow({
        label: '生图驱动后端服务状态',
        helpTooltip: '向活跃生图驱动后端 (ComfyUI / SD-WebUI / NovelAI) 发起连通性及 API 响应延迟测量。',
        control: [connStatusSpan, testConnBtn],
    }));

    // 环境加速与数据库
    const isWebGLSupported = (() => {
        try {
            const canvas = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
        } catch {
            return false;
        }
    })();

    const isIndexedDBSupported = typeof window.indexedDB !== 'undefined';

    const envInfoSpan = document.createElement('span');
    envInfoSpan.style.fontSize = '0.85em';
    envInfoSpan.style.color = 'var(--da-text-secondary)';
    envInfoSpan.textContent = `WebGL 加速: ${isWebGLSupported ? '已开启' : '未开启'} | IndexedDB: ${isIndexedDBSupported ? '就绪' : '不支持'}`;

    cardHealth.appendChild(createFieldRow({
        label: '系统硬件与存储环境',
        helpTooltip: '当前浏览器渲染引擎硬解与 IndexedDB 本地数据库就绪状态。',
        control: envInfoSpan,
    }));

    container.appendChild(cardHealth);

    // ── 3. 实时日志监控与导出卡片 ──────────────────────────────────────────────
    const cardLogs = document.createElement('div');
    cardLogs.className = 'da-section-card';
    cardLogs.style.marginTop = '15px';

    const headerLogs = document.createElement('div');
    headerLogs.className = 'da-section-header';
    headerLogs.innerHTML = `
        <span class="da-section-title">实时系统日志与脱敏导出</span>
        <span class="da-section-desc">结构化日志推流查看，支持按级别过滤、日志导出及一键打包脱敏诊断数据</span>
    `;
    cardLogs.appendChild(headerLogs);

    // 控制工具栏 (左右两端分流对齐)
    const logToolbar = document.createElement('div');
    logToolbar.className = 'da-log-toolbar da-gallery-search-row';

    const toolbarLeft = document.createElement('div');
    toolbarLeft.className = 'da-gallery-row-left';

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'da-input';
    filterInput.placeholder = '搜索过滤日志...';
    filterInput.style.flex = '1';
    filterInput.style.minWidth = '140px';

    const levelSelect = document.createElement('select');
    levelSelect.className = 'da-select da-control-fixed-140';
    levelSelect.style.width = '110px';
    levelSelect.innerHTML = `
        <option value="ALL">全部级别</option>
        <option value="INFO">INFO</option>
        <option value="WARN">WARN</option>
        <option value="ERROR">ERROR</option>
    `;

    const refreshLogBtn = document.createElement('button');
    refreshLogBtn.className = 'da-btn secondary';
    refreshLogBtn.style.padding = '4px 10px';
    refreshLogBtn.style.fontSize = '0.85em';
    refreshLogBtn.textContent = '刷新日志';

    const clearLogBtn = document.createElement('button');
    clearLogBtn.className = 'da-btn secondary';
    clearLogBtn.style.padding = '4px 10px';
    clearLogBtn.style.fontSize = '0.85em';
    clearLogBtn.textContent = '清空日志';

    toolbarLeft.appendChild(filterInput);
    toolbarLeft.appendChild(levelSelect);
    toolbarLeft.appendChild(refreshLogBtn);
    toolbarLeft.appendChild(clearLogBtn);

    const toolbarRight = document.createElement('div');
    toolbarRight.className = 'da-gallery-row-right';

    const exportTxtBtn = document.createElement('button');
    exportTxtBtn.className = 'da-btn secondary';
    exportTxtBtn.style.padding = '4px 10px';
    exportTxtBtn.style.fontSize = '0.85em';
    exportTxtBtn.textContent = '导出 TXT';

    const exportJsonBtn = document.createElement('button');
    exportJsonBtn.className = 'da-btn secondary';
    exportJsonBtn.style.padding = '4px 10px';
    exportJsonBtn.style.fontSize = '0.85em';
    exportJsonBtn.textContent = '导出 JSON';

    const exportBundleBtn = document.createElement('button');
    exportBundleBtn.className = 'da-btn primary';
    exportBundleBtn.style.padding = '4px 12px';
    exportBundleBtn.style.fontSize = '0.85em';
    exportBundleBtn.textContent = '导出脱敏诊断包';

    toolbarRight.appendChild(exportTxtBtn);
    toolbarRight.appendChild(exportJsonBtn);
    toolbarRight.appendChild(exportBundleBtn);

    logToolbar.appendChild(toolbarLeft);
    logToolbar.appendChild(toolbarRight);

    cardLogs.appendChild(logToolbar);

    // 日志流终端 DOM
    const terminalBox = document.createElement('div');
    terminalBox.className = 'da-log-terminal';

    const renderLogsStream = () => {
        terminalBox.innerHTML = '';
        const levelVal = levelSelect.value as LogLevel | 'ALL';
        const allLogs = logger.getLogs(levelVal);
        const searchText = filterInput.value.trim().toLowerCase();

        const filtered = allLogs.filter((entry: StructuredLogEntry) => {
            if (searchText) {
                const msg = `${entry.timestamp} ${entry.level} ${entry.module} ${entry.message}`.toLowerCase();
                if (!msg.includes(searchText)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            terminalBox.innerHTML = '<div style="color:var(--da-text-secondary); text-align:center; padding-top:80px;">暂无符合条件的日志记录</div>';
            return;
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach((entry: StructuredLogEntry) => {
            const line = document.createElement('div');
            line.style.marginBottom = '4px';
            line.style.lineHeight = '1.4';
            line.style.wordBreak = 'break-all';

            line.innerHTML = `<span class="da-log-ts">[${escapeHtml(entry.timestamp.substring(11, 19))}]</span> <span class="da-log-level" data-level="${escapeHtml(entry.level)}">[${escapeHtml(entry.level)}]</span> <span class="da-log-module">[${escapeHtml(entry.module)}]</span> ${escapeHtml(entry.message)}`;
            fragment.appendChild(line);
        });

        terminalBox.appendChild(fragment);
        terminalBox.scrollTop = terminalBox.scrollHeight;
    };

    filterInput.addEventListener('input', renderLogsStream);
    levelSelect.addEventListener('change', renderLogsStream);
    refreshLogBtn.addEventListener('click', renderLogsStream);

    clearLogBtn.addEventListener('click', () => {
        logger.clear();
        renderLogsStream();
    });

    exportTxtBtn.addEventListener('click', () => {
        const text = logger.exportToText();
        downloadBlobFile(text, `st-da-logs-${Date.now()}.txt`, 'text/plain;charset=utf-8');
    });

    exportJsonBtn.addEventListener('click', () => {
        const text = logger.exportToJson();
        downloadBlobFile(text, `st-da-logs-${Date.now()}.json`, 'application/json;charset=utf-8');
    });

    exportBundleBtn.addEventListener('click', () => {
        exportBundleBtn.disabled = true;
        exportBundleBtn.textContent = '打包中...';
        try {
            const rawSettings = loadSettings();
            const sanitizedSettings = JSON.parse(JSON.stringify(rawSettings)) as Record<string, unknown>;
            if (sanitizedSettings['apiKey']) {
                sanitizedSettings['apiKey'] = '****[SENSITIVE_REDACTED]****';
            }

            const bundle = {
                metadata: {
                    extension: `${EXTENSION_DISPLAY_NAME} v${VERSION}`,
                    exportedAt: new Date().toISOString(),
                    userAgent: navigator.userAgent,
                    screen: `${window.innerWidth}×${window.innerHeight}`,
                },
                settingsSnapshot: sanitizedSettings,
                logs: logger.getLogs('ALL'),
                performance: PerformanceCollector.getInstance().getSummary(),
                statistics: StatisticsCollector.getInstance().getSnapshot(),
            };

            const jsonStr = JSON.stringify(bundle, null, 2);
            downloadBlobFile(jsonStr, `st-da-diagnostic-bundle-${Date.now()}.json`, 'application/json;charset=utf-8');
            showToastNotice('已成功导出一键脱敏诊断分析包 (.json)！', '导出诊断包成功', true);
        } catch (err) {
            showToastNotice(`导出诊断包失败: ${err instanceof Error ? err.message : String(err)}`, '导出失败', false);
        } finally {
            exportBundleBtn.disabled = false;
            exportBundleBtn.textContent = '导出脱敏诊断包';
        }
    });

    renderLogsStream();
    cardLogs.appendChild(terminalBox);
    container.appendChild(cardLogs);

    return container;
}
