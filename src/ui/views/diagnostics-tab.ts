/**
 * @module ui/views/diagnostics-tab
 * @description 运行诊断与实时日志统计面板视图 (DiagnosticsTabView)
 *
 * 核心设计范式 (参考 Grafana + VSCode Output Console)：
 * 1. 宏观生图数据大盘 (Statistics Dashboard)：4 栏等宽指标卡片 + 双列并排分析区 (常用底模占比 + 近 7 日趋势柱状图) + 报表导出；
 * 2. 客户端硬件与存储健康诊断 (Environment Health)：2x2 状态徽章网格 (WebGL、Worker 多线程、IndexedDB 数据库读写状态)；
 * 3. 专业级深色系统日志控制台 (Pro Console Terminal)：全宽搜索、纯净级别过滤、结构化等宽高亮行与一键全量脱敏诊断包。
 */

import {
    ObservableStore,
    DrawAssistantSettings,
    Logger,
    LogEntry,
    StatisticsCollector,
    exportStatisticsJSON,
    exportStatisticsCSV,
    EXTENSION_NAME
} from '../../core';
import { UpdateService } from '../../domain';
import { createCard, createCardHeader } from '../layout/container-factory';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';

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
 * 递归深度脱敏数据结构（掩码所有 API Key、Token 字段以及日志中包含的 Bearer 授权令牌）
 */
export function sanitizeDataForExport(data: any): any {
    if (data === null || data === undefined) return data;
    if (typeof data === 'string') {
        return data
            .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{8,}/gi, '$1****[REDACTED]****')
            .replace(/(pst-[A-Za-z0-9_\-]{8,})/gi, 'pst-****[REDACTED]****')
            .replace(/(sk-[A-Za-z0-9_\-]{8,})/gi, 'sk-****[REDACTED]****');
    }
    if (Array.isArray(data)) {
        return data.map((item) => sanitizeDataForExport(item));
    }
    if (typeof data === 'object') {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(data)) {
            if (/(api)?_?key|token|secret|auth|password/i.test(key)) {
                result[key] = '****[SENSITIVE_REDACTED]****';
            } else {
                result[key] = sanitizeDataForExport(value);
            }
        }
        return result;
    }
    return data;
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

    // 1. 四栏核心指标数据卡片
    const grid = document.createElement('div');
    grid.className = 'da-macro-stats__grid';

    const createMetricCard = (label: string, val: string, sub: string, isSuccess?: boolean) => {
        const card = document.createElement('div');
        card.className = `da-macro-stats__card ${isSuccess ? 'is-success' : ''}`;

        const labelEl = document.createElement('div');
        labelEl.className = 'da-macro-stats__card-label';
        labelEl.textContent = label;

        const valEl = document.createElement('div');
        valEl.className = 'da-macro-stats__card-val';
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
            true
        )
    );
    grid.appendChild(
        createMetricCard(
            '平均生成耗时',
            `${avgSec} 秒/张`,
            snap.minDurationMs > 0 ? `最快 ${(snap.minDurationMs / 1000).toFixed(1)}s` : '推理速度'
        )
    );
    grid.appendChild(createMetricCard('最近生图活动', lastTimeStr, '生成活跃度'));
    container.appendChild(grid);

    // 2. 双列并排分析网格 (左侧：常用模型分布，右侧：近 7 日趋势柱状图)
    const analyticsRow = document.createElement('div');
    analyticsRow.className = 'da-macro-stats__analytics-row';

    // 2.1 常用底模分布占比 (Top Checkpoints)
    const modelSection = document.createElement('div');
    modelSection.className = 'da-macro-stats__section da-macro-stats__section--models';

    const modelTitle = document.createElement('div');
    modelTitle.className = 'da-macro-stats__section-title';
    modelTitle.textContent = '常用生图模型分布 (Top Models)';
    modelSection.appendChild(modelTitle);

    const modelList = document.createElement('div');
    modelList.className = 'da-macro-stats__model-list';

    const topModels = collector.getTopItems(snap.paramStats.models, 4);
    if (topModels.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'da-macro-stats__empty-tip';
        emptyEl.textContent = '暂无模型使用记录';
        modelList.appendChild(emptyEl);
    } else {
        topModels.forEach((item) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'da-macro-stats__model-item';

            const infoEl = document.createElement('div');
            infoEl.className = 'da-macro-stats__model-info';

            const nameEl = document.createElement('span');
            nameEl.className = 'da-macro-stats__model-name';
            nameEl.textContent = item.name;
            nameEl.title = item.name;

            const pctEl = document.createElement('span');
            pctEl.className = 'da-macro-stats__model-pct';
            pctEl.textContent = `${item.percentage}% (${item.count}次)`;

            infoEl.appendChild(nameEl);
            infoEl.appendChild(pctEl);

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
    }

    modelSection.appendChild(modelList);
    analyticsRow.appendChild(modelSection);

    // 2.2 近 7 日生图产出趋势柱状图
    const dailyTrend = collector.getDailyTrend(7);
    const maxCount = Math.max(...dailyTrend.map((d) => d.count), 1);

    const trendSection = document.createElement('div');
    trendSection.className = 'da-macro-stats__section da-macro-stats__section--trend';

    const trendTitle = document.createElement('div');
    trendTitle.className = 'da-macro-stats__section-title';
    trendTitle.textContent = '近 7 日生图产出趋势 (7-Day Trend)';
    trendSection.appendChild(trendTitle);

    const chartEl = document.createElement('div');
    chartEl.className = 'da-macro-stats__trend-chart';

    dailyTrend.forEach((item, index) => {
        const col = document.createElement('div');
        col.className = 'da-macro-stats__trend-col';
        col.title = `${item.date}: 生成 ${item.count} 张图片`;

        const countText = document.createElement('div');
        countText.className = 'da-macro-stats__trend-count';
        countText.textContent = item.count > 0 ? String(item.count) : '';

        const barWrapper = document.createElement('div');
        barWrapper.className = 'da-macro-stats__trend-bar-wrapper';

        const bar = document.createElement('div');
        bar.className = 'da-macro-stats__trend-bar';
        const heightPct = Math.round((item.count / maxCount) * 100);
        bar.style.height = `${Math.max(heightPct, item.count > 0 ? 8 : 4)}%`;
        if (item.count === 0) bar.style.opacity = '0.2';

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
    analyticsRow.appendChild(trendSection);
    container.appendChild(analyticsRow);

    // 3. 数据报表导出操作栏
    const actionsRow = document.createElement('div');
    actionsRow.className = 'da-macro-stats__actions';

    const btnExportJSON = document.createElement('button');
    btnExportJSON.className = 'da-btn da-btn--secondary da-btn--sm';
    btnExportJSON.textContent = '导出 JSON';
    btnExportJSON.onclick = () => {
        exportStatisticsJSON(snap);
        FeedbackService.toastSuccess('生图统计报表 JSON 导出完成');
    };

    const btnExportCSV = document.createElement('button');
    btnExportCSV.className = 'da-btn da-btn--secondary da-btn--sm';
    btnExportCSV.textContent = '导出 CSV';
    btnExportCSV.onclick = () => {
        exportStatisticsCSV(snap);
        FeedbackService.toastSuccess('生图趋势报表 CSV 导出完成');
    };

    const btnReset = document.createElement('button');
    btnReset.className = 'da-btn da-btn--danger da-btn--sm';
    btnReset.textContent = '重置统计';
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
 * 运行诊断与实时日志面板视图
 */
export class DiagnosticsTabView extends BaseTabView {
    constructor(private readonly _store: ObservableStore<DrawAssistantSettings>) {
        super('da-diagnostics-tab');
        this._buildCards();
    }

    private _buildCards(): void {
        const store = this._store;

        // ── Module 1: 生图业务宏观统计看板 ──────────────────────────
        const cardStats = createCard({ hoverable: true });
        const headerStats = createCardHeader({
            title: '生图业务宏观统计看板',
            description: '实时监控生图成功率、生成耗时与产出趋势，支持导出分析报表'
        });
        cardStats.header.appendChild(headerStats);
        cardStats.body.appendChild(renderStatisticsCard());
        this._root.appendChild(cardStats.root);

        // ── Module 2: 客户端环境与存储健康诊断卡片 ─────────────────────────────────
        const cardEnv = createCard({ hoverable: true });
        const headerEnv = createCardHeader({
            title: '客户端环境与存储健康诊断',
            description: '检测当前浏览器渲染引擎 GPU 硬件加速、多线程离屏转码支持与 IndexedDB 数据库健康度'
        });
        cardEnv.header.appendChild(headerEnv);

        const envGrid = document.createElement('div');
        envGrid.className = 'da-diagnostics-env-grid';

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

        const isOffscreenSupported = typeof window !== 'undefined' && typeof window.OffscreenCanvas !== 'undefined';
        const isWorkerSupported = typeof window !== 'undefined' && typeof window.Worker !== 'undefined';
        const workerReady = isOffscreenSupported && isWorkerSupported;
        const isIndexedDBSupported = typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

        const screenW = typeof window !== 'undefined' ? window.screen?.width || 0 : 0;
        const screenH = typeof window !== 'undefined' ? window.screen?.height || 0 : 0;
        const innerW = typeof window !== 'undefined' ? window.innerWidth || 0 : 0;
        const innerH = typeof window !== 'undefined' ? window.innerHeight || 0 : 0;

        const createEnvCard = (title: string, desc: string, isOk: boolean, icon: string) => {
            const card = document.createElement('div');
            card.className = `da-diagnostics-env-card ${isOk ? 'is-ok' : 'is-warn'}`;
            card.innerHTML = `
                <div class="da-diagnostics-env-header">
                    <span class="da-diagnostics-env-icon">${icon}</span>
                    <span class="da-diagnostics-env-title">${title}</span>
                </div>
                <div class="da-diagnostics-env-desc">${desc}</div>
            `;
            return card;
        };

        envGrid.appendChild(
            createEnvCard(
                'WebGL 硬件加速',
                isWebGLSupported ? 'GPU 渲染加速管线已就绪' : '不支持或已被禁用',
                isWebGLSupported,
                isWebGLSupported ? '🟢' : '🔴'
            )
        );

        envGrid.appendChild(
            createEnvCard(
                '多线程离屏转码',
                workerReady ? 'Web Worker & OffscreenCanvas 就绪' : '基础兼容模式 (主线程转码)',
                workerReady,
                workerReady ? '🟢' : '🟡'
            )
        );

        envGrid.appendChild(
            createEnvCard(
                'IndexedDB 数据库',
                isIndexedDBSupported ? '本地数据库读写正常 (v2)' : '不可用 (降级为内存存储)',
                isIndexedDBSupported,
                isIndexedDBSupported ? '🟢' : '🔴'
            )
        );

        const isStConnected = typeof window !== 'undefined' && !!(window as any).SillyTavern?.getContext;
        const requestMode = store.getState().requestMode || 'client';
        const requestModeLabel = requestMode === 'server' ? '服务端代理 (Pattern A)' : '客户端直连 (Pattern B)';

        envGrid.appendChild(
            createEnvCard(
                'SillyTavern 宿主环境',
                isStConnected ? 'SillyTavern 上下文已就绪' : '独立测试/离线运行环境',
                isStConnected,
                isStConnected ? '🟢' : '⚪'
            )
        );

        envGrid.appendChild(
            createEnvCard(
                '生图通信请求模式',
                requestModeLabel,
                true,
                '🌐'
            )
        );

        envGrid.appendChild(
            createEnvCard(
                '视口与屏幕规格',
                `屏幕 ${screenW}×${screenH} px (视口: ${innerW}×${innerH} px)`,
                true,
                '💻'
            )
        );

        cardEnv.body.appendChild(envGrid);
        this._root.appendChild(cardEnv.root);

        // ── Module 3: 实时系统日志与脱敏诊断导出卡片 ─────────────────────────────
        const cardLogs = createCard({ hoverable: true });
        const headerLogs = createCardHeader({
            title: '实时系统日志与脱敏诊断控制台',
            description: '结构化实时日志流，支持按级别过滤、即时搜索、日志导出及一键打包脱敏诊断数据'
        });
        cardLogs.header.appendChild(headerLogs);

        const toolbar = document.createElement('div');
        toolbar.className = 'da-diagnostics-toolbar';

        const leftGroup = document.createElement('div');
        leftGroup.className = 'da-diagnostics-toolbar-left';

        const levelSelect = document.createElement('select');
        levelSelect.className = 'da-select da-select-sm';
        levelSelect.innerHTML = `
            <option value="ALL">全部级别 (ALL)</option>
            <option value="INFO">信息 (INFO)</option>
            <option value="WARN">警告 (WARN)</option>
            <option value="ERROR">错误 (ERROR)</option>
            <option value="DEBUG">调试 (DEBUG)</option>
        `;

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'da-input da-input-sm';
        searchInput.placeholder = '过滤日志关键词 (命名空间/内容)...';

        leftGroup.appendChild(levelSelect);
        leftGroup.appendChild(searchInput);

        const rightGroup = document.createElement('div');
        rightGroup.className = 'da-diagnostics-toolbar-right';

        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        refreshBtn.textContent = '刷新日志';

        const exportTxtBtn = document.createElement('button');
        exportTxtBtn.type = 'button';
        exportTxtBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        exportTxtBtn.textContent = '导出明文 TXT';
        exportTxtBtn.onclick = () => {
            const entries = Logger.getGlobalBuffer().getAll();
            const text = entries
                .map((e) => `[${new Date(e.timestamp).toISOString()}] [${e.level}] [${e.namespace}] ${e.message}`)
                .join('\n');
            downloadFile(text, `st-da-logs-${Date.now()}.txt`, 'text/plain;charset=utf-8');
            FeedbackService.toastSuccess('运行日志已成功导出 (.txt)');
        };

        const exportJsonBtn = document.createElement('button');
        exportJsonBtn.type = 'button';
        exportJsonBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        exportJsonBtn.textContent = '导出 JSON';
        exportJsonBtn.onclick = () => {
            const jsonStr = JSON.stringify(Logger.getGlobalBuffer().getAll(), null, 2);
            downloadFile(jsonStr, `st-da-logs-${Date.now()}.json`, 'application/json;charset=utf-8');
            FeedbackService.toastSuccess('运行日志已成功导出 (.json)');
        };

        const exportBundleBtn = document.createElement('button');
        exportBundleBtn.type = 'button';
        exportBundleBtn.className = 'da-btn da-btn--primary da-btn--sm';
        exportBundleBtn.textContent = '📦 导出脱敏诊断包';
        exportBundleBtn.onclick = async () => {
            try {
                const rawSettings = store.getState();
                const sanitizedSettings = sanitizeDataForExport(rawSettings);
                const sanitizedLogs = sanitizeDataForExport(Logger.getGlobalBuffer().getAll());
                const statsSnapshot = StatisticsCollector.getInstance().getSnapshot();

                const bundle = {
                    exportedAt: new Date().toISOString(),
                    extension: EXTENSION_NAME,
                    versionState: UpdateService.getInstance().getState(),
                    settings: sanitizedSettings,
                    statistics: statsSnapshot,
                    logs: sanitizedLogs
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
        cardLogs.body.appendChild(toolbar);

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
        cardLogs.body.appendChild(terminalBox);
        this._root.appendChild(cardLogs.root);
    }
}

