/**
 * @module ui/controls/version-capsule
 * @description 统一版本胶囊组件 (VersionCapsule)
 * 职责：主界面顶栏与关于界面共用，展示当前版本并根据 UpdateService 动态呈现可更新状态
 */

import { VERSION, IDisposable } from '../../core';
import { UpdateService, UpdateState } from '../../domain';

export interface VersionCapsuleOptions {
    onClick?: () => void;
    showUpdateTag?: boolean;
}

export function createVersionCapsule(options: VersionCapsuleOptions = {}): HTMLElement & IDisposable {
    const el = document.createElement('div');
    el.className = 'da-version-capsule';
    el.title = `ST-DrawAssistant V${VERSION}`;

    const textSpan = document.createElement('span');
    textSpan.className = 'da-version-text';
    textSpan.textContent = `V${VERSION}`;
    el.appendChild(textSpan);

    const dotSpan = document.createElement('span');
    dotSpan.className = 'da-version-update-indicator';
    dotSpan.style.display = 'none';
    el.appendChild(dotSpan);

    let tagSpan: HTMLElement | null = null;
    if (options.showUpdateTag !== false) {
        tagSpan = document.createElement('span');
        tagSpan.className = 'da-version-update-tag';
        tagSpan.textContent = '可更新';
        tagSpan.style.display = 'none';
        el.appendChild(tagSpan);
    }

    if (options.onClick) {
        el.style.cursor = 'pointer';
        el.onclick = options.onClick;
    }

    // 订阅 UpdateService 状态变化
    const unsubscribe = UpdateService.getInstance().subscribe((state: Readonly<UpdateState>) => {
        textSpan.textContent = state.fullVersion || `V${state.version || VERSION}`;

        if (state.isUpdating) {
            el.classList.add('da-version-capsule--updating');
            el.classList.remove('da-version-capsule--has-update');
            dotSpan.style.display = 'inline-block';
            if (tagSpan) {
                tagSpan.textContent = '更新中';
                tagSpan.style.display = 'inline-block';
            }
            el.title = '正在同步最新提交...';
        } else if (state.isChecking) {
            el.classList.add('da-version-capsule--checking');
            el.classList.remove('da-version-capsule--has-update', 'da-version-capsule--updating');
            dotSpan.style.display = 'none';
            if (tagSpan) tagSpan.style.display = 'none';
            el.title = '正在检测远程仓库最新提交...';
        } else if (state.hasUpdate) {
            el.classList.remove('da-version-capsule--checking', 'da-version-capsule--updating');
            el.classList.add('da-version-capsule--has-update');
            dotSpan.style.display = 'inline-block';
            if (tagSpan) {
                tagSpan.textContent = '可更新';
                tagSpan.style.display = 'inline-block';
            }
            const shaInfo = state.remoteCommitSha ? ` (SHA: ${state.remoteCommitSha})` : '';
            el.title = `发现可用新提交${shaInfo}: ${state.remoteCommitMessage || '点击查看详情'}`;
        } else {
            el.classList.remove('da-version-capsule--checking', 'da-version-capsule--has-update', 'da-version-capsule--updating');
            dotSpan.style.display = 'none';
            if (tagSpan) tagSpan.style.display = 'none';
            const shaInfo = state.currentCommitSha ? ` [${state.currentCommitSha}]` : '';
            el.title = `ST-DrawAssistant ${state.fullVersion || ('V' + (state.version || VERSION))}${shaInfo}`;
        }
    });

    return Object.assign(el, { dispose: unsubscribe });
}
