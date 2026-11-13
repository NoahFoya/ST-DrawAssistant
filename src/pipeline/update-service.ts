/**
 * 插件版本与在线更新状态管理服务 (UpdateService)。
 *
 * @remarks
 * 负责插件版本更新检测、更新说明拉取与宿主同步：
 * 1. 在线检测：请求 GitHub Commits API 进行提交 SHA 差异比对，支持官方端点与镜像加速端点自动容错；
 * 2. 状态通知：维护响应式 UpdateState 并在状态变更时广播事件；
 * 3. 宿主协同：调用 SillyTavern 服务端 `/api/extensions/update` 端点执行版本同步，并在完成后引导热重载；
 * 4. 更新说明：提供结构化更新日志数据源，保障离线与弱网环境下的可用性。
 */

import type { UpdateState, CheckUpdateResult, ApplyUpdateResult, ChangelogItem } from '@types';
import {
    EXTENSION_VERSION,
    GITHUB_REPO,
    GITHUB_DEFAULT_BRANCH,
    GITHUB_API_BASE,
    GITHUB_MIRROR_API_BASE,
    INSTALLED_COMMIT_SHA_KEY,
} from '../config/constants';
import { getHostRequestHeaders } from '../util/http-client';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';
import defaultChangelog from '../../config/changelog.json';

/** 默认网络请求超时时间 (8 秒) */
const DEFAULT_CHECK_TIMEOUT_MS = 8000;

export class UpdateService {
    private static _instance: UpdateService | null = null;

    /** 获取全局默认单例 */
    public static getInstance(): UpdateService {
        if (!UpdateService._instance) {
            UpdateService._instance = new UpdateService();
        }
        return UpdateService._instance;
    }

    private _state: UpdateState;

    private constructor() {
        const initialSha = this.getLocalInstalledCommitSha();
        this._state = {
            isChecking: false,
            isUpdating: false,
            hasUpdate: false,
            currentBranch: GITHUB_DEFAULT_BRANCH,
            currentVersion: EXTENSION_VERSION,
            currentCommitSha: initialSha,
            remoteCommitSha: null,
            remoteCommitMessage: null,
            error: null,
            lastCheckedAt: null,
        };
    }

    /**
     * 从本地存储中读取已安装的提交短哈希。
     */
    public getLocalInstalledCommitSha(): string | null {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem(INSTALLED_COMMIT_SHA_KEY);
            }
        } catch {
            // 本地存储不可用时忽略
        }
        return null;
    }

    /**
     * 将已安装的提交短哈希写入本地存储。
     */
    public setLocalInstalledCommitSha(sha: string): void {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(INSTALLED_COMMIT_SHA_KEY, sha);
            }
        } catch {
            // 本地存储不可用时忽略
        }
    }

    /**
     * 获取当前更新服务只读状态快照。
     */
    public getState(): Readonly<UpdateState> {
        return this._state;
    }

    /**
     * 内部更新状态并分发通知。
     */
    private setState(patch: Partial<UpdateState>): void {
        this._state = { ...this._state, ...patch };
        eventBus.emit('update:status-changed', this._state);
    }

    /**
     * 在线检测插件更新。
     *
     * @remarks
     * 依次请求官方与镜像端点比对 GitHub 最新提交。
     * 若本地尚无已安装 SHA 记录，自动将当前远程提交记录为基准。
     *
     * @param options 检测配置项
     */
    public async checkUpdate(options?: {
        branch?: string;
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<CheckUpdateResult> {
        if (this._state.isChecking || this._state.isUpdating) {
            return {
                success: true,
                hasUpdate: this._state.hasUpdate,
                currentSha: this._state.currentCommitSha,
                remoteSha: this._state.remoteCommitSha,
                remoteMessage: this._state.remoteCommitMessage,
                message: this._state.hasUpdate ? '发现可用新版本提交' : '当前已是最新版本',
            };
        }

        const targetBranch = options?.branch || this._state.currentBranch || GITHUB_DEFAULT_BRANCH;
        const timeoutMs = options?.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;

        this.setState({
            isChecking: true,
            currentBranch: targetBranch,
            error: null,
        });

        // 多端点检测与容错：首选官方 API，受阻或超时时自动尝试镜像加速端点
        const candidateBases = [GITHUB_API_BASE, GITHUB_MIRROR_API_BASE];
        let lastErrorMsg = '';

        for (const base of candidateBases) {
            const controller = new AbortController();
            const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

            // 若外部传入 signal，合并中止监听
            const onUserAbort = () => controller.abort();
            options?.signal?.addEventListener('abort', onUserAbort, { once: true });

            try {
                const url = `${base}/repos/${GITHUB_REPO}/commits/${targetBranch}`;
                const resp = await fetch(url, {
                    method: 'GET',
                    headers: {
                        Accept: 'application/vnd.github.v3+json',
                    },
                    signal: controller.signal,
                });

                clearTimeout(timeoutTimer);
                options?.signal?.removeEventListener('abort', onUserAbort);

                if (!resp.ok) {
                    if (resp.status === 403) {
                        throw new Error('GitHub API 请求频次超限，请稍后重试');
                    }
                    throw new Error(`远程接口响应异常: HTTP ${resp.status}`);
                }

                const rawData = (await resp.json()) as unknown;
                const commitObj = (Array.isArray(rawData) ? rawData[0] : rawData) as {
                    sha?: string;
                    commit?: { message?: string };
                };

                const remoteFullSha = commitObj?.sha || '';
                const remoteShortSha = remoteFullSha ? remoteFullSha.slice(0, 7) : null;
                const fullMsg = commitObj?.commit?.message || '';
                const firstLineMsg = fullMsg.split('\n')[0].trim();

                if (!remoteShortSha) {
                    throw new Error('未能从响应数据中解析出有效提交哈希');
                }

                let localSha = this.getLocalInstalledCommitSha();
                if (!localSha) {
                    // 本地尚无记录时建立基准对齐
                    this.setLocalInstalledCommitSha(remoteShortSha);
                    localSha = remoteShortSha;
                }

                const hasUpdate = localSha.toLowerCase() !== remoteShortSha.toLowerCase();
                const now = Date.now();

                const resultMessage = hasUpdate
                    ? `发现新版本提交 (${remoteShortSha}): ${firstLineMsg}`
                    : `当前已是最新版本 (${localSha})`;

                this.setState({
                    isChecking: false,
                    hasUpdate,
                    currentCommitSha: localSha,
                    remoteCommitSha: remoteShortSha,
                    remoteCommitMessage: firstLineMsg,
                    error: null,
                    lastCheckedAt: now,
                });

                return {
                    success: true,
                    hasUpdate,
                    currentSha: localSha,
                    remoteSha: remoteShortSha,
                    remoteMessage: firstLineMsg,
                    message: resultMessage,
                };
            } catch (err: unknown) {
                clearTimeout(timeoutTimer);
                options?.signal?.removeEventListener('abort', onUserAbort);

                const isAbort = err instanceof DOMException && err.name === 'AbortError';
                lastErrorMsg = isAbort ? `连接超时 (${Math.round(timeoutMs / 1000)}s)` : (err instanceof Error ? err.message : String(err));
                logger.warn(`[UpdateService] 尝试端点 [${base}] 检测失败: ${lastErrorMsg}`);
            }
        }

        // 所有端点均失败
        this.setState({
            isChecking: false,
            error: lastErrorMsg,
        });

        return {
            success: false,
            hasUpdate: false,
            currentSha: this._state.currentCommitSha,
            remoteSha: null,
            remoteMessage: null,
            message: lastErrorMsg || '网络连接异常，无法获取更新信息',
        };
    }

    /**
     * 执行插件一键更新。
     *
     * @remarks
     * 依次调用 SillyTavern 宿主 `/api/extensions/update` 端点触发 git pull。
     * 成功同步后更新本地已安装提交标识，并通知调用方引导刷新页面。
     */
    public async applyUpdate(options?: { signal?: AbortSignal }): Promise<ApplyUpdateResult> {
        if (this._state.isUpdating) {
            return {
                success: false,
                message: '当前已有更新任务正在执行中，请稍候',
            };
        }

        this.setState({
            isUpdating: true,
            error: null,
        });

        try {
            const requestHeaders = getHostRequestHeaders();
            const candidateNames = ['ST-DrawAssistant', 'third-party/ST-DrawAssistant'];

            let updateSuccess = false;
            let lastError = '';

            for (const extName of candidateNames) {
                try {
                    const resp = await fetch('/api/extensions/update', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...requestHeaders,
                        },
                        body: JSON.stringify({ extensionName: extName }),
                        signal: options?.signal,
                    });

                    if (resp.ok) {
                        updateSuccess = true;
                        break;
                    } else {
                        const errData = (await resp.json().catch(() => ({}))) as { error?: string };
                        lastError = errData?.error || `HTTP ${resp.status}`;
                    }
                } catch (e: unknown) {
                    lastError = e instanceof Error ? e.message : String(e);
                }
            }

            if (!updateSuccess) {
                throw new Error(
                    `宿主更新接口响应失败 (${lastError || '无法连接 /api/extensions/update'})。\n请在 SillyTavern 扩展设置菜单中点击更新，或在插件目录手动执行 git pull。`
                );
            }

            const targetSha = this._state.remoteCommitSha || this._state.currentCommitSha;
            if (targetSha) {
                this.setLocalInstalledCommitSha(targetSha);
            }

            this.setState({
                isUpdating: false,
                hasUpdate: false,
                currentCommitSha: targetSha,
                error: null,
            });

            return {
                success: true,
                sha: targetSha,
                message: `已成功通过宿主同步至最新版本 (${targetSha || 'latest'})！即将刷新页面应用新代码...`,
                needsReload: true,
            };
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.setState({
                isUpdating: false,
                error: errorMsg,
            });

            return {
                success: false,
                message: errorMsg,
                needsReload: false,
            };
        }
    }

    /**
     * 获取更新日志列表。
     *
     * @returns 结构化更新日志条目列表
     */
    public getChangelog(): ChangelogItem[] {
        if (Array.isArray(defaultChangelog) && defaultChangelog.length > 0) {
            return defaultChangelog as ChangelogItem[];
        }
        return [];
    }
}

/** 全局默认单例更新管理服务 */
export const updateService = UpdateService.getInstance();
