/**
 * 关于与支持专属选项卡视图 (AboutTabView)。
 *
 * @remarks
 * 基于 Preact JSX 构建：
 * 1. 顶栏产品身份标识、版本状态胶囊与独立操作工具行；
 * 2. 运行环境与系统诊断线性属性分组（支持生成并复制 Issue 诊断报告）；
 * 3. 配置数据运维与全量备份线性属性分组（全量配置导出导入与恢复出厂设置）。
 */

import { signal, type Signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import { PreactSettingsView, ButtonControl } from '../framework';
import { settingsStore } from '../../store/settings-store';
import { imageStorage } from '../../store/image-storage';
import { logger } from '../../util/logger';
import { Toast } from '../feedback/toast';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { openResetFactoryModal } from '../modal/reset-factory-modal';
import { openChangelogModal } from '../modal/changelog-modal';
import { updateService } from '../../pipeline/update-service';
import { eventBus } from '../../util/event-bus';
import { copyTextToClipboard } from '../../util/clipboard';
import { downloadJsonFile } from '../../util/download';
import { EXTENSION_TITLE, EXTENSION_VERSION } from '../../config/constants';
import type { UpdateState } from '@types';

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
    private readonly updateState: Signal<UpdateState>;
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

        this.copyLabel = signal<string>('复制系统诊断报告');
        this.isCopying = signal<boolean>(false);
        this.updateState = signal<UpdateState>(updateService.getState());

        const unlistenUpdate = eventBus.on('update:status-changed', (state) => {
            this.updateState.value = state;
        });
        this.registerDisposable({ dispose: unlistenUpdate });

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
            `### ${EXTENSION_TITLE} 系统诊断报告`,
            `- **插件版本**: v${EXTENSION_VERSION}`,
            `- **代码提交**: ${
                this.updateState.value.currentCommitSha
                    ? `${this.updateState.value.currentBranch}@${this.updateState.value.currentCommitSha}`
                    : '本地构建'
            }`,
            `- **生成时间**: ${new Date().toISOString()}`,
            `- **SillyTavern 宿主**: ${env.hasST ? '已集成' : '未检测到宿主'}`,
            `- **生图引擎**: ${env.activeProvider}`,
            `- **连接方式**: ${env.transport}`,
            `- **存储空间**: ${env.usedMb} MB / ${env.quotaMb} MB (${env.usagePercent}%)`,
            `- **用户代理**: \`${env.userAgent}\``,
        ].join('\n');
    }

    private async handleCopyDiagnosticReport(): Promise<void> {
        this.isCopying.value = true;
        try {
            const report = await this.generateDiagnosticReport();
            const success = await copyTextToClipboard(report);
            if (success) {
                this.copyLabel.value = '已复制';
                if (this.copyResetTimer !== null) {
                    clearTimeout(this.copyResetTimer);
                }
                this.copyResetTimer = setTimeout(() => {
                    this.copyLabel.value = '复制系统诊断报告';
                    this.copyResetTimer = null;
                }, 2000);
            } else {
                Toast.show('复制失败，请手动在控制台查看报告', { level: 'warning' });
            }
        } finally {
            this.isCopying.value = false;
        }
    }

    private async handleCheckUpdate(silent = false): Promise<void> {
        const res = await updateService.checkUpdate({ force: !silent, silent });
        if (!silent) {
            if (res.hasUpdate) {
                const versionHint = res.remoteSha || (res.remoteVersion ? `v${res.remoteVersion}` : '最新');
                Toast.show(`发现新版本提交 (${versionHint})，可点击一键更新`, {
                    level: 'info',
                });
            } else if (!res.success) {
                Toast.show(`检查更新失败: ${res.message}`, { level: 'error' });
            } else {
                Toast.show(res.message || '当前已是最新版本', { level: 'success' });
            }
        }
    }

    private async handleApplyUpdate(): Promise<void> {
        const state = this.updateState.value;
        const targetLabel =
            state.remoteCommitSha ||
            (state.remoteVersion ? `v${state.remoteVersion}` : `${state.currentBranch || '最新'}提交`);
        const confirmed = await ConfirmDialog.confirm({
            title: '确认一键更新',
            message: `即将从远程仓库拉取最新代码 (${targetLabel}) 并更新当前插件。更新完成后将自动刷新页面，确定继续吗？`,
            confirmText: '立即更新',
            cancelText: '取消',
        });
        if (!confirmed) {
            return;
        }

        const result = await updateService.applyUpdate();
        if (result.success) {
            Toast.show('更新成功，正在刷新页面...', { level: 'success' });
            setTimeout(() => {
                if (typeof window !== 'undefined') {
                    window.location.reload();
                }
            }, 1500);
        } else {
            Toast.show(`一键更新失败: ${result.message || '未知错误'}`, { level: 'error' });
        }
    }

    private handleExportFullSettings(): void {
        try {
            const jsonStr = settingsStore.exportSettings(true);
            downloadJsonFile(
                `st_draw_assistant_backup_${Date.now()}.json`,
                jsonStr,
                'application/json;charset=utf-8'
            );
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
                Toast.show('配置备份导入成功！相关设置与预设已同步恢复', {
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
        openResetFactoryModal({
            onResetSuccess: () => {
                logger.info('[AboutTabView] 已按选定分类恢复出厂设置');
            },
        });
    }

    protected renderContent(): VNode {
        const fileInputRef = useRef<HTMLInputElement | null>(null);
        const env = this.envState.value;
        const update = this.updateState.value;

        // 1. 构建内联版本状态微胶囊
        let statusPill: VNode | null = null;
        if (update.isChecking) {
            statusPill = (
                <span className="da-version-pill da-version-pill--info" title="正在检查版本更新">
                    <span className="da-version-pill__dot" />
                    <span>检查中...</span>
                </span>
            );
        } else if (update.isUpdating) {
            statusPill = (
                <span className="da-version-pill da-version-pill--warn" title="正在执行更新，请勿关闭页面">
                    <span className="da-version-pill__dot" />
                    <span>更新中...</span>
                </span>
            );
        } else if (update.hasUpdate) {
            const targetHint =
                update.remoteCommitSha ||
                (update.remoteVersion ? `v${update.remoteVersion}` : update.currentBranch || '可用');
            statusPill = (
                <span
                    className="da-version-pill da-version-pill--warn"
                    title={`发现可用更新: ${targetHint}`}
                >
                    <span className="da-version-pill__dot" />
                    <span>可更新</span>
                </span>
            );
        } else if (update.error) {
            statusPill = (
                <span className="da-version-pill da-version-pill--error" title={`检查失败: ${update.error}`}>
                    <span className="da-version-pill__dot" />
                    <span>检查失败</span>
                </span>
            );
        } else if (update.lastCheckedAt) {
            const timeStr = new Date(update.lastCheckedAt).toLocaleTimeString();
            const commitDetail = update.currentCommitSha
                ? ` (${update.currentBranch || 'dev'}@${update.currentCommitSha.slice(0, 7)})`
                : '';
            statusPill = (
                <span
                    className="da-version-pill da-version-pill--success"
                    title={`已是最新版本${commitDetail} · 检查时间: ${timeStr}`}
                >
                    <span className="da-version-pill__dot" />
                    <span>已是最新</span>
                </span>
            );
        }

        return (
            <>
                {/* 顶部品牌与全局操作通栏 */}
                <div className="da-about-header">
                    <div className="da-about-header__title-row">
                        <h2 className="da-about-header__title">{EXTENSION_TITLE}</h2>
                        <span
                            className="da-tag-chip"
                            title={
                                update.currentCommitSha
                                    ? `当前分支与提交: ${update.currentBranch}@${update.currentCommitSha}`
                                    : undefined
                            }
                        >
                            v{EXTENSION_VERSION}
                        </span>
                        {statusPill}
                    </div>
                    <div className="da-about-header__desc">
                        轻量可靠、开箱即用的 SillyTavern AI 生图扩展插件 · 开发者: NoahFoya · 开源协议: GPL-3.0 License
                    </div>
                    <div className="da-about-header__actions">
                        {update.hasUpdate && (
                            <ButtonControl
                                label={
                                    update.isUpdating
                                        ? '正在更新...'
                                        : update.remoteCommitSha
                                          ? `一键更新至 ${update.remoteCommitSha}`
                                          : update.remoteVersion
                                            ? `一键更新至 v${update.remoteVersion}`
                                            : `一键更新 (${update.currentBranch || '最新'})`
                                }
                                variant="primary"
                                size="sm"
                                disabled={update.isUpdating}
                                onClick={() => void this.handleApplyUpdate()}
                            />
                        )}
                        <ButtonControl
                            label={update.isChecking ? '正在检查...' : '检查更新'}
                            variant="secondary"
                            size="sm"
                            disabled={update.isChecking || update.isUpdating}
                            onClick={() => void this.handleCheckUpdate(false)}
                        />
                        <ButtonControl
                            label="更新说明"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                openChangelogModal();
                            }}
                        />
                        <ButtonControl
                            label="GitHub ↗"
                            variant="ghost"
                            size="sm"
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
                            label="Issue ↗"
                            variant="ghost"
                            size="sm"
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
                </div>

                {/* 分组 1: 运行环境与诊断 */}
                <div className="da-settings-section">
                    <h3 className="da-settings-section__title">运行环境与诊断</h3>
                    <div className="da-settings-group">
                        {/* 行 1: 宿主环境 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span>SillyTavern 宿主环境</span>
                                </div>
                                <div className="da-settings-row__desc">
                                    扩展插件在浏览器端与酒馆前端宿主的通信集成状态
                                </div>
                            </div>
                            <div className="da-settings-row__action">
                                {env.hasST ? (
                                    <span className="da-version-pill da-version-pill--success">
                                        <span className="da-version-pill__dot" />
                                        <span>已连接 (就绪)</span>
                                    </span>
                                ) : (
                                    <span className="da-version-pill da-version-pill--warn">
                                        <span className="da-version-pill__dot" />
                                        <span>未检测到宿主</span>
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* 行 2: 生图引擎与网络连接 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span>当前生效生图引擎</span>
                                </div>
                                <div className="da-settings-row__desc">
                                    当前选定且生效的生成服务提供商与网络连接方式
                                </div>
                            </div>
                            <div className="da-settings-row__action">
                                <span className="da-tag-chip">
                                    {`${env.activeProvider.toUpperCase()} · ${
                                        env.transport === 'direct' ? '浏览器直连' : '酒馆代理'
                                    }`}
                                </span>
                            </div>
                        </div>

                        {/* 行 3: 本地图库存储配额 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span>本地图库存储空间</span>
                                </div>
                                <div className="da-settings-row__desc">
                                    浏览器 IndexedDB 离线图库缓存与生成元数据存储配额
                                </div>
                            </div>
                            <div className="da-settings-row__action">
                                <div className="da-meter-group">
                                    <div
                                        className="da-meter-track"
                                        title={`存储使用率: ${env.usagePercent}%`}
                                    >
                                        <div
                                            className="da-meter-fill"
                                            style={{
                                                width: `${Math.min(
                                                    100,
                                                    Math.max(0, env.usagePercent)
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="da-meter-label">
                                        {`${env.usedMb} MB / ${env.quotaMb} MB (${env.usagePercent}%)`}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* 行 4: 系统诊断排障报告 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span>系统诊断排障报告</span>
                                </div>
                                <div className="da-settings-row__desc">
                                    一键汇总宿主、内核与生图配置信息至剪贴板，用于 Issue 反馈与故障排查
                                </div>
                            </div>
                            <div className="da-settings-row__action">
                                <ButtonControl
                                    label={this.copyLabel.value}
                                    variant="secondary"
                                    size="sm"
                                    disabled={this.isCopying.value}
                                    onClick={() => void this.handleCopyDiagnosticReport()}
                                />
                                <ButtonControl
                                    label="刷新状态"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void this.refreshEnvState()}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* 分组 2: 配置数据运维 */}
                <div className="da-settings-section">
                    <h3 className="da-settings-section__title">配置数据运维</h3>
                    <div className="da-settings-group">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,application/json"
                            className="da-hidden"
                            onChange={(e) =>
                                this.handleImportFile(e.currentTarget as HTMLInputElement)
                            }
                        />
                        {/* 行 1: 配置全量备份与导入 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span>配置备份与导入</span>
                                </div>
                                <div className="da-settings-row__desc">
                                    导出全部设置与提示词/工作流预设至 JSON 文件，或从备份恢复
                                </div>
                            </div>
                            <div className="da-settings-row__action">
                                <ButtonControl
                                    label="导出完整配置 (JSON)"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => this.handleExportFullSettings()}
                                />
                                <ButtonControl
                                    label="导入配置备份 (JSON)"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                />
                            </div>
                        </div>

                        {/* 行 2: 恢复出厂设置 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span className="da-text-danger">
                                        恢复出厂设置
                                    </span>
                                </div>
                                <div className="da-settings-row__desc">
                                    清空自定义配置与预设并恢复出厂默认值，操作前建议先导出备份
                                </div>
                            </div>
                            <div className="da-settings-row__action">
                                <ButtonControl
                                    label="恢复出厂设置"
                                    variant="danger"
                                    size="sm"
                                    onClick={() => this.handleFactoryReset()}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    public override activate(): void {
        super.activate();
        void this.refreshEnvState();
        void updateService.checkUpdate({ force: false, silent: true });
    }

    public override dispose(): void {
        if (this.copyResetTimer !== null) {
            clearTimeout(this.copyResetTimer);
            this.copyResetTimer = null;
        }
        super.dispose();
    }
}
