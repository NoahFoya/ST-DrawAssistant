/**
 * @module ui/views/diagnostics-tab
 * @description 运行诊断与实时日志面板视图 (DiagnosticsTab)
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { Logger } from '../../core/diagnostics/logger';
import { LogEntry } from '../../core/diagnostics/log-buffer';
import {
    StatisticsCollector,
    exportStatisticsJSON,
    exportStatisticsCSV
} from '../../core/diagnostics/statistics-collector';
import { createSectionCard, createFieldRow } from '../controls';
import { FeedbackService } from '../feedback/feedback';
import { IDisposable } from '../../core/foundation/disposable';
import { EXTENSION_KEY, VERSION } from '../../core/constants';

function downloadFile(content: string, filename: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 渲染生图成功率与平均耗时统计卡片组件 (Diagnostics 内置看板)
 */
export function renderStatisticsCard(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-macro-stats';

    const collector = StatisticsCollector.getInstance();
    const snap = collector.getSnapshot();

    const totalTasks = snap.totalTasks;
    const successCount = snap.successCount;
    const successRate = collector.getSuccessRate();
    const avgDurationMs = collector.getAverageDuration();
    const avgSec = (avgDurationMs / 1000).toFixed(1);

    let lastTimeStr = '暂无记录';
    if (snap.timeStats.lastTaskAt > 0) {
        const diffMin = Math.floor((Date.now() - snap.timeStats.lastTaskAt) / 60000);
        if (diffMin < 1) lastTimeStr = '刚刚';
        else if (diffMin < 60) lastTimeStr = `${diffMin}分钟前`;
        else if (diffMin < 1440) lastTimeStr = `${Math.floor(diffMin / 60)}小时前`;
        else lastTimeStr = new Date(snap.timeStats.lastTaskAt).toISOString().split('T')[0];
    }

    const grid = document.createElement('div');
    grid.className = 'da-macro-stats__grid';

    const createMetricCard = (label: string, val: string, sub: string, color?: string) => {
        const card = document.createElement('div');
        card.className = 'da-macro-stats__card';

        const labelEl = document.createElement('div');
        labelEl.className = 'da-macro-stats__card-label';
        labelEl.textContent = label;

        const valEl = document.createElement('div');
        valEl.className = 'da-macro-stats__card-val';
        if (color) valEl.style.color = color;
        valEl.textContent = val;

        const subEl = document.createElement('div');
        subEl.className = 'da-macro-stats__card-sub';
        subEl.textContent = sub;

        card.appendChild(labelEl);
        card.appendChild(valEl);
        card.appendChild(subEl);
        return card;
    };

    grid.appendChild(createMetricCard('累计生图量', `${totalTasks} 张`, `总任务 ${snap.totalTasks} 次`));
    grid.appendChild(
        createMetricCard(
            '生图成功率',
            totalTasks > 0 ? `${successRate}%` : '100%',
            `成功 ${successCount} / 失败 ${snap.errorCount}`,
            'var(--da-color-success, #30d158)'
        )
    );
    grid.appendChild(
        createMetricCard(
            '平均生成耗时',
            `${avgSec} 秒/张`,
            snap.minDurationMs > 0 ? `最快 ${(snap.minDurationMs / 1000).toFixed(1)}s` : '推理速度',
            'var(--da-accent-color, #00f2fe)'
        )
    );
    grid.appendChild(createMetricCard('最近生图活动', lastTimeStr, '生成活跃度', 'var(--da-text-primary)'));

    container.appendChild(grid);

    const topModels = collector.getTopItems(snap.paramStats.models, 3);
    if (topModels.length > 0) {
        const modelSection = document.createElement('div');
        modelSection.className = 'da-macro-stats__section';

        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'da-macro-stats__section-title';
        sectionTitle.innerHTML = '<span>🎨 常用生图模型占比 (Top Checkpoints)</span>';
        modelSection.appendChild(sectionTitle);

        const modelList = document.createElement('div');
        modelList.className = 'da-macro-stats__model-list';

        topModels.forEach((item) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'da-macro-stats__model-item';

            const infoEl = document.createElement('div');
            infoEl.className = 'da-macro-stats__model-info';

            const nameEl = document.createElement('span');
            nameEl.className = 'da-macro-stats__model-name';
            nameEl.textContent = item.name;
            nameEl.title = item.name;

            const countEl = document.createElement('span');
            countEl.textContent = `${item.percentage}% (${item.count}张)`;

            infoEl.appendChild(nameEl);
            infoEl.appendChild(countEl);

            const trackEl = document.createElement('div');
            trackEl.className = 'da-macro-stats__progress-track';

            const fillEl = document.createElement('div');
            fillEl.className = 'da-macro-stats__progress-fill';
            fillEl.style.width = `${item.percentage}%`;

            trackEl.appendChild(fillEl);
            itemEl.appendChild(infoEl);
            itemEl.appendChild(trackEl);
            modelList.appendChild(itemEl);
        });

        modelSection.appendChild(modelList);
        container.appendChild(modelSection);
    }

    const dailyTrend = collector.getDailyTrend(7);
    const maxCount = Math.max(...dailyTrend.map((d) => d.count), 1);

    const trendSection = document.createElement('div');
    trendSection.className = 'da-macro-stats__section';

    const trendTitle = document.createElement('div');
    trendTitle.className = 'da-macro-stats__section-title';
    trendTitle.textContent = '📈 近 7 日生图产出趋势 (7-Day Output Trend)';
    trendSection.appendChild(trendTitle);

    const chartEl = document.createElement('div');
    chartEl.className = 'da-macro-stats__trend-chart';

    dailyTrend.forEach((item, index) => {
        const col = document.createElement('div');
        col.className = 'da-macro-stats__trend-col';

        const countText = document.createElement('div');
        countText.className = 'da-macro-stats__trend-count';
        countText.textContent = item.count > 0 ? String(item.count) : '';

        const barWrapper = document.createElement('div');
        barWrapper.className = 'da-macro-stats__trend-bar-wrapper';

        const bar = document.createElement('div');
        bar.className = 'da-macro-stats__trend-bar';
        const heightPct = Math.round((item.count / maxCount) * 100);
        bar.style.height = `${Math.max(heightPct, item.count > 0 ? 8 : 4)}%`;
        if (item.count === 0) bar.style.opacity = '0.25';

        barWrapper.appendChild(bar);

        const dateText = document.createElement('div');
        dateText.className = 'da-macro-stats__trend-date';
        dateText.textContent = index === 6 ? '今日' : item.date.substring(5);

        col.appendChild(countText);
        col.appendChild(barWrapper);
        col.appendChild(dateText);
        chartEl.appendChild(col);
    });

    trendSection.appendChild(chartEl);
    container.appendChild(trendSection);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'da-macro-stats__actions';

    const btnExportJSON = document.createElement('button');
    btnExportJSON.className = 'da-btn secondary';
    btnExportJSON.style.fontSize = '0.8em';
    btnExportJSON.style.padding = '4px 10px';
    btnExportJSON.textContent = '📥 导出 JSON';
    btnExportJSON.onclick = () => {
        exportStatisticsJSON(snap);
        FeedbackService.toastSuccess('生图统计报表 JSON 导出完成');
    };

    const btnExportCSV = document.createElement('button');
    btnExportCSV.className = 'da-btn secondary';
    btnExportCSV.style.fontSize = '0.8em';
    btnExportCSV.style.padding = '4px 10px';
    btnExportCSV.textContent = '📊 导出 CSV';
    btnExportCSV.onclick = () => {
        exportStatisticsCSV(snap);
        FeedbackService.toastSuccess('生图趋势报表 CSV 导出完成');
    };

    const btnReset = document.createElement('button');
    btnReset.className = 'da-btn danger';
    btnReset.style.fontSize = '0.8em';
    btnReset.style.padding = '4px 10px';
    btnReset.textContent = '🗑️ 重置统计';
    btnReset.onclick = async () => {
        const confirmed = await FeedbackService.confirm({
            title: '重置生图统计确认',
            message: '确定要清空所有历史生图统计数据吗？此操作无法撤销。',
            isDangerous: true
        });
        if (confirmed) {
            await collector.reset();
            FeedbackService.toastSuccess('生图历史统计已成功清空');
            const newDash = renderStatisticsCard();
            container.replaceWith(newDash);
        }
    };

    actionsRow.appendChild(btnExportJSON);
    actionsRow.appendChild(btnExportCSV);
    actionsRow.appendChild(btnReset);
    container.appendChild(actionsRow);

    return container;
}

/**
 * 构建并渲染运行诊断与实时日志面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的诊断日志面板 DOM 根节点
 */
export function createDiagnosticsTabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable {
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-diagnostics-tab';

    // ── Module 1: 绘图统计仪表板卡片 (优先置顶呈现) ──────────────────────────
    container.appendChild(renderStatisticsCard());

    // ── Card 1: 客户端环境与存储健康诊断卡片 ─────────────────────────────────
    const cardEnv = createSectionCard({
        title: '客户端环境与存储健康诊断',
        description: '检测当前浏览器渲染引擎 GPU 硬件加速、多线程离屏转码支持与 IndexedDB 数据库健康度',
        renderBody: (body) => {
            const isWebGLSupported = (() => {
                try {
                    const canvas = document.createElement('canvas');
                    return !!(
                        window.WebGLRenderingContext &&
                        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
                    );
                } catch {
                    return false;
                }
            })();

            const webglSpan = document.createElement('span');
            webglSpan.className = 'da-unit';
            webglSpan.classList.toggle('da-text-success', isWebGLSupported);
            webglSpan.classList.toggle('da-text-error', !isWebGLSupported);
            webglSpan.textContent = isWebGLSupported ? '🟢 GPU 硬件加速已就绪 (WebGL)' : '🔴 不支持或已被禁用';

            body.appendChild(
                createFieldRow({
                    label: 'WebGL 硬件加速状态',
                    helpTooltip: '浏览器 GPU 渲染加速管线，用于画布物理绘制与图片平滑缩放',
                    control: webglSpan
                })
            );

            const isOffscreenSupported = typeof window !== 'undefined' && typeof window.OffscreenCanvas !== 'undefined';
            const isWorkerSupported = typeof window !== 'undefined' && typeof window.Worker !== 'undefined';

            const workerSpan = document.createElement('span');
            workerSpan.className = 'da-unit';
            const workerReady = isOffscreenSupported && isWorkerSupported;
            workerSpan.classList.toggle('da-text-success', workerReady);
            workerSpan.classList.toggle('da-text-warning', !workerReady);
            workerSpan.textContent = workerReady
                ? '🟢 Web Worker & OffscreenCanvas 就绪 (支持后台异步转码)'
                : '🟡 基础兼容模式 (主线程同步渲染)';

            body.appendChild(
                createFieldRow({
                    label: '离屏渲染与多线程加速',
                    helpTooltip: '支持在后台独立 Worker 线程中完成 WebP 图片缩略图转码与哈希计算',
                    control: workerSpan
                })
            );

            const isIndexedDBSupported = typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
            const idbSpan = document.createElement('span');
            idbSpan.className = 'da-unit';
            idbSpan.classList.toggle('da-text-success', isIndexedDBSupported);
            idbSpan.classList.toggle('da-text-error', !isIndexedDBSupported);
            idbSpan.textContent = isIndexedDBSupported ? '🟢 读写正常 (IndexedDB v2)' : '🔴 存储引擎不可用 (内存降级)';

            body.appendChild(
                createFieldRow({
                    label: '本地 IndexedDB 数据库',
                    helpTooltip: '本地持久化存储数据库状态，负责图库与生成历史的物理保存',
                    control: idbSpan
                })
            );

            const screenW = typeof window !== 'undefined' ? window.screen?.width || 0 : 0;
            const screenH = typeof window !== 'undefined' ? window.screen?.height || 0 : 0;
            const innerW = typeof window !== 'undefined' ? window.innerWidth || 0 : 0;
            const innerH = typeof window !== 'undefined' ? window.innerHeight || 0 : 0;

            const resSpan = document.createElement('span');
            resSpan.className = 'da-unit';
            resSpan.textContent = `物理屏幕 ${screenW}×${screenH} px (视口: ${innerW}×${innerH} px)`;

            body.appendChild(
                createFieldRow({
                    label: '屏幕分辨率与视口规格',
                    helpTooltip: '当前设备显示屏分辨率与浏览器窗口工作区视口尺寸',
                    control: resSpan
                })
            );
        }
    });
    container.appendChild(cardEnv);

    // ── Card 2: 实时系统日志与脱敏诊断导出卡片 ─────────────────────────────
    const cardLogs = createSectionCard({
        title: '实时系统日志与脱敏诊断导出',
        description: '结构化日志推流查看，支持按级别过滤、实时搜索、日志导出及一键打包脱敏诊断数据',
        renderBody: (body) => {
            const toolbar = document.createElement('div');
            toolbar.className = 'da-gallery-batch-row da-diagnostics-toolbar';

            const leftGroup = document.createElement('div');
            leftGroup.className = 'da-gallery-batch-left';

            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.className = 'da-input da-diagnostics-search';
            searchInput.placeholder = '🔍 搜索过滤日志...';

            const levelSelect = document.createElement('select');
            levelSelect.className = 'da-select da-control-fixed-120';
            levelSelect.innerHTML = `
                <option value="ALL">全部级别</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
            `;

            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'da-btn secondary da-btn-sm';
            refreshBtn.textContent = '🔄 刷新日志';

            const clearBtn = document.createElement('button');
            clearBtn.className = 'da-btn secondary da-btn-sm';
            clearBtn.textContent = '🧹 清空日志';
            clearBtn.onclick = () => {
                Logger.getGlobalBuffer().clear();
                renderLogStream();
                FeedbackService.toastSuccess('日志缓冲区已清空');
            };

            leftGroup.appendChild(searchInput);
            leftGroup.appendChild(levelSelect);
            leftGroup.appendChild(refreshBtn);
            leftGroup.appendChild(clearBtn);

            const rightGroup = document.createElement('div');
            rightGroup.className = 'da-gallery-batch-right';

            const exportTxtBtn = document.createElement('button');
            exportTxtBtn.className = 'da-btn secondary da-btn-sm';
            exportTxtBtn.textContent = '导出 TXT';
            exportTxtBtn.onclick = () => {
                const logs = Logger.getGlobalBuffer().getAll();
                const text = logs
                    .map((l: LogEntry) => `[${new Date(l.timestamp).toISOString()}] [${l.level}] [${l.namespace}] ${l.message}`)
                    .join('\n');
                downloadFile(text, `st-da-logs-${Date.now()}.txt`, 'text/plain;charset=utf-8');
                FeedbackService.toastSuccess('已导出纯文本日志');
            };

            const exportJsonBtn = document.createElement('button');
            exportJsonBtn.className = 'da-btn secondary da-btn-sm';
            exportJsonBtn.textContent = '导出 JSON';
            exportJsonBtn.onclick = () => {
                const logs = Logger.getGlobalBuffer().getAll();
                downloadFile(JSON.stringify(logs, null, 2), `st-da-logs-${Date.now()}.json`, 'application/json;charset=utf-8');
                FeedbackService.toastSuccess('已导出 JSON 结构化日志');
            };

            const exportBundleBtn = document.createElement('button');
            exportBundleBtn.className = 'da-btn primary da-btn-sm';
            exportBundleBtn.textContent = '📦 导出脱敏诊断包';
            exportBundleBtn.onclick = () => {
                try {
                    const rawSettings = store.getState();
                    const sanitizedSettings = JSON.parse(JSON.stringify(rawSettings)) as Record<string, unknown>;
                    if (sanitizedSettings['apiKey']) {
                        sanitizedSettings['apiKey'] = '****[SENSITIVE_REDACTED]****';
                    }

                    const bundle = {
                        metadata: {
                            extension: `${EXTENSION_KEY} v${VERSION}`,
                            exportedAt: new Date().toISOString(),
                            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
                            screen: `${window.screen?.width || 0}×${window.screen?.height || 0}`,
                            viewport: `${window.innerWidth}×${window.innerHeight}`
                        },
                        settingsSnapshot: sanitizedSettings,
                        logs: Logger.getGlobalBuffer().getAll(),
                        statistics: StatisticsCollector.getInstance().getSnapshot()
                    };

                    const jsonStr = JSON.stringify(bundle, null, 2);
                    downloadFile(jsonStr, `st-da-diagnostic-bundle-${Date.now()}.json`, 'application/json;charset=utf-8');
                    FeedbackService.toastSuccess('已成功导出脱敏系统诊断分析包 (.json)！');
                } catch (err: any) {
                    FeedbackService.toastError(`导出诊断包失败: ${err.message}`);
                }
            };

            rightGroup.appendChild(exportTxtBtn);
            rightGroup.appendChild(exportJsonBtn);
            rightGroup.appendChild(exportBundleBtn);

            toolbar.appendChild(leftGroup);
            toolbar.appendChild(rightGroup);
            body.appendChild(toolbar);

            const terminalBox = document.createElement('div');
            terminalBox.className = 'da-log-terminal';

            const renderLogStream = () => {
                terminalBox.innerHTML = '';
                const levelVal = levelSelect.value;
                const searchVal = searchInput.value.trim().toLowerCase();

                let entries = [...Logger.getGlobalBuffer().getAll()];
                if (levelVal !== 'ALL') {
                    entries = entries.filter((e: LogEntry) => e.level === levelVal);
                }
                if (searchVal) {
                    entries = entries.filter((e: LogEntry) => {
                        const line = `${e.namespace} ${e.message} ${e.level}`.toLowerCase();
                        return line.includes(searchVal);
                    });
                }

                if (entries.length === 0) {
                    terminalBox.innerHTML = '<div class="da-log-empty">暂无匹配的系统日志记录</div>';
                    return;
                }

                const fragment = document.createDocumentFragment();
                entries.forEach((e: LogEntry) => {
                    const line = document.createElement('div');
                    line.className = 'da-log-line';

                    const ts = new Date(e.timestamp).toTimeString().split(' ')[0];
                    const levelClass = `da-log-level da-log-level--${e.level.toLowerCase()}`;

                    const tsSpan = document.createElement('span');
                    tsSpan.className = 'da-log-timestamp';
                    tsSpan.textContent = `[${ts}]`;

                    const lvlSpan = document.createElement('span');
                    lvlSpan.className = levelClass;
                    lvlSpan.textContent = ` [${e.level}]`;

                    const nsSpan = document.createElement('span');
                    nsSpan.className = 'da-log-namespace';
                    nsSpan.textContent = ` [${e.namespace}]`;

                    line.appendChild(tsSpan);
                    line.appendChild(lvlSpan);
                    line.appendChild(nsSpan);
                    line.appendChild(document.createTextNode(` ${e.message}`));

                    fragment.appendChild(line);
                });

                terminalBox.appendChild(fragment);
                terminalBox.scrollTop = terminalBox.scrollHeight;
            };

            searchInput.oninput = () => renderLogStream();
            levelSelect.onchange = () => renderLogStream();
            refreshBtn.onclick = () => renderLogStream();

            renderLogStream();
            body.appendChild(terminalBox);
        }
    });
    container.appendChild(cardLogs);

    container.dispose = () => {
        // 当前无响应式订阅需清理
    };

    return container;
}
