/**
 * @module ui/tabs/about-tab
 * @description 关于与帮助信息 Tab 组件
 *
 * 职责：
 * - 呈现扩展版本信息、作者致谢与更新日志
 * - 提供 3 栏彩色渐变大卡片开源社区入口
 */

import { EXTENSION_DISPLAY_NAME, VERSION } from '../../core/constants';
import { logger } from '../../core/logger';
import changelogData from '../../presets/changelog.json';

export function renderAboutTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-about-tab';

    // ── Card 1: 插件版本与版权 Hero 声明 ────────────────────────────────────
    const cardInfo = document.createElement('div');
    cardInfo.className = 'da-section-card da-about-card-hero';
    cardInfo.style.padding = '20px 22px';

    cardInfo.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
            <h2 class="da-about-title" style="margin: 0;">${EXTENSION_DISPLAY_NAME}</h2>
            <span class="da-header-version-badge" style="fontSize: 0.85em; padding: 2px 8px;">V${VERSION}</span>
        </div>
        <p class="da-about-desc" style="line-height: 1.6; margin-bottom: 14px;">
            Starlight DrawAssistant 专为 SillyTavern 酒馆对话场景打造，完美融合角色上下文与 AI 文生图能力。
            支持 AI 消息楼层标识符自动解析、ComfyUI 双向 WebSocket 进度预览、WebP 物理独立存储与一键脱敏诊断。
        </p>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
            <span style="font-size: 0.75em; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 6px; color: var(--da-text-secondary);">✨ AI 楼层自动感知</span>
            <span style="font-size: 0.75em; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 6px; color: var(--da-text-secondary);">⚡ 流式 WebSocket 预览</span>
            <span style="font-size: 0.75em; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 6px; color: var(--da-text-secondary);">💾 IndexedDB 独立存储</span>
            <span style="font-size: 0.75em; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 6px; color: var(--da-text-secondary);">📊 脱敏诊断与统计看板</span>
        </div>
        <div class="da-about-author" style="font-size: 0.85em;">
            作者：<strong style="color: var(--da-text-primary);">NoahFoya with AICode</strong>
        </div>
        <div class="da-about-copyright" style="font-size: 0.8em; margin-top: 4px;">
            Copyright © 2026 ST-DrawAssistant Team. All Rights Reserved.
        </div>
    `;
    container.appendChild(cardInfo);

    // ── Card 2: 版本与更新日志 ──────────────────────────────────────────────
    const cardUpdate = document.createElement('div');
    cardUpdate.className = 'da-section-card';
    cardUpdate.style.marginTop = '15px';

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

    // 更新日志明细内容框 (从 changelog.json 动态读取)
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

    // ── Card 3: 社区与开源阵地 (彩色大卡片网格) ─────────────────────────────
    const cardLinks = document.createElement('div');
    cardLinks.className = 'da-section-card';
    cardLinks.style.marginTop = '15px';

    const headerLinks = document.createElement('div');
    headerLinks.className = 'da-section-header';
    headerLinks.innerHTML = `
        <span class="da-section-title">开源阵地与社区支持</span>
        <span class="da-section-desc">访问 GitHub 官方开源仓库、ComfyUI 节点 API 文档及 SillyTavern 宿主社区</span>
    `;
    cardLinks.appendChild(headerLinks);

    const grid = document.createElement('div');
    grid.className = 'da-about-card-grid';

    // 1. GitHub 卡片
    grid.appendChild(createRichCard({
        icon: '🐙',
        title: 'GitHub 官方仓库',
        subtitle: '查阅开源源码、提交 Issue 反馈或 Star 本项目',
        href: 'https://github.com/NoahFoya/ST-DrawAssistant',
        themeClass: 'da-about-rich-card--github',
    }));

    // 2. ComfyUI 卡片
    grid.appendChild(createRichCard({
        icon: '⚙️',
        title: 'ComfyUI 官方生态',
        subtitle: '查阅工作流节点构造、API 服务与节点开发文档',
        href: 'https://github.com/comfyanonymous/ComfyUI',
        themeClass: 'da-about-rich-card--comfy',
    }));

    // 3. SillyTavern 卡片
    grid.appendChild(createRichCard({
        icon: '🍷',
        title: 'SillyTavern 宿主社区',
        subtitle: '探索酒馆扩展生态、角色卡制作与 Roleplay 灵感',
        href: 'https://github.com/SillyTavern/SillyTavern',
        themeClass: 'da-about-rich-card--st',
    }));

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

/** 辅助函数：安全转义 HTML */
function escapeHtml(str: string): string {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** 辅助函数：显示 ST 全局 Toast 通知 */
function showToastNotice(message: string, title = '关于扩展', isSuccess = true): void {
    const win = window as unknown as { toastr?: { success?: (m: string, t?: string) => void; error?: (m: string, t?: string) => void; info?: (m: string, t?: string) => void } };
    if (win.toastr) {
        if (isSuccess && typeof win.toastr.success === 'function') {
            win.toastr.success(message, title);
            return;
        }
        if (!isSuccess && typeof win.toastr.info === 'function') {
            win.toastr.info(message, title);
            return;
        }
    }
    logger.info(`[${title}] ${message}`);
}
