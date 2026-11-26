/**
 * 关于选项卡无 DOM 状态模型 (AboutState)。
 */

import { signal, type Signal } from '@preact/signals';
import type { UpdateState } from '@types';
import type { Disposable } from '../types';
import { EXTENSION_TITLE, EXTENSION_VERSION } from '../../config/constants';
import { settingsStore } from '../../store/settings-store';
import { imageStorage } from '../../store/image-storage';
import { updateService } from '../../pipeline/update-service';
import { eventBus } from '../../util/event-bus';
import { logger } from '../../util/logger';
import {
    copyTextToClipboard,
    downloadJsonFile,
    readFileAsText,
} from '../../util/browser-io';
import { detectHostRuntime } from '../../util/http-client';
import { Toast } from '../feedback/toast';
import { reportRuntimeError } from '../feedback/error-feedback';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { openResetFactoryModal } from '../modal/reset-factory-modal';

export interface EnvSummaryState {
    hasST: boolean;
    hostLabel: string;
    pageOrigin: string;
    supportsRelayProxy: boolean;
    userAgent: string;
    usedMb: string;
    quotaMb: string;
    usagePercent: number;
    activeProvider: string;
    transport: string;
}

export interface AboutStateOptions {
    onReloadPage?: () => void;
}

export class AboutState implements Disposable {
    public readonly envState: Signal<EnvSummaryState>;
    public readonly copyLabel: Signal<string>;
    public readonly isCopying: Signal<boolean>;
    public readonly updateState: Signal<UpdateState>;

    private readonly onReloadPage?: () => void;
    private copyResetTimer: ReturnType<typeof setTimeout> | null = null;
    private reloadTimer: ReturnType<typeof setTimeout> | null = null;
    private updateAbortController: AbortController | null = null;
    private unlistenUpdate: (() => void) | null = null;
    private disposed = false;
    private envRefreshSeq = 0;

    public constructor(options: AboutStateOptions = {}) {
        this.onReloadPage = options.onReloadPage;
        const initialRuntime = detectHostRuntime();

        this.envState = signal<EnvSummaryState>({
            hasST: initialRuntime.hasSillyTavern,
            hostLabel: initialRuntime.hostLabel,
            pageOrigin: initialRuntime.pageOrigin,
            supportsRelayProxy: initialRuntime.supportsRelayProxy,
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

        this.unlistenUpdate = eventBus.on('update:status-changed', (state) => {
            if (!this.disposed) {
                this.updateState.value = state;
            }
        });
    }

    public async refreshEnvState(): Promise<void> {
        const seq = ++this.envRefreshSeq;
        const runtime = detectHostRuntime();
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '未知环境';
        const estimate = await imageStorage.getStorageEstimate();
        if (this.disposed || seq !== this.envRefreshSeq) return;

        const quotaMb = estimate ? (estimate.quotaBytes / (1024 * 1024)).toFixed(0) : '未知';
        const usedMb = estimate ? (estimate.usageBytes / (1024 * 1024)).toFixed(1) : '未知';
        const activeProvider = String(settingsStore.get('activeProvider') || 'comfyui');
        const transport = String(settingsStore.get('transport') || 'direct');

        this.envState.value = {
            hasST: runtime.hasSillyTavern,
            hostLabel: runtime.hostLabel,
            pageOrigin: runtime.pageOrigin,
            supportsRelayProxy: runtime.supportsRelayProxy,
            userAgent,
            usedMb,
            quotaMb,
            usagePercent: estimate?.usagePercent ?? 0,
            activeProvider,
            transport,
        };
    }

    public async generateDiagnosticReport(): Promise<string> {
        await this.refreshEnvState();
        const env = this.envState.value;

        const lines = [
            `### ${EXTENSION_TITLE} 系统诊断报告`,
            `- **插件版本**: v${EXTENSION_VERSION}`,
            `- **代码提交**: ${
                this.updateState.value.currentCommitSha
                    ? this.updateState.value.currentBranch
                        ? `${this.updateState.value.currentBranch}@${this.updateState.value.currentCommitSha}`
                        : this.updateState.value.currentCommitSha
                    : '本地构建'
            }`,
            `- **生成时间**: ${new Date().toISOString()}`,
            `- **SillyTavern 宿主**: ${env.hasST ? '已集成' : '未检测到宿主'}`,
            `- **运行外壳**: ${env.hostLabel} (${env.supportsRelayProxy ? '支持 /proxy/' : '不支持 /proxy/'})`,
            `- **页面来源**: ${env.pageOrigin || '未知'}`,
            `- **生图服务**: ${env.activeProvider}`,
            `- **连接方式**: ${env.transport}`,
            `- **存储空间**: ${env.usedMb} MB / ${env.quotaMb} MB (${env.usagePercent}%)`,
            `- **用户代理**: \`${env.userAgent}\``,
        ];

        const recentIssues = logger
            .getRecentLogs(200)
            .filter((entry) => entry.level === 'error' || entry.level === 'warn')
            .slice(-10);

        if (recentIssues.length > 0) {
            lines.push('', '#### 最近警告与错误日志');
            for (const entry of recentIssues) {
                const timeStr = new Date(entry.timestamp).toISOString();
                lines.push(`- \`[${timeStr}] [${entry.level.toUpperCase()}]\` ${entry.message}`);
            }
        }

        return lines.join('\n');
    }

    public async handleCopyDiagnosticReport(): Promise<void> {
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

    public abortPendingUpdateCheck(): void {
        if (this.updateAbortController) {
            this.updateAbortController.abort();
            this.updateAbortController = null;
        }
    }

    public async handleCheckUpdate(silent = false): Promise<void> {
        this.abortPendingUpdateCheck();
        const controller = new AbortController();
        this.updateAbortController = controller;

        const res = await updateService.checkUpdate({
            force: !silent,
            signal: controller.signal,
        });
        if (this.updateAbortController === controller) {
            this.updateAbortController = null;
        }
        if (this.disposed || controller.signal.aborted) return;
        if (!silent) {
            if (res.hasUpdate) {
                const versionHint =
                    res.remoteSha || (res.remoteVersion ? `v${res.remoteVersion}` : '最新');
                Toast.show(`发现新版本提交 (${versionHint})，可点击立即更新`, {
                    level: 'info',
                });
            } else if (!res.success) {
                reportRuntimeError(
                    '[AboutState] 检查更新失败:',
                    '检查更新失败，请前往「日志与统计」查看详情',
                    res.message
                );
            } else {
                Toast.show(res.message || '当前已是最新版本', { level: 'success' });
            }
        }
    }

    public async handleApplyUpdate(): Promise<void> {
        const state = this.updateState.value;
        const targetLabel =
            state.remoteCommitSha ||
            (state.remoteVersion
                ? `v${state.remoteVersion}`
                : `${state.currentBranch || '最新'}提交`);
        const confirmed = await ConfirmDialog.confirm({
            title: '确认更新插件',
            message: `即将从远程仓库拉取最新代码 (${targetLabel}) 并更新当前插件。更新完成后将自动刷新页面，确定继续吗？`,
            confirmText: '立即更新',
            cancelText: '取消',
        });
        if (!confirmed || this.disposed) {
            return;
        }

        const result = await updateService.applyUpdate();
        if (this.disposed) return;
        if (result.success) {
            Toast.show('更新成功，正在刷新页面...', { level: 'success' });
            if (this.reloadTimer !== null) {
                clearTimeout(this.reloadTimer);
            }
            this.reloadTimer = setTimeout(() => {
                this.reloadTimer = null;
                if (!this.disposed) {
                    this.onReloadPage?.();
                }
            }, 1500);
        } else {
            reportRuntimeError(
                '[AboutState] 应用更新失败:',
                '插件更新失败，请前往「日志与统计」查看详情',
                result.message || '未知错误'
            );
        }
    }

    public handleExportFullSettings(): void {
        try {
            const jsonStr = settingsStore.exportSettings(true);
            downloadJsonFile(
                `st_draw_assistant_backup_${Date.now()}.json`,
                jsonStr,
                'application/json;charset=utf-8'
            );
            logger.info('[AboutState] 完整配置备份已导出');
        } catch (err) {
            reportRuntimeError(
                '[AboutState] 导出配置备份失败:',
                '导出配置失败，请前往「日志与统计」查看详情',
                err
            );
        }
    }

    public async handleImportConfigFile(file: File): Promise<void> {
        try {
            const text = await readFileAsText(file);
            if (this.disposed) return;
            const result = settingsStore.importSettings(text);
            if (result.success) {
                Toast.show('配置备份导入成功！相关设置与预设已同步恢复', {
                    level: 'success',
                });
                logger.info('[AboutState] 配置备份已成功导入');
            } else {
                reportRuntimeError(
                    '[AboutState] 导入配置备份失败:',
                    '导入配置失败，请检查文件格式或在日志查看详情',
                    result.error || '未知格式错误'
                );
            }
        } catch (err) {
            reportRuntimeError(
                '[AboutState] 读取配置文件发生错误:',
                '读取配置文件失败，请前往「日志与统计」查看详情',
                err
            );
        }
    }

    public handleFactoryReset(): void {
        openResetFactoryModal({
            onResetSuccess: () => {
                logger.info('[AboutState] 已按选定分类恢复出厂设置');
            },
        });
    }

    public activate(): void {
        if (this.disposed) return;
        void this.refreshEnvState();
        void this.handleCheckUpdate(true);
    }

    public deactivate(): void {
        this.abortPendingUpdateCheck();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.envRefreshSeq++;
        this.abortPendingUpdateCheck();
        if (this.unlistenUpdate) {
            this.unlistenUpdate();
            this.unlistenUpdate = null;
        }
        if (this.copyResetTimer !== null) {
            clearTimeout(this.copyResetTimer);
            this.copyResetTimer = null;
        }
        if (this.reloadTimer !== null) {
            clearTimeout(this.reloadTimer);
            this.reloadTimer = null;
        }
    }
}
