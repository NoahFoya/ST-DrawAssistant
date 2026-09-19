/**
 * ST-DrawAssistant 弹窗与导航选项卡基础类型定义。
 *
 * @remarks
 * 声明设置弹窗、Tab 切换管理器及常驻悬浮球的操作句柄与配置接口。
 */

import type { BaseComponent } from '../components/types';

/** 单个选项卡条目定义 */
export interface TabItemConfig {
    /** 选项卡唯一标识符 */
    readonly id: string;
    /** 选项卡显示标题 */
    title: string;
    /** 内联 SVG 图标文本 (可选) */
    iconSvg?: string;
    /** 选项卡对应的主内容组件或元素 */
    component?: BaseComponent | HTMLElement;
    /** 按需延迟渲染函数 (可选) */
    render?: () => BaseComponent | HTMLElement;
}

/** 设置主弹窗操作接口 */
export interface SettingsModalComponent extends BaseComponent<void> {
    /** 打开弹窗并可指定初始激活的选项卡 */
    open(tabId?: string): void;
    /** 关闭弹窗 */
    close(): void;
    /** 获取弹窗当前显隐状态 */
    isOpen(): boolean;
    /** 切换激活的选项卡 */
    setActiveTab(tabId: string): void;
}

/** 悬浮操作球 (FAB) 控件接口 */
export interface FabComponent extends BaseComponent<void> {
    /** 设置未读任务数或警示角标 */
    setBadge(count: number): void;
    /** 设置悬浮球显隐 */
    setVisible(visible: boolean): void;
}
