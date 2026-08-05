/**
 * @module ui/components/blueprint-modal
 * @description 蓝图可视化节点编辑器弹窗组件 (Blueprint Modal Canvas & Inspector)
 *
 * 职责：
 * - 解析 ComfyUI API Format Workflow JSON 结构
 * - 呈现可缩放/平移的点阵画布 (Zoomable Point-matrix Canvas) 与精致节点小卡片 (Node Mini Cards)
 * - 点击节点小卡片后唤出右侧专属属性编辑面板 (Node Inspector Panel)
 * - 提供智能搜索、5 大分类 Tab 切片与快捷变量胶囊绑定 (%positive%, %seed% 等)
 */
export interface WorkflowNodeData {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: {
        title?: string;
    };
}
export type WorkflowJsonObj = Record<string, WorkflowNodeData>;
/**
 * 弹出蓝图可视化节点编辑器弹窗
 */
export declare function openBlueprintModal(workflowJsonStr: string, onSaveCallback?: (updatedJsonStr: string) => void): void;
export declare function closeBlueprintModal(): void;
//# sourceMappingURL=blueprint-modal.d.ts.map