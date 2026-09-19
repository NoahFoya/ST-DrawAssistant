/**
 * ST-DrawAssistant 配置卡片基础类型定义。
 *
 * @remarks
 * 声明通用卡片容器的配置选项与操作句柄，包含标题、图标、折叠状态
 * 及子控件生命周期的聚合管理。
 */

import type { BaseComponent } from '../components/types';

/** 卡片创建配置选项 */
export interface CardOptions {
    /** 卡片主标题 */
    title: string;
    /** 卡片标题旁内联 SVG 图标 (可选) */
    iconSvg?: string;
    /** 卡片副标或徽标文本 (可选) */
    badge?: string;
    /** 是否支持折叠与展开 (默认 true) */
    collapsible?: boolean;
    /** 初始是否为折叠状态 (默认 false) */
    collapsed?: boolean;
    /** 自定义根容器 class 类名 */
    className?: string;
    /** 折叠状态切换回调 */
    onFoldToggle?: (collapsed: boolean) => void;
}

/** 卡片组件通用接口 */
export interface CardComponent extends BaseComponent<void> {
    /** 卡片主体容器元素 */
    readonly bodyElement: HTMLElement;
    /** 展开或折叠卡片 */
    setCollapsed(collapsed: boolean): void;
    /** 获取当前折叠状态 */
    isCollapsed(): boolean;
}
