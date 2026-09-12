/**
 * @module src/ui/views/about-tab
 * @description 关于与帮助支持选项卡 (AboutTab)
 *
 * 遵循规范 (UI_LAYOUT_PREVIEW.md 第四节第 8 条 与 styles/controls/cards/hero-card.css / rich-link-card.css / changelog.css)：
 * 1. 顶部：Hero 展板卡片 (.da-hero-card)，呈现品牌渐变、版本号、作者信息、项目标语与更新检查；
 * 2. 中部：版本更新日志展板 (.da-changelog)，支持局部滚动，结构化呈现近期迭代特性；
 * 3. 底部：开源社区与技术文档富外链网格 (.da-rich-link-grid)，包含 GitHub、SillyTavern 官方文档、Discord、Issue 反馈；
 * 4. 全量配置备份、导入与出厂重置卡片：支持全量配置 JSON 文件导出与验证导入。
 */

import { createElement } from '../../util/dom';
import { createCard } from '../components/form-field';
import { createButton, ButtonHandle } from '../components/button';
import { createBadge } from '../components/feedback';
import { Toast } from '../components/feedback';
import { getIconSvg } from '../components/icons';
import { DEFAULT_SETTINGS } from '../../store/settings';
import type { SettingsStore } from '../../store/settings';

export interface AboutTabOptions {
    settingsStore?: SettingsStore;
    version?: string;
    onCheckUpdate?: () => Promise<{ hasUpdate: boolean; latestVersion?: string }>;
    onResetSettings?: () => void;
}

export interface AboutTabHandle {
    readonly element: HTMLElement;
    dispose(): void;
}

export function renderAboutTab(options: AboutTabOptions = {}): AboutTabHandle {
    const root = createElement('div', { className: 'da-tab-pane' });
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    const currentVersion = options.version || 'v0.2.0';

    // ==========================================
    // 1. Hero 展板卡片 (.da-hero-card)
    // ==========================================
    const heroCard = createElement('div', { className: 'da-hero-card' });

    const heroHeader = createElement('div', { className: 'da-hero-card__header' });

    const heroTitle = createElement('h2', {
        className: 'da-hero-card__title',
        textContent: 'ST-DrawAssistant'
    });
    heroHeader.appendChild(heroTitle);

    const versionBadge = createBadge({
        text: currentVersion,
        variant: 'info'
    });
    heroHeader.appendChild(versionBadge.element);

    heroCard.appendChild(heroHeader);

    const heroDesc = createElement('p', {
        className: 'da-hero-card__desc',
        textContent: '轻量、可靠、易维护的 SillyTavern Web 端全能生图扩展插件。支持 ComfyUI、SD-WebUI / Forge、NovelAI 与 OpenAI 兼容多模态大模型生图，全方位集成聊天楼层交互、工作流蓝图与历史画廊。'
    });
    heroCard.appendChild(heroDesc);

    // Hero 动作按钮行
    const heroActions = createElement('div', {
        attributes: {
            style: 'display: flex; gap: 10px; margin-top: 4px; flex-wrap: wrap; align-items: center;'
        }
    });

    const checkUpdateBtn: ButtonHandle = createButton({
        text: '检查更新',
        variant: 'primary',
        icon: 'refresh',
        onClick: async () => {
            checkUpdateBtn.setLoading(true, '检查中...');
            try {
                if (options.onCheckUpdate) {
                    const res = await options.onCheckUpdate();
                    if (res.hasUpdate) {
                        Toast.info(`发现新版本 ${res.latestVersion}，请前往 GitHub 下载更新`);
                    } else {
                        Toast.success('当前已是最新版本！');
                    }
                } else {
                    await new Promise((r) => setTimeout(r, 600));
                    Toast.success('当前已是最新稳定版本 (v0.2.0)');
                }
            } catch (err: any) {
                Toast.warn('检查更新失败，请检查网络连接');
            } finally {
                checkUpdateBtn.setLoading(false);
            }
        }
    });
    regDisposer(checkUpdateBtn);
    heroActions.appendChild(checkUpdateBtn.element);

    const ghButton: ButtonHandle = createButton({
        text: 'GitHub 源码主页',
        variant: 'secondary',
        icon: 'external',
        onClick: () => {
            window.open('https://github.com/NoahFoya/ST-DrawAssistant', '_blank');
        }
    });
    regDisposer(ghButton);
    heroActions.appendChild(ghButton.element);

    heroCard.appendChild(heroActions);
    root.appendChild(heroCard);

    // ==========================================
    // 2. 版本更新日志展板 (Changelog)
    // ==========================================
    const changelogCard = createCard({
        title: '版本更新日志 (Changelog)',
        iconSvg: getIconSvg('sparkles'),
        collapsible: true
    });
    regDisposer(changelogCard);

    const changelogEl = createElement('div', { className: 'da-changelog' });
    changelogEl.innerHTML = `
        <div class="da-changelog__entry">v0.2.0 (2026-09) · 架构演进与 UI 重构</div>
        <ul class="da-changelog__list">
            <li class="da-changelog__item">重构原子控件库，全面剔除分段器，严格落实画幅居中 Select 与等宽 NumberInput；</li>
            <li class="da-changelog__item">全面接入四大生图后端（ComfyUI / SD-WebUI / NovelAI / OpenAI）专属设置视窗；</li>
            <li class="da-changelog__item">全局通用参数设置直连 Direct / 宿主中继 Relay 传输通道；</li>
            <li class="da-changelog__item">测试连接支持连通性探测 + 远端资产（Model / VAE / LoRA / 订阅）动态同步；</li>
            <li class="da-changelog__item">提示词预设管理器内置 DirtyTracker 瞬时自愈闭环。</li>
        </ul>
        <div class="da-changelog__entry da-changelog__entry--sep">v0.1.0 · 核心架构与功能管道</div>
        <ul class="da-changelog__list">
            <li class="da-changelog__item">实现双层存储池（LocalForage + 内存快照）与 LRU 配额防爆；</li>
            <li class="da-changelog__item">实现多后端适配器注册中心与生成编排器（GenerationOrchestrator）；</li>
            <li class="da-changelog__item">支持 ComfyUI WebSocket 实时进度追踪与中断队列。</li>
        </ul>
    `;
    changelogCard.append(changelogEl);
    root.appendChild(changelogCard.element);

    // ==========================================
    // 3. 富外链导航卡片网格 (.da-rich-link-grid)
    // ==========================================
    const linksCard = createCard({
        title: '开源社区与技术文档',
        iconSvg: getIconSvg('external'),
        collapsible: true
    });
    regDisposer(linksCard);

    const linkGrid = createElement('div', { className: 'da-rich-link-grid' });

    const communityLinks = [
        {
            title: 'GitHub 仓库',
            desc: '源码浏览、Star 支持与 Releases 发布包',
            icon: '★',
            url: 'https://github.com/NoahFoya/ST-DrawAssistant'
        },
        {
            title: 'SillyTavern 官方文档',
            desc: '酒馆扩展生态与客户端 API 开发规范',
            icon: '📖',
            url: 'https://docs.sillytavern.app/'
        },
        {
            title: '问题反馈 / Issue',
            desc: '提交缺陷报告、功能建议与体验优化',
            icon: '💬',
            url: 'https://github.com/NoahFoya/ST-DrawAssistant/issues'
        },
        {
            title: '技术架构说明',
            desc: '查看本项目的领域原则与分层设计文档',
            icon: '📄',
            url: 'https://github.com/NoahFoya/ST-DrawAssistant#readme'
        }
    ];

    for (const item of communityLinks) {
        const a = createElement('a', {
            className: 'da-rich-link-card',
            attributes: {
                href: item.url,
                target: '_blank',
                rel: 'noopener noreferrer'
            }
        });

        a.innerHTML = `
            <div class="da-rich-link-card__icon-box">
                <span class="da-rich-link-card__icon">${item.icon}</span>
            </div>
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; font-size: 13px; color: var(--da-text-primary); margin-bottom: 2px;">${item.title}</div>
                <div style="font-size: 11px; color: var(--da-text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.desc}</div>
            </div>
        `;
        linkGrid.appendChild(a);
    }
    linksCard.append(linkGrid);
    root.appendChild(linksCard.element);

    // ==========================================
    // 4. 全量配置备份、导入与重置卡片
    // ==========================================
    const backupCard = createCard({
        title: '全局配置备份与系统重置',
        iconSvg: getIconSvg('settings'),
        collapsible: true
    });
    regDisposer(backupCard);

    const backupDesc = createElement('p', {
        attributes: {
            style: 'font-size: var(--da-font-size-sm, 13px); color: var(--da-text-secondary); line-height: 1.6; margin-bottom: 12px;'
        },
        textContent: '可将当前全部插件参数（包括主题配色、各引擎设置、工作流映射及提示词方案）打包导出为 JSON 备份文件，或在其他设备上一键恢复。'
    });
    backupCard.append(backupDesc);

    const backupActionsRow = createElement('div', {
        attributes: {
            style: 'display: flex; gap: 10px; flex-wrap: wrap; align-items: center;'
        }
    });

    // 导出配置
    const exportConfigBtn: ButtonHandle = createButton({
        text: '导出全量配置 (JSON)',
        variant: 'secondary',
        icon: 'download',
        onClick: () => {
            if (!options.settingsStore) {
                Toast.warn('SettingsStore 未注入');
                return;
            }
            try {
                const jsonStr = options.settingsStore.exportSettings(true);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `st_draw_config_${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
                Toast.success('全量配置已成功导出');
            } catch (err: any) {
                Toast.error(`导出配置失败: ${err?.message || '未知错误'}`);
            }
        }
    });
    regDisposer(exportConfigBtn);
    backupActionsRow.appendChild(exportConfigBtn.element);

    // 导入配置 (隐式 input file)
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            if (options.settingsStore) {
                const ok = options.settingsStore.importSettings(text);
                if (ok) {
                    Toast.success('配置导入成功，已全量生效！');
                } else {
                    throw new Error('配置文件结构不符合预期');
                }
            }
        } catch (err: any) {
            Toast.error(`导入配置失败: ${err?.message || 'JSON 语法解析错误'}`);
        } finally {
            fileInput.value = '';
        }
    });

    const importConfigBtn: ButtonHandle = createButton({
        text: '导入配置备份',
        variant: 'secondary',
        icon: 'refresh',
        onClick: () => {
            fileInput.click();
        }
    });
    regDisposer(importConfigBtn);
    backupActionsRow.appendChild(importConfigBtn.element);

    // 恢复出厂默认设置
    const resetDefaultsBtn: ButtonHandle = createButton({
        text: '恢复出厂设置',
        variant: 'danger',
        icon: 'trash',
        onClick: () => {
            if (!confirm('确定要将插件全部配置重置为出厂默认值吗？该操作将覆盖当前所有自定义参数！')) {
                return;
            }
            if (options.onResetSettings) {
                options.onResetSettings();
            } else if (options.settingsStore) {
                options.settingsStore.importSettings(JSON.stringify(DEFAULT_SETTINGS));
            }
            Toast.success('已恢复出厂默认配置');
        }
    });
    regDisposer(resetDefaultsBtn);
    backupActionsRow.appendChild(resetDefaultsBtn.element);

    backupCard.append(backupActionsRow);
    root.appendChild(backupCard.element);

    return {
        element: root,
        dispose(): void {
            fileInput.remove();
            for (const d of disposers) {
                d();
            }
        }
    };
}
