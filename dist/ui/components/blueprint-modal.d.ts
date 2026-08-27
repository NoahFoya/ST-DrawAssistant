/**
 * @module ui/components/blueprint-modal
 * @description 工作流蓝图可视化编辑弹窗组件
 *
 * 职责：
 * - 解析 ComfyUI API 格式工作流 JSON，绘制可视化节点列表与参数编辑器
 * - 提供节点分类过滤、实时搜索及占位变量快捷插入
 * - 支持修改节点输入参数后重新导出更新的工作流 JSON
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
 * 打开工作流蓝图可视化编辑弹窗
 *
 * @param workflowJsonStr 要编辑的工作流 JSON 字符串
 * @param onSaveCallback 保存修改后的工作流 JSON 字符串回调
 * @param targetType 目标工作流类型
 */
export declare function openBlueprintModal(workflowJsonStr: string, onSaveCallback?: (updatedJsonStr: string) => void, targetType?: 'txt2img' | 'inpaint'): void;
export declare function closeBlueprintModal(): void;
//# sourceMappingURL=blueprint-modal.d.ts.map