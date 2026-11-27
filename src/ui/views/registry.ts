/**
 * 设置模态弹窗选项卡视图注册表。
 *
 * @remarks
 * 统一为 SettingsModal 注册各功能选项卡的工厂函数，
 * 隔离容器外壳与具体视图实现。
 */

import type { SettingsModal } from '../modal/settings-modal';
import { createGeneralTabView } from './general-tab';
import { createComfyUITabView } from './comfyui-tab';
import { createSDWebUITabView } from './sdwebui-tab';
import { createNovelAITabView } from './novelai-tab';
import { createOpenAITabView } from './openai-tab';
import { createGeminiTabView } from './gemini-tab';
import { createGrokTabView } from './grok-tab';
import { createLogsStatsTabView } from './logs-stats-tab';
import { createAboutTabView } from './about-tab';
import { createThemeTabView } from './theme-tab';
import { createMaterialsTabView } from './materials-tab';
import { createPromptsTabView } from './prompts-tab';
import { createLexiconTabView } from './lexicon-tab';
import { createGalleryTabView } from './gallery-tab';
import { createFabTabView } from './fab-tab';

/**
 * 为主设置模态外壳集中注册所有已就绪的选项卡视图工厂。
 *
 * @param modal 主设置模态外壳实例
 */
export function registerDefaultViews(modal: SettingsModal): void {
    // 1. 插件设置选项卡
    modal.registerViewFactory('general', () => createGeneralTabView());

    // 2. ComfyUI 专属生图服务设置选项卡
    modal.registerViewFactory('comfyui', () => createComfyUITabView());

    // 3. SD-WebUI / Forge 专属生图服务设置选项卡
    modal.registerViewFactory('sdwebui', () => createSDWebUITabView());

    // 4. NovelAI 专属生图服务设置选项卡
    modal.registerViewFactory('novelai', () => createNovelAITabView());

    // 5. OpenAI 兼容专属生图服务设置选项卡
    modal.registerViewFactory('openai', () => createOpenAITabView());

    // 6. Google Gemini 原生生图服务设置选项卡
    modal.registerViewFactory('gemini', () => createGeminiTabView());

    // 7. xAI Grok 原生生图服务设置选项卡
    modal.registerViewFactory('grok', () => createGrokTabView());

    // 8. 日志与统计选项卡
    modal.registerViewFactory('logs', () => createLogsStatsTabView());

    // 9. 关于选项卡
    modal.registerViewFactory('about', () => createAboutTabView());

    // 10. 主题设置选项卡
    modal.registerViewFactory('theme', () => createThemeTabView());

    // 11. 提示词多通道多深度注入选项卡
    modal.registerViewFactory('prompts', () => createPromptsTabView());

    // 12. 素材管理选项卡
    modal.registerViewFactory('materials', () => createMaterialsTabView());

    // 13. 本地联想词库选项卡
    modal.registerViewFactory('lexicon', () => createLexiconTabView());

    // 14. 本地图库选项卡
    modal.registerViewFactory('gallery', () => createGalleryTabView());

    // 15. 悬浮球快捷入口选项卡
    modal.registerViewFactory('fab', () => createFabTabView());
}
