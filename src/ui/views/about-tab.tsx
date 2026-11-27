/**
 * 关于选项卡视图 (AboutTab / createAboutTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 AboutState 构建：
 * 1. 顶栏产品身份标识、版本状态胶囊与独立操作工具行；
 * 2. 运行环境与系统诊断（支持生成并复制 Issue 诊断报告）；
 * 3. 本地预设按需管理（按分类折叠展示内置预设，支持逐条/整类载入与卸载）；
 * 4. 配置备份导入与恢复出厂设置。
 */

import { useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import {
    createPreactSettingsView,
    ButtonControl,
    type StatefulSettingsView,
} from '../framework';
import { StaticPresetManagerCard } from '../composite';
import { openChangelogModal } from '../modal/changelog-modal';
import { EXTENSION_TITLE, EXTENSION_VERSION } from '../../config/constants';
import { AboutState } from '../state';

export function AboutTab(props: { state: AboutState }): VNode {
    const { state } = props;
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const env = state.envState.value;
    const update = state.updateState.value;

        // 1. 构建版本状态标签
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
            const commitShort = update.currentCommitSha
                ? update.currentCommitSha.slice(0, 7)
                : '';
            const branchPrefix = update.currentBranch ? `${update.currentBranch}@` : '';
            const commitDetail = commitShort ? ` (${branchPrefix}${commitShort})` : '';
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
                                    ? update.currentBranch
                                        ? `当前分支与提交: ${update.currentBranch}@${update.currentCommitSha}`
                                        : `当前提交: ${update.currentCommitSha}`
                                    : undefined
                            }
                        >
                            v{EXTENSION_VERSION}
                        </span>
                        {statusPill}
                    </div>
                    <div className="da-about-header__desc">
                        适用于 SillyTavern 的多后端 AI 生图扩展插件 · 作者: NoahFoya · 开源协议: GPL-3.0 License
                    </div>
                    <div className="da-about-header__actions">
                        {update.hasUpdate && (
                            <ButtonControl
                                label={
                                    update.isUpdating
                                        ? '正在更新...'
                                        : update.remoteCommitSha
                                          ? `更新至 ${update.remoteCommitSha}`
                                          : update.remoteVersion
                                            ? `更新至 v${update.remoteVersion}`
                                            : `立即更新 (${update.currentBranch || '最新'})`
                                }
                                variant="primary"
                                size="sm"
                                disabled={update.isUpdating}
                                onClick={() => void state.handleApplyUpdate()}
                            />
                        )}
                        <ButtonControl
                            label={update.isChecking ? '正在检查...' : '检查更新'}
                            variant="secondary"
                            size="sm"
                            disabled={update.isChecking || update.isUpdating}
                            onClick={() => void state.handleCheckUpdate(false)}
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

                {/* 分组 1: 状态与诊断 */}
                <div className="da-settings-section">
                    <h3 className="da-settings-section__title">状态与诊断</h3>
                    <div className="da-settings-group">
                        {/* 行 1: 酒馆连接状态 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span>酒馆连接状态</span>
                                </div>
                                <div className="da-settings-row__desc">
                                    扩展与当前酒馆页面的连接与运行状态
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
                                        <span>未连接酒馆</span>
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* 行 2: 生图服务与网络连接 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span>当前默认出图服务</span>
                                </div>
                                <div className="da-settings-row__desc">
                                    当前选中的出图服务与网络连接方式
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

                        {/* 行 3: 本机图库占用 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span>本机图库占用</span>
                                </div>
                                <div className="da-settings-row__desc">
                                    浏览器本机存储配额与图库图片占用空间
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

                        {/* 行 4: 问题诊断报告 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span>问题诊断报告</span>
                                </div>
                                <div className="da-settings-row__desc">
                                    复制扩展版本、运行环境与当前配置信息到剪贴板，方便反馈或排查问题
                                </div>
                            </div>
                            <div className="da-settings-row__action">
                                <ButtonControl
                                    label={state.copyLabel.value}
                                    variant="secondary"
                                    size="sm"
                                    disabled={state.isCopying.value}
                                    onClick={() => void state.handleCopyDiagnosticReport()}
                                />
                                <ButtonControl
                                    label="刷新状态"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => void state.refreshEnvState()}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* 分组 2: 内置预设管理 */}
                <div id="da-about-static-presets" className="da-settings-section">
                    <h3 className="da-settings-section__title">内置预设管理</h3>
                    <StaticPresetManagerCard />
                </div>

                {/* 分组 3: 配置备份与恢复 */}
                <div className="da-settings-section">
                    <h3 className="da-settings-section__title">配置备份与恢复</h3>
                    <div className="da-settings-group">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,application/json"
                            className="da-hidden"
                            onChange={async (e) => {
                                const input = e.currentTarget as HTMLInputElement;
                                const file = input.files?.[0];
                                if (file) {
                                    await state.handleImportConfigFile(file);
                                    input.value = '';
                                }
                            }}
                        />
                        {/* 行 1: 配置全量备份与导入 */}
                        <div className="da-settings-row">
                            <div className="da-settings-row__main">
                                <div className="da-settings-row__title">
                                    <span>配置备份与导入</span>
                                </div>
                                <div className="da-settings-row__desc">
                                    导出全部设置与各类预设为 JSON 备份文件，或从本地备份文件恢复
                                </div>
                            </div>
                            <div className="da-settings-row__action">
                                <ButtonControl
                                    label="导出完整配置 (JSON)"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => state.handleExportFullSettings()}
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
                                    onClick={() => state.handleFactoryReset()}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
}

export function createAboutTabView(): StatefulSettingsView<AboutState> {
    const state = new AboutState({
        onReloadPage: () => {
            if (typeof window !== 'undefined') {
                window.location.reload();
            }
        },
    });
    return createPreactSettingsView<AboutState>({
        id: 'about',
        title: '关于',
        className: 'da-tab-pane da-view-about',
        state,
        render: () => <AboutTab state={state} />,
        onActivate: () => state.activate(),
        onDeactivate: () => state.deactivate(),
        onDispose: () => state.dispose(),
    });
}
