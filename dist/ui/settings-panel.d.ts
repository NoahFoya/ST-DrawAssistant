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
/**
 * 加载并渲染设置面板到 ST 扩展设置区域
 */
export declare function renderSettingsPanel(): Promise<void>;
//# sourceMappingURL=settings-panel.d.ts.map