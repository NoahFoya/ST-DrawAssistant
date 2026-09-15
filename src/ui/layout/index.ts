/**
 * UI 布局层统一导出 (src/ui/layout/index.ts)
 *
 * 功能：
 * 1. 导出主模态窗外壳 (ModalShell) 与快捷悬浮球组件 (FabContainer)；
 * 2. 导出工作流 JSON/API 导入导出与查看模态窗 (WorkflowModal)。
 *
 * Tips：
 * 1. 布局组件作为全屏与交互容器骨架，负责承载下层原子控件与复合视窗。
 */

export * from './modal-shell';
export * from './fab-container';
export * from './workflow-modal';
