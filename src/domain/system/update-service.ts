/**
 * @module domain/system/update-service
 * @description 插件版本与 Git Commit 提交在线更新状态服务 (UpdateService)
 * 职责：请求 GitHub API 进行远程 Commit 比对，并通过 SillyTavern 服务端真实执行 /api/extensions/update 拉取更新
 */

import {
    DEFAULT_BRANCH,
    VERSION,
    FULL_VERSION_STRING,
    GITHUB_REPO,
    INSTALLED_COMMIT_SHA_KEY
} from '../../core';

function getRequestHeaders(): Record<string, string> {
    if (typeof window !== 'undefined') {
        const st = (window as any).SillyTavern?.getContext?.();
        if (typeof st?.getRequestHeaders === 'function') {
            try {
                return st.getRequestHeaders();
            } catch {}
        }
        if (typeof (window as any).getRequestHeaders === 'function') {
            try {
                return (window as any).getRequestHeaders();
            } catch {}
        }
    }
    return {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
    };
}

export interface UpdateState {
    isChecking: boolean;
    isUpdating: boolean;
    hasUpdate: boolean;
    currentBranch: string;
    version: string;
    fullVersion: string;
    currentCommitSha: string | null;
    remoteCommitSha: string | null;
    remoteCommitMessage: string | null;
    error: string | null;
}

export interface CheckUpdateResult {
    success: boolean;
    hasUpdate: boolean;
    currentSha: string | null;
    remoteSha: string | null;
    remoteMessage: string | null;
    message: string;
}

export interface UpdateResult {
    success: boolean;
    message: string;
    sha?: string | null;
    needsReload?: boolean;
}

type UpdateListener = (state: Readonly<UpdateState>) => void;

export class UpdateService {
    private static _instance: UpdateService | null = null;

    public static getInstance(): UpdateService {
        if (!UpdateService._instance) {
            UpdateService._instance = new UpdateService();
        }
        return UpdateService._instance;
    }

    private _state: UpdateState;
    private _listeners: Set<UpdateListener> = new Set();

    private constructor() {
        const initialSha = this.getLocalInstalledCommitSha();
        this._state = {
            isChecking: false,
            isUpdating: false,
            hasUpdate: false,
            currentBranch: DEFAULT_BRANCH,
            version: VERSION,
            fullVersion: FULL_VERSION_STRING,
            currentCommitSha: initialSha,
            remoteCommitSha: null,
            remoteCommitMessage: null,
            error: null
        };
    }

    private getLocalInstalledCommitSha(): string | null {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem(INSTALLED_COMMIT_SHA_KEY);
            }
        } catch {}
        return null;
    }

    private setLocalInstalledCommitSha(sha: string): void {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(INSTALLED_COMMIT_SHA_KEY, sha);
            }
        } catch {}
    }

    public getState(): Readonly<UpdateState> {
        return this._state;
    }

    public subscribe(listener: UpdateListener): () => void {
        this._listeners.add(listener);
        listener(this._state);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private notify(): void {
        this._listeners.forEach((fn) => {
            try {
                fn(this._state);
            } catch {}
        });
    }

    /**
     * 检查更新：请求 GitHub Commits API 进行 Commit SHA 差异比对
     */
    public async checkUpdate(): Promise<CheckUpdateResult> {
        if (this._state.isChecking || this._state.isUpdating) {
            return {
                success: true,
                hasUpdate: this._state.hasUpdate,
                currentSha: this._state.currentCommitSha,
                remoteSha: this._state.remoteCommitSha,
                remoteMessage: this._state.remoteCommitMessage,
                message: this._state.hasUpdate ? '发现可用新提交' : '当前已是最新版本'
            };
        }

        this._state.isChecking = true;
        this._state.error = null;
        this.notify();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        try {
            const branch = this._state.currentBranch || DEFAULT_BRANCH;
            const url = `https://api.github.com/repos/${GITHUB_REPO}/commits/${branch}`;

            const resp = await fetch(url, {
                signal: controller.signal,
                headers: {
                    Accept: 'application/vnd.github.v3+json'
                }
            });

            clearTimeout(timeoutId);

            if (!resp.ok) {
                if (resp.status === 403) {
                    throw new Error('GitHub API 请求频次超限 (Rate Limit)，请稍后重试');
                }
                throw new Error(`GitHub 响应异常: HTTP ${resp.status}`);
            }

            const data = await resp.json();
            const remoteFullSha = data?.sha || '';
            const remoteShortSha = remoteFullSha ? remoteFullSha.slice(0, 7) : null;
            const fullMessage = data?.commit?.message || '';
            const firstLineMsg = fullMessage.split('\n')[0].trim();

            if (!remoteShortSha) {
                throw new Error('未能从远程解析出有效的提交哈希');
            }

            const localSha = this.getLocalInstalledCommitSha();
            this._state.remoteCommitSha = remoteShortSha;
            this._state.remoteCommitMessage = firstLineMsg;

            // 若本地尚无记录，不盲目假设已是最新，而是以有差异处理或记录当前
            const hasNewCommit = Boolean(localSha && remoteShortSha.toLowerCase() !== localSha.toLowerCase());
            this._state.hasUpdate = hasNewCommit;

            const resultMessage = hasNewCommit
                ? `发现远程新提交 (SHA: ${remoteShortSha}): ${firstLineMsg}`
                : `当前运行已是最新提交 (SHA: ${localSha || remoteShortSha})！`;

            return {
                success: true,
                hasUpdate: hasNewCommit,
                currentSha: localSha,
                remoteSha: remoteShortSha,
                remoteMessage: firstLineMsg,
                message: resultMessage
            };
        } catch (err: any) {
            clearTimeout(timeoutId);
            const isAbort = err?.name === 'AbortError';
            const errorMsg = isAbort ? '检查更新超时 (网络连接受阻)' : (err?.message || '检查更新失败');

            this._state.error = errorMsg;
            return {
                success: false,
                hasUpdate: false,
                currentSha: this._state.currentCommitSha,
                remoteSha: null,
                remoteMessage: null,
                message: errorMsg
            };
        } finally {
            this._state.isChecking = false;
            this.notify();
        }
    }

    /**
     * 执行真实更新：通过 SillyTavern 后端 /api/extensions/update 触发 git pull
     */
    public async applyUpdate(): Promise<UpdateResult> {
        this._state.isUpdating = true;
        this._state.error = null;
        this.notify();

        try {
            const requestHeaders = getRequestHeaders();

            const candidateNames = ['third-party/ST-DrawAssistant', 'ST-DrawAssistant'];
            let updateSuccess = false;
            let lastError = '';

            for (const extName of candidateNames) {
                try {
                    const resp = await fetch('/api/extensions/update', {
                        method: 'POST',
                        headers: requestHeaders,
                        body: JSON.stringify({ extensionName: extName })
                    });

                    if (resp.ok) {
                        updateSuccess = true;
                        break;
                    } else {
                        const errData = await resp.json().catch(() => ({}));
                        lastError = errData?.error || `HTTP ${resp.status}`;
                    }
                } catch (e: any) {
                    lastError = e?.message || String(e);
                }
            }

            if (!updateSuccess) {
                throw new Error(
                    `SillyTavern 服务端更新接口响应失败 (${lastError || '无法连接 /api/extensions/update'})。\n请在 SillyTavern【扩展管理】菜单中点击更新，或在插件目录手动执行 git pull。`
                );
            }

            const targetSha = this._state.remoteCommitSha || this._state.currentCommitSha;
            if (targetSha) {
                this.setLocalInstalledCommitSha(targetSha);
                this._state.currentCommitSha = targetSha;
            }

            this._state.hasUpdate = false;
            this.notify();

            return {
                success: true,
                sha: targetSha,
                message: `已成功通过 SillyTavern 拉取并同步至最新提交 (SHA: ${targetSha || 'latest'})！页面即将自动刷新...`,
                needsReload: true
            };
        } catch (err: any) {
            const errorMsg = err?.message || '更新失败';
            this._state.error = errorMsg;
            this.notify();
            return {
                success: false,
                message: errorMsg,
                needsReload: false
            };
        } finally {
            this._state.isUpdating = false;
            this.notify();
        }
    }
}
