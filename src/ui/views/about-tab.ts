/**
 * @module ui/views/about-tab
 * @description 关于与版本信息面板视图 (包含插件版本概览、核心功能特性介绍与致谢信息)
 */

import { VERSION } from '../../core/constants';
import { IDisposable } from '../../core/foundation/disposable';

/**
 * 构建并渲染关于与版本信息面板
 *
 * @returns 包含生命周期清理能力的关于面板 DOM 根节点
 */
export function createAboutTabView(): HTMLElement & IDisposable {
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane';

    const card = document.createElement('div');
    card.className = 'da-section-card';

    const header = document.createElement('div');
    header.className = 'da-section-header';
    header.innerHTML = '<span class="da-section-title">关于 ST-DrawAssistant</span>';
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'da-section-body';

    const info = document.createElement('div');
    info.style.lineHeight = '1.6';
    info.style.color = 'var(--da-text-primary)';
    info.innerHTML = `
        <div style="font-weight:bold; font-size:1.1em; margin-bottom:8px; color:var(--da-accent-color);">ST-DrawAssistant v${VERSION}</div>
        <p>SillyTavern 现代化文生图/图生图/局部重绘扩展插件。</p>
        <p>基于<strong>微内核架构 (Microkernel Architecture)</strong> 与<strong>非侵入式插槽设计</strong>重构，全面支持 ComfyUI WebSocket 与 SD-WebUI REST 驱动，支持角色管理、宏展开与 LRU 容量安全熔断。</p>
    `;
    body.appendChild(info);
    card.appendChild(body);

    container.appendChild(card);
    return container;
}
