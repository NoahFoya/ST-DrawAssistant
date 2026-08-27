/**
 * @module ui/presets/blueprint-modal
 * @description 工作流蓝图可视化编辑弹窗组件
 */
export interface WorkflowNodeData {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: {
        title?: string;
    };
}
export type WorkflowJsonObj = Record<string, WorkflowNodeData>;
export declare function closeBlueprintModal(): void;
export declare function openBlueprintModal(workflowJsonStr: string, onSaveCallback?: (updatedJsonStr: string) => void, targetType?: 'txt2img' | 'inpaint'): void;
//# sourceMappingURL=blueprint-modal.d.ts.map