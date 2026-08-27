/**
 * @module ui/tabs/comfyui-tab
 * @description ComfyUI 生图引擎配置 Tab 组件
 *
 * 职责：
 * - Card 1: API 服务连接与连通性测试 (单行，弹出气泡反馈，自动拉取后端模型与 Lora)
 * - Card 2: 全局方案预设 (模型/提示词/文生图/重绘工作流关联)
 * - Card 3: 模型与生图参数方案 (绘图模型/CLIP/VAE/采样器/调度器/尺寸/步数/CFG/模型专用正负向词)
 * - Card 4: 提示词与 Lora 方案 (正向前缀/正向后缀/负向词/Lora下拉+权重+添加按钮+已加列表)
 * - Card 5: 文生图工作流预设 (预设工具栏/蓝图编辑器/API JSON)
 * - Card 6: 局部重绘工作流预设 (预设工具栏/蓝图编辑器/API JSON)
 *
 * 规范参考：
 * - .agents/Skills/comfyui-api-reference/SKILL.md (ComfyUI 后端 API 规范)
 */
export declare function renderComfyUITab(): HTMLElement;
//# sourceMappingURL=comfyui-tab.d.ts.map