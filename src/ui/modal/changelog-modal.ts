/**
 * 版本更新说明独立模态弹窗 (ChangelogModal)。
 *
 * @remarks
 * 负责呈现各版本更新日志与演进明细：
 * 1. 结构化呈现版本历史演进（版本号、发布日期、特性摘要与项目明细）；
 * 2. 接入 OverlayStack 集中层级管理，支持 Esc 键与遮罩点击退出；
 * 3. 具备完善的 DOM 释放与事件解绑保障。
 */

import type { Disposable } from '../types';
import type { ChangelogItem } from '@types';
import { overlayStack } from '../framework/overlay-stack';
import { updateService } from '../../pipeline/update-service';
import { logger } from '../../util/logger';

export interface ChangelogModalOptions {
    /** 自定义传入的更新日志列表，未提供时由 UpdateService 自动读取 */
    readonly items?: ChangelogItem[];
    /** 关闭回调 */
    readonly onClose?: () => void;
}

export class ChangelogModal implements Disposable {
    private isDisposed = false;
    private backdropEl?: HTMLElement;
    private readonly disposers: (() => void)[] = [];

    public constructor(options: ChangelogModalOptions = {}) {
        this.renderDom(options);
    }

    private renderDom(options: ChangelogModalOptions): void {
        if (typeof document === 'undefined') {
            return;
        }

        // 1. 全屏遮罩外壳
        const backdrop = document.createElement('div');
        backdrop.className = 'da-changelog-backdrop st-da-root';
        this.backdropEl = backdrop;

        // 2. 居中面板容器
        const panel = document.createElement('div');
        panel.className = 'da-changelog-modal-panel';
        backdrop.appendChild(panel);

        // 3. 头部顶栏
        const header = document.createElement('div');
        header.className = 'da-changelog-header';

        const titleGroup = document.createElement('div');
        titleGroup.className = 'da-changelog-title-group';

        const title = document.createElement('h3');
        title.className = 'da-changelog-title';
        title.textContent = '版本更新说明';
        titleGroup.appendChild(title);

        const subtitle = document.createElement('div');
        subtitle.className = 'da-changelog-subtitle';
        subtitle.textContent = '查看 ST-DrawAssistant 历史版本演进与最新特性记录';
        titleGroup.appendChild(subtitle);
        header.appendChild(titleGroup);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-btn da-btn--ghost da-btn--sm';
        closeBtn.textContent = '✕';
        closeBtn.title = '关闭 (Esc)';
        closeBtn.onclick = () => this.handleClose(options.onClose);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // 4. 内容区域（版本日志列表）
        const content = document.createElement('div');
        content.className = 'da-changelog-content';
        panel.appendChild(content);

        // 5. 底栏操作动作
        const footer = document.createElement('div');
        footer.className = 'da-changelog-footer';

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'da-btn da-btn--primary da-btn--sm';
        okBtn.textContent = '知道了';
        okBtn.onclick = () => this.handleClose(options.onClose);
        footer.appendChild(okBtn);
        panel.appendChild(footer);

        document.body.appendChild(backdrop);

        // 6. 注册层级管理与 Esc 监听
        overlayStack.push('changelog-modal', () => this.handleClose(options.onClose));

        backdrop.onclick = (e) => {
            if (e.target === backdrop) {
                this.handleClose(options.onClose);
            }
        };

        // 7. 加载并渲染日志条目
        this.renderItems(content, options.items);
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

        for (const item of items) {
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

            if (Array.isArray(item.items) && item.items.length > 0) {
                const ul = document.createElement('ul');
                ul.className = 'da-changelog-items-list';

                for (const text of item.items) {
                    const li = document.createElement('li');
                    li.className = 'da-changelog-item';
                    li.textContent = text;
                    ul.appendChild(li);
                }
                card.appendChild(ul);
            }

            container.appendChild(card);
        }
    }

    private handleClose(onClose?: () => void): void {
        onClose?.();
        this.dispose();
    }

    public dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;

        overlayStack.remove('changelog-modal');

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
