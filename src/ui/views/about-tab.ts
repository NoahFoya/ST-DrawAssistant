/**
 * 关于与使用帮助面板视图 (AboutTabView)
 * 静态导入插件元数据、更新履历与生态链接，提供配置备份恢复与出厂重置
 */

import { CoreEventMap } from '../../types';
import { TypedEventBus } from '../../utils';
import { SettingsStore, PresetStore } from '../../state';
import { EXTENSION_VERSION } from '../../constants';
import { createCard, createCardHeader } from '../layout/container-factory';
import { createVersionBadge } from '../components';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation';
import aboutConfigData from '../../../config/about.json';
import changelogListData from '../../../config/changelog.json';

export interface CommunityLinkItem {
    icon: string;
    title: string;
    subtitle: string;
    href: string;
    themeClass?: string;
}

export interface AboutConfig {
    name: string;
    version: string;
    description: string;
    license: string;
    highlights: string[];
    author: string;
    copyright: string;
    communityLinks: CommunityLinkItem[];
}

export interface ChangelogItem {
    version: string;
    date: string;
    title: string;
    items: string[];
}

export class AboutTabView extends BaseTabView {
    private readonly _aboutData: AboutConfig = aboutConfigData as AboutConfig;
    private readonly _changelogData: ChangelogItem[] = changelogListData as ChangelogItem[];

    private _heroCardEl!: HTMLElement;
    private _changelogBoxEl!: HTMLElement;
    private _communityGridEl!: HTMLElement;

    constructor(
        private readonly _store: SettingsStore,
        private readonly _events?: TypedEventBus<CoreEventMap>
    ) {
        super('da-about-tab');
        this._buildCards();
    }

    private _buildCards(): void {
        this._buildHeroCard();
        this._buildChangelogCard();
        this._buildCommunityCard();
        this._buildBackupCard();
    }

    /** 插件概览与协议卡片 */
    private _buildHeroCard(): void {
        this._heroCardEl = document.createElement('div');
        this._heroCardEl.className = 'da-about-card-hero';
        this._renderHeroContent();
        this._root.appendChild(this._heroCardEl);
    }

    private _renderHeroContent(): void {
        this._heroCardEl.innerHTML = '';

        // 头部行：标题 + 版本徽标 + 协议徽标
        const headerRow = document.createElement('div');
        headerRow.className = 'da-about-hero-header';

        const title = document.createElement('h2');
        title.className = 'da-about-title';
        title.textContent = this._aboutData.name || 'Starlight DrawAssistant';

        const versionBadge = document.createElement('span');
        versionBadge.className = 'da-version-badge';
        versionBadge.textContent = `v${this._aboutData.version || EXTENSION_VERSION}`;

        const licenseBadge = document.createElement('span');
        licenseBadge.className = 'da-version-badge da-license-badge';
        licenseBadge.textContent = this._aboutData.license || 'GPL-3.0';

        headerRow.appendChild(title);
        headerRow.appendChild(versionBadge);
        headerRow.appendChild(licenseBadge);
        this._heroCardEl.appendChild(headerRow);

        // 详细功能说明
        const desc = document.createElement('p');
        desc.className = 'da-about-desc';
        desc.textContent = this._aboutData.description;
        this._heroCardEl.appendChild(desc);

        // 特性亮点芯片
        if (this._aboutData.highlights && this._aboutData.highlights.length > 0) {
            const highlightsBox = document.createElement('div');
            highlightsBox.className = 'da-about-highlights';
            this._aboutData.highlights.forEach((h) => {
                const chip = document.createElement('span');
                chip.className = 'da-about-highlight-chip';
                chip.textContent = h;
                highlightsBox.appendChild(chip);
            });
            this._heroCardEl.appendChild(highlightsBox);
        }

        // 底部作者与版权
        const footer = document.createElement('div');
        footer.className = 'da-about-footer';

        const author = document.createElement('div');
        author.className = 'da-about-author';
        author.textContent = `作者：${this._aboutData.author}`;

        const copyright = document.createElement('div');
        copyright.className = 'da-about-copyright';
        copyright.textContent = this._aboutData.copyright;

        footer.appendChild(author);
        footer.appendChild(copyright);
        this._heroCardEl.appendChild(footer);
    }

    /** 2. 版本与更新履历卡片 */
    private _buildChangelogCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '版本与更新履历',
            description: '查阅当前运行版本与各阶段功能演进记录'
        });
        card.header.appendChild(header);

        // 版本条带
        const strip = document.createElement('div');
        strip.className = 'da-about-version-strip';

        const leftGroup = document.createElement('div');
        leftGroup.className = 'da-about-strip-left';
        const versionBadge = createVersionBadge({
            version: `v${EXTENSION_VERSION}`
        });
        this._disposables.add(versionBadge);
        leftGroup.appendChild(versionBadge);

        const rightGroup = document.createElement('div');
        rightGroup.className = 'da-about-strip-right';
        const statusText = document.createElement('span');
        statusText.style.fontSize = '12px';
        statusText.style.color = 'var(--da-text-secondary)';
        statusText.textContent = `当前运行版本: v${this._aboutData?.version || EXTENSION_VERSION} 正式版`;
        rightGroup.appendChild(statusText);

        strip.appendChild(leftGroup);
        strip.appendChild(rightGroup);
        card.body.appendChild(strip);

        // 更新日志明细框
        this._changelogBoxEl = document.createElement('div');
        this._changelogBoxEl.className = 'da-changelog-box';
        this._renderChangelogItems();
        card.body.appendChild(this._changelogBoxEl);

        this._root.appendChild(card.root);
    }

    private _renderChangelogItems(): void {
        if (!this._changelogBoxEl) return;
        this._changelogBoxEl.innerHTML = '';

        if (!this._changelogData) {
            this._changelogBoxEl.innerHTML = '<div class="da-about-status-hint">正在加载更新履历...</div>';
            return;
        }

        if (this._changelogData.length === 0) {
            this._changelogBoxEl.innerHTML = '<div class="da-about-status-hint">暂未获取到更新履历</div>';
            return;
        }

        const fragment = document.createDocumentFragment();
        this._changelogData.forEach((entry, idx) => {
            const entryTitle = document.createElement('div');
            entryTitle.className = `da-about-cl-entry ${idx > 0 ? 'da-about-cl-entry--sep' : ''}`;
            entryTitle.textContent = entry.title || `v${entry.version} (${entry.date})`;

            const list = document.createElement('ul');
            list.className = 'da-about-cl-list';

            (entry.items || []).forEach((itemText) => {
                const li = document.createElement('li');
                li.className = 'da-about-cl-item';
                li.textContent = itemText;
                list.appendChild(li);
            });

            fragment.appendChild(entryTitle);
            fragment.appendChild(list);
        });

        this._changelogBoxEl.appendChild(fragment);
    }

    /** 3. 社区与生态链接卡片 (富链接网格) */
    private _buildCommunityCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '开源社区与生态',
            description: '查看官方开源仓库、使用协议与相关生态链接'
        });
        card.header.appendChild(header);

        this._communityGridEl = document.createElement('div');
        this._communityGridEl.className = 'da-about-card-grid';
        this._renderCommunityLinks();
        card.body.appendChild(this._communityGridEl);

        this._root.appendChild(card.root);
    }

    private _renderCommunityLinks(): void {
        if (!this._communityGridEl) return;
        this._communityGridEl.innerHTML = '';

        if (!this._aboutData) {
            this._communityGridEl.innerHTML = '<div class="da-about-empty-grid">正在读取社区生态配置...</div>';
            return;
        }

        const links = this._aboutData.communityLinks || [];
        if (links.length === 0) {
            this._communityGridEl.innerHTML = '<div class="da-about-empty-grid">暂无生态链接数据</div>';
            return;
        }

        const fragment = document.createDocumentFragment();
        links.forEach((linkItem) => {
            const a = document.createElement('a');
            a.className = `da-about-rich-card ${linkItem.themeClass || ''}`.trim();
            a.href = linkItem.href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';

            const iconBox = document.createElement('div');
            iconBox.className = 'da-about-rich-card-icon-box';
            const iconSpan = document.createElement('span');
            iconSpan.className = 'da-about-rich-card-icon';
            iconSpan.textContent = linkItem.icon;
            iconBox.appendChild(iconSpan);

            const contentBox = document.createElement('div');
            contentBox.className = 'da-about-rich-card-content';

            const cardTitle = document.createElement('div');
            cardTitle.className = 'da-about-rich-card-title';
            cardTitle.textContent = linkItem.title;

            const cardSub = document.createElement('div');
            cardSub.className = 'da-about-rich-card-sub';
            cardSub.textContent = linkItem.subtitle;

            contentBox.appendChild(cardTitle);
            contentBox.appendChild(cardSub);

            a.appendChild(iconBox);
            a.appendChild(contentBox);
            fragment.appendChild(a);
        });

        this._communityGridEl.appendChild(fragment);
    }

    /** 4. 配置备份与恢复卡片 (自解释界面) */
    private _buildBackupCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '配置备份与恢复',
            description: '导出或导入插件全量配置归档（含生图主配置、网络凭据与所有本地预设方案），支持跨设备迁移或出厂重置'
        });
        card.header.appendChild(header);

        const btnRow = document.createElement('div');
        btnRow.className = 'da-about-btn-row';

        // 导出完整配置 (双模选择)
        const exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.className = 'da-btn da-btn--primary da-btn--sm';
        exportBtn.textContent = '导出完整配置';
        exportBtn.onclick = async () => {
            const mode = await FeedbackService.showExportModeDialog();
            if (!mode) return;

            const isSanitized = mode === 'sanitized';
            try {
                FeedbackService.toastInfo('正在打包全量预设方案与配置数据...');
                const presetsArchive = await PresetStore.exportArchive();
                const archiveData = this._store.buildArchive(presetsArchive, isSanitized);
                const jsonStr = JSON.stringify(archiveData, null, 2);

                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const dateStr = new Date().toISOString().slice(0, 10);
                const tag = isSanitized ? 'sanitized' : 'private';
                a.download = `st-drawassistant-backup-${dateStr}-${tag}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);

                if (isSanitized) {
                    FeedbackService.toastSuccess('全量脱敏配置归档已导出并开始下载');
                } else {
                    FeedbackService.toastSuccess('包含私有密钥的完整备份已导出，请妥善保管勿公开分享');
                }
            } catch (err: any) {
                FeedbackService.toastError(`导出配置失败: ${err?.message || err}`);
            }
        };

        // 导入配置 (严格校验)
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';

        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                let parsed: unknown;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    FeedbackService.toastError('配置文件解析失败：非合法的 JSON 文本');
                    return;
                }

                // 严格格式校验，不作历史妥协
                const validation = this._store.validateArchive(parsed);
                if (!validation.valid || !validation.data) {
                    FeedbackService.toastError(validation.error || '无效的 ST-DrawAssistant 全量归档文件');
                    return;
                }

                const archive = validation.data;
                const themeCount = archive.presets?.themes?.length || 0;
                const promptCount = archive.presets?.prompts?.length || 0;
                const workflowCount = archive.presets?.workflows?.length || 0;
                let drawingCount = 0;
                if (archive.presets?.drawing) {
                    for (const list of Object.values(archive.presets.drawing)) {
                        if (Array.isArray(list)) drawingCount += list.length;
                    }
                }

                const confirmed = await FeedbackService.confirm({
                    title: '导入全量配置确认',
                    message: `检测到合法的全量归档包（导出于 ${archive.exportTime.slice(0, 10)}，${archive.sanitized ? '已脱敏' : '包含私密密钥'}）。\n内含方案：${themeCount} 个主题、${promptCount} 个提示词、${workflowCount} 个工作流、${drawingCount} 个出图方案。\n导入将覆盖当前所有插件配置与本地预设方案，是否继续？`,
                    confirmText: '确认覆盖导入',
                    isDangerous: true
                });

                if (!confirmed) return;

                FeedbackService.toastInfo('正在写入预设方案与配置...');

                // 1. 批量持久化至本地存储
                const importRes = await PresetStore.importArchive(archive.presets);
                if (!importRes.success) {
                    FeedbackService.toastError(`预设导入失败: ${importRes.error || '未知错误'}`);
                    return;
                }

                // 2. 加载主配置并固化持久化
                await this._store.loadSettings(archive.settings);
                this._store.commit();

                // 3. 广播刷新事件驱动界面与下拉方案更新
                this._events?.emit('presets:imported', { importedCount: importRes.importedCount });

                FeedbackService.toastSuccess(`配置导入成功！已同步更新 ${importRes.importedCount} 个预设方案`);
            } catch (err: any) {
                FeedbackService.toastError(`导入失败: ${err?.message || err}`);
            } finally {
                fileInput.value = '';
            }
        };

        const importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        importBtn.textContent = '导入配置文件';
        importBtn.onclick = () => fileInput.click();

        // 恢复出厂默认设置 (清空并以出厂模板重新载入)
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'da-btn da-btn--danger da-btn--sm da-about-btn-reset';
        resetBtn.textContent = '恢复出厂默认设置';
        resetBtn.onclick = async () => {
            const confirmed = await FeedbackService.confirm({
                title: '恢复出厂默认设置确认',
                message: '此操作将清空本地所有自定义预设方案与网络配置文件，并以出厂默认模板重新载入初始化（不会删除本地历史图片）。所有生图参数与主题将还原为初始状态，是否继续？',
                confirmText: '确认清空并重置',
                isDangerous: true
            });
            if (confirmed) {
                FeedbackService.toastInfo('正在清空并恢复出厂预设...');
                const resetRes = await PresetStore.resetDefaults();
                if (!resetRes.success) {
                    FeedbackService.toastError(`重置失败: ${resetRes.error || '未知错误'}`);
                    return;
                }

                // 重置前端主配置为出厂默认值（保留已由 resetDefaults 重新从磁盘载入的预设模板）
                const { DEFAULT_SETTINGS } = await import('../../state/settings-store');
                const resetBase = { ...DEFAULT_SETTINGS };
                delete (resetBase as any).presets;
                this._store.update(resetBase);
                this._store.commit();

                // 广播重置事件通知所有 Tab 重新加载出厂方案
                this._events?.emit('presets:reset', undefined);

                FeedbackService.toastSuccess('已成功清空并以出厂模板重新载入所有默认配置');
            }
        };

        btnRow.appendChild(exportBtn);
        btnRow.appendChild(importBtn);
        btnRow.appendChild(fileInput);
        btnRow.appendChild(resetBtn);

        card.body.appendChild(btnRow);
        this._root.appendChild(card.root);
    }
}

