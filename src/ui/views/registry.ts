/**
 * 设置模态弹窗选项卡视图集中装配中枢。
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
import { MaterialsTabView } from './materials-tab';
import { PromptsTabView } from './prompts-tab';
import { LexiconTabView } from './lexicon-tab';
import { GalleryTabView } from './gallery-tab';
import { FabTabView } from './fab-tab';

/**
 * 为主设置模态外壳集中注册所有已就绪的选项卡视图工厂。
 *
 * @param modal 主设置模态外壳实例
 */
export function registerDefaultViews(modal: SettingsModal): void {
    // 1. 常规设置选项卡
    modal.registerViewFactory('general', () => new GeneralTabView());

    // 2. ComfyUI 专属生图服务设置选项卡
    modal.registerViewFactory('comfyui', () => new ComfyUITabView());

    // 3. SD-WebUI / Forge 专属生图服务设置选项卡
    modal.registerViewFactory('sdwebui', () => new SDWebUITabView());

    // 4. NovelAI 专属生图服务设置选项卡
    modal.registerViewFactory('novelai', () => new NovelAITabView());

    // 5. OpenAI 兼容专属生图服务设置选项卡
    modal.registerViewFactory('openai', () => new OpenAITabView());

    // 6. 日志与统计选项卡
    modal.registerViewFactory('logs', () => new LogsStatsTabView());

    // 7. 关于与支持选项卡
    modal.registerViewFactory('about', () => new AboutTabView());

    // 8. 主题设置选项卡
    modal.registerViewFactory('theme', () => new ThemeTabView());

    // 9. 提示词多通道多深度注入选项卡
    modal.registerViewFactory('prompts', () => new PromptsTabView());

    // 10. 素材库管理选项卡
    modal.registerViewFactory('materials', () => new MaterialsTabView());

    // 11. 本地联想词库选项卡
    modal.registerViewFactory('lexicon', () => new LexiconTabView());

    // 12. 本地图库选项卡
    modal.registerViewFactory('gallery', () => new GalleryTabView());

    // 13. 悬浮球快捷入口选项卡
    modal.registerViewFactory('fab', () => new FabTabView());
}
