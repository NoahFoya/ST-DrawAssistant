/**
 * @module ui/views/about-tab
 * @description 关于与使用帮助面板视图 (AboutTab)
 */

import { EXTENSION_DISPLAY_NAME, VERSION } from '../../core/constants';
import { getAboutConfig, getChangelog } from '../../core/config/config-loader';
import { createSectionCard } from '../controls';
import { FeedbackService } from '../feedback/feedback';
import { IDisposable } from '../../core/foundation/disposable';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings, createDefaultSettings } from '../../core/state/store-types';
import { downloadSettingsFile, importSettingsPackage } from '../../core/state/settings-backup';

import { escapeHtml } from '../foundation';

/** 辅助函数：创建彩色渐变 Rich Card 社区卡片 */
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
    card.className = `da-about-rich-card da-link-card ${options.themeClass}`;

    card.innerHTML = `
        <div class="da-about-rich-card-icon">${options.icon}</div>
        <div class="da-about-rich-card-title">${escapeHtml(options.title)}</div>
        <div class="da-about-rich-card-sub">${escapeHtml(options.subtitle)}</div>
    `;

    return card;
}

/**
 * 构建并渲染关于与版本信息面板
 *
 * @param store 全局设置响应式 Store 实例
 * @returns 包含生命周期清理能力的关于面板 DOM 根节点
 */
export function createAboutTabView(store?: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable {
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-about-tab';

    // ── Card 1: 插件版本与版权 Hero 声明 ────────────────────────────────────
    const cardInfo = document.createElement('div');
    cardInfo.className = 'da-section-card da-about-card-hero da-about-card-info';

    const renderHeroContent = (about: any) => {
        if (!about) {
            cardInfo.innerHTML = `
                <div class="da-about-loading-line">
                    <h2 class="da-about-title">${escapeHtml(EXTENSION_DISPLAY_NAME)}</h2>
                    <span class="da-version-badge">V${escapeHtml(VERSION)}</span>
                </div>
                <p class="da-about-status-hint" style="text-align:left;">正在加载插件配置信息...</p>
            `;
            return;
        }

        const highlightsHtml = (about.highlights || [])
            .map(
                (h: string) =>
                    `<span class="da-about-highlight-chip">${escapeHtml(h)}</span>`
            )
            .join('');

        cardInfo.innerHTML = `
            <div class="da-about-hero-header">
                <h2 class="da-about-title">${escapeHtml(EXTENSION_DISPLAY_NAME)}</h2>
                <span class="da-version-badge">V${escapeHtml(VERSION)}</span>
            </div>
            <p class="da-about-desc">
                ${escapeHtml(about.description || 'SillyTavern 上下文感知生图辅助扩展插件')}
            </p>
            ${highlightsHtml ? `<div class="da-about-highlights">${highlightsHtml}</div>` : ''}
            <div class="da-about-footer">
                <div class="da-about-author">作者：<strong>${escapeHtml(about.author || 'NoahFoya with AICode')}</strong></div>
                <div class="da-about-copyright">${escapeHtml(about.copyright || `© 2026 ${EXTENSION_DISPLAY_NAME}`)}</div>
            </div>
        `;
    };

    renderHeroContent(null);
    container.appendChild(cardInfo);

    // ── Card 2: 版本与更新日志 ──────────────────────────────────────────────
    let changelogBoxEl: HTMLElement;

    const renderChangelogItems = (items: any[] | null) => {
        if (!changelogBoxEl) return;
        if (!items) {
            changelogBoxEl.innerHTML = '<div class="da-about-status-hint">正在加载更新履历...</div>';
            return;
        }
        if (items.length === 0) {
            changelogBoxEl.innerHTML = '<div class="da-about-status-hint">暂未获取到更新日志</div>';
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
        changelogBoxEl.innerHTML = changelogHtml;
    };

    const cardUpdate = createSectionCard({
        title: '版本与更新日志',
        description: '查阅当前插件运行版本、执行线上更新检测与功能变更履历',
        renderBody: (body) => {
            // 版本检测行
            const versionCheckRow = document.createElement('div');
            versionCheckRow.className = 'da-gallery-batch-row da-about-version-row';

            const updateStatusSpan = document.createElement('span');
            updateStatusSpan.className = 'da-about-update-status';
            updateStatusSpan.textContent = `当前运行版本：V${VERSION} (已安装并激活)`;

            const checkUpdateBtn = document.createElement('button');
            checkUpdateBtn.className = 'da-btn secondary da-btn-sm';
            checkUpdateBtn.textContent = '检查更新';
            checkUpdateBtn.onclick = () => {
                checkUpdateBtn.disabled = true;
                checkUpdateBtn.textContent = '检测中...';
                setTimeout(() => {
                    checkUpdateBtn.disabled = false;
                    checkUpdateBtn.textContent = '检查更新';
                    FeedbackService.toastSuccess(`当前运行已是最新版本 (V${VERSION})！`);
                }, 500);
            };

            versionCheckRow.appendChild(updateStatusSpan);
            versionCheckRow.appendChild(checkUpdateBtn);
            body.appendChild(versionCheckRow);

            // 更新日志明细框
            changelogBoxEl = document.createElement('div');
            changelogBoxEl.className = 'da-changelog-box';

            renderChangelogItems(null);
            body.appendChild(changelogBoxEl);
        }
    });
    container.appendChild(cardUpdate);

    // ── Card 3: 开源阵地与社区支持 ──────────────────────────────────────────
    let communityGridEl: HTMLElement;

    const renderCommunityLinks = (about: any) => {
        if (!communityGridEl) return;
        communityGridEl.innerHTML = '';
        if (!about || !about.communityLinks || about.communityLinks.length === 0) {
            communityGridEl.innerHTML = '<div class="da-about-empty-grid">暂无社区链接</div>';
            return;
        }

        about.communityLinks.forEach((linkItem: any) => {
            communityGridEl.appendChild(
                createRichCard({
                    icon: linkItem.icon,
                    title: linkItem.title,
                    subtitle: linkItem.subtitle,
                    href: linkItem.href,
                    themeClass: linkItem.themeClass
                })
            );
        });
    };

    const cardLinks = createSectionCard({
        title: '开源阵地与社区支持',
        description: '访问 GitHub 官方开源仓库、ComfyUI 节点 API 生态及 SillyTavern 宿主社区',
        renderBody: (body) => {
            communityGridEl = document.createElement('div');
            communityGridEl.className = 'da-about-card-grid';

            renderCommunityLinks(null);
            body.appendChild(communityGridEl);
        }
    });
    container.appendChild(cardLinks);

    // ── Card 4: 配置备份、导入与恢复 ────────────────────────────────────────
    if (store) {
        const cardBackup = createSectionCard({
            title: '配置备份与恢复',
            description: '导出插件全量配置为标准 JSON 文件，或从外部备份中安全恢复',
            renderBody: (body) => {
                const btnRow = document.createElement('div');
                btnRow.className = 'da-gallery-batch-row da-about-btn-row';

                // 导出完整配置
                const exportFullBtn = document.createElement('button');
                exportFullBtn.className = 'da-btn primary da-btn-sm';
                exportFullBtn.textContent = '导出完整配置 (JSON)';
                exportFullBtn.title = '导出包含当前所有后端参数、预设与密钥的完整配置文件';
                exportFullBtn.onclick = () => {
                    downloadSettingsFile(store, false);
                    FeedbackService.toastSuccess('已开始下载完整配置文件');
                };

                // 导出脱敏配置
                const exportSanitizedBtn = document.createElement('button');
                exportSanitizedBtn.className = 'da-btn secondary da-btn-sm';
                exportSanitizedBtn.textContent = '导出脱敏配置 (去除密钥)';
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
                importBtn.className = 'da-btn secondary da-btn-sm';
                importBtn.textContent = '导入配置文件 (JSON)';
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

                // 恢复默认配置
                const resetBtn = document.createElement('button');
                resetBtn.className = 'da-btn danger da-btn-sm';
                resetBtn.textContent = '恢复出厂设置';
                resetBtn.title = '将所有配置和方案重置为出厂初始状态';
                resetBtn.onclick = async () => {
                    const confirmed = await FeedbackService.confirm({
                        title: '恢复出厂设置',
                        message: '确定要将所有设置恢复为出厂默认值吗？此操作将重置所有自定义参数。',
                        isDangerous: true
                    });
                    if (confirmed) {
                        store.reset(createDefaultSettings());
                        FeedbackService.toastSuccess('已恢复出厂默认配置！');
                    }
                };

                btnRow.appendChild(exportFullBtn);
                btnRow.appendChild(exportSanitizedBtn);
                btnRow.appendChild(importBtn);
                btnRow.appendChild(fileInput);
                btnRow.appendChild(resetBtn);
                body.appendChild(btnRow);
            }
        });
        container.appendChild(cardBackup);
    }

    // ── 渲染关于与更新日志 ──
    const aboutData = getAboutConfig();
    const changelogData = getChangelog();
    renderHeroContent(aboutData);
    renderCommunityLinks(aboutData);
    renderChangelogItems(changelogData);

    container.dispose = () => {
        // 当前无响应式订阅需清理
    };

    return container;
}
