/**
 * @module ui/views/about-tab
 * @description 关于与使用帮助面板视图 (AboutTabView)
 *
 * 核心设计架构：
 * 1. Hero 标题与 GPL-3.0 自由开源协议声明卡片；
 * 2. 版本与在线更新卡片 (检测远端分支更新与变更履历)；
 * 3. 开源生态与多维度社区支持卡片 (2×3 水平流式现代自适应卡片网格)；
 * 4. 配置备份与恢复操作栏 (纯净表单文案与安全确认)。
 */

import {
    EXTENSION_DISPLAY_NAME,
    DEFAULT_THEME_DATA,
    getAboutConfig,
    getChangelog,
    ObservableStore,
    DrawAssistantSettings,
    createDefaultSettings,
    hydrateSettingsFromPresets,
    downloadSettingsFile,
    importSettingsPackage
} from '../../core';
import { UpdateService, UpdateState } from '../../domain';
import { createVersionCapsule } from '../controls';
import { createCard, createCardHeader } from '../layout/container-factory';
import { FeedbackService } from '../feedback/feedback';
import { ThemeService } from '../foundation/theme-service';
import { escapeHtml } from '../foundation';
import { BaseTabView } from '../foundation/tab-view';

/** 辅助函数：创建现代水平流式 Rich Card 社区卡片 (左侧图标 + 右侧双行文本) */
function createRichCard(options: {
    icon: string;
    title: string;
    subtitle: string;
    href: string;
    themeClass: string;
}): HTMLElement {
    const card = document.createElement('a');
    card.href = options.href;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.className = `da-about-rich-card ${options.themeClass}`;

    card.innerHTML = `
        <div class="da-about-rich-card-icon-box">
            <span class="da-about-rich-card-icon">${options.icon}</span>
        </div>
        <div class="da-about-rich-card-content">
            <div class="da-about-rich-card-title">${escapeHtml(options.title)}</div>
            <div class="da-about-rich-card-sub">${escapeHtml(options.subtitle)}</div>
        </div>
    `;

    return card;
}

/**
 * 关于与版本信息面板视图
 */
export class AboutTabView extends BaseTabView {
    private _cardInfoEl!: HTMLElement;
    private _changelogBoxEl!: HTMLElement;
    private _communityGridEl!: HTMLElement;
    private _currentAboutData: any = null;
    private _currentVersionBadgeText = UpdateService.getInstance().getState().fullVersion;

    constructor(private readonly _store?: ObservableStore<DrawAssistantSettings>) {
        super('da-about-tab');

        const aboutData = getAboutConfig();
        const changelogData = getChangelog();

        this._buildHeroCard(aboutData);
        this._buildUpdateCard(changelogData);
        this._buildCommunityCard(aboutData);
        if (this._store) {
            this._buildBackupCard(this._store);
        }
    }

    // ── Card 1: 插件版本与 GPL-3.0 协议 Hero 声明 ────────────────────────────────────
    private _buildHeroCard(aboutData: any): void {
        this._cardInfoEl = document.createElement('div');
        this._cardInfoEl.className = 'da-about-card-hero da-about-card-info';

        this._renderHeroContent(aboutData);

        const unsubHeroVersion = UpdateService.getInstance().subscribe((state) => {
            if (state.fullVersion && state.fullVersion !== this._currentVersionBadgeText) {
                this._currentVersionBadgeText = state.fullVersion;
                this._renderHeroContent(this._currentAboutData);
            }
        });
        this._disposables.add({ dispose: unsubHeroVersion });

        this._root.appendChild(this._cardInfoEl);
    }

    private _renderHeroContent(about: any): void {
        if (about) this._currentAboutData = about;
        const data = this._currentAboutData;

        if (!data) {
            this._cardInfoEl.innerHTML = `
                <div class="da-about-loading-line">
                    <h2 class="da-about-title">${escapeHtml(EXTENSION_DISPLAY_NAME)}</h2>
                    <span class="da-version-badge">${escapeHtml(this._currentVersionBadgeText)}</span>
                </div>
                <p class="da-about-status-hint" style="text-align:left;">正在加载插件配置信息...</p>
            `;
            return;
        }

        const highlightsHtml = (data.highlights || [])
            .map((h: string) => `<span class="da-about-highlight-chip">${escapeHtml(h)}</span>`)
            .join('');

        const licenseText = data.license || 'GPL-3.0';

        this._cardInfoEl.innerHTML = `
            <div class="da-about-hero-header">
                <h2 class="da-about-title">${escapeHtml(EXTENSION_DISPLAY_NAME)}</h2>
                <span class="da-version-badge">${escapeHtml(this._currentVersionBadgeText)}</span>
                <span class="da-version-badge da-license-badge">${escapeHtml(licenseText)}</span>
            </div>
            <p class="da-about-desc">
                ${escapeHtml(data.description || 'SillyTavern 上下文感知生图辅助扩展插件')}
            </p>
            ${highlightsHtml ? `<div class="da-about-highlights">${highlightsHtml}</div>` : ''}
            <div class="da-about-footer">
                <div class="da-about-author">作者：<strong>${escapeHtml(data.author || 'NoahFoya with AICode')}</strong></div>
                <div class="da-about-copyright">${escapeHtml(data.copyright || `© 2026 ${EXTENSION_DISPLAY_NAME}. Released under GPL-3.0.`)}</div>
            </div>
        `;
    }

    // ── Card 2: 版本与在线更新 ──────────────────────────────────────────────────
    private _buildUpdateCard(changelogData: any[] | null): void {
        const cardUpdate = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '版本与更新日志',
            description: '查阅当前插件运行版本、在线检测远端分支更新与功能变更履历'
        });
        cardUpdate.header.appendChild(header);

        const strip = document.createElement('div');
        strip.className = 'da-about-version-strip';

        // 左侧：版本胶囊 ({branch}_V{version})
        const leftGroup = document.createElement('div');
        leftGroup.className = 'da-about-strip-left';

        const versionCapsule = createVersionCapsule({ showUpdateTag: true });
        this._disposables.add(versionCapsule);
        leftGroup.appendChild(versionCapsule);

        const updateService = UpdateService.getInstance();

        // 右侧：检查更新 / 立即更新 按钮组 (响应式绑定)
        const rightGroup = document.createElement('div');
        rightGroup.className = 'da-about-strip-right';

        const renderRightButton = (state: Readonly<UpdateState>) => {
            rightGroup.innerHTML = '';
            if (state.isUpdating) {
                const updatingBtn = document.createElement('button');
                updatingBtn.type = 'button';
                updatingBtn.className = 'da-btn da-btn--primary da-btn--sm';
                updatingBtn.disabled = true;
                updatingBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在更新...';
                rightGroup.appendChild(updatingBtn);
            } else if (state.isChecking) {
                const checkingBtn = document.createElement('button');
                checkingBtn.type = 'button';
                checkingBtn.className = 'da-btn da-btn--primary da-btn--sm';
                checkingBtn.disabled = true;
                checkingBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 检测中...';
                rightGroup.appendChild(checkingBtn);
            } else if (state.hasUpdate) {
                const updateNowBtn = document.createElement('button');
                updateNowBtn.type = 'button';
                updateNowBtn.className = 'da-btn da-btn--primary da-btn--sm da-btn-pulse';
                updateNowBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> 立即更新';
                updateNowBtn.onclick = async () => {
                    const targetSha = state.remoteCommitSha || 'latest';
                    const descMsg = state.remoteCommitMessage ? `\n\n更新说明: ${state.remoteCommitMessage}` : '';
                    const confirmed = await FeedbackService.confirm({
                        title: '发现新版本提交',
                        message: `检测到 [${state.currentBranch}] 分支有新提交 (SHA: ${targetSha})。${descMsg}\n\n是否立即同步更新？`,
                        confirmText: '立即更新',
                        isDangerous: false
                    });
                    if (confirmed) {
                        const res = await updateService.applyUpdate();
                        if (res.success) {
                            FeedbackService.toastSuccess(res.message);
                            if (res.needsReload) {
                                setTimeout(() => {
                                    if (typeof window !== 'undefined') {
                                        window.location.reload();
                                    }
                                }, 1000);
                            }
                        } else {
                            FeedbackService.toastError(res.message);
                        }
                    }
                };
                rightGroup.appendChild(updateNowBtn);
            } else {
                const checkUpdateBtn = document.createElement('button');
                checkUpdateBtn.type = 'button';
                checkUpdateBtn.className = 'da-btn da-btn--primary da-btn--sm';
                checkUpdateBtn.innerHTML = '检查更新';
                checkUpdateBtn.onclick = async () => {
                    const res = await updateService.checkUpdate();
                    if (res.success) {
                        if (!res.hasUpdate) {
                            FeedbackService.toastSuccess(`当前运行已是最新提交 (SHA: ${res.currentSha || 'latest'})！`);
                        } else {
                            FeedbackService.toastSuccess(`发现新提交 (SHA: ${res.remoteSha}): ${res.remoteMessage || ''}`);
                        }
                    } else {
                        FeedbackService.toastWarn(res.message);
                    }
                };
                rightGroup.appendChild(checkUpdateBtn);
            }
        };

        const unsubUpdate = updateService.subscribe((state) => {
            renderRightButton(state);
        });
        this._disposables.add({ dispose: unsubUpdate });

        strip.appendChild(leftGroup);
        strip.appendChild(rightGroup);
        cardUpdate.body.appendChild(strip);

        // 更新日志明细框
        this._changelogBoxEl = document.createElement('div');
        this._changelogBoxEl.className = 'da-changelog-box';
        this._renderChangelogItems(changelogData);
        cardUpdate.body.appendChild(this._changelogBoxEl);

        this._root.appendChild(cardUpdate.root);
    }

    private _renderChangelogItems(items: any[] | null): void {
        if (!this._changelogBoxEl) return;
        if (!items) {
            this._changelogBoxEl.innerHTML = '<div class="da-about-status-hint">正在加载更新履历...</div>';
            return;
        }
        if (items.length === 0) {
            this._changelogBoxEl.innerHTML = '<div class="da-about-status-hint">暂未获取到更新日志</div>';
            return;
        }

        let changelogHtml = '';
        items.forEach((entry, idx) => {
            changelogHtml += `
                <div class="da-about-cl-entry ${idx > 0 ? 'da-about-cl-entry--sep' : ''}">${escapeHtml(entry.title || entry.version)}</div>
                <ul class="da-about-cl-list">
                    ${(entry.items || []).map((item: string) => `<li class="da-about-cl-item">${escapeHtml(item)}</li>`).join('')}
                </ul>
            `;
        });
        this._changelogBoxEl.innerHTML = changelogHtml;
    }

    // ── Card 3: 开源生态与社区支持 (2×3 现代水平流式卡片网格) ─────────────────
    private _buildCommunityCard(aboutData: any): void {
        const cardLinks = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '开源生态与社区支持',
            description: '查阅 GitHub 官方仓库、GPL-3.0 许可证、ComfyUI / SD-WebUI 生态及 SillyTavern 宿主社区'
        });
        cardLinks.header.appendChild(header);

        this._communityGridEl = document.createElement('div');
        this._communityGridEl.className = 'da-about-card-grid';
        this._renderCommunityLinks(aboutData);
        cardLinks.body.appendChild(this._communityGridEl);

        this._root.appendChild(cardLinks.root);
    }

    private _renderCommunityLinks(about: any): void {
        if (!this._communityGridEl) return;
        this._communityGridEl.innerHTML = '';
        if (!about || !about.communityLinks || about.communityLinks.length === 0) {
            this._communityGridEl.innerHTML = '<div class="da-about-empty-grid">暂无社区链接</div>';
            return;
        }

        about.communityLinks.forEach((linkItem: any) => {
            this._communityGridEl.appendChild(
                createRichCard({
                    icon: linkItem.icon,
                    title: linkItem.title,
                    subtitle: linkItem.subtitle,
                    href: linkItem.href,
                    themeClass: linkItem.themeClass
                })
            );
        });
    }

    // ── Card 4: 配置备份、导入与恢复 (纯净操作栏) ────────────────────────
    private _buildBackupCard(store: ObservableStore<DrawAssistantSettings>): void {
        const cardBackup = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '配置备份与恢复',
            description: '导出插件全量配置为标准 JSON 文件，或从外部备份中安全恢复'
        });
        cardBackup.header.appendChild(header);

        const btnRow = document.createElement('div');
        btnRow.className = 'da-gallery-batch-row da-about-btn-row';

        // 导出完整配置
        const exportFullBtn = document.createElement('button');
        exportFullBtn.type = 'button';
        exportFullBtn.className = 'da-btn da-btn--primary da-btn--sm';
        exportFullBtn.textContent = '导出完整配置';
        exportFullBtn.title = '导出包含当前所有后端参数、预设与密钥的完整配置文件';
        exportFullBtn.onclick = () => {
            downloadSettingsFile(store, false);
            FeedbackService.toastSuccess('已开始下载完整配置文件');
        };

        // 导出脱敏配置
        const exportSanitizedBtn = document.createElement('button');
        exportSanitizedBtn.type = 'button';
        exportSanitizedBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        exportSanitizedBtn.textContent = '导出脱敏配置';
        exportSanitizedBtn.title = '导出配置并将所有 API 密钥与服务地址脱敏，适合公开分享';
        exportSanitizedBtn.onclick = () => {
            downloadSettingsFile(store, true);
            FeedbackService.toastSuccess('已开始下载脱敏分享配置文件');
        };

        // 隐藏的 File Input 用于导入
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';

        const importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        importBtn.textContent = '导入配置';
        importBtn.title = '从外部 JSON 备份文件恢复或导入配置方案';
        importBtn.onclick = () => {
            fileInput.click();
        };

        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;

            const confirmed = await FeedbackService.confirm({
                title: '导入配置确认',
                message: `确定要从文件 "${file.name}" 导入配置吗？这将覆盖当前的所有参数与预设。`,
                isDangerous: false
            });

            if (confirmed) {
                const reader = new FileReader();
                reader.onload = () => {
                    const text = String(reader.result || '');
                    const result = importSettingsPackage(text, store);
                    if (result.success) {
                        FeedbackService.toastSuccess(result.message);
                    } else {
                        FeedbackService.toastError(result.message);
                    }
                    fileInput.value = '';
                };
                reader.onerror = () => {
                    FeedbackService.toastError('读取配置文件失败');
                    fileInput.value = '';
                };
                reader.readAsText(file);
            } else {
                fileInput.value = '';
            }
        };

        // 重置插件全部设置
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'da-btn da-btn--danger da-btn--sm';
        resetBtn.textContent = '重置全部设置';
        resetBtn.title = '重置所有插件设置为默认初始值并重新加载当前内置方案';
        resetBtn.onclick = async () => {
            const confirmed = await FeedbackService.confirm({
                title: '确认重置插件设置',
                message: '确定要重置所有插件设置为默认初始值，并重新加载当前实际读取到的内置预设方案吗？',
                confirmText: '重置全部设置',
                isDangerous: true
            });
            if (confirmed) {
                store.reset(createDefaultSettings());
                await hydrateSettingsFromPresets(store, undefined, true);
                const curTheme = store.getState().customThemes?.find((t) => t.id === store.getState().themePreset);
                ThemeService.applyThemeVariables(curTheme?.data || DEFAULT_THEME_DATA);
                FeedbackService.toastSuccess('插件设置与内置方案已成功重置！');
            }
        };

        btnRow.appendChild(exportFullBtn);
        btnRow.appendChild(exportSanitizedBtn);
        btnRow.appendChild(importBtn);
        btnRow.appendChild(fileInput);
        btnRow.appendChild(resetBtn);
        cardBackup.body.appendChild(btnRow);

        this._root.appendChild(cardBackup.root);
    }
}

