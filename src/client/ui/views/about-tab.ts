/**
 * @module ui/views/about-tab
 * @description 关于与使用帮助面板视图 (AboutTabView)
 */

import { ConfigStore, EXTENSION_NAME, EXTENSION_VERSION } from '../../core';
import { createCard, createCardHeader } from '../layout/container-factory';
import { createVersionCapsule } from '../controls/version-capsule';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';

export class AboutTabView extends BaseTabView {
    constructor(private readonly _store: ConfigStore) {
        super('da-about-tab');
        this._buildCards();
    }

    private _buildCards(): void {
        this._buildHeroCard();
        this._buildBackupCard();
        this._buildLinksCard();
    }

    private _buildHeroCard(): void {
        const card = document.createElement('div');
        card.className = 'da-card da-about-hero-card';
        card.style.textAlign = 'center';
        card.style.padding = '24px 16px';

        const title = document.createElement('h2');
        title.textContent = `✨ ${EXTENSION_NAME}`;
        title.style.margin = '0 0 12px 0';
        title.style.color = 'var(--da-primary)';

        const desc = document.createElement('p');
        desc.textContent = '轻量、可靠且优雅的 SillyTavern 桌面生图助手插件。支持多后端驱动、实时任务生命周期与安全本地持久化。';
        desc.style.color = 'var(--da-text-muted)';
        desc.style.maxWidth = '600px';
        desc.style.margin = '0 auto 16px auto';
        desc.style.fontSize = '14px';
        desc.style.lineHeight = '1.6';

        const capsule = createVersionCapsule({
            version: `v${EXTENSION_VERSION}`
        });

        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(capsule);
        this._root.appendChild(card);
    }

    private _buildBackupCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '配置备份与恢复',
            description: '导出或导入插件完整配置 JSON，支持跨设备同步'
        });
        card.header.appendChild(header);

        const actionsWrapper = document.createElement('div');
        actionsWrapper.style.display = 'flex';
        actionsWrapper.style.flexWrap = 'wrap';
        actionsWrapper.style.gap = '12px';

        // 导出配置
        const exportBtn = document.createElement('button');
        exportBtn.className = 'da-btn da-btn--primary';
        exportBtn.textContent = '导出完整配置 (JSON)';
        exportBtn.onclick = () => {
            const jsonStr = this._store.exportJson();
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `st-drawassistant-config-v${EXTENSION_VERSION}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            FeedbackService.toastSuccess('配置导出成功');
        };

        // 导入配置
        const importBtn = document.createElement('button');
        importBtn.className = 'da-btn da-btn--secondary';
        importBtn.textContent = '导入配置 (JSON)';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';

        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const ok = this._store.importJson(text);
                if (ok) {
                    FeedbackService.toastSuccess('配置导入成功并已应用！');
                } else {
                    FeedbackService.toastError('配置文件格式不正确，导入失败');
                }
            } catch (err: any) {
                FeedbackService.toastError(`读取文件失败: ${err?.message || err}`);
            } finally {
                fileInput.value = '';
            }
        };

        importBtn.onclick = () => {
            fileInput.click();
        };

        // 恢复默认
        const resetBtn = document.createElement('button');
        resetBtn.className = 'da-btn da-btn--danger';
        resetBtn.textContent = '恢复出厂默认设置';
        resetBtn.onclick = async () => {
            const confirmed = await FeedbackService.confirm({
                title: '恢复默认设置确认',
                message: '此操作将重置所有插件选项（包括生图参数与自定义主题），是否继续？'
            });
            if (confirmed) {
                const { DEFAULT_SETTINGS } = await import('../../core/config/config-store');
                this._store.update(DEFAULT_SETTINGS);
                FeedbackService.toastSuccess('已恢复为默认配置');
            }
        };

        actionsWrapper.appendChild(exportBtn);
        actionsWrapper.appendChild(importBtn);
        actionsWrapper.appendChild(fileInput);
        actionsWrapper.appendChild(resetBtn);

        card.body.appendChild(actionsWrapper);
        this._root.appendChild(card.root);
    }

    private _buildLinksCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '开源社区与支持',
            description: '查看项目文档、提交 Issue 或参与功能共建'
        });
        card.header.appendChild(header);

        const linksList = document.createElement('div');
        linksList.style.display = 'flex';
        linksList.style.gap = '16px';
        linksList.style.flexWrap = 'wrap';

        const createLink = (name: string, url: string) => {
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'da-btn da-btn--secondary da-btn--sm';
            a.textContent = name;
            return a;
        };

        linksList.appendChild(createLink('GitHub 开源仓库', 'https://github.com/NoahFoya/ST-DrawAssistant'));
        linksList.appendChild(createLink('问题反馈 (Issues)', 'https://github.com/NoahFoya/ST-DrawAssistant/issues'));

        card.body.appendChild(linksList);
        this._root.appendChild(card.root);
    }
}
