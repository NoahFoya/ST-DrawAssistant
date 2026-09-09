/**
 * 日志与统计面板视图 (DiagnosticsTabView)
 * 包含生图数据统计、运行环境状态、后端连通性测试与运行日志
 */

import { Logger, StatisticsCollector, LogEntry, exportStatisticsJSON, exportStatisticsCSV } from '../../utils';
import { SettingsStore } from '../../state';
import { DriverRegistry } from '../../services/drivers';
import { createCard, createCardHeader } from '../layout/container-factory';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';
import { escapeHtml } from '../foundation/utils';

export class DiagnosticsTabView extends BaseTabView {
    constructor(
        private readonly _store: SettingsStore,
        private readonly _drivers?: DriverRegistry
    ) {
        super('da-diagnostics-tab');
        this._buildCards();
    }

    private _buildCards(): void {
        this._buildStatisticsCard();
        this._buildHealthOverviewCard();
        this._buildBackendScanCard();
        this._buildLogsAndExportCard();
    }

    /** 1. 生图数据统计 */
    private _buildStatisticsCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '生图数据统计',
            description: '查看生图总量、成功率、平均耗时、模型使用与近期趋势'
        });
        card.header.appendChild(header);

        const container = document.createElement('div');
        container.className = 'da-macro-stats';

        const renderStatsView = () => {
            container.innerHTML = '';

            const collector = StatisticsCollector.getInstance();
            const snap = collector.getSnapshot();

            const totalTasks = snap.totalTasks;
            const successCount = snap.successCount;
            const successRate = collector.getSuccessRate();
            const avgDurationMs = collector.getAverageDuration();
            const avgSec = (avgDurationMs / 1000).toFixed(1);
            const minSec = snap.minDurationMs > 0 ? (snap.minDurationMs / 1000).toFixed(1) : '0';

            let lastTimeStr = '暂无记录';
            if (snap.timeStats.lastTaskAt > 0) {
                const diffMin = Math.floor((Date.now() - snap.timeStats.lastTaskAt) / 60000);
                if (diffMin < 1) lastTimeStr = '刚刚';
                else if (diffMin < 60) lastTimeStr = `${diffMin}分钟前`;
                else if (diffMin < 1440) lastTimeStr = `${Math.floor(diffMin / 60)}小时前`;
                else lastTimeStr = new Date(snap.timeStats.lastTaskAt).toISOString().split('T')[0];
            }

            // 核心指标数据卡片
            const grid = document.createElement('div');
            grid.className = 'da-macro-stats__grid';

            const createMetricCard = (label: string, val: string, sub: string, isSuccess?: boolean) => {
                const itemCard = document.createElement('div');
                itemCard.className = `da-macro-stats__card ${isSuccess ? 'is-success' : ''}`;

                const labelEl = document.createElement('div');
                labelEl.className = 'da-macro-stats__card-label';
                labelEl.textContent = label;

                const valEl = document.createElement('div');
                valEl.className = 'da-macro-stats__card-val';
                valEl.textContent = val;

                const subEl = document.createElement('div');
                subEl.className = 'da-macro-stats__card-sub';
                subEl.textContent = sub;

                itemCard.appendChild(labelEl);
                itemCard.appendChild(valEl);
                itemCard.appendChild(subEl);
                return itemCard;
            };

            grid.appendChild(createMetricCard('累计生图量', `${successCount} 张`, `总任务 ${totalTasks} 次`));
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
                    snap.minDurationMs > 0 ? `最快 ${minSec}s` : '推理性能'
                )
            );
            grid.appendChild(createMetricCard('最近生图活动', lastTimeStr, '生成活跃度'));
            container.appendChild(grid);

            // 双列统计分析：常用模型分布与趋势柱状图
            const analyticsRow = document.createElement('div');
            analyticsRow.className = 'da-macro-stats__analytics-row';

            // 左侧：常用模型分布
            const modelSection = document.createElement('div');
            modelSection.className = 'da-macro-stats__section da-macro-stats__section--models';

            const modelTitle = document.createElement('div');
            modelTitle.className = 'da-macro-stats__section-title';
            modelTitle.textContent = '常用模型分布';
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

            // 右侧：近 7 日产出趋势柱状图
            const dailyTrend = collector.getDailyTrend(7);
            const maxCount = Math.max(...dailyTrend.map((d) => d.count), 1);

            const trendSection = document.createElement('div');
            trendSection.className = 'da-macro-stats__section da-macro-stats__section--trend';

            const trendTitle = document.createElement('div');
            trendTitle.className = 'da-macro-stats__section-title';
            trendTitle.textContent = '近 7 日产出趋势';
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

            // 统计报表操作栏
            const actionsRow = document.createElement('div');
            actionsRow.className = 'da-macro-stats__actions';

            const btnExportJSON = document.createElement('button');
            btnExportJSON.type = 'button';
            btnExportJSON.className = 'da-btn da-btn--secondary da-btn--sm';
            btnExportJSON.textContent = '导出统计数据';
            btnExportJSON.onclick = () => {
                exportStatisticsJSON(snap);
                FeedbackService.toastSuccess('生图统计报表已导出 (.json)');
            };

            const btnExportCSV = document.createElement('button');
            btnExportCSV.type = 'button';
            btnExportCSV.className = 'da-btn da-btn--secondary da-btn--sm';
            btnExportCSV.textContent = '导出生成趋势';
            btnExportCSV.onclick = () => {
                exportStatisticsCSV(snap);
                FeedbackService.toastSuccess('生图趋势报表已导出 (.csv)');
            };

            const btnReset = document.createElement('button');
            btnReset.type = 'button';
            btnReset.className = 'da-btn da-btn--danger da-btn--sm';
            btnReset.textContent = '重置统计数据';
            btnReset.onclick = async () => {
                const confirmed = await FeedbackService.confirm({
                    title: '重置生图统计确认',
                    message: '确定要清空所有历史生图统计数据吗？此操作无法撤销。',
                    confirmText: '确认清空'
                });
                if (confirmed) {
                    await collector.reset();
                    FeedbackService.toastSuccess('生图历史统计已成功清空');
                    renderStatsView();
                }
            };

            actionsRow.appendChild(btnExportJSON);
            actionsRow.appendChild(btnExportCSV);
            actionsRow.appendChild(btnReset);
            container.appendChild(actionsRow);
        };

        renderStatsView();
        card.body.appendChild(container);
        this._root.appendChild(card.root);
    }

    /** 2. 运行环境健康状态 */
    private _buildHealthOverviewCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '运行环境健康',
            description: '探测浏览器存储、图形加速、多线程及宿主运行环境'
        });
        card.header.appendChild(header);

        const gridEl = document.createElement('div');
        gridEl.className = 'da-diagnostics-env-grid';

        const isIndexedDBOk = typeof indexedDB !== 'undefined';
        const isCanvasOk = typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext('2d'));
        const isWorkerOk = typeof Worker !== 'undefined';
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
        const isStConnected = typeof window !== 'undefined' && Boolean((window as any).SillyTavern?.getContext);
        const items = [
            {
                label: '本地数据库存储',
                status: isIndexedDBOk ? '正常可用' : '不可用',
                ok: isIndexedDBOk,
                icon: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>`
            },
            {
                label: 'Canvas 绘图加速',
                status: isCanvasOk ? '已启用' : '异常',
                ok: isCanvasOk,
                icon: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`
            },
            {
                label: '后台多线程加速',
                status: isWorkerOk ? '支持' : '不支持',
                ok: isWorkerOk,
                icon: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>`
            },
            {
                label: '网络在线状态',
                status: isOnline ? '已联网' : '未联网',
                ok: isOnline,
                icon: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`
            },
            {
                label: 'SillyTavern 宿主',
                status: isStConnected ? '上下文就绪' : '离线运行',
                ok: isStConnected,
                icon: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`
            },
            {
                label: '生图通信模式',
                status: '浏览器直连',
                ok: true,
                icon: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`
            }
        ];

        items.forEach((item) => {
            const itemCard = document.createElement('div');
            itemCard.className = `da-diagnostics-env-card ${item.ok ? 'is-ok' : 'is-warn'}`;
            itemCard.innerHTML = `
                <div class="da-diagnostics-env-header">
                    <span class="da-diagnostics-env-icon">${item.icon}</span>
                    <span class="da-diagnostics-env-title">${escapeHtml(item.label)}</span>
                </div>
                <div class="da-diagnostics-env-desc">${escapeHtml(item.status)}</div>
            `;
            gridEl.appendChild(itemCard);
        });

        card.body.appendChild(gridEl);
        this._root.appendChild(card.root);
    }

    /** 3. 后端连通性测试 */
    private _buildBackendScanCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '生图后端连通性',
            description: '探测各生图引擎服务的基础网络连通性与响应延迟'
        });
        card.header.appendChild(header);

        const listContainer = document.createElement('div');
        listContainer.style.display = 'flex';
        listContainer.style.flexDirection = 'column';
        listContainer.style.gap = '8px';

        const actionRow = document.createElement('div');
        actionRow.style.display = 'flex';
        actionRow.style.alignItems = 'center';
        actionRow.style.gap = '8px';
        actionRow.style.marginBottom = '12px';

        const scanBtn = document.createElement('button');
        scanBtn.type = 'button';
        scanBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        scanBtn.textContent = '立即扫描所有后端';

        actionRow.appendChild(scanBtn);

        const renderDrivers = () => {
            listContainer.innerHTML = '';
            const allDrivers = this._drivers?.getAll() || [];

            if (allDrivers.length === 0) {
                listContainer.innerHTML = '<div style="color: var(--da-text-muted); padding: 12px 0;">当前未挂载任何生图驱动</div>';
                return;
            }

            allDrivers.forEach((driver) => {
                const row = document.createElement('div');
                row.className = 'da-status-item';
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.alignItems = 'center';
                row.style.padding = '10px 14px';
                row.style.background = 'var(--da-bg-primary)';
                row.style.border = '1px solid var(--da-separator)';
                row.style.borderRadius = 'var(--da-radius-sm, 8px)';

                const infoPart = document.createElement('div');
                infoPart.style.display = 'flex';
                infoPart.style.alignItems = 'center';
                infoPart.style.gap = '10px';

                const dot = document.createElement('span');
                dot.className = 'da-status-dot da-status-checking';

                const name = document.createElement('span');
                name.style.fontWeight = '600';
                name.style.fontSize = '13px';
                name.textContent = `${driver.name} (${driver.id})`;

                infoPart.appendChild(dot);
                infoPart.appendChild(name);

                const rightPart = document.createElement('div');
                rightPart.style.display = 'flex';
                rightPart.style.alignItems = 'center';
                rightPart.style.gap = '12px';

                const statusText = document.createElement('span');
                statusText.style.fontSize = '12px';
                statusText.style.color = 'var(--da-text-muted)';
                statusText.textContent = '等待探测...';

                const testBtn = document.createElement('button');
                testBtn.type = 'button';
                testBtn.className = 'da-btn da-btn--secondary da-btn--sm';
                testBtn.style.padding = '2px 10px';
                testBtn.style.fontSize = '12px';
                testBtn.textContent = '测试';

                const runProbe = async () => {
                    dot.className = 'da-status-dot da-status-checking';
                    statusText.style.color = 'var(--da-text-muted)';
                    statusText.textContent = '探测中...';
                    testBtn.disabled = true;

                    try {
                        const res = await driver.checkHealth();
                        if (res.ok) {
                            dot.className = 'da-status-dot da-status-ok';
                            statusText.textContent = `在线 (${res.latencyMs || 0}ms)`;
                            statusText.style.color = 'var(--da-success, #22c55e)';
                        } else {
                            dot.className = 'da-status-dot da-status-error';
                            statusText.textContent = res.message || '离线';
                            statusText.style.color = 'var(--da-error, #ef4444)';
                        }
                    } catch {
                        dot.className = 'da-status-dot da-status-error';
                        statusText.textContent = '通信异常';
                        statusText.style.color = 'var(--da-error, #ef4444)';
                    } finally {
                        testBtn.disabled = false;
                    }
                };

                testBtn.onclick = () => void runProbe();

                rightPart.appendChild(statusText);
                rightPart.appendChild(testBtn);

                row.appendChild(infoPart);
                row.appendChild(rightPart);
                listContainer.appendChild(row);

                // 异步并发执行单项探测
                void runProbe();
            });
        };

        scanBtn.onclick = () => renderDrivers();

        card.body.appendChild(actionRow);
        card.body.appendChild(listContainer);
        this._root.appendChild(card.root);

        renderDrivers();
    }

    /** 4. 系统运行日志与诊断报告导出 */
    private _buildLogsAndExportCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '系统运行日志与诊断导出',
            description: '查看实时系统日志流，过滤运行事件并导出脱敏诊断分析包'
        });
        card.header.appendChild(header);

        // 终端过滤工具栏
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
        searchInput.className = 'da-input da-input-sm da-diagnostics-search';
        searchInput.placeholder = '过滤日志关键词 (模块/内容)...';

        leftGroup.appendChild(levelSelect);
        leftGroup.appendChild(searchInput);

        const rightGroup = document.createElement('div');
        rightGroup.className = 'da-diagnostics-toolbar-right';

        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        refreshBtn.textContent = '刷新日志';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        clearBtn.textContent = '清空屏幕';

        rightGroup.appendChild(refreshBtn);
        rightGroup.appendChild(clearBtn);

        toolbar.appendChild(leftGroup);
        toolbar.appendChild(rightGroup);
        card.body.appendChild(toolbar);

        // 日志终端流视口
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
                terminalBox.innerHTML = '<div class="da-log-empty">暂无匹配的系统运行日志</div>';
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
                lvlSpan.textContent = `[${e.level}]`;

                const nsSpan = document.createElement('span');
                nsSpan.className = 'da-log-namespace';
                nsSpan.textContent = `[${e.namespace}]`;

                const msgSpan = document.createElement('span');
                msgSpan.className = 'da-log-msg';
                msgSpan.textContent = e.message;

                line.appendChild(tsSpan);
                line.appendChild(lvlSpan);
                line.appendChild(nsSpan);
                line.appendChild(msgSpan);

                fragment.appendChild(line);
            });

            terminalBox.appendChild(fragment);
            terminalBox.scrollTop = terminalBox.scrollHeight;
        };

        searchInput.oninput = () => renderLogStream();
        levelSelect.onchange = () => renderLogStream();
        refreshBtn.onclick = () => renderLogStream();
        clearBtn.onclick = () => {
            terminalBox.innerHTML = '<div class="da-log-empty">日志视图已清空 (历史缓冲依然保留)</div>';
        };

        renderLogStream();
        card.body.appendChild(terminalBox);

        // 诊断报告导出操作栏
        const exportRow = document.createElement('div');
        exportRow.style.display = 'flex';
        exportRow.style.alignItems = 'center';
        exportRow.style.gap = '10px';
        exportRow.style.marginTop = '12px';
        exportRow.style.paddingTop = '12px';
        exportRow.style.borderTop = '1px solid var(--da-separator)';
        exportRow.style.flexWrap = 'wrap';

        const exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.className = 'da-btn da-btn--primary da-btn--sm';
        exportBtn.textContent = '下载脱敏诊断报告';
        exportBtn.onclick = () => {
            const rawSettings = this._store.exportJson(true);
            const statsSnapshot = StatisticsCollector.getInstance().getSnapshot();
            const logsSnapshot = Logger.getGlobalBuffer().getAll().slice(-100);

            const report = {
                timestamp: new Date().toISOString(),
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
                activeProvider: this._store.get('activeProvider'),
                statistics: statsSnapshot,
                settings: rawSettings,
                logs: logsSnapshot
            };

            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `st-drawassistant-diagnostics-${Date.now()}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            FeedbackService.toastSuccess('已生成并下载脱敏诊断分析包');
        };

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        copyBtn.textContent = '复制诊断简报';
        copyBtn.onclick = () => {
            const stats = StatisticsCollector.getInstance().getSnapshot();
            const summary = [
                `### ST-DrawAssistant 诊断简报`,
                `- **生成时间**: ${new Date().toLocaleString()}`,
                `- **活动引擎**: ${this._store.get('activeProvider') || '未指定'}`,
                `- **通信模式**: 浏览器直连`,
                `- **生图概览**: 成功 ${stats.successCount} / 失败 ${stats.errorCount} (成功率 ${StatisticsCollector.getInstance().getSuccessRate()}%)`,
                `- **平均耗时**: ${(StatisticsCollector.getInstance().getAverageDuration() / 1000).toFixed(1)} 秒/张`,
                `- **运行环境**: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js'}`
            ].join('\n');

            if (navigator?.clipboard?.writeText) {
                void navigator.clipboard.writeText(summary).then(() => {
                    FeedbackService.toastSuccess('诊断简报已复制到剪贴板');
                });
            } else {
                FeedbackService.toastSuccess('诊断简报已生成');
            }
        };

        exportRow.appendChild(exportBtn);
        exportRow.appendChild(copyBtn);
        card.body.appendChild(exportRow);

        this._root.appendChild(card.root);
    }
}

