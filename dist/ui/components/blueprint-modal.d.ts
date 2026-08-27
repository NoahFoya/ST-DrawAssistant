/**
 * @module ui/components/blueprint-modal
 * @description ComfyUI 工作流蓝图可视化查看与编辑模态框
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
 * 打开 ComfyUI 工作流蓝图可视化查看与编辑弹窗
 *
 * @param workflowJsonStr 工作流 JSON 字符串
 * @param onSaveCallback 保存修改后的工作流回调函数
 * @param targetType 生图模式 ('txt2img' | 'inpaint')
 */
export declare function openBlueprintModal(workflowJsonStr: string, onSaveCallback?: (updatedJsonStr: string) => void, targetType?: 'txt2img' | 'inpaint'): void;
//# sourceMappingURL=blueprint-modal.d.ts.map