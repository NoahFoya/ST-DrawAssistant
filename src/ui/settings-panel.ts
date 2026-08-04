/**
 * 设置面板 UI 控制器（骨架）
 *
 * 负责：
 * - 动态定位扩展模板目录，兼容第三方（third-party/）和直接安装路径
 * - 将 HTML 控件与 settings manager 双向绑定
 * - Provider 切换时动态显示/隐藏对应字段
 *
 * ⚠️ TODO（P1 设置面板阶段实现）：
 *   - [ ] 绑定所有控件的 input/change 事件
 *   - [ ] Provider 切换联动 UI
 *   - [ ] "测试连接"按钮逻辑
 *   - [ ] 采样器列表动态获取
 */

import { EXTENSION_NAME } from '../core/constants';
import { getContext } from '../core/context';

// ─── 路径解析 ──────────────────────────────────────────────────────────────────

/**
 * 动态探测当前扩展所在的服务器路径
 *
 * ST 第三方扩展路径：scripts/extensions/third-party/{name}/
 * 直接安装路径：     scripts/extensions/{name}/
 *
 * 原因：renderExtensionTemplateAsync 使用的 extensionName 必须与实际路径匹配，
 * 而用户可能将扩展安装在不同位置。
 */
async function findExtensionBasePath(): Promise<string | null> {
    const candidatePaths = [
        `scripts/extensions/third-party/${EXTENSION_NAME}`,
        `scripts/extensions/${EXTENSION_NAME}`,
    ];

    for (const basePath of candidatePaths) {
        try {
            const resp = await fetch(`/${basePath}/manifest.json`, { method: 'HEAD' });
            if (resp.ok) return basePath;
        } catch {
            // 继续尝试下一个路径
        }
    }
    return null;
}

// ─── 模板加载 ─────────────────────────────────────────────────────────────────

/**
 * 直接 fetch 模板 HTML（绕过 renderExtensionTemplateAsync 的路径限制）
 * 适用于路径不确定的场景。
 */
async function fetchTemplate(basePath: string): Promise<string> {
    const url = `/${basePath}/templates/settings.html`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Template fetch failed: ${resp.status} ${url}`);
    return resp.text();
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 加载并渲染设置面板到 ST 扩展设置区域
 */
export async function renderSettingsPanel(): Promise<void> {
    // 1. 探测扩展实际路径
    const basePath = await findExtensionBasePath();
    if (!basePath) {
        console.warn(`[draw-assistant] Cannot locate extension base path, skipping settings panel`);
        return;
    }

    // 2. 尝试通过 ctx 渲染（支持 i18n 和模板变量）
    let html: string;
    try {
        const ctx = getContext();
        // extensionName 使用完整路径（相对于 scripts/extensions/）
        // 例如 "third-party/ST-DrawAssistant"
        const extensionRelPath = basePath.replace('scripts/extensions/', '');
        html = await ctx.renderExtensionTemplateAsync(extensionRelPath, 'templates/settings');
    } catch {
        // 后备：直接 fetch 原始 HTML
        html = await fetchTemplate(basePath);
    }

    // 3. 注入到 ST 扩展设置容器
    const container = document.getElementById('extensions_settings');
    if (!container) {
        console.warn('[draw-assistant] Extension settings container #extensions_settings not found');
        return;
    }

    let wrapper = document.getElementById('st-draw-assistant-settings');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'st-draw-assistant-settings';
        container.appendChild(wrapper);
    }

    wrapper.innerHTML = html;

    // TODO（P1）：绑定控件事件
    // bindSettingsControls(wrapper);
}
