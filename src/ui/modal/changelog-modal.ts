/**
 * 版本更新说明独立模态弹窗 (ChangelogModal)。
 *
 * @remarks
 * 负责呈现各版本更新日志与变更明细：
 * 1. 结构化呈现版本更新记录（版本号、发布日期、特性摘要与变更明细）；
 * 2. 接入 OverlayStack 集中层级管理，支持 Esc 键与遮罩点击退出；
 * 3. 具备完善的 DOM 释放与事件解绑保障。
 */

import type { Disposable } from '../types';
import type { ChangelogItem } from '@types';
import { bindBackdropDismiss, overlayStack } from '../framework/overlay-stack';
import { renderIcon } from '../components/icons';
import { updateService } from '../../pipeline/update-service';
import { logger } from '../../util/logger';

export interface ChangelogModalOptions {
    /** 自定义传入的更新日志列表，未提供时由 UpdateService 自动读取 */
    readonly items?: ChangelogItem[];
    /** 关闭回调 */
    readonly onClose?: () => void;
    /** 点击「前往预设管理」跳转回调 */
    readonly onNavigateToPresetManager?: () => void;
}

export class ChangelogModal implements Disposable {
    private static activeInstance: ChangelogModal | null = null;
    private isDisposed = false;
    private backdropEl?: HTMLElement;
    private readonly disposers: (() => void)[] = [];

    public constructor(options: ChangelogModalOptions = {}) {
        if (ChangelogModal.activeInstance) {
            ChangelogModal.activeInstance.dispose();
        }
        ChangelogModal.activeInstance = this;
        this.renderDom(options);
    }

    private renderDom(options: ChangelogModalOptions): void {
        if (typeof document === 'undefined') {
            return;
        }

        // 1. 弹窗遮罩外壳（复用 .da-modal-backdrop 与 .da-submodal-backdrop 统一样式）
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop da-submodal-backdrop da-changelog-backdrop st-da-root';
        this.backdropEl = backdrop;

        // 2. 居中面板容器
        const panel = document.createElement('div');
        panel.className = 'da-modal-shell da-submodal-panel da-changelog-modal-panel';
        backdrop.appendChild(panel);

        // 3. 头部顶栏
        const header = document.createElement('div');
        header.className = 'da-submodal-header da-changelog-header';

        const titleGroup = document.createElement('div');
        titleGroup.className = 'da-submodal-title-group da-changelog-title-group';

        const title = document.createElement('h3');
        title.className = 'da-submodal-title da-changelog-title';
        title.textContent = '版本更新说明';
        titleGroup.appendChild(title);

        const subtitle = document.createElement('div');
        subtitle.className = 'da-submodal-subtitle da-changelog-subtitle';
        subtitle.textContent = '查看 ST-DrawAssistant 版本更新与变更记录';
        titleGroup.appendChild(subtitle);
        header.appendChild(titleGroup);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-btn da-btn--ghost da-submodal-close';
        closeBtn.innerHTML = renderIcon('close', 16);
        closeBtn.title = '关闭 (Esc)';
        closeBtn.setAttribute('aria-label', '关闭弹窗');
        closeBtn.onclick = () => this.handleClose(options.onClose);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // 4. 内容区域（版本日志列表）
        const content = document.createElement('div');
        content.className = 'da-submodal-body da-changelog-content';
        panel.appendChild(content);

        const versionsContainer = document.createElement('div');
        versionsContainer.className = 'da-changelog-versions';
        content.appendChild(versionsContainer);

        // 5. 底栏操作动作
        const footer = document.createElement('div');
        footer.className = 'da-submodal-footer da-changelog-footer';

        if (options.onNavigateToPresetManager) {
            const gotoBtn = document.createElement('button');
            gotoBtn.type = 'button';
            gotoBtn.className = 'da-btn da-btn--secondary da-btn--sm da-changelog-goto-presets-btn';
            gotoBtn.textContent = '前往预设管理';
            gotoBtn.onclick = () => {
                const navigate = options.onNavigateToPresetManager;
                this.handleClose(options.onClose);
                navigate?.();
            };
            footer.appendChild(gotoBtn);
        }

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'da-btn da-btn--primary da-btn--sm';
        okBtn.textContent = '知道了';
        okBtn.onclick = () => this.handleClose(options.onClose);
        footer.appendChild(okBtn);
        panel.appendChild(footer);

        document.body.appendChild(backdrop);

        // 6. 注册层级管理与 Esc 监听
        overlayStack.push(
            'changelog-modal',
            () => this.handleClose(options.onClose),
            () => this.dispose()
        );

        this.disposers.push(
            bindBackdropDismiss(backdrop, () => this.handleClose(options.onClose))
        );

        // 7. 加载并渲染日志条目
        this.renderItems(versionsContainer, options.items);
    }

    private renderItems(container: HTMLElement, customItems?: ChangelogItem[]): void {
        let items = customItems;
        if (!items) {
            try {
                items = updateService.getChangelog();
            } catch (err) {
                logger.error('[ChangelogModal] 读取更新日志异常:', err);
                items = [];
            }
        }

        if (this.isDisposed || !container.parentNode) {
            return;
        }

        container.innerHTML = '';

        if (!items || items.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'da-changelog-empty';
            emptyEl.textContent = '暂无更新日志记录';
            container.appendChild(emptyEl);
            return;
        }

        for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            const card = document.createElement('div');
            card.className = 'da-changelog-version-card';

            const cardHeader = document.createElement('div');
            cardHeader.className = 'da-changelog-version-header';

            const tagRow = document.createElement('div');
            tagRow.className = 'da-changelog-tag-row';

            const badge = document.createElement('span');
            badge.className = 'da-changelog-badge';
            badge.textContent = `v${item.version}`;
            tagRow.appendChild(badge);

            const dateSpan = document.createElement('span');
            dateSpan.className = 'da-changelog-date';
            dateSpan.textContent = item.date;
            tagRow.appendChild(dateSpan);
            cardHeader.appendChild(tagRow);

            if (item.title) {
                const titleEl = document.createElement('div');
                titleEl.className = 'da-changelog-version-title';
                titleEl.textContent = item.title;
                cardHeader.appendChild(titleEl);
            }
            card.appendChild(cardHeader);

            const detailItems = Array.isArray(item.items) ? item.items : [];
            const summaryText =
                typeof item.summary === 'string' && item.summary.trim()
                    ? item.summary.trim()
                    : detailItems[0] || '';
            if (summaryText) {
                const summaryEl = document.createElement('p');
                summaryEl.className = 'da-changelog-summary';
                summaryEl.textContent = summaryText;
                card.appendChild(summaryEl);
            }

            if (detailItems.length > 0) {
                const detailsId = `da-changelog-details-${idx}`;
                const collapsedText = `...+${detailItems.length}`;
                const expandHint = `展开全部 ${detailItems.length} 项更新`;
                const collapseHint = '收起更新细节';

                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'da-changelog-details-toggle';
                toggleBtn.setAttribute('aria-expanded', 'false');
                toggleBtn.setAttribute('aria-controls', detailsId);
                toggleBtn.setAttribute('aria-label', expandHint);
                toggleBtn.title = expandHint;
                toggleBtn.textContent = collapsedText;

                const detailsPanel = document.createElement('div');
                detailsPanel.id = detailsId;
                detailsPanel.className = 'da-changelog-details-panel';
                detailsPanel.hidden = true;

                const ul = document.createElement('ul');
                ul.className = 'da-changelog-items-list';

                for (const text of detailItems) {
                    const li = document.createElement('li');
                    li.className = 'da-changelog-item';
                    li.textContent = text;
                    ul.appendChild(li);
                }
                detailsPanel.appendChild(ul);

                toggleBtn.onclick = () => {
                    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
                    const nextExpanded = !isExpanded;
                    toggleBtn.setAttribute('aria-expanded', String(nextExpanded));
                    card.classList.toggle('is-expanded', nextExpanded);
                    detailsPanel.hidden = !nextExpanded;
                    toggleBtn.textContent = nextExpanded ? '收起' : collapsedText;
                    const nextHint = nextExpanded ? collapseHint : expandHint;
                    toggleBtn.setAttribute('aria-label', nextHint);
                    toggleBtn.title = nextHint;
                };

                card.appendChild(toggleBtn);
                card.appendChild(detailsPanel);
            }

            container.appendChild(card);
        }
    }

    private handleClose(onClose?: () => void): void {
        updateService.markChangelogAsSeen();
        onClose?.();
        this.dispose();
    }

    public dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;

        overlayStack.remove('changelog-modal');
        if (ChangelogModal.activeInstance === this) {
            ChangelogModal.activeInstance = null;
        }

        for (const disposer of this.disposers) {
            try {
                disposer();
            } catch {
                // 忽略注销异常
            }
        }
        this.disposers.length = 0;

        if (this.backdropEl && this.backdropEl.parentNode) {
            this.backdropEl.parentNode.removeChild(this.backdropEl);
        }
        this.backdropEl = undefined;
    }
}

/**
 * 快捷打开版本更新说明模态弹窗。
 *
 * @param options 配置选项
 * @returns 资源释放句柄
 */
export function openChangelogModal(options: ChangelogModalOptions = {}): Disposable {
    return new ChangelogModal(options);
}
