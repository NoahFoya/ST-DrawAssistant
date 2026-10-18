/**
 * 关于与支持专属选项卡视图 (AboutTabView)。
 *
 * @remarks
 * 基于 Preact JSX 构建：
 * 1. 版本与开源信息卡片；
 * 2. 运行环境与系统诊断卡片（支持一键生成并复制 Issue 诊断报告）；
 * 3. 数据运维与全量备份卡片（导出完整配置、导入备份与恢复出厂设置）。
 */

import { signal, type Signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import { PreactSettingsView, CardView, ButtonControl } from '../framework';
import { settingsStore } from '../../store/settings-store';
import { imageStorage } from '../../store/image-storage';
import { logger } from '../../util/logger';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { Toast } from '../feedback/toast';

interface EnvSummaryState {
    hasST: boolean;
    userAgent: string;
    usedMb: string;
    quotaMb: string;
    usagePercent: number;
    activeProvider: string;
    transport: string;
}

export class AboutTabView extends PreactSettingsView {
    public readonly id = 'about';
    public readonly title = '关于与支持';

    private readonly envState: Signal<EnvSummaryState>;
    private readonly copyLabel: Signal<string>;
    private readonly isCopying: Signal<boolean>;
    private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

    public constructor() {
        super('da-tab-pane da-view-about');

        this.envState = signal<EnvSummaryState>({
            hasST: typeof window !== 'undefined' && Boolean(window.SillyTavern?.getContext),
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '未知环境',
            usedMb: '未知',
            quotaMb: '未知',
            usagePercent: 0,
            activeProvider: String(settingsStore.get('activeProvider') || 'comfyui'),
            transport: String(settingsStore.get('transport') || 'direct'),
        });

        this.copyLabel = signal<string>('📋 复制系统诊断报告');
        this.isCopying = signal<boolean>(false);

        this.mountPreact();
        void this.refreshEnvState();
    }

    private async refreshEnvState(): Promise<void> {
        const hasST = typeof window !== 'undefined' && Boolean(window.SillyTavern?.getContext);
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '未知环境';
        const estimate = await imageStorage.getStorageEstimate();
        const quotaMb = estimate ? (estimate.quotaBytes / (1024 * 1024)).toFixed(0) : '未知';
        const usedMb = estimate ? (estimate.usageBytes / (1024 * 1024)).toFixed(1) : '未知';
        const activeProvider = String(settingsStore.get('activeProvider') || 'comfyui');
        const transport = String(settingsStore.get('transport') || 'direct');

        this.envState.value = {
            hasST,
            userAgent,
            usedMb,
            quotaMb,
            usagePercent: estimate?.usagePercent ?? 0,
            activeProvider,
            transport,
        };
    }

    private async generateDiagnosticReport(): Promise<string> {
        await this.refreshEnvState();
        const env = this.envState.value;

        return [
            '### ST-DrawAssistant 系统诊断报告',
            `- **插件版本**: v0.4.0 (Beta)`,
            `- **生成时间**: ${new Date().toISOString()}`,
            `- **SillyTavern 宿主**: ${env.hasST ? '已集成' : '未检测到宿主'}`,
            `- **当前后端**: ${env.activeProvider}`,
            `- **网络传输模式**: ${env.transport}`,
            `- **存储空间**: ${env.usedMb} MB / ${env.quotaMb} MB (${env.usagePercent}%)`,
            `- **用户代理**: \`${env.userAgent}\``,
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

    private async handleCopyDiagnosticReport(): Promise<void> {
        this.isCopying.value = true;
        try {
            const report = await this.generateDiagnosticReport();
            const success = await this.writeClipboard(report);
            if (success) {
                this.copyLabel.value = '✔ 已复制报告';
                if (this.copyResetTimer !== null) {
                    clearTimeout(this.copyResetTimer);
                }
                this.copyResetTimer = setTimeout(() => {
                    this.copyLabel.value = '📋 复制系统诊断报告';
                    this.copyResetTimer = null;
                }, 2000);
            } else {
                Toast.show('复制失败，请手动在控制台查看报告', { level: 'warning' });
            }
        } finally {
            this.isCopying.value = false;
        }
    }

    private handleExportFullSettings(): void {
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
    }

    private handleImportFile(inputEl: HTMLInputElement): void {
        const file = inputEl.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const text = reader.result as string;
            const result = settingsStore.importSettings(text);
            if (result.success) {
                Toast.show('配置备份导入成功！相关设置与方案已同步恢复', {
                    level: 'success',
                });
                logger.info('[AboutTabView] 配置备份已成功导入');
            } else {
                Toast.show('导入配置失败: ' + (result.error || '未知格式错误'), {
                    level: 'error',
                });
            }
            inputEl.value = '';
        };
        reader.onerror = () => {
            Toast.show('读取配置文件发生错误', { level: 'error' });
            inputEl.value = '';
        };
        reader.readAsText(file);
    }

    private handleFactoryReset(): void {
        void ConfirmDialog.confirm({
            title: '恢复出厂默认设置',
            message:
                '警告：此操作将清空所有自定义方案与全局设置并恢复至出厂初始状态，是否确定继续？',
            isDanger: true,
        }).then((confirmed) => {
            if (confirmed) {
                settingsStore.resetToDefaults();
                Toast.show('已恢复出厂默认设置！', { level: 'success' });
                logger.info('[AboutTabView] 已恢复出厂默认设置');
            }
        });
    }

    protected renderContent(): VNode {
        const fileInputRef = useRef<HTMLInputElement | null>(null);
        const env = this.envState.value;

        return (
            <>
                <CardView
                    title="Starlight DrawAssistant"
                    subtitle="轻量可靠、开箱即用的 SillyTavern AI 生图扩展插件"
                >
                    <div
                        className="da-about-intro"
                        style={{
                            fontSize: '13px',
                            lineHeight: '1.6',
                            opacity: '0.88',
                            marginBottom: '14px',
                        }}
                    >
                        为 SillyTavern 提供情境感知的智能 AI 绘图支持，涵盖四大主流生图服务后端（ComfyUI、SD-WebUI / Forge、NovelAI、OpenAI 兼容服务），
                        具备浏览器端本地存储唯一事实主库 (SSOT)、流式进度与耗时监控、预设方案管理与自然语言提示词处理流程。
                    </div>

                    <div
                        className="da-info-grid"
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: '8px 16px',
                            padding: '12px',
                            borderRadius: 'var(--da-radius-md, 8px)',
                            background: 'var(--da-bg-subtle, rgba(255, 255, 255, 0.04))',
                            border: '1px solid var(--da-border-color, rgba(255, 255, 255, 0.08))',
                            marginBottom: '14px',
                        }}
                    >
                        {[
                            { label: '当前插件版本', value: 'v0.4.0 (Beta)' },
                            { label: '开发者', value: 'NoahFoya' },
                            { label: '开源许可证', value: 'GPL-3.0 License' },
                            { label: '架构模式', value: 'Preact + Signals + Schema UI' },
                        ].map((item) => (
                            <div
                                key={item.label}
                                style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
                            >
                                <span style={{ fontSize: '11px', opacity: '0.65' }}>
                                    {item.label}
                                </span>
                                <span style={{ fontSize: '13px', fontWeight: '500' }}>
                                    {item.value}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <ButtonControl
                            label="访问 GitHub 仓库 ↗"
                            variant="secondary"
                            onClick={() => {
                                if (typeof window !== 'undefined') {
                                    window.open(
                                        'https://github.com/NoahFoya/ST-DrawAssistant',
                                        '_blank',
                                        'noopener,noreferrer'
                                    );
                                }
                            }}
                        />
                        <ButtonControl
                            label="提交 Issue 反馈 ↗"
                            variant="secondary"
                            onClick={() => {
                                if (typeof window !== 'undefined') {
                                    window.open(
                                        'https://github.com/NoahFoya/ST-DrawAssistant/issues',
                                        '_blank',
                                        'noopener,noreferrer'
                                    );
                                }
                            }}
                        />
                    </div>
                </CardView>

                <CardView
                    title="运行环境与系统诊断"
                    subtitle="实时探测宿主、浏览器内核与存储支持状态，排障时可一键生成诊断报告"
                >
                    <div
                        className="da-env-container"
                        style={{
                            fontSize: '12px',
                            lineHeight: '1.7',
                            padding: '12px',
                            borderRadius: 'var(--da-radius-md, 8px)',
                            background: 'var(--da-bg-subtle, rgba(255, 255, 255, 0.04))',
                            border: '1px solid var(--da-border-color, rgba(255, 255, 255, 0.08))',
                            marginBottom: '14px',
                        }}
                    >
                        <div>
                            <strong>SillyTavern 宿主环境:</strong>{' '}
                            {env.hasST ? '已连接 (就绪)' : '未检测到宿主'}
                        </div>
                        <div>
                            <strong>浏览器内核 (UserAgent):</strong>{' '}
                            <span style={{ opacity: '0.8', wordBreak: 'break-all' }}>
                                {env.userAgent}
                            </span>
                        </div>
                        <div>
                            <strong>IndexedDB 存储配额:</strong>{' '}
                            {`${env.usedMb} MB / ${env.quotaMb} MB (占比 ${env.usagePercent}%)`}
                        </div>
                        <div>
                            <strong>当前生效绘图后端:</strong>{' '}
                            {`${env.activeProvider.toUpperCase()} (连接方式: ${
                                env.transport === 'direct' ? '浏览器直连' : '酒馆代理'
                            })`}
                        </div>
                    </div>

                    <ButtonControl
                        label={this.copyLabel.value}
                        variant="secondary"
                        disabled={this.isCopying.value}
                        onClick={() => void this.handleCopyDiagnosticReport()}
                    />
                </CardView>

                <CardView
                    title="数据运维与全量备份"
                    subtitle="导出或导入插件全部设置与预设方案，支持在异常时恢复出厂默认设置"
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: 'none' }}
                        onChange={(e) =>
                            this.handleImportFile(e.currentTarget as HTMLInputElement)
                        }
                    />
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <ButtonControl
                            label="💾 导出完整配置 (JSON)"
                            variant="secondary"
                            onClick={() => this.handleExportFullSettings()}
                        />
                        <ButtonControl
                            label="📂 导入配置备份 (JSON)"
                            variant="secondary"
                            onClick={() => fileInputRef.current?.click()}
                        />
                        <ButtonControl
                            label="⚠️ 恢复出厂设置"
                            variant="danger"
                            onClick={() => this.handleFactoryReset()}
                        />
                    </div>
                </CardView>
            </>
        );
    }

    public override activate(): void {
        void this.refreshEnvState();
    }

    public override dispose(): void {
        if (this.copyResetTimer !== null) {
            clearTimeout(this.copyResetTimer);
            this.copyResetTimer = null;
        }
        super.dispose();
    }
}
