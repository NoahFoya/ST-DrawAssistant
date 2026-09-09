/**
 * 版本徽标组件 (VersionBadge)
 * 展示当前版本号，点击可跳转至关于面板
 */

import { IDisposable } from '../../types';
import { EXTENSION_VERSION } from '../../constants';

export interface VersionBadgeOptions {
    version?: string;
    onClick?: () => void;
    showUpdateTag?: boolean;
}

export interface VersionBadgeHandle extends HTMLElement, IDisposable {
    setUpdateTag: (show: boolean) => void;
}

export function createVersionBadge(options: VersionBadgeOptions = {}): VersionBadgeHandle {
    const versionStr = options.version || `v${EXTENSION_VERSION}`;
    const el = document.createElement('div');
    el.className = 'da-version-badge';
    el.title = `ST-DrawAssistant ${versionStr}`;

    const textSpan = document.createElement('span');
    textSpan.className = 'da-version-text';
    textSpan.textContent = versionStr;
    el.appendChild(textSpan);

    const dotSpan = document.createElement('span');
    dotSpan.className = 'da-version-update-indicator';
    dotSpan.style.display = options.showUpdateTag ? 'inline-block' : 'none';
    el.appendChild(dotSpan);

    if (options.onClick) {
        el.style.cursor = 'pointer';
        el.onclick = options.onClick;
    }

    return Object.assign(el, {
        setUpdateTag: (show: boolean) => {
            dotSpan.style.display = show ? 'inline-block' : 'none';
        },
        dispose: () => {
            el.remove();
        }
    });
}
