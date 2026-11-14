/**
 * 插件版本与在线更新状态管理服务 (UpdateService)。
 *
 * @remarks
 * 负责插件版本更新检测、更新说明拉取与宿主同步：
 * 1. 分级在线检测：宿主环境下优先通过 SillyTavern `/api/extensions/discover` 与 `/api/extensions/version`
 *    直接比对本地 Git 仓库真实状态；受限或非 Git 安装时降级至限流感知的 GitHub Commits API 与 `manifest.json` 语义版本比对；
 * 2. 状态通知：维护响应式 UpdateState 并在状态变更时广播事件；
 * 3. 宿主协同：调用 SillyTavern 服务端 `/api/extensions/update` 执行版本同步，回查最新提交后引导刷新；
 * 4. 更新说明：提供结构化更新日志数据源，保障离线与弱网环境下的可用性。
 */

import type {
    UpdateState,
    CheckUpdateResult,
    ApplyUpdateResult,
    ChangelogItem,
    UpdateCheckSource,
} from '@types';
import {
    EXTENSION_VERSION,
    GITHUB_REPO,
    GITHUB_DEFAULT_BRANCH,
    GITHUB_API_BASE,
    GITHUB_RAW_BASE,
    GITHUB_CDN_BASE,
    UPDATE_CHECK_COOLDOWN_MS,
    INSTALLED_COMMIT_SHA_KEY,
} from '../config/constants';
import { getHostRequestHeaders } from '../util/http-client';
import { eventBus } from '../util/event-bus';
import { logger } from '../util/logger';
import defaultChangelog from '../../config/changelog.json';

/** 默认远程网络检测超时时间 (8 秒) */
const DEFAULT_CHECK_TIMEOUT_MS = 8000;
/** 宿主 Git 版本校验超时时间 (12 秒，含服务端 git fetch) */
const HOST_VERSION_TIMEOUT_MS = 12000;
/** 宿主一键更新超时时间 (45 秒) */
const HOST_UPDATE_TIMEOUT_MS = 45000;
/** 宿主扩展发现超时时间 (3 秒) */
const HOST_DISCOVER_TIMEOUT_MS = 3000;
/** 限流响应未附带重置头时的默认冷却时长 (10 分钟) */
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;

interface HostExtensionTarget {
    readonly extensionName: string;
    readonly global: boolean;
}

const DEFAULT_HOST_TARGETS: ReadonlyArray<HostExtensionTarget> = [
    { extensionName: 'third-party/ST-DrawAssistant', global: false },
    { extensionName: 'ST-DrawAssistant', global: false },
    { extensionName: 'third-party/ST-DrawAssistant', global: true },
    { extensionName: 'ST-DrawAssistant', global: true },
];

/**
 * 对比点分语义版本号 (`a` > `b` 返回 1，相等返回 0，小于返回 -1)。
 */
function compareSemver(a: string, b: string): number {
    const normalize = (v: string): number[] =>
        v
            .trim()
            .replace(/^v/i, '')
            .split('-')[0]
            .split('.')
            .map((part) => {
                const n = Number.parseInt(part, 10);
                return Number.isFinite(n) ? n : 0;
            });

    const pa = normalize(a);
    const pb = normalize(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const va = pa[i] ?? 0;
        const vb = pb[i] ?? 0;
        if (va > vb) return 1;
        if (va < vb) return -1;
    }
    return 0;
}

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
    private _cachedHostTarget: HostExtensionTarget | null = null;
    private _rateLimitedUntil = 0;

    private constructor() {
        this._state = this.createInitialState();
    }

    private createInitialState(): UpdateState {
        return {
            isChecking: false,
            isUpdating: false,
            hasUpdate: false,
            currentBranch: GITHUB_DEFAULT_BRANCH,
            currentVersion: EXTENSION_VERSION,
            currentCommitSha: this.getLocalInstalledCommitSha(),
            remoteCommitSha: null,
            remoteCommitMessage: null,
            checkSource: null,
            remoteVersion: null,
            rateLimitedUntil: null,
            error: null,
            lastCheckedAt: null,
        };
    }

    /**
     * 清空内存缓存与限流标记（供显式刷新或单元测试隔离调用）。
     */
    public clearCache(): void {
        this._cachedHostTarget = null;
        this._rateLimitedUntil = 0;
        this._state = this.createInitialState();
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

    /** 是否处于 SillyTavern 浏览器宿主上下文 */
    private isHostContextAvailable(): boolean {
        return typeof window !== 'undefined' && Boolean(window.SillyTavern?.getContext);
    }

    /** 检查是否处于 GitHub API 限流冷却窗口 */
    private isRateLimited(): boolean {
        return this._rateLimitedUntil > Date.now();
    }

    /** 构造带超时与外部 Signal 联动的中止控制器 */
    private createTimeoutSignal(
        timeoutMs: number,
        externalSignal?: AbortSignal
    ): { signal: AbortSignal; cleanup: () => void; wasTimeout: () => boolean } {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        const onExternalAbort = () => controller.abort();
        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort();
            } else {
                externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            }
        }

        return {
            signal: controller.signal,
            wasTimeout: () => timedOut,
            cleanup: () => {
                clearTimeout(timer);
                externalSignal?.removeEventListener('abort', onExternalAbort);
            },
        };
    }

    /** 从 SillyTavern 宿主发现实际扩展名称与安装作用域 (`local` / `global`) */
    private async resolveHostExtensionTargets(
        externalSignal?: AbortSignal
    ): Promise<HostExtensionTarget[]> {
        const dedupeTargets = (list: ReadonlyArray<HostExtensionTarget>): HostExtensionTarget[] => {
            const seen = new Set<string>();
            const result: HostExtensionTarget[] = [];
            for (const item of list) {
                const key = `${item.global ? 'g' : 'l'}:${item.extensionName}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    result.push(item);
                }
            }
            return result;
        };

        if (this._cachedHostTarget) {
            return dedupeTargets([this._cachedHostTarget, ...DEFAULT_HOST_TARGETS]);
        }

        const discovered: HostExtensionTarget[] = [];
        const { signal, cleanup } = this.createTimeoutSignal(HOST_DISCOVER_TIMEOUT_MS, externalSignal);
        try {
            const resp = await fetch('/api/extensions/discover', {
                method: 'GET',
                headers: getHostRequestHeaders(),
                signal,
            });
            if (resp.ok) {
                const list = (await resp.json()) as unknown;
                if (Array.isArray(list)) {
                    for (const entry of list) {
                        const rec = entry as { name?: unknown; type?: unknown };
                        const name = typeof rec?.name === 'string' ? rec.name.trim() : '';
                        if (
                            name &&
                            (name === 'ST-DrawAssistant' || name.endsWith('/ST-DrawAssistant'))
                        ) {
                            discovered.push({
                                extensionName: name,
                                global: rec.type === 'global',
                            });
                        }
                    }
                }
            }
        } catch {
            // 旧版本酒馆未提供 discover 端点或网络受限时静默回退候选列表
        } finally {
            cleanup();
        }

        return dedupeTargets([...discovered, ...DEFAULT_HOST_TARGETS]);
    }

    /** 提取宿主接口返回的错误信息文本 */
    private async extractResponseError(resp: Response): Promise<string> {
        const text = await resp.text().catch(() => '');
        if (text) {
            try {
                const json = JSON.parse(text) as { error?: unknown; message?: unknown };
                if (typeof json.error === 'string' && json.error.trim()) {
                    return json.error.trim();
                }
                if (typeof json.message === 'string' && json.message.trim()) {
                    return json.message.trim();
                }
            } catch {
                return text.slice(0, 200).trim();
            }
        }
        return `HTTP ${resp.status}`;
    }

    /** 通过宿主 `/api/extensions/version` 校验本地 Git 仓库真实提交状态 */
    private async tryHostGitVersionCheck(externalSignal?: AbortSignal): Promise<{
        supported: boolean;
        hasUpdate: boolean;
        branch: string;
        currentSha: string | null;
    } | null> {
        const targets = await this.resolveHostExtensionTargets(externalSignal);
        const headers = {
            'Content-Type': 'application/json',
            ...getHostRequestHeaders(),
        };

        for (const target of targets) {
            if (externalSignal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            const { signal, cleanup } = this.createTimeoutSignal(
                HOST_VERSION_TIMEOUT_MS,
                externalSignal
            );
            try {
                const resp = await fetch('/api/extensions/version', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(target),
                    signal,
                });

                if (!resp.ok) {
                    const errMsg = await this.extractResponseError(resp);
                    // 若明确提示非 Git 仓库或缺少 git 命令，无需继续尝试其余作用域
                    if (/not a git repository|spawn git|enoent/i.test(errMsg)) {
                        logger.info(`[UpdateService] 宿主扩展暂不支持 Git 版本比对 (${errMsg})，回退远程校验`);
                        return null;
                    }
                    continue;
                }

                const data = (await resp.json()) as {
                    currentCommitHash?: string;
                    currentBranchName?: string;
                    isUpToDate?: boolean;
                };
                if (typeof data?.isUpToDate !== 'boolean' && !data?.currentCommitHash) {
                    continue;
                }

                this._cachedHostTarget = target;
                const fullHash = typeof data.currentCommitHash === 'string' ? data.currentCommitHash.trim() : '';
                const currentSha = fullHash ? fullHash.slice(0, 7) : this.getLocalInstalledCommitSha();
                const branch =
                    typeof data.currentBranchName === 'string' && data.currentBranchName.trim()
                        ? data.currentBranchName.trim()
                        : this._state.currentBranch || GITHUB_DEFAULT_BRANCH;

                if (currentSha) {
                    this.setLocalInstalledCommitSha(currentSha);
                }

                return {
                    supported: true,
                    hasUpdate: data.isUpToDate === false,
                    branch,
                    currentSha,
                };
            } catch (err: unknown) {
                if (externalSignal?.aborted) {
                    throw err;
                }
            } finally {
                cleanup();
            }
        }

        return null;
    }

    /** 根据 GitHub API 403/429 响应计算限流恢复时间戳 */
    private recordRateLimitCooldown(resp: Response): number {
        let resetAtMs = Date.now() + DEFAULT_RATE_LIMIT_COOLDOWN_MS;
        const resetHeader = resp.headers.get('X-RateLimit-Reset');
        const retryAfterHeader = resp.headers.get('Retry-After');

        if (resetHeader) {
            const epochSec = Number.parseInt(resetHeader, 10);
            if (Number.isFinite(epochSec) && epochSec * 1000 > Date.now()) {
                resetAtMs = epochSec * 1000;
            }
        } else if (retryAfterHeader) {
            const waitSec = Number.parseInt(retryAfterHeader, 10);
            if (Number.isFinite(waitSec) && waitSec > 0) {
                resetAtMs = Date.now() + waitSec * 1000;
            }
        }

        this._rateLimitedUntil = resetAtMs;
        return resetAtMs;
    }

    /** 从 GitHub REST API 读取指定分支的最新提交摘要 */
    private async fetchGithubCommit(
        branch: string,
        timeoutMs: number,
        externalSignal?: AbortSignal
    ): Promise<{ sha: string; message: string }> {
        const { signal, cleanup, wasTimeout } = this.createTimeoutSignal(timeoutMs, externalSignal);
        try {
            const url = `${GITHUB_API_BASE}/repos/${GITHUB_REPO}/commits/${encodeURIComponent(branch)}`;
            const resp = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/vnd.github.v3+json',
                },
                signal,
            });

            if (!resp.ok) {
                if (resp.status === 403 || resp.status === 429) {
                    const resetAt = this.recordRateLimitCooldown(resp);
                    const resetTimeStr = new Date(resetAt).toLocaleTimeString();
                    throw new Error(`GitHub API 请求频次超限，将在 ${resetTimeStr} 后恢复，请稍后重试`);
                }
                throw new Error(`远程接口响应异常: HTTP ${resp.status}`);
            }

            const rawData = (await resp.json()) as unknown;
            const commitObj = (Array.isArray(rawData) ? rawData[0] : rawData) as {
                sha?: string;
                commit?: { message?: string };
            };
            const fullSha = commitObj?.sha?.trim() || '';
            if (!fullSha) {
                throw new Error('未能从响应数据中解析出有效提交哈希');
            }
            const firstLineMsg = (commitObj?.commit?.message || '').split('\n')[0].trim();
            return {
                sha: fullSha.slice(0, 7),
                message: firstLineMsg,
            };
        } catch (err: unknown) {
            if (externalSignal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            if (wasTimeout() || (err instanceof DOMException && err.name === 'AbortError')) {
                throw new Error(`连接超时 (${Math.round(timeoutMs / 1000)}s)`);
            }
            throw err;
        } finally {
            cleanup();
        }
    }

    /** 通过无频次限制的远端 manifest.json 进行语义版本号回退检查 */
    private async fetchRemoteManifestVersion(
        branch: string,
        timeoutMs: number,
        externalSignal?: AbortSignal
    ): Promise<string | null> {
        const urls = [
            `${GITHUB_RAW_BASE}/${GITHUB_REPO}/${encodeURIComponent(branch)}/manifest.json`,
            `${GITHUB_CDN_BASE}/${GITHUB_REPO}@${encodeURIComponent(branch)}/manifest.json`,
        ];

        for (const url of urls) {
            if (externalSignal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            const { signal, cleanup } = this.createTimeoutSignal(timeoutMs, externalSignal);
            try {
                const resp = await fetch(url, { method: 'GET', signal });
                if (!resp.ok) {
                    continue;
                }
                const json = (await resp.json()) as { version?: unknown };
                if (typeof json?.version === 'string' && json.version.trim()) {
                    return json.version.trim();
                }
            } catch {
                // 继续尝试下一个静态清单源
            } finally {
                cleanup();
            }
        }
        return null;
    }

    /** 构造更新检测结果并同步响应式状态 */
    private commitCheckState(
        patch: Partial<UpdateState>,
        result: Omit<CheckUpdateResult, 'currentSha' | 'remoteSha' | 'remoteMessage'> & {
            currentSha?: string | null;
            remoteSha?: string | null;
            remoteMessage?: string | null;
        }
    ): CheckUpdateResult {
        this.setState(patch);
        return {
            success: result.success,
            hasUpdate: result.hasUpdate,
            currentSha: result.currentSha ?? this._state.currentCommitSha,
            remoteSha: result.remoteSha ?? this._state.remoteCommitSha,
            remoteMessage: result.remoteMessage ?? this._state.remoteCommitMessage,
            checkSource: this._state.checkSource,
            remoteVersion: this._state.remoteVersion,
            rateLimitedUntil: this._state.rateLimitedUntil,
            message: result.message,
        };
    }

    /**
     * 在线检测插件更新。
     *
     * @remarks
     * 1. 若距上次成功检测在冷却期内且未传 `force: true`，直接返回缓存结果；
     * 2. SillyTavern 宿主下优先调用 `/api/extensions/version` 核对本地 Git 分支与远程差异；
     * 3. 宿主非 Git 安装或独立环境下，降级请求 GitHub Commits API（带限流冷却识别），
     *    若触发限流或网络异常则自动回退读取远端 `manifest.json` 语义版本对比。
     */
    public async checkUpdate(options?: {
        branch?: string;
        signal?: AbortSignal;
        timeoutMs?: number;
        force?: boolean;
        silent?: boolean;
    }): Promise<CheckUpdateResult> {
        if (this._state.isChecking || this._state.isUpdating) {
            return {
                success: true,
                hasUpdate: this._state.hasUpdate,
                currentSha: this._state.currentCommitSha,
                remoteSha: this._state.remoteCommitSha,
                remoteMessage: this._state.remoteCommitMessage,
                checkSource: this._state.checkSource,
                remoteVersion: this._state.remoteVersion,
                rateLimitedUntil: this._state.rateLimitedUntil,
                message: this._state.hasUpdate ? '发现可用新版本提交' : '当前已是最新版本',
            };
        }

        const requestedBranch = options?.branch || this._state.currentBranch || GITHUB_DEFAULT_BRANCH;

        // 非强制检查且距离上次成功检测不足 5 分钟时直接复用缓存状态，防止频繁切换页签打满请求
        if (
            !options?.force &&
            this._state.lastCheckedAt !== null &&
            this._state.error === null &&
            (!options?.branch || options.branch === this._state.currentBranch) &&
            Date.now() - this._state.lastCheckedAt < UPDATE_CHECK_COOLDOWN_MS
        ) {
            return {
                success: true,
                hasUpdate: this._state.hasUpdate,
                currentSha: this._state.currentCommitSha,
                remoteSha: this._state.remoteCommitSha,
                remoteMessage: this._state.remoteCommitMessage,
                checkSource: this._state.checkSource,
                remoteVersion: this._state.remoteVersion,
                rateLimitedUntil: this._state.rateLimitedUntil,
                message: this._state.hasUpdate
                    ? `发现新版本提交 (${this._state.remoteCommitSha || '可用'})`
                    : `当前已是最新版本 (${this._state.currentCommitSha || `v${EXTENSION_VERSION}`})`,
            };
        }

        const timeoutMs = options?.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
        this.setState({
            isChecking: true,
            currentBranch: requestedBranch,
            error: null,
        });

        // 1. 宿主环境下优先通过 SillyTavern 原生 Git 端点检查（零 API 限流，且反映真实本地仓库状态）
        if (this.isHostContextAvailable() && !options?.branch) {
            try {
                const hostRes = await this.tryHostGitVersionCheck(options?.signal);
                if (hostRes) {
                    let remoteSha: string | null = hostRes.hasUpdate ? null : hostRes.currentSha;
                    let remoteMessage: string | null = null;

                    if (hostRes.hasUpdate && !this.isRateLimited()) {
                        try {
                            const commit = await this.fetchGithubCommit(
                                hostRes.branch,
                                Math.min(timeoutMs, 3500),
                                options?.signal
                            );
                            remoteSha = commit.sha;
                            remoteMessage = commit.message;
                        } catch {
                            // 宿主已确认存在远程新提交；补充摘要失败不影响一键更新可用性
                        }
                    }

                    const now = Date.now();
                    const msg = hostRes.hasUpdate
                        ? remoteSha
                            ? `发现新版本提交 (${remoteSha}): ${remoteMessage || hostRes.branch}`
                            : `发现可用新版本提交（分支: ${hostRes.branch}），可点击一键更新`
                        : `当前已是最新版本 (${hostRes.currentSha || `v${EXTENSION_VERSION}`})`;

                    return this.commitCheckState(
                        {
                            isChecking: false,
                            hasUpdate: hostRes.hasUpdate,
                            currentBranch: hostRes.branch,
                            currentCommitSha: hostRes.currentSha,
                            remoteCommitSha: remoteSha,
                            remoteCommitMessage: remoteMessage,
                            checkSource: 'host-git' as UpdateCheckSource,
                            remoteVersion: null,
                            rateLimitedUntil: this.isRateLimited() ? this._rateLimitedUntil : null,
                            error: null,
                            lastCheckedAt: now,
                        },
                        {
                            success: true,
                            hasUpdate: hostRes.hasUpdate,
                            currentSha: hostRes.currentSha,
                            remoteSha,
                            remoteMessage,
                            message: msg,
                        }
                    );
                }
            } catch (err: unknown) {
                if (options?.signal?.aborted) {
                    const abortMsg = '更新检测已取消';
                    return this.commitCheckState(
                        { isChecking: false, error: abortMsg },
                        { success: false, hasUpdate: false, message: abortMsg }
                    );
                }
                logger.warn('[UpdateService] 宿主 Git 版本检测异常，降级远程检测:', err);
            }
        }

        // 2. 远程提交检测（带限流冷却感知）
        let apiErrorMsg = '';
        if (!this.isRateLimited()) {
            try {
                const commit = await this.fetchGithubCommit(requestedBranch, timeoutMs, options?.signal);
                let localSha = this.getLocalInstalledCommitSha();
                if (!localSha) {
                    this.setLocalInstalledCommitSha(commit.sha);
                    localSha = commit.sha;
                }

                const hasUpdate = localSha.toLowerCase() !== commit.sha.toLowerCase();
                const now = Date.now();
                const resultMessage = hasUpdate
                    ? `发现新版本提交 (${commit.sha}): ${commit.message}`
                    : `当前已是最新版本 (${localSha})`;

                return this.commitCheckState(
                    {
                        isChecking: false,
                        hasUpdate,
                        currentCommitSha: localSha,
                        remoteCommitSha: commit.sha,
                        remoteCommitMessage: commit.message,
                        checkSource: 'github-api' as UpdateCheckSource,
                        remoteVersion: null,
                        rateLimitedUntil: null,
                        error: null,
                        lastCheckedAt: now,
                    },
                    {
                        success: true,
                        hasUpdate,
                        currentSha: localSha,
                        remoteSha: commit.sha,
                        remoteMessage: commit.message,
                        message: resultMessage,
                    }
                );
            } catch (err: unknown) {
                apiErrorMsg = err instanceof Error ? err.message : String(err);
                logger.warn(`[UpdateService] GitHub 提交检测失败: ${apiErrorMsg}`);
            }
        } else {
            const resetTimeStr = new Date(this._rateLimitedUntil).toLocaleTimeString();
            apiErrorMsg = `GitHub API 请求频次超限，将在 ${resetTimeStr} 后恢复`;
        }

        // 3. 静态 manifest.json 语义版本回退检查（无 API 速率限制，解决无 .git 且 API 限流场景）
        if (!options?.signal?.aborted) {
            try {
                const remoteVersion = await this.fetchRemoteManifestVersion(
                    requestedBranch,
                    Math.min(timeoutMs, 5000),
                    options?.signal
                );
                if (remoteVersion) {
                    const hasNewVersion = compareSemver(remoteVersion, EXTENSION_VERSION) > 0;
                    const now = Date.now();
                    const msg = hasNewVersion
                        ? `发现新版本 v${remoteVersion}（当前 v${EXTENSION_VERSION}）`
                        : apiErrorMsg
                          ? `当前核心版本与远端一致 (v${EXTENSION_VERSION})；提交详情因限流暂未拉取`
                          : `当前已是最新版本 (v${EXTENSION_VERSION})`;

                    return this.commitCheckState(
                        {
                            isChecking: false,
                            hasUpdate: hasNewVersion,
                            remoteCommitSha: null,
                            remoteCommitMessage: hasNewVersion ? `发布版本 v${remoteVersion}` : null,
                            checkSource: 'manifest' as UpdateCheckSource,
                            remoteVersion,
                            rateLimitedUntil: this.isRateLimited() ? this._rateLimitedUntil : null,
                            error: null,
                            lastCheckedAt: now,
                        },
                        {
                            success: true,
                            hasUpdate: hasNewVersion,
                            remoteSha: null,
                            remoteMessage: hasNewVersion ? `发布版本 v${remoteVersion}` : null,
                            message: msg,
                        }
                    );
                }
            } catch (err: unknown) {
                logger.warn('[UpdateService] 静态版本清单回退检测失败:', err);
            }
        }

        // 4. 所有检测渠道均失败
        const finalError = apiErrorMsg || '网络连接异常，无法获取更新信息';
        return this.commitCheckState(
            {
                isChecking: false,
                rateLimitedUntil: this.isRateLimited() ? this._rateLimitedUntil : null,
                error: finalError,
            },
            {
                success: false,
                hasUpdate: false,
                remoteSha: null,
                remoteMessage: null,
                message: finalError,
            }
        );
    }

    /** 将宿主 Git 拉取异常映射为清晰可操作的排障文案 */
    private formatApplyError(rawError: string): string {
        if (/not a git repository/i.test(rawError)) {
            return `当前扩展目录未包含 Git 仓库信息 (${rawError})。请使用 SillyTavern「扩展管理 -> 安装扩展」通过仓库地址重新安装，或手动覆盖更新。`;
        }
        if (/dirty|local changes|would be overwritten|uncommitted/i.test(rawError)) {
            return `宿主扩展目录存在未提交的本地修改 (${rawError})。请在插件目录执行 git status 检查并清理改动后重试。`;
        }
        if (/spawn git|enoent/i.test(rawError)) {
            return `宿主服务端未检测到可用的 Git 命令 (${rawError})。请确认运行 SillyTavern 的环境已安装 Git 并加入 PATH。`;
        }
        return (
            `宿主更新接口响应失败 (${rawError || '无法连接 /api/extensions/update'})。\n` +
            '请在 SillyTavern 扩展设置菜单中点击更新，或在插件目录手动执行 git pull。'
        );
    }

    /**
     * 执行插件一键更新。
     *
     * @remarks
     * 依次尝试候选目标并调用 SillyTavern 宿主 `/api/extensions/update` 执行 git pull，
     * 成功后回查 `/api/extensions/version` 对齐本地最新提交标识并通知调用方引导刷新。
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
            const targets = await this.resolveHostExtensionTargets(options?.signal);
            const headers = {
                'Content-Type': 'application/json',
                ...getHostRequestHeaders(),
            };

            let updateSuccess = false;
            let pulledSha: string | null = null;
            let lastError = '';

            for (const target of targets) {
                const { signal, cleanup, wasTimeout } = this.createTimeoutSignal(
                    HOST_UPDATE_TIMEOUT_MS,
                    options?.signal
                );
                try {
                    const resp = await fetch('/api/extensions/update', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(target),
                        signal,
                    });

                    if (resp.ok) {
                        this._cachedHostTarget = target;
                        const data = (await resp.json().catch(() => ({}))) as {
                            currentCommitHash?: string;
                        };
                        if (typeof data?.currentCommitHash === 'string' && data.currentCommitHash.trim()) {
                            pulledSha = data.currentCommitHash.trim().slice(0, 7);
                        }
                        updateSuccess = true;
                        break;
                    }

                    lastError = await this.extractResponseError(resp);
                } catch (e: unknown) {
                    if (wasTimeout()) {
                        lastError = `连接或 git pull 超时 (${Math.round(HOST_UPDATE_TIMEOUT_MS / 1000)}s)`;
                    } else {
                        lastError = e instanceof Error ? e.message : String(e);
                    }
                } finally {
                    cleanup();
                }
            }

            if (!updateSuccess) {
                throw new Error(this.formatApplyError(lastError));
            }

            // 更新完成后优先回查宿主真实 Git HEAD，获取拉取后的最新提交哈希
            if (!pulledSha && this.isHostContextAvailable()) {
                try {
                    const fresh = await this.tryHostGitVersionCheck(options?.signal);
                    if (fresh?.currentSha) {
                        pulledSha = fresh.currentSha;
                    }
                } catch {
                    // 回查失败时回退既有状态值
                }
            }

            const targetSha = pulledSha || this._state.remoteCommitSha || this._state.currentCommitSha;
            if (targetSha) {
                this.setLocalInstalledCommitSha(targetSha);
            }

            this.setState({
                isUpdating: false,
                hasUpdate: false,
                currentCommitSha: targetSha,
                remoteCommitSha: targetSha,
                error: null,
                lastCheckedAt: Date.now(),
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
