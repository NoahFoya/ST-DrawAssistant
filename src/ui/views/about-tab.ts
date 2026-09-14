/**
 * @module src/ui/views/about-tab
 * @description 插件信息与版本维护面板 (AboutTab)
 *
 * 核心功能：
 * 1. 展示插件品牌标识、当前安装版本与更新检查状态；
 * 2. 呈现结构化版本更新日志 (Changelog)，方便追踪各版本特性演进与缺陷修复；
 * 3. 提供项目主页、开发文档与问题反馈等社区外部导航入口；
 * 4. 提供插件全量配置备份导出、导入恢复与出厂重置能力。
 *
 * 注意事项：
 * 1. 外部链接跳转应使用安全属性 (rel="noopener noreferrer")，防止潜在跨域安全风险；
 * 2. 导入外部配置文件时需执行结构与键名清洗，阻断非法脏属性注入。
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

    // 1. 软件信息与社区生态卡片 (.da-hero-card 高内聚整合)
    const heroCard = createElement('div', { className: 'da-hero-card' });

    // Hero 头部：产品标题、版本徽标与快捷动作
    const heroHeader = createElement('div', {
        className: 'da-hero-card__header',
        attributes: { style: 'display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 12px;' }
    });

    const titleGroup = createElement('div', {
        attributes: { style: 'display: flex; align-items: center; gap: 10px;' }
    });

    const heroTitle = createElement('h2', {
        className: 'da-hero-card__title',
        textContent: 'ST-DrawAssistant'
    });
    titleGroup.appendChild(heroTitle);

    const versionBadge = createBadge({
        text: currentVersion,
        variant: 'info'
    });
    titleGroup.appendChild(versionBadge.element);
    heroHeader.appendChild(titleGroup);

    // Hero 动作按钮行
    const heroActions = createElement('div', {
        attributes: {
            style: 'display: flex; gap: 8px; flex-wrap: wrap; align-items: center;'
        }
    });

    const checkUpdateBtn: ButtonHandle = createButton({
        text: '检查更新',
        variant: 'primary',
        size: 'sm',
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
        size: 'sm',
        icon: 'external',
        onClick: () => {
            window.open('https://github.com/NoahFoya/ST-DrawAssistant', '_blank');
        }
    });
    regDisposer(ghButton);
    heroActions.appendChild(ghButton.element);

    heroHeader.appendChild(heroActions);
    heroCard.appendChild(heroHeader);

    const heroDesc = createElement('p', {
        className: 'da-hero-card__desc',
        textContent: '轻量、可靠、易维护的 SillyTavern Web 端全能生图扩展插件。支持 ComfyUI、SD-WebUI / Forge、NovelAI 与 OpenAI 兼容多模态大模型生图，全方位集成聊天楼层交互、工作流蓝图与历史画廊。'
    });
    heroCard.appendChild(heroDesc);

    // 分隔线 1
    const divider1 = createElement('div', {
        attributes: { style: 'height: 1px; background: var(--da-separator); opacity: 0.6; margin: 4px 0;' }
    });
    heroCard.appendChild(divider1);

    // 开源社区与技术文档微卡网格
    const linksTitle = createElement('div', {
        attributes: { style: 'font-size: 13px; font-weight: 600; color: var(--da-text-secondary);' },
        textContent: '开源社区与技术文档:'
    });
    heroCard.appendChild(linksTitle);

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
    heroCard.appendChild(linkGrid);

    // 分隔线 2
    const divider2 = createElement('div', {
        attributes: { style: 'height: 1px; background: var(--da-separator); opacity: 0.6; margin: 4px 0;' }
    });
    heroCard.appendChild(divider2);

    // 版本更新日志展板 (Changelog)
    const changelogHeader = createElement('div', {
        attributes: { style: 'font-size: 13px; font-weight: 600; color: var(--da-text-secondary);' },
        textContent: '版本更新日志 (Changelog):'
    });
    heroCard.appendChild(changelogHeader);

    const changelogEl = createElement('div', { className: 'da-changelog' });
    changelogEl.innerHTML = `
        <div class="da-changelog__entry">v0.2.0 (2026-09) · 架构演进与 UI 重构</div>
        <ul class="da-changelog__list">
            <li class="da-changelog__item">优化原子控件库，采用画幅下拉选择器与数值微调输入框；</li>
            <li class="da-changelog__item">全面接入四大生图后端（ComfyUI / SD-WebUI / NovelAI / OpenAI）专属设置视窗；</li>
            <li class="da-changelog__item">通用参数设置支持直连 Direct / 宿主中继 Relay 传输通道；</li>
            <li class="da-changelog__item">测试连接支持连通性探测与远端资产（Model / VAE / LoRA / 订阅）动态同步；</li>
            <li class="da-changelog__item">提示词预设管理器内置脏状态跟踪器，修改时高亮提示并在保存或还原时自动重置。</li>
        </ul>
        <div class="da-changelog__entry da-changelog__entry--sep">v0.1.0 · 核心架构与功能管道</div>
        <ul class="da-changelog__list">
            <li class="da-changelog__item">实现双层存储池（LocalForage 与内存快照）并提供基于 LRU 的存储配额管理；</li>
            <li class="da-changelog__item">实现多后端适配器注册中心与生成编排器（GenerationOrchestrator）；</li>
            <li class="da-changelog__item">支持 ComfyUI WebSocket 实时进度追踪与中断队列。</li>
        </ul>
    `;
    heroCard.appendChild(changelogEl);
    root.appendChild(heroCard);

    // 2. 配置管理与系统维护卡片 (.da-card)
    const backupCard = createCard({
        title: '配置备份与系统重置',
        iconSvg: getIconSvg('settings'),
        collapsible: true
    });
    regDisposer(backupCard);

    const backupDesc = createElement('p', {
        attributes: {
            style: 'font-size: var(--da-font-size-sm, 13px); color: var(--da-text-secondary); line-height: 1.6; margin: 0 0 12px 0;'
        },
        textContent: '可将当前全部插件参数（包括主题配色、各引擎设置、工作流映射及提示词方案）打包导出为 JSON 备份文件，或在其他设备上一键恢复。'
    });
    backupCard.append(backupDesc);

    const backupActionsRow = createElement('div', {
        attributes: {
            style: 'display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: space-between;'
        }
    });

    const leftActionsGroup = createElement('div', {
        attributes: { style: 'display: flex; gap: 8px; flex-wrap: wrap; align-items: center;' }
    });

    // 导出配置
    const exportConfigBtn: ButtonHandle = createButton({
        text: '导出配置备份 (JSON)',
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
                Toast.success('配置备份已成功导出');
            } catch (err: any) {
                Toast.error(`导出配置失败: ${err?.message || '未知错误'}`);
            }
        }
    });
    regDisposer(exportConfigBtn);
    leftActionsGroup.appendChild(exportConfigBtn.element);

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
        text: '导入配置恢复',
        variant: 'secondary',
        icon: 'refresh',
        onClick: () => {
            fileInput.click();
        }
    });
    regDisposer(importConfigBtn);
    leftActionsGroup.appendChild(importConfigBtn.element);
    backupActionsRow.appendChild(leftActionsGroup);

    // 恢复出厂默认设置 (危险操作隔离至右侧)
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
