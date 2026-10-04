/**
 * 关于与支持专属选项卡主视图 (AboutTabView)。
 *
 * @remarks
 * 为绘图助手提供版本开源信息展示、环境诊断数据收集与全量数据运维能力：
 * 1. 版本与开源信息卡片：展示插件名称、当前版本、作者、开源协议与 GitHub 仓库入口；
 * 2. 运行环境与系统诊断卡片：实时检测宿主 SillyTavern 状态、浏览器内核与存储配额，支持一键复制 Issue 诊断报告；
 * 3. 数据运维与全量备份卡片：提供插件完整配置与预设方案的 JSON 导出、外部备份导入及恢复出厂设置。
 */

import type { SettingsView, Disposable } from '../types';
import { Card } from '../components/card';
import { Button } from '../components/button';
import { settingsStore } from '../../store/settings-store';
import { imageStorage } from '../../store/image-storage';
import { logger } from '../../util/logger';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { Toast } from '../feedback/toast';

export class AboutTabView implements SettingsView {
    public readonly id = 'about';
    public readonly title = '关于与支持';
    public readonly element: HTMLElement;

    private readonly disposables: Disposable[] = [];
    private fileInput: HTMLInputElement | null = null;
    private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

    public constructor() {
        this.element = document.createElement('div');
        this.element.className = 'da-tab-pane da-view-about';

        this.buildLayout();
    }

    private buildLayout(): void {
        const aboutCard = this.buildAboutCard();
        const diagnosticCard = this.buildDiagnosticCard();
        const maintenanceCard = this.buildMaintenanceCard();

        this.element.appendChild(aboutCard.element);
        this.element.appendChild(diagnosticCard.element);
        this.element.appendChild(maintenanceCard.element);

        this.disposables.push(aboutCard, diagnosticCard, maintenanceCard);
    }

    // 1. 版本与开源信息卡片

    private buildAboutCard(): Card {
        const card = new Card({
            title: 'Starlight DrawAssistant',
            subtitle: '轻量可靠、开箱即用的 SillyTavern AI 生图扩展插件',
            collapsible: true,
            defaultCollapsed: false,
        });

        const body = card.getBodyElement();

        // 核心功能亮点描述
        const intro = document.createElement('div');
        intro.className = 'da-about-intro';
        intro.style.fontSize = '13px';
        intro.style.lineHeight = '1.6';
        intro.style.opacity = '0.88';
        intro.style.marginBottom = '14px';
        intro.innerHTML = `
            为 SillyTavern 提供情境感知的智能 AI 绘图支持，涵盖四大主流生图服务后端（ComfyUI、SD-WebUI / Forge、NovelAI、OpenAI 兼容服务），
            具备浏览器端本地存储唯一事实主库 (SSOT)、流式进度与耗时监控、预设方案管理与自然语言提示词处理流程。
        `;
        body.appendChild(intro);

        // 项目元数据键值表
        const infoGrid = document.createElement('div');
        infoGrid.className = 'da-info-grid';
        infoGrid.style.display = 'grid';
        infoGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
        infoGrid.style.gap = '8px 16px';
        infoGrid.style.padding = '12px';
        infoGrid.style.borderRadius = 'var(--da-radius-md, 8px)';
        infoGrid.style.background = 'var(--da-bg-subtle, rgba(255, 255, 255, 0.04))';
        infoGrid.style.border = '1px solid var(--da-border-color, rgba(255, 255, 255, 0.08))';
        infoGrid.style.marginBottom = '14px';

        const createInfoItem = (label: string, value: string) => {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.flexDirection = 'column';
            item.style.gap = '2px';

            const l = document.createElement('span');
            l.style.fontSize = '11px';
            l.style.opacity = '0.65';
            l.textContent = label;

            const v = document.createElement('span');
            v.style.fontSize = '13px';
            v.style.fontWeight = '500';
            v.textContent = value;

            item.appendChild(l);
            item.appendChild(v);
            return item;
        };

        infoGrid.appendChild(createInfoItem('当前插件版本', 'v0.4.0 (Beta)'));
        infoGrid.appendChild(createInfoItem('开发者', 'NoahFoya'));
        infoGrid.appendChild(createInfoItem('开源许可证', 'GPL-3.0 License'));
        infoGrid.appendChild(createInfoItem('架构模式', 'SSOT + Composite Cards'));

        body.appendChild(infoGrid);

        // 外部跳转快捷操作栏
        const actionRow = document.createElement('div');
        actionRow.style.display = 'flex';
        actionRow.style.gap = '10px';
        actionRow.style.flexWrap = 'wrap';

        const githubBtn = new Button({
            label: '访问 GitHub 仓库 ↗',
            variant: 'secondary',
            onClick: () => {
                if (typeof window !== 'undefined') {
                    window.open('https://github.com/NoahFoya/ST-DrawAssistant', '_blank', 'noopener,noreferrer');
                }
            },
        });

        const issuesBtn = new Button({
            label: '提交 Issue 反馈 ↗',
            variant: 'secondary',
            onClick: () => {
                if (typeof window !== 'undefined') {
                    window.open('https://github.com/NoahFoya/ST-DrawAssistant/issues', '_blank', 'noopener,noreferrer');
                }
            },
        });

        actionRow.appendChild(githubBtn.element);
        actionRow.appendChild(issuesBtn.element);
        body.appendChild(actionRow);

        this.disposables.push(githubBtn, issuesBtn);
        return card;
    }

    // 2. 运行环境与诊断信息卡片

    private buildDiagnosticCard(): Card {
        const card = new Card({
            title: '运行环境与系统诊断',
            subtitle: '实时探测宿主、浏览器内核与存储支持状态，排障时可一键生成诊断报告',
            collapsible: true,
            defaultCollapsed: false,
        });

        const body = card.getBodyElement();

        // 诊断环境概览容器
        const envContainer = document.createElement('div');
        envContainer.className = 'da-env-container';
        envContainer.style.fontSize = '12px';
        envContainer.style.lineHeight = '1.7';
        envContainer.style.padding = '12px';
        envContainer.style.borderRadius = 'var(--da-radius-md, 8px)';
        envContainer.style.background = 'var(--da-bg-subtle, rgba(255, 255, 255, 0.04))';
        envContainer.style.border = '1px solid var(--da-border-color, rgba(255, 255, 255, 0.08))';
        envContainer.style.marginBottom = '14px';

        const updateEnvView = async () => {
            const hasST = typeof window !== 'undefined' && Boolean(window.SillyTavern?.getContext);
            const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '未知环境';
            const estimate = await imageStorage.getStorageEstimate();
            const quotaMb = estimate ? (estimate.quotaBytes / (1024 * 1024)).toFixed(0) : '未知';
            const usedMb = estimate ? (estimate.usageBytes / (1024 * 1024)).toFixed(1) : '未知';

            const activeProvider = settingsStore.get('activeProvider') || 'comfyui';
            const transport = settingsStore.get('transport') || 'direct';

            envContainer.innerHTML = `
                <div><strong>SillyTavern 宿主环境:</strong> ${hasST ? '已连接 (就绪)' : '未检测到宿主'}</div>
                <div><strong>浏览器内核 (UserAgent):</strong> <span style="opacity: 0.8; word-break: break-all;">${userAgent}</span></div>
                <div><strong>IndexedDB 存储配额:</strong> ${usedMb} MB / ${quotaMb} MB (占比 ${estimate?.usagePercent ?? 0}%)</div>
                <div><strong>当前生效绘图后端:</strong> ${String(activeProvider).toUpperCase()} (连接方式: ${transport === 'direct' ? '浏览器直连' : '酒馆代理'})</div>
            `;
        };
        void updateEnvView();

        body.appendChild(envContainer);

        // 一键复制系统诊断报告
        const copyReportBtn = new Button({
            label: '📋 复制系统诊断报告',
            variant: 'secondary',
            onClick: async () => {
                copyReportBtn.setLoading(true);
                try {
                    const report = await this.generateDiagnosticReport();
                    const success = await this.writeClipboard(report);
                    if (success) {
                        copyReportBtn.setLabel('✔ 已复制报告');
                        if (this.copyResetTimer !== null) {
                            clearTimeout(this.copyResetTimer);
                        }
                        this.copyResetTimer = setTimeout(() => {
                            copyReportBtn.setLabel('📋 复制系统诊断报告');
                            this.copyResetTimer = null;
                        }, 2000);
                    } else {
                        Toast.show('复制失败，请手动在控制台查看报告', { level: 'warning' });
                    }
                } finally {
                    copyReportBtn.setLoading(false);
                }
            },
        });
        body.appendChild(copyReportBtn.element);
        this.disposables.push(copyReportBtn);

        return card;
    }

    // 3. 数据运维与全量备份卡片

    private buildMaintenanceCard(): Card {
        const card = new Card({
            title: '数据运维与全量备份',
            subtitle: '导出或导入插件全部设置与预设方案，支持在异常时恢复出厂默认设置',
            collapsible: true,
            defaultCollapsed: false,
        });

        const body = card.getBodyElement();

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '10px';
        btnRow.style.flexWrap = 'wrap';

        // 1. 导出完整配置
        const exportBtn = new Button({
            label: '💾 导出完整配置 (JSON)',
            variant: 'secondary',
            onClick: () => {
                try {
                    const jsonStr = settingsStore.exportSettings(true);
                    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `st_draw_assistant_backup_${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    logger.info('[AboutTabView] 完整配置备份已导出');
                } catch (err) {
                    Toast.show('导出配置失败: ' + String(err), { level: 'error' });
                }
            },
        });

        // 2. 导入配置备份
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.json,application/json';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput?.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                const text = reader.result as string;
                const result = settingsStore.importSettings(text);
                if (result.success) {
                    Toast.show('配置备份导入成功！相关设置与方案已同步恢复', { level: 'success' });
                    logger.info('[AboutTabView] 配置备份已成功导入');
                } else {
                    Toast.show('导入配置失败: ' + (result.error || '未知格式错误'), { level: 'error' });
                }
                if (this.fileInput) this.fileInput.value = '';
            };
            reader.onerror = () => {
                Toast.show('读取配置文件发生错误', { level: 'error' });
                if (this.fileInput) this.fileInput.value = '';
            };
            reader.readAsText(file);
        });
        body.appendChild(this.fileInput);

        const importBtn = new Button({
            label: '📂 导入配置备份 (JSON)',
            variant: 'secondary',
            onClick: () => {
                this.fileInput?.click();
            },
        });

        // 3. 恢复出厂设置
        const resetBtn = new Button({
            label: '⚠️ 恢复出厂设置',
            variant: 'danger',
            onClick: () => {
                const doReset = () => {
                    settingsStore.resetToDefaults();
                    Toast.show('已恢复出厂默认设置！', { level: 'success' });
                    logger.info('[AboutTabView] 已恢复出厂默认设置');
                };
                void ConfirmDialog.confirm({
                    title: '恢复出厂默认设置',
                    message: '警告：此操作将清空所有自定义方案与全局设置并恢复至出厂初始状态，是否确定继续？',
                    isDanger: true,
                }).then((confirmed) => {
                    if (confirmed) doReset();
                });
            },
        });

        btnRow.appendChild(exportBtn.element);
        btnRow.appendChild(importBtn.element);
        btnRow.appendChild(resetBtn.element);
        body.appendChild(btnRow);

        this.disposables.push(exportBtn, importBtn, resetBtn);
        return card;
    }

    // 4. 诊断报告生成辅助

    private async generateDiagnosticReport(): Promise<string> {
        const hasST = typeof window !== 'undefined' && Boolean(window.SillyTavern?.getContext);
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '未知';
        const estimate = await imageStorage.getStorageEstimate();
        const quotaMb = estimate ? (estimate.quotaBytes / (1024 * 1024)).toFixed(0) : '未知';
        const usedMb = estimate ? (estimate.usageBytes / (1024 * 1024)).toFixed(1) : '未知';
        const activeProvider = settingsStore.get('activeProvider') || 'comfyui';
        const transport = settingsStore.get('transport') || 'direct';

        return [
            '### ST-DrawAssistant 系统诊断报告',
            `- **插件版本**: v0.4.0 (Beta)`,
            `- **生成时间**: ${new Date().toISOString()}`,
            `- **SillyTavern 宿主**: ${hasST ? '已集成' : '未检测到宿主'}`,
            `- **当前后端**: ${activeProvider}`,
            `- **网络传输模式**: ${transport}`,
            `- **存储空间**: ${usedMb} MB / ${quotaMb} MB (${estimate?.usagePercent ?? 0}%)`,
            `- **用户代理**: \`${userAgent}\``,
        ].join('\n');
    }

    private async writeClipboard(text: string): Promise<boolean> {
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
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

    // 5. 视图生命周期控制

    public activate(): void {
        // 激活时可执行必要的视图状态同步
    }

    public deactivate(): void {
        // 退出选项卡
    }

    public dispose(): void {
        for (const item of this.disposables) {
            item.dispose();
        }
        this.disposables.length = 0;
        if (this.copyResetTimer !== null) {
            clearTimeout(this.copyResetTimer);
            this.copyResetTimer = null;
        }
        if (this.fileInput) {
            this.fileInput.remove();
            this.fileInput = null;
        }
        this.element.innerHTML = '';
        this.element.remove();
    }
}
