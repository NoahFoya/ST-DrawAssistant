/**
 * 插件在线更新与版本演进相关类型定义。
 */

/** 更新日志单条版本结构 */
export interface ChangelogItem {
    /** 语义版本号 (如 2.0.0-dev, 0.5.0) */
    readonly version: string;
    /** 发布日期 (YYYY-MM-DD) */
    readonly date: string;
    /** 版本主标题 */
    readonly title: string;
    /** 详细更新要点列表 */
    readonly items: string[];
}

/** 插件在线更新服务运行状态 */
export interface UpdateState {
    /** 是否正在执行在线更新检测 */
    readonly isChecking: boolean;
    /** 是否正在执行更新同步操作 */
    readonly isUpdating: boolean;
    /** 是否发现远程可用更新 */
    readonly hasUpdate: boolean;
    /** 目标检测分支 */
    readonly currentBranch: string;
    /** 当前运行的插件版本 */
    readonly currentVersion: string;
    /** 本地记录的已安装 Commit SHA */
    readonly currentCommitSha: string | null;
    /** 远程最新 Commit SHA (7位短哈希) */
    readonly remoteCommitSha: string | null;
    /** 远程最新提交信息摘要 */
    readonly remoteCommitMessage: string | null;
    /** 异常描述信息，无异常时为 null */
    readonly error: string | null;
    /** 上次成功检测时间戳 (毫秒) */
    readonly lastCheckedAt: number | null;
}

/** 在线检测更新返回结果 */
export interface CheckUpdateResult {
    /** 请求是否成功响应 */
    readonly success: boolean;
    /** 是否存在可用更新 */
    readonly hasUpdate: boolean;
    /** 本地 Commit SHA */
    readonly currentSha: string | null;
    /** 远程 Commit SHA */
    readonly remoteSha: string | null;
    /** 远程提交信息 */
    readonly remoteMessage: string | null;
    /** 状态与反馈提示文案 */
    readonly message: string;
}

/** 执行插件更新返回结果 */
export interface ApplyUpdateResult {
    /** 同步更新是否成功 */
    readonly success: boolean;
    /** 反馈提示文案 */
    readonly message: string;
    /** 同步后的目标 Commit SHA */
    readonly sha?: string | null;
    /** 是否需要引导用户刷新页面 */
    readonly needsReload?: boolean;
}
