/**
 * 设置模态弹窗选项卡视图集中装配中枢 (Milestone 3)。
 *
 * @remarks
 * 负责统一为 SettingsModal 视窗骨架注册各功能选项卡的工厂函数，
 * 解耦容器外壳与具体视图实现，保持单向依赖清晰。
 */

import type { SettingsModal } from '../modal/settings-modal';
import { GeneralTabView } from './general-tab';
import { ComfyUITabView } from './comfyui-tab';
import { SDWebUITabView } from './sdwebui-tab';
import { NovelAITabView } from './novelai-tab';
import { OpenAITabView } from './openai-tab';
import { LogsStatsTabView } from './logs-stats-tab';
import { AboutTabView } from './about-tab';
import { ThemeTabView } from './theme-tab';
import { FabTabView } from './fab-tab';

/**
 * 为主设置模态外壳集中注册所有已就绪的选项卡视图工厂。
 *
 * @param modal 主设置模态外壳实例
 */
export function registerDefaultViews(modal: SettingsModal): void {
    // 1. 常规设置选项卡
    modal.registerViewFactory('general', () => new GeneralTabView());

    // 2. ComfyUI 专属绘图服务设置选项卡
    modal.registerViewFactory('comfyui', () => new ComfyUITabView());

    // 3. SD-WebUI / Forge 专属绘图服务设置选项卡
    modal.registerViewFactory('sdwebui', () => new SDWebUITabView());

    // 4. NovelAI 专属绘图服务设置选项卡
    modal.registerViewFactory('novelai', () => new NovelAITabView());

    // 5. OpenAI 兼容专属绘图服务设置选项卡
    modal.registerViewFactory('openai', () => new OpenAITabView());

    // 6. 日志与统计选项卡
    modal.registerViewFactory('logs', () => new LogsStatsTabView());

    // 7. 关于与支持选项卡
    modal.registerViewFactory('about', () => new AboutTabView());

    // 8. 外观与主题选项卡
    modal.registerViewFactory('theme', () => new ThemeTabView());

    // 9. 悬浮球设置选项卡
    modal.registerViewFactory('fab', () => new FabTabView());
}
