/**
 * @module ui/views/diagnostics-tab
 * @description 运行诊断与系统健康检测面板视图 (DiagnosticsTabView)
 */

import { ConfigStore } from '../../core';
import { AdapterRegistry } from '../../domain/drivers/adapter-registry';
import { createCard, createCardHeader } from '../layout/container-factory';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';

export class DiagnosticsTabView extends BaseTabView {
    constructor(
        private readonly _store: ConfigStore,
        private readonly _adapters?: AdapterRegistry
    ) {
        super('da-diagnostics-tab');
        this._buildCards();
    }

    private _buildCards(): void {
        this._buildHealthOverviewCard();
        this._buildBackendScanCard();
        this._buildExportDiagnosticsCard();
    }

    /** 1. 客户端运行环境状态 */
    private _buildHealthOverviewCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '客户端环境健康状态',
            description: '探测浏览器存储、图形加速与网络通信环境'
        });
        card.header.appendChild(header);

        const gridEl = document.createElement('div');
        gridEl.className = 'da-macro-stats__grid';

        const isIndexedDBOk = typeof indexedDB !== 'undefined';
        const isCanvasOk = typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext('2d'));
        const isWorkerOk = typeof Worker !== 'undefined';
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

        const items = [
            { label: 'IndexedDB 本地存储', status: isIndexedDBOk ? '正常 (可用)' : '不可用', ok: isIndexedDBOk },
            { label: '2D / Canvas 绘图加速', status: isCanvasOk ? '正常 (已启用)' : '异常', ok: isCanvasOk },
            { label: 'Web Worker 多线程', status: isWorkerOk ? '支持' : '不支持', ok: isWorkerOk },
            { label: '网络通信在线状态', status: isOnline ? '在线 (Online)' : '离线', ok: isOnline }
        ];

        items.forEach((item) => {
            const itemCard = document.createElement('div');
            itemCard.className = `da-macro-stats__card ${item.ok ? 'is-success' : ''}`;
            itemCard.innerHTML = `
                <div class="da-macro-stats__card-label">${item.label}</div>
                <div class="da-macro-stats__card-value">${item.status}</div>
            `;
            gridEl.appendChild(itemCard);
        });

        card.body.appendChild(gridEl);
        this._root.appendChild(card.root);
    }

    /** 2. 各后端连通性批量扫描 */
    private _buildBackendScanCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '生图后端连通性扫描',
            description: '扫描当前已配置的各生图引擎服务网络连通性'
        });
        card.header.appendChild(header);

        const listContainer = document.createElement('div');
        listContainer.style.display = 'flex';
        listContainer.style.flexDirection = 'column';
        listContainer.style.gap = '8px';

        const scanBtn = document.createElement('button');
        scanBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        scanBtn.textContent = '立即扫描所有后端';

        const renderAdapters = async () => {
            listContainer.innerHTML = '';
            const allAdapters = this._adapters?.getAll() || [];

            if (allAdapters.length === 0) {
                listContainer.innerHTML = '<div style="color: var(--da-text-muted);">当前未挂载任何生图驱动</div>';
                return;
            }

            for (const adapter of allAdapters) {
                const row = document.createElement('div');
                row.className = 'da-status-item';
                row.style.justifyContent = 'space-between';
                row.style.padding = '8px 12px';
                row.style.background = 'var(--da-surface-card)';
                row.style.borderRadius = 'var(--da-radius, 8px)';

                const infoPart = document.createElement('div');
                infoPart.style.display = 'flex';
                infoPart.style.alignItems = 'center';
                infoPart.style.gap = '8px';

                const dot = document.createElement('span');
                dot.className = 'da-status-dot da-status-checking';

                const name = document.createElement('span');
                name.textContent = `${adapter.name} (${adapter.id})`;

                infoPart.appendChild(dot);
                infoPart.appendChild(name);

                const statusText = document.createElement('span');
                statusText.style.color = 'var(--da-text-muted)';
                statusText.textContent = '正在探测...';

                row.appendChild(infoPart);
                row.appendChild(statusText);
                listContainer.appendChild(row);

                try {
                    const res = await adapter.checkHealth();
                    if (res.ok) {
                        dot.className = 'da-status-dot da-status-ok';
                        statusText.textContent = `在线 (${res.latencyMs}ms)`;
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
                }
            }
        };

        scanBtn.onclick = () => {
            void renderAdapters();
        };

        const actionRow = document.createElement('div');
        actionRow.style.marginBottom = '12px';
        actionRow.appendChild(scanBtn);

        card.body.appendChild(actionRow);
        card.body.appendChild(listContainer);
        this._root.appendChild(card.root);

        // 初始自动扫描一次
        void renderAdapters();
    }

    /** 3. 诊断包导出 */
    private _buildExportDiagnosticsCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '诊断报告导出',
            description: '导出脱敏配置与环境运行信息，便于排查与技术反馈'
        });
        card.header.appendChild(header);

        const exportBtn = document.createElement('button');
        exportBtn.className = 'da-btn da-btn--primary';
        exportBtn.textContent = '下载脱敏诊断报告 (JSON)';
        exportBtn.onclick = () => {
            const report = {
                timestamp: new Date().toISOString(),
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
                settings: this._store.exportJson(true),
                activeProvider: this._store.get('activeProvider')
            };

            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `st-drawassistant-diagnostics-${Date.now()}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            FeedbackService.toastSuccess('已生成并下载诊断报告');
        };

        card.body.appendChild(exportBtn);
        this._root.appendChild(card.root);
    }
}
