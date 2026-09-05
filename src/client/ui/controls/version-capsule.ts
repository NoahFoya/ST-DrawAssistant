/**
 * @module ui/controls/version-capsule
 * @description 统一版本胶囊组件 (VersionCapsule)
 * 职责：主界面顶栏与关于界面共用，展示当前版本
 */

import { IDisposable, EXTENSION_VERSION } from '../../core';

export interface VersionCapsuleOptions {
    version?: string;
    onClick?: () => void;
    showUpdateTag?: boolean;
}

export function createVersionCapsule(options: VersionCapsuleOptions = {}): HTMLElement & IDisposable {
    const versionStr = options.version || `v${EXTENSION_VERSION}`;
    const el = document.createElement('div');
    el.className = 'da-version-capsule';
    el.title = `ST-DrawAssistant ${versionStr}`;

    const textSpan = document.createElement('span');
    textSpan.className = 'da-version-text';
    textSpan.textContent = versionStr;
    el.appendChild(textSpan);

    const dotSpan = document.createElement('span');
    dotSpan.className = 'da-version-update-indicator';
    dotSpan.style.display = 'none';
    el.appendChild(dotSpan);

    if (options.onClick) {
        el.style.cursor = 'pointer';
        el.onclick = options.onClick;
    }

    return Object.assign(el, {
        dispose: () => {
            el.remove();
        }
    });
}
