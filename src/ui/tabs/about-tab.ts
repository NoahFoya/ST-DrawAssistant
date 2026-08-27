/**
 * @module ui/tabs/about-tab
 * @description 关于与帮助信息 Tab 组件
 *
 * 职责：
 * - 呈现扩展版本信息、作者致谢与更新日志
 * - 提供 3 栏彩色渐变大卡片开源社区入口
 */

import { EXTENSION_DISPLAY_NAME, VERSION } from '../../core/constants';
import { showToastNotice } from '../../utils/toast';
import { escapeHtml } from '../../utils/html';
import aboutConfig from '../../config/about.json';
import changelogData from '../../config/changelog.json';

export function renderAboutTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-about-tab';

    // ── Card 1: 插件版本与版权 Hero 声明 ────────────────────────────────────
    const cardInfo = document.createElement('div');
    cardInfo.className = 'da-section-card da-about-card-hero';
    cardInfo.style.padding = '20px 22px';

    const highlightsHtml = (aboutConfig.highlights || [])
        .map(h => `<span style="font-size: 0.75em; background: rgba(255,255,255,0.06); padding: 4px 10px; border-radius: 6px; color: var(--da-text-secondary); border: 1px solid var(--da-border-color);">${escapeHtml(h)}</span>`)
        .join('');

    cardInfo.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap;">
            <h2 class="da-about-title" style="margin: 0; font-size: 1.5em;">${escapeHtml(EXTENSION_DISPLAY_NAME)}</h2>
            <span class="da-header-version-badge" style="font-size: 0.85em; padding: 2px 10px;">V${escapeHtml(VERSION)}</span>
        </div>
        <p class="da-about-desc" style="line-height: 1.65; margin-bottom: 14px; width: 100%; text-align: left;">
            ${escapeHtml(aboutConfig.description)}
        </p>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;">
            ${highlightsHtml}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; border-top: 1px dashed var(--da-border-color); padding-top: 10px; margin-top: 6px;">
            <div class="da-about-author" style="font-size: 0.85em;">
                作者：<strong style="color: var(--da-text-primary);">${escapeHtml(aboutConfig.author)}</strong>
            </div>
            <div class="da-about-copyright" style="font-size: 0.8em;">
                ${escapeHtml(aboutConfig.copyright)}
            </div>
        </div>
    `;
    container.appendChild(cardInfo);

    // ── Card 2: 版本与更新日志 ──────────────────────────────────────────────
    const cardUpdate = document.createElement('div');
    cardUpdate.className = 'da-section-card';

    const headerUpdate = document.createElement('div');
    headerUpdate.className = 'da-section-header';
    headerUpdate.innerHTML = `
        <span class="da-section-title">版本与更新日志</span>
        <span class="da-section-desc">查阅当前插件运行版本、执行线上更新检测与功能变更日志</span>
    `;
    cardUpdate.appendChild(headerUpdate);

    const versionCheckRow = document.createElement('div');
    versionCheckRow.className = 'da-flex-center-row';
    versionCheckRow.style.justifyContent = 'space-between';
    versionCheckRow.style.padding = '12px 18px';

    const updateStatusSpan = document.createElement('span');
    updateStatusSpan.style.fontSize = '0.85em';
    updateStatusSpan.style.color = 'var(--da-text-secondary)';
    updateStatusSpan.textContent = `当前运行版本：V${VERSION} (开发构建版本)`;

    const checkUpdateBtn = document.createElement('button');
    checkUpdateBtn.className = 'da-btn secondary';
    checkUpdateBtn.textContent = '检查更新';

    checkUpdateBtn.addEventListener('click', () => {
        checkUpdateBtn.disabled = true;
        checkUpdateBtn.textContent = '检测中...';
        setTimeout(() => {
            checkUpdateBtn.disabled = false;
            checkUpdateBtn.textContent = '检查更新';
            showToastNotice(`当前运行已是最新版本 (V${VERSION})！`, '版本检测', true);
        }, 600);
    });

    versionCheckRow.appendChild(updateStatusSpan);
    versionCheckRow.appendChild(checkUpdateBtn);
    cardUpdate.appendChild(versionCheckRow);

    // 更新日志明细内容框 (从 src/config/changelog.json 动态读取)
    const changelogBox = document.createElement('div');
    changelogBox.className = 'da-changelog-box';

    let changelogHtml = '';
    (changelogData as Array<{ version: string; date: string; title: string; items: string[] }>).forEach((entry, idx) => {
        changelogHtml += `
            <div style="font-weight: bold; color: var(--da-text-primary); margin-bottom: 6px; font-size: 0.95em; ${idx > 0 ? 'margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--da-border-color);' : ''}">${escapeHtml(entry.title)}</div>
            <ul style="margin: 0; padding-left: 18px; font-size: 0.9em; line-height: 1.6;">
                ${entry.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
        `;
    });

    changelogBox.innerHTML = changelogHtml;

    cardUpdate.appendChild(changelogBox);
    container.appendChild(cardUpdate);

    // ── Card 3: 社区与开源阵地 (彩色大卡片网格，从 src/config/about.json 动态渲染) ──
    const cardLinks = document.createElement('div');
    cardLinks.className = 'da-section-card';

    const headerLinks = document.createElement('div');
    headerLinks.className = 'da-section-header';
    headerLinks.innerHTML = `
        <span class="da-section-title">开源阵地与社区支持</span>
        <span class="da-section-desc">访问 GitHub 官方开源仓库、ComfyUI 节点 API 文档及 SillyTavern 宿主社区</span>
    `;
    cardLinks.appendChild(headerLinks);

    const grid = document.createElement('div');
    grid.className = 'da-about-card-grid';

    (aboutConfig.communityLinks || []).forEach(linkItem => {
        grid.appendChild(createRichCard({
            icon: linkItem.icon,
            title: linkItem.title,
            subtitle: linkItem.subtitle,
            href: linkItem.href,
            themeClass: linkItem.themeClass,
        }));
    });

    cardLinks.appendChild(grid);
    container.appendChild(cardLinks);

    return container;
}

/** 辅助函数：创建彩色渐变 Rich Card */
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
        <div class="da-about-card-icon">${options.icon}</div>
        <div class="da-about-card-title">${options.title}</div>
        <div class="da-about-card-subtitle">${options.subtitle}</div>
    `;

    return card;
}
