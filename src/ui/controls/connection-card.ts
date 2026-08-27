/**
 * @module ui/controls/connection-card
 * @description 后端连接测试与地址配置卡片 (ConnectionCard)
 * 复合组件：由通用卡片容器 (createCard)、卡片头部 (createCardHeader) 与输入框、测试按钮组合构建。
 */

import { createCard, createCardHeader, createRow } from '../layout/container-factory';

/**
 * 后端连接配置卡片配置项
 */
export interface ConnectionCardOptions {
    /** 卡片标题 */
    title: string;
    /** 卡片描述说明 */
    description: string;
    /** 绑定的目标地址 */
    url?: string;
    /** 当前生效地址 */
    currentUrl?: string;
    /** 默认回退地址 */
    defaultUrl?: string;
    /** 输入框占位文本 */
    placeholder?: string;
    /** URL 变更回调 */
    onUrlChange: (newUrl: string) => void;
    /** 点击测试连接回调 */
    onTest: (url: string, btn: HTMLButtonElement) => Promise<void>;
}

/**
 * 创建标准后端连接配置卡片
 *
 * @param options 连接卡片配置项
 * @returns 卡片容器 DOM 节点
 */
export function createConnectionCard(options: ConnectionCardOptions): HTMLElement {
    const card = createCard({ hoverable: true });
    const header = createCardHeader({
        title: options.title,
        description: options.description
    });
    card.header.appendChild(header);

    const targetUrl = options.url || options.currentUrl || options.defaultUrl || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'da-input da-w-full';
    input.value = targetUrl;
    input.placeholder = options.placeholder || 'http://127.0.0.1:...';
    input.addEventListener('change', () => options.onUrlChange(input.value.trim()));

    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'da-btn da-btn--secondary';
    testBtn.textContent = '测试连接';
    testBtn.onclick = () => options.onTest(input.value.trim(), testBtn);

    const row = createRow(['fill', 'auto'], {
        align: 'center',
        padded: true,
        gap: '8px'
    });
    row.slots[0].appendChild(input);
    row.slots[1].appendChild(testBtn);

    card.body.appendChild(row.root);
    return card.root;
}
